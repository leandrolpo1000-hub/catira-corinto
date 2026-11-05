const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const db = require('../db');
const { adminRequired, masterRequired, publicUser, safeUser, isAdminRole } = require('../middleware');
const { serializeListing, confirmPaymentRecord, normalizePromoCode, findPromo, expireStalePayments, listingTypeOf, listingPlan, invalidateRanking, invalidateRankingIfListingStatus } = require('../helpers');
const { pageSlice } = require('../pagination');
const { getSettings, saveSettings } = require('../pix');
const { publicMailSettings, saveMailSettings, sendTestEmail } = require('../mail');
const { publicAssistantSettings, saveAssistantSettings } = require('../assistant');
const { adminBanner, saveBannerSettings } = require('../banner');
const { publicAppmaxSettings, saveAppmaxSettings, testAuth } = require('../appmax');
const intelligence = require('../intelligence');

const router = express.Router();
router.use(adminRequired);

// Produto oficial é gerido apenas pelo painel Oficial: evita divergência entre
// o anúncio materializado e o produto de origem.
function officialListingGuard(req, res, next) {
  const listing = db.findById('listings', req.params.id);
  if (listing && require('../official').isOfficialListing(listing)) {
    return res.status(403).json({ error: 'Produto oficial é editado na aba Oficial.' });
  }
  next();
}

const UPLOADS = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });

const bannerUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').slice(0, 8) || '.jpg';
      cb(null, 'banner-' + randomUUID() + ext);
    },
  }),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error('Envie apenas imagens.'));
    cb(null, true);
  },
});

function dayKey(iso) {
  return (iso || '').slice(0, 10);
}

function monthKey(iso) {
  return (iso || '').slice(0, 7);
}

function inRange(iso, from, to) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (from && t < from) return false;
  if (to && t > to) return false;
  return true;
}

