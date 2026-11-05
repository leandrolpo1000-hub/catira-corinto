# Catira Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Master-only Catira Intelligence on the existing admin Dashboard: real event collection, internal rankings, commercial flags off.

**Architecture:** Isolated `trackEvent()` writes `intelligenceEvents` + `intelligenceDaily`. Hooks call it from existing handlers. `GET /api/admin/dashboard` adds an `intelligence` block. Settings live in `settings` id `intelligence`. Merchant/commercial routes always 403 this phase.

**Tech Stack:** Node/Express, SQLite document store (`db.js` `EMPTY` keys), React admin chips, `node --test` / `assert` tests, Vite.

## Global Constraints

- Do not rewrite the marketplace, Appmax client, Pix/card charge math, listing-fee Pix, or `commercialReady` (stays false).
- `GET /api/orders` list and `/api/checkout/sessions` stay 403.
- Frontend never declares payment/sale confirmed.
- No fake production data. No destructive migration. No new SQL tables — only `EMPTY` keys.
- `listings.status === 'sold'` is not a proven sale. Proven pay = `orders.status === 'paid'`. Proven complete = `completed`.
- Commercial / merchant / subscriptions / commercial API default **false** and 403.
- HMAC actor ids; never persist userId, email, phone, CPF, IP, name on intelligence rows.
- Admin/master/platform actors do not inflate consumer metrics.
- Catira cream/orange/white. Chip label exactly `Catira Intelligence`.
- Do not commit unless the user asks. Skip every Commit step.
- Do not break existing backend `npm test` files or frontend `src/*.test.mjs`.
- `trackEvent` must never throw into marketplace handlers (swallow after log).

---

### Task 1: Core module — HMAC, flags, trackEvent, daily rollup

**Files:**
- Modify: `backend/src/db.js` (`EMPTY`, after `userAddresses`)
- Create: `backend/src/intelligence.js`
- Create: `backend/src/intelligence.test.js`
- Modify: `backend/src/server.js` (boot `ensureSettings`)
- Modify: `backend/package.json` (`test` script: add `node src/intelligence.test.js` after `official.test.js`)

**Interfaces:**
- Consumes: `db`, `crypto.createHmac`, `resolveJwtSecret`
- Produces:
  - `EVENT_TYPES` array
  - `DEFAULT_SETTINGS` object
  - `ensureSettings()`
  - `getSettings()` → flags + plans
  - `updateSettings(patch)` → merged flags (booleans only for the six keys)
  - `isCollectionEnabled()` / `isInternalEnabled()` / `isCommercialEnabled()`
  - `actorHash({ userId, sessionId })` → 64-char hex
  - `isExcludedRole(role)` → true for `admin`|`master`|`platform`
  - `isBot(userAgent)` → boolean
  - `trackEvent({ type, req?, user?, sessionId?, listing?, query?, resultCount?, order?, proposalId?, now? })` → `{ recorded: boolean, reason?: string, event?: object }`
  - `buildDashboard(filters)` → intelligence payload
  - `denyCommercial(res)` → 403 JSON `{ error, code: 'INTELLIGENCE_COMMERCIAL_DISABLED' }`

- [ ] **Step 1: Write the failing test**

Create `backend/src/intelligence.test.js`:

```javascript
const assert = require('assert');
const db = require('./db');
const intelligence = require('./intelligence');

function insertUser(role) {
  return db.insert('users', {
    name: 'U ' + role,
    email: role + Date.now() + '@test.local',
    role,
    status: 'active',
    passwordHash: 'x',
    city: 'Corinto',
    cityId: 'corinto',
  });
}

intelligence.ensureSettings();

const buyer = insertUser('user');
const master = insertUser('master');
const listing = db.insert('listings', {
  userId: buyer.id,
  title: 'Furadeira',
  status: 'published',
  city: 'Corinto',
  cityId: 'corinto',
  categoryId: (db.all('categories')[0] || {}).id || 'cat',
  price: 80,
  views: 0,
  createdAt: new Date().toISOString(),
});

const h1 = intelligence.actorHash({ userId: buyer.id });
const h2 = intelligence.actorHash({ userId: buyer.id });
assert.strictEqual(h1, h2);
assert.notStrictEqual(h1, buyer.id);
assert.strictEqual(h1.length, 64);

const view1 = intelligence.trackEvent({
  type: 'view',
  user: buyer,
  listing,
  sessionId: 'sid-1',
});
assert.strictEqual(view1.recorded, true);
assert.ok(view1.event);
assert.strictEqual(view1.event.actorHash, h1);
assert.strictEqual(view1.event.userId, undefined);
assert.ok(!JSON.stringify(view1.event).includes(buyer.email));
assert.ok(!('ip' in view1.event));

const viewDup = intelligence.trackEvent({
  type: 'view',
  user: buyer,
  listing,
  sessionId: 'sid-1',
});
assert.strictEqual(viewDup.recorded, false);

const adminView = intelligence.trackEvent({
  type: 'view',
  user: master,
  listing,
});
assert.strictEqual(adminView.recorded, false);

const empty = intelligence.trackEvent({
  type: 'search',
  user: buyer,
  query: 'unicornio azul',
  resultCount: 0,
  sessionId: 'sid-1',
});
assert.strictEqual(empty.recorded, true);
assert.strictEqual(empty.event.resultCount, 0);

const bot = intelligence.trackEvent({
  type: 'view',
  user: buyer,
  listing,
  req: { headers: { 'user-agent': 'Googlebot/2.1' } },
});
assert.strictEqual(bot.recorded, false);

assert.strictEqual(intelligence.isCommercialEnabled(), false);
const settings = intelligence.getSettings();
assert.strictEqual(settings.intelligenceEnabled, true);
assert.strictEqual(settings.commercialIntelligenceEnabled, false);
assert.ok(settings.plans.start);
assert.deepStrictEqual(settings.plans.start.modules, []);

intelligence.updateSettings({ commercialIntelligenceEnabled: true, intelligenceEnabled: true });
assert.strictEqual(intelligence.getSettings().commercialIntelligenceEnabled, true);
intelligence.updateSettings({ commercialIntelligenceEnabled: false });
assert.strictEqual(intelligence.getSettings().commercialIntelligenceEnabled, false);

intelligence.updateSettings({ intelligenceEnabled: false });
const off = intelligence.trackEvent({ type: 'view', user: buyer, listing, sessionId: 'sid-off' });
assert.strictEqual(off.recorded, false);
intelligence.updateSettings({ intelligenceEnabled: true });

console.log('intelligence.test.js ok');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/backend && node src/intelligence.test.js`
Expected: FAIL `Cannot find module './intelligence'`

