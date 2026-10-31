const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { randomUUID } = require('crypto');
const db = require('../db');
const { authRequired, authOptional, isAdminRole, emailVerifiedRequired } = require('../middleware');
const { serializeListing, isFavorited, pixPayload, confirmPaymentRecord, listingRating, findPromo, promoUsable, normalizePromoCode, LISTING_TYPES, listingTypeOf, expireStalePayments, listingPayment } = require('../helpers');
const { safeUser } = require('../middleware');
const { LISTING_DAYS } = require('../seed');
const { resolveCategory } = require('../categories');
const { getSettings, listingFee, vipListingFee, commonChargingEnabled, vipChargingEnabled, premiumChargingEnabled, parsePremiumDays, quotePremium, premiumUntilIso, takenPremiumDays, premiumDayFee, brazilToday, weekdayOf, premiumRateForDate } = require('../pix');
const QRCode = require('qrcode');

function publicPayment(p) {
  if (!p) return null;
  const cfg = getSettings();
  return {
    id: p.id,
    amount: p.amount,
    originalAmount: p.originalAmount || p.amount,
    discountPercent: p.discountPercent || 0,
    promoCode: p.promoCode || '',
    promoApplied: !!p.promoApplied,
    status: p.status,
    method: p.method,
    kind: p.kind || 'listing',
    premiumQuote: p.premiumQuote || null,
    pixCode: p.pixCode,
    transactionId: p.transactionId,
    pixKey: p.pixKey || cfg.pixKey,
    createdAt: p.createdAt,
    paidAt: p.paidAt,
    userDeclaredAt: p.userDeclaredAt || null,
    upgrade: !!p.upgrade,
    configured: cfg.configured,
    merchantName: cfg.merchantName,
  };
}

const router = express.Router();

const UPLOADS = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 8) || '.jpg';
    cb(null, randomUUID() + ext);
  },
});

const MIN_PHOTOS = 3;
const MAX_PHOTOS = 8;

function parsePrice(raw) {
  if (raw === undefined || raw === null || raw === '') return NaN;
  const str = String(raw).trim();
  if (!str) return NaN;
  const normalized = str.includes(',')
    ? str.replace(/\./g, '').replace(',', '.')
    : str.replace(/[^\d.]/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024, files: MAX_PHOTOS },
  fileFilter: (_req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error('Envie apenas imagens.'));
    cb(null, true);
  },
});

function applyFilters(list, q) {
  let out = list.slice();
  const search = (q.q || q.search || '').trim().toLowerCase();
  if (search) {
    out = out.filter((l) => {
      const cat = db.findById('categories', l.categoryId);
      const hay = [l.title, l.description, l.subcategory, cat && cat.name, l.city]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(search);
    });
  }
  if (q.category) {
    const cat = resolveCategory(q.category);
    if (cat) out = out.filter((l) => l.categoryId === cat.id);
  }
  if (q.city) {
    const city = String(q.city).toLowerCase();
    out = out.filter(
      (l) =>
        (l.cityId && l.cityId === q.city) ||
        (l.city && l.city.toLowerCase().includes(city))
    );
  }
  const minP = parsePrice(q.minPrice);
  const maxP = parsePrice(q.maxPrice);
  if (Number.isFinite(minP) && minP > 0) out = out.filter((l) => Number(l.price) >= minP);
  if (Number.isFinite(maxP) && maxP > 0) out = out.filter((l) => Number(l.price) <= maxP);
  if (q.condition) out = out.filter((l) => l.condition === q.condition);
  if (q.acceptsTrade === 'true' || q.acceptsTrade === '1') {
    out = out.filter((l) => listingTypeOf(l) === 'troca' || listingTypeOf(l) === 'venda_troca' || l.acceptsTrade);
  }
  if (q.type) {
    const t = String(q.type);
    if (LISTING_TYPES.includes(t)) out = out.filter((l) => listingTypeOf(l) === t);
  }
  const sort = q.sort || 'recent';
  if (sort === 'price_asc') out.sort((a, b) => a.price - b.price);
  else if (sort === 'price_desc') out.sort((a, b) => b.price - a.price);
  else if (sort === 'views') out.sort((a, b) => (b.views || 0) - (a.views || 0));
  else {
    out.sort(
      (a, b) =>
        new Date(b.publishedAt || b.createdAt) - new Date(a.publishedAt || a.createdAt)
    );
  }
  if (sort === 'recent' && q.boost !== '0') {
    const liveFeatured = (l) => !!(l.featured && (!l.featuredUntil || new Date(l.featuredUntil).getTime() > Date.now())) || !!l.vip || !!l.premium;
    out.sort((a, b) => {
      const af = liveFeatured(a) ? 1 : 0;
      const bf = liveFeatured(b) ? 1 : 0;
      if (bf !== af) return bf - af;
      return new Date(b.publishedAt || b.createdAt) - new Date(a.publishedAt || a.createdAt);
    });
  }
  return out;
}

