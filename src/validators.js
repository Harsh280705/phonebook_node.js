'use strict';

// Direct port of backend/.../service/Validators.java.
// Messages are kept VERBATIM so the API contract does not change.

const TAG_PATTERN = /^[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9\s'-]{0,49}$/;
const NAME_PATTERN = /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'-]{1,99}$/;
const PHONE_ALLOWED = /^\+?[0-9()\s-]+$/;
const ADDRESS_ALLOWED = /^[A-Za-zÀ-ÿ0-9\s,.'#/-]+$/;
const HAS_LETTER = /[A-Za-zÀ-ÿ]/;
const SCIENTIFIC = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)[eE][+-]?\d+$/;
const EXCEL_PHONE = /^="([^"]*)"$/;

function validateTagName(raw) {
  const cleaned = raw != null ? String(raw).trim() : '';
  if (cleaned.length < 1 || cleaned.length > 50 || !TAG_PATTERN.test(cleaned)) {
    return 'Tag name must be 1 to 50 characters and contain only letters, numbers, spaces, apostrophes or hyphens.';
  }
  return null;
}

// Mirrors collectContactErrors(name, phone, email, address, fields, partial).
// Returns { fields: string[], message: string|null }.
function collectContactErrors(name, phone, email, address, partial) {
  const fields = new Set();
  const messages = [];
  if (!partial || name !== null && name !== undefined) {
    if (name == null || String(name).trim() === '' || !NAME_PATTERN.test(String(name).trim())) {
      fields.add('name');
      messages.push('Name must contain only letters, spaces, apostrophes or hyphens.');
    }
  }
  if (!partial || phone !== null && phone !== undefined) {
    if (phone == null || String(phone).trim() === '' || !PHONE_ALLOWED.test(String(phone).trim())) {
      fields.add('phone_number');
      messages.push('Phone number may contain digits, a leading +, spaces, hyphens, or parentheses.');
    } else {
      const digits = String(phone).replace(/\D/g, '');
      if (digits.length < 8 || digits.length > 15) {
        fields.add('phone_number');
        messages.push('Phone number must contain between 8 and 15 digits.');
      }
    }
  }
  if (email !== null && email !== undefined && String(email).trim() !== '') {
    if (!isValidEmail(String(email).trim())) {
      fields.add('email');
      messages.push('Invalid email address.');
    }
  }
  if (address !== null && address !== undefined && String(address).trim() !== '') {
    const cleaned = String(address).trim();
    if (cleaned.length < 5 || cleaned.length > 255) {
      fields.add('address');
      messages.push('Address must be between 5 and 255 characters.');
    } else if (!HAS_LETTER.test(cleaned)) {
      fields.add('address');
      messages.push('Address must contain at least one letter.');
    } else if (!ADDRESS_ALLOWED.test(cleaned)) {
      fields.add('address');
      messages.push('Address contains invalid characters.');
    }
  }
  return { fields: [...fields], message: messages.length ? messages.join('; ') : null };
}

function isValidEmail(email) {
  if (email == null || String(email).trim() === '') return false;
  if (email.includes(' ')) return false;
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@') || at === email.length - 1) return false;
  const domain = email.substring(at + 1);
  if (!domain.includes('.')) return false;
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return false;
  const local = email.substring(0, at);
  if (!local || local.startsWith('.') || local.endsWith('.')) return false;
  return true;
}

function normalizeHeader(value) {
  const lower = String(value).trim().toLowerCase();
  const replaced = lower.replace(/[^a-z0-9]+/g, '_');
  return replaced.replace(/^_+|_+$/g, '');
}

function normalizePhone(value) {
  let phone = String(value).trim();
  const m = EXCEL_PHONE.exec(phone);
  if (m) phone = m[1].trim();
  else if (phone.startsWith("'")) phone = phone.substring(1).trim();
  if (SCIENTIFIC.test(phone)) {
    const err = new Error('Phone number is in scientific notation and cannot be recovered safely.');
    err.code = 'SCIENTIFIC_PHONE';
    throw err;
  }
  return phone;
}

// Escape a literal substring for use inside a MongoDB $regex (like Pattern.quote).
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  validateTagName,
  collectContactErrors,
  isValidEmail,
  normalizeHeader,
  normalizePhone,
  escapeRegExp,
};
