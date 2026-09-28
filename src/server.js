'use strict';

// Entry point. Mirrors PhonebookApplication.java + PopulateConfig.java.
// Usage: node src/server.js [populate]

const config = require('./config');
const { createApp } = require('./app');
const { connect, col, nextSequence, close } = require('./db/mongo');

const FIRST = ['Aarav', 'Ananya', 'Arjun', 'Diya', 'Harsh', 'Ishaan', 'Kavya', 'Krishna', 'Meera', 'Nikhil', 'Priya', 'Rahul', 'Raj', 'Riya', 'Rohan', 'Sanya', 'Vikram', 'Zoya', 'Amit', 'Neha'];
const LAST = ['Sharma', 'Verma', 'Patel', 'Iyer', 'Khan', 'Gupta', 'Mehta', 'Nair', 'Singh', 'Joshi', 'Kulkarni', 'Reddy', 'Chopra', 'Malhotra', 'Desai', 'Pillai', 'Agarwal', 'Bose', 'Chavan', 'Pawar'];
const STREETS = ['MG Road', 'Linking Road', 'Park Street', 'Gandhi Nagar', 'Nehru Avenue', 'Lake View Road', 'Station Road', 'Market Street', 'Hill View', 'Green Park'];

function randOf(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function populate() {
  const target = 1000;
  const existing = await col('contacts').countDocuments();
  const needed = Math.max(target - existing, 0);
  if (needed === 0) {
    console.log(`Database already contains ${existing} contacts.`);
    return;
  }
  const owner = await col('users').find({}).sort({ _id: 1 }).limit(1).toArray();
  const ownerId = owner.length ? owner[0]._id : null;
  const all = await col('contacts').find({}).project({ phoneNumber: 1, email: 1 }).toArray();
  const phones = new Set(all.map((c) => c.phoneNumber));
  const emails = new Set(all.filter((c) => c.email != null).map((c) => c.email));
  const batch = [];
  let guard = 0;
  while (batch.length < needed && guard < needed * 20 + 500) {
    guard += 1;
    const phone = `+1${2000000000 + Math.floor(Math.random() * 8000000000)}`;
    const email = `user${Math.floor(Math.random() * 1e15)}@example.com`.toLowerCase();
    if (phones.has(phone) || emails.has(email)) continue;
    const name = `${randOf(FIRST)} ${randOf(LAST)}`;
    const address = `${100 + Math.floor(Math.random() * 900)} ${randOf(STREETS)}, Mumbai`;
    phones.add(phone);
    emails.add(email);
    batch.push({
      _id: await nextSequence('contacts'),
      userId: ownerId,
      name,
      phoneNumber: phone,
      email,
      address,
      createdAt: new Date(),
      tagIds: [],
    });
  }
  if (batch.length) await col('contacts').insertMany(batch);
  console.log(`Added ${batch.length} contacts. Total contacts: ${target}.`);
}

async function main() {
  await connect(config.mongodbUri);
  const args = process.argv.slice(2);
  if (args.some((a) => String(a).toLowerCase() === 'populate')) {
    await populate();
    await close();
    process.exit(0);
    return;
  }
  const app = createApp();
  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Phonebook API (Node.js) listening on port ${config.port}`);
  });
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}

module.exports = { populate };
