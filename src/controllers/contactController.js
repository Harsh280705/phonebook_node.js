'use strict';

// Port of web/ContactController.java.

const express = require('express');
const multer = require('multer');
const { ApiError } = require('../apiError');
const { col, nextSequence } = require('../db/mongo');
const validators = require('../validators');
const { csvField, parseCsv, csvValue } = require('../csv');
const {
  requireUser,
  asString,
  asLongList,
  asLongListQuery,
  distinct,
  ensureOwnedTags,
  toResponse,
  toResponses,
  sortByNameAsc,
} = require('../common');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function parseId(value) {
  if (!/^-?\d+$/.test(String(value))) return null;
  return parseInt(String(value), 10);
}

// ---------- list ----------
// GET /contacts and /contacts/
async function list(req, res) {
  const user = await requireUser(req);
  let page = req.query.page === undefined ? 1 : Number(req.query.page);
  let limit = req.query.limit === undefined ? 10 : Number(req.query.limit);
  if (!Number.isInteger(page) || !Number.isInteger(limit) || page < 1 || limit < 1 || limit > 100) {
    throw new ApiError(422, 'Page must be positive and limit must be between 1 and 100.');
  }
  const search = req.query.search;
  const tagIds = distinct(asLongListQuery(req.query.tag_ids));

  const filter = { userId: user._id };
  if (search != null && String(search).trim() !== '') {
    const rx = new RegExp(`.*${validators.escapeRegExp(String(search).trim())}.*`, 'i');
    filter.$or = [{ name: rx }, { phoneNumber: rx }, { email: rx }];
  }
  if (tagIds.length) {
    filter.tagIds = { $all: tagIds };
  }

  const total = await col('contacts').countDocuments(filter);
  const all = await col('contacts').find(filter).toArray();
  sortByNameAsc(all);

  const totalPages = Math.max(Math.ceil(total / limit), 1);
  const from = Math.min((page - 1) * limit, all.length);
  const to = Math.min(from + limit, all.length);
  const slice = all.slice(from, to);

  res.json({
    items: await toResponses(slice),
    page,
    limit,
    total,
    total_pages: totalPages,
  });
}
router.get('/contacts', asyncHandler(list));
router.get('/contacts/', asyncHandler(list));

// ---------- create ----------
// POST /contacts and /contacts/
async function create(req, res) {
  const user = await requireUser(req);
  const raw = req.body && typeof req.body === 'object' ? req.body : {};
  let name = asString(raw.name);
  let phone = asString(raw.phone_number);
  if (phone == null) phone = asString(raw.phoneNumber);
  const email = asString(raw.email);
  const address = asString(raw.address);
  let tagIds = asLongList(raw.tag_ids);
  if (tagIds == null) tagIds = asLongList(raw.tagIds);

  const { message: err } = validators.collectContactErrors(name, phone, email, address, false);
  if (err) throw new ApiError(422, err);

  const tagErr = await ensureOwnedTags(tagIds, user._id);
  if (tagErr) throw new ApiError(400, tagErr);

  const cleanPhone = phone.trim();
  const cleanEmail = email == null || email.trim() === '' ? null : email.trim();
  if (await col('contacts').findOne({ phoneNumber: cleanPhone })) {
    throw new ApiError(409, 'This phone number already exists.');
  }
  if (cleanEmail != null && (await col('contacts').findOne({ email: cleanEmail }))) {
    throw new ApiError(409, 'This email address already exists.');
  }

  const contact = {
    _id: await nextSequence('contacts'),
    userId: user._id,
    name: name.trim(),
    phoneNumber: cleanPhone,
    email: cleanEmail,
    address: address == null || address.trim() === '' ? null : address.trim(),
    createdAt: new Date(),
    tagIds: tagIds != null ? distinct(tagIds) : [],
  };
  try {
    await col('contacts').insertOne(contact);
  } catch (e) {
    if (e && e.code === 11000) throw new ApiError(409, 'A contact with this phone number or email already exists.');
    throw e;
  }
  res.status(201).json(await toResponse(contact));
}
router.post('/contacts', asyncHandler(create));
router.post('/contacts/', asyncHandler(create));

// ---------- export (must be before /contacts/:id) ----------
router.get('/contacts/export', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const all = await col('contacts').find({ userId: user._id }).sort({ name: 1 }).toArray();
  let sb = 'Name,Phone number,Email,Address\n';
  for (const c of all) {
    sb += `${csvField(c.name)},${csvField(`="${c.phoneNumber}"`)},${csvField(c.email != null ? c.email : '')},${csvField(c.address != null ? c.address : '')}\n`;
  }
  res.set('Content-Disposition', 'attachment; filename=phonebook.csv');
  res.type('text/csv; charset=utf-8');
  res.send(Buffer.from(sb, 'utf8'));
}));

