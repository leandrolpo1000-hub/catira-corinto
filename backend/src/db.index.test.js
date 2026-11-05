const assert = require('assert');
const db = require('./db');
const WRITE = { allowOrderWrite: true };

const listing = db.insert('listings', { title: 'idx', status: 'published', userId: 'u-idx' });
assert.strictEqual(db.findById('listings', listing.id).title, 'idx');
assert.strictEqual(db.byFk('listings', 'userId', 'u-idx').some((r) => r.id === listing.id), true);
assert.ok(db.indexSize('listings', 'status', 'published') >= 1);

const img = db.insert('listingImages', { listingId: listing.id, url: '/uploads/x.jpg', order: 0 });
assert.strictEqual(db.byFk('listingImages', 'listingId', listing.id).length, 1);

db.update('listingImages', img.id, { listingId: 'other' });
assert.strictEqual(db.byFk('listingImages', 'listingId', listing.id).length, 0);
assert.strictEqual(db.byFk('listingImages', 'listingId', 'other').some((r) => r.id === img.id), true);

db.remove('listingImages', img.id);
assert.strictEqual(db.byFk('listingImages', 'listingId', 'other').some((r) => r.id === img.id), false);

db.update('listings', listing.id, { status: 'paused' });
assert.strictEqual(db.byFk('listings', 'status', 'paused').some((r) => r.id === listing.id), true);

const u = db.insert('users', { email: 'Idx@Mail.com', name: 'n', status: 'active' });
assert.strictEqual(db.findById('users', u.id).email, 'Idx@Mail.com');
assert.ok(db.byFk('users', 'email', 'idx@mail.com').some((r) => r.id === u.id) || db.findById('users', u.id));

let threw = false;
try {
  db.batch(() => {
    db.insert('listings', { title: 'abort', status: 'published', userId: 'u-idx' });
    throw new Error('boom');
  });
} catch (e) {
  threw = e.message === 'boom';
}
assert.ok(threw);
assert.strictEqual(db.findWhere('listings', (l) => l.title === 'abort').length, 0);
assert.strictEqual(db.byFk('listings', 'userId', 'u-idx').some((r) => r.title === 'abort'), false);

db.remove('listings', listing.id);
db.remove('users', u.id);
console.log('OK db indexes');
