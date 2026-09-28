'use strict';

// Shared helpers: auth guard, request parsing, contact/tag mapping.
// Field semantics mirror ContactController.java helpers (asString, asLongList,
// distinct, toResponse, toResponses).

const { ApiError } = require('./apiError');
const auth = require('./auth');
const { col } = require('./db/mongo');

async function requireUser(req) {
  const user = await auth.currentUser(req);
  if (!user) throw new ApiError(401, 'Authentication required.');
  return user;
}

function asString(value) {
  return value === null || value === undefined ? null : String(value);
}

function asLongList(value) {
  if (value === null || value === undefined) return null;
  const list = Array.isArray(value) ? value : [value];
  return list.map((e) => {
    if (typeof e === 'number' && Number.isFinite(e)) return Math.trunc(e);
    const n = parseInt(String(e), 10);
    return Number.isNaN(n) ? -1 : n;
  });
}

// Query-string variant: Express gives string | string[] | undefined.
function asLongListQuery(value) {
  if (value === undefined || value === null || value === '') return [];
  return asLongList(value);
}

function distinct(list) {
  return [...new Set(list)];
}

async function ensureOwnedTags(tagIds, userId) {
  if (tagIds == null) return null;
  const unique = distinct(tagIds);
  if (unique.some((t) => t <= 0)) return 'One or more tags were not found.';
  if (unique.length === 0) return null;
  const owned = await col('tags').countDocuments({ userId, _id: { $in: unique } });
  return owned === unique.length ? null : 'One or more tags were not found.';
}

function tagResponse(tag) {
  return { id: tag._id, name: tag.name };
}

function contactResponse(contact, tagsById) {
  const tagResponses = [];
  const ids = contact.tagIds || [];
  for (const tid of ids) {
    const t = tagsById.get(tid);
    if (t) tagResponses.push(tagResponse(t));
  }
  tagResponses.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    id: contact._id,
    name: contact.name,
    phone_number: contact.phoneNumber,
    email: contact.email ?? null,
    address: contact.address ?? null,
    created_at: contact.createdAt instanceof Date ? contact.createdAt.toISOString() : contact.createdAt,
    tags: tagResponses,
  };
}

async function toResponse(contact) {
  const ids = contact.tagIds || [];
  const byId = new Map();
  if (ids.length) {
    const found = await col('tags').find({ _id: { $in: ids } }).toArray();
    for (const t of found) byId.set(t._id, t);
  }
  return contactResponse(contact, byId);
}

async function toResponses(list) {
  const allIds = new Set();
  for (const c of list) for (const tid of c.tagIds || []) allIds.add(tid);
  const byId = new Map();
  if (allIds.size) {
    const found = await col('tags').find({ _id: { $in: [...allIds] } }).toArray();
    for (const t of found) byId.set(t._id, t);
  }
  return list.map((c) => contactResponse(c, byId));
}

// Case-sensitive ordinal ordering like Java String.compareTo on name.
function sortByNameAsc(list) {
  return list.sort((a, b) => {
    const x = a.name ?? '';
    const y = b.name ?? '';
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

module.exports = {
  requireUser,
  asString,
  asLongList,
  asLongListQuery,
  distinct,
  ensureOwnedTags,
  tagResponse,
  contactResponse,
  toResponse,
  toResponses,
  sortByNameAsc,
};