router.get('/dashboard', masterRequired, (req, res) => {
  const q = req.query || {};
  const period = q.period || '7d';
  const city = (q.city || '').trim();
  const status = (q.status || '').trim();
  const now = Date.now();
  let from = 0;
  if (period === '7d') from = now - 7 * 86400000;
  else if (period === '30d') from = now - 30 * 86400000;
  else if (period === 'month') {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    from = d.getTime();
  } else if (period === 'year') {
    const d = new Date();
    d.setMonth(0, 1);
    d.setHours(0, 0, 0, 0);
    from = d.getTime();
  }
  const to = now;

  // Conta institucional é interna: não entra nas métricas de pessoas.
  let users = db.all('users').filter((u) => !require('../official').isPlatformUser(u));
  let listings = db.all('listings').filter((l) => !require('../official').isOfficialListing(l));
  let payments = db.all('payments');
  let reports = db.all('reports');

  if (city) {
    const c = city.toLowerCase();
    users = users.filter((u) => (u.city || '').toLowerCase() === c);
    listings = listings.filter((l) => (l.city || '').toLowerCase() === c);
    const ids = new Set(listings.map((l) => l.id));
    const uids = new Set(users.map((u) => u.id));
    payments = payments.filter((p) => ids.has(p.listingId) || uids.has(p.userId));
  }
  if (status) listings = listings.filter((l) => l.status === status);

  const usersPeriod = users.filter((u) => inRange(u.createdAt, from, to));
  const listingsPeriod = listings.filter((l) => inRange(l.publishedAt || l.createdAt, from, to));
  const paid = payments.filter((p) => p.status === 'paid' && inRange(p.paidAt || p.createdAt, from, to));
  const revenue = paid.reduce((s, p) => s + Number(p.amount || 0), 0);

  const days = period === '30d' ? 30 : period === 'month' ? new Date().getDate() : period === 'year' ? 12 : 7;
  const dailyMap = {};
  const monthlyMap = {};
  paid.forEach((p) => {
    const d = dayKey(p.paidAt || p.createdAt);
    const m = monthKey(p.paidAt || p.createdAt);
    dailyMap[d] = (dailyMap[d] || 0) + Number(p.amount);
    monthlyMap[m] = (monthlyMap[m] || 0) + Number(p.amount);
  });

  const lastDays = [];
  const dayCount = period === 'year' ? 0 : Math.min(30, Math.max(7, days));
  if (period === 'year') {
    /* monthly chart below */
  } else {
    for (let i = dayCount - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      lastDays.push({ date: d, revenue: dailyMap[d] || 0 });
    }
  }
  const last6m = [];
  for (let i = 5; i >= 0; i--) {
    const dt = new Date();
    dt.setMonth(dt.getMonth() - i);
    const m = dt.toISOString().slice(0, 7);
    last6m.push({ month: m, revenue: monthlyMap[m] || 0 });
  }

  const usersByDay = [];
  const chartDays = period === 'year' ? 30 : dayCount;
  for (let i = chartDays - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    usersByDay.push({
      date: d,
      count: users.filter((u) => dayKey(u.createdAt) === d).length,
    });
  }

  const listingsByDay = [];
  for (let i = chartDays - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    listingsByDay.push({
      date: d,
      count: listings.filter((l) => dayKey(l.publishedAt || l.createdAt) === d).length,
    });
  }

  const catCount = {};
  listings
    .filter((l) => !status || l.status === status)
    .forEach((l) => {
      catCount[l.categoryId] = (catCount[l.categoryId] || 0) + 1;
    });
  const topCategories = Object.entries(catCount)
    .map(([id, count]) => {
      const c = db.findById('categories', id);
      return { id, name: c ? c.name : '—', count };
    })
    .sort((a, b) => b.count - a.count);

  const category = (q.category || '').trim();
  intelligence.ensureSettings();
  res.json({
    filters: { period, city, status, category },
    stats: {
      users: usersPeriod.length,
      usersTotal: users.length,
      listingsPublished: listings.filter((l) => l.status === 'published').length,
      listingsPeriod: listingsPeriod.length,
      awaitingPayment: listings.filter((l) => l.status === 'awaiting_payment').length,
      revenue,
      sold: listings.filter((l) => l.status === 'sold').length,
      reportsOpen: reports.filter((r) => r.status === 'open').length,
      blockedUsers: users.filter((u) => u.status === 'blocked').length,
      expired: listings.filter((l) => l.status === 'expired').length,
      vipListings: listings.filter((l) => l.vip || l.featured).length,
      views: listings.reduce((s, l) => s + Number(l.views || 0), 0),
      deals: listings.filter((l) => ['sold', 'traded', 'negotiated'].includes(l.status)).length,
      listingsTotal: listings.length,
    },
    charts: {
      dailyRevenue: lastDays.length ? lastDays : last6m.map((m) => ({ date: m.month, revenue: m.revenue })),
      monthlyRevenue: last6m,
      newUsers: usersByDay,
      listings: listingsByDay,
      topCategories,
    },
    intelligence: intelligence.buildDashboard({ period, city, category }),
  });
});

router.get('/intelligence/settings', masterRequired, (_req, res) => {
  res.json(require('../intelligence').getSettings());
});

router.put('/intelligence/settings', masterRequired, (req, res) => {
  res.json(require('../intelligence').updateSettings(req.body || {}));
});

function userRoleKey(u) {
  if (u.role === 'master') return 'master';
  if (u.role === 'admin') return 'admin';
  const dealerStatus = require('../lance').dealerPublic(u).dealerStatus;
  if (u.role === 'user' && dealerStatus === 'approved') return 'dealer';
  return 'user';
}

