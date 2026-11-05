const db = require('./db');
const { pageSlice } = require('./pagination');

const PLATFORM_ROLE = 'platform';
const PLATFORM_EMAIL = 'catira.oficial@catira.com';
const PLATFORM_NAME = 'CATIRA OFICIAL';

const PROVIDERS = ['catira', 'mercadolivre', 'shopee', 'amazon', 'other'];
const EXTERNAL_PROVIDERS = ['mercadolivre', 'shopee', 'amazon', 'other'];
const PROVIDER_LABEL = {
  catira: 'Oferta Catira',
  mercadolivre: 'Comprar no Mercado Livre',
  shopee: 'Comprar na Shopee',
  amazon: 'Comprar na Amazon',
  other: 'Comprar no parceiro',
};

const OFFER_STATUS = ['manual', 'active', 'stale', 'suspended'];
const LIVE_STATUSES = ['manual', 'active'];
const STALE_HOURS = 24;
const PRICING_RULES = ['fixed', 'percent'];

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function money2(n) {
  const value = Number(n);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 100) / 100;
}

// Identidade institucional idempotente: não participa de rankings, perfis,
// sugestões de vendedores nem contato pessoal.
function ensureOfficialSeller() {
  const existing = db.findOne('users', (u) => u.role === PLATFORM_ROLE);
  if (existing) return existing;
  return db.insert('users', {
    name: PLATFORM_NAME,
    email: PLATFORM_EMAIL,
    phone: '',
    city: '',
    cityId: '',
    passwordHash: '',
    role: PLATFORM_ROLE,
    status: 'active',
    phoneVerified: false,
    emailVerified: true,
    profileHidden: true,
    systemAccount: true,
    createdAt: new Date().toISOString(),
    ratingAvg: 0,
    ratingCount: 0,
    avatarColor: '#111827',
  });
}

const TEST_PIX_TITLE = 'Teste Pix R$ 10';

function ensureTestPixProduct() {
  const seller = ensureOfficialSeller();
  const existing = db.findOne('officialProducts', (p) => p.title === TEST_PIX_TITLE);
  const cat = db.findOne('categories', (c) => c.active !== false) || db.findOne('categories', () => true);
  if (!cat) throw httpError(500, 'Categoria ausente.');
  let product = existing;
  if (!product) {
    const created = createProduct({
      title: TEST_PIX_TITLE,
      description: 'Produto de teste da compra Pix pelo Catira. Cobrança real de R$ 10.',
      categoryId: cat.id,
      condition: 'novo',
      pricingRule: 'fixed',
      manualPrice: 10,
      published: true,
      cityId: 'corinto',
      city: 'Corinto',
      delivery: { mode: 'cities', cityIds: ['corinto'] },
    }, { id: seller.id });
    product = created.product;
  }
  const offerOut = upsertOffer(product.id, {
    provider: 'catira',
    price: 10,
    stock: 10,
    status: 'active',
    enabled: true,
    buyEnabled: true,
  }, { id: seller.id });
  return {
    product: productOf(product.id),
    offer: offerOut.offer,
    listing: db.findById('listings', productOf(product.id).listingId),
    created: !existing,
  };
}

const SAMPLE_OFFICIAL_PRODUCTS = [
  { title: 'Fone Bluetooth Catira', slug: 'tecnologia', price: 49, description: 'Fone sem fio de exemplo Catira.' },
  { title: 'Kit chaves 40 peças', slug: 'ferramentas', price: 79, description: 'Jogo de chaves de exemplo Catira.' },
  { title: 'Luminária LED de mesa', slug: 'casa-moveis', price: 39, description: 'Luminária de mesa de exemplo Catira.' },
  { title: 'Boné trucker Corinto', slug: 'moda', price: 35, description: 'Boné de exemplo Catira.' },
  { title: 'Pulverizador 5 L', slug: 'agro', price: 89, description: 'Pulverizador de exemplo Catira.' },
];

function categoryForSample(slug) {
  return db.findOne('categories', (c) => c.slug === slug && c.active !== false)
    || db.findOne('categories', (c) => c.active !== false)
    || db.findOne('categories', () => true);
}

