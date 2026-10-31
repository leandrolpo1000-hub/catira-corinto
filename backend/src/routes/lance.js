const express = require('express');
const db = require('../db');
const { authRequired, adminRequired, masterRequired, publicUser, isAdminRole } = require('../middleware');
const lance = require('../lance');

const router = express.Router();

function fail(res, e) {
  return res.status(e.status || 400).json({ error: e.message || 'Não foi possível concluir.' });
}

router.get('/config', (_req, res) => {
  const s = lance.getSettings();
  res.json({
    intermediationEnabled: s.intermediationEnabled !== false,
    ownBuyEnabled: !!s.ownBuyEnabled,
    defaultHoldHours: s.defaultHoldHours,
    founderFreeDays: s.founderFreeDays,
    termsVersion: s.termsVersion,
    feeType: s.feeType || 'fixed',
    feePercent: s.feePercent || 0,
    feeFixed: s.feeFixed || 0,
    feeMin: s.feeMin || 0,
    completionRule: s.completionRule || 'both_parties',
  });
});

router.get('/own-resale', (_req, res) => {
  res.json({ items: lance.publicOwnResale() });
});

router.get('/me', authRequired, (req, res) => {
  const profile = lance.dealerProfileOf(req.user.id);
  const application = lance.dealerApplicationOf(req.user.id);
  const extra = lance.dealerPublic(req.user);
  res.json({
    user: { ...publicUser(req.user), ...extra },
    profile: profile
      ? {
          id: profile.id,
          status: profile.status,
          founder: !!profile.founder,
          city: profile.city,
          categories: profile.categories || [],
          regions: profile.regions || [],
          benefitUntil: profile.benefitUntil || null,
          couponCode: isAdminRole(req.user.role) ? (profile.couponCode || '') : (profile.couponCode || ''),
          approvedAt: profile.approvedAt || null,
        }
      : null,
    application: application
      ? {
          id: application.id,
          status: application.status,
          createdAt: application.createdAt,
          note: application.note || '',
        }
      : null,
    isDealer: lance.isActiveDealer(req.user),
  });
});

router.post('/dealers/apply', authRequired, (req, res) => {
  try {
    const app = lance.applyDealer(req.user, req.body || {});
    res.status(201).json({
      application: {
        id: app.id,
        status: app.status,
        createdAt: app.createdAt,
      },
    });
  } catch (e) {
    fail(res, e);
  }
});

router.get('/hub', authRequired, (req, res) => {
  if (!lance.isActiveDealer(req.user)) {
    return res.status(403).json({ error: 'Acesso restrito a catireiros credenciados.' });
  }
  const items = lance.hubList(req.query || {}, req.user);
  res.json({ items, total: items.length });
});

router.get('/hub/:id', authRequired, (req, res) => {
  if (!lance.isActiveDealer(req.user)) {
    return res.status(403).json({ error: 'Acesso restrito a catireiros credenciados.' });
  }
  lance.expireLance();
  const opp = db.findById('opportunities', req.params.id);
  if (!opp || !opp.forwardedAt || opp.inOwnBox || (opp.mode || 'intermediation') === 'own_buy') {
    return res.status(404).json({ error: 'Oportunidade não encontrada.' });
  }
  const involved = db.findOne('opportunityInterests', (i) => i.opportunityId === opp.id && i.dealerId === req.user.id);
  if (!['available', 'reserved', 'negotiating'].includes(opp.status) && !(opp.status === 'disputed' && involved)) {
    return res.status(404).json({ error: 'Oportunidade não encontrada.' });
  }
  const serialized = lance.serializeOpportunity(opp, { dealerId: req.user.id });
  if (serialized && serialized.seller) {
    serialized.seller = {
      id: serialized.seller.id,
      name: serialized.seller.name,
      city: serialized.seller.city,
      cityId: serialized.seller.cityId,
      avatarColor: serialized.seller.avatarColor,
    };
  }
  res.json(serialized);
});

