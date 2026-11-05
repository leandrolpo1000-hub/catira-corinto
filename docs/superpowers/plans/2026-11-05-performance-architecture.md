# Performance Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **DO NOT START until the human explicitly authorizes Phase 5.** This file is planning only.

**Goal:** Cut CPU per listing request, cap admin payloads, serve card thumbnails, and stop chatty frontend fetches — without changing commercial rules or leaving RAM.

**Architecture:** In-process Maps kept in lockstep with `db.insert/update/remove`; `serializeListing` reads those Maps; admin and user lists paginate; JPEG 400px thumbs; lazy routes and 60s config TTL. SQLite document store stays.

**Tech Stack:** Node `DatabaseSync`, Express, React 18, Vite 6, `sharp` (thumbs only).

## Global Constraints

- No code until explicit Phase 5 authorization.
- Skip every Commit step. Do not git add/commit/push.
- Do not rewrite Appmax, Pix EMV, VIP, Mercado Livre import/sync, `commercialReady`.
- `GET /api/orders` and checkout session list/get stay 403 for the client.
- Do not cache payments, orders, balances, Pix keys, Appmax tokens.
- Do not delete originals, tables, or data.
- Preserve Intelligence event types, `DEDUPE_MS`, `ETERNAL`, flags, and dashboard meaning.
- `serializeListing` JSON fields stay the same.
- No new frontend library. Backend may add `sharp` only.
- Home editorial limits stay 8 / 6 / 5.
- Do not start a new long-running server unless asked.
- Do not run full `npm test` (pre-existing Vosk / chat Maria).

**Spec:** `docs/superpowers/specs/2026-11-05-performance-architecture-design.md`

---

### Task 1: Baseline (measure only)

**Files:** none (notes go in the implementer report).

**Interfaces:** none.

- [ ] **Step 1: Record environment**

```bash
node -v
free -m | head -2
```

- [ ] **Step 2: Time boot and RSS after seed**

With the existing backend process, or one started only if none is up: note RSS (`ps -o rss= -p <pid>`) and whether `ensureHeavyDemo` already ran (`seed.heavy` counts). Do not re-seed production data. Do not delete the sqlite file.

- [ ] **Step 3: Time two GETs**

```bash
# JSON only; 10 requests each; record min / p50 / p95
for i in 1 2 3 4 5 6 7 8 9 10; do
  curl -s -o /dev/null -w '%{time_total}\n' http://127.0.0.1:3001/api/listings?limit=20
done
```

Admin listings requires a master JWT. If login is available (`admin@catira.com`), time `GET /api/admin/listings` the same way. If not, write “admin baseline skipped (no token)” — do not invent numbers.

- [ ] **Step 4: Commit**

Skip.

**Acceptance:** report contains machine, node, RSS, listing timings. No source change.

---

### Task 2: In-memory indexes in `db.js`

**Files:**
- Modify: `backend/src/db.js`
- Create: `backend/src/db.index.test.js`
- Test: `backend/src/db.clone.test.js` (must still pass), `backend/src/db.persist.test.js`, `backend/src/db.isolate.test.js`

**Interfaces:**
- Produces: `db.findById(table, id)` via Map; `db.byFk(table, field, value) => rec[]`; `db.indexSize(table, field, value) => number`; `db.rebuildIndexes()`
- FK fields: `listingImages.listingId`, `listingLikes.listingId`, `listingComments.listingId`, `listingReviews.listingId`, `favorites.listingId`, `favorites.userId`, `listings.userId`, `listings.status`, `payments.listingId`, `messages.conversationId`
- Extra: `users` by lowercase `email`

- [ ] **Step 1: Write failing tests**

Create `backend/src/db.index.test.js`:

```js
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
```

- [ ] **Step 2: Run — expect FAIL** (`byFk` is not a function)

```bash
cd /workspace/backend && node src/db.index.test.js
```

- [ ] **Step 3: Implement indexes in `db.js`**

After `let cache = null`, add Maps and helpers. Keep arrays as source of truth.