router.get('/', authOptional, (req, res) => {
  let list = db.findWhere('listings', (l) => l.status === 'published');
  if (req.query.trade === 'true' || req.query.section === 'catiras') {
    list = list.filter((l) => listingTypeOf(l) === 'troca' || listingTypeOf(l) === 'venda_troca' || l.acceptsTrade);
  }
  if (req.query.section === 'procuro' || req.query.type === 'procuro') {
    list = list.filter((l) => listingTypeOf(l) === 'procuro');
  }
  if (req.query.section === 'destaque') {
    list = list.filter((l) => l.vip || l.premium || (l.featured && (!l.featuredUntil || new Date(l.featuredUntil).getTime() > Date.now())));
  }
  list = applyFilters(list, req.query);
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(48, Math.max(1, parseInt(req.query.limit || '24', 10)));
  const start = (page - 1) * limit;
  const slice = list.slice(start, start + limit);
  const uid = req.user && req.user.id;
  res.json({
    total: list.length,
    page,
    limit,
    items: slice.map((l) => serializeListing(l, { favorited: isFavorited(uid, l.id), user: req.user, userId: uid })),
  });
});

router.get('/premium-days', authOptional, (req, res) => {
  const from = brazilToday();
  const span = Math.min(30, Math.max(7, parseInt(req.query.days || '14', 10)));
  const taken = new Set(takenPremiumDays());
  const full = premiumDayFee();
  const items = [];
  for (let i = 0; i < span; i++) {
    const dt = new Date(from + 'T15:00:00.000Z');
    dt.setUTCDate(dt.getUTCDate() + i);
    const date = dt.toISOString().slice(0, 10);
    items.push({
      date,
      weekday: weekdayOf(date),
      rate: premiumRateForDate(date, full),
      taken: taken.has(date),
    });
  }
  res.json({ full, items, taken: [...taken] });
});

router.get('/mine', authRequired, (req, res) => {
  expireStalePayments();
  const status = req.query.status;
  let list = db.findWhere('listings', (l) => l.userId === req.user.id);
  if (status) list = list.filter((l) => l.status === status);
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ items: list.map((l) => serializeListing(l, { user: req.user, userId: req.user.id })) });
});

// Palavras que indicam produto proibido/suspeito. Análise para moderação, não bloqueio automático.
const MODERATION_WORDS = ['arma', 'municao', 'munição', 'droga', 'maconha', 'cocaina', 'cocaína', 'remedio controlado', 'remédio controlado', 'documento falso', 'orgao humano', 'órgão humano', 'medicamento controlado', 'cigarro eletronico', 'vape'];

function normalizeText(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokens(s) {
  return normalizeText(s).split(' ').filter((t) => t.length > 2);
}

// Sinaliza possível duplicidade comparando com os anúncios ativos do próprio usuário.
function findDuplicate(userId, title) {
  const base = new Set(tokens(title));
  if (base.size < 2) return null;
  const mine = db.findWhere('listings', (l) => l.userId === userId && l.status !== 'cancelled' && l.status !== 'rejected');
  let best = null;
  let bestScore = 0;
  for (const l of mine) {
    const t = new Set(tokens(l.title));
    if (!t.size) continue;
    let common = 0;
    base.forEach((x) => { if (t.has(x)) common += 1; });
    const score = common / Math.min(base.size, t.size);
    if (score > bestScore) { bestScore = score; best = l; }
  }
  return bestScore >= 0.7 ? { id: best.id, title: best.title, status: best.status } : null;
}

// Estimativa de preço baseada em anúncios publicados da mesma categoria (dados reais).
function priceEstimate(categoryId) {
  const prices = db
    .findWhere('listings', (l) => l.categoryId === categoryId && l.status === 'published' && Number(l.price) > 0)
    .map((l) => Number(l.price));
  if (prices.length < 3) return null;
  prices.sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
  return {
    min: Math.max(1, Math.round(median * 0.7)),
    max: Math.round(median * 1.3),
    sample: prices.length,
  };
}

router.post('/assistant/analyze', authRequired, upload.single('photo'), async (req, res) => {
  const file = req.file;
  const cleanup = () => { if (file && file.path) { try { fs.unlinkSync(file.path); } catch {} } };
  if (!file) return res.status(400).json({ error: 'Tire ou escolha uma foto do produto para começar.' });
  const { assistantReady, analyzeImage } = require('../assistant');
  if (!assistantReady()) {
    cleanup();
    return res.status(400).json({ error: 'O recurso de foto inteligente ainda não está ativo. Fale com o administrador.', code: 'ASSISTANT_OFF' });
  }
  try {
    const dataUrl = 'data:' + (file.mimetype || 'image/jpeg') + ';base64,' + fs.readFileSync(file.path).toString('base64');
    const categories = db.findWhere('categories', (c) => c.active !== false).map((c) => ({ id: c.id, slug: c.slug, name: c.name }));
    const analysis = await analyzeImage({
      dataUrl,
      categories,
      listingType: req.body && req.body.listingType,
      hint: req.body && req.body.hint,
      city: req.body && req.body.city,
    });
    cleanup();
    const haystack = normalizeText([analysis.title, analysis.description, analysis.productName, req.body && req.body.hint].join(' '));
    const wordHit = MODERATION_WORDS.find((w) => haystack.includes(normalizeText(w)));
    const prohibited = analysis.prohibited || !!wordHit;
    const duplicate = findDuplicate(req.user.id, analysis.title || analysis.productName);
    const estimate = analysis.categoryId ? priceEstimate(analysis.categoryId) : null;
    res.json({
      analysis: {
        ...analysis,
        prohibited,
        prohibitedReason: analysis.prohibitedReason || (wordHit ? 'Possível produto proibido ou que exige análise.' : ''),
        duplicate,
        priceEstimate: estimate,
      },
    });
  } catch (e) {
    cleanup();
    res.status(e.status || 400).json({ error: e.message || 'Não foi possível analisar a foto.' });
  }
});

router.post('/assistant/improve', authRequired, async (req, res) => {
  const { assistantReady, improveText } = require('../assistant');
  if (!assistantReady()) {
    return res.status(400).json({ error: 'O recurso de foto inteligente ainda não está ativo. Fale com o administrador.', code: 'ASSISTANT_OFF' });
  }
  const b = req.body || {};
  if (!String(b.title || '').trim() && !String(b.description || '').trim()) {
    return res.status(400).json({ error: 'Escreva algo antes de pedir para melhorar.' });
  }
  try {
    const cat = b.categoryId ? db.findById('categories', b.categoryId) : null;
    const improved = await improveText({
      title: b.title,
      description: b.description,
      listingType: b.listingType,
      categoryName: cat ? cat.name : '',
    });
    res.json({ suggestion: improved });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || 'Não foi possível melhorar o texto.' });
  }
});

