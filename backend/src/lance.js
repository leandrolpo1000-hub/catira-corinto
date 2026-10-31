const db = require('./db');
const { isAdminRole, publicUser, safeUser } = require('./middleware');
const { imagesOf, categoryOf, timeAgo } = require('./helpers');

const SETTINGS_ID = 'lance';

const OPP_STATUSES = ['under_review', 'available', 'reserved', 'negotiating', 'completed', 'cancelled', 'expired', 'disputed'];
const OFFER_STATUSES = ['sent', 'accepted', 'rejected', 'expired'];
const DEALER_APP_STATUSES = ['pending', 'approved', 'rejected'];
const INTEREST_STATUSES = ['interested', 'withdrawn', 'selected', 'rejected'];
const FEE_TYPES = ['percent', 'fixed', 'both'];
const OWN_BUY_STATUSES = [
  'evaluating',
  'offer_sent',
  'offer_accepted',
  'awaiting_fulfillment',
  'payment_recorded',
  'acquisition_completed',
  'available_for_resale',
  'resold',
  'cancelled',
  'disputed',
];

const STATUS_LABEL = {
  under_review: 'Oportunidade em análise',
  available: 'Disponível para propostas',
  reserved: 'Reservada',
  negotiating: 'Negociação em andamento',
  completed: 'Concluída',
  cancelled: 'Cancelada',
  expired: 'Expirada',
  disputed: 'Em disputa',
};

const OWN_BUY_LABEL = {
  evaluating: 'Avaliando compra própria',
  offer_sent: 'Proposta de compra enviada',
  offer_accepted: 'Proposta aceita, aguardando cumprimento',
  awaiting_fulfillment: 'Aguardando cumprimento',
  payment_recorded: 'Pagamento registrado',
  acquisition_completed: 'Aquisição concluída',
  available_for_resale: 'Disponível para revenda',
  resold: 'Revendido',
  cancelled: 'Compra própria cancelada',
  disputed: 'Compra própria em disputa',
};

const DEFAULTS = {
  id: SETTINGS_ID,
  intermediationEnabled: true,
  ownBuyEnabled: false,
  defaultHoldHours: 24,
  founderLimit: 50,
  founderFreeDays: 90,
  termsVersion: '1',
  feeType: 'fixed',
  feePercent: 0,
  feeFixed: 0,
  feeMin: 0,
  completionRule: 'both_parties',
};

const TRANSITIONS = {
  under_review: ['available', 'cancelled', 'expired'],
  available: ['reserved', 'negotiating', 'cancelled', 'expired', 'under_review', 'disputed'],
  reserved: ['available', 'negotiating', 'cancelled', 'expired', 'disputed'],
  negotiating: ['reserved', 'available', 'completed', 'cancelled', 'expired', 'disputed'],
  completed: [],
  cancelled: [],
  expired: ['under_review', 'available'],
  disputed: ['negotiating', 'cancelled', 'available'],
};

