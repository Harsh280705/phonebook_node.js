'use strict';

// Port of web/AuthController.java.

const express = require('express');
const { ApiError } = require('../apiError');
const auth = require('../auth');
const { col, nextSequence } = require('../db/mongo');
const security = require('../security');
const validators = require('../validators');

const router = express.Router();

function str(value) {
  return value === null || value === undefined ? null : String(value);
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// POST /auth/register
router.post('/auth/register', asyncHandler(async (req, res) => {
  const raw = req.body && typeof req.body === 'object' ? req.body : {};
  const username = str(raw.username);
  const email = str(raw.email);
  const password = str(raw.password);

  const errors = [];
  const u = username != null ? username.trim() : '';
  if (u.length < 3 || u.length > 100) {
    errors.push({ loc: ['body', 'username'], msg: 'Username must be between 3 and 100 characters.', type: 'value_error' });
  }
  if (email == null || email.trim() === '' || !validators.isValidEmail(email.trim())) {
    errors.push({ loc: ['body', 'email'], msg: 'Invalid email address.', type: 'value_error' });
  }
  if (password == null || password.length < 8) {
    errors.push({ loc: ['body', 'password'], msg: 'Password must contain at least 8 characters.', type: 'value_error' });
  }
  if (errors.length) {
    throw new ApiError(422, { detail: errors });
  }

  const cleanUsername = username.trim();
  const cleanEmail = email.trim();
  if (await col('users').findOne({ username: cleanUsername })) {
    throw new ApiError(409, 'Username already exists.');
  }
  if (await col('users').findOne({ email: cleanEmail })) {
    throw new ApiError(409, 'Email already exists.');
  }

  const now = new Date();
  const user = {
    _id: await nextSequence('users'),
    username: cleanUsername,
    email: cleanEmail,
    passwordHash: security.hashPassword(password),
    createdAt: now,
  };
  try {
    await col('users').insertOne(user);
  } catch (e) {
    if (e && e.code === 11000) {
      if (await col('users').findOne({ username: cleanUsername })) throw new ApiError(409, 'Username already exists.');
      if (await col('users').findOne({ email: cleanEmail })) throw new ApiError(409, 'Email already exists.');
    }
    throw e;
  }

  if ((await col('users').countDocuments()) === 1) {
    // Adopt orphan contacts (userId == null) to first user.
    await col('contacts').updateMany({ userId: null }, { $set: { userId: user._id } });
  }

  await auth.issueSession(res, user._id);
  res.status(201).json(auth.userResponse(user));
}));

// POST /auth/login
router.post('/auth/login', asyncHandler(async (req, res) => {
  const raw = req.body && typeof req.body === 'object' ? req.body : {};
  let identifier = str(raw.identifier);
  const password = str(raw.password);
  if (identifier == null) identifier = '';
  const user = await col('users').findOne({ $or: [{ username: identifier }, { email: identifier }] });
  if (!user || password == null || !security.verifyPassword(password, user.passwordHash)) {
    throw new ApiError(401, 'Invalid username/email or password.');
  }
  await auth.issueSession(res, user._id);
  res.json(auth.userResponse(user));
}));

// GET /auth/me
router.get('/auth/me', asyncHandler(async (req, res) => {
  const user = await auth.currentUser(req);
  if (!user) throw new ApiError(401, 'Authentication required.');
  res.json(auth.userResponse(user));
}));

// POST /auth/logout
router.post('/auth/logout', asyncHandler(async (req, res) => {
  await auth.revokeSession(req);
  auth.clearSessionCookie(res);
  res.json({ message: 'Logged out successfully.' });
}));

module.exports = router;