function ensureSampleOfficialProducts() {
  const seller = ensureOfficialSeller();
  const items = SAMPLE_OFFICIAL_PRODUCTS.map((spec) => {
    const cat = categoryForSample(spec.slug);
    if (!cat) throw httpError(500, 'Categoria ausente.');
    const existing = db.findOne('officialProducts', (p) => p.title === spec.title);
    let product = existing;
    let created = false;
    if (!product) {
      const createdRow = createProduct({
        title: spec.title,
        description: spec.description,
        categoryId: cat.id,
        condition: 'novo',
        pricingRule: 'fixed',
        manualPrice: spec.price,
        published: true,
        cityId: 'corinto',
        city: 'Corinto',
        delivery: { mode: 'cities', cityIds: ['corinto'] },
      }, { id: seller.id });
      product = createdRow.product;
      created = true;
    }
    const offerOut = upsertOffer(product.id, {
      provider: 'catira',
      price: spec.price,
      stock: 10,
      status: 'active',
      enabled: true,
      buyEnabled: true,
    }, { id: seller.id });
    const full = productOf(product.id);
    return {
      product: full,
      offer: offerOut.offer,
      listing: db.findById('listings', full.listingId),
      created,
    };
  });
  return { items, createdCount: items.filter((row) => row.created).length };
}

function isPlatformUser(user) {
  return !!user && user.role === PLATFORM_ROLE;
}

function isPlatformId(userId) {
  if (!userId) return false;
  const u = db.findById('users', userId);
  return isPlatformUser(u);
}

function isOfficialListing(listing) {
  return !!listing && (listing.origin === 'official' || !!listing.officialProductId);
}

function officialOfListing(listing) {
  if (!isOfficialListing(listing)) return null;
  if (listing.officialProductId) {
    const byId = db.findById('officialProducts', listing.officialProductId);
    if (byId) return byId;
  }
  return db.findOne('officialProducts', (p) => p.listingId === listing.id) || null;
}

function productOf(id) {
  return db.findById('officialProducts', id);
}

function assertProvider(provider) {
  if (!PROVIDERS.includes(provider)) throw httpError(400, 'Plataforma de compra inválida.');
  return provider;
}

function sanitizeCities(raw) {
  if (!Array.isArray(raw)) return [];
  const ids = raw.map((c) => String(c || '').trim()).filter(Boolean);
  return [...new Set(ids)];
}

function normalizeCoverage(raw) {
  const value = raw || {};
  const mode = value.mode === 'all' ? 'all' : 'cities';
  return {
    mode,
    cityIds: mode === 'all' ? [] : sanitizeCities(value.cityIds),
  };
}

// Preço comercial: decisão manual sempre vence o cálculo automático.
function computePrice(product) {
  if (!product) return 0;
  const manual = Number(product.manualPrice);
  if (Number.isFinite(manual) && manual > 0) return money2(manual);
  const cost = money2(product.costPrice);
  if (!cost) return money2(product.price);
  const rule = PRICING_RULES.includes(product.pricingRule) ? product.pricingRule : 'fixed';
  const margin = Number(product.marginValue);
  const safeMargin = Number.isFinite(margin) && margin > 0 ? margin : 0;
  if (rule === 'percent') return money2(cost + (cost * safeMargin) / 100);
  return money2(cost + safeMargin);
}

function offerHours(offer) {
  const raw = Number(offer && offer.staleAfterHours);
  return Number.isFinite(raw) && raw > 0 ? raw : STALE_HOURS;
}

function isSafeHttpUrl(raw) {
  const url = String(raw || '').trim();
  if (!url) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  const host = String(parsed.hostname || '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local') || host === '127.0.0.1' || host === '::1') return false;
  return true;
}

function normalizeOfferUrl(raw) {
  const url = String(raw || '').trim();
  if (!url) return '';
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw httpError(400, 'Informe um link http(s) válido.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw httpError(400, 'Use apenas links http ou https.');
  }
  if (parsed.username || parsed.password) throw httpError(400, 'Link inválido.');
  const host = String(parsed.hostname || '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local') || host === '127.0.0.1' || host === '::1') {
    throw httpError(400, 'Link inválido.');
  }
  return parsed.toString().slice(0, 1000);
}

function isExternalProvider(provider) {
  return EXTERNAL_PROVIDERS.includes(provider);
}

function logOfficial(actor, action, payload) {
  db.insert('officialAdminLogs', {
    actorId: actor && actor.id ? actor.id : null,
    action,
    payload: payload || {},
    createdAt: new Date().toISOString(),
  });
}

function optionalMoney(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw httpError(400, 'Preço da oferta inválido.');
  if (n === 0) return null;
  return money2(n);
}