```js
const FK_INDEX = {
  listingImages: ['listingId'],
  listingLikes: ['listingId'],
  listingComments: ['listingId'],
  listingReviews: ['listingId'],
  favorites: ['listingId', 'userId'],
  listings: ['userId', 'status'],
  payments: ['listingId'],
  messages: ['conversationId'],
};

let byId = new Map();
let byFk = new Map();
let usersByEmail = new Map();

function fkKey(table, field) {
  return table + ':' + field;
}

function bucket(table, field, value) {
  const k = fkKey(table, field);
  if (!byFk.has(k)) byFk.set(k, new Map());
  const m = byFk.get(k);
  const id = value == null ? '' : String(value);
  if (!m.has(id)) m.set(id, []);
  return m.get(id);
}

function indexInsert(table, rec) {
  if (!rec || rec.id == null) return;
  if (!byId.has(table)) byId.set(table, new Map());
  byId.get(table).set(String(rec.id), rec);
  const fields = FK_INDEX[table] || [];
  for (let i = 0; i < fields.length; i++) {
    bucket(table, fields[i], rec[fields[i]]).push(rec);
  }
  if (table === 'users' && rec.email) usersByEmail.set(String(rec.email).toLowerCase(), rec);
}

function indexRemove(table, rec) {
  if (!rec || rec.id == null) return;
  const ids = byId.get(table);
  if (ids) ids.delete(String(rec.id));
  const fields = FK_INDEX[table] || [];
  for (let i = 0; i < fields.length; i++) {
    const arr = bucket(table, fields[i], rec[fields[i]]);
    const idx = arr.indexOf(rec);
    if (idx >= 0) arr.splice(idx, 1);
  }
  if (table === 'users' && rec.email) {
    const k = String(rec.email).toLowerCase();
    if (usersByEmail.get(k) === rec) usersByEmail.delete(k);
  }
}

function rebuildIndexes() {
  byId = new Map();
  byFk = new Map();
  usersByEmail = new Map();
  const tables = Object.keys(cache || {});
  for (let t = 0; t < tables.length; t++) {
    const list = cache[tables[t]] || [];
    for (let i = 0; i < list.length; i++) indexInsert(tables[t], list[i]);
  }
}
```

Call `rebuildIndexes()` at the end of `boot()` (after `cache = loadFromSqlite()`), `reload()`, `reset()` (after `writeAll`), and in `batch` catch after `cache = snapshot`.

Change `findById`:

```js
function findById(table, id) {
  if (id == null) return null;
  const rec = byId.get(table) && byId.get(table).get(String(id));
  if (!rec) return null;
  if (isProtectedTable(table)) return structuredClone(rec);
  return rec;
}
```

Change `insert` to `indexInsert(table, rec)` after push; `remove` to `indexRemove` before splice using the existing rec; `removeWhere` to `indexRemove` for each deleted rec.

`update`: take `prev`, build `next`, `indexRemove(table, prev)`, assign `list[idx] = next`, `indexInsert(table, next)`.

Export:

```js
function byFkLookup(table, field, value) {
  const k = fkKey(table, field);
  const m = byFk.get(k);
  if (!m) return [];
  return m.get(value == null ? '' : String(value)) || [];
}
function indexSize(table, field, value) {
  return byFkLookup(table, field, value).length;
}
```

For `users` email, `byFkLookup('users', 'email', lower)` may read `usersByEmail` if you do not put email in `FK_INDEX`. Either is fine if tests pass. Prefer `usersByEmail` Map as specified.

- [ ] **Step 4: Run tests**

```bash
cd /workspace/backend && node src/db.index.test.js && node src/db.clone.test.js && node src/db.persist.test.js && node src/db.isolate.test.js
```

Expected: all OK / exit 0.

- [ ] **Step 5: Commit**

Skip.

---

### Task 3: `serializeListing` uses indexes