router.get('/:id', authOptional, (req, res) => {
  expireStalePayments();
  const l = db.findById('listings', req.params.id);
  if (!l) return res.status(404).json({ error: 'Anúncio não encontrado.' });
  const isOwner = req.user && req.user.id === l.userId;
  const isAdmin = req.user && isAdminRole(req.user.role);
  if (l.status !== 'published' && !isOwner && !isAdmin) {
    return res.status(404).json({ error: 'Anúncio não encontrado.' });
  }
  if (l.status === 'published') {
    db.update('listings', l.id, { views: (l.views || 0) + 1 });
    l.views = (l.views || 0) + 1;
  }
  const uid = req.user && req.user.id;
  res.json(serializeListing(l, { favorited: isFavorited(uid, l.id), userId: uid, user: req.user }));
});

router.get('/:id/reviews', authOptional, (req, res) => {
  const l = db.findById('listings', req.params.id);
  if (!l) return res.status(404).json({ error: 'Anúncio não encontrado.' });
  const items = db
    .findWhere('listingReviews', (r) => r.listingId === l.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment || '',
      createdAt: r.createdAt,
      user: safeUser(db.findById('users', r.userId)),
    }));
  res.json({ items, ...listingRating(l.id, req.user && req.user.id) });
});

router.post('/:id/reviews', authRequired, (req, res) => {
  const l = db.findById('listings', req.params.id);
  if (!l) return res.status(404).json({ error: 'Anúncio não encontrado.' });
  if (l.status !== 'published' && l.status !== 'sold') {
    return res.status(400).json({ error: 'Este anúncio ainda não pode ser avaliado.' });
  }
  if (l.userId === req.user.id) {
    return res.status(400).json({ error: 'Você não pode avaliar o próprio anúncio.' });
  }
  const rating = Number(req.body && req.body.rating);
  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Dê uma nota de 1 a 5.' });
  }
  const comment = req.body && req.body.comment ? String(req.body.comment).trim().slice(0, 400) : '';
  const now = new Date().toISOString();
  const existing = db.findOne(
    'listingReviews',
    (r) => r.listingId === l.id && r.userId === req.user.id
  );
  let row;
  if (existing) {
    row = db.update('listingReviews', existing.id, { rating, comment, updatedAt: now });
  } else {
    row = db.insert('listingReviews', {
      listingId: l.id,
      userId: req.user.id,
      rating,
      comment,
      createdAt: now,
      updatedAt: now,
    });
  }
  res.json({
    review: row,
    listing: serializeListing(l, { favorited: isFavorited(req.user.id, l.id), userId: req.user.id, user: req.user }),
  });
});

