import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { testApp } from './helpers.js';
import { diskStorage, s3Storage } from '../src/documents/storage.js';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);
const PDF = Buffer.from('%PDF-1.7\n...');

async function setup(country = 'GH') {
  let ctx;
  // Only what the document routes use from the admin queries.
  const admin = { driverCountry: async (id) => (await ctx.users.findById(id))?.country ?? null };
  ctx = testApp({ admin });
  const make = async (role, phone, c = country) => {
    const user = await ctx.users.create({ phone, country: c, role, name: role });
    return { ...user, auth: `Bearer ${ctx.tokens.sign(user)}` };
  };
  return {
    ctx,
    driver: await make('driver', country === 'GH' ? '+233246660001' : '+4915112345678'),
    other: await make('driver', '+233246660002', 'GH'),
    admin: await make('admin', '+233246660003', 'GH'),
  };
}

const upload = (ctx, user, kind, bytes, type) => request(ctx.app).put(`/drivers/me/documents/${kind}`)
  .set('Authorization', user.auth).set('Content-Type', type).send(bytes);

test('drivers see the documents their country asks for, and upload them', async () => {
  const { ctx, driver } = await setup('GH');
  const before = await request(ctx.app).get('/drivers/me/documents').set('Authorization', driver.auth).expect(200);
  assert.deepEqual(before.body.documents.map((d) => [d.kind, d.document]), [
    ['licence', null], ['insurance', null], ['roadworthy', null], ['car_photo', null],
  ]);

  const { body } = await upload(ctx, driver, 'licence', JPEG, 'image/jpeg').expect(201);
  assert.equal(body.document.status, 'pending');
  assert.equal(body.document.contentType, 'image/jpeg');
  assert.equal(body.document.storageKey, undefined); // stays inside the API
  await upload(ctx, driver, 'insurance', PDF, 'application/pdf').expect(201);

  const after = await request(ctx.app).get('/drivers/me/documents').set('Authorization', driver.auth).expect(200);
  assert.deepEqual(after.body.documents.map((d) => d.document?.status ?? null), ['pending', 'pending', null, null]);

  const file = await request(ctx.app).get(`/drivers/me/documents/${body.document.id}/file`)
    .set('Authorization', driver.auth).expect(200);
  assert.equal(file.headers['content-type'], 'image/jpeg');
  assert.equal(file.headers['x-content-type-options'], 'nosniff');
  assert.ok(Buffer.from(file.body).equals(JPEG));
});

test('uploads must be a real photo or PDF, under 8 MB, of a document the country asks for', async () => {
  const { ctx, driver } = await setup('DE');
  await upload(ctx, driver, 'roadworthy', JPEG, 'image/jpeg').expect(404); // a Ghana document
  await upload(ctx, driver, 'passenger_permit', JPEG, 'image/jpeg').expect(201); // a Germany one
  await upload(ctx, driver, 'licence', Buffer.from('<html>'), 'text/html').expect(415);
  await upload(ctx, driver, 'licence', Buffer.from('not really a jpeg'), 'image/jpeg').expect(415);
  await upload(ctx, driver, 'licence', Buffer.alloc(0), 'image/png').expect(400);
  const big = Buffer.concat([JPEG, Buffer.alloc(8 * 1024 * 1024)]);
  await upload(ctx, driver, 'licence', big, 'image/jpeg').expect(413);
});

test('only the driver and admins can see a document', async () => {
  const { ctx, driver, other, admin } = await setup();
  const { body } = await upload(ctx, driver, 'licence', JPEG, 'image/jpeg').expect(201);
  await request(ctx.app).get(`/drivers/me/documents/${body.document.id}/file`).set('Authorization', other.auth).expect(404);
  await request(ctx.app).get(`/admin/documents/${body.document.id}/file`).set('Authorization', driver.auth).expect(403);
  await request(ctx.app).get(`/admin/documents/${body.document.id}/file`).set('Authorization', admin.auth).expect(200);
  await request(ctx.app).put('/drivers/me/documents/licence').set('Authorization', admin.auth)
    .set('Content-Type', 'image/jpeg').send(JPEG).expect(403);
});