// Oferta visível ao comprador: ativa, com URL http(s) válida e plataforma externa.
function offerIsLive(offer, nowMs) {
  if (!offer) return false;
  if (offer.enabled === false) return false;
  if (!LIVE_STATUSES.includes(offer.status || 'manual')) return false;
  if (isExternalProvider(offer.provider) && !isSafeHttpUrl(offer.url)) return false;
  if (offer.source === 'process') {
    const last = new Date(offer.lastSyncAt || 0).getTime();
    if (!Number.isFinite(last) || last <= 0) return false;
    const limit = offerHours(offer) * 3600000;
    return (nowMs || Date.now()) - last <= limit;
  }
  return true;
}

function offersOf(productId, opts = {}) {
  const now = opts.now || Date.now();
  const rows = db
    .findWhere('officialProductOffers', (o) => o.productId === productId)
    .sort((a, b) => PROVIDERS.indexOf(a.provider) - PROVIDERS.indexOf(b.provider));
  return rows.filter((o) => (opts.includeHidden ? true : offerIsLive(o, now)));
}

function hasExternalOffer(productId, now) {
  return offersOf(productId, { now }).some((o) => o.provider !== 'catira');
}

function hasInternalOffer(productId, now) {
  return offersOf(productId, { now }).some((o) => o.provider === 'catira');
}

function resolveCityId(city) {
  const raw = String(city || '').trim();
  if (!raw) return '';
  const byId = db.findById('cities', raw);
  if (byId) return byId.id;
  const lower = raw.toLowerCase();
  const row = db.findOne(
    'cities',
    (c) => String(c.name || '').toLowerCase() === lower || String(c.slug || '').toLowerCase() === lower
  );
  return row ? row.id : '';
}

// Cobertura vale para a compra interna. Oferta externa segue a logística do
// provedor e não é bloqueada pela cobertura do Catira.
function matchesCity(product, city, now) {
  if (!product) return false;
  if (!city) return true;
  const coverage = normalizeCoverage(product.delivery);
  if (coverage.mode === 'all') return true;
  const cityId = resolveCityId(city);
  if (cityId && coverage.cityIds.includes(cityId)) return true;
  if (!hasInternalOffer(product.id, now)) return true;
  return false;
}

function listingPrice(product) {
  return computePrice(product);
}

function syncListing(product) {
  if (!product) return null;
  const seller = ensureOfficialSeller();
  const patch = {
    userId: seller.id,
    title: product.title,
    description: product.description || '',
    categoryId: product.categoryId,
    subcategory: product.subcategory || '',
    price: listingPrice(product),
    condition: product.condition || 'novo',
    city: product.city || '',
    cityId: product.cityId || '',
    neighborhood: '',
    listingType: 'venda',
    acceptsTrade: false,
    acceptsCash: false,
    tradeWishes: '',
    status: product.published === false ? 'paused' : 'published',
    origin: 'official',
    officialProductId: product.id,
    protected: true,
    featured: false,
    vip: false,
    premium: false,
    views: 0,
    createdAt: product.createdAt,
    publishedAt: product.published === false ? null : (product.publishedAt || new Date().toISOString()),
    expiresAt: null,
    paidAt: null,
  };
  function syncImages(listingId) {
    const wanted = Array.isArray(product.images) ? product.images : [];
    const current = db.findWhere('listingImages', (i) => i.listingId === listingId);
    const sameLength = current.length === wanted.length;
    const sameUrls = sameLength && wanted.every((w, i) => {
      const row = current.find((c) => (c.order || 0) === i);
      return row && row.url === w.url;
    });
    if (sameUrls) return;
    current.forEach((i) => db.remove('listingImages', i.id));
    wanted.forEach((w, idx) => {
      db.insert('listingImages', {
        listingId,
        url: w.url,
        color: '#111827',
        label: product.title,
        emoji: '',
        order: idx,
      });
    });
  }
  if (product.listingId) {
    const current = db.findById('listings', product.listingId);
    if (current) {
      const updated = db.update('listings', current.id, patch);
      syncImages(updated.id);
      db.update('officialProducts', product.id, { listingId: updated.id });
      return updated;
    }
  }
  const now = new Date().toISOString();
  const listing = db.insert('listings', {
    ...patch,
    createdAt: product.createdAt || now,
  });
  syncImages(listing.id);
  db.update('officialProducts', product.id, { listingId: listing.id, updatedAt: now });
  return listing;
}