**Files:**
- Modify: `backend/src/helpers.js` (`imagesOf`, `listingRating`, `listingSocialOf`, `listingPayment` once, `favoritesCount`, `sellerScore`)
- Modify: `backend/src/middleware.js` (`listingsCount` in `safeUser` / `publicUser`)
- Modify: `backend/src/routes/listings.js` (`applyFilters` findById already O(1); `findSellers` count via index)
- Test: `backend/src/search.test.js`, `backend/src/listingSocial.test.js`, `backend/src/official.test.js`

**Interfaces:**
- Consumes: `db.byFk`, `db.indexSize`, `db.findById`
- Produces: same `serializeListing` keys as today

- [ ] **Step 1: Assert paymentStatus still uses one payment lookup**

Add to `backend/src/listingSocial.test.js` or a tiny `helpers.serialize.test.js`: serialize a listing as owner and as stranger; stranger `paymentStatus === ''`; owner gets the payment status; `images` still sorted by `order`.

- [ ] **Step 2: Run existing tests once (GREEN baseline)**

```bash
cd /workspace/backend && node src/search.test.js && node src/listingSocial.test.js && node src/official.test.js
```

- [ ] **Step 3: Replace scans**

`imagesOf`:

```js
function imagesOf(listingId) {
  return db.byFk('listingImages', 'listingId', listingId).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
}
```

`listingRating` / `listingSocialOf`: `db.byFk` on reviews / likes / comments.

`serializeListing` payment block — call `listingPayment` once:

```js
const pay = (viewer && (viewer.id === l.userId || isAdminRole(viewer.role))) ? listingPayment(l.id) : null;
// paymentStatus: pay ? (pay.status || '') : ''
// paymentDeclaredAt: pay ? (pay.userDeclaredAt || null) : null
```

`favoritesCount`: `db.indexSize('favorites', 'listingId', l.id)`.

`publicUser` / `safeUser` `listingsCount`:

```js
listingsCount: db.byFk('listings', 'userId', u.id).filter((l) => l.status === 'published').length,
```

`sellerScore`: listings via `db.byFk('listings', 'userId', user.id)`; favorites via `indexSize`.

`findSellers`: published via `db.byFk('listings', 'status', 'published')` (then skip official as today).

`listingPayment`: `db.byFk('payments', 'listingId', listingId)` instead of `findWhere`.

- [ ] **Step 4: Re-run**

```bash
cd /workspace/backend && node src/search.test.js && node src/listingSocial.test.js && node src/official.test.js && node src/db.index.test.js
```

Expected: pass. JSON fields unchanged.

- [ ] **Step 5: Commit**

Skip.

---

### Task 4: Shared pagination helper + admin lists

**Files:**
- Create: `backend/src/pagination.js`
- Create: `frontend/src/pageSize.js`
- Modify: `backend/src/routes/admin.js` (users, listings, reports, publications, payments, reviews)
- Modify: `backend/src/orders.js` `listOrdersAdmin` + admin GET
- Modify: `backend/src/routes/action.js` admin ação
- Modify: `backend/src/official.js` `listProducts` admin
- Modify: `frontend/src/pages/Admin.jsx` (fetch per tab, page=)
- Create: `backend/src/admin.page.test.js`

**Interfaces:**
- Produces: `{ items, total, page, limit }`
- Defaults: page 1, limit 20, max 50
- Consumes Task 3 serialize (slice then serialize)

`pagination.js`:

```js
function pageParams(query, defaults) {
  const max = (defaults && defaults.max) || 50;
  const fallback = (defaults && defaults.limit) || 20;
  const page = Math.max(1, parseInt((query && query.page) || '1', 10) || 1);
  const limit = Math.min(max, Math.max(1, parseInt((query && query.limit) || String(fallback), 10) || fallback));
  return { page, limit, start: (page - 1) * limit };
}

function pageSlice(list, query, defaults) {
  const { page, limit, start } = pageParams(query, defaults);
  const total = list.length;
  return { items: list.slice(start, start + limit), total, page, limit };
}

module.exports = { pageParams, pageSlice };
```

`frontend/src/pageSize.js`:

```js
export const PAGE = {
  admin: 20,
  search: 20,
  favorites: 20,
  notices: 15,
};
```

- [ ] **Step 1: Failing admin page test**

