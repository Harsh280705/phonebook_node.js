'use strict';

// Port of web/TagController.java.

const express = require('express');
const { ApiError } = require('../apiError');
const { col, nextSequence } = require('../db/mongo');
const validators = require('../validators');
const { requireUser, tagResponse } = require('../common');

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function parseId(value) {
  if (!/^-?\d+$/.test(String(value))) return null;
  return parseInt(String(value), 10);
}

// GET /tags and /tags/
async function list(req, res) {
  const user = await requireUser(req);
  const tags = await col('tags').find({ userId: user._id }).sort({ name: 1 }).toArray();
  res.json(tags.map(tagResponse));
}
router.get('/tags', asyncHandler(list));
router.get('/tags/', asyncHandler(list));

// POST /tags and /tags/
async function create(req, res) {
  const user = await requireUser(req);
  const raw = req.body && typeof req.body === 'object' ? req.body : {};
  const name = raw.name == null ? null : String(raw.name);
  const err = validators.validateTagName(name);
  if (err) throw new ApiError(422, err);
  const cleaned = name.trim();
  if (await col('tags').findOne({ userId: user._id, lowerName: cleaned.toLowerCase() })) {
    throw new ApiError(409, 'A tag with this name already exists.');
  }
  const tag = {
    _id: await nextSequence('tags'),
    userId: user._id,
    name: cleaned,
    lowerName: cleaned.toLowerCase(),
  };
  try {
    await col('tags').insertOne(tag);
  } catch (e) {
    if (e && e.code === 11000) throw new ApiError(409, 'A tag with this name already exists.');
    throw e;
  }
  res.status(201).json(tagResponse(tag));
}
router.post('/tags', asyncHandler(create));
router.post('/tags/', asyncHandler(create));

// PUT /tags/:id
router.put('/tags/:id', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const id = parseId(req.params.id);
  const raw = req.body && typeof req.body === 'object' ? req.body : {};
  const tag = id == null ? null : await col('tags').findOne({ _id: id, userId: user._id });
  if (!tag) return res.status(404).json({ detail: 'Tag not found.' });
  const name = raw.name == null ? null : String(raw.name);
  const err = validators.validateTagName(name);
  if (err) throw new ApiError(422, err);
  const cleaned = name.trim();
  const existing = await col('tags').findOne({ userId: user._id, lowerName: cleaned.toLowerCase() });
  if (existing && existing._id !== tag._id) {
    throw new ApiError(409, 'A tag with this name already exists.');
  }
  try {
    await col('tags').updateOne({ _id: tag._id }, { $set: { name: cleaned, lowerName: cleaned.toLowerCase() } });
  } catch (e) {
    if (e && e.code === 11000) throw new ApiError(409, 'A tag with this name already exists.');
    throw e;
  }
  res.json({ id: tag._id, name: cleaned });
}));

// DELETE /tags/:id
router.delete('/tags/:id', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const id = parseId(req.params.id);
  const tag = id == null ? null : await col('tags').findOne({ _id: id, userId: user._id });
  if (!tag) return res.status(404).json({ detail: 'Tag not found.' });
  await col('tags').deleteOne({ _id: tag._id });
  // Remove tag from all contacts of this user.
  const contacts = await col('contacts').find({ userId: user._id, tagIds: id }).toArray();
  for (const c of contacts) {
    const next = (c.tagIds || []).filter((t) => t !== id);
    await col('contacts').updateOne({ _id: c._id }, { $set: { tagIds: next } });
  }
  res.json({ message: 'Tag deleted successfully.' });
}));

module.exports = router;