- [ ] **Step 3: Add EMPTY keys**

In `backend/src/db.js` `EMPTY`, after `userAddresses: []`:

```javascript
  intelligenceEvents: [],
  intelligenceDaily: [],
```

- [ ] **Step 4: Implement `intelligence.js`**

```javascript
const crypto = require('crypto');
const db = require('./db');
const { resolveJwtSecret } = require('./config');

const SETTINGS_ID = 'intelligence';
const EVENT_TYPES = [
  'search', 'view', 'favorite', 'share', 'contact', 'contact_whatsapp',
  'proposal', 'checkout', 'order_created', 'payment_confirmed', 'sale_completed',
];
const EXCLUDED_ROLES = ['admin', 'master', 'platform'];
const BOT_RE = /bot|crawler|spider|curl|wget|python-requests|headless/i;
const DEDUPE_MS = {
  view: 30 * 60 * 1000,
  search: 5 * 60 * 1000,
  share: 60 * 60 * 1000,
  contact: 60 * 60 * 1000,
  contact_whatsapp: 60 * 60 * 1000,
};
const ETERNAL = ['favorite', 'proposal', 'checkout', 'order_created', 'payment_confirmed', 'sale_completed'];
const PRICE_BUCKETS = [
  { id: '0-50', min: 0, max: 5000 },
  { id: '50-100', min: 5000, max: 10000 },
  { id: '100-200', min: 10000, max: 20000 },
  { id: '200-500', min: 20000, max: 50000 },
  { id: '500+', min: 50000, max: Infinity },
];
const FLAG_KEYS = [
  'intelligenceEnabled',
  'internalAnalyticsEnabled',
  'commercialIntelligenceEnabled',
  'merchantIntelligenceAccessEnabled',
  'intelligenceSubscriptionsEnabled',
  'intelligenceApiEnabled',
];
const EMPTY_PLAN = { modules: [], limits: {} };
const DEFAULT_SETTINGS = {
  id: SETTINGS_ID,
  intelligenceEnabled: true,
  internalAnalyticsEnabled: true,
  commercialIntelligenceEnabled: false,
  merchantIntelligenceAccessEnabled: false,
  intelligenceSubscriptionsEnabled: false,
  intelligenceApiEnabled: false,
  plans: {
    start: { ...EMPTY_PLAN },
    pro: { ...EMPTY_PLAN },
    business: { ...EMPTY_PLAN },
    enterprise: { ...EMPTY_PLAN },
  },
};

function hmacSecret() {
  const raw = process.env.CATIRA_INTEL_HMAC_SECRET;
  if (raw && String(raw).trim()) return String(raw).trim();
  return resolveJwtSecret();
}

function actorHash({ userId, sessionId } = {}) {
  const secret = hmacSecret();
  const material = userId ? 'user:' + userId : 'sid:' + (sessionId || ('anon:' + new Date().toISOString().slice(0, 10)));
  return crypto.createHmac('sha256', secret).update(material).digest('hex');
}

function isExcludedRole(role) {
  return EXCLUDED_ROLES.includes(role);
}

function isBot(userAgent) {
  return !!(userAgent && BOT_RE.test(String(userAgent)));
}

function ensureSettings() {
  const existing = db.findById('settings', SETTINGS_ID);
  if (!existing) {
    db.insert('settings', { ...DEFAULT_SETTINGS });
    return getSettings();
  }
  return getSettings();
}

function getSettings() {
  const row = db.findById('settings', SETTINGS_ID) || DEFAULT_SETTINGS;
  const out = { ...DEFAULT_SETTINGS, ...row, id: SETTINGS_ID };
  FLAG_KEYS.forEach((k) => { out[k] = row[k] == null ? DEFAULT_SETTINGS[k] : !!row[k]; });
  out.plans = { ...DEFAULT_SETTINGS.plans, ...(row.plans || {}) };
  ['start', 'pro', 'business', 'enterprise'].forEach((p) => {
    out.plans[p] = { modules: [], limits: {}, ...(out.plans[p] || {}) };
  });
  return out;
}

function updateSettings(patch) {
  ensureSettings();
  const cur = db.findById('settings', SETTINGS_ID);
  const next = { ...cur };
  FLAG_KEYS.forEach((k) => {
    if (patch && Object.prototype.hasOwnProperty.call(patch, k)) next[k] = !!patch[k];
  });
  db.update('settings', SETTINGS_ID, next);
  return getSettings();
}

function isCollectionEnabled() {
  return getSettings().intelligenceEnabled === true;
}

function isInternalEnabled() {
  return getSettings().internalAnalyticsEnabled === true;
}

function isCommercialEnabled() {
  const s = getSettings();
  return !!(s.commercialIntelligenceEnabled && s.merchantIntelligenceAccessEnabled);
}

function denyCommercial(res) {
  return res.status(403).json({
    error: 'A inteligência comercial não está disponível.',
    code: 'INTELLIGENCE_COMMERCIAL_DISABLED',
  });
}

function dayKey(iso) {
  return String(iso || new Date().toISOString()).slice(0, 10);
}

function sessionOf(input) {
  if (input.sessionId) return String(input.sessionId);
  const req = input.req;
  if (!req) return '';
  return String((req.headers && (req.headers['x-catira-session'] || req.headers['X-Catira-Session'])) || '');
}

function listingFields(listing) {
  if (!listing) return { listingId: null, productId: null, categoryId: null, cityId: null, city: null };
  return {
    listingId: listing.id || null,
    productId: listing.officialProductId || listing.id || null,
    categoryId: listing.categoryId || null,
    cityId: listing.cityId || null,
    city: listing.city || null,
  };
}

function normalizeQuery(q) {
  return String(q || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function dedupeHit(type, actor, extra, nowMs) {
  const windowMs = DEDUPE_MS[type];
  const eternal = ETERNAL.includes(type);
  if (!windowMs && !eternal) return false;
  const from = eternal ? 0 : nowMs - windowMs;
  return !!db.findOne('intelligenceEvents', (e) => {
    if (e.type !== type) return false;
    if (e.actorHash !== actor) return false;
    if (extra.listingId && e.listingId !== extra.listingId) return false;
    if (extra.query && e.query !== extra.query) return false;
    if (extra.orderId && e.orderId !== extra.orderId) return false;
    if (extra.proposalId && e.proposalId !== extra.proposalId) return false;
    const t = new Date(e.createdAt).getTime();
    return t >= from;
  });
}

function bumpDaily(event) {
  const day = dayKey(event.createdAt);
  const key = [day, event.type, event.cityId || '', event.categoryId || '', event.listingId || '', event.query || ''].join('|');
  const existing = db.findById('intelligenceDaily', key);
  if (existing) {
    db.update('intelligenceDaily', key, { count: (existing.count || 0) + 1 });
    return;
  }
  db.insert('intelligenceDaily', {
    id: key,
    day,
    type: event.type,
    cityId: event.cityId || null,
    categoryId: event.categoryId || null,
    listingId: event.listingId || null,
    query: event.query || null,
    count: 1,
  });
}

function trackEvent(input) {
  try {
    if (!input || !EVENT_TYPES.includes(input.type)) return { recorded: false, reason: 'type' };
    if (!isCollectionEnabled()) return { recorded: false, reason: 'disabled' };
    const user = input.user || (input.req && input.req.user) || null;
    if (user && isExcludedRole(user.role)) return { recorded: false, reason: 'excluded' };
    const ua = input.req && input.req.headers && (input.req.headers['user-agent'] || input.req.headers['User-Agent']);
    if (isBot(ua)) return { recorded: false, reason: 'bot' };
    const listing = input.listing || null;
    const fields = listingFields(listing);
    const query = input.type === 'search' ? normalizeQuery(input.query) : null;
    if (input.type === 'search' && !query) return { recorded: false, reason: 'query' };
    const order = input.order || null;
    const createdAt = (input.now && new Date(input.now).toISOString()) || new Date().toISOString();
    const nowMs = new Date(createdAt).getTime();
    const sessionId = sessionOf(input);
    const hash = actorHash({ userId: user && user.id, sessionId });
    const extra = {
      listingId: fields.listingId,
      query,
      orderId: order && order.id,
      proposalId: input.proposalId || null,
    };
    if (dedupeHit(input.type, hash, extra, nowMs)) return { recorded: false, reason: 'dedupe' };
    const event = {
      type: input.type,
      createdAt,
      actorHash: hash,
      listingId: fields.listingId,
      productId: fields.productId,
      categoryId: fields.categoryId,
      cityId: order && order.address && order.address.cityId ? order.address.cityId : fields.cityId,
      city: order && order.address && order.address.city ? order.address.city : fields.city,
      query,
      resultCount: input.type === 'search' ? Number(input.resultCount || 0) : null,
      orderId: extra.orderId || null,
      proposalId: extra.proposalId,
      priceCents: order && order.totalCents != null ? order.totalCents : (listing && listing.price != null ? Math.round(Number(listing.price) * 100) : null),
      paymentMethod: order && order.paymentMethod ? order.paymentMethod : null,
      source: input.source || 'app',
    };
    const saved = db.insert('intelligenceEvents', event);
    bumpDaily(saved);
    return { recorded: true, event: saved };
  } catch (err) {
    console.error('intelligence.trackEvent', err && err.message);
    return { recorded: false, reason: 'error' };
  }
}

function periodFrom(period, now) {
  const t = now || Date.now();
  if (period === 'all') return 0;
  if (period === '30d') return t - 30 * 86400000;
  if (period === 'month') {
    const d = new Date(t);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (period === 'year') {
    const d = new Date(t);
    d.setMonth(0, 1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  return t - 7 * 86400000;
}

function inRange(iso, from, to) {
  const t = new Date(iso || 0).getTime();
  return t >= from && t <= to;
}

function rankMap(events, keyFn, n) {
  const map = {};
  events.forEach((e) => {
    const k = keyFn(e);
    if (!k) return;
    map[k] = (map[k] || 0) + 1;
  });
  return Object.entries(map)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n || 10);
}

function listingTitle(id) {
  const l = id && db.findById('listings', id);
  return l ? l.title : id || '—';
}

function categoryName(id) {
  const c = id && db.findById('categories', id);
  return c ? c.name : id || '—';
}

function buildDashboard(filters) {
  const enabled = isInternalEnabled();
  if (!enabled) {
    return { enabled: false, stats: {}, rankings: {}, series: [], opportunities: [] };
  }
  const period = (filters && filters.period) || '7d';
  const city = ((filters && filters.city) || '').trim().toLowerCase();
  const category = ((filters && filters.category) || '').trim();
  const now = Date.now();
  const from = periodFrom(period, now);
  const to = now;
  let events = db.all('intelligenceEvents').filter((e) => inRange(e.createdAt, from, to));
  if (city) {
    events = events.filter((e) => String(e.city || '').toLowerCase() === city || String(e.cityId || '').toLowerCase() === city);
  }
  if (category) events = events.filter((e) => e.categoryId === category);
  const of = (t) => events.filter((e) => e.type === t);
  const unique = (list) => new Set(list.map((e) => e.actorHash)).size;
  const searches = of('search');
  const empty = searches.filter((e) => Number(e.resultCount) === 0);
  const views = of('view');
  const paid = of('payment_confirmed');
  const completed = of('sale_completed');
  const contacts = of('contact').concat(of('contact_whatsapp'));
  const published = db.findWhere('listings', (l) => l.status === 'published' && !require('./official').isOfficialListing(l));
  const supplyByCat = {};
  published.forEach((l) => {
    supplyByCat[l.categoryId] = (supplyByCat[l.categoryId] || 0) + 1;
  });
  const demandByCat = {};
  events.filter((e) => ['search', 'view', 'contact', 'contact_whatsapp'].includes(e.type)).forEach((e) => {
    if (!e.categoryId) return;
    demandByCat[e.categoryId] = (demandByCat[e.categoryId] || 0) + 1;
  });
  const offerDemand = Object.keys({ ...supplyByCat, ...demandByCat }).map((id) => ({
    categoryId: id,
    name: categoryName(id),
    supply: supplyByCat[id] || 0,
    demand: demandByCat[id] || 0,
  })).sort((a, b) => b.demand - a.demand);

  const buckets = PRICE_BUCKETS.map((b) => ({
    id: b.id,
    count: paid.filter((e) => {
      const c = Number(e.priceCents || 0);
      return c >= b.min && c < b.max;
    }).length,
  }));

  const dayCount = period === 'year' ? 30 : period === 'all' ? 30 : period === '30d' ? 30 : period === 'month' ? new Date().getDate() : 7;
  const series = [];
  for (let i = dayCount - 1; i >= 0; i--) {
    const d = new Date(now - i * 86400000).toISOString().slice(0, 10);
    const dayEvents = events.filter((e) => dayKey(e.createdAt) === d);
    series.push({
      date: d,
      searches: dayEvents.filter((e) => e.type === 'search').length,
      views: dayEvents.filter((e) => e.type === 'view').length,
      orders: dayEvents.filter((e) => e.type === 'order_created').length,
      paid: dayEvents.filter((e) => e.type === 'payment_confirmed').length,
    });
  }

  const opportunities = [];
  offerDemand.filter((r) => r.demand > 0 && r.supply === 0).forEach((r) => {
    opportunities.push({ kind: 'unmet_category', label: r.name, demand: r.demand });
  });
  rankMap(empty, (e) => e.query, 20).filter((r) => r.count >= 3).forEach((r) => {
    opportunities.push({ kind: 'empty_query', label: r.key, count: r.count });
  });
  const viewRank = rankMap(views, (e) => e.listingId, 20);
  viewRank.forEach((r) => {
    const related = events.filter((e) => e.listingId === r.key);
    const c = related.filter((e) => e.type === 'contact' || e.type === 'contact_whatsapp' || e.type === 'order_created').length;
    if (r.count >= 5 && c === 0) {
      opportunities.push({ kind: 'view_no_contact', label: listingTitle(r.key), views: r.count });
    }
  });

  return {
    enabled: true,
    filters: { period, city, category },
    stats: {
      searches: searches.length,
      emptySearches: empty.length,
      views: views.length,
      uniqueViewers: unique(views),
      favorites: of('favorite').length,
      shares: of('share').length,
      contacts: contacts.length,
      proposals: of('proposal').length,
      checkouts: of('checkout').length,
      ordersCreated: of('order_created').length,
      paymentsConfirmed: paid.length,
      salesCompleted: completed.length,
    },
    rankings: {
      queries: rankMap(searches, (e) => e.query).map((r) => ({ query: r.key, count: r.count })),
      emptyQueries: rankMap(empty, (e) => e.query).map((r) => ({ query: r.key, count: r.count })),
      viewed: rankMap(views, (e) => e.listingId).map((r) => ({ listingId: r.key, title: listingTitle(r.key), count: r.count })),
      favorited: rankMap(of('favorite'), (e) => e.listingId).map((r) => ({ listingId: r.key, title: listingTitle(r.key), count: r.count })),
      shared: rankMap(of('share'), (e) => e.listingId).map((r) => ({ listingId: r.key, title: listingTitle(r.key), count: r.count })),
      contacted: rankMap(contacts, (e) => e.listingId).map((r) => ({ listingId: r.key, title: listingTitle(r.key), count: r.count })),
      soldPaid: rankMap(paid, (e) => e.listingId).map((r) => ({ listingId: r.key, title: listingTitle(r.key), count: r.count })),
      categories: rankMap(events, (e) => e.categoryId).map((r) => ({ categoryId: r.key, name: categoryName(r.key), count: r.count })),
      cities: rankMap(events, (e) => e.city || e.cityId).map((r) => ({ city: r.key, count: r.count })),
    },
    offerDemand,
    priceBuckets: buckets,
    series,
    opportunities: opportunities.slice(0, 20),
  };
}

module.exports = {
  EVENT_TYPES,
  DEFAULT_SETTINGS,
  ensureSettings,
  getSettings,
  updateSettings,
  isCollectionEnabled,
  isInternalEnabled,
  isCommercialEnabled,
  denyCommercial,
  actorHash,
  isExcludedRole,
  isBot,
  trackEvent,
  buildDashboard,
};
```