```js
const assert = require('assert');
const db = require('./db');
// HTTP against app if the suite already boots express; otherwise unit-test pageSlice
const { pageSlice } = require('./pagination');
const rows = Array.from({ length: 45 }, (_, i) => ({ id: i }));
const p1 = pageSlice(rows, { page: '1' });
assert.strictEqual(p1.items.length, 20);
assert.strictEqual(p1.total, 45);
assert.strictEqual(p1.page, 1);
const p3 = pageSlice(rows, { page: '3' });
assert.strictEqual(p3.items.length, 5);
console.log('OK pagination');
```

Then a route-level check: GET `/api/admin/listings` as master returns `items.length <= 20` and numeric `total`. Follow how `search.test.js` boots the app.

- [ ] **Step 2: RED then implement `pagination.js` and wire admin GETs**

Filter/sort **then** `pageSlice` **then** `serializeListing` / `publicUser` on `items` only.

Users: `listingsCount` via Task 3 index, not `db.count` per row.

- [ ] **Step 3: Admin.jsx fetch per `tab`**

Remove the mount block that fires 11 list GETs (`Admin.jsx` ~109-145). Replace with effects:

- `tab === 'users'` → `/api/admin/users?page=&limit=20&q=&status=`
- `tab === 'ads'` → listings
- `tab === 'pays'` → payments
- `tab === 'pedidos'` → orders
- `tab === 'rep'` → reports
- `tab === 'rev'` → reviews
- `tab === 'acao'` → acao
- `tab === 'rel'` → publications
- `tab === 'dash'` → dashboard + cities + categories if needed
- pix/mail/appmax/banner/assist only on those tabs

Keep local filter inputs: send `q`/`status` as query params (backend already supports several). Add “Ver mais” or page buttons using `total`.

Do not load Official/Lance/Auctions here (already tab-gated children).

- [ ] **Step 4: Tests**

```bash
cd /workspace/backend && node src/admin.page.test.js && node src/search.test.js && node src/orders.test.js
```

`orders.test.js` must still see public GET `/api/orders` → 403.

Frontend: `cd /workspace/frontend && npm run build`

- [ ] **Step 5: Commit**

Skip.

---

### Task 5: Thumbnails

**Files:**
- Modify: `backend/package.json` — add `sharp` (global install rule: `npm install -g sharp` if the environment requires global; also add to backend `dependencies` so `require('sharp')` resolves)
- Create: `backend/src/thumbs.js`
- Modify: `backend/src/routes/listings.js` create/update image insert
- Modify: `backend/src/helpers.js` `imagesOf` to include `thumbUrl: img.thumbUrl || img.url`
- Modify: `frontend/src/components.jsx` `ListingCard` / `ListingRow`
- Modify: `frontend/src/pages/Home.jsx` / `Search.jsx` only if they use raw `item.images[0].url` instead of the card components
- Create: `backend/src/thumbs.test.js`

**Interfaces:**
- `ensureThumb(absOriginalPath, urlPath) => thumbUrl | null`
- Disk: `backend/uploads/thumbs/<basename>.jpg`
- Size: 400px max side, JPEG 0.72
- Remote `http` URLs: do not download; `thumbUrl = url`

- [ ] **Step 1: Failing test** — `ensureThumb` on a tiny generated JPEG writes `/uploads/thumbs/…jpg` and does not delete the original.

- [ ] **Step 2: Implement `thumbs.js` with `sharp`. On failure return null.**

On listing image insert after multer: call `ensureThumb`, set `thumbUrl`.

On `imagesOf`, map `{ ...img, url: img.url, thumbUrl: img.thumbUrl || img.url }` without leaking extra private fields if serialize already copies a subset — follow current `imagesOf` return shape (today it returns full image records). Add `thumbUrl` on that object.

Lazy backfill: inside `imagesOf`, if `!img.thumbUrl` and `img.url` starts with `/uploads/` and the file exists, generate and `db.update('listingImages', img.id, { thumbUrl })`. Skip if url is `http`.

- [ ] **Step 3: Cards**

