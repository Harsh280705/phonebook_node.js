'use strict';

const { MongoClient } = require('mongodb');

// ISOLATION: separate collection names exclusively for the Node.js backend.
// The original Java backend uses: users, contacts, tags, sessions, counters.
// This backend uses only the nodejs_* collections below and must never read
// from or write to the original collections.
const COLLECTIONS = {
  users: 'nodejs_users',
  contacts: 'nodejs_contacts',
  tags: 'nodejs_tags',
  sessions: 'nodejs_sessions',
  counters: 'nodejs_counters',
};

let client = null;
let db = null;

async function connect(uri) {
  if (db) return db;
  client = new MongoClient(uri);
  await client.connect();
  db = client.db();
  await ensureIndexes(db);
  return db;
}

function getDb() {
  if (!db) throw new Error('Database not connected. Call connect() first.');
  return db;
}

function col(name) {
  return getDb().collection(COLLECTIONS[name]);
}

async function ensureIndexes(dbInstance) {
  const safe = async (fn) => {
    try {
      await fn();
    } catch (e) {
      // Mirror MongoIndexConfig: ignore index creation races/errors.
    }
  };
  // Mirrors MongoIndexConfig.java (same keys, on nodejs_* collections).
  await safe(() => dbInstance.collection(COLLECTIONS.users).createIndex({ username: 1 }, { unique: true }));
  await safe(() => dbInstance.collection(COLLECTIONS.users).createIndex({ email: 1 }, { unique: true }));
  await safe(() => dbInstance.collection(COLLECTIONS.sessions).createIndex({ tokenHash: 1 }, { unique: true }));
  await safe(() => dbInstance.collection(COLLECTIONS.contacts).createIndex({ userId: 1 }));
  await safe(() => dbInstance.collection(COLLECTIONS.contacts).createIndex({ phoneNumber: 1 }, { unique: true }));
  await safe(() => dbInstance.collection(COLLECTIONS.contacts).createIndex({ email: 1 }, { unique: true, sparse: true }));
  await safe(() => dbInstance.collection(COLLECTIONS.tags).createIndex({ userId: 1 }));
  await safe(() => dbInstance.collection(COLLECTIONS.tags).createIndex({ userId: 1, lowerName: 1 }, { unique: true }));
}

// Atomic auto-increment ids. Mirrors SequenceService.java
// (findAndModify counters/{name} $inc seq, upsert, returnNew).
async function nextSequence(name) {
  const res = await col('counters').findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  if (res && res.seq != null) return res.seq;
  return 1;
}

async function close() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

module.exports = { COLLECTIONS, connect, getDb, col, nextSequence, close, ensureIndexes };