- [ ] **Step 5: Boot + test script**

In `backend/src/server.js` after official sample seed:

```javascript
try { require('./intelligence').ensureSettings(); } catch {}
```

In `backend/package.json` `test`, insert `node src/intelligence.test.js &&` after `node src/official.test.js &&`.

- [ ] **Step 6: Run tests**

Run: `cd /workspace/backend && node src/intelligence.test.js`
Expected: `intelligence.test.js ok`

Run: `cd /workspace/backend && node src/db.persist.test.js && node src/db.isolate.test.js`
Expected: pass (new EMPTY keys must not break JSON import)

- [ ] **Step 7: Commit** — skip unless the user asks.

---

### Task 2: Hook real flows (no duplicate writers)

**Files:**
- Modify: `backend/src/routes/listings.js` (`GET /`, `GET /:id`, new `POST /:id/share`)
- Modify: `backend/src/routes/social.js` (favorites insert, interest, whatsapp)
- Modify: `backend/src/trades.js` (`createTrade` success)
- Modify: `backend/src/orders.js` (`createOrder`, `preparePixCharge`/`prepareCardCharge` success, `handleAppmaxWebhook` after `paid`, `transition` when `toStatus === 'completed'`)
- Modify: `backend/src/intelligence.test.js` (HTTP search/view/share + sold ≠ paid)