function flagOn(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

function money2(n) {
  const x = Number(n);
  return Number.isFinite(x) && x >= 0 ? Math.round(x * 100) / 100 : 0;
}

function parseMoney(raw, label) {
  const n = Number(String(raw == null ? '' : raw).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) {
    const err = new Error('Informe um valor válido para ' + (label || 'o preço') + '.');
    err.status = 400;
    throw err;
  }
  return Math.round(n * 100) / 100;
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function getSettings() {
  const row = db.findOne('settings', (s) => s.id === SETTINGS_ID) || {};
  return { ...DEFAULTS, ...row, id: SETTINGS_ID, ownBuyEnabled: flagOn(row.ownBuyEnabled) };
}

function clampMoney(n, min, max) {
  const x = money2(n);
  if (x < min || x > max) throw httpError(400, 'Valor fora do intervalo permitido.');
  return x;
}

function parseFeeType(v, fallback) {
  const t = String(v || fallback || 'fixed');
  if (!FEE_TYPES.includes(t)) throw httpError(400, 'Tipo de taxa inválido.');
  return t;
}

function computeFee(goodsPrice, settings, override) {
  const cfg = settings || getSettings();
  const goods = money2(goodsPrice);
  if (override !== undefined && override !== null && override !== '') {
    return money2(override);
  }
  const t = parseFeeType(cfg.feeType, 'fixed');
  let fee = 0;
  if (t === 'percent' || t === 'both') {
    fee += money2(goods * (money2(cfg.feePercent) / 100));
  }
  if (t === 'fixed' || t === 'both') {
    fee += money2(cfg.feeFixed);
  }
  const min = money2(cfg.feeMin);
  if (fee < min) fee = min;
  return money2(fee);
}

function feeBreakdown(opp, settings) {
  const goods = money2((opp && opp.goodsPrice) || (opp && opp.sellerAskPrice) || 0);
  const fee = money2((opp && opp.intermediationFee) || 0);
  const toSeller = goods;
  const toPlatform = fee;
  const totalBuyer = money2(toSeller + toPlatform);
  const cfg = settings || getSettings();
  return {
    goodsPrice: goods,
    fee,
    toSeller,
    toPlatform,
    totalBuyer,
    feeType: cfg.feeType || 'fixed',
    feePercent: money2(cfg.feePercent),
    feeFixed: money2(cfg.feeFixed),
    feeMin: money2(cfg.feeMin),
    dueWhen: 'Somente quando a compra e venda intermediada for concluída.',
    payer: 'catireiro',
    sellerCharged: false,
    chargedNow: false,
  };
}

function consentFingerprint(data) {
  const d = data || {};
  return [
    money2(d.goodsPrice),
    money2(d.intermediationFee),
    String(d.conditions || '').trim(),
    String(d.termsVersion || '1'),
    String(d.purpose || 'central_de_repasse'),
  ].join('|');
}

function disclosureSummary(extra) {
  const cfg = getSettings();
  return {
    purpose: 'central_de_repasse',
    termsVersion: (extra && extra.termsVersion) || cfg.termsVersion || '1',
    disclosed: ['fotos autorizadas', 'descrição do item', 'cidade', 'valor e condições comerciais', 'taxa do catireiro'],
    notDisclosed: ['telefone', 'endereço residencial', 'documento pessoal'],
    goodsPrice: extra ? money2(extra.goodsPrice) : 0,
    intermediationFee: extra ? money2(extra.intermediationFee) : 0,
    conditions: extra ? String(extra.conditions || '').trim() : '',
    feeNote: 'A taxa é do catireiro e só vira devida se a venda intermediada for concluída.',
    validUntil: (extra && extra.validUntil) || null,
  };
}

function isConsentValid(opp, proposed) {
  if (!opp || !opp.consentToShare) return false;
  if (opp.consentRevokedAt) return false;
  if (opp.consentValidUntil) {
    const t = new Date(opp.consentValidUntil).getTime();
    if (Number.isFinite(t) && t <= Date.now()) return false;
  }
  if (opp.consentSnapshot && proposed) {
    return consentFingerprint(proposed) === consentFingerprint(opp.consentSnapshot);
  }
  return true;
}

function completionBlockReason(opp) {
  if (!opp) return 'Oportunidade não encontrada.';
  if (opp.status === 'completed') return '';
  if (opp.status === 'disputed') return 'Há uma disputa em aberto. Resolva com registro antes de concluir.';
  if (opp.status === 'cancelled') return 'Operação cancelada. Não gera taxa de conclusão.';
  if (opp.status === 'expired') return 'Operação expirada. Não gera taxa de conclusão.';
  if (!opp.sellerConfirmedAt) return 'Falta a confirmação do vendedor.';
  if (!opp.dealerConfirmedAt) return 'Falta a confirmação do catireiro.';
  if (!['reserved', 'negotiating'].includes(opp.status)) return 'A oportunidade ainda não está em negociação com as partes identificadas.';
  return '';
}

function requireSellerActor(listing, user, message) {
  if (!listing || !user || listing.userId !== user.id) {
    throw httpError(403, message || 'Só o vendedor pode fazer esta ação.');
  }
}

function saveSettings(patch, actor) {
  const current = getSettings();
  if (patch.ownBuyEnabled !== undefined && flagOn(patch.ownBuyEnabled) && !(actor && actor.role === 'master')) {
    throw httpError(403, 'Só o admin master pode ativar compra e revenda própria.');
  }
  const next = {
    id: SETTINGS_ID,
    intermediationEnabled: patch.intermediationEnabled !== undefined ? flagOn(patch.intermediationEnabled) : current.intermediationEnabled !== false,
    ownBuyEnabled: patch.ownBuyEnabled !== undefined ? flagOn(patch.ownBuyEnabled) : !!current.ownBuyEnabled,
    defaultHoldHours: (() => {
      if (patch.defaultHoldHours === undefined || patch.defaultHoldHours === '') return current.defaultHoldHours;
      const n = parseInt(patch.defaultHoldHours, 10);
      if (!Number.isFinite(n) || n < 1 || n > 168) throw httpError(400, 'Informe a reserva em horas (1 a 168).');
      return n;
    })(),
    founderLimit: (() => {
      if (patch.founderLimit === undefined || patch.founderLimit === '') return current.founderLimit;
      const n = parseInt(patch.founderLimit, 10);
      if (!Number.isFinite(n) || n < 1 || n > 500) throw httpError(400, 'Informe o limite de fundadores (1 a 500).');
      return n;
    })(),
    founderFreeDays: (() => {
      if (patch.founderFreeDays === undefined || patch.founderFreeDays === '') return current.founderFreeDays;
      const n = parseInt(patch.founderFreeDays, 10);
      if (!Number.isFinite(n) || n < 1 || n > 365) throw httpError(400, 'Informe os dias de benefício (1 a 365).');
      return n;
    })(),
    termsVersion: current.termsVersion || '1',
    feeType: patch.feeType !== undefined ? parseFeeType(patch.feeType, current.feeType) : (current.feeType || 'fixed'),
    feePercent: patch.feePercent !== undefined && patch.feePercent !== '' ? clampMoney(patch.feePercent, 0, 50) : money2(current.feePercent),
    feeFixed: patch.feeFixed !== undefined && patch.feeFixed !== '' ? clampMoney(patch.feeFixed, 0, 100000) : money2(current.feeFixed),
    feeMin: patch.feeMin !== undefined && patch.feeMin !== '' ? clampMoney(patch.feeMin, 0, 100000) : money2(current.feeMin),
    completionRule: patch.completionRule === 'admin' ? 'admin' : (patch.completionRule === 'both_parties' ? 'both_parties' : (current.completionRule || 'both_parties')),
  };
  const existing = db.findById('settings', SETTINGS_ID);
  const saved = existing ? db.update('settings', SETTINGS_ID, next) : db.insert('settings', next);
  audit({ action: 'settings_saved', actorId: actor && actor.id, actorRole: actor && actor.role, payload: { ownBuyEnabled: saved.ownBuyEnabled, feeType: saved.feeType } });
  return saved;
}

function ensureSettings() {
  if (!db.findById('settings', SETTINGS_ID)) db.insert('settings', { ...DEFAULTS });
}

function canTransition(from, to) {
  return !!(TRANSITIONS[from] && TRANSITIONS[from].includes(to));
}

function dealerProfileOf(userId) {
  if (!userId) return null;
  return db.findOne('dealerProfiles', (p) => p.userId === userId) || null;
}

function isActiveDealer(user) {
  if (!user) return false;
  if (isAdminRole(user.role)) return true;
  const p = dealerProfileOf(user.id);
  return !!(p && p.status === 'active');
}

function dealerApplicationOf(userId) {
  if (!userId) return null;
  const apps = db.findWhere('dealerApplications', (a) => a.userId === userId);
  apps.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return apps[0] || null;
}

function dealerPublic(user) {
  const profile = dealerProfileOf(user && user.id);
  const app = dealerApplicationOf(user && user.id);
  let dealerStatus = 'none';
  if (profile && profile.status === 'active') dealerStatus = 'approved';
  else if (profile && profile.status === 'suspended') dealerStatus = 'suspended';
  else if (app) dealerStatus = app.status;
  return {
    dealerStatus,
    dealerFounder: !!(profile && profile.founder),
    dealerBenefitUntil: (profile && profile.benefitUntil) || null,
  };
}

function audit(row) {
  return db.insert('opportunityEvents', {
    opportunityId: row.opportunityId || null,
    listingId: row.listingId || null,
    actorId: row.actorId || null,
    actorRole: row.actorRole || '',
    action: row.action,
    payload: row.payload || null,
    createdAt: new Date().toISOString(),
  });
}

function listingSnapshot(listing) {
  if (!listing) return null;
  const cat = categoryOf(listing.categoryId);
  const images = imagesOf(listing.id).map((img) => ({ id: img.id, url: img.url, order: img.order || 0 }));
  return {
    id: listing.id,
    title: listing.title,
    description: listing.description,
    condition: listing.condition || 'usado',
    city: listing.city || '',
    cityId: listing.cityId || '',
    categoryId: listing.categoryId,
    categoryName: cat ? cat.name : '',
    price: listing.price,
    images,
    listingType: listing.listingType || 'venda',
    status: listing.status,
  };
}

function publicSellerBrief(user) {
  if (!user) return null;
  const s = safeUser(user);
  if (!s) return null;
  return { id: s.id, name: s.name, city: s.city, cityId: s.cityId, avatarColor: s.avatarColor };
}

function serializeOffer(o) {
  if (!o) return null;
  const origin = o.origin === 'own_buy' ? 'own_buy' : 'third_party';
  return {
    id: o.id,
    opportunityId: o.opportunityId,
    listingId: o.listingId,
    amount: o.amount,
    validUntil: o.validUntil,
    conditions: o.conditions || '',
    status: o.status,
    createdAt: o.createdAt,
    respondedAt: o.respondedAt || null,
    origin,
    originLabel: origin === 'own_buy' ? 'Proposta de compra própria' : 'Proposta encaminhada de terceiro',
    presentedBy: o.presentedBy || '',
    notes: o.notes || '',
  };
}

function serializeInterest(i, { admin } = {}) {
  if (!i) return null;
  const user = db.findById('users', i.dealerId);
  const profile = dealerProfileOf(i.dealerId);
  return {
    id: i.id,
    opportunityId: i.opportunityId,
    dealerId: i.dealerId,
    status: i.status,
    note: i.note || '',
    createdAt: i.createdAt,
    dealer: admin
      ? {
          id: user && user.id,
          name: user && user.name,
          city: (profile && profile.city) || (user && user.city) || '',
          phone: admin ? ((profile && profile.phone) || (user && user.phone) || '') : '',
          founder: !!(profile && profile.founder),
        }
      : {
          id: user && user.id,
          name: user && user.name,
          city: (profile && profile.city) || (user && user.city) || '',
          founder: !!(profile && profile.founder),
        },
  };
}

function serializeOpportunity(opp, opts = {}) {
  if (!opp) return null;
  const listing = db.findById('listings', opp.listingId);
  const snap = listingSnapshot(listing);
  const seller = db.findById('users', opp.sellerId);
  const adminView = !!opts.admin;
  const sellerView = !!opts.seller;
  const breakdown = feeBreakdown(opp);
  const base = {
    id: opp.id,
    listingId: opp.listingId,
    status: opp.status,
    statusLabel: STATUS_LABEL[opp.status] || opp.status,
    mode: opp.mode || 'intermediation',
    modeLabel: (opp.mode || 'intermediation') === 'own_buy' ? 'Compra própria' : 'Intermediação',
    referencePrice: opp.referencePrice,
    conditions: opp.conditions || '',
    conditionNote: opp.conditionNote || (snap && snap.condition) || '',
    city: opp.city || (snap && snap.city) || '',
    cityId: opp.cityId || (snap && snap.cityId) || '',
    categoryId: opp.categoryId || (snap && snap.categoryId) || '',
    categoryName: snap && snap.categoryName,
    validUntil: opp.validUntil || null,
    reservedUntil: opp.reservedUntil || null,
    createdAt: opp.createdAt,
    updatedAt: opp.updatedAt,
    forwardedAt: opp.forwardedAt || null,
    timeAgo: timeAgo(opp.updatedAt || opp.createdAt),
    confirmations: {
      seller: !!opp.sellerConfirmedAt,
      dealer: !!opp.dealerConfirmedAt,
    },
    feeBreakdown: {
      goodsPrice: breakdown.goodsPrice,
      fee: breakdown.fee,
      toSeller: breakdown.toSeller,
      toPlatform: breakdown.toPlatform,
      totalBuyer: breakdown.totalBuyer,
      dueWhen: breakdown.dueWhen,
      payer: breakdown.payer,
      sellerCharged: false,
      chargedNow: opp.status === 'completed' && (opp.mode || 'intermediation') !== 'own_buy' && !!opp.feeDue,
      isEstimate: !(opp.status === 'completed' && (opp.mode || 'intermediation') !== 'own_buy' && !!opp.feeDue),
      totalNote: opp.status === 'completed' && opp.feeDue
        ? 'Valor das condições concluídas.'
        : 'Estimativa das condições apresentadas. Só vira devido se a venda for concluída.',
    },
    listing: snap
      ? {
          id: snap.id,
          title: snap.title,
          description: snap.description,
          condition: snap.condition,
          city: snap.city,
          images: snap.images,
          listingType: snap.listingType,
        }
      : null,
  };
  if (adminView || sellerView) {
    base.sellerAskPrice = opp.sellerAskPrice;
    base.goodsPrice = opp.goodsPrice;
    base.intermediationFee = opp.intermediationFee;
      base.consentToShare = isConsentValid(opp);
      base.consentAt = opp.consentAt || null;
      base.consentTermsVersion = opp.consentTermsVersion || null;
      base.consentModality = opp.consentModality || null;
      base.consentValidUntil = opp.consentValidUntil || null;
      base.consentRevokedAt = opp.consentRevokedAt || null;
      base.consentRequestedAt = opp.consentRequestedAt || null;
      base.pendingConsent = opp.pendingConsent || null;
      base.feeConfigured = !!opp.feeConfigured || money2(opp.intermediationFee) > 0;
      base.completionBlocked = completionBlockReason(opp);
    base.waitForEvaluation = !!(listing && listing.waitForEvaluation);
    base.quickOfferEnabled = !!(listing && listing.quickOfferEnabled);
    base.sellerConfirmedAt = opp.sellerConfirmedAt || null;
    base.dealerConfirmedAt = opp.dealerConfirmedAt || null;
    base.disputeReason = opp.disputeReason || '';
    base.ownBuyStatus = opp.ownBuyStatus || null;
    base.ownBuyStatusLabel = opp.ownBuyStatus ? (OWN_BUY_LABEL[opp.ownBuyStatus] || opp.ownBuyStatus) : null;
    base.inOwnBox = !!opp.inOwnBox;
    base.offers = db
      .findWhere('opportunityOffers', (o) => o.opportunityId === opp.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(serializeOffer);
    if (sellerView) {
      base.seller = publicUser(seller);
    }
  }
  if (adminView) {
    base.seller = seller ? publicUser(seller) : null;
    base.reservedBy = opp.reservedBy || null;
    base.forwardedBy = opp.forwardedBy || null;
    base.interests = db
      .findWhere('opportunityInterests', (i) => i.opportunityId === opp.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((i) => serializeInterest(i, { admin: true }));
    base.feeDue = !!opp.feeDue;
    base.feeCharged = !!opp.feeCharged;
    base.noChargeReason = opp.noChargeReason || '';
    base.disputeResolution = opp.disputeResolution || '';
    base.disputeResolvedAt = opp.disputeResolvedAt || null;
    base.reservedByAdmin = opp.reservedByAdmin || null;
    base.acquisition = {
      enabled: !!getSettings().ownBuyEnabled,
      inOwnBox: !!opp.inOwnBox,
      ownBuyStatus: opp.ownBuyStatus || null,
      ownBuyStatusLabel: opp.ownBuyStatus ? (OWN_BUY_LABEL[opp.ownBuyStatus] || opp.ownBuyStatus) : null,
      acquisitionPrice: opp.acquisitionPrice || null,
      acquisitionProof: opp.acquisitionProof || '',
      paymentStatus: opp.paymentStatus || '',
      possessionStatus: opp.possessionStatus || '',
      costs: opp.costs || 0,
      resalePrice: opp.resalePrice || null,
      estimatedMargin: opp.estimatedMargin || null,
      fiscalDocs: opp.fiscalDocs || '',
      resalePublic: !!opp.resalePublic,
    };
    base.events = db
      .findWhere('opportunityEvents', (e) => e.opportunityId === opp.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 40);
  } else {
    base.seller = publicSellerBrief(seller);
  }
  if (opts.dealerId) {
    const mine = db.findOne(
      'opportunityInterests',
      (i) => i.opportunityId === opp.id && i.dealerId === opts.dealerId && (i.status === 'interested' || i.status === 'selected')
    );
    base.myInterest = mine ? { id: mine.id, createdAt: mine.createdAt, status: mine.status } : null;
  }
  return base;
}

function opportunityOfListing(listingId) {
  return db.findOne('opportunities', (o) => o.listingId === listingId) || null;
}

function ensureOpportunityForListing(listing, actor) {
  let opp = opportunityOfListing(listing.id);
  const now = new Date().toISOString();
  if (opp) return opp;
  opp = db.insert('opportunities', {
    listingId: listing.id,
    sellerId: listing.userId,
    status: 'under_review',
    mode: 'intermediation',
    sellerAskPrice: money2(listing.price),
    referencePrice: money2(listing.price),
    goodsPrice: money2(listing.price),
    intermediationFee: 0,
    conditions: '',
    conditionNote: listing.condition || '',
    city: listing.city || '',
    cityId: listing.cityId || '',
    categoryId: listing.categoryId || '',
    validUntil: null,
    reservedBy: null,
    reservedUntil: null,
    consentToShare: false,
    consentAt: null,
    consentTermsVersion: null,
    consentModality: null,
    consentSnapshot: null,
    consentValidUntil: null,
    consentRevokedAt: null,
    consentRequestedAt: null,
    pendingConsent: null,
    feeConfigured: false,
    sellerConfirmedAt: null,
    dealerConfirmedAt: null,
    confirmedByAdminAt: null,
    disputeReason: '',
    disputedAt: null,
    disputedBy: null,
    feeDue: false,
    feeCharged: false,
    feeSnapshot: null,
    inOwnBox: false,
    ownBuyStatus: null,
    ownBuyModeLocked: false,
    resalePublic: false,
    forwardedAt: null,
    forwardedBy: null,
    cancelledReason: '',
    acquisitionPrice: null,
    acquisitionProof: '',
    paymentStatus: '',
    possessionStatus: '',
    costs: 0,
    resalePrice: null,
    estimatedMargin: null,
    fiscalDocs: '',
    createdAt: now,
    updatedAt: now,
  });
  audit({
    opportunityId: opp.id,
    listingId: listing.id,
    actorId: actor && actor.id,
    actorRole: (actor && actor.role) || 'user',
    action: 'opportunity_created',
    payload: { source: 'quick_offer' },
  });
  return opp;
}

function onListingCreated(listing, flags, user) {
  if (!listing) return null;
  if (!flags.quickOfferEnabled) return null;
  if ((listing.listingType || 'venda') === 'procuro') return null;
  return ensureOpportunityForListing(listing, user);
}

function expireOffers(nowMs) {
  const now = nowMs || Date.now();
  db.findWhere('opportunityOffers', (o) => o.status === 'sent' && o.validUntil).forEach((o) => {
    const t = new Date(o.validUntil).getTime();
    if (!Number.isFinite(t) || t > now) return;
    db.update('opportunityOffers', o.id, { status: 'expired', respondedAt: new Date(now).toISOString() });
    audit({ opportunityId: o.opportunityId, listingId: o.listingId, action: 'offer_expired', payload: { offerId: o.id } });
  });
}

function expireReservations(nowMs) {
  const now = nowMs || Date.now();
  db.findWhere('opportunities', (o) => o.status === 'reserved' && o.reservedUntil).forEach((o) => {
    const t = new Date(o.reservedUntil).getTime();
    if (!Number.isFinite(t) || t > now) return;
    const previousDealer = o.reservedBy;
    db.update('opportunities', o.id, {
      status: 'available',
      reservedBy: null,
      reservedUntil: null,
      updatedAt: new Date(now).toISOString(),
    });
    if (previousDealer) {
      db.findWhere('opportunityInterests', (i) => i.opportunityId === o.id && i.dealerId === previousDealer && i.status === 'selected').forEach((i) => {
        db.update('opportunityInterests', i.id, { status: 'interested' });
      });
    }
    audit({ opportunityId: o.id, listingId: o.listingId, action: 'reservation_expired', payload: { previousDealer } });
  });
}

function expireOpportunities(nowMs) {
  const now = nowMs || Date.now();
  db.findWhere('opportunities', (o) => o.validUntil && ['under_review', 'available', 'reserved'].includes(o.status)).forEach((o) => {
    const t = new Date(o.validUntil).getTime();
    if (!Number.isFinite(t) || t > now) return;
    db.update('opportunities', o.id, {
      status: 'expired',
      reservedBy: null,
      reservedUntil: null,
      updatedAt: new Date(now).toISOString(),
    });
    audit({ opportunityId: o.id, listingId: o.listingId, action: 'opportunity_expired' });
  });
}

function expireLance() {
  const now = Date.now();
  expireOffers(now);
  expireReservations(now);
  expireOpportunities(now);
}

function assertMode(mode) {
  const cfg = getSettings();
  const m = mode === 'own_buy' ? 'own_buy' : 'intermediation';
  if (m === 'own_buy' && !cfg.ownBuyEnabled) {
    throw httpError(403, 'Compra e revenda própria está desativada.');
  }
  if (m === 'intermediation' && cfg.intermediationEnabled === false) {
    throw httpError(403, 'Intermediação está desativada.');
  }
  return m;
}

function setStatus(opp, to, actor, extra = {}) {
  expireLance();
  const fresh = db.findById('opportunities', opp.id) || opp;
  if (fresh.status === to) {
    return db.update('opportunities', fresh.id, { ...extra, updatedAt: new Date().toISOString() }) || fresh;
  }
  if (!canTransition(fresh.status, to)) {
    throw httpError(400, 'Não é possível mudar de ' + (STATUS_LABEL[fresh.status] || fresh.status) + ' para ' + (STATUS_LABEL[to] || to) + '.');
  }
  const patch = {
    status: to,
    updatedAt: new Date().toISOString(),
    ...extra,
  };
  if (to !== 'reserved') {
    if (extra.reservedBy === undefined) {
      patch.reservedBy = to === 'negotiating' ? fresh.reservedBy : null;
      patch.reservedUntil = to === 'negotiating' ? fresh.reservedUntil : null;
    }
  }
  const updated = db.update('opportunities', fresh.id, patch);
  audit({
    opportunityId: fresh.id,
    listingId: fresh.listingId,
    actorId: actor && actor.id,
    actorRole: (actor && actor.role) || '',
    action: 'status_changed',
    payload: { from: fresh.status, to, extra: Object.keys(extra) },
  });
  return updated;
}

function sendOffer(listingId, body, admin) {
  expireLance();
  const listing = db.findById('listings', listingId);
  if (!listing) throw httpError(404, 'Anúncio não encontrado.');
  if ((listing.listingType || 'venda') === 'procuro') throw httpError(400, 'Proposta rápida não se aplica a anúncios Procuro.');
  const opp = ensureOpportunityForListing(listing, admin);
  const amount = parseMoney(body.amount, 'a proposta');
  if (amount <= 0) throw httpError(400, 'Informe o valor da proposta.');
  const hours = parseInt(body.validHours == null ? 48 : body.validHours, 10);
  if (!Number.isFinite(hours) || hours < 1 || hours > 720) throw httpError(400, 'Informe a validade em horas (1 a 720).');
  const validUntil = new Date(Date.now() + hours * 3600000).toISOString();
  const conditions = String(body.conditions || '').trim().slice(0, 2000);
  db.findWhere('opportunityOffers', (o) => o.opportunityId === opp.id && o.status === 'sent').forEach((o) => {
    db.update('opportunityOffers', o.id, { status: 'expired', respondedAt: new Date().toISOString() });
  });
  const origin = body.origin === 'own_buy' ? 'own_buy' : 'third_party';
  if (origin === 'own_buy' && !getSettings().ownBuyEnabled) {
    throw httpError(403, 'Compra própria está desativada. Esta proposta não pode ser de compra pessoal.');
  }
  const presentedBy = String(body.presentedBy || '').trim().slice(0, 120);
  const notes = String(body.notes || '').trim().slice(0, 2000);
  const offer = db.insert('opportunityOffers', {
    opportunityId: opp.id,
    listingId: listing.id,
    sellerId: listing.userId,
    adminId: admin.id,
    amount,
    validUntil,
    conditions,
    status: 'sent',
    origin,
    presentedBy: presentedBy || (origin === 'own_buy' ? 'Administrador (compra própria)' : 'Terceiro, encaminhada pelo administrador'),
    notes,
    createdAt: new Date().toISOString(),
    respondedAt: null,
  });
  db.update('opportunities', opp.id, {
    sellerAskPrice: amount,
    updatedAt: new Date().toISOString(),
  });
  audit({
    opportunityId: opp.id,
    listingId: listing.id,
    actorId: admin.id,
    actorRole: admin.role,
    action: 'offer_sent',
    payload: { offerId: offer.id, amount, validUntil, origin, presentedBy: presentedBy || '' },
  });
  return { opportunity: serializeOpportunity(db.findById('opportunities', opp.id), { admin: true }), offer: serializeOffer(offer) };
}

function respondOffer(offerId, action, user) {
  expireLance();
  const offer = db.findById('opportunityOffers', offerId);
  if (!offer) throw httpError(404, 'Proposta não encontrada.');
  if (offer.sellerId !== user.id) throw httpError(403, 'Só o vendedor responde a própria proposta.');
  if (offer.status !== 'sent') throw httpError(400, 'Esta proposta já foi respondida ou expirou.');
  if (new Date(offer.validUntil).getTime() <= Date.now()) {
    db.update('opportunityOffers', offer.id, { status: 'expired', respondedAt: new Date().toISOString() });
    throw httpError(400, 'Esta proposta expirou.');
  }
  if (action !== 'accept' && action !== 'reject') throw httpError(400, 'Ação inválida.');
  const status = action === 'accept' ? 'accepted' : 'rejected';
  const updated = db.update('opportunityOffers', offer.id, { status, respondedAt: new Date().toISOString() });
  const opp = db.findById('opportunities', offer.opportunityId);
  if (opp && action === 'accept') {
    const patch = {
      sellerAskPrice: offer.amount,
      updatedAt: new Date().toISOString(),
    };
    if (!opp.forwardedAt && !opp.consentToShare) {
      patch.goodsPrice = offer.amount;
    }
    db.update('opportunities', opp.id, patch);
  }
  audit({
    opportunityId: offer.opportunityId,
    listingId: offer.listingId,
    actorId: user.id,
    actorRole: user.role,
    action: action === 'accept' ? 'offer_accepted' : 'offer_rejected',
    payload: { offerId: offer.id, amount: offer.amount },
  });
  return { offer: serializeOffer(updated), opportunity: serializeOpportunity(db.findById('opportunities', offer.opportunityId), { seller: true }) };
}

function requestConsent(opportunityId, admin, body) {
  expireLance();
  if (!isAdminRole(admin && admin.role)) throw httpError(403, 'Sem permissão.');
  const opp = db.findById('opportunities', opportunityId);
  if (!opp) throw httpError(404, 'Oportunidade não encontrada.');
  const listing = db.findById('listings', opp.listingId);
  if (!listing) throw httpError(404, 'Anúncio não encontrado.');
  const cfg = getSettings();
  const goodsPrice = body && body.goodsPrice !== undefined
    ? parseMoney(body.goodsPrice, 'o preço da mercadoria')
    : money2(opp.goodsPrice || opp.sellerAskPrice || listing.price);
  const feeExplicit = body && body.intermediationFee !== undefined && body.intermediationFee !== '';
  if (feeExplicit && admin.role !== 'master') {
    throw httpError(403, 'Só o admin master configura remuneração.');
  }
  if (!feeExplicit && !opp.feeConfigured) {
    throw httpError(400, 'Defina a remuneração desta oportunidade antes de pedir autorização.');
  }
  const fee = feeExplicit
    ? parseMoney(body.intermediationFee, 'a remuneração')
    : money2(opp.intermediationFee);
  const hours = body && body.validHours !== undefined ? parseInt(body.validHours, 10) : null;
  const validUntil = hours
    ? new Date(Date.now() + hours * 3600000).toISOString()
    : (body && body.validUntil) || opp.validUntil || null;
  const conditions = body && body.conditions !== undefined
    ? String(body.conditions || '').trim().slice(0, 2000)
    : (opp.conditions || '');
  const summary = disclosureSummary({
    goodsPrice,
    intermediationFee: fee,
    conditions,
    termsVersion: cfg.termsVersion || '1',
    validUntil,
  });
  const now = new Date().toISOString();
  const pending = {
    requestedAt: now,
    requestedBy: admin.id,
    goodsPrice,
    intermediationFee: fee,
    conditions,
    validUntil,
    termsVersion: summary.termsVersion,
    purpose: 'central_de_repasse',
    disclosed: summary.disclosed,
    notDisclosed: summary.notDisclosed,
    feeNote: summary.feeNote,
    fingerprint: consentFingerprint(summary),
  };
  const updated = db.update('opportunities', opp.id, {
    pendingConsent: pending,
    consentRequestedAt: now,
    goodsPrice,
    intermediationFee: fee,
    conditions,
    validUntil,
    feeConfigured: true,
    updatedAt: now,
  });
  audit({
    opportunityId: opp.id,
    listingId: opp.listingId,
    actorId: admin.id,
    actorRole: admin.role,
    action: 'consent_requested',
    payload: { goodsPrice, intermediationFee: fee, termsVersion: summary.termsVersion },
  });
  return serializeOpportunity(updated, { admin: true });
}

function sellerConsent(listingId, user, consent, extra) {
  const listing = db.findById('listings', listingId);
  if (!listing) throw httpError(404, 'Anúncio não encontrado.');
  requireSellerActor(listing, user, 'Só o vendedor autoriza a divulgação.');
  const opp = ensureOpportunityForListing(listing, user);
  const on = flagOn(consent);
  const now = new Date().toISOString();
  const termsVersion = (extra && extra.termsVersion) || (opp.pendingConsent && opp.pendingConsent.termsVersion) || getSettings().termsVersion || '1';
  if (!on) {
    const updated = db.update('opportunities', opp.id, {
      consentToShare: false,
      consentRevokedAt: now,
      pendingConsent: null,
      updatedAt: now,
    });
    audit({
      opportunityId: opp.id,
      listingId: listing.id,
      actorId: user.id,
      actorRole: user.role,
      action: 'consent_revoked',
      payload: { termsVersion, modality: 'intermediation' },
    });
    return serializeOpportunity(updated, { seller: true });
  }
  if (!opp.pendingConsent && !(extra && extra.requestedAt)) {
    throw httpError(400, 'Aguarde o pedido de autorização com o resumo do que será divulgado e as condições comerciais.');
  }
  const pending = opp.pendingConsent || extra || {};
  const snapshot = disclosureSummary({
    goodsPrice: pending.goodsPrice !== undefined ? pending.goodsPrice : opp.goodsPrice,
    intermediationFee: pending.intermediationFee !== undefined ? pending.intermediationFee : opp.intermediationFee,
    conditions: pending.conditions !== undefined ? pending.conditions : opp.conditions,
    termsVersion,
    validUntil: pending.validUntil || (extra && extra.validUntil) || opp.validUntil,
  });
  const hours = extra && extra.validHours !== undefined ? parseInt(extra.validHours, 10) : null;
  const consentValidUntil = hours
    ? new Date(Date.now() + hours * 3600000).toISOString()
    : (snapshot.validUntil || null);
  snapshot.validUntil = consentValidUntil;
  const updated = db.update('opportunities', opp.id, {
    consentToShare: true,
    consentAt: now,
    consentTermsVersion: termsVersion,
    consentModality: 'intermediation',
    consentSnapshot: snapshot,
    consentValidUntil,
    consentRevokedAt: null,
    pendingConsent: null,
    goodsPrice: snapshot.goodsPrice,
    intermediationFee: snapshot.intermediationFee,
    conditions: snapshot.conditions,
    feeConfigured: !!(opp.feeConfigured || pending.intermediationFee !== undefined || (extra && extra.intermediationFee !== undefined)),
    updatedAt: now,
  });
  audit({
    opportunityId: opp.id,
    listingId: listing.id,
    actorId: user.id,
    actorRole: user.role,
    action: 'consent_granted',
    payload: { termsVersion, modality: 'intermediation', fingerprint: consentFingerprint(snapshot) },
  });
  return serializeOpportunity(updated, { seller: true });
}

function forwardToHub(opportunityId, body, admin) {
  expireLance();
  const opp = db.findById('opportunities', opportunityId);
  if (!opp) throw httpError(404, 'Oportunidade não encontrada.');
  if (opp.inOwnBox && (opp.mode || 'intermediation') === 'own_buy') {
    throw httpError(400, 'Oportunidade na caixa própria não vai automaticamente à Central de Repasse.');
  }
  const requestedMode = body.mode || opp.mode || 'intermediation';
  if (requestedMode === 'own_buy' && opp.mode === 'intermediation' && opp.forwardedAt) {
    throw httpError(400, 'Não dá para mudar silenciosamente uma intermediação já encaminhada para compra própria.');
  }
  const mode = assertMode(requestedMode);
  if ((opp.mode || 'intermediation') !== mode) {
    audit({
      opportunityId: opp.id,
      listingId: opp.listingId,
      actorId: admin.id,
      actorRole: admin.role,
      action: 'modality_changed',
      payload: { from: opp.mode || 'intermediation', to: mode },
    });
  }
  const goodsPrice = body.goodsPrice !== undefined ? parseMoney(body.goodsPrice, 'o preço da mercadoria') : money2(opp.goodsPrice || opp.sellerAskPrice);
  const cfg = getSettings();
  const feeConfigured = !!(opp.feeConfigured || (body.intermediationFee !== undefined && body.intermediationFee !== '') || money2(opp.intermediationFee) > 0);
  if (mode === 'intermediation' && !feeConfigured) {
    throw httpError(400, 'Defina a taxa desta oportunidade antes de encaminhar à Central.');
  }
  const fee = body.intermediationFee !== undefined
    ? parseMoney(body.intermediationFee, 'a remuneração')
    : money2(opp.intermediationFee);
  const conditions = body.conditions !== undefined ? String(body.conditions || '').trim().slice(0, 2000) : (opp.conditions || '');
  const proposed = {
    goodsPrice,
    intermediationFee: fee,
    conditions,
    termsVersion: (opp.consentSnapshot && opp.consentSnapshot.termsVersion) || cfg.termsVersion || '1',
    purpose: 'central_de_repasse',
  };
  if (!isConsentValid(opp, proposed)) {
    throw httpError(400, 'O vendedor ainda não autorizou esta divulgação, ou as condições mudaram e é preciso uma nova autorização.');
  }
  const referencePrice = body.referencePrice !== undefined
    ? parseMoney(body.referencePrice, 'o preço de referência')
    : money2(goodsPrice + fee);
  if (mode === 'intermediation' && fee > 0 && referencePrice + 0.001 < goodsPrice + fee) {
    throw httpError(400, 'O preço apresentado ao catireiro deve cobrir a mercadoria e a remuneração acordada.');
  }
  if (admin.role !== 'master' && body && body.intermediationFee !== undefined) {
    throw httpError(403, 'Só o admin master configura remuneração.');
  }
  if (admin.role !== 'master' && mode === 'own_buy') {
    throw httpError(403, 'Só o admin master configura compra própria.');
  }
  const hours = body.validHours !== undefined ? parseInt(body.validHours, 10) : null;
  const validUntil = hours
    ? new Date(Date.now() + hours * 3600000).toISOString()
    : (body.validUntil || opp.validUntil || null);
  const now = new Date().toISOString();
  const nextStatus = opp.status === 'under_review' || opp.status === 'expired' ? 'available' : opp.status;
  if (nextStatus !== opp.status && !canTransition(opp.status, nextStatus) && opp.status !== nextStatus) {
    throw httpError(400, 'Não é possível encaminhar neste status.');
  }
  const feeSnap = {
    feeType: cfg.feeType || 'fixed',
    feePercent: money2(cfg.feePercent),
    feeFixed: money2(cfg.feeFixed),
    feeMin: money2(cfg.feeMin),
    fee,
    goodsPrice,
    capturedAt: now,
  };
  const updated = db.update('opportunities', opp.id, {
    status: nextStatus,
    mode,
    referencePrice,
    goodsPrice,
    intermediationFee: fee,
    feeConfigured: true,
    feeSnapshot: opp.feeSnapshot || feeSnap,
    conditions,
    conditionNote: body.conditionNote !== undefined ? String(body.conditionNote || '').trim().slice(0, 400) : (opp.conditionNote || ''),
    validUntil,
    forwardedAt: opp.forwardedAt || now,
    forwardedBy: admin.id,
    updatedAt: now,
  });
  audit({
    opportunityId: opp.id,
    listingId: opp.listingId,
    actorId: admin.id,
    actorRole: admin.role,
    action: 'forwarded_to_hub',
    payload: { referencePrice, goodsPrice, intermediationFee: fee, mode },
  });
  return serializeOpportunity(updated, { admin: true });
}

function changeStatus(opportunityId, to, admin, extra = {}) {
  expireLance();
  const opp = db.findById('opportunities', opportunityId);
  if (!opp) throw httpError(404, 'Oportunidade não encontrada.');
  if (opp.status === 'disputed' && to !== 'disputed') {
    throw httpError(400, 'Use o registro de resolução da disputa. Não encerre no silêncio.');
  }
  if (to === 'reserved') {
    throw httpError(400, 'Use a reserva temporária com o interessado escolhido. O status sozinho não reserva.');
  }
  if (to === 'negotiating') {
    throw httpError(400, 'Use Passar para em negociação depois da reserva. O status sozinho não negocia.');
  }
  if (to === 'completed') {
    if ((opp.mode || 'intermediation') === 'own_buy' && !['acquisition_completed', 'available_for_resale', 'resold'].includes(opp.ownBuyStatus || '')) {
      throw httpError(400, 'Compra própria só conclui depois da aquisição efetiva.');
    }
    const listing = db.findById('listings', opp.listingId);
    if (!listing || !['published', 'paused', 'sold', 'negotiated'].includes(listing.status)) {
      throw httpError(400, 'Verifique a disponibilidade do anúncio antes de concluir.');
    }
    if (opp.status === 'disputed') {
      throw httpError(400, 'Há uma disputa em aberto. Registre a resolução antes de concluir.');
    }
    const block = completionBlockReason(opp);
    if (block) throw httpError(400, block + ' Justificativa administrativa não substitui o aceite faltante.');
    if (!extra.acceptedConditions) throw httpError(400, 'Registre o aceite das condições para concluir.');
  }
  if (to === 'negotiating') {
    if (!opp.reservedBy && !(extra && extra.dealerId)) {
      throw httpError(400, 'Identifique o catireiro antes de passar para em negociação.');
    }
  }
  const patch = {};
  if (extra.reason) patch.cancelledReason = String(extra.reason).slice(0, 400);
  if (to === 'completed' && (opp.mode || 'intermediation') !== 'own_buy') {
    patch.feeDue = true;
    patch.feeCharged = false;
    patch.completedAt = new Date().toISOString();
    patch.noChargeReason = '';
  }
  if (to === 'cancelled' || to === 'expired') {
    patch.feeDue = false;
    patch.feeCharged = false;
    patch.noChargeReason = to === 'cancelled' ? 'Cancelada antes da conclusão.' : 'Expirada sem conclusão.';
  }
  if (to === 'disputed') {
    const why = String(extra.reason || extra.disputeReason || '').trim();
    if (why.length < 8) throw httpError(400, 'Descreva o motivo da divergência.');
    patch.disputeReason = why.slice(0, 400);
    patch.disputedAt = new Date().toISOString();
    patch.disputedBy = admin && admin.id;
    patch.feeDue = false;
    patch.feeCharged = false;
    patch.noChargeReason = 'Em disputa ainda não resolvida.';
    patch.disputeResolvedAt = null;
    patch.disputeResolution = '';
  }
  if (to === 'available' && opp.status === 'disputed') {
    const resolution = String(extra.resolution || extra.reason || '').trim();
    if (resolution.length < 8) throw httpError(400, 'Registre a resolução da disputa com justificativa.');
    patch.disputeResolvedAt = new Date().toISOString();
    patch.disputeResolution = resolution.slice(0, 800);
    patch.sellerConfirmedAt = null;
    patch.dealerConfirmedAt = null;
    patch.feeDue = false;
    patch.feeCharged = false;
  }
  if (to === 'negotiating' && extra.dealerId) {
    patch.reservedBy = extra.dealerId;
  }
  const updated = setStatus(opp, to, admin, patch);
  return serializeOpportunity(updated, { admin: true });
}

function confirmCompletion(opportunityId, user, party) {
  expireLance();
  const opp = db.findById('opportunities', opportunityId);
  if (!opp) throw httpError(404, 'Oportunidade não encontrada.');
  if (opp.status === 'disputed') throw httpError(400, 'Há uma disputa em aberto. A conclusão automática está suspensa.');
  if (!['reserved', 'negotiating'].includes(opp.status)) {
    throw httpError(400, 'Esta oportunidade ainda não está em fase de confirmação.');
  }
  const listing = db.findById('listings', opp.listingId);
  const now = new Date().toISOString();
  const p = party === 'dealer' ? 'dealer' : 'seller';
  if (p === 'seller') {
    requireSellerActor(listing, user, 'Só o vendedor confirma a própria parte.');
    if (opp.sellerConfirmedAt) {
      return serializeOpportunity(db.findById('opportunities', opp.id), { seller: true, dealerId: user.id });
    }
    db.update('opportunities', opp.id, { sellerConfirmedAt: now, updatedAt: now });
    audit({ opportunityId: opp.id, listingId: opp.listingId, actorId: user.id, actorRole: user.role, action: 'seller_confirmed' });
  } else {
    const interested = db.findOne('opportunityInterests', (i) => i.opportunityId === opp.id && i.dealerId === user.id && i.status === 'interested');
    if (!interested && opp.reservedBy !== user.id) throw httpError(403, 'Só o catireiro envolvido confirma a própria parte.');
    if (opp.dealerConfirmedAt) {
      return serializeOpportunity(db.findById('opportunities', opp.id), { dealerId: user.id });
    }
    db.update('opportunities', opp.id, { dealerConfirmedAt: now, updatedAt: now });
    if (opp.status === 'reserved') {
      try { setStatus(db.findById('opportunities', opp.id), 'negotiating', user, {}); } catch (_) {}
    }
    audit({ opportunityId: opp.id, listingId: opp.listingId, actorId: user.id, actorRole: user.role, action: 'dealer_confirmed' });
  }
  return serializeOpportunity(db.findById('opportunities', opp.id), {
    seller: !!(listing && listing.userId === user.id),
    dealerId: user.id,
  });
}

function openDispute(opportunityId, user, reason) {
  expireLance();
  const opp = db.findById('opportunities', opportunityId);
  if (!opp) throw httpError(404, 'Oportunidade não encontrada.');
  const listing = db.findById('listings', opp.listingId);
  const isSeller = !!(listing && listing.userId === user.id);
  const isDealer = !!db.findOne('opportunityInterests', (i) => i.opportunityId === opp.id && i.dealerId === user.id);
  if (!isSeller && !isDealer && !isAdminRole(user.role)) throw httpError(403, 'Sem permissão.');
  return changeStatus(opportunityId, 'disputed', user, { reason: reason || '' });
}

function resolveDispute(opportunityId, admin, body) {
  expireLance();
  if (!isAdminRole(admin && admin.role)) throw httpError(403, 'Sem permissão.');
  const opp = db.findById('opportunities', opportunityId);
  if (!opp) throw httpError(404, 'Oportunidade não encontrada.');
  if (opp.status !== 'disputed') throw httpError(400, 'Esta oportunidade não está em disputa.');
  const resolution = String((body && (body.resolution || body.reason)) || '').trim();
  if (resolution.length < 8) throw httpError(400, 'Registre a resolução da disputa com justificativa.');
  const next = (body && body.nextStatus) || 'available';
  if (next === 'completed') {
    throw httpError(400, 'Resolver a disputa não conclui a venda. As partes precisam confirmar de novo.');
  }
  if (!['available', 'negotiating', 'cancelled'].includes(next)) {
    throw httpError(400, 'Situação de resolução inválida.');
  }
  const patch = {
    disputeResolvedAt: new Date().toISOString(),
    disputeResolution: resolution.slice(0, 800),
    sellerConfirmedAt: null,
    dealerConfirmedAt: null,
    feeDue: false,
    feeCharged: false,
    noChargeReason: next === 'cancelled' ? 'Disputa resolvida com cancelamento.' : '',
  };
  if (next === 'available') {
    patch.reservedBy = null;
    patch.reservedUntil = null;
  }
  const updated = setStatus(opp, next, admin, patch);
  audit({
    opportunityId: opp.id,
    listingId: opp.listingId,
    actorId: admin.id,
    actorRole: admin.role,
    action: 'dispute_resolved',
    payload: { next, resolution: resolution.slice(0, 200) },
  });
  return serializeOpportunity(updated, { admin: true });
}

function addDisputeNote(opportunityId, user, note) {
  expireLance();
  const opp = db.findById('opportunities', opportunityId);
  if (!opp) throw httpError(404, 'Oportunidade não encontrada.');
  if (opp.status !== 'disputed') throw httpError(400, 'Só há espaço de manifestação com disputa aberta.');
  const listing = db.findById('listings', opp.listingId);
  const isSeller = !!(listing && listing.userId === user.id);
  const isDealer = !!db.findOne('opportunityInterests', (i) => i.opportunityId === opp.id && i.dealerId === user.id);
  if (!isSeller && !isDealer && !isAdminRole(user.role)) throw httpError(403, 'Sem permissão.');
  const text = String(note || '').trim();
  if (text.length < 4) throw httpError(400, 'Escreva a manifestação.');
  audit({
    opportunityId: opp.id,
    listingId: opp.listingId,
    actorId: user.id,
    actorRole: user.role,
    action: 'dispute_note',
    payload: { note: text.slice(0, 800) },
  });
  return serializeOpportunity(db.findById('opportunities', opp.id), {
    admin: isAdminRole(user.role),
    seller: isSeller,
    dealerId: user.id,
  });
}

const OWN_BUY_TRANSITIONS = {
  evaluating: ['offer_sent', 'cancelled'],
  offer_sent: ['offer_accepted', 'cancelled', 'evaluating'],
  offer_accepted: ['awaiting_fulfillment', 'cancelled', 'disputed'],
  awaiting_fulfillment: ['payment_recorded', 'cancelled', 'disputed'],
  payment_recorded: ['acquisition_completed', 'cancelled', 'disputed'],
  acquisition_completed: ['available_for_resale', 'disputed'],
  available_for_resale: ['resold', 'cancelled'],
  resold: [],
  cancelled: [],
  disputed: ['awaiting_fulfillment', 'cancelled'],
};

function putInOwnBox(opportunityId, admin) {
  expireLance();
  if (!isAdminRole(admin && admin.role)) throw httpError(403, 'Sem permissão.');
  if (!getSettings().ownBuyEnabled) throw httpError(403, 'Compra e revenda própria está desativada.');
  const opp = db.findById('opportunities', opportunityId);
  if (!opp) throw httpError(404, 'Oportunidade não encontrada.');
  if (opp.forwardedAt && (opp.mode || 'intermediation') === 'intermediation' && ['available', 'reserved', 'negotiating', 'completed'].includes(opp.status)) {
    throw httpError(400, 'Não desvie uma intermediação já contratada para compra própria.');
  }
  const now = new Date().toISOString();
  const from = opp.mode || 'intermediation';
  const updated = db.update('opportunities', opp.id, {
    inOwnBox: true,
    mode: 'own_buy',
    ownBuyStatus: opp.ownBuyStatus || 'evaluating',
    updatedAt: now,
  });
  if (from !== 'own_buy') {
    audit({
      opportunityId: opp.id,
      listingId: opp.listingId,
      actorId: admin.id,
      actorRole: admin.role,
      action: 'modality_changed',
      payload: { from, to: 'own_buy' },
    });
  }
  audit({
    opportunityId: opp.id,
    listingId: opp.listingId,
    actorId: admin.id,
    actorRole: admin.role,
    action: 'own_box_added',
    payload: { ownBuyStatus: updated.ownBuyStatus },
  });
  return serializeOpportunity(updated, { admin: true });
}

function updateOwnBuy(opportunityId, body, admin) {
  expireLance();
  if (!(admin && admin.role === 'master')) throw httpError(403, 'Só o admin master opera compra própria.');
  if (!getSettings().ownBuyEnabled) throw httpError(403, 'Compra e revenda própria está desativada.');
  const opp = db.findById('opportunities', opportunityId);
  if (!opp) throw httpError(404, 'Oportunidade não encontrada.');
  if (!opp.inOwnBox) throw httpError(400, 'Coloque a oportunidade na caixa própria primeiro.');
  const to = body.ownBuyStatus;
  const patch = { updatedAt: new Date().toISOString() };
  if (to) {
    if (!OWN_BUY_STATUSES.includes(to)) throw httpError(400, 'Situação de compra própria inválida.');
    const from = opp.ownBuyStatus || 'evaluating';
    if (from !== to && !(OWN_BUY_TRANSITIONS[from] || []).includes(to)) {
      throw httpError(400, 'Não é possível mudar a compra própria de ' + (OWN_BUY_LABEL[from] || from) + ' para ' + (OWN_BUY_LABEL[to] || to) + '.');
    }
    if ((to === 'available_for_resale' || to === 'resold') && from !== 'acquisition_completed' && from !== 'available_for_resale') {
      throw httpError(400, 'Só revende depois da aquisição efetiva.');
    }
    patch.ownBuyStatus = to;
  }
  if (body.acquisitionPrice !== undefined) patch.acquisitionPrice = parseMoney(body.acquisitionPrice, 'o preço de aquisição');
  if (body.costs !== undefined) patch.costs = parseMoney(body.costs, 'os custos');
  if (body.resalePrice !== undefined) patch.resalePrice = parseMoney(body.resalePrice, 'o preço de revenda');
  if (body.acquisitionProof !== undefined) patch.acquisitionProof = String(body.acquisitionProof || '').slice(0, 500);
  if (body.paymentStatus !== undefined) patch.paymentStatus = String(body.paymentStatus || '').slice(0, 40);
  if (body.possessionStatus !== undefined) patch.possessionStatus = String(body.possessionStatus || '').slice(0, 40);
  if (body.fiscalDocs !== undefined) patch.fiscalDocs = String(body.fiscalDocs || '').slice(0, 500);
  const nextStatus = patch.ownBuyStatus || opp.ownBuyStatus;
  if (patch.resalePrice !== undefined || nextStatus === 'available_for_resale' || nextStatus === 'resold') {
    const acq = patch.acquisitionPrice !== undefined ? patch.acquisitionPrice : money2(opp.acquisitionPrice);
    const costs = patch.costs !== undefined ? patch.costs : money2(opp.costs);
    const resale = patch.resalePrice !== undefined ? patch.resalePrice : money2(opp.resalePrice);
    if (resale) patch.estimatedMargin = money2(resale - acq - costs);
  }
  const wantPublic = body.resalePublic !== undefined ? flagOn(body.resalePublic) : !!opp.resalePublic;
  if (wantPublic && nextStatus !== 'available_for_resale' && nextStatus !== 'resold') {
    throw httpError(400, 'Não apresente estoque de terceiro como produto próprio.');
  }
  patch.resalePublic = wantPublic && (nextStatus === 'available_for_resale' || nextStatus === 'resold');
  const updated = db.update('opportunities', opp.id, patch);
  audit({
    opportunityId: opp.id,
    listingId: opp.listingId,
    actorId: admin.id,
    actorRole: admin.role,
    action: 'own_buy_updated',
    payload: { ownBuyStatus: updated.ownBuyStatus, resalePublic: !!updated.resalePublic },
  });
  return serializeOpportunity(updated, { admin: true });
}

function ownBoxList(admin) {
  if (!isAdminRole(admin && admin.role)) throw httpError(403, 'Sem permissão.');
  expireLance();
  return db
    .findWhere('opportunities', (o) => !!o.inOwnBox)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
    .map((o) => serializeOpportunity(o, { admin: true }));
}

function publicOwnResale() {
  expireLance();
  if (!getSettings().ownBuyEnabled) return [];
  return db
    .findWhere('opportunities', (o) => !!o.resalePublic && o.ownBuyStatus === 'available_for_resale')
    .map((o) => {
      const s = serializeOpportunity(o, {});
      return {
        id: o.id,
        title: (s.listing && s.listing.title) || 'Oportunidade Catira',
        description: (s.listing && s.listing.description) || '',
        images: (s.listing && s.listing.images) || [],
        condition: (s.listing && s.listing.condition) || '',
        city: o.city,
        resalePrice: o.resalePrice,
        sellerLabel: 'Catira — Oportunidades Próprias',
        ownedByCatira: true,
      };
    });
}

function reserveOpportunity(opportunityId, dealerId, admin, hours) {
  expireLance();
  const opp = db.findById('opportunities', opportunityId);
  if (!opp) throw httpError(404, 'Oportunidade não encontrada.');
  if (!['available', 'under_review', 'reserved'].includes(opp.status)) {
    throw httpError(400, 'Esta oportunidade não pode ser reservada agora.');
  }
  if (opp.status === 'reserved' && opp.reservedBy && opp.reservedBy !== dealerId) {
    throw httpError(409, 'Já existe uma reserva ativa nesta oportunidade.');
  }
  const listing = db.findById('listings', opp.listingId);
  if (!listing || !['published', 'paused', 'awaiting_review'].includes(listing.status)) {
    throw httpError(400, 'O anúncio não está disponível para reserva.');
  }
  const dealer = db.findById('users', dealerId);
  if (!dealer) throw httpError(400, 'Selecione um interessado válido.');
  const interest = db.findOne('opportunityInterests', (i) => i.opportunityId === opp.id && i.dealerId === dealerId && (i.status === 'interested' || i.status === 'selected'));
  if (!interest) throw httpError(400, 'Só reserva para quem já manifestou interesse.');
  const hold = parseInt(hours == null ? getSettings().defaultHoldHours : hours, 10);
  if (!Number.isFinite(hold) || hold < 1 || hold > 168) throw httpError(400, 'Informe a reserva em horas (1 a 168).');
  const reservedUntil = new Date(Date.now() + hold * 3600000).toISOString();
  db.update('opportunityInterests', interest.id, { status: 'selected' });
  const updated = setStatus(opp, 'reserved', admin, {
    reservedBy: dealerId,
    reservedUntil,
    reservedByAdmin: admin && admin.id,
    sellerConfirmedAt: null,
    dealerConfirmedAt: null,
  });
  audit({
    opportunityId: opp.id,
    listingId: opp.listingId,
    actorId: admin && admin.id,
    actorRole: admin && admin.role,
    action: 'reserved',
    payload: { dealerId, reservedUntil, hours: hold },
  });
  return serializeOpportunity(updated, { admin: true });
}

function startNegotiation(opportunityId, admin, extra) {
  expireLance();
  const opp = db.findById('opportunities', opportunityId);
  if (!opp) throw httpError(404, 'Oportunidade não encontrada.');
  if (opp.status !== 'reserved') throw httpError(400, 'Reserve para um interessado antes de passar para em negociação.');
  const dealerId = (extra && extra.dealerId) || opp.reservedBy;
  if (!dealerId) throw httpError(400, 'Identifique o catireiro antes de negociar.');
  const note = extra && extra.conditions ? String(extra.conditions).trim().slice(0, 2000) : '';
  const patch = { reservedBy: dealerId };
  if (note) patch.conditions = note;
  const updated = setStatus(opp, 'negotiating', admin, patch);
  audit({
    opportunityId: opp.id,
    listingId: opp.listingId,
    actorId: admin && admin.id,
    actorRole: admin && admin.role,
    action: 'negotiation_started',
    payload: { dealerId },
  });
  return serializeOpportunity(updated, { admin: true });
}

function expressInterest(opportunityId, dealer, note) {
  expireLance();
  if (!isActiveDealer(dealer)) throw httpError(403, 'Acesso restrito a catireiros credenciados.');
  const opp = db.findById('opportunities', opportunityId);
  if (!opp) throw httpError(404, 'Oportunidade não encontrada.');
  if (!opp.forwardedAt) throw httpError(404, 'Oportunidade não encontrada.');
  if (!['available', 'reserved', 'negotiating'].includes(opp.status)) {
    throw httpError(400, 'Esta oportunidade não está recebendo interesse.');
  }
  if (opp.status === 'reserved' && opp.reservedBy && opp.reservedBy !== dealer.id) {
    throw httpError(409, 'Esta oportunidade está reservada para outro catireiro.');
  }
  const existing = db.findOne(
    'opportunityInterests',
    (i) => i.opportunityId === opp.id && i.dealerId === dealer.id && i.status === 'interested'
  );
  if (existing) {
    return { interest: serializeInterest(existing), already: true, sale: false, charged: false };
  }
  const row = db.insert('opportunityInterests', {
    opportunityId: opp.id,
    dealerId: dealer.id,
    status: 'interested',
    note: String(note || '').trim().slice(0, 500),
    createdAt: new Date().toISOString(),
  });
  audit({
    opportunityId: opp.id,
    listingId: opp.listingId,
    actorId: dealer.id,
    actorRole: 'dealer',
    action: 'interest',
    payload: { interestId: row.id },
  });
  return { interest: serializeInterest(row), already: false, sale: false, charged: false };
}

function withdrawInterest(opportunityId, dealer) {
  expireLance();
  if (!isActiveDealer(dealer)) throw httpError(403, 'Acesso restrito a catireiros credenciados.');
  const opp = db.findById('opportunities', opportunityId);
  if (!opp) throw httpError(404, 'Oportunidade não encontrada.');
  const existing = db.findOne(
    'opportunityInterests',
    (i) => i.opportunityId === opp.id && i.dealerId === dealer.id && i.status === 'interested'
  );
  if (!existing) throw httpError(400, 'Você não tem interesse ativo nesta oportunidade.');
  if (opp.status === 'reserved' && opp.reservedBy === dealer.id) {
    throw httpError(400, 'Há uma reserva ativa. Peça o cancelamento da reserva para retirar o interesse.');
  }
  if (opp.status === 'negotiating' && opp.reservedBy === dealer.id) {
    throw httpError(400, 'A negociação já começou. Use disputa ou cancele com o administrador.');
  }
  if (opp.status === 'completed') throw httpError(400, 'A operação já foi concluída.');
  const updated = db.update('opportunityInterests', existing.id, {
    status: 'withdrawn',
    withdrawnAt: new Date().toISOString(),
  });
  audit({
    opportunityId: opp.id,
    listingId: opp.listingId,
    actorId: dealer.id,
    actorRole: 'dealer',
    action: 'interest_withdrawn',
    payload: { interestId: existing.id },
  });
  return { interest: serializeInterest(updated), sale: false, charged: false };
}

function applyDealer(user, body) {
  const existing = dealerProfileOf(user.id);
  if (existing && existing.status === 'active') throw httpError(400, 'Você já é um catireiro credenciado.');
  const pending = db.findOne('dealerApplications', (a) => a.userId === user.id && a.status === 'pending');
  if (pending) throw httpError(400, 'Sua solicitação já está em análise.');
  if (!flagOn(body.termsAccepted)) throw httpError(400, 'Aceite os termos do catireiro para continuar.');
  const name = String(body.name || user.name || '').trim().slice(0, 80);
  const city = String(body.city || user.city || '').trim().slice(0, 60);
  const phone = String(body.phone || user.phone || '').replace(/\D/g, '').slice(0, 15);
  if (!name || !city || phone.length < 10) throw httpError(400, 'Informe nome, cidade e telefone.');
  const categories = Array.isArray(body.categories) ? body.categories.map(String).slice(0, 20) : [];
  const regions = Array.isArray(body.regions) ? body.regions.map(String).slice(0, 20) : [];
  const app = db.insert('dealerApplications', {
    userId: user.id,
    name,
    city,
    cityId: body.cityId || user.cityId || '',
    phone,
    categories,
    regions,
    termsAcceptedAt: new Date().toISOString(),
    termsVersion: getSettings().termsVersion || '1',
    status: 'pending',
    createdAt: new Date().toISOString(),
    reviewedAt: null,
    reviewedBy: null,
    note: '',
  });
  audit({ actorId: user.id, actorRole: 'user', action: 'dealer_applied', payload: { applicationId: app.id } });
  return app;
}

function reviewDealer(applicationId, action, admin, note) {
  const app = db.findById('dealerApplications', applicationId);
  if (!app) throw httpError(404, 'Solicitação não encontrada.');
  if (app.status !== 'pending') throw httpError(400, 'Esta solicitação já foi analisada.');
  if (action !== 'approve' && action !== 'reject') throw httpError(400, 'Ação inválida.');
  const now = new Date().toISOString();
  db.update('dealerApplications', app.id, {
    status: action === 'approve' ? 'approved' : 'rejected',
    reviewedAt: now,
    reviewedBy: admin.id,
    note: String(note || '').slice(0, 400),
  });
  let profile = dealerProfileOf(app.userId);
  if (action === 'approve') {
    const founders = db.count('dealerProfiles', (p) => p.founder);
    const founder = founders < getSettings().founderLimit;
    if (profile) {
      profile = db.update('dealerProfiles', profile.id, {
        status: 'active',
        applicationId: app.id,
        founder: profile.founder || founder,
        founderAt: profile.founderAt || (founder ? now : null),
        categories: app.categories || [],
        regions: app.regions || [],
        city: app.city,
        cityId: app.cityId,
        phone: app.phone,
        approvedAt: now,
        approvedBy: admin.id,
      });
    } else {
      profile = db.insert('dealerProfiles', {
        userId: app.userId,
        applicationId: app.id,
        status: 'active',
        founder,
        founderAt: founder ? now : null,
        categories: app.categories || [],
        regions: app.regions || [],
        city: app.city,
        cityId: app.cityId,
        phone: app.phone,
        approvedAt: now,
        approvedBy: admin.id,
        benefitUntil: null,
        couponCode: '',
      });
    }
  }
  audit({
    actorId: admin.id,
    actorRole: admin.role,
    action: action === 'approve' ? 'dealer_approved' : 'dealer_rejected',
    payload: { applicationId: app.id, userId: app.userId, founder: !!(profile && profile.founder) },
  });
  return { application: db.findById('dealerApplications', app.id), profile };
}

function grantDealerBenefit(profileId, body, admin) {
  const profile = db.findById('dealerProfiles', profileId);
  if (!profile) throw httpError(404, 'Catireiro não encontrado.');
  const days = parseInt(body.days == null ? getSettings().founderFreeDays : body.days, 10);
  if (!Number.isFinite(days) || days < 1 || days > 365) throw httpError(400, 'Informe os dias do benefício (1 a 365).');
  const now = Date.now();
  const start = now;
  const benefitUntil = new Date(start + days * 86400000).toISOString();
  const couponCode = String(body.couponCode || '').trim().slice(0, 40);
  const updated = db.update('dealerProfiles', profile.id, {
    benefitUntil,
    couponCode,
    benefitStartedAt: new Date(start).toISOString(),
    benefitDays: days,
    benefitNote: String(body.note || '').slice(0, 400),
  });
  audit({
    actorId: admin.id,
    actorRole: admin.role,
    action: 'dealer_benefit_granted',
    payload: { profileId: profile.id, userId: profile.userId, days, benefitUntil, couponCode },
  });
  return updated;
}

function hubList(query, dealer) {
  expireLance();
  let list = db.findWhere('opportunities', (o) => !!o.forwardedAt && !o.inOwnBox && (o.mode || 'intermediation') !== 'own_buy' && ['available', 'reserved', 'negotiating'].includes(o.status));
  if (query.city) {
    const city = String(query.city).toLowerCase();
    list = list.filter((o) => (o.cityId && o.cityId === query.city) || (o.city && o.city.toLowerCase().includes(city)));
  }
  if (query.category) {
    list = list.filter((o) => o.categoryId === query.category);
  }
  if (query.status && OPP_STATUSES.includes(query.status)) {
    list = list.filter((o) => o.status === query.status);
  }
  list.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  return list.map((o) => serializeOpportunity(o, { dealerId: dealer && dealer.id }));
}

function adminQueue(query) {
  expireLance();
  const listings = db.findWhere('listings', (l) => !!l.quickOfferEnabled && (l.listingType || 'venda') !== 'procuro');
  const items = listings.map((l) => {
    const opp = opportunityOfListing(l.id) || ensureOpportunityForListing(l, null);
    return {
      listing: {
        id: l.id,
        title: l.title,
        price: l.price,
        city: l.city,
        status: l.status,
        condition: l.condition,
        createdAt: l.createdAt,
        waitForEvaluation: !!l.waitForEvaluation,
        images: imagesOf(l.id).slice(0, 1),
      },
      opportunity: serializeOpportunity(opp, { admin: true }),
    };
  });
  items.sort((a, b) => new Date(b.listing.createdAt) - new Date(a.listing.createdAt));
  const status = query && query.status;
  return status ? items.filter((i) => i.opportunity && i.opportunity.status === status) : items;
}

function metrics() {
  expireLance();
  const opps = db.all('opportunities') || [];
  const offers = db.all('opportunityOffers') || [];
  const interests = db.all('opportunityInterests') || [];
  const apps = db.all('dealerApplications') || [];
  const dealers = db.all('dealerProfiles') || [];
  const byStatus = {};
  OPP_STATUSES.forEach((s) => { byStatus[s] = opps.filter((o) => o.status === s).length; });
  const accepted = offers.filter((o) => o.status === 'accepted').length;
  const sent = offers.length;
  return {
    opportunities: opps.length,
    byStatus,
    offersSent: sent,
    offersAccepted: accepted,
    offerConversion: sent ? Math.round((accepted / sent) * 100) : 0,
    interests: interests.filter((i) => i.status === 'interested').length,
    completed: opps.filter((o) => o.status === 'completed').length,
    cancelled: opps.filter((o) => o.status === 'cancelled').length,
    dealersActive: dealers.filter((d) => d.status === 'active').length,
    dealersFounder: dealers.filter((d) => d.founder).length,
    applicationsPending: apps.filter((a) => a.status === 'pending').length,
    intermediationFeeSum: opps
      .filter((o) => o.status === 'completed' && o.mode !== 'own_buy')
      .reduce((s, o) => s + money2(o.intermediationFee), 0),
    intermediation: {
      forwarded: opps.filter((o) => o.forwardedAt && o.mode !== 'own_buy').length,
      interests: interests.filter((i) => i.status === 'interested').length,
      negotiating: opps.filter((o) => o.status === 'negotiating' && o.mode !== 'own_buy').length,
      completed: opps.filter((o) => o.status === 'completed' && o.mode !== 'own_buy').length,
      cancelled: opps.filter((o) => o.status === 'cancelled' && o.mode !== 'own_buy').length,
      disputed: opps.filter((o) => o.status === 'disputed' && o.mode !== 'own_buy').length,
      feesDue: opps.filter((o) => o.feeDue && o.mode !== 'own_buy').reduce((s, o) => s + money2(o.intermediationFee), 0),
      feesCharged: opps.filter((o) => o.feeCharged && o.mode !== 'own_buy').reduce((s, o) => s + money2(o.intermediationFee), 0),
    },
    ownBuy: {
      inBox: opps.filter((o) => o.inOwnBox).length,
      offersSent: offers.filter((o) => {
        const opp = opps.find((x) => x.id === o.opportunityId);
        return opp && opp.mode === 'own_buy';
      }).length,
      acquired: opps.filter((o) => o.ownBuyStatus === 'acquisition_completed' || o.ownBuyStatus === 'available_for_resale' || o.ownBuyStatus === 'resold').length,
      availableForResale: opps.filter((o) => o.ownBuyStatus === 'available_for_resale').length,
      resold: opps.filter((o) => o.ownBuyStatus === 'resold').length,
      acquisitionCost: opps.filter((o) => o.inOwnBox).reduce((s, o) => s + money2(o.acquisitionPrice) + money2(o.costs), 0),
      resaleRevenue: opps.filter((o) => o.ownBuyStatus === 'resold').reduce((s, o) => s + money2(o.resalePrice), 0),
      estimatedMargin: opps.filter((o) => o.inOwnBox).reduce((s, o) => s + money2(o.estimatedMargin), 0),
    },
    ownBuyEnabled: !!getSettings().ownBuyEnabled,
    intermediationEnabled: getSettings().intermediationEnabled !== false,
  };
}

function parseQuickOfferFlags(body) {
  return {
    quickOfferEnabled: flagOn(body && body.quickOfferEnabled),
    waitForEvaluation: flagOn(body && body.waitForEvaluation),
  };
}

module.exports = {
  SETTINGS_ID,
  OPP_STATUSES,
  OFFER_STATUSES,
  DEALER_APP_STATUSES,
  INTEREST_STATUSES,
  STATUS_LABEL,
  OWN_BUY_STATUSES,
  OWN_BUY_LABEL,
  DEFAULTS,
  getSettings,
  saveSettings,
  ensureSettings,
  canTransition,
  dealerProfileOf,
  dealerApplicationOf,
  isActiveDealer,
  dealerPublic,
  expireLance,
  expireOffers,
  expireReservations,
  onListingCreated,
  ensureOpportunityForListing,
  opportunityOfListing,
  serializeOpportunity,
  serializeOffer,
  sendOffer,
  respondOffer,
  sellerConsent,
  requestConsent,
  isConsentValid,
  disclosureSummary,
  forwardToHub,
  changeStatus,
  confirmCompletion,
  openDispute,
  resolveDispute,
  addDisputeNote,
  putInOwnBox,
  updateOwnBuy,
  ownBoxList,
  publicOwnResale,
  computeFee,
  feeBreakdown,
  reserveOpportunity,
  startNegotiation,
  expressInterest,
  withdrawInterest,
  applyDealer,
  reviewDealer,
  grantDealerBenefit,
  hubList,
  adminQueue,
  metrics,
  parseQuickOfferFlags,
  audit,
};