router.post('/', authRequired, emailVerifiedRequired, upload.array('photos', MAX_PHOTOS), (req, res) => {
  const b = req.body || {};
  const listingType = LISTING_TYPES.includes(b.listingType) ? b.listingType : (b.acceptsTrade === 'true' || b.acceptsTrade === true ? 'venda_troca' : 'venda');
  if (!b.title || !b.description || !b.categoryId || b.price === undefined || b.price === '') {
    return res.status(400).json({ error: 'Preencha título, descrição, categoria e preço.' });
  }
  const price = parsePrice(b.price);
  if (!Number.isFinite(price) || price <= 0) {
    return res.status(400).json({ error: 'Informe um preço válido, apenas com números.' });
  }
  const files = req.files || [];
  if (listingType !== 'procuro' && files.length < MIN_PHOTOS) {
    files.forEach((f) => {
      try { fs.unlinkSync(f.path); } catch {}
    });
    return res.status(400).json({ error: 'Adicione no mínimo 3 fotos do produto.' });
  }
  const cat = db.findById('categories', b.categoryId);
  if (!cat) return res.status(400).json({ error: 'Categoria inválida.' });
  if ((listingType === 'troca' || listingType === 'venda_troca') && !String(b.tradeWishes || '').trim()) {
    return res.status(400).json({ error: 'Diga o que você aceita em troca.' });
  }

  const now = new Date().toISOString();
  const wantsPremium = b.premium === 'true' || b.premium === true;
  const wantsVip = !wantsPremium && (b.vip === 'true' || b.vip === true);
  const commonOn = commonChargingEnabled();
  const vipOn = vipChargingEnabled();
  const premiumOn = premiumChargingEnabled();
  let premiumDays = [];
  let premiumQuote = null;
  if (wantsPremium) {
    premiumDays = parsePremiumDays(b.premiumDays);
    if (!premiumDays.length) {
      return res.status(400).json({ error: 'Escolha pelo menos um dia para o anúncio Premium.' });
    }
    const taken = new Set(takenPremiumDays());
    const clash = premiumDays.filter((d) => taken.has(d));
    if (clash.length) {
      return res.status(400).json({ error: 'Essas datas Premium já foram reservadas: ' + clash.join(', ') + '.' });
    }
    premiumQuote = quotePremium(premiumDays);
    if (premiumOn && !premiumQuote.total) {
      return res.status(400).json({ error: 'Não foi possível calcular o valor Premium.' });
    }
  }
  const acceptsTrade = listingType === 'troca' || listingType === 'venda_troca';
  const listing = db.insert('listings', {
    userId: req.user.id,
    title: String(b.title).trim(),
    description: String(b.description).trim(),
    categoryId: b.categoryId,
    subcategory: b.subcategory ? String(b.subcategory).trim() : '',
    price: Math.round(price * 100) / 100,
    condition: b.condition || 'usado',
    city: b.city || req.user.city,
    cityId: b.cityId || req.user.cityId || '',
    listingType,
    acceptsTrade,
    acceptsCash: b.acceptsCash === 'true' || b.acceptsCash === true,
    tradeWishes: b.tradeWishes ? String(b.tradeWishes).trim() : '',
    status: 'awaiting_payment',
    featured: !!wantsVip,
    vip: wantsVip,
    premium: wantsPremium,
    premiumDays,
    premiumUntil: wantsPremium ? premiumUntilIso(premiumDays[premiumDays.length - 1]) : null,
    quickOfferEnabled: listingType !== 'procuro' && (b.quickOfferEnabled === 'true' || b.quickOfferEnabled === true),
    waitForEvaluation: listingType !== 'procuro' && (b.waitForEvaluation === 'true' || b.waitForEvaluation === true),
    views: 0,
    createdAt: now,
    publishedAt: null,
    expiresAt: null,
    paidAt: null,
  });
  try {
    require('../lance').onListingCreated(listing, {
      quickOfferEnabled: !!listing.quickOfferEnabled,
      waitForEvaluation: !!listing.waitForEvaluation,
    }, req.user);
  } catch {}

  files.forEach((f, idx) => {
    db.insert('listingImages', {
      listingId: listing.id,
      url: `/uploads/${f.filename}`,
      color: '#E85D04',
      label: listing.title,
      emoji: '',
      order: idx,
    });
  });

  const kind = listing.premium ? 'premium_listing' : (listing.vip ? 'vip_listing' : 'listing');
  const mustPay = listing.premium ? premiumOn : (listing.vip ? vipOn : commonOn);
  const fee = !mustPay ? 0 : (listing.premium ? premiumQuote.total : (listing.vip ? vipListingFee() : listingFee()));
  let payment = db.insert('payments', {
    userId: req.user.id,
    listingId: listing.id,
    kind,
    amount: fee,
    originalAmount: fee,
    discountPercent: 0,
    promoCode: '',
    promoApplied: !mustPay,
    premiumQuote: listing.premium ? premiumQuote : null,
    status: mustPay ? 'pending' : 'paid',
    method: mustPay ? 'pix' : 'free',
    transactionId: ('CATIRA' + listing.id.replace(/-/g, '')).slice(0, 25),
    pixCode: '',
    pixKey: '',
    createdAt: now,
    paidAt: mustPay ? null : now,
    userDeclaredAt: null,
  });

  if (!mustPay) {
    const published = confirmPaymentRecord(payment, listing);
    payment = db.findById('payments', payment.id);
    return res.status(201).json({
      listing: serializeListing(published),
      payment: publicPayment(payment),
      fee: 0,
      published: true,
      feeEnabled: false,
      pixConfigured: getSettings().configured,
    });
  }

  res.status(201).json({
    listing: serializeListing(listing),
    payment: publicPayment(payment),
    fee,
    published: false,
    feeEnabled: true,
    pixConfigured: getSettings().configured,
  });
});