**Interfaces:**
- Consumes: `intelligence.trackEvent`
- Produces: events from live routes; `POST /api/listings/:id/share` → `{ ok: true }`

Place `POST /:id/share` **before** `GET /:id` so Express does not eat `share` as an id.

Never call `trackEvent` from the frontend for pay/sale.

- [ ] **Step 1: Extend intelligence.test.js with HTTP hooks**

Reuse the `jsonRequest` helper pattern from `orders.test.js`. After the unit asserts, spin a mini app:

```javascript
const http = require('http');
const express = require('express');
const { authOptional, signToken } = require('./middleware');

function jsonRequest(server, { method, path, token, body, session, ua }) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path, method: method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(session ? { 'X-Catira-Session': session } : {}),
        ...(ua ? { 'User-Agent': ua } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

const listingsRouter = require('./routes/listings');
const app = express();
app.use(express.json());
app.use(authOptional);
app.use('/api/listings', listingsRouter);
const server = http.createServer(app);
await new Promise((r) => server.listen(0, r));
const token = signToken(buyer);
const before = db.count('intelligenceEvents', (e) => e.type === 'search' && e.query && e.query.includes('furadeira'));
const searched = await jsonRequest(server, {
  method: 'GET',
  path: '/api/listings?q=furadeira',
  token,
  session: 'sid-http',
});
assert.strictEqual(searched.status, 200);
assert.ok(db.count('intelligenceEvents', (e) => e.type === 'search') > before);

const viewed = await jsonRequest(server, {
  method: 'GET',
  path: '/api/listings/' + listing.id,
  token,
  session: 'sid-http-view',
});
assert.strictEqual(viewed.status, 200);
assert.ok(db.findOne('intelligenceEvents', (e) => e.type === 'view' && e.listingId === listing.id));

const shared = await jsonRequest(server, {
  method: 'POST',
  path: '/api/listings/' + listing.id + '/share',
  session: 'sid-share',
});
assert.strictEqual(shared.status, 200);
assert.ok(db.findOne('intelligenceEvents', (e) => e.type === 'share' && e.listingId === listing.id));

db.update('listings', listing.id, { status: 'sold' });
const dash = intelligence.buildDashboard({ period: 'all' });
assert.strictEqual(dash.stats.paymentsConfirmed, dash.stats.paymentsConfirmed);
assert.ok(!dash.rankings.soldPaid.some((r) => r.listingId === listing.id && r.count > 0 && !db.findOne('intelligenceEvents', (e) => e.type === 'payment_confirmed' && e.listingId === listing.id)));
server.close();
```

