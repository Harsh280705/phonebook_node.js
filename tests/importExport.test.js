'use strict';

const request = require('supertest');
const base = require('./base');

base.setupSuite();

function csvBuffer(content, filename) {
  return { content: Buffer.from(content, 'utf8'), filename };
}

async function uploadCsv(client, content, filename) {
  const { content: buf, filename: name } = csvBuffer(content, filename);
  return client.post('/contacts/import').attach('file', buf, name);
}

test('export and import require authentication', async () => {
  const app = base.getApp();
  expect((await request(app).get('/contacts/export')).status).toBe(401);
  const res = await request(app).post('/contacts/import').attach('file', Buffer.from('name,phone_number\nA,+14155550101\n'), 'contacts.csv');
  expect(res.status).toBe(401);
});

test('export returns only authenticated users contacts', async () => {
  const first = await base.register(base.uniqueUser('first'));
  const created = (await first.post('/contacts/').send(base.contactPayload())).body;
  await first.post('/auth/logout');

  const second = await base.register({ username: 'export_other_user', email: 'export_other_user@example.com', password: 'StrongPass123!' });
  const other = { ...base.contactPayload(), name: 'Other User Contact', phone_number: '+14155550102', email: 'other@example.com' };
  expect((await second.post('/contacts/').send(other)).status).toBe(201);

  const response = await second.get('/contacts/export');
  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toMatch(/^text\/csv/);
  expect(response.text).toContain('Name,Phone number,Email,Address');
  expect(response.text).toContain('Other User Contact');
  expect(response.text).toContain('+14155550102');
  expect(response.text).not.toContain(created.name);
});

test('import valid csv persists contacts', async () => {
  const client = await base.register(base.uniqueUser('testuser'));
  const content = 'name,phone_number,email,address\n'
    + 'Imported Alpha,+14155550121,alpha@example.com,123 Import Street\n'
    + 'Imported Beta,+14155550122,beta@example.com,456 Import Avenue\n';
  const response = await uploadCsv(client, content, 'contacts.csv');
  expect(response.status).toBe(200);
  const contacts = (await client.get('/contacts/?page=1&limit=10&search=Imported')).body;
  expect(response.body.total_rows).toBe(2);
  expect(response.body.imported).toBe(2);
  expect(contacts.total).toBe(2);
  expect(new Set(contacts.items.map((i) => i.email))).toEqual(new Set(['alpha@example.com', 'beta@example.com']));
});

test('import external columns and excel phone text', async () => {
  const client = await base.register(base.uniqueUser('testuser'));
  const content = 'First Name,Last Name,Email,Phone,City,Country\n'
    + 'External,Contact,external@example.com,="+14155550131",Mumbai,India\n';
  const response = await uploadCsv(client, content, 'contacts.csv');
  expect(response.status).toBe(200);
  const contacts = (await client.get('/contacts/?page=1&limit=10&search=External')).body;
  expect(response.body.imported).toBe(1);
  expect(contacts.items[0].phone_number).toBe('+14155550131');
  expect(contacts.items[0].address).toBe('Mumbai India');
});

test('import invalid rows and scientific notation', async () => {
  const client = await base.register(base.uniqueUser('testuser'));
  const content = 'name,phone_number,email,address\n'
    + 'Invalid Phone,9.11235E+11,valid@example.com,123 Invalid Street\n'
    + 'Invalid Email,+14155550132,not-an-email,123 Invalid Street\n'
    + ',+14155550133,missing@example.com,123 Invalid Street\n';
  const response = await uploadCsv(client, content, 'contacts.csv');
  expect(response.status).toBe(200);
  expect(response.body.total_rows).toBe(3);
  expect(response.body.imported).toBe(0);
  expect(response.body.invalid_rows).toBe(3);
  expect(response.body.invalid_phone_numbers).toBe(1);
  expect(response.body.invalid_emails).toBe(1);
  expect(response.body.invalid_names).toBe(1);
});

test('import duplicates are skipped', async () => {
  const client = await base.register(base.uniqueUser('testuser'));
  const content = 'name,phone_number,email,address\n'
    + 'First Import,+14155550141,first@example.com,123 Duplicate Street\n'
    + 'Duplicate Phone,+14155550141,second@example.com,456 Duplicate Street\n'
    + 'Duplicate Email,+14155550142,first@example.com,789 Duplicate Street\n';
  const first = (await uploadCsv(client, content, 'contacts.csv')).body;
  const second = (await uploadCsv(client, content, 'contacts.csv')).body;
  expect(first.imported).toBe(1);
  expect(first.skipped_duplicates).toBe(2);
  expect(second.imported).toBe(0);
  expect(second.skipped_duplicates).toBe(3);
});

test('import rejects missing headers', async () => {
  const client = await base.register(base.uniqueUser('testuser'));
  const response = await uploadCsv(client, 'email,address\na@example.com,123 Street\n', 'contacts.csv');
  expect(response.status).toBe(400);
  expect(String(response.body.detail).toLowerCase()).toContain('name');
});

test('import rejects non csv and empty files', async () => {
  const client = await base.register(base.uniqueUser('testuser'));
  expect((await uploadCsv(client, 'name,phone\nTest,+14155550151\n', 'contacts.txt')).status).toBe(400);
  expect((await uploadCsv(client, '', 'empty.csv')).status).toBe(400);
});