router.get('/users', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  let list = db.all('users').filter((u) => !require('../official').isPlatformUser(u));
  if (q) {
    list = list.filter(
      (u) =>
        (u.name && u.name.toLowerCase().includes(q)) ||
        (u.email && u.email.toLowerCase().includes(q)) ||
        (u.phone && u.phone.includes(q)) ||
        (u.city && u.city.toLowerCase().includes(q))
    );
  }
  if (req.query.status) list = list.filter((u) => u.status === req.query.status);
  if (req.query.role) list = list.filter((u) => userRoleKey(u) === req.query.role);
  const cities = Array.from(new Set(list.map((u) => u.city).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  if (req.query.city) list = list.filter((u) => u.city === req.query.city);
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const page = pageSlice(list, req.query);
  res.json({
    ...page,
    items: page.items.map((u) => ({
      ...publicUser(u),
      listingsCount: db.indexSize('listings', 'userId', u.id),
    })),
    facets: { cities },
  });
});

router.post('/users/:id/status', (req, res) => {
  const u = db.findById('users', req.params.id);
  if (!u || require('../official').isPlatformUser(u)) return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (isAdminRole(u.role)) return res.status(400).json({ error: 'Não é possível alterar um administrador.' });
  const status = req.body && req.body.status;
  if (!['active', 'blocked'].includes(status)) return res.status(400).json({ error: 'Status inválido.' });
  const updated = db.update('users', u.id, { status });
  if (u.status !== status && (u.status === 'blocked' || status === 'blocked')) invalidateRanking();
  res.json(publicUser(updated));
});

router.post('/users/:id/role', masterRequired, (req, res) => {
  const u = db.findById('users', req.params.id);
  if (!u || require('../official').isPlatformUser(u)) return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (u.role === 'master') return res.status(400).json({ error: 'Não é possível alterar o admin master.' });
  const role = req.body && req.body.role;
  if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Perfil inválido.' });
  const updated = db.update('users', u.id, { role });
  res.json(publicUser(updated));
});

function listingSeller(l, cache) {
  if (!l || !l.userId) return null;
  if (cache.has(l.userId)) return cache.get(l.userId);
  const u = db.findById('users', l.userId) || null;
  cache.set(l.userId, u);
  return u;
}

router.get('/listings', (req, res) => {
  expireStalePayments();
  // Produtos oficiais têm gestão própria na aba Oficial.
  let list = db.all('listings').filter((l) => !require('../official').isOfficialListing(l));
  if (req.query.status) list = list.filter((l) => l.status === req.query.status);
  const q = (req.query.q || '').toLowerCase();
  const sellerCache = new Map();
  if (q) {
    list = list.filter((l) => {
      const seller = listingSeller(l, sellerCache);
      const hay = [
        l.title,
        l.city,
        l.id,
        listingTypeOf(l),
        seller && seller.name,
        seller && seller.email,
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }
  if (req.query.type) list = list.filter((l) => listingTypeOf(l) === req.query.type);
  if (req.query.plan) list = list.filter((l) => listingPlan(l) === req.query.plan);
  if (req.query.quick === '1' || req.query.quick === 'true') {
    list = list.filter((l) => !!l.quickOfferEnabled);
  }
  const cities = Array.from(new Set(list.map((l) => l.city).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const sellers = Array.from(new Set(list.map((l) => {
    const seller = listingSeller(l, sellerCache);
    return (seller && seller.name) || '';
  }).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  if (req.query.city) list = list.filter((l) => l.city === req.query.city);
  if (req.query.seller) {
    list = list.filter((l) => {
      const seller = listingSeller(l, sellerCache);
      return seller && seller.name === req.query.seller;
    });
  }
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const page = pageSlice(list, req.query);
  res.json({
    ...page,
    items: page.items.map((l) => serializeListing(l, { user: req.user })),
    facets: { cities, sellers },
  });
});

router.post('/listings/:id/action', officialListingGuard, (req, res) => {
  const l = db.findById('listings', req.params.id);
  if (!l) return res.status(404).json({ error: 'Anúncio não encontrado.' });
  const action = req.body && req.body.action;
  const patch = {};
  if (action === 'remove' || action === 'block') {
    const note = String((req.body && req.body.note) || '').trim();
    if (!note) return res.status(400).json({ error: 'Escreva o motivo da remoção para o anunciante.' });
    patch.status = 'cancelled';
    patch.adminNote = note;
    patch.reviewedAt = new Date().toISOString();
  }
  else if (action === 'approve' && l.status !== 'published') {
    patch.status = 'published';
    patch.publishedAt = patch.publishedAt || new Date().toISOString();
    patch.adminNote = '';
    patch.previousStatus = '';
  } else if (action === 'reject') {
    const note = String((req.body && req.body.note) || '').trim();
    if (!note) return res.status(400).json({ error: 'Escreva o comentário da recusa para o anunciante corrigir.' });
    patch.previousStatus = l.status === 'changes_requested' ? (l.previousStatus || 'awaiting_payment') : l.status;
    patch.status = 'changes_requested';
    patch.adminNote = note;
    patch.reviewedAt = new Date().toISOString();
  }
  else if (action === 'feature') {
    const { highlightDays } = require('../pix');
    patch.featured = true;
    patch.featuredUntil = new Date(Date.now() + highlightDays() * 86400000).toISOString();
  }
  else if (action === 'unfeature') {
    patch.featured = false;
    patch.featuredUntil = null;
  }
  else return res.status(400).json({ error: 'Ação inválida.' });
  const updated = db.update('listings', l.id, patch);
  invalidateRankingIfListingStatus(l.status, updated && updated.status);
  if (updated && updated.status === 'published' && action === 'approve') {
    const { notifyAlerts } = require('../helpers');
    notifyAlerts(updated);
  }
  res.json(serializeListing(updated, { user: req.user }));
});

router.delete('/listings/:id/images/:imageId', officialListingGuard, (req, res) => {
  const l = db.findById('listings', req.params.id);
  if (!l) return res.status(404).json({ error: 'Anúncio não encontrado.' });
  const img = db.findById('listingImages', req.params.imageId);
  if (!img || img.listingId !== l.id) return res.status(404).json({ error: 'Foto não encontrada.' });
  const count = db.count('listingImages', (i) => i.listingId === l.id);
  const isWant = l.listingType === 'procuro';
  if (!isWant && count <= 3) {
    return res.status(400).json({ error: 'O anúncio precisa de no mínimo 3 fotos.' });
  }
  db.remove('listingImages', img.id);
  res.json(serializeListing(db.findById('listings', l.id), { user: req.user }));
});

router.put('/listings/:id', officialListingGuard, (req, res) => {
  const l = db.findById('listings', req.params.id);
  if (!l) return res.status(404).json({ error: 'Anúncio não encontrado.' });
  const b = req.body || {};
  const password = String(b.password || '');
  const adminUser = db.findById('users', req.user.id);
  if (!password || !adminUser || !bcrypt.compareSync(password, adminUser.passwordHash)) {
    return res.status(403).json({ error: 'Senha do administrador inválida.' });
  }
  const patch = {};
  ['title', 'description', 'price', 'status', 'city', 'featured', 'listingType', 'tradeWishes'].forEach((k) => {
    if (b[k] !== undefined) patch[k] = b[k];
  });
  if (patch.price !== undefined) patch.price = Number(patch.price);
  const updated = db.update('listings', l.id, patch);
  invalidateRankingIfListingStatus(l.status, updated && updated.status);
  res.json(serializeListing(updated, { user: req.user }));
});

router.get('/reports', (req, res) => {
  const list = db
    .all('reports')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const page = pageSlice(list, req.query);
  res.json({
    ...page,
    items: page.items.map((r) => {
      const listing = r.listingId ? db.findById('listings', r.listingId) : null;
      return {
        ...r,
        listing: listing ? serializeListing(listing) : null,
        reporter: safeUser(db.findById('users', r.reporterId)),
      };
    }),
  });
});

router.post('/reports/:id/status', (req, res) => {
  const r = db.findById('reports', req.params.id);
  if (!r) return res.status(404).json({ error: 'Denúncia não encontrada.' });
  const status = req.body && req.body.status;
  if (!['open', 'reviewed', 'resolved', 'dismissed'].includes(status)) {
    return res.status(400).json({ error: 'Status inválido.' });
  }
  const updated = db.update('reports', r.id, { status });
  res.json(updated);
});

router.get('/categories', (_req, res) => {
  const cats = db.all('categories').sort((a, b) => (a.order || 0) - (b.order || 0));
  res.json({ items: cats });
});

router.post('/categories', (req, res) => {
  const { name, slug, icon, order } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Informe o nome.' });
  const s = slug || String(name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-');
  const cat = db.insert('categories', {
    name,
    slug: s,
    icon: icon || 'gem',
    order: order != null ? Number(order) : db.count('categories') + 1,
    parentId: null,
    active: true,
  });
  res.status(201).json(cat);
});

router.put('/categories/:id', (req, res) => {
  const c = db.findById('categories', req.params.id);
  if (!c) return res.status(404).json({ error: 'Categoria não encontrada.' });
  const b = req.body || {};
  const patch = {};
  ['name', 'slug', 'icon', 'order', 'active'].forEach((k) => {
    if (b[k] !== undefined) patch[k] = b[k];
  });
  if (patch.order !== undefined) patch.order = Number(patch.order);
  res.json(db.update('categories', c.id, patch));
});

router.delete('/categories/:id', (req, res) => {
  const c = db.findById('categories', req.params.id);
  if (!c) return res.status(404).json({ error: 'Categoria não encontrada.' });
  const used = db.count('listings', (l) => l.categoryId === c.id);
  if (used) {
    db.update('categories', c.id, { active: false });
    return res.json({ ok: true, deactivated: true });
  }
  db.remove('categories', c.id);
  res.json({ ok: true });
});

router.post('/categories/reorder', (req, res) => {
  const ids = (req.body && req.body.ids) || [];
  ids.forEach((id, i) => db.update('categories', id, { order: i + 1 }));
  res.json({ items: db.all('categories').sort((a, b) => (a.order || 0) - (b.order || 0)) });
});

function formatPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone || '';
}

router.get('/publications', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const status = req.query.status;
  let list = db.all('listings');
  if (status) list = list.filter((l) => l.status === status);
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (q) {
    list = list.filter((l) => {
      const u = db.findById('users', l.userId);
      const hay = [
        u && u.name,
        u && u.email,
        u && u.phone,
        l.city || (u && u.city),
        l.id,
        String(l.id).slice(0, 8),
        l.title,
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }
  const page = pageSlice(list, req.query);
  res.json({
    ...page,
    items: page.items.map((l) => {
      const u = db.findById('users', l.userId);
      return {
        listingId: l.id,
        listingCode: String(l.id).slice(0, 8).toUpperCase(),
        title: l.title,
        status: l.status,
        price: l.price,
        createdAt: l.createdAt,
        publishedAt: l.publishedAt,
        name: u ? u.name : '',
        email: u ? u.email : '',
        phone: u ? u.phone : '',
        phoneFormatted: u ? formatPhone(u.phone) : '',
        address: l.city || (u ? u.city : ''),
        city: l.city || (u ? u.city : ''),
      };
    }),
  });
});

function pixPublic(s) {
  return {
    pixKey: s.pixKey,
    pixKeyType: s.pixKeyType,
    merchantName: s.merchantName,
    merchantCity: s.merchantCity,
    fee: s.fee,
    vipListingFee: s.vipListingFee,
    vipAccessFee: s.vipAccessFee,
    vipDays: s.vipDays,
    vipWhatsappGroup: s.vipWhatsappGroup || '',
    highlightFee: s.highlightFee,
    highlightDays: s.highlightDays,
    premiumDayFee: s.premiumDayFee,
    feeEnabled: s.commonFeeEnabled === true,
    commonFeeEnabled: s.commonFeeEnabled === true,
    vipFeeEnabled: s.vipFeeEnabled === true,
    premiumFeeEnabled: s.premiumFeeEnabled === true,
    configured: !!(s.pixKey && String(s.pixKey).trim()),
  };
}

router.get('/pix', masterRequired, (_req, res) => {
  res.json(pixPublic(getSettings()));
});

function flagOn(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

router.put('/pix', masterRequired, (req, res) => {
  const b = req.body || {};
  // Valida pelo estado FINAL (o que já está salvo + o que veio no patch),
  // e não apenas pelos campos enviados. Assim desligar um plano nunca pede chave PIX.
  const current = getSettings();
  const finalCommon = b.commonFeeEnabled !== undefined
    ? flagOn(b.commonFeeEnabled)
    : (b.feeEnabled !== undefined ? flagOn(b.feeEnabled) : current.commonFeeEnabled === true);
  const finalVip = b.vipFeeEnabled !== undefined ? flagOn(b.vipFeeEnabled) : current.vipFeeEnabled === true;
  const finalPremium = b.premiumFeeEnabled !== undefined ? flagOn(b.premiumFeeEnabled) : current.premiumFeeEnabled === true;
  const finalKey = b.pixKey !== undefined ? String(b.pixKey).trim() : String(current.pixKey || '').trim();
  const anyCharging = finalCommon || finalVip || finalPremium;
  if (anyCharging && !finalKey) {
    return res.status(400).json({ error: 'Para cobrar, informe a chave PIX que vai receber a taxa do anúncio.' });
  }
  const allowed = ['cpf', 'cnpj', 'email', 'phone', 'random'];
  if (b.pixKeyType && !allowed.includes(b.pixKeyType)) {
    return res.status(400).json({ error: 'Tipo de chave inválido.' });
  }
  try {
    saveSettings(b);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message || 'Não foi possível salvar.' });
  }
  res.json(pixPublic(getSettings()));
});

router.get('/banner', masterRequired, (_req, res) => {
  res.json(adminBanner());
});

router.put('/banner', masterRequired, bannerUpload.single('image'), (req, res) => {
  try {
    const b = req.body || {};
    const patch = {
      enabled: b.enabled,
      link: b.link,
      title: b.title,
    };
    if (req.file) patch.imageUrl = '/uploads/' + req.file.filename;
    saveBannerSettings(patch);
    res.json(adminBanner());
  } catch (e) {
    if (req.file) {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
    res.status(e.status || 400).json({ error: e.message || 'Não foi possível salvar o banner.' });
  }
});

router.get('/mail', masterRequired, (_req, res) => {
  res.json(publicMailSettings());
});

router.put('/mail', masterRequired, (req, res) => {
  try {
    saveMailSettings(req.body || {});
    res.json(publicMailSettings());
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || 'Não foi possível salvar.' });
  }
});

router.get('/assistant', masterRequired, (_req, res) => {
  res.json(publicAssistantSettings());
});

router.put('/assistant', masterRequired, (req, res) => {
  try {
    saveAssistantSettings(req.body || {});
    res.json(publicAssistantSettings());
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || 'Não foi possível salvar.' });
  }
});

router.get('/appmax', masterRequired, (_req, res) => {
  res.json(publicAppmaxSettings());
});

router.put('/appmax', masterRequired, async (req, res) => {
  try {
    saveAppmaxSettings(req.body || {});
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message || 'Não foi possível salvar.' });
  }
  let authTest;
  try {
    await testAuth();
    authTest = { ok: true };
  } catch (e) {
    authTest = { ok: false, error: e.message || 'Falha de autenticação na Appmax.' };
  }
  res.json({ ...publicAppmaxSettings(), authTest });
});

router.post('/mail/test', masterRequired, async (req, res) => {
  const to = String((req.body && req.body.to) || req.user.email || '').trim();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return res.status(400).json({ error: 'Informe um e-mail válido para o teste.' });
  }
  const cfg = publicMailSettings();
  if (!cfg.configured || !cfg.enabled) {
    return res.status(400).json({ error: 'Salve e ative o Resend antes de enviar o teste.' });
  }
  try {
    await sendTestEmail(to);
    res.json({ ok: true, message: 'E-mail de teste enviado para ' + to + '.' });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || 'Não foi possível enviar o teste.' });
  }
});

router.post('/payments/:id/confirm', (req, res) => {
  const payment = db.findById('payments', req.params.id);
  if (!payment) return res.status(404).json({ error: 'Pagamento não encontrado.' });
  const listing = payment.listingId ? db.findById('listings', payment.listingId) : null;
  if (payment.kind !== 'vip_access' && !listing) {
    return res.status(404).json({ error: 'Anúncio não encontrado.' });
  }
  if (payment.status === 'paid') {
    return res.json({
      payment: db.findById('payments', payment.id),
      listing: listing ? serializeListing(listing, { user: req.user }) : null,
      user: payment.kind === 'vip_access' ? publicUser(db.findById('users', payment.userId)) : null,
    });
  }
  const result = confirmPaymentRecord(payment, listing, { publish: payment.kind === 'vip_access' });
  res.json({
    payment: db.findById('payments', payment.id),
    listing: listing ? serializeListing(db.findById('listings', listing.id)) : null,
    user: payment.kind === 'vip_access' ? publicUser(db.findById('users', payment.userId)) : null,
    vipUntil: result && result.vipUntil,
  });
});

router.post('/payments/:id/reject', (req, res) => {
  const payment = db.findById('payments', req.params.id);
  if (!payment) return res.status(404).json({ error: 'Pagamento não encontrado.' });
  if (payment.status === 'paid') {
    return res.status(400).json({ error: 'Pagamento já confirmado.' });
  }
  db.update('payments', payment.id, { status: 'rejected' });
  if (payment.listingId) {
    db.update('listings', payment.listingId, { status: 'awaiting_payment' });
  }
  res.json({ ok: true });
});

router.get('/payments', (req, res) => {
  expireStalePayments();
  const list = db
    .all('payments')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const page = pageSlice(list, req.query);
  res.json({
    ...page,
    items: page.items.map((p) => {
      const u = db.findById('users', p.userId);
      const listing = p.listingId ? db.findById('listings', p.listingId) : null;
      return {
        ...p,
        user: u
          ? { ...safeUser(u), email: u.email, phone: u.phone }
          : null,
        listing: listing ? serializeListing(listing) : null,
      };
    }),
  });
});

router.get('/promos', (_req, res) => {
  const items = db
    .all('promoCodes')
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  res.json({ items });
});

router.post('/promos', (req, res) => {
  const b = req.body || {};
  const code = normalizePromoCode(b.code);
  if (!code || code.length < 3) {
    return res.status(400).json({ error: 'Informe uma chave com pelo menos 3 caracteres.' });
  }
  if (findPromo(code)) {
    return res.status(409).json({ error: 'Essa chave já existe.' });
  }
  const discountPercent = Number(b.discountPercent);
  if (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 100) {
    return res.status(400).json({ error: 'O desconto deve ser de 1% a 100%.' });
  }
  const maxUses = b.maxUses === '' || b.maxUses === undefined || b.maxUses === null
    ? 0
    : Math.max(0, parseInt(b.maxUses, 10) || 0);
  const row = db.insert('promoCodes', {
    code,
    discountPercent: Math.round(discountPercent * 10) / 10,
    maxUses,
    usedCount: 0,
    active: true,
    createdAt: new Date().toISOString(),
  });
  res.status(201).json(row);
});

router.get('/reviews', (req, res) => {
  const userReviews = db.all('reviews').map((r) => ({ ...r, kind: 'user' }));
  const listingReviews = db.all('listingReviews').map((r) => ({ ...r, kind: 'listing' }));
  const list = userReviews.concat(listingReviews).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const page = pageSlice(list, req.query);
  res.json({
    ...page,
    items: page.items.map((r) => {
      const listing = r.listingId ? db.findById('listings', r.listingId) : null;
      return {
        ...r,
        reviewer: safeUser(db.findById('users', r.kind === 'listing' ? r.userId : r.reviewerId)),
        listing: listing ? serializeListing(listing) : null,
      };
    }),
  });
});

router.delete('/reviews/:id', (req, res) => {
  const id = req.params.id;
  if (db.findById('reviews', id)) {
    const row = db.findById('reviews', id);
    db.remove('reviews', id);
    if (row.reviewedUserId) {
      const { recalcRating } = require('../helpers');
      recalcRating(row.reviewedUserId);
    }
    return res.json({ ok: true });
  }
  if (db.findById('listingReviews', id)) {
    db.remove('listingReviews', id);
    return res.json({ ok: true });
  }
  return res.status(404).json({ error: 'Avaliação não encontrada.' });
});

router.post('/promos/:id/toggle', (req, res) => {
  const row = db.findById('promoCodes', req.params.id);
  if (!row) return res.status(404).json({ error: 'Código não encontrado.' });
  const updated = db.update('promoCodes', row.id, { active: row.active === false });
  res.json(updated);
});

// --- CATIRA SOB ENCOMENDA (Fase 1): catálogo oficial e ofertas externas ---
// Somente cadastro manual. Nenhum conector, sincronização ou checkout aqui.
const officialUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').slice(0, 8).toLowerCase() || '.jpg';
      cb(null, 'official-' + randomUUID() + ext);
    },
  }),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\//i.test(file.mimetype)) return cb(new Error('Envie apenas imagens.'));
    cb(null, true);
  },
});