router.put('/:id', authRequired, upload.array('photos', MAX_PHOTOS), (req, res) => {
  const l = db.findById('listings', req.params.id);
  if (!l) return res.status(404).json({ error: 'Anúncio não encontrado.' });
  if (l.userId !== req.user.id && !isAdminRole(req.user.role)) {
    return res.status(403).json({ error: 'Sem permissão.' });
  }
  const b = req.body || {};
  const patch = {};
  ['title', 'description', 'subcategory', 'condition', 'city', 'cityId', 'tradeWishes', 'listingType'].forEach(
    (k) => {
      if (b[k] !== undefined) patch[k] = b[k];
    }
  );
  if (b.listingType && LISTING_TYPES.includes(b.listingType)) {
    patch.listingType = b.listingType;
    patch.acceptsTrade = b.listingType === 'troca' || b.listingType === 'venda_troca';
  }
  if (b.acceptsCash !== undefined) patch.acceptsCash = b.acceptsCash === 'true' || b.acceptsCash === true;
  if (b.categoryId) patch.categoryId = b.categoryId;
  if (b.price !== undefined) {
    const p = parsePrice(b.price);
    if (!Number.isFinite(p) || p <= 0) {
      return res.status(400).json({ error: 'Informe um preço válido, apenas com números.' });
    }
    patch.price = Math.round(p * 100) / 100;
  }
  if (b.acceptsTrade !== undefined) {
    patch.acceptsTrade = b.acceptsTrade === 'true' || b.acceptsTrade === true;
  }
  if (b.quickOfferEnabled !== undefined) {
    patch.quickOfferEnabled = b.quickOfferEnabled === 'true' || b.quickOfferEnabled === true;
  }
  if (b.waitForEvaluation !== undefined) {
    patch.waitForEvaluation = b.waitForEvaluation === 'true' || b.waitForEvaluation === true;
  }
  if (b.keepImageIds !== undefined) {
    let keepIds = b.keepImageIds;
    if (typeof keepIds === 'string') {
      try { keepIds = JSON.parse(keepIds); } catch { keepIds = []; }
    }
    if (!Array.isArray(keepIds)) keepIds = [];
    keepIds = keepIds.map(String);
    const existing = db.findWhere('listingImages', (i) => i.listingId === l.id);
    existing.forEach((img) => {
      if (!keepIds.includes(String(img.id))) db.remove('listingImages', img.id);
    });
    keepIds.forEach((id, idx) => {
      const img = db.findById('listingImages', id);
      if (img && img.listingId === l.id) db.update('listingImages', img.id, { order: idx });
    });
  }
  const files = req.files || [];
  if (files.length) {
    const existing = db.findWhere('listingImages', (i) => i.listingId === l.id);
    if (existing.length + files.length > MAX_PHOTOS) {
      return res.status(400).json({ error: 'No máximo 8 fotos por anúncio.' });
    }
    files.forEach((f, idx) => {
      db.insert('listingImages', {
        listingId: l.id,
        url: `/uploads/${f.filename}`,
        color: '#E85D04',
        label: l.title,
        emoji: '',
        order: existing.length + idx,
      });
    });
  }
  const listingType = patch.listingType || l.listingType;
  const isWant = listingType === 'procuro';
  const photoCount = db.findWhere('listingImages', (i) => i.listingId === l.id).length;
  if (!isWant && photoCount < MIN_PHOTOS) {
    return res.status(400).json({ error: 'Adicione no mínimo 3 fotos do produto.' });
  }
  if (l.userId === req.user.id && !isAdminRole(req.user.role)) {
    if (!req.user.emailVerified && ['published', 'paused', 'changes_requested', 'awaiting_review'].includes(l.status)) {
      return res.status(403).json({ error: 'Confirme seu e-mail para publicar um anúncio.', emailVerifyRequired: true });
    }
    if (l.status === 'changes_requested') {
      const prev = l.previousStatus || 'awaiting_payment';
      patch.status = prev === 'published' || prev === 'paused' ? 'awaiting_review' : prev;
      patch.adminNote = '';
      patch.previousStatus = '';
      patch.reviewedAt = null;
    } else if (['published', 'paused', 'awaiting_review'].includes(l.status)) {
      if (l.status !== 'awaiting_review') patch.previousStatus = l.status;
      patch.status = 'awaiting_review';
      patch.adminNote = '';
      patch.reviewedAt = null;
    }
  }
  const updated = db.update('listings', l.id, patch);
  try {
    if (updated && updated.quickOfferEnabled) {
      require('../lance').onListingCreated(updated, {
        quickOfferEnabled: true,
        waitForEvaluation: !!updated.waitForEvaluation,
      }, req.user);
    }
  } catch {}
  res.json(serializeListing(updated, { user: req.user }));
});