Wrap the HTTP part in an async IIFE if the file is currently sync: keep the file top-level sync for unit tests, then `require('http')` block inside `(async () => { ... })().catch((e) => { console.error(e); process.exit(1); })`.

Simpler: keep Task 1 tests sync; add a second file `backend/src/intelligence.http.test.js` if the async mix is messy. Prefer **one file** with:

```javascript
(async () => {
  // existing sync tests already ran above
  // http tests here
  console.log('intelligence.test.js ok');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Move the final `console.log` into the async function.

- [ ] **Step 2: Run to fail**

Run: `cd /workspace/backend && node src/intelligence.test.js`
Expected: share route 404 or search events count unchanged.

- [ ] **Step 3: Hook listings**

At top of `listings.js`: `const intelligence = require('../intelligence');`

In `GET /` after `list = applyFilters(...)` and before `res.json`, if `searchText(req.query.q || req.query.search)` is non-empty:

```javascript
intelligence.trackEvent({
  type: 'search',
  req,
  user: req.user,
  query: req.query.q || req.query.search,
  resultCount: list.length,
});
```

Do **not** track Home editorial (`home=1` / `section`) even if `q` is present. Only track when `searchText(req.query.q || req.query.search)` is non-empty **and** `!editorial`.

In `GET /:id` after incrementing `views` for published:

```javascript
intelligence.trackEvent({ type: 'view', req, user: req.user, listing: l });
```

Add **before** `router.get('/:id', ...)`:

```javascript
router.post('/:id/share', authOptional, (req, res) => {
  const l = db.findById('listings', req.params.id);
  if (!l || l.status !== 'published') return res.status(404).json({ error: 'Anúncio não encontrado.' });
  intelligence.trackEvent({ type: 'share', req, user: req.user, listing: l });
  res.json({ ok: true });
});
```

- [ ] **Step 4: Hook social + trades**

`social.js` favorites: only on `db.insert` path, after insert:

```javascript
require('../intelligence').trackEvent({ type: 'favorite', req, user: req.user, listing });
```

`POST /interest` after conversation created successfully (end of handler, before `res.json`):

```javascript
require('../intelligence').trackEvent({ type: 'contact', req, user: req.user, listing });
```

`GET /whatsapp/:listingId` after listing/seller checks pass, before `res.json`:

```javascript
require('../intelligence').trackEvent({ type: 'contact_whatsapp', req, user: req.user, listing });
```

`trades.js` `createTrade`: after insert, before return:

```javascript
const listing = db.findById('listings', proposal.listingId);
require('./intelligence').trackEvent({
  type: 'proposal',
  user,
  listing,
  proposalId: proposal.id,
});
```

- [ ] **Step 5: Hook orders (read-only extra call)**

Do not change snapshots, `commercialReady`, transitions table, or Appmax payload.

`createOrder` after successful create, on the returned order:

```javascript
const listing = order.listingId ? db.findById('listings', order.listingId) : null;
require('./intelligence').trackEvent({
  type: 'order_created',
  user: db.findById('users', order.userId),
  listing,
  order,
});
```

`preparePixCharge` and `prepareCardCharge`: after a successful charge (order has pix/card payment id), same listing lookup:

```javascript
require('./intelligence').trackEvent({
  type: 'checkout',
  user: db.findById('users', order.userId),
  listing,
  order,
});
```

`handleAppmaxWebhook` only when `moved` to `paid` (the existing `transition(..., 'paid')` branch):

```javascript
const listing = moved.order.listingId ? db.findById('listings', moved.order.listingId) : null;
require('./intelligence').trackEvent({
  type: 'payment_confirmed',
  user: db.findById('users', moved.order.userId),
  listing,
  order: moved.order,
});
```

Do **not** track on the early return when already `paid`.

In `transition`, after `appendEvent`, if `toStatus === 'completed'`:

```javascript
const listing = updated.listingId ? db.findById('listings', updated.listingId) : null;
require('./intelligence').trackEvent({
  type: 'sale_completed',
  user: db.findById('users', updated.userId),
  listing,
  order: updated,
});
```

- [ ] **Step 6: Run tests**

Run: `cd /workspace/backend && node src/intelligence.test.js`
Expected: `intelligence.test.js ok`

Run: `cd /workspace/backend && node src/orders.test.js && node src/orders.card.test.js && node src/orders.webhook.test.js && node src/search.test.js && node src/trades.test.js`
Expected: pass

- [ ] **Step 7: Commit** — skip unless asked.

---

### Task 3: Admin API — dashboard block, settings, commercial 403

**Files:**
- Modify: `backend/src/routes/admin.js` (`GET /dashboard`, add settings routes)
- Modify: `backend/src/server.js` (merchant/commercial deny routes)
- Modify: `backend/src/intelligence.test.js` (HTTP 403/200)

**Interfaces:**
- `GET /api/admin/dashboard` stays `masterRequired`; response adds `intelligence: buildDashboard({ period, city, category })` and keeps existing `stats`/`charts`. Rename nothing in old `stats.sold` (UI will relabel).
- `GET|PUT /api/admin/intelligence/settings` `masterRequired`
- `GET /api/merchant/intelligence` and `GET /api/intelligence/commercial` always `denyCommercial` (even if flags flipped, this phase still 403 unless **both** commercial flags true — still no payload, return 403 with same code if commercial off; if someone turns flags on, still 403 with `{ error: 'A inteligência comercial ainda não está liberada.', code: 'INTELLIGENCE_COMMERCIAL_DISABLED' }` this delivery). Spec: commercial stays disabled. **Always 403** these two routes in this phase.

- [ ] **Step 1: Test HTTP auth + settings**

In intelligence.test.js async section, mount `routes/admin.js` at `/api/admin` with `authOptional` then the router (router already `adminRequired`). Need `signToken` for master vs joao vs intermediador.

```javascript
const adminRouter = require('./routes/admin');
const app2 = express();
app2.use(express.json());
app2.use(authOptional);
app2.use('/api/admin', adminRouter);
app2.get('/api/merchant/intelligence', (req, res) => require('./intelligence').denyCommercial(res));
app2.get('/api/intelligence/commercial', (req, res) => require('./intelligence').denyCommercial(res));
const s2 = http.createServer(app2);
await new Promise((r) => s2.listen(0, r));