// ---------- import ----------
router.post('/contacts/import', upload.single('file'), asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const file = req.file;
  if (!file || !file.originalname || file.originalname.trim() === '' || !file.originalname.toLowerCase().endsWith('.csv')) {
    throw new ApiError(400, 'Please upload a CSV file.');
  }
  if (file.size === 0) {
    throw new ApiError(400, 'The CSV file is empty.');
  }
  let text;
  try {
    // Strict UTF-8 check (fatal on malformed sequences).
    // eslint-disable-next-line no-undef
    text = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer);
  } catch (e) {
    throw new ApiError(400, 'The CSV file must use UTF-8 encoding.');
  }
  if (text.trim() === '') {
    throw new ApiError(400, 'The CSV file is empty.');
  }

  let headers;
  let records;
  try {
    const parsed = parseCsv(text);
    headers = parsed.headers;
    records = parsed.records;
  } catch (e) {
    throw new ApiError(400, 'The CSV file is empty.');
  }
  if (!headers || !headers.length) {
    throw new ApiError(400, 'The CSV file is empty.');
  }

  const normalized = new Set(headers.map(validators.normalizeHeader));
  const nameAliases = new Set(['name', 'full_name']);
  const firstAliases = new Set(['first_name', 'firstname']);
  const lastAliases = new Set(['last_name', 'lastname']);
  const phoneAliases = new Set(['phone', 'phone_number', 'mobile', 'mobile_number']);
  const has = (aliases) => [...normalized].some((h) => aliases.has(h));
  const hasName = has(nameAliases) || has(firstAliases) || has(lastAliases);
  const hasPhone = has(phoneAliases);
  if (!hasName || !hasPhone) {
    throw new ApiError(400, 'CSV must include a name or first/last name column and a phone column.');
  }

  const normalizedHeaders = headers.map(validators.normalizeHeader);
  const existing = await col('contacts').find({}).project({ phoneNumber: 1, email: 1 }).toArray();
  const seenPhones = new Set(existing.map((c) => c.phoneNumber));
  const seenEmails = new Set(existing.filter((c) => c.email != null).map((c) => c.email));

  let totalRows = 0;
  let imported = 0;
  let skipped = 0;
  let invalidRows = 0;
  let invalidNames = 0;
  let invalidPhones = 0;
  let invalidEmails = 0;
  let invalidAddresses = 0;
  const rowErrors = [];
  const toSave = [];

  let rowNumber = 1;
  for (const record of records) {
    rowNumber += 1;
    totalRows += 1;
    let name = csvValue(headers, record, normalizedHeaders, nameAliases);
    if (name == null) {
      const first = csvValue(headers, record, normalizedHeaders, firstAliases);
      const last = csvValue(headers, record, normalizedHeaders, lastAliases);
      const parts = [];
      if (first != null && first.trim() !== '') parts.push(first.trim());
      if (last != null && last.trim() !== '') parts.push(last.trim());
      name = parts.length ? parts.join(' ') : null;
    }
    let phone = csvValue(headers, record, normalizedHeaders, phoneAliases);
    if (phone == null) phone = '';
    let email = csvValue(headers, record, normalizedHeaders, new Set(['email', 'email_address']));
    let address = csvValue(headers, record, normalizedHeaders, new Set(['address', 'street_address']));
    if (address == null) {
      const city = csvValue(headers, record, normalizedHeaders, new Set(['city', 'town']));
      const country = csvValue(headers, record, normalizedHeaders, new Set(['country', 'country_name']));
      const parts = [];
      if (city != null && city.trim() !== '') parts.push(city.trim());
      if (country != null && country.trim() !== '') parts.push(country.trim());
      address = parts.length ? parts.join(' ') : null;
    }

    const fields = new Set();
    let error = null;
    try {
      phone = validators.normalizePhone(phone == null ? '' : phone);
      const r = validators.collectContactErrors(name, phone, email, address, false);
      for (const f of r.fields) fields.add(f);
      error = r.message;
    } catch (ex) {
      fields.add('phone_number');
      error = ex.message;
    }
    if (error != null) {
      invalidRows += 1;
      if (fields.has('name')) invalidNames += 1;
      if (fields.has('phone_number')) invalidPhones += 1;
      if (fields.has('email')) invalidEmails += 1;
      if (fields.has('address')) invalidAddresses += 1;
      rowErrors.push({ row: rowNumber, error });
      continue;
    }
    const normEmail = email == null || String(email).trim() === '' ? null : String(email).trim();
    if (seenPhones.has(phone) || (normEmail != null && seenEmails.has(normEmail))) {
      skipped += 1;
      continue;
    }
    toSave.push({
      _id: await nextSequence('contacts'),
      userId: user._id,
      name: String(name).trim(),
      phoneNumber: phone,
      email: normEmail,
      address: address == null || String(address).trim() === '' ? null : String(address).trim(),
      createdAt: new Date(),
      tagIds: [],
    });
    seenPhones.add(phone);
    if (normEmail != null) seenEmails.add(normEmail);
    imported += 1;
  }
  if (toSave.length) await col('contacts').insertMany(toSave);

  res.json({
    total_rows: totalRows,
    imported,
    skipped_duplicates: skipped,
    invalid_rows: invalidRows,
    invalid_names: invalidNames,
    invalid_phone_numbers: invalidPhones,
    invalid_emails: invalidEmails,
    invalid_addresses: invalidAddresses,
    row_errors: rowErrors,
  });
}));