router.post('/hub/:id/interest', authRequired, (req, res) => {
  try {
    const d = lance.expressInterest(req.params.id, req.user, (req.body && req.body.note) || '');
    res.status(d.already ? 200 : 201).json({
      interest: d.interest,
      already: d.already,
      sale: false,
      charged: false,
      reserved: false,
      message: d.already
        ? 'Seu interesse já estava registrado. Nenhuma compra foi feita.'
        : 'Interesse registrado. Isso não é compra, pagamento, reserva nem garantia de disponibilidade.',
    });
  } catch (e) {
    fail(res, e);
  }
});

router.post('/hub/:id/interest/withdraw', authRequired, (req, res) => {
  try {
    const d = lance.withdrawInterest(req.params.id, req.user);
    res.json({
      interest: d.interest,
      sale: false,
      charged: false,
      message: 'Interesse retirado. Nada foi cobrado.',
    });
  } catch (e) {
    fail(res, e);
  }
});

router.get('/mine', authRequired, (req, res) => {
  if (!lance.isActiveDealer(req.user)) {
    return res.status(403).json({ error: 'Acesso restrito a catireiros credenciados.' });
  }
  lance.expireLance();
  const rows = db
    .findWhere('opportunityInterests', (i) => i.dealerId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const items = rows.map((i) => {
    const opp = db.findById('opportunities', i.opportunityId);
    return {
      interest: {
        id: i.id,
        status: i.status,
        createdAt: i.createdAt,
        note: i.note || '',
      },
      opportunity: opp ? lance.serializeOpportunity(opp, { dealerId: req.user.id }) : null,
    };
  });
  res.json({ items });
});

router.get('/seller', authRequired, (req, res) => {
  lance.expireLance();
  const listings = db.findWhere('listings', (l) => l.userId === req.user.id && !!l.quickOfferEnabled);
  const offers = db
    .findWhere('opportunityOffers', (o) => o.sellerId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({
    listings: listings.map((l) => {
      const opp = lance.opportunityOfListing(l.id);
      return {
        id: l.id,
        title: l.title,
        price: l.price,
        status: l.status,
        waitForEvaluation: !!l.waitForEvaluation,
        opportunity: opp ? lance.serializeOpportunity(opp, { seller: true }) : null,
      };
    }),
    offers: offers.map(lance.serializeOffer),
  });
});

router.post('/offers/:id/respond', authRequired, (req, res) => {
  try {
    const action = req.body && req.body.action;
    const d = lance.respondOffer(req.params.id, action, req.user);
    res.json(d);
  } catch (e) {
    fail(res, e);
  }
});

router.post('/listings/:id/consent', authRequired, (req, res) => {
  try {
    const opp = lance.sellerConsent(req.params.id, req.user, req.body && req.body.consent, req.body || {});
    res.json({ opportunity: opp });
  } catch (e) {
    fail(res, e);
  }
});

router.post('/opportunities/:id/confirm', authRequired, (req, res) => {
  try {
    const party = req.body && req.body.party;
    res.json({ opportunity: lance.confirmCompletion(req.params.id, req.user, party) });
  } catch (e) {
    fail(res, e);
  }
});

router.post('/opportunities/:id/dispute', authRequired, (req, res) => {
  try {
    res.json({ opportunity: lance.openDispute(req.params.id, req.user, (req.body && req.body.reason) || '') });
  } catch (e) {
    fail(res, e);
  }
});

router.post('/opportunities/:id/dispute-note', authRequired, (req, res) => {
  try {
    res.json({ opportunity: lance.addDisputeNote(req.params.id, req.user, (req.body && req.body.note) || '') });
  } catch (e) {
    fail(res, e);
  }
});

const admin = express.Router();
admin.use(adminRequired);

admin.get('/settings', (req, res) => {
  res.json(lance.getSettings());
});

admin.put('/settings', masterRequired, (req, res) => {
  try {
    res.json(lance.saveSettings(req.body || {}, req.user));
  } catch (e) {
    fail(res, e);
  }
});

admin.get('/metrics', (_req, res) => {
  res.json(lance.metrics());
});

admin.get('/queue', (req, res) => {
  res.json({ items: lance.adminQueue(req.query || {}) });
});

admin.get('/opportunities/:id', (req, res) => {
  lance.expireLance();
  const opp = db.findById('opportunities', req.params.id);
  if (!opp) return res.status(404).json({ error: 'Oportunidade não encontrada.' });
  res.json(lance.serializeOpportunity(opp, { admin: true }));
});

admin.post('/listings/:id/offer', (req, res) => {
  try {
    res.json(lance.sendOffer(req.params.id, req.body || {}, req.user));
  } catch (e) {
    fail(res, e);
  }
});

admin.post('/opportunities/:id/request-consent', (req, res) => {
  try {
    res.json(lance.requestConsent(req.params.id, req.user, req.body || {}));
  } catch (e) {
    fail(res, e);
  }
});

admin.post('/opportunities/:id/forward', (req, res) => {
  try {
    res.json(lance.forwardToHub(req.params.id, req.body || {}, req.user));
  } catch (e) {
    fail(res, e);
  }
});

admin.post('/opportunities/:id/status', (req, res) => {
  try {
    const to = req.body && req.body.status;
    res.json(lance.changeStatus(req.params.id, to, req.user, req.body || {}));
  } catch (e) {
    fail(res, e);
  }
});

admin.post('/opportunities/:id/reserve', (req, res) => {
  try {
    const b = req.body || {};
    res.json(lance.reserveOpportunity(req.params.id, b.dealerId, req.user, b.hours));
  } catch (e) {
    fail(res, e);
  }
});

admin.post('/opportunities/:id/negotiate', (req, res) => {
  try {
    res.json(lance.startNegotiation(req.params.id, req.user, req.body || {}));
  } catch (e) {
    fail(res, e);
  }
});

admin.post('/opportunities/:id/resolve-dispute', (req, res) => {
  try {
    res.json(lance.resolveDispute(req.params.id, req.user, req.body || {}));
  } catch (e) {
    fail(res, e);
  }
});

admin.get('/own-box', (req, res) => {
  try {
    res.json({ items: lance.ownBoxList(req.user), ownBuyEnabled: !!lance.getSettings().ownBuyEnabled });
  } catch (e) {
    fail(res, e);
  }
});

admin.post('/opportunities/:id/own-box', (req, res) => {
  try {
    res.json(lance.putInOwnBox(req.params.id, req.user));
  } catch (e) {
    fail(res, e);
  }
});

admin.post('/opportunities/:id/own-buy', masterRequired, (req, res) => {
  try {
    res.json(lance.updateOwnBuy(req.params.id, req.body || {}, req.user));
  } catch (e) {
    fail(res, e);
  }
});

admin.get('/dealers', (_req, res) => {
  const apps = db
    .all('dealerApplications')
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((a) => {
      const user = db.findById('users', a.userId);
      const profile = lance.dealerProfileOf(a.userId);
      return {
        ...a,
        user: user ? publicUser(user) : null,
        profile: profile
          ? {
              id: profile.id,
              status: profile.status,
              founder: !!profile.founder,
              benefitUntil: profile.benefitUntil || null,
              couponCode: profile.couponCode || '',
            }
          : null,
      };
    });
  const profiles = db
    .all('dealerProfiles')
    .slice()
    .sort((a, b) => new Date(b.approvedAt || 0) - new Date(a.approvedAt || 0))
    .map((p) => {
      const user = db.findById('users', p.userId);
      return { ...p, user: user ? publicUser(user) : null };
    });
  res.json({ applications: apps, profiles });
});

admin.post('/dealers/:id/review', (req, res) => {
  try {
    const b = req.body || {};
    res.json(lance.reviewDealer(req.params.id, b.action, req.user, b.note));
  } catch (e) {
    fail(res, e);
  }
});

admin.post('/dealers/:id/benefit', masterRequired, (req, res) => {
  try {
    res.json(lance.grantDealerBenefit(req.params.id, req.body || {}, req.user));
  } catch (e) {
    fail(res, e);
  }
});

admin.get('/audit', masterRequired, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  let rows = db.all('opportunityEvents').slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (req.query.opportunityId) rows = rows.filter((e) => e.opportunityId === req.query.opportunityId);
  if (q) {
    rows = rows.filter((e) => {
      const hay = [e.action, e.actorRole, e.opportunityId, e.listingId].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }
  res.json({ items: rows.slice(0, 200) });
});

module.exports = { publicRouter: router, adminRouter: admin };