function officialHandler(fn) {
  return (req, res) => {
    try {
      const result = fn(req);
      res.status(result && result.status ? result.status : 200).json(result && result.body ? result.body : result);
    } catch (e) {
      res.status(e.status || 400).json({ error: e.message || 'Algo deu errado.' });
    }
  };
}

function officialAsync(fn) {
  return (req, res) => {
    Promise.resolve()
      .then(() => fn(req))
      .then((result) => {
        res.status(result && result.status ? result.status : 200).json(result && result.body ? result.body : result);
      })
      .catch((e) => {
        res.status(e.status || 400).json({ error: e.message || 'Algo deu errado.' });
      });
  };
}

router.get('/official/meli/status', officialHandler(() => {
  const meli = require('../meli');
  return { ...meli.authStatus(), app: meli.publicAppSettings() };
}));

router.put('/official/meli/settings', officialHandler((req) => {
  const meli = require('../meli');
  const app = meli.saveAppSettings(req.body || {});
  db.insert('officialAdminLogs', {
    actorId: req.user && req.user.id ? req.user.id : null,
    action: 'meli_settings_saved',
    payload: { configured: app.configured },
    createdAt: new Date().toISOString(),
  });
  return { ...meli.authStatus(), app };
}));

router.get('/official/meli/connect', officialHandler((req) => {
  const meli = require('../meli');
  const out = meli.createAuthUrl(req.user.id);
  return { url: out.url };
}));