function removeListing(product) {
  if (!product) return;
  const listingId = product.listingId;
  if (!listingId) return;
  db.findWhere('listingImages', (i) => i.listingId === listingId).forEach((i) => db.remove('listingImages', i.id));
  db.findWhere('favorites', (f) => f.listingId === listingId).forEach((f) => db.remove('favorites', f.id));
  db.remove('listings', listingId);
  db.update('officialProducts', product.id, { listingId: null });
}

function sanitizeProductInput(body, current) {
  const b = body || {};
  const base = current || {};
  const out = {};
  if (b.title !== undefined) {
    const title = String(b.title || '').trim().slice(0, 140);
    if (!title) throw httpError(400, 'Informe o título do produto.');
    out.title = title;
  }
  if (b.description !== undefined) out.description = String(b.description || '').trim().slice(0, 4000);
  if (b.categoryId !== undefined) {
    const cat = db.findById('categories', b.categoryId);
    if (!cat) throw httpError(400, 'Categoria inválida.');
    out.categoryId = cat.id;
  }
  if (b.subcategory !== undefined) out.subcategory = String(b.subcategory || '').trim().slice(0, 80);
  if (b.condition !== undefined) out.condition = ['novo', 'seminovo', 'usado'].includes(b.condition) ? b.condition : 'novo';
  if (b.costPrice !== undefined) {
    const cost = Number(b.costPrice);
    if (!Number.isFinite(cost) || cost < 0) throw httpError(400, 'Custo do fornecedor inválido.');
    out.costPrice = money2(cost);
  }
  if (b.pricingRule !== undefined) {
    if (!PRICING_RULES.includes(b.pricingRule)) throw httpError(400, 'Regra de preço inválida.');
    out.pricingRule = b.pricingRule;
  }
  if (b.marginValue !== undefined) {
    const margin = Number(b.marginValue);
    if (!Number.isFinite(margin) || margin < 0) throw httpError(400, 'Margem inválida.');
    out.marginValue = money2(margin);
  }
  if (b.manualPrice !== undefined) {
    const raw = b.manualPrice;
    if (raw === null || raw === '' || raw === 0) out.manualPrice = null;
    else {
      const manual = Number(raw);
      if (!Number.isFinite(manual) || manual <= 0) throw httpError(400, 'Preço comercial inválido.');
      out.manualPrice = money2(manual);
    }
  }
  if (b.published !== undefined) out.published = !!b.published;
  if (b.city !== undefined) out.city = String(b.city || '').trim().slice(0, 80);
  if (b.cityId !== undefined) out.cityId = String(b.cityId || '').trim().slice(0, 80);
  if (b.delivery !== undefined) out.delivery = normalizeCoverage(b.delivery);
  if (b.providerSummary !== undefined) out.providerSummary = String(b.providerSummary || '').trim().slice(0, 500);
  if (b.images !== undefined) {
    const rows = Array.isArray(b.images) ? b.images.slice(0, 8) : [];
    out.images = rows
      .map((row, i) => {
        const url = String((row && row.url) || row || '').trim().slice(0, 1000);
        if (!/^(https?:\/\/|\/uploads\/)/i.test(url)) return null;
        return { url, order: i };
      })
      .filter(Boolean);
  }
  if (b.meliItemId !== undefined) {
    const id = String(b.meliItemId || '').trim().toUpperCase();
    out.meliItemId = id || null;
  }
  if (b.meliCatalogId !== undefined) {
    const id = String(b.meliCatalogId || '').trim().toUpperCase();
    out.meliCatalogId = id || null;
  }
  const next = { ...base, ...out };
  if (base.id) {
    const price = computePrice(next);
    if (!price && next.published !== false) throw httpError(400, 'Defina um preço comercial ou custo e margem.');
  }
  return out;
}

