const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const UPLOADS = path.join(__dirname, '..', 'uploads');
const THUMBS = path.join(UPLOADS, 'thumbs');

const TINY_JPEG = Buffer.from(
  'ffd8ffdb00430006040506050406060506070706080a100a0a09090a140e0f0c1017141818171416161a1d251f1a1b231c1616202c20232627292a29191f2d302d283025282928ffdb0043010707070a080a130a0a13281a161a2828282828282828282828282828282828282828282828282828282828282828282828282828282828282828282828282828ffc00011080006000803012200021101031101ffc4001500010100000000000000000000000000000006ffc40014100100000000000000000000000000000000ffc4001501010100000000000000000000000000000507ffc40014110100000000000000000000000000000000ffda000c03010002110311003f008a0002b6ffd9',
  'hex'
);

async function run() {
  const { ensureThumb } = require('./thumbs');
  const name = 't5-' + randomUUID();
  const original = path.join(UPLOADS, name + '.jpg');
  fs.writeFileSync(original, TINY_JPEG);
  const urlPath = '/uploads/' + name + '.jpg';
  const thumbUrl = await ensureThumb(original, urlPath);
  assert.ok(thumbUrl, 'returns thumb url');
  assert.strictEqual(thumbUrl, '/uploads/thumbs/' + name + '.jpg');
  const dest = path.join(THUMBS, name + '.jpg');
  assert.ok(fs.existsSync(dest), 'wrote thumb jpeg');
  assert.ok(fs.existsSync(original), 'original not deleted');
  assert.ok(fs.readFileSync(original).equals(TINY_JPEG), 'original bytes unchanged');

  const remote = 'http://example.com/photo.jpg';
  assert.strictEqual(await ensureThumb('/tmp/missing.jpg', remote), remote, 'http url is used as thumb');

  const missing = await ensureThumb(path.join(UPLOADS, 'no-such-' + randomUUID() + '.jpg'), '/uploads/no-such.jpg');
  assert.strictEqual(missing, null, 'missing original returns null');

  const db = require('./db');
  const helpers = require('./helpers');
  const listing = db.insert('listings', {
    userId: 't5',
    title: '[TESTE] thumbs backfill',
    status: 'published',
    price: 1,
    createdAt: new Date().toISOString(),
  });
  const img = db.insert('listingImages', { listingId: listing.id, url: urlPath, order: 0 });
  const mapped = helpers.imagesOf(listing.id);
  assert.strictEqual(mapped[0].url, urlPath);
  assert.strictEqual(mapped[0].thumbUrl, '/uploads/thumbs/' + name + '.jpg');
  assert.strictEqual(db.findById('listingImages', img.id).thumbUrl, '/uploads/thumbs/' + name + '.jpg');

  const httpImg = db.insert('listingImages', {
    listingId: listing.id,
    url: 'https://cdn.example.com/x.jpg',
    order: 1,
  });
  const mappedHttp = helpers.imagesOf(listing.id);
  const row = mappedHttp.find((i) => i.id === httpImg.id);
  assert.strictEqual(row.thumbUrl, 'https://cdn.example.com/x.jpg');
  assert.ok(!db.findById('listingImages', httpImg.id).thumbUrl);

  console.log('OK thumbs tests');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