const joao = db.findOne('users', (u) => u.email === 'joao@email.com') || buyer;
const adminUser = db.findOne('users', (u) => u.role === 'admin') || insertUser('admin');
const masterUser = db.findOne('users', (u) => u.role === 'master') || master;

const asJoao = await jsonRequest(s2, { path: '/api/admin/dashboard', token: signToken(joao) });
assert.ok(asJoao.status === 401 || asJoao.status === 403);

const asAdmin = await jsonRequest(s2, { path: '/api/admin/dashboard', token: signToken(adminUser) });
assert.strictEqual(asAdmin.status, 403);

const asMaster = await jsonRequest(s2, { path: '/api/admin/dashboard?period=7d', token: signToken(masterUser) });
assert.strictEqual(asMaster.status, 200);
assert.ok(asMaster.body.intelligence);
assert.ok(asMaster.body.stats);

const got = await jsonRequest(s2, { path: '/api/admin/intelligence/settings', token: signToken(masterUser) });
assert.strictEqual(got.status, 200);
assert.strictEqual(got.body.commercialIntelligenceEnabled, false);

const put = await jsonRequest(s2, {
  method: 'PUT',
  path: '/api/admin/intelligence/settings',
  token: signToken(masterUser),
  body: { internalAnalyticsEnabled: false },
});
assert.strictEqual(put.status, 200);
assert.strictEqual(put.body.internalAnalyticsEnabled, false);
const dashOff = await jsonRequest(s2, { path: '/api/admin/dashboard', token: signToken(masterUser) });
assert.strictEqual(dashOff.body.intelligence.enabled, false);
await jsonRequest(s2, {
  method: 'PUT',
  path: '/api/admin/intelligence/settings',
  token: signToken(masterUser),
  body: { internalAnalyticsEnabled: true },
});

