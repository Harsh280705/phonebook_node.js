'use strict';

const request = require('supertest');
const base = require('./base');

base.setupSuite();

async function createTag(client, name) {
  const r = await client.post('/tags/').send({ name });
  if (r.status !== 201) throw new Error(`createTag failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.id;
}

async function createTaggedContact(client, name, phone, email, tagIds) {
  const r = await client.post('/contacts/').send({ name, phone_number: phone, email, address: '123 Test Street', tag_ids: tagIds });
  if (r.status !== 201) throw new Error(`createTaggedContact failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.id;
}

test('protected tag endpoints require authentication', async () => {
  const app = base.getApp();
  expect((await request(app).get('/tags/')).status).toBe(401);
  expect((await request(app).post('/tags/').send({ name: 'Work' })).status).toBe(401);
});

test('create, list, update and delete tags', async () => {
  const client = await base.register(base.uniqueUser('testuser'));
  const created = await client.post('/tags/').send({ name: ' Family ' });
  expect(created.status).toBe(201);
  expect(created.body.name).toBe('Family');

  const listing = await client.get('/tags/');
  expect(listing.status).toBe(200);
  expect(listing.body.length).toBe(1);
  expect(listing.body[0].id).toBe(created.body.id);

  const updated = await client.put(`/tags/${created.body.id}`).send({ name: 'Personal' });
  expect(updated.status).toBe(200);
  expect(updated.body.name).toBe('Personal');

  expect((await client.delete(`/tags/${created.body.id}`)).status).toBe(200);
  expect((await client.get('/tags/')).body.length).toBe(0);
  expect((await client.delete('/tags/999999')).status).toBe(404);
});

test('duplicate and invalid tag names are rejected', async () => {
  const client = await base.register(base.uniqueUser('testuser'));
  expect((await client.post('/tags/').send({ name: 'Work' })).status).toBe(201);
  expect((await client.post('/tags/').send({ name: 'work' })).status).toBe(409);
  expect((await client.post('/tags/').send({ name: '' })).status).toBe(422);
  expect((await client.post('/tags/').send({ name: 'bad,name' })).status).toBe(422);
});

test('assign multiple tags to contacts and clear them', async () => {
  const client = await base.register(base.uniqueUser('testuser'));
  const work = await createTag(client, 'Work');
  const family = await createTag(client, 'Family');

  const created = await client.post('/contacts/').send({
    name: 'Tagged Contact', phone_number: '+14155550101', email: 'tagged@example.com', address: '123 Test Street', tag_ids: [work, family],
  });
  expect(created.status).toBe(201);
  expect(created.body.tags.length).toBe(2);

  const updated = await client.put(`/contacts/${created.body.id}`).send({ tag_ids: [work] });
  expect(updated.status).toBe(200);
  expect(updated.body.tags.length).toBe(1);
  expect(updated.body.tags[0].name).toBe('Work');

  const cleared = await client.put(`/contacts/${created.body.id}`).send({ tag_ids: [] });
  expect(cleared.body.tags.length).toBe(0);
});

test('update without tag_ids leaves tags unchanged', async () => {
  const client = await base.register(base.uniqueUser('testuser'));
  const work = await createTag(client, 'Work');
  const created = (await client.post('/contacts/').send({
    name: 'Tagged Contact', phone_number: '+14155550101', email: 'tagged@example.com', address: '123 Test Street', tag_ids: [work],
  })).body;
  const updated = await client.put(`/contacts/${created.id}`).send({ name: 'Tagged Contact Updated' });
  expect(updated.status).toBe(200);
  expect(updated.body.name).toBe('Tagged Contact Updated');
  expect(updated.body.tags.length).toBe(1);
  expect(updated.body.tags[0].id).toBe(work);
});

test('filter contacts by tags and combine with text search', async () => {
  const client = await base.register(base.uniqueUser('testuser'));
  const work = await createTag(client, 'Work');
  const family = await createTag(client, 'Family');
  await createTaggedContact(client, 'Alice Work', '+14155551001', 'alice-work@example.com', [work]);
  await createTaggedContact(client, 'Alice Family', '+14155551002', 'alice-family@example.com', [family]);
  await createTaggedContact(client, 'Bob Both', '+14155551003', 'bob-both@example.com', [work, family]);

  const byWork = (await client.get(`/contacts/?page=1&limit=10&tag_ids=${work}`)).body;
  const byBoth = (await client.get(`/contacts/?page=1&limit=10&tag_ids=${work}&tag_ids=${family}`)).body;
  const combined = (await client.get(`/contacts/?page=1&limit=10&search=Alice&tag_ids=${work}`)).body;
  const paged = (await client.get(`/contacts/?page=1&limit=1&tag_ids=${work}`)).body;

  expect(byWork.total).toBe(2);
  expect(byBoth.total).toBe(1);
  expect(byBoth.items[0].name).toBe('Bob Both');
  expect(combined.total).toBe(1);
  expect(combined.items[0].name).toBe('Alice Work');
  expect(paged.total).toBe(2);
  expect(paged.items.length).toBe(1);
  expect(paged.total_pages).toBe(2);
});

test('users cannot access each others tags or assign them', async () => {
  const first = await base.register(base.uniqueUser('first'));
  const firstTag = await createTag(first, 'Secret');
  const firstContact = await createTaggedContact(first, 'First Person', '+14155552001', 'first-person@example.com', [firstTag]);
  await first.post('/auth/logout');

  const second = await base.register(base.uniqueUser('second'));
  expect((await second.get('/tags/')).body.length).toBe(0);
  expect((await second.put(`/tags/${firstTag}`).send({ name: 'Stolen' })).status).toBe(404);
  expect((await second.delete(`/tags/${firstTag}`)).status).toBe(404);

  const ownTag = await createTag(second, 'Mine');
  expect((await second.post('/contacts/').send({
    name: 'Second Person', phone_number: '+14155552002', email: 'second-person@example.com', address: '123 Test Street', tag_ids: [firstTag],
  })).status).toBe(400);

  const ownContact = await createTaggedContact(second, 'Second Person', '+14155552002', 'second-person@example.com', [ownTag]);
  expect((await second.put(`/contacts/${ownContact}`).send({ tag_ids: [firstTag] })).status).toBe(400);

  expect((await second.get(`/contacts/?page=1&limit=10&tag_ids=${firstTag}`)).body.total).toBe(0);
  expect((await second.get(`/contacts/${firstContact}`)).status).toBe(404);
});
