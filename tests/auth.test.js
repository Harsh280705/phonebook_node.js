'use strict';

const request = require('supertest');
const base = require('./base');
const security = require('../src/security');

base.setupSuite();

test('root endpoint returns running message', async () => {
  const res = await request(base.getApp()).get('/');
  expect(res.status).toBe(200);
  expect(res.body.message).toBe('Phonebook API is running');
});

test('register valid user creates account and session cookie', async () => {
  const user = base.uniqueUser('testuser');
  const res = await request(base.getApp()).post('/auth/register').send(user);
  expect(res.status).toBe(201);
  expect(res.body.email).toBe(user.email);
  const setCookie = res.headers['set-cookie'];
  expect(setCookie).toBeDefined();
  expect(setCookie.join(';')).toMatch(/phonebook_session=/);
});

test('register duplicate username or email returns conflict', async () => {
  const app = base.getApp();
  const user = base.uniqueUser('testuser');
  await request(app).post('/auth/register').send(user).expect(201);
  await request(app).post('/auth/register').send({ ...user, email: 'different@example.com' }).expect(409);
  await request(app).post('/auth/register').send({ ...user, username: 'different_username' }).expect(409);
});

test('register invalid data returns unprocessable', async () => {
  const app = base.getApp();
  const res = await request(app).post('/auth/register').send({ username: 'ab', email: 'not-an-email', password: 'short' });
  expect(res.status).toBe(422);
  expect(Array.isArray(res.body.detail)).toBe(true);
});

test('login by username and email succeeds', async () => {
  const app = base.getApp();
  const user = base.uniqueUser('testuser');
  const client = await base.register(user);
  await client.post('/auth/logout');
  for (const identifier of [user.username, user.email]) {
    const r = await client.post('/auth/login').send({ identifier, password: user.password });
    expect(r.status).toBe(200);
    expect(r.body.username).toBe(user.username);
    await client.post('/auth/logout');
  }
});

test('login invalid credentials returns unauthorized', async () => {
  const app = base.getApp();
  const r = await request(app).post('/auth/login').send({ identifier: 'missing-user', password: 'wrong-password' });
  expect(r.status).toBe(401);
});

test('current user requires authentication', async () => {
  const app = base.getApp();
  await request(app).get('/auth/me').expect(401);
  const user = base.uniqueUser('testuser');
  const client = await base.register(user);
  const me = await client.get('/auth/me');
  expect(me.status).toBe(200);
  expect(me.body.email).toBe(user.email);
});

test('logout invalidates session', async () => {
  const user = base.uniqueUser('testuser');
  const client = await base.register(user);
  expect((await client.get('/auth/me')).status).toBe(200);
  expect((await client.post('/auth/logout')).status).toBe(200);
  expect((await client.get('/auth/me')).status).toBe(401);
});

test('password hash is compatible with Java/Python scrypt vector', () => {
  const pythonHash = 'scrypt$AAECAwQFBgcICQoLDA0ODw==$-TWpMCXcNA8tK2qNm9ZnzhACHcOUIsMX2JcTblKjZr-E0YSC3CSTf0Nt0CQ-ITS3ZVYTuhmr2CFnAN_6yGWWNA==';
  expect(security.verifyPassword('StrongPass123!', pythonHash)).toBe(true);
  expect(security.verifyPassword('wrong-password', pythonHash)).toBe(false);
  expect(security.verifyPassword('round-trip-password', security.hashPassword('round-trip-password'))).toBe(true);
});