function createProduct(body, actor, opts = {}) {
  const seller = ensureOfficialSeller();
  const now = new Date().toISOString();
  const input = sanitizeProductInput(body, null);
  if (!input.title) throw httpError(400, 'Informe o título do produto.');
  if (!input.categoryId) throw httpError(400, 'Escolha uma categoria.');
  const product = db.insert('officialProducts', {
    title: input.title,
    description: input.description || '',
    categoryId: input.categoryId,
    subcategory: input.subcategory || '',
    condition: input.condition || 'novo',
    costPrice: input.costPrice || 0,
    pricingRule: input.pricingRule || 'fixed',
    marginValue: input.marginValue || 0,
    manualPrice: input.manualPrice || null,
    price: 0,
    published: input.published !== false,
    city: input.city || '',
    cityId: input.cityId || '',
    delivery: input.delivery || { mode: 'cities', cityIds: [] },
    providerSummary: input.providerSummary || '',
    images: input.images || [],
    available: false,
    status: 'active',
    createdBy: actor ? actor.id : null,
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
    listingId: null,
    meliItemId: input.meliItemId || null,
    meliCatalogId: input.meliCatalogId || null,
  });
  const draft = !!opts.draft;
  const price = computePrice(product);
  if (!price && !draft) {
    db.remove('officialProducts', product.id);
    throw httpError(400, 'Defina um preço comercial ou custo e margem.');
  }
  const updated = db.update('officialProducts', product.id, {
    price,
    publishedAt: !draft && product.published ? now : null,
    published: draft ? false : product.published !== false,
    sellerId: seller.id,
    meliItemId: input.meliItemId || null,
    meliCatalogId: input.meliCatalogId || null,
  });
  const listing = syncListing(updated);
  refreshProductAvailability(updated.id);
  return {
    product: db.findById('officialProducts', updated.id),
    listing: db.findById('listings', listing.id),
  };
}

function updateProduct(id, body) {
  const product = productOf(id);
  if (!product) throw httpError(404, 'Produto oficial não encontrado.');
  const input = sanitizeProductInput(body, product);
  const patch = { ...input, updatedAt: new Date().toISOString() };
  if (patch.published !== undefined) {
    patch.publishedAt = patch.published ? (product.publishedAt || new Date().toISOString()) : null;
  }
  let next = db.update('officialProducts', product.id, patch);
  next = db.update('officialProducts', next.id, { price: computePrice(next) });
  const listing = syncListing(next);
  refreshProductAvailability(next.id);
  return {
    product: db.findById('officialProducts', next.id),
    listing: db.findById('listings', listing.id),
  };
}

function deleteProduct(id) {
  const product = productOf(id);
  if (!product) throw httpError(404, 'Produto oficial não encontrado.');
  db.findWhere('officialProductOffers', (o) => o.productId === product.id).forEach((o) => db.remove('officialProductOffers', o.id));
  removeListing(product);
  db.remove('officialProducts', product.id);
  return { ok: true, id: product.id };
}

function sanitizeOfferInput(body, current) {
  const b = body || {};
  const out = {};
  if (b.provider !== undefined || !current) {
    out.provider = assertProvider(b.provider);
  }
  if (b.price !== undefined || !current) {
    out.price = optionalMoney(b.price === undefined ? 0 : b.price);
    if (out.price === null) out.price = 0;
  }
  if (b.previousPrice !== undefined) {
    out.previousPrice = optionalMoney(b.previousPrice);
  }
  const providerHint = b.provider !== undefined ? b.provider : (current && current.provider);
  if (b.url !== undefined || !current) {
    if (providerHint === 'catira') {
      out.url = '';
    } else {
      const raw = String(b.url || '').trim();
      out.url = raw ? normalizeOfferUrl(raw) : '';
    }
  }
  if (b.stock !== undefined) {
    const stockRaw = Number(b.stock);
    out.stock = Number.isFinite(stockRaw) && stockRaw > 0 ? Math.floor(stockRaw) : 0;
  }
  if (b.enabled !== undefined) out.enabled = !!b.enabled;
  if (b.status !== undefined) {
    if (!OFFER_STATUS.includes(b.status)) throw httpError(400, 'Situação da oferta inválida.');
    out.status = b.status;
  }
  if (b.source !== undefined) out.source = b.source === 'process' ? 'process' : 'manual';
  if (b.affiliateTag !== undefined) out.affiliateTag = String(b.affiliateTag || '').trim().slice(0, 120);
  if (b.note !== undefined) out.note = String(b.note || '').trim().slice(0, 300);
  if (b.externalId !== undefined) out.externalId = String(b.externalId || '').trim() || null;
  if (b.meliUserId !== undefined) out.meliUserId = b.meliUserId || null;
  const next = { ...(current || {}), ...out };
  const provider = next.provider;
  const status = next.status || 'manual';
  const enabled = next.enabled !== false;
  const wantsLive = enabled && LIVE_STATUSES.includes(status);
  if (isExternalProvider(provider)) {
    if (wantsLive && !isSafeHttpUrl(next.url)) {
      throw httpError(400, 'Oferta ativa precisa de um link http(s) válido.');
    }
  }
  if (provider === 'catira') {
    if (b.commercialReady === true || b.commercialAvailability === 'available') {
      throw httpError(400, 'A compra pelo Catira ainda não está disponível nesta fase.');
    }
    out.commercialReady = false;
    if (b.buyEnabled !== undefined) out.buyEnabled = !!b.buyEnabled;
    if (b.url !== undefined || !current) out.url = '';
  }
  if (next.source !== 'process') next.source = 'manual';
  if (!next.status) next.status = 'manual';
  if (next.enabled === undefined) next.enabled = true;
  return out;
}