test('admins approve or reject documents, and a rejection needs a reason the driver sees', async () => {
  const { ctx, driver, admin } = await setup();
  const licence = (await upload(ctx, driver, 'licence', JPEG, 'image/jpeg')).body.document;
  const photo = (await upload(ctx, driver, 'car_photo', JPEG, 'image/jpeg')).body.document;
  const review = (id, body) => request(ctx.app).post(`/admin/documents/${id}/review`).set('Authorization', admin.auth).send(body);

  await review(licence.id, { status: 'maybe' }).expect(400);
  await review(photo.id, { status: 'rejected' }).expect(400);
  await review(licence.id, { status: 'approved' }).expect(200);
  await review(licence.id, { status: 'rejected', reason: 'blurry' }).expect(409); // already reviewed
  const rejected = await review(photo.id, { status: 'rejected', reason: 'The number plate is not visible' }).expect(200);
  assert.equal(rejected.body.document.rejectReason, 'The number plate is not visible');

  const { body } = await request(ctx.app).get(`/admin/drivers/${driver.id}/documents`).set('Authorization', admin.auth).expect(200);
  assert.deepEqual(body.checklist.map((d) => d.document?.status ?? null), ['approved', null, null, 'rejected']);
  assert.equal(body.history.length, 2);

  // The driver uploads a better photo: the new one is what counts
  await upload(ctx, driver, 'car_photo', JPEG, 'image/jpeg').expect(201);
  const mine = await request(ctx.app).get('/drivers/me/documents').set('Authorization', driver.auth).expect(200);
  assert.equal(mine.body.documents.find((d) => d.kind === 'car_photo').document.status, 'pending');
});

test('disk storage keeps files inside its folder', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pick-docs-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const disk = diskStorage({ dir });
  await disk.put('drivers/a/licence/1.jpg', JPEG, 'image/jpeg');
  assert.deepEqual(await disk.get('drivers/a/licence/1.jpg'), { bytes: JPEG, contentType: 'image/jpeg' });
  assert.equal(await disk.get('drivers/a/licence/missing.jpg'), null);
  await assert.rejects(disk.put('../escape.jpg', JPEG, 'image/jpeg'), /bad storage key/);
  await disk.remove('drivers/a/licence/1.jpg');
  assert.equal(await disk.get('drivers/a/licence/1.jpg'), null);
});

test('S3 storage sends the right commands to the bucket', async () => {
  const sent = [];
  const client = {
    async send(cmd) {
      sent.push({ name: cmd.constructor.name, input: cmd.input });
      if (cmd.constructor.name === 'GetObjectCommand') {
        if (cmd.input.Key === 'missing') throw Object.assign(new Error('nope'), { name: 'NoSuchKey' });
        return { ContentType: 'application/pdf', Body: { transformToByteArray: async () => new Uint8Array(PDF) } };
      }
      return {};
    },
  };
  const s3 = s3Storage({ bucket: 'pick-docs', client });
  await s3.put('k1', PDF, 'application/pdf');
  assert.deepEqual(await s3.get('k1'), { bytes: PDF, contentType: 'application/pdf' });
  assert.equal(await s3.get('missing'), null);
  await s3.remove('k1');
  assert.deepEqual(sent.map((c) => [c.name, c.input.Bucket, c.input.Key]), [
    ['PutObjectCommand', 'pick-docs', 'k1'], ['GetObjectCommand', 'pick-docs', 'k1'],
    ['GetObjectCommand', 'pick-docs', 'missing'], ['DeleteObjectCommand', 'pick-docs', 'k1'],
  ]);
  assert.equal(sent[0].input.ContentType, 'application/pdf');
});
