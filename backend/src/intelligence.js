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
const BUFFER_TYPES = ['view', 'search'];
const BUFFER_MS = 2000;
const dedupeLast = new Map();
const pendingIntel = [];
let intelTimer = null;
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

function hoursAgo(n) {
  return new Date(Date.now() - n * 3600000).toISOString();
}

function pickPublishedListings() {
  const all = db.findWhere('listings', (l) => l.status === 'published');
  if (all.length) return all.slice(0, 8);
  const cats = db.all('categories');
  const catId = (cats[0] && cats[0].id) || 'cat';
  const user = db.findOne('users', (u) => u.role === 'user') || db.insert('users', {
    name: 'Demo Buyer',
    email: 'demo-intel-' + Date.now() + '@test.local',
    role: 'user',
    status: 'active',
    passwordHash: 'x',
    city: 'Corinto',
    cityId: 'corinto',
  });
  return [db.insert('listings', {
    userId: user.id,
    title: 'Furadeira demo',
    status: 'published',
    city: 'Corinto',
    cityId: 'corinto',
    categoryId: catId,
    price: 80,
    views: 0,
    createdAt: new Date().toISOString(),
  })];
}

function ensureDemoEvents() {
  ensureSettings();
  const existing = db.count('intelligenceEvents', (e) => e.source === 'demo');
  if (existing > 0) return { seeded: false, count: existing };
  const listings = pickPublishedListings();
  const primary = listings[0];
  const secondary = listings[1] || listings[0];
  const third = listings[2] || listings[0];
  const catId = primary.categoryId;
  const otherCat = (db.all('categories').find((c) => c.id !== catId) || {}).id || catId;
  let recorded = 0;
  function play(input) {
    const r = trackEvent(input);
    if (r.recorded) recorded += 1;
  }
  const searches = [
    { q: 'iphone 13', hours: 6, city: 'Corinto', cityId: 'corinto', categoryId: catId, resultCount: 4, sid: 'demo-s1' },
    { q: 'iphone 13', hours: 30, city: 'Corinto', cityId: 'corinto', categoryId: catId, resultCount: 3, sid: 'demo-s2' },
    { q: 'iphone 13', hours: 54, city: 'Curvelo', cityId: 'curvelo', categoryId: catId, resultCount: 2, sid: 'demo-s3' },
    { q: 'honda titan', hours: 8, city: 'Corinto', cityId: 'corinto', categoryId: catId, resultCount: 2, sid: 'demo-s4' },
    { q: 'geladeira frost free', hours: 12, city: 'Corinto', cityId: 'corinto', categoryId: otherCat, resultCount: 1, sid: 'demo-s5' },
    { q: 'sofa retratil', hours: 20, city: 'Tres Marias', cityId: 'tres-marias', categoryId: otherCat, resultCount: 1, sid: 'demo-s6' },
    { q: 'drone 4k', hours: 4, city: 'Corinto', cityId: 'corinto', categoryId: catId, resultCount: 0, sid: 'demo-e1' },
    { q: 'drone 4k', hours: 28, city: 'Corinto', cityId: 'corinto', categoryId: catId, resultCount: 0, sid: 'demo-e2' },
    { q: 'drone 4k', hours: 52, city: 'Curvelo', cityId: 'curvelo', categoryId: catId, resultCount: 0, sid: 'demo-e3' },
    { q: 'kit energia solar', hours: 10, city: 'Corinto', cityId: 'corinto', categoryId: otherCat, resultCount: 0, sid: 'demo-e4' },
    { q: 'kit energia solar', hours: 34, city: 'Corinto', cityId: 'corinto', categoryId: otherCat, resultCount: 0, sid: 'demo-e5' },
    { q: 'kit energia solar', hours: 58, city: 'Felixlandia', cityId: 'felixlandia', categoryId: otherCat, resultCount: 0, sid: 'demo-e6' },
  ];
  searches.forEach((s) => {
    play({
      type: 'search',
      query: s.q,
      resultCount: s.resultCount,
      city: s.city,
      cityId: s.cityId,
      categoryId: s.categoryId,
      sessionId: s.sid,
      now: hoursAgo(s.hours),
      source: 'demo',
    });
  });
  const viewHours = [2, 7, 14, 26, 38, 50, 62, 74];
  viewHours.forEach((h, i) => {
    const listing = i % 3 === 0 ? third : (i % 2 === 0 ? secondary : primary);
    play({
      type: 'view',
      listing,
      sessionId: 'demo-v' + i,
      now: hoursAgo(h),
      source: 'demo',
    });
  });
  play({ type: 'favorite', listing: primary, sessionId: 'demo-f1', now: hoursAgo(9), source: 'demo' });
  play({ type: 'favorite', listing: secondary, sessionId: 'demo-f2', now: hoursAgo(33), source: 'demo' });
  play({ type: 'share', listing: primary, sessionId: 'demo-sh1', now: hoursAgo(11), source: 'demo' });
  play({ type: 'share', listing: secondary, sessionId: 'demo-sh2', now: hoursAgo(40), source: 'demo' });
  play({ type: 'contact', listing: primary, sessionId: 'demo-c1', now: hoursAgo(13), source: 'demo' });
  play({ type: 'contact_whatsapp', listing: secondary, sessionId: 'demo-c2', now: hoursAgo(29), source: 'demo' });
  play({ type: 'proposal', listing: primary, proposalId: 'demo-proposal-1', sessionId: 'demo-p1', now: hoursAgo(16), source: 'demo' });
  const paidOrder = {
    id: 'demo-order-paid',
    listingId: primary.id,
    totalCents: 8900,
    paymentMethod: 'pix',
    address: { city: 'Corinto', cityId: 'corinto' },
  };
  const cheapOrder = {
    id: 'demo-order-cheap',
    listingId: secondary.id,
    totalCents: 3500,
    paymentMethod: 'card',
    address: { city: 'Curvelo', cityId: 'curvelo' },
  };
  const bigOrder = {
    id: 'demo-order-big',
    listingId: third.id,
    totalCents: 1350000,
    paymentMethod: 'pix',
    address: { city: 'Corinto', cityId: 'corinto' },
  };
  [paidOrder, cheapOrder, bigOrder].forEach((order, i) => {
    const listing = listings[Math.min(i, listings.length - 1)];
    play({ type: 'order_created', listing, order, sessionId: 'demo-o' + i, now: hoursAgo(18 + i * 12), source: 'demo' });
    play({ type: 'checkout', listing, order, sessionId: 'demo-ck' + i, now: hoursAgo(17 + i * 12), source: 'demo' });
  });
  play({ type: 'payment_confirmed', listing: primary, order: paidOrder, sessionId: 'demo-pay1', now: hoursAgo(15), source: 'demo' });
  play({ type: 'payment_confirmed', listing: secondary, order: cheapOrder, sessionId: 'demo-pay2', now: hoursAgo(27), source: 'demo' });
  play({ type: 'sale_completed', listing: primary, order: paidOrder, sessionId: 'demo-sale1', now: hoursAgo(8), source: 'demo' });
  [3, 80, 100, 120, 140].forEach((h, i) => {
    play({
      type: 'view',
      listing: third,
      sessionId: 'demo-lonely-' + i,
      now: hoursAgo(h),
      source: 'demo',
    });
  });
  const count = db.count('intelligenceEvents', (e) => e.source === 'demo');
  return { seeded: count > 0, count: count || recorded };
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

function resolveCityRef(raw) {
  const value = String(raw || '').trim();
  if (!value) return { city: null, cityId: null };
  const lower = value.toLowerCase();
  const row = db.findById('cities', value) || db.findOne('cities', (c) => (
    String(c.id || '').toLowerCase() === lower
    || String(c.slug || '').toLowerCase() === lower
    || String(c.name || '').toLowerCase() === lower
  ));
  if (row) return { city: row.name || value, cityId: row.id || value };
  return { city: value, cityId: value };
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

function dedupeKey(type, actor, extra) {
  let key = `${type}:${actor}:${(extra && (extra.listingId || extra.query)) || ''}`;
  if (extra && Object.prototype.hasOwnProperty.call(extra, 'city')) key += ':' + (extra.city || '');
  if (extra && extra.orderId) key += ':' + extra.orderId;
  if (extra && extra.proposalId) key += ':' + extra.proposalId;
  return key;
}

function dedupeHit(type, actor, extra, nowMs) {
  const windowMs = DEDUPE_MS[type];
  const eternal = ETERNAL.includes(type);
  if (!windowMs && !eternal) return false;
  const last = dedupeLast.get(dedupeKey(type, actor, extra));
  if (last == null) return false;
  if (eternal) return true;
  return nowMs - last < windowMs;
}

function rememberDedupe(type, actor, extra, nowMs) {
  dedupeLast.set(dedupeKey(type, actor, extra), nowMs);
}

function flushPendingEvents() {
  if (intelTimer) {
    clearTimeout(intelTimer);
    intelTimer = null;
  }
  if (!pendingIntel.length) return;
  const batch = pendingIntel.splice(0, pendingIntel.length);
  for (let i = 0; i < batch.length; i++) {
    const saved = db.insert('intelligenceEvents', batch[i]);
    bumpDaily(saved);
  }
}

function scheduleIntelFlush() {
  if (intelTimer) return;
  intelTimer = setTimeout(() => {
    intelTimer = null;
    flushPendingEvents();
  }, BUFFER_MS);
  if (intelTimer.unref) intelTimer.unref();
}

db.onClose(flushPendingEvents);

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
    const fromInput = resolveCityRef(input.cityId || input.city);
    const cityId = (order && order.address && order.address.cityId)
      || fields.cityId
      || fromInput.cityId
      || null;
    const city = (order && order.address && order.address.city)
      || fields.city
      || fromInput.city
      || null;
    const categoryId = fields.categoryId || input.categoryId || null;
    const extra = {
      listingId: fields.listingId,
      query,
      orderId: order && order.id,
      proposalId: input.proposalId || null,
    };
    if (input.type === 'search') extra.city = city || cityId || '';
    if (dedupeHit(input.type, hash, extra, nowMs)) return { recorded: false, reason: 'dedupe' };
    rememberDedupe(input.type, hash, extra, nowMs);
    const event = {
      type: input.type,
      createdAt,
      actorHash: hash,
      listingId: fields.listingId,
      productId: fields.productId,
      categoryId,
      cityId,
      city,
      query,
      resultCount: input.type === 'search' ? Number(input.resultCount || 0) : null,
      orderId: extra.orderId || null,
      proposalId: extra.proposalId,
      priceCents: order && order.totalCents != null ? order.totalCents : (listing && listing.price != null ? Math.round(Number(listing.price) * 100) : null),
      paymentMethod: order && order.paymentMethod ? order.paymentMethod : null,
      source: input.source || 'app',
    };
    if (BUFFER_TYPES.includes(input.type) && !input.now) {
      pendingIntel.push(event);
      scheduleIntelFlush();
      return { recorded: true, event };
    }
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
  if (period === 'all') return t - 365 * 86400000;
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
  const cityRaw = ((filters && filters.city) || '').trim();
  const city = cityRaw.toLowerCase();
  const cityRef = resolveCityRef(cityRaw);
  const cityIdFilter = cityRef.cityId ? String(cityRef.cityId).toLowerCase() : '';
  const category = ((filters && filters.category) || '').trim();
  const now = Date.now();
  const from = periodFrom(period, now);
  const to = now;
  let events = db.all('intelligenceEvents').filter((e) => inRange(e.createdAt, from, to));
  if (city) {
    const cityName = String(cityRef.city || '').toLowerCase();
    events = events.filter((e) => {
      const eventCity = String(e.city || '').toLowerCase();
      const eventCityId = String(e.cityId || '').toLowerCase();
      return eventCity === city || eventCityId === city || eventCityId === cityIdFilter || eventCity === cityName;
    });
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

  const dayCount = period === 'year' ? 30 : period === 'all' ? 365 : period === '30d' ? 30 : period === 'month' ? new Date().getDate() : 7;
  const fromDay = new Date(from).toISOString().slice(0, 10);
  const toDay = new Date(to).toISOString().slice(0, 10);
  const daily = {};
  db.all('intelligenceDaily').forEach((row) => {
    if (!row || !row.day) return;
    if (row.day < fromDay || row.day > toDay) return;
    if (city) {
      const match = String(row.cityId || '').toLowerCase() === cityIdFilter
        || String(row.cityId || '').toLowerCase() === city;
      if (!match) return;
    }
    if (category && row.categoryId !== category) return;
    if (!daily[row.day]) daily[row.day] = { searches: 0, views: 0, orders: 0, paid: 0 };
    const n = Number(row.count || 0);
    if (row.type === 'search') daily[row.day].searches += n;
    else if (row.type === 'view') daily[row.day].views += n;
    else if (row.type === 'order_created') daily[row.day].orders += n;
    else if (row.type === 'payment_confirmed') daily[row.day].paid += n;
  });
  const series = [];
  for (let i = dayCount - 1; i >= 0; i--) {
    const d = new Date(now - i * 86400000).toISOString().slice(0, 10);
    const counts = daily[d] || { searches: 0, views: 0, orders: 0, paid: 0 };
    series.push({
      date: d,
      searches: counts.searches,
      views: counts.views,
      orders: counts.orders,
      paid: counts.paid,
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
  ensureDemoEvents,
  flushPendingEvents,
  DEDUPE_MS,
  ETERNAL,
};