router.post('/:id/status', authRequired, (req, res) => {
  const l = db.findById('listings', req.params.id);
  if (!l) return res.status(404).json({ error: 'Anúncio não encontrado.' });
  if (l.userId !== req.user.id && !isAdminRole(req.user.role)) {
    return res.status(403).json({ error: 'Sem permissão.' });
  }
  const action = req.body && req.body.action;
  const now = new Date().toISOString();
  let status = l.status;
  const patch = {};
  if (action === 'pause' && l.status === 'published') status = 'paused';
  else if (action === 'resume' && l.status === 'paused') {
    if (!isAdminRole(req.user.role) && !req.user.emailVerified) {
      return res.status(403).json({ error: 'Confirme seu e-mail para publicar um anúncio.', emailVerifyRequired: true });
    }
    status = 'published';
  }
  else if (action === 'sold') status = 'sold';
  else if (action === 'traded') status = 'traded';
  else if (action === 'negotiated') status = 'negotiated';
  else if (action === 'close' || action === 'cancel') {
    if (l.status === 'awaiting_confirmation') {
      return res.status(400).json({ error: 'Aguarde a confirmação do pagamento ou fale com o suporte se expirar.' });
    }
    status = 'cancelled';
  }
  else if (action === 'resubmit' && l.status === 'changes_requested') {
    if (!isAdminRole(req.user.role) && !req.user.emailVerified) {
      return res.status(403).json({ error: 'Confirme seu e-mail para publicar um anúncio.', emailVerifyRequired: true });
    }
    const prev = l.previousStatus || 'awaiting_payment';
    status = prev === 'published' ? 'awaiting_review' : prev;
    patch.adminNote = '';
    patch.previousStatus = '';
    patch.reviewedAt = null;
  }
  else if (action === 'renew' && ['expired', 'paused', 'published'].includes(l.status)) {
    if (!isAdminRole(req.user.role) && !req.user.emailVerified) {
      return res.status(403).json({ error: 'Confirme seu e-mail para publicar um anúncio.', emailVerifyRequired: true });
    }
    status = 'published';
    patch.expiresAt = new Date(Date.now() + LISTING_DAYS * 86400000).toISOString();
    patch.publishedAt = now;
  } else {
    return res.status(400).json({ error: 'Ação inválida para o status atual.' });
  }
  patch.status = status;
  const updated = db.update('listings', l.id, patch);
  const out = serializeListing(updated);
  if (['sold', 'traded', 'negotiated'].includes(updated.status) && ['sold', 'traded', 'negotiated'].includes(action)) {
    try {
      const { canInvite } = require('../action');
      out.actionInvite = canInvite(updated);
    } catch {
      out.actionInvite = false;
    }
  }
  res.json(out);
});