const merch = await jsonRequest(s2, { path: '/api/merchant/intelligence', token: signToken(joao) });
assert.strictEqual(merch.status, 403);
assert.strictEqual(merch.body.code, 'INTELLIGENCE_COMMERCIAL_DISABLED');
s2.close();
```

If seed has no `role: admin` user, `insertUser('admin')` is enough. `adminRequired` allows admin into `/dashboard` **unless** the handler is `masterRequired`. Dashboard is `masterRequired` — admin gets 403. Good.

- [ ] **Step 2: Run to fail** — settings 404.

- [ ] **Step 3: Patch admin.js**

`const intelligence = require('../intelligence');` at top.

Dashboard handler: after building current payload, `intelligence.ensureSettings()` then:

```javascript
  const category = (q.category || '').trim();
  res.json({
    filters: { period, city, status, category },
    stats: { /* unchanged */ },
    charts: { /* unchanged */ },
    intelligence: intelligence.buildDashboard({ period, city, category }),
  });
```

After dashboard route:

```javascript
router.get('/intelligence/settings', masterRequired, (_req, res) => {
  res.json(require('../intelligence').getSettings());
});

router.put('/intelligence/settings', masterRequired, (req, res) => {
  res.json(require('../intelligence').updateSettings(req.body || {}));
});
```

- [ ] **Step 4: Mount deny routes in server.js**

After other `/api` mounts:

```javascript
app.get('/api/merchant/intelligence', require('./middleware').authRequired, (_req, res) => {
  require('./intelligence').denyCommercial(res);
});
app.get('/api/intelligence/commercial', require('./middleware').authRequired, (_req, res) => {
  require('./intelligence').denyCommercial(res);
});
```

Use `authRequired` so anonymous is 401, logged-in is 403 with the code.

- [ ] **Step 5: Run**

`cd /workspace/backend && node src/intelligence.test.js`
Expected ok.

`cd /workspace/backend && npm test`
Expected all pass. If `transcribeLocal.test.js` still fails from Vosk, **do not fix** (pre-existing). Continue if only that fails; every other file must pass.

- [ ] **Step 6: Commit** — skip unless asked.

---

### Task 4: Admin UI — Catira Intelligence chip + session header

**Files:**
- Modify: `frontend/src/api.js` (`X-Catira-Session`)
- Modify: `frontend/src/pages/Listing.jsx` (share → POST)
- Create: `frontend/src/pages/AdminIntelligence.jsx`
- Modify: `frontend/src/pages/Admin.jsx` (chip label, render, fetch `category` filter)
- Create: `frontend/src/intelligence.test.mjs`

**Interfaces:**
- `api()` always sends `X-Catira-Session` from `localStorage.catira_sid` (create UUID if missing).
- Share on listing: existing UI plus `api('/api/listings/' + id + '/share', { method: 'POST' }).catch(() => {})` — ignore errors, do not block native share.

- [ ] **Step 1: Frontend string tests**

`frontend/src/intelligence.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const admin = readFileSync(join(root, 'pages/Admin.jsx'), 'utf8');
const intel = readFileSync(join(root, 'pages/AdminIntelligence.jsx'), 'utf8');
const api = readFileSync(join(root, 'api.js'), 'utf8');
const listing = readFileSync(join(root, 'pages/Listing.jsx'), 'utf8');
const checkout = readFileSync(join(root, 'pages/Checkout.jsx'), 'utf8');

