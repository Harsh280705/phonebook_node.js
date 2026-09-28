'use strict';

// Port of backend/.../service/AuthService.java.
// Sessions live in the isolated nodejs_sessions collection.

const config = require('./config');
const { col } = require('./db/mongo');
const security = require('./security');

const COOKIE_NAME = config.cookieName;
const SESSION_MAX_AGE_MS = config.sessionDays * 24 * 3600 * 1000;

function sessionToken(req) {
  if (req.cookies && req.cookies[COOKIE_NAME]) return req.cookies[COOKIE_NAME];
  return null;
}

async function currentUser(req) {
  const token = sessionToken(req);
  if (!token) return null;
  const hash = security.hashSessionToken(token);
  const session = await col('sessions').findOne({ tokenHash: hash });
  if (!session) return null;
  if (!session.expiresAt || new Date(session.expiresAt) < new Date()) return null;
  return col('users').findOne({ _id: session.userId });
}

async function issueSession(res, userId) {
  const token = security.createSessionToken();
  const now = new Date();
  await col('sessions').insertOne({
    tokenHash: security.hashSessionToken(token),
    userId,
    expiresAt: new Date(now.getTime() + SESSION_MAX_AGE_MS),
    createdAt: now,
  });
  setSessionCookie(res, token, SESSION_MAX_AGE_MS);
}

function setSessionCookie(res, token, maxAgeMs) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    maxAge: maxAgeMs,
  });
}

function clearSessionCookie(res) {
  res.cookie(COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    maxAge: 0,
  });
}

async function revokeSession(req) {
  const token = sessionToken(req);
  if (token) {
    await col('sessions').deleteMany({ tokenHash: security.hashSessionToken(token) });
  }
}

function userResponse(user) {
  return {
    id: user._id,
    username: user.username,
    email: user.email,
    created_at: user.createdAt instanceof Date ? user.createdAt.toISOString() : user.createdAt,
  };
}

module.exports = {
  COOKIE_NAME,
  sessionToken,
  currentUser,
  issueSession,
  revokeSession,
  setSessionCookie,
  clearSessionCookie,
  userResponse,
};