```jsx
const img = item.images?.[0]?.thumbUrl || item.images?.[0]?.url;
{img && <img src={img} alt={item.title} width={400} height={300} loading="lazy" />}
```

Home first row: first 4 `ListingCard`s may omit `loading="lazy"` if easy (optional). PDP (`Listing.jsx`, `OfficialProduct.jsx`) keeps original `url`.

- [ ] **Step 4: Tests + build**

```bash
cd /workspace/backend && node src/thumbs.test.js && node src/search.test.js
cd /workspace/frontend && npm run build
```

- [ ] **Step 5: Commit**

Skip.

---

### Task 6: Frontend chatter + code splitting + search 20

**Files:**
- Modify: `frontend/src/App.jsx` (`React.lazy` / `Suspense`)
- Modify: `frontend/src/config.jsx` (TTL 60s, drop `pathname` dep)
- Modify: `frontend/src/components.jsx` Layout notices (60s interval, not pathname)
- Modify: `frontend/src/pages/Search.jsx` (`PAGE_SIZE = 20`, debounce 300ms on price)
- Modify: `frontend/src/pages/Catiras.jsx` (`PAGE_SIZE = 20`)
- Modify: `frontend/src/pages/Home.jsx` skeleton CSS class if missing
- Modify: `frontend/src/searchLayout.test.mjs` if it greps `24`

**Interfaces:** none beyond `PAGE.search = 20`.

- [ ] **Step 1: Update greps that require `limit=24` / `PAGE_SIZE = 24` to 20.** Run RED.

- [ ] **Step 2: `App.jsx`**

```jsx
import { lazy, Suspense } from 'react';
const Admin = lazy(() => import('./pages/Admin'));
const Checkout = lazy(() => import('./pages/Checkout'));
// Auction, LanceHub, Action, IntelligentCreate likewise
// Keep Home, Search, Listing, Auth, Profile static
```

Wrap `Routes` in `<Suspense fallback={<p>Carregando...</p>}>`.

- [ ] **Step 3: ConfigProvider** — `loadedAt` ref; fetch if older than 60_000 ms; listen `visibilitychange`. Remove `loc.pathname` from deps (can remove `useLocation`).

- [ ] **Step 4: Notices effect deps `[user, auctionEnabled]` plus `setInterval(60000)`.** Skip extra fetch when `pathname === '/perfil'` still ok.

- [ ] **Step 5: Search price** — local state on change; `setTimeout(apply, 300)` debounce; clear timeout on unmount.

- [ ] **Step 6:**

```bash
cd /workspace/frontend && node --test src/searchLayout.test.mjs src/officialProduct.test.mjs src/checkout.test.mjs && npm run build
```

- [ ] **Step 7: Commit**

Skip.

---

### Task 7: Ranking cache 30s

**Files:**
- Modify: `backend/src/helpers.js` (`rankedSellers`, `rankOf`)
- Modify: callers that change listing status / favorites / reviews — invalidate
- Test: `backend/src/search.test.js` or new `ranking.cache.test.js`

**Interfaces:**
- `rankedSellers()` returns cached array if `Date.now() - rankingBuiltAt < 30_000`
- `invalidateRanking()` exported

Invalidate on: listing status update to/from published/sold/traded, favorite add/remove, listing review insert, user block. Do **not** invalidate on view.

Do not change score weights.

- [ ] **Step 1–4:** test that two calls within 30s return the same array reference (or same rank snapshot); after `invalidateRanking` a new computation runs; GET `/api/ranking?limit=5` still slices after compute.

- [ ] **Step 5: Commit**

Skip.

---

### Task 8: Views buffer + intelligence dedupe Map

**Files:**
- Modify: `backend/src/routes/listings.js` GET `/:id` views
- Modify: `backend/src/intelligence.js` (`dedupeHit`, `trackEvent`, `buildDashboard` series)
- Modify: `backend/src/db.js` `close()` flush hook or `listings.js` interval
- Test: `backend/src/intelligence.test.js` (must stay green)

