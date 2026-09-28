'use strict';

// Shared test harness: in-memory MongoDB + Express app + cookie agents.
// Uses the isolated nodejs_* collections on a throwaway database, so the
// original Java backend data can never be touched.

const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');
const { createApp } = require('../src/app');
const mongo = require('../src/db/mongo');

let mongod = null;
let app = null;

async function startTestDb() {
  mongod = await MongoMemoryServer.create();
  const uri = `${mongod.getUri()}phonebook_node_test`;
  await mongo.connect(uri);
  app = createApp();
  return app;
}

async function stopTestDb() {
  await mongo.close();
  if (mongod) {
    await mongod.stop();
    mongod = null;
  }
}

async function cleanDatabase() {
  const db = mongo.getDb();
  const cols = await db.listCollections().toArray();
  for (const c of cols) {
    if (c.name.startsWith('system.')) continue;
    await db.collection(c.name).deleteMany({});
  }
}

function uniqueUser(prefix) {
  const suffix = Math.random().toString(36).slice(2, 12);
  return {
    username: `${prefix}_${suffix}`,
    email: `${prefix}_${suffix}@example.com`,
    password: 'StrongPass123!',
  };
}

function contactPayload() {
  return {
    name: 'Test Contact',
    phone_number: '+14155550101',
    email: 'test-contact@example.com',
    address: '123 Test Street',
  };
}

// Register a user; returns an authed supertest agent (cookie jar preserved).
async function register(user) {
  const agent = request.agent(app);
  const res = await agent.post('/auth/register').send(user);
  if (res.status !== 201) {
    throw new Error(`Register failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}

function setupSuite() {
  beforeAll(async () => {
    await startTestDb();
  });
  afterAll(async () => {
    await stopTestDb();
  });
  beforeEach(async () => {
    await cleanDatabase();
  });
}

module.exports = { startTestDb, stopTestDb, cleanDatabase, uniqueUser, contactPayload, register, setupSuite, getApp: () => app };