router.post('/:id/upgrade', authRequired, emailVerifiedRequired, (req, res) => {
  expireStalePayments();
  const l = db.findById('listings', req.params.id);
  if (!l) return res.status(404).json({ error: 'Anúncio não encontrado.' });
  if (l.userId !== req.user.id && !isAdminRole(req.user.role)) {
    return res.status(403).json({ error: 'Sem permissão.' });
  }
  if (!['published', 'paused'].includes(l.status)) {
    return res.status(400).json({ error: 'Só dá para turbinar anúncio ativo ou pausado.' });
  }
  const open = listingPayment(l.id);
  if (open && open.status !== 'paid' && open.status !== 'rejected' && open.status !== 'expired') {
    return res.status(400).json({ error: 'Já existe um pagamento em aberto para este anúncio.' });
  }
  const b = req.body || {};
  const wantsPremium = b.plan === 'premium' || b.premium === true || b.premium === 'true';
  const wantsVip = !wantsPremium && (b.plan === 'vip' || b.plan === 'destaque' || b.vip === true || b.vip === 'true');
  if (!wantsPremium && !wantsVip) {
    return res.status(400).json({ error: 'Escolha Destaque ou Premium.' });
  }
  if (wantsVip && (l.vip || l.featured)) {
    return res.status(400).json({ error: 'Este anúncio já está em destaque.' });
  }
  if (l.premium) {
    return res.status(400).json({ error: 'Este anúncio já é Premium.' });
  }
  const vipOn = vipChargingEnabled();
  const premiumOn = premiumChargingEnabled();
  let premiumDays = [];
  let premiumQuote = null;
  if (wantsPremium) {
    premiumDays = parsePremiumDays(b.premiumDays);
    if (!premiumDays.length) {
      return res.status(400).json({ error: 'Escolha pelo menos um dia para o anúncio Premium.' });
    }
    const taken = new Set(takenPremiumDays(l.id));
    const clash = premiumDays.filter((d) => taken.has(d));
    if (clash.length) {
      return res.status(400).json({ error: 'Essas datas Premium já foram reservadas: ' + clash.join(', ') + '.' });
    }
    premiumQuote = quotePremium(premiumDays);
    if (premiumOn && !premiumQuote.total) {
      return res.status(400).json({ error: 'Não foi possível calcular o valor Premium.' });
    }
  }
  const now = new Date().toISOString();
  const kind = wantsPremium ? 'premium_listing' : 'vip_listing';
  const mustPay = wantsPremium ? premiumOn : vipOn;
  const fee = !mustPay ? 0 : (wantsPremium ? premiumQuote.total : vipListingFee());
  let payment = db.insert('payments', {
    userId: req.user.id,
    listingId: l.id,
    kind,
    amount: fee,
    originalAmount: fee,
    discountPercent: 0,
    promoCode: '',
    promoApplied: !mustPay,
    premiumQuote: wantsPremium ? premiumQuote : null,
    premiumDays: wantsPremium ? premiumDays : [],
    status: mustPay ? 'pending' : 'paid',
    method: mustPay ? 'pix' : 'free',
    transactionId: ('CATIRA' + l.id.replace(/-/g, '') + Date.now().toString(36)).replace(/[^A-Za-z0-9]/g, '').slice(0, 25),
    pixCode: '',
    pixKey: '',
    createdAt: now,
    paidAt: mustPay ? null : now,
    userDeclaredAt: null,
    upgrade: true,
  });
  if (!mustPay) {
    const live = confirmPaymentRecord(payment, l, { publish: false });
    payment = db.findById('payments', payment.id);
    return res.status(201).json({
      listing: serializeListing(live || db.findById('listings', l.id), { user: req.user }),
      payment: publicPayment(payment),
      fee: 0,
      published: true,
      feeEnabled: false,
      pixConfigured: getSettings().configured,
    });
  }
  res.status(201).json({
    listing: serializeListing(l, { user: req.user }),
    payment: publicPayment(payment),
    fee,
    published: false,
    feeEnabled: true,
    pixConfigured: getSettings().configured,
  });
});

router.delete('/:id', authRequired, (req, res) => {
  const l = db.findById('listings', req.params.id);
  if (!l) return res.status(404).json({ error: 'Anúncio não encontrado.' });
  if (l.userId !== req.user.id && !isAdminRole(req.user.role)) {
    return res.status(403).json({ error: 'Sem permissão.' });
  }
  db.update('listings', l.id, { status: 'cancelled' });
  res.json({ ok: true });
});

router.get('/:id/payment', authRequired, async (req, res) => {
  expireStalePayments();
  const l = db.findById('listings', req.params.id);
  if (!l) return res.status(404).json({ error: 'Anúncio não encontrado.' });
  if (l.userId !== req.user.id && !isAdminRole(req.user.role)) {
    return res.status(403).json({ error: 'Sem permissão.' });
  }
  let payment = listingPayment(l.id);
  if (!payment) return res.status(404).json({ error: 'Pagamento não encontrado.' });
  const cfg = getSettings();
  const fee = payment.kind === 'premium_listing' || l.premium
    ? Number((payment && payment.originalAmount) || (payment && payment.amount) || 0)
    : (payment.kind === 'vip_listing' || l.vip ? vipListingFee() : listingFee());
  if (
    payment.status !== 'paid' &&
    payment.promoApplied &&
    Number(payment.amount) > 0 &&
    cfg.configured &&
    (!payment.pixCode || payment.pixCode.includes('catira@corinto'))
  ) {
    const pix = pixPayload(l.id, payment.amount);
    payment = db.update('payments', payment.id, {
      pixCode: pix.pixCode,
      transactionId: pix.transactionId,
      pixKey: pix.pixKey,
    });
  }
  let qrDataUrl = '';
  if (payment.pixCode && Number(payment.amount) > 0) {
    try {
      qrDataUrl = await QRCode.toDataURL(payment.pixCode, { margin: 1, width: 280 });
    } catch {}
  }
  res.json({
    listing: serializeListing(l),
    payment: publicPayment(payment),
    fee: payment.amount || fee,
    originalFee: payment.originalAmount || fee,
    needsPromo: payment.status !== 'paid' && !payment.promoApplied,
    qrDataUrl,
    pixConfigured: cfg.configured,
    kind: payment.kind || (l.premium ? 'premium_listing' : (l.vip ? 'vip_listing' : 'listing')),
    vip: !!l.vip,
    premium: !!l.premium,
    upgrade: !!payment.upgrade,
  });
});