function upsertOffer(productId, body, actor) {
  const product = productOf(productId);
  if (!product) throw httpError(404, 'Produto oficial não encontrado.');
  const input = sanitizeOfferInput(body, null);
  if (input.status === undefined) input.status = 'manual';
  if (input.enabled === undefined) input.enabled = true;
  const now = new Date().toISOString();
  const existing = db.findOne(
    'officialProductOffers',
    (o) => o.productId === product.id && o.provider === input.provider
  );
  const patch = {
    ...input,
    productId: product.id,
    lastSyncAt: input.source === 'process' ? now : (existing ? existing.lastSyncAt : null),
    lastCheckedAt: now,
    updatedAt: now,
    updatedBy: actor ? actor.id : null,
  };
  if (input.provider === 'catira') {
    patch.commercialReady = false;
    patch.url = '';
    if (input.buyEnabled === undefined) {
      patch.buyEnabled = existing ? !!existing.buyEnabled : false;
    }
  }
  const row = existing
    ? db.update('officialProductOffers', existing.id, patch)
    : db.insert('officialProductOffers', { ...patch, createdAt: now, previousPrice: input.previousPrice || null });
  refreshProductAvailability(product.id, { now: Date.now() });
  logOfficial(actor, existing ? 'offer_updated' : 'offer_created', {
    productId: product.id,
    offerId: row.id,
    provider: row.provider,
    status: row.status,
  });
  return { offer: row, product: productOf(product.id) };
}

function updateOffer(productId, offerId, body, actor) {
  const product = productOf(productId);
  if (!product) throw httpError(404, 'Produto oficial não encontrado.');
  const offer = db.findById('officialProductOffers', offerId);
  if (!offer || offer.productId !== product.id) throw httpError(404, 'Oferta não encontrada.');
  const input = sanitizeOfferInput(body, offer);
  const now = new Date().toISOString();
  const patch = {
    ...input,
    lastCheckedAt: now,
    updatedAt: now,
    updatedBy: actor ? actor.id : null,
  };
  if ((input.provider || offer.provider) === 'catira') {
    patch.commercialReady = false;
    patch.url = '';
  }
  const row = db.update('officialProductOffers', offer.id, patch);
  refreshProductAvailability(product.id, { now: Date.now() });
  logOfficial(actor, 'offer_updated', {
    productId: product.id,
    offerId: row.id,
    provider: row.provider,
    status: row.status,
  });
  return { offer: row, product: productOf(product.id) };
}

function setOfferStatus(productId, offerId, status, actor) {
  return updateOffer(productId, offerId, { status }, actor);
}

function removeOffer(productId, offerId, actor) {
  const product = productOf(productId);
  if (!product) throw httpError(404, 'Produto oficial não encontrado.');
  const offer = db.findById('officialProductOffers', offerId);
  if (!offer || offer.productId !== product.id) throw httpError(404, 'Oferta não encontrada.');
  db.remove('officialProductOffers', offer.id);
  refreshProductAvailability(product.id, { now: Date.now() });
  logOfficial(actor, 'offer_removed', { productId: product.id, offerId: offer.id, provider: offer.provider });
  return { ok: true, id: offer.id };
}

// Sem oferta confiável a oferta some do catálogo, conforme decisão aprovada.
function refreshProductAvailability(productId, opts = {}) {
  const product = productOf(productId);
  if (!product) return null;
  const live = offersOf(product.id, opts);
  const shouldPublish = !!product.published && live.length > 0;
  let next = product;
  if (!!product.available !== shouldPublish) {
    next = db.update('officialProducts', product.id, { available: shouldPublish, updatedAt: new Date().toISOString() });
  }
  if (next.listingId) {
    const listing = db.findById('listings', next.listingId);
    if (listing) {
      const status = shouldPublish ? 'published' : 'paused';
      if (listing.status !== status) db.update('listings', listing.id, { status });
    }
  }
  return next;
}

