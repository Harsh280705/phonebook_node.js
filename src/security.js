'use strict';

// Direct port of backend/.../service/SecurityService.java.
// Format: scrypt$<base64url-no-pad salt16>$<base64url-no-pad hash64>
// with SCrypt N=16384, r=8, p=1, dkLen=64. Verified byte-compatible with the
// Java (BouncyCastle) implementation via the known test vector in AuthTests.

const crypto = require('crypto');

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const DK_LEN = 64;

function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64url');
}

function b64urlDecode(value) {
  // Accept both padded standard and unpadded url-safe forms (like Java helper).
  let s = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const rem = s.length % 4;
  if (rem === 2) s += '==';
  else if (rem === 3) s += '=';
  else if (rem === 1) throw new Error('Invalid base64 length');
  return Buffer.from(s, 'base64');
}

function derive(password, salt) {
  return crypto.scryptSync(String(password), salt, DK_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const digest = derive(password, salt);
  return `scrypt$${b64urlEncode(salt)}$${b64urlEncode(digest)}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash) return false;
  const parts = String(storedHash).split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  try {
    const salt = b64urlDecode(parts[1]);
    const expected = b64urlDecode(parts[2]);
    const actual = derive(password == null ? '' : password, salt);
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch (e) {
    return false;
  }
}

function createSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

module.exports = { hashPassword, verifyPassword, createSessionToken, hashSessionToken };