router.post('/:id/promo', authRequired, async (req, res) => {
  const l = db.findById('listings', req.params.id);
  if (!l) return res.status(404).json({ error: 'Anúncio não encontrado.' });
  if (l.userId !== req.user.id && !isAdminRole(req.user.role)) {
    return res.status(403).json({ error: 'Sem permissão.' });
  }
  let payment = listingPayment(l.id);
  if (payment && payment.status === 'paid' && l.status === 'published') {
    return res.json({ listing: serializeListing(l), published: true, alreadyPaid: true });
  }
  if (!payment) return res.status(404).json({ error: 'Pagamento não encontrado.' });
  if (payment.status === 'paid') {
    return res.json({ listing: serializeListing(l), payment: publicPayment(payment), published: true });
  }
  if (payment.promoApplied) {
    return res.status(400).json({ error: 'O código promocional já foi aplicado neste anúncio.' });
  }

  const skip = !!(req.body && req.body.skip);
  const rawCode = req.body && req.body.code;
  const fee = Number(payment.originalAmount || (l.premium ? payment.amount : (l.vip ? vipListingFee() : listingFee())));
  let discountPercent = 0;
  let promoCode = '';
  let promo = null;

  if (!skip) {
    const key = normalizePromoCode(rawCode);
    if (!key) return res.status(400).json({ error: 'Informe o código promocional ou continue sem ele.' });
    promo = findPromo(key);
    const err = promoUsable(promo);
    if (err) return res.status(400).json({ error: err });
    discountPercent = Number(promo.discountPercent);
    promoCode = normalizePromoCode(promo.code);
  }

  const amount = Math.round(fee * (100 - discountPercent)) / 100;
  const now = new Date().toISOString();

  if (amount <= 0) {
    if (promo) db.update('promoCodes', promo.id, { usedCount: Number(promo.usedCount || 0) + 1 });
    payment = db.update('payments', payment.id, {
      amount: 0,
      originalAmount: fee,
      discountPercent,
      promoCode,
      promoApplied: true,
      status: 'paid',
      method: 'promo',
      pixCode: '',
      pixKey: '',
      paidAt: now,
    });
    const listing = confirmPaymentRecord(payment, l, { publish: !(l.status === 'published' || l.status === 'paused') });
    return res.json({
      listing: serializeListing(listing),
      payment: publicPayment(payment),
      published: true,
      free: true,
      fee: 0,
      originalFee: fee,
      needsPromo: false,
      pixConfigured: getSettings().configured,
    });
  }

  const cfg = getSettings();
  const pix = cfg.configured ? pixPayload(l.id, amount) : { pixCode: '', transactionId: payment.transactionId, pixKey: '' };
  if (promo) db.update('promoCodes', promo.id, { usedCount: Number(promo.usedCount || 0) + 1 });
  payment = db.update('payments', payment.id, {
    amount,
    originalAmount: fee,
    discountPercent,
    promoCode,
    promoApplied: true,
    pixCode: pix.pixCode || '',
    transactionId: pix.transactionId || payment.transactionId,
    pixKey: pix.pixKey || '',
  });
  let qrDataUrl = '';
  if (payment.pixCode) {
    try {
      qrDataUrl = await QRCode.toDataURL(payment.pixCode, { margin: 1, width: 280 });
    } catch {}
  }
  res.json({
    listing: serializeListing(l),
    payment: publicPayment(payment),
    fee: amount,
    originalFee: fee,
    needsPromo: false,
    qrDataUrl,
    pixConfigured: cfg.configured,
    published: false,
  });
});

router.post('/:id/pay', authRequired, (req, res) => {
  expireStalePayments();
  const l = db.findById('listings', req.params.id);
  if (!l) return res.status(404).json({ error: 'Anúncio não encontrado.' });
  if (l.userId !== req.user.id) return res.status(403).json({ error: 'Sem permissão.' });
  const payment = listingPayment(l.id);
  if (!payment) return res.status(404).json({ error: 'Pagamento não encontrado.' });
  if (payment.status === 'paid') {
    return res.json({ listing: serializeListing(l), payment: publicPayment(payment), published: l.status === 'published', alreadyPaid: true });
  }
  if (payment.status === 'expired' || l.status === 'payment_expired') {
    return res.status(400).json({ error: 'O prazo de confirmação expirou. Fale com o suporte.' });
  }
  const now = new Date().toISOString();
  const updatedPay = db.update('payments', payment.id, {
    userDeclaredAt: payment.userDeclaredAt || now,
    status: 'awaiting_confirmation',
  });
  const keepLive = ['published', 'paused'].includes(l.status);
  const updatedListing = keepLive ? l : db.update('listings', l.id, { status: 'awaiting_confirmation' });
  res.json({
    listing: serializeListing(updatedListing, { user: req.user }),
    payment: publicPayment(updatedPay),
    published: keepLive,
    message: 'Pagamento informado. A confirmação pode levar até 1 hora.',
  });
});

module.exports = router;