function offerIncomplete(offer) {
  if (!offer) return true;
  if (isExternalProvider(offer.provider) && !isSafeHttpUrl(offer.url)) return true;
  if (offer.provider === 'catira' && !(money2(offer.price) > 0)) return true;
  return false;
}

function serializeOffer(offer, opts = {}) {
  const now = opts.now || Date.now();
  const live = offerIsLive(offer, now);
  const publicView = !!opts.public;
  const catira = offer.provider === 'catira';
  const catiraBuy = catira && offer.buyEnabled === true && money2(offer.price) > 0;
  return {
    id: offer.id,
    provider: offer.provider,
    providerLabel: PROVIDER_LABEL[offer.provider] || offer.provider,
    price: offer.price || 0,
    previousPrice: offer.previousPrice || null,
    url: catira ? '' : (publicView ? (live ? offer.url : '') : (offer.url || '')),
    stock: offer.stock || 0,
    enabled: offer.enabled !== false,
    status: offer.status || 'manual',
    source: offer.source || 'manual',
    live,
    incomplete: offerIncomplete(offer),
    commercialReady: catira ? false : undefined,
    commercialAvailability: catira ? (catiraBuy ? 'available' : 'preparing') : undefined,
    buyEnabled: catira ? catiraBuy : undefined,
    affiliateTag: publicView ? undefined : (offer.affiliateTag || ''),
    note: publicView ? undefined : (offer.note || ''),
    lastSyncAt: publicView ? undefined : (offer.lastSyncAt || null),
    lastCheckedAt: publicView ? undefined : (offer.lastCheckedAt || null),
    updatedAt: offer.updatedAt || null,
    createdAt: offer.createdAt || null,
    externalId: publicView ? undefined : (offer.externalId || null),
  };
}

function publicOffersOf(productId, opts = {}) {
  const now = opts.now || Date.now();
  return offersOf(productId, { now }).filter((o) => {
    if (o.provider === 'catira') return money2(o.price) > 0;
    return isExternalProvider(o.provider) && isSafeHttpUrl(o.url);
  });
}

function serializeProduct(product, opts = {}) {
  if (!product) return null;
  const now = opts.now || Date.now();
  const offers = offersOf(product.id, { now, includeHidden: opts.includeHidden !== false }).map((o) => serializeOffer(o, { now }));
  const listing = product.listingId ? db.findById('listings', product.listingId) : null;
  return {
    id: product.id,
    title: product.title,
    description: product.description || '',
    categoryId: product.categoryId,
    subcategory: product.subcategory || '',
    condition: product.condition || 'novo',
    costPrice: money2(product.costPrice),
    pricingRule: product.pricingRule || 'fixed',
    marginValue: money2(product.marginValue),
    manualPrice: product.manualPrice || null,
    price: computePrice(product),
    published: !!product.published,
    available: !!product.available,
    city: product.city || '',
    cityId: product.cityId || '',
    delivery: normalizeCoverage(product.delivery),
    providerSummary: product.providerSummary || '',
    images: Array.isArray(product.images) ? product.images : [],
    listingId: product.listingId || null,
    listingStatus: listing ? listing.status : '',
    offers,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    publishedAt: product.publishedAt || null,
    meliItemId: product.meliItemId || null,
    meliCatalogId: product.meliCatalogId || null,
  };
}

function officialMetaOf(listing) {
  if (!isOfficialListing(listing)) return null;
  const product = officialOfListing(listing);
  if (!product) {
    return {
      isOfficial: true,
      officialProductId: listing.officialProductId || null,
      sellerLabel: PLATFORM_NAME,
      socialEnabled: false,
      delivery: { mode: 'all', cityIds: [] },
      officialOffers: [],
    };
  }
  const now = Date.now();
  return {
    isOfficial: true,
    officialProductId: product.id,
    sellerLabel: PLATFORM_NAME,
    socialEnabled: false,
    delivery: normalizeCoverage(product.delivery),
    officialOffers: publicOffersOf(product.id, { now }).map((o) => serializeOffer(o, { now, public: true })),
  };
}