**Interfaces:**
- `pendingViews: Map<listingId, number>`
- Flush every 5s or 50 increments; also on `close` / `exit`
- Dedupe Map key `` `${type}:${actorHash}:${listingId||query||''}` ``
- Buffer **only** `view` and `search` (2s). ETERNAL + payment/order events stay synchronous.
- `period=all` in dashboard treated as 365 days
- `buildDashboard` series from `intelligenceDaily`; rankings still from filtered events

GET listing response `views` = stored + pending.

Do not skip `trackEvent('view')`; only stop scanning all events for dedupe.

- [ ] **Step 1:** extend intelligence tests: two views same actor inside 30 min still dedupe; `payment_confirmed` still inserts immediately (count events +1).

- [ ] **Step 2–4:** implement; run `node src/intelligence.test.js && node src/search.test.js && node src/orders.test.js`

- [ ] **Step 5: Commit**

Skip.

---

### Task 9: Paginate remaining user lists

**Files:**
- Modify: `backend/src/routes/listings.js` GET `/mine`
- Modify: `backend/src/routes/social.js` favorites, conversations (list only), GET `/users/:id` listings
- Modify: `backend/src/routes/lance.js` hub, mine (not seller detail)
- Modify: `frontend/src/pages/More.jsx`, `LanceHub.jsx` — `page`/`Ver mais`, `PAGE.favorites = 20`
- Conversations **messages** (`GET /:id`): slice last 100 for this task (cursor later if needed). Do not drop send/react.

**Interfaces:** same `{ items, total, page, limit }` where the route already returns `{ items }`.

Do not paginate GET `/api/orders` (403). Do not change Appmax.

- [ ] **Step 1–4:** backend tests if they grep full mine arrays; frontend build; `listingSocial.test.js` / `lance.test.js`.

- [ ] **Step 5: Commit**

Skip.

---

### Task 10: Guard + re-measure

**Files:** none unless a bug in 1–9.

- [ ] **Step 1: Guard**

```bash
# still 403
# still serializeListing fields (search.test)
# Appmax name= attributes
# no commercialReady true
# GET /api/listings still has total,page,limit,items
```

- [ ] **Step 2: Re-run**

```bash
cd /workspace/backend && node src/db.index.test.js && node src/db.clone.test.js && node src/search.test.js && node src/listingSocial.test.js && node src/official.test.js && node src/intelligence.test.js && node src/orders.test.js && node src/admin.page.test.js && node src/thumbs.test.js && node src/seed.heavy.test.js
cd /workspace/frontend && node --test src/*.test.mjs && npm run build
```

- [ ] **Step 3: Repeat Task 1 timings.** Write before/after in the report. Do not claim success without numbers.

- [ ] **Step 4: Commit**

Skip.

---

## Spec coverage

| Spec section | Task |
|---|---|
| Maps + sync + batch rebuild | 2 |
| serializeListing O(1) | 3 |
| Admin page 20 + per-tab fetch | 4 |
| Thumbs 400 JPEG | 5 |
| Split, config TTL, notices, debounce, PAGE 20 | 6 |
| Ranking 30s | 7 |
| Views buffer, dedupe Map, daily series | 8 |
| mine/favs/chat/lance/users | 9 |
| Baseline + after | 1, 10 |
| Postgres criteria | spec only — no task |
| Appmax / Pix / VIP / ML / orders 403 | constraints — no task |

## Placeholder scan

None. Limits, TTLs, sizes, file paths, and function names are explicit.

## Type consistency

- `byFk(table, field, value)` / `indexSize` defined in Task 2, used in 3–4.
- `{ items, total, page, limit }` Task 4, reused Task 9.
- `thumbUrl` Task 5.
- `PAGE.search = 20` Task 6.
- `invalidateRanking` Task 7.
- `pendingViews` Task 8.

## Rollback

Each task is independently revertable (git checkout of touched files). Indexes: delete Maps and restore `.find` — arrays untouched. Thumbs: leftover JPEG files in `uploads/thumbs/` are harmless; originals remain. Pagination: old clients that ignore `total` still read `items`.
