'use strict';

const request = require('supertest');
const base = require('./base');

base.setupSuite();

test('protected contact endpoints require authentication', async () => {
  const app = base.getApp();
  expect((await request(app).get('/contacts/')).status).toBe(401);
  expect((await request(app).post('/contacts/').send(base.contactPayload())).status).toBe(401);
  expect((await request(app).get('/contacts/1')).status).toBe(401);
});

test('create, get and list contacts', async () => {
  const client = await base.register(base.uniqueUser('testuser'));
  const created = await client.post('/contacts/').send(base.contactPayload());
  expect(created.status).toBe(201);
  const contact = created.body;

  const single = await client.get(`/contacts/${contact.id}`);
  const listing = await client.get('/contacts/?page=1&limit=10');
  expect(single.status).toBe(200);
  expect(single.body.phone_number).toBe('+14155550101');
  expect(listing.status).toBe(200);
  expect(listing.body.total).toBe(1);
  expect(listing.body.items[0].id).toBe(contact.id);
  // snake_case response shape
  expect(listing.body).toHaveProperty('total_pages');
  expect(contact).toHaveProperty('phone_number');
  expect(contact).toHaveProperty('created_at');
  expect(contact.tags).toEqual([]);
});

test('create invalid contact data returns unprocessable', async () => {
  const client = await base.register(base.uniqueUser('testuser'));
  const invalid = { ...base.contactPayload(), phone_number: 'not-a-phone' };
  expect((await client.post('/contacts/').send(invalid)).status).toBe(422);
});

test('duplicate phone and email are rejected', async () => {
  const client = await base.register(base.uniqueUser('testuser'));
  expect((await client.post('/contacts/').send(base.contactPayload())).status).toBe(201);
  expect((await client.post('/contacts/').send({ ...base.contactPayload(), email: 'other@example.com' })).status).toBe(409);
  expect((await client.post('/contacts/').send({ ...base.contactPayload(), phone_number: '+14155550102' })).status).toBe(409);
});

test('update contact changes provided fields', async () => {
  const client = await base.register(base.uniqueUser('testuser'));
  const created = (await client.post('/contacts/').send(base.contactPayload())).body;
  const response = await client.put(`/contacts/${created.id}`).send({ name: 'Updated Contact', address: '456 Updated Avenue' });
  expect(response.status).toBe(200);
  expect(response.body.name).toBe('Updated Contact');
  expect(response.body.address).toBe('456 Updated Avenue');
  // Untouched fields preserved
  expect(response.body.phone_number).toBe('+14155550101');
});

test('delete contact and missing contact', async () => {
  const client = await base.register(base.uniqueUser('testuser'));
  const created = (await client.post('/contacts/').send(base.contactPayload())).body;
  expect((await client.delete(`/contacts/${created.id}`)).status).toBe(200);
  expect((await client.get(`/contacts/${created.id}`)).status).toBe(404);
  expect((await client.delete('/contacts/999999')).status).toBe(404);
});

test('search and pagination', async () => {
  const client = await base.register(base.uniqueUser('testuser'));
  for (let i = 0; i < 12; i++) {
    const letter = String.fromCharCode('A'.charCodeAt(0) + i);
    const p = {
      name: `Search Person ${letter}`,
      phone_number: `+1415555${String(1000 + i).padStart(4, '0')}`,
      email: `search${i}@example.com`,
      address: '123 Search Street',
    };
    expect((await client.post('/contacts/').send(p)).status).toBe(201);
  }
  const page = (await client.get('/contacts/?page=2&limit=10')).body;
  const search = (await client.get('/contacts/?page=1&limit=10&search=Search Person A')).body;
  expect(page.page).toBe(2);
  expect(page.limit).toBe(10);
  expect(page.total).toBe(12);
  expect(page.items.length).toBe(2);
  expect(page.total_pages).toBe(2);
  expect(search.total).toBe(1);
  expect(search.items[0].name).toBe('Search Person A');
});

test('invalid pagination returns unprocessable', async () => {
  const client = await base.register(base.uniqueUser('testuser'));
  expect((await client.get('/contacts/?page=0&limit=10')).status).toBe(422);
  expect((await client.get('/contacts/?page=1&limit=101')).status).toBe(422);
});

test('users cannot access each others contacts', async () => {
  const first = await base.register(base.uniqueUser('first'));
  const created = (await first.post('/contacts/').send(base.contactPayload())).body;
  await first.post('/auth/logout');

  const second = await base.register({ username: 'second-user', email: 'second-user@example.com', password: 'StrongPass123!' });
  const listing = (await second.get('/contacts/?page=1&limit=10')).body;
  expect((await second.get(`/contacts/${created.id}`)).status).toBe(404);
  expect((await second.put(`/contacts/${created.id}`).send({ name: 'Hijacked Contact' })).status).toBe(404);
  expect((await second.delete(`/contacts/${created.id}`)).status).toBe(404);
  expect(listing.total).toBe(0);
});

test('contact field validation rules', async () => {
  const client = await base.register(base.uniqueUser('testuser'));
  // bad name
  expect((await client.post('/contacts/').send({ ...base.contactPayload(), phone_number: '+14155550155', email: 'a1@example.com', name: '1bad' })).status).toBe(422);
  // bad email
  expect((await client.post('/contacts/').send({ ...base.contactPayload(), phone_number: '+14155550156', email: 'nope' })).status).toBe(422);
  // bad address (no letter)
  expect((await client.post('/contacts/').send({ ...base.contactPayload(), phone_number: '+14155550157', email: 'a2@example.com', address: '12345' })).status).toBe(422);
  // optional email/address may be omitted
  const minimal = await client.post('/contacts/').send({ name: 'Minimal Person', phone_number: '+14155550158' });
  expect(minimal.status).toBe(201);
  expect(minimal.body.email).toBeNull();
  expect(minimal.body.address).toBeNull();
});