// ---------- get one ----------
router.get('/contacts/:id', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const id = parseId(req.params.id);
  const contact = id == null ? null : await col('contacts').findOne({ _id: id, userId: user._id });
  if (!contact) return res.status(404).json({ detail: 'Contact not found.' });
  res.json(await toResponse(contact));
}));

// ---------- update ----------
router.put('/contacts/:id', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const id = parseId(req.params.id);
  const contact = id == null ? null : await col('contacts').findOne({ _id: id, userId: user._id });
  if (!contact) return res.status(404).json({ detail: 'Contact not found.' });

  const raw = req.body && typeof req.body === 'object' ? req.body : {};
  const hasName = Object.prototype.hasOwnProperty.call(raw, 'name');
  const hasPhone = Object.prototype.hasOwnProperty.call(raw, 'phone_number') || Object.prototype.hasOwnProperty.call(raw, 'phoneNumber');
  const hasEmail = Object.prototype.hasOwnProperty.call(raw, 'email');
  const hasAddress = Object.prototype.hasOwnProperty.call(raw, 'address');
  const hasTags = Object.prototype.hasOwnProperty.call(raw, 'tag_ids') || Object.prototype.hasOwnProperty.call(raw, 'tagIds');

  const name = hasName ? asString(raw.name) : null;
  let phone = null;
  if (Object.prototype.hasOwnProperty.call(raw, 'phone_number')) phone = asString(raw.phone_number);
  else if (Object.prototype.hasOwnProperty.call(raw, 'phoneNumber')) phone = asString(raw.phoneNumber);
  const email = hasEmail ? asString(raw.email) : null;
  const address = hasAddress ? asString(raw.address) : null;
  let tagIds = null;
  if (Object.prototype.hasOwnProperty.call(raw, 'tag_ids')) tagIds = asLongList(raw.tag_ids);
  else if (Object.prototype.hasOwnProperty.call(raw, 'tagIds')) tagIds = asLongList(raw.tagIds);

  if (hasName || hasPhone || hasEmail || hasAddress) {
    // partial=true: null (absent or explicit JSON null) means "skip".
    const { message: err } = validators.collectContactErrors(
      hasName ? name : null,
      hasPhone ? phone : null,
      hasEmail ? email : null,
      hasAddress ? address : null,
      true
    );
    if (err) throw new ApiError(422, err);
  }

  if (tagIds != null) {
    const tagErr = await ensureOwnedTags(tagIds, user._id);
    if (tagErr) throw new ApiError(400, tagErr);
  }

  if (hasPhone && phone != null) {
    const cleanPhone = phone.trim();
    const existing = await col('contacts').findOne({ phoneNumber: cleanPhone });
    if (existing && existing._id !== contact._id) {
      throw new ApiError(409, 'This phone number already exists.');
    }
  }
  if (hasEmail && email != null) {
    const cleanEmail = email.trim() === '' ? null : email.trim();
    if (cleanEmail != null) {
      const existing = await col('contacts').findOne({ email: cleanEmail });
      if (existing && existing._id !== contact._id) {
        throw new ApiError(409, 'This email address already exists.');
      }
    }
  }

  const update = {};
  if (hasName && name != null) update.name = name.trim();
  if (hasPhone && phone != null) update.phoneNumber = phone.trim();
  if (hasEmail && email != null) update.email = email.trim() === '' ? null : email.trim();
  if (hasAddress && address != null) update.address = address.trim() === '' ? null : address.trim();
  if (tagIds != null) update.tagIds = distinct(tagIds);
  if (Object.keys(update).length) {
    try {
      await col('contacts').updateOne({ _id: contact._id }, { $set: update });
    } catch (e) {
      if (e && e.code === 11000) throw new ApiError(409, 'A contact with this phone number or email already exists.');
      throw e;
    }
    Object.assign(contact, update);
  }
  res.json(await toResponse(contact));
}));

// ---------- delete ----------
router.delete('/contacts/:id', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const id = parseId(req.params.id);
  const contact = id == null ? null : await col('contacts').findOne({ _id: id, userId: user._id });
  if (!contact) return res.status(404).json({ detail: 'Contact not found.' });
  await col('contacts').deleteOne({ _id: contact._id });
  res.json({ message: 'Contact deleted successfully.' });
}));

module.exports = router;