router.post('/official/meli/callback', officialAsync(async (req) => {
  const meli = require('../meli');
  const body = req.body || {};
  await meli.completeAuth(req.user.id, body.code, body.state);
  db.insert('officialAdminLogs', {
    actorId: req.user.id,
    action: 'meli_connected',
    payload: {},
    createdAt: new Date().toISOString(),
  });
  return meli.authStatus();
}));

router.post('/official/meli/disconnect', officialAsync(async (req) => {
  const meli = require('../meli');
  await meli.disconnect();
  db.insert('officialAdminLogs', {
    actorId: req.user.id,
    action: 'meli_disconnected',
    payload: {},
    createdAt: new Date().toISOString(),
  });
  return { ok: true };
}));

router.post('/official/meli/import', officialAsync(async (req) => {
  const meli = require('../meli');
  const official = require('../official');
  const out = await meli.importFromUrl((req.body && req.body.url) || '', req.user);
  return {
    status: out.created ? 201 : 200,
    body: {
      product: official.serializeProduct(out.product),
      offer: official.serializeOffer(out.offer),
      listingId: out.listing ? out.listing.id : null,
      created: out.created,
    },
  };
}));

router.post('/official/products/:id/meli/sync', officialAsync(async (req) => {
  const meli = require('../meli');
  const official = require('../official');
  const out = await meli.syncProduct(req.params.id, req.user);
  return {
    product: official.serializeProduct(out.product),
    offer: official.serializeOffer(out.offer),
  };
}));