function listProducts(query = {}) {
  const now = Date.now();
  const q = String(query.q || '').trim().toLowerCase();
  let rows = db.all('officialProducts').slice();
  if (query.status === 'published') rows = rows.filter((p) => p.published);
  if (query.status === 'paused') rows = rows.filter((p) => !p.published);
  if (q) {
    rows = rows.filter((p) => {
      const hay = [p.title, p.description, p.subcategory, p.providerSummary].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }
  rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const page = pageSlice(rows, query);
  return { ...page, items: page.items.map((p) => serializeProduct(p, { now })) };
}

function isEligibleForAlerts() {
  return false;
}

function categoryIdForSlug(slug) {
  const row = db.findOne('categories', (c) => c.slug === slug && c.active !== false);
  const fallback = db.findOne('categories', (c) => c.slug === 'servicos' && c.active !== false);
  return (row || fallback || db.findOne('categories', () => true) || {}).id;
}

function applyMeliOffer(product, item, sale, actor) {
  const meli = require('./meli');
  const money = meli.mapSalePrice(sale || {});
  const status = meli.mapOfferStatus(item);
  return upsertOffer(product.id, {
    provider: 'mercadolivre',
    price: money.price,
    previousPrice: money.previousPrice,
    url: item.permalink,
    stock: Number.isFinite(item.available_quantity) ? Number(item.available_quantity) : 0,
    status,
    source: 'process',
    enabled: true,
    externalId: meli.parseItemId(item.id),
    meliUserId: item.seller_id || null,
  }, actor);
}

function importMappedMeli({ item, descriptionPlain, sale, catalogId, actor }) {
  const meli = require('./meli');
  const ficha = meli.mapFicha(item, descriptionPlain);
  const existing = db.findOne('officialProducts', (p) => p.meliItemId === ficha.meliItemId);
  if (existing) {
    const synced = syncMappedMeli(existing.id, { item, descriptionPlain, sale, catalogId, actor });
    return { ...synced, listing: db.findById('listings', synced.product.listingId), created: false };
  }
  const out = createProduct({
    title: ficha.title,
    description: ficha.description,
    categoryId: categoryIdForSlug(meli.mapCategorySlug(item)),
    condition: ficha.condition,
    images: ficha.images,
    published: false,
    meliItemId: ficha.meliItemId,
    meliCatalogId: catalogId || null,
  }, actor, { draft: true });
  const offerOut = applyMeliOffer(out.product, item, sale, actor);
  return {
    product: productOf(out.product.id),
    offer: offerOut.offer,
    listing: out.listing,
    created: true,
  };
}

function syncMappedMeli(productId, { item, descriptionPlain, sale, catalogId, actor }) {
  const product = productOf(productId);
  if (!product) throw httpError(404, 'Produto oficial não encontrado.');
  const meli = require('./meli');
  const ficha = meli.mapFicha(item, descriptionPlain);
  const updated = updateProduct(product.id, {
    title: ficha.title,
    description: ficha.description,
    condition: ficha.condition,
    images: ficha.images,
    meliItemId: ficha.meliItemId,
    meliCatalogId: catalogId || product.meliCatalogId || null,
  });
  const offerOut = applyMeliOffer(updated.product, item, sale, actor);
  return { product: productOf(updated.product.id), offer: offerOut.offer };
}

module.exports = {
  PLATFORM_ROLE,
  PLATFORM_NAME,
  PLATFORM_EMAIL,
  PROVIDERS,
  EXTERNAL_PROVIDERS,
  PROVIDER_LABEL,
  STALE_HOURS,
  PRICING_RULES,
  ensureOfficialSeller,
  ensureTestPixProduct,
  ensureSampleOfficialProducts,
  SAMPLE_OFFICIAL_PRODUCTS,
  isPlatformUser,
  isPlatformId,
  isOfficialListing,
  officialOfListing,
  officialMetaOf,
  productOf,
  computePrice,
  offerIsLive,
  offersOf,
  hasExternalOffer,
  hasInternalOffer,
  matchesCity,
  resolveCityId,
  normalizeCoverage,
  syncListing,
  removeListing,
  createProduct,
  updateProduct,
  deleteProduct,
  upsertOffer,
  updateOffer,
  setOfferStatus,
  removeOffer,
  publicOffersOf,
  isSafeHttpUrl,
  normalizeOfferUrl,
  refreshProductAvailability,
  serializeOffer,
  serializeProduct,
  listProducts,
  isEligibleForAlerts,
  importMappedMeli,
  syncMappedMeli,
};
