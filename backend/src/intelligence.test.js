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

const viewsAfterDup = db.count('intelligenceEvents', (e) => e.type === 'view' && e.listingId === listing.id && e.actorHash === h1);
const viewStillDup = intelligence.trackEvent({
  type: 'view',
  user: buyer,
  listing,
  sessionId: 'sid-1',
});
assert.strictEqual(viewStillDup.recorded, false);
assert.strictEqual(
  db.count('intelligenceEvents', (e) => e.type === 'view' && e.listingId === listing.id && e.actorHash === h1),
  viewsAfterDup
);

const payBefore = db.count('intelligenceEvents', (e) => e.type === 'payment_confirmed');
const paidNow = intelligence.trackEvent({
  type: 'payment_confirmed',
  user: buyer,
  listing,
  order: {
    id: 'pay-immediate-1',
    totalCents: 8000,
    paymentMethod: 'pix',
    address: { city: 'Corinto', cityId: 'corinto' },
  },
  sessionId: 'sid-pay-1',
});
assert.strictEqual(paidNow.recorded, true);
assert.ok(paidNow.event);
assert.strictEqual(paidNow.event.type, 'payment_confirmed');
assert.ok(db.findById('intelligenceEvents', paidNow.event.id));
assert.strictEqual(db.count('intelligenceEvents', (e) => e.type === 'payment_confirmed'), payBefore + 1);

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
if (typeof intelligence.flushPendingEvents === 'function') intelligence.flushPendingEvents();

const catId = listing.categoryId;
const demandBefore = intelligence.buildDashboard({ period: 'all', category: catId });
const demandRowBefore = demandBefore.offerDemand.find((r) => r.categoryId === catId);
const demandCountBefore = demandRowBefore ? demandRowBefore.demand : 0;
const searchesBefore = demandBefore.stats.searches || 0;
const searchWithDims = intelligence.trackEvent({
  type: 'search',
  user: buyer,
  query: 'furadeira geo',
  resultCount: 2,
  sessionId: 'sid-geo',
  categoryId: catId,
  city: 'Corinto',
  cityId: 'corinto',
});
assert.strictEqual(searchWithDims.recorded, true);
assert.strictEqual(searchWithDims.event.categoryId, catId);
assert.strictEqual(searchWithDims.event.city, 'Corinto');
assert.strictEqual(searchWithDims.event.cityId, 'corinto');
if (typeof intelligence.flushPendingEvents === 'function') intelligence.flushPendingEvents();
const storedSearch = db.findOne('intelligenceEvents', (e) => e.type === 'search' && e.query === 'furadeira geo');
assert.ok(storedSearch);
assert.strictEqual(storedSearch.categoryId, catId);
assert.strictEqual(storedSearch.city, 'Corinto');
assert.strictEqual(storedSearch.cityId, 'corinto');
const demandAfter = intelligence.buildDashboard({ period: 'all', category: catId });
assert.strictEqual(demandAfter.stats.searches, searchesBefore + 1);
const demandRowAfter = demandAfter.offerDemand.find((r) => r.categoryId === catId);
assert.ok(demandRowAfter);
assert.strictEqual(demandRowAfter.demand, demandCountBefore + 1);

const searchOtherCity = intelligence.trackEvent({
  type: 'search',
  user: buyer,
  query: 'furadeira geo',
  resultCount: 1,
  sessionId: 'sid-geo',
  categoryId: catId,
  city: 'Curvelo',
  cityId: 'curvelo',
});
assert.strictEqual(searchOtherCity.recorded, true);
const searchSameCityDup = intelligence.trackEvent({
  type: 'search',
  user: buyer,
  query: 'furadeira geo',
  resultCount: 3,
  sessionId: 'sid-geo',
  categoryId: catId,
  city: 'Corinto',
  cityId: 'corinto',
});
assert.strictEqual(searchSameCityDup.recorded, false);

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

assert.equal(typeof intelligence.ensureDemoEvents, 'function', 'ensureDemoEvents exportada');
const demoFirst = intelligence.ensureDemoEvents();
assert.ok(demoFirst && demoFirst.seeded === true);
assert.ok(demoFirst.count > 20);
const demoDash = intelligence.buildDashboard({ period: 'all' });
assert.strictEqual(demoDash.series.length, 365);
const seriesDay = demoDash.series[demoDash.series.length - 1].date;
const dailyExtra = 17;
db.insert('intelligenceDaily', {
  id: seriesDay + '|view||||daily-series-extra',
  day: seriesDay,
  type: 'view',
  cityId: null,
  categoryId: null,
  listingId: null,
  query: null,
  count: dailyExtra,
});
const seriesFromDaily = intelligence.buildDashboard({ period: 'all' });
const lastSeries = seriesFromDaily.series.find((s) => s.date === seriesDay);
assert.ok(lastSeries);
assert.strictEqual(lastSeries.views, (demoDash.series[demoDash.series.length - 1].views || 0) + dailyExtra);
if (!db.findById('cities', 'tres-marias')) {
  db.insert('cities', { id: 'tres-marias', name: 'Três Marias', state: 'MG', slug: 'tres-marias-mg' });
}
const namedCityViews = 9;
db.insert('intelligenceDaily', {
  id: seriesDay + '|view|tres-marias|||name-city-series',
  day: seriesDay,
  type: 'view',
  cityId: 'tres-marias',
  categoryId: null,
  listingId: null,
  query: null,
  count: namedCityViews,
});
const namedCityDash = intelligence.buildDashboard({ period: 'all', city: 'Três Marias' });
const namedCityBucket = namedCityDash.series.find((s) => s.date === seriesDay);
assert.ok(namedCityBucket);
assert.ok(namedCityBucket.views >= namedCityViews);
assert.ok(demoDash.stats.searches >= 8);
assert.ok(demoDash.stats.emptySearches >= 3);
assert.ok(demoDash.stats.views >= 5);
assert.ok(demoDash.stats.favorites >= 1);
assert.ok(demoDash.stats.shares >= 1);
assert.ok(demoDash.stats.contacts >= 1);
assert.ok(demoDash.stats.ordersCreated >= 1);
assert.ok(demoDash.stats.paymentsConfirmed >= 1);
assert.ok(demoDash.rankings.queries.length >= 1);
assert.ok(demoDash.rankings.emptyQueries.length >= 1);
assert.ok(demoDash.opportunities.length >= 1);
const demoSecond = intelligence.ensureDemoEvents();
assert.strictEqual(demoSecond.seeded, false);
assert.strictEqual(
  db.count('intelligenceEvents', (e) => e.source === 'demo'),
  demoFirst.count
);

(async () => {
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
  if (typeof intelligence.flushPendingEvents === 'function') intelligence.flushPendingEvents();
  assert.ok(db.count('intelligenceEvents', (e) => e.type === 'search' && e.query && e.query.includes('furadeira')) > before);

  const viewed = await jsonRequest(server, {
    method: 'GET',
    path: '/api/listings/' + listing.id,
    token,
    session: 'sid-http-view',
  });
  assert.strictEqual(viewed.status, 200);
  assert.strictEqual(viewed.body.views, 1);
  assert.strictEqual(db.findById('listings', listing.id).views || 0, 0);
  if (typeof intelligence.flushPendingEvents === 'function') intelligence.flushPendingEvents();
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
  console.log('intelligence.test.js ok');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