require('./orders').attachAdmin(router);

router.get('/official/products', officialHandler((req) => {
  const official = require('../official');
  official.ensureOfficialSeller();
  return { ...official.listProducts(req.query), providers: official.PROVIDERS, providerLabels: official.PROVIDER_LABEL };
}));

router.post('/official/products', officialHandler((req) => {
  const official = require('../official');
  const out = official.createProduct(req.body || {}, req.user);
  return { status: 201, body: { product: official.serializeProduct(out.product), listingId: out.listing ? out.listing.id : null } };
}));

router.get('/official/products/:id', officialHandler((req) => {
  const official = require('../official');
  const product = official.productOf(req.params.id);
  if (!product) {
    const err = new Error('Produto oficial não encontrado.');
    err.status = 404;
    throw err;
  }
  return { product: official.serializeProduct(product), offers: official.offersOf(product.id, { includeHidden: true }).map((o) => official.serializeOffer(o)) };
}));

router.put('/official/products/:id', officialHandler((req) => {
  const official = require('../official');
  const out = official.updateProduct(req.params.id, req.body || {});
  return { product: official.serializeProduct(out.product), listingId: out.listing ? out.listing.id : null };
}));

router.delete('/official/products/:id', officialHandler((req) => {
  const official = require('../official');
  return official.deleteProduct(req.params.id);
}));

router.post('/official/products/:id/offers', officialHandler((req) => {
  const official = require('../official');
  const out = official.upsertOffer(req.params.id, req.body || {}, req.user);
  return { offer: official.serializeOffer(out.offer), product: official.serializeProduct(out.product) };
}));

router.put('/official/products/:id/offers/:offerId', officialHandler((req) => {
  const official = require('../official');
  const out = official.updateOffer(req.params.id, req.params.offerId, req.body || {}, req.user);
  return { offer: official.serializeOffer(out.offer), product: official.serializeProduct(out.product) };
}));

router.post('/official/products/:id/offers/:offerId/status', officialHandler((req) => {
  const official = require('../official');
  const status = req.body && req.body.status;
  const out = official.setOfferStatus(req.params.id, req.params.offerId, status, req.user);
  return { offer: official.serializeOffer(out.offer), product: official.serializeProduct(out.product) };
}));

router.delete('/official/products/:id/offers/:offerId', officialHandler((req) => {
  const official = require('../official');
  return official.removeOffer(req.params.id, req.params.offerId, req.user);
}));

router.post('/official/upload', officialUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Envie uma imagem.' });
  res.status(201).json({ url: '/uploads/' + req.file.filename });
});

module.exports = router;