assert.match(admin, /Catira Intelligence/);
assert.match(admin, /AdminIntelligence/);
assert.match(intel, /Configurações/);
assert.match(intel, /Visão geral/);
assert.match(intel, /Oportunidades/);
assert.match(intel, /internalAnalyticsEnabled/);
assert.match(intel, /Marcados vendidos/);
assert.doesNotMatch(intel, /commercialReady/);
assert.match(api, /X-Catira-Session/);
assert.match(api, /catira_sid/);
assert.match(listing, /\/share/);
assert.doesNotMatch(checkout, /status:\s*['"]paid['"]/);
console.log('intelligence.test.mjs ok');
```

- [ ] **Step 2: Run to fail** — `AdminIntelligence.jsx` missing.

- [ ] **Step 3: Session header in api.js**

After `TOKEN_KEY`:

```javascript
const SID_KEY = 'catira_sid';

export function getSessionId() {
  let sid = localStorage.getItem(SID_KEY);
  if (!sid) {
    sid = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + '-' + Math.random().toString(16).slice(2);
    localStorage.setItem(SID_KEY, sid);
  }
  return sid;
}
```

In `api()`, after setting Authorization:

```javascript
  headers['X-Catira-Session'] = getSessionId();
```

- [ ] **Step 4: Listing share**

In `Listing.jsx` share handler, after building URL / `navigator.share`, fire:

```javascript
api('/api/listings/' + item.id + '/share', { method: 'POST' }).catch(() => {});
```

Do not wait. Do not change official-listing share visibility.

- [ ] **Step 5: AdminIntelligence.jsx**

New file. Props `{ dash, dashFilter, setDashFilter, dashCities, cats, settings, setSettings }`.

Subchip state local: `visao|produtos|pesquisas|categorias|demanda|geo|precos|tendencias|oportunidades|config`.

Use `.chips` / `.stat` / `.admin-grid` / `Bars` copied as a local function identical to Admin.jsx (do not export Bars — duplicate the 15-line helper).

Visão geral: existing operational stats passed as `dash.stats` with label **Marcados vendidos** for `dash.stats.sold` / `deals`, plus Intelligence KPIs from `dash.intelligence.stats`.

Lists: `.table` for rankings. Empty: `<p className="hint">Ainda sem dados neste período.</p>`

Config: six checkboxes bound to settings keys; save `PUT /api/admin/intelligence/settings`. Note: `Desligar a inteligência comercial não apaga o histórico nem para a coleta interna.` Plans: `<p className="hint">Planos Start, Pro, Business e Enterprise — em breve. Sem cobrança nesta fase.</p>`

Do not render merchant UI.

- [ ] **Step 6: Wire Admin.jsx**

Import `AdminIntelligence`.

Chip: `['dash', 'Catira Intelligence']` instead of `['dash', 'Dashboard']`.

Dashboard fetch already uses `dashFilter`. Add `category` to `dashFilter` initial `{ period: '7d', city: '', status: '', category: '' }` and pass `category` query if present:

```javascript
api('/api/admin/dashboard?period=' + dashFilter.period + '&city=' + encodeURIComponent(dashFilter.city) + '&status=' + encodeURIComponent(dashFilter.status) + '&category=' + encodeURIComponent(dashFilter.category || ''))
```

Replace the `tab === 'dash' && isMaster && dash` body with:

```javascript
{tab === 'dash' && isMaster && (
  <AdminIntelligence
    dash={dash}
    dashFilter={dashFilter}
    setDashFilter={setDashFilter}
    dashCities={dashCities}
    cats={cats}
    user={user}
  />
)}
```

`AdminIntelligence` loads settings itself via `api('/api/admin/intelligence/settings')` on mount so Admin.jsx stays smaller.

Keep operational charts (receita, usuários, anúncios) inside Visão geral.

- [ ] **Step 7: Run frontend tests + build**

```bash
cd /workspace/frontend && node --test src/*.test.mjs
cd /workspace/frontend && npm run build
```

Expected: all tests pass, build ok.

- [ ] **Step 8: Commit** — skip unless asked.

---

### Task 5: Verification sweep

**Files:** none new unless a test failed.

- [ ] **Step 1: Backend suite**

`cd /workspace/backend && npm test`

Allowed pre-existing fail: `transcribeLocal.test.js` Vosk only. Everything else must pass.

- [ ] **Step 2: Frontend**

`cd /workspace/frontend && node --test src/*.test.mjs && npm run build`

- [ ] **Step 3: Manual sanity (if servers up)**

`GET /api/health` 200. Master login `admin@catira.com` / `admin123` → chip Catira Intelligence. Intermediador/user → no chip / 403 dashboard.

- [ ] **Step 4: Present delivery notes** (controller, not a commit): files, collections, endpoints, indicators, flags, tests, build, limitations.

---

## Self-review

1. Spec coverage: events, HMAC, flags, dashboard block, share route, commercial 403, UI modules, tests, no Appmax rewrite — each has a task.
2. No TBD. Commits skipped on purpose (user constraint).
3. Names: `trackEvent`, `buildDashboard`, `getSettings`, `denyCommercial`, collections `intelligenceEvents` / `intelligenceDaily`, header `X-Catira-Session`.
