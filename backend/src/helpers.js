const db = require('./db');
const { safeUser, isAdminRole } = require('./middleware');

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'há 1 dia';
  if (d < 30) return `há ${d} dias`;
  const m = Math.floor(d / 30);
  if (m === 1) return 'há 1 mês';
  return `há ${m} meses`;
}

function imagesOf(listingId) {
  return db
    .findWhere('listingImages', (i) => i.listingId === listingId)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

function categoryOf(id) {
  return db.findById('categories', id);
}

function listingRating(listingId, userId) {
  const rows = db.findWhere('listingReviews', (r) => r.listingId === listingId);
  const count = rows.length;
  const avg = count
    ? Math.round((rows.reduce((s, r) => s + Number(r.rating || 0), 0) / count) * 10) / 10
    : 0;
  const mine = userId ? rows.find((r) => r.userId === userId) : null;
  return { ratingAvg: avg, ratingCount: count, myRating: mine ? mine.rating : 0, myComment: mine ? mine.comment || '' : '' };
}

function isVipUser() {
  return false;
}

function canAccessVipContact() {
  return true;
}

const LISTING_TYPES = ['venda', 'troca', 'venda_troca', 'procuro'];

function listingTypeOf(l) {
  if (l && LISTING_TYPES.includes(l.listingType)) return l.listingType;
  if (l && l.acceptsTrade) return 'venda_troca';
  return 'venda';
}

function listingTypeLabel(type) {
  return {
    venda: 'Venda',
    troca: 'Troca',
    venda_troca: 'Venda ou troca',
    procuro: 'Procuro',
  }[type] || 'Venda';
}

function listingSocialOf(listingId, viewerId) {
  const likes = db.findWhere('listingLikes', (x) => x.listingId === listingId);
  const comments = db.findWhere('listingComments', (c) => c.listingId === listingId);
  return {
    likeCount: likes.length,
    commentCount: comments.length,
    liked: viewerId ? likes.some((x) => x.userId === viewerId) : false,
  };
}

function serializeListing(l, opts = {}) {
  const official = require('./official');
  const meta = official.officialMetaOf(l);
  const isOfficial = !!meta;
  const user = db.findById('users', l.userId);
  const cat = categoryOf(l.categoryId);
  const images = imagesOf(l.id);
  const rating = isOfficial
    ? { ratingAvg: 0, ratingCount: 0, myRating: 0, myComment: '' }
    : listingRating(l.id, opts.userId);
  const social = isOfficial
    ? { likeCount: 0, commentCount: 0, liked: false }
    : listingSocialOf(l.id, opts.userId);
  const viewer = opts.user || (opts.userId ? db.findById('users', opts.userId) : null);
  const vip = isOfficial ? false : !!l.vip;
  const listingType = listingTypeOf(l);
  const acceptsTrade = listingType === 'troca' || listingType === 'venda_troca' || !!l.acceptsTrade;
  const base = {
    id: l.id,
    userId: l.userId,
    title: l.title,
    description: l.description,
    categoryId: l.categoryId,
    category: cat ? { id: cat.id, name: cat.name, slug: cat.slug, icon: cat.icon } : null,
    subcategory: l.subcategory || '',
    price: l.price,
    condition: l.condition,
    city: l.city,
    cityId: l.cityId,
    listingType,
    listingTypeLabel: listingTypeLabel(listingType),
    acceptsTrade,
    acceptsCash: !!l.acceptsCash,
    tradeWishes: l.tradeWishes || '',
    status: l.status,
    paymentStatus: (viewer && (viewer.id === l.userId || isAdminRole(viewer.role))) ? ((listingPayment(l.id) || {}).status || '') : '',
    paymentDeclaredAt: (viewer && (viewer.id === l.userId || isAdminRole(viewer.role))) ? ((listingPayment(l.id) || {}).userDeclaredAt || null) : null,
    plan: listingPlan(l),
    adminNote: (viewer && (viewer.id === l.userId || isAdminRole(viewer.role))) ? (l.adminNote || '') : '',
    previousStatus: (viewer && (viewer.id === l.userId || isAdminRole(viewer.role))) ? (l.previousStatus || '') : '',
    featured: isOfficial ? false : (!!(l.featured && (!l.featuredUntil || new Date(l.featuredUntil).getTime() > Date.now())) || vip || isPremiumLive(l)),
    featuredUntil: isOfficial ? null : (l.featuredUntil || null),
    premium: isOfficial ? false : isPremiumLive(l),
    premiumDays: !isOfficial && Array.isArray(l.premiumDays) ? l.premiumDays : [],
    premiumUntil: isOfficial ? null : (l.premiumUntil || null),
    vip,
    quickOfferEnabled: isOfficial ? false : ((viewer && (viewer.id === l.userId || isAdminRole(viewer.role))) ? !!l.quickOfferEnabled : undefined),
    waitForEvaluation: isOfficial ? false : ((viewer && (viewer.id === l.userId || isAdminRole(viewer.role))) ? !!l.waitForEvaluation : undefined),
    contactLocked: isOfficial,
    views: l.views || 0,
    favoritesCount: db.count('favorites', (f) => f.listingId === l.id),
    likeCount: social.likeCount,
    commentCount: social.commentCount,
    liked: social.liked,
    createdAt: l.createdAt,
    publishedAt: l.publishedAt,
    expiresAt: isOfficial ? null : l.expiresAt,
    timeAgo: timeAgo(l.publishedAt || l.createdAt),
    images,
    seller: isOfficial ? null : safeUser(user),
    origin: isOfficial ? 'official' : 'user',
    isOfficial,
    official: meta,
    officialProductId: meta ? meta.officialProductId : null,
    sellerLabel: meta ? meta.sellerLabel : null,
    socialEnabled: isOfficial ? false : true,
    delivery: meta ? meta.delivery : null,
    officialOffers: meta ? meta.officialOffers : [],
    ratingAvg: rating.ratingAvg,
    ratingCount: rating.ratingCount,
    myRating: rating.myRating,
    myComment: rating.myComment,
  };
  if (opts.favorited !== undefined) base.favorited = opts.favorited;
  return base;
}

function isFavorited(userId, listingId) {
  if (!userId) return false;
  return !!db.findOne('favorites', (f) => f.userId === userId && f.listingId === listingId);
}

function conversationKey(a, b, listingId) {
  const [x, y] = [a, b].sort();
  return `${x}:${y}:${listingId}`;
}

function recalcRating(userId) {
  const reviews = db.findWhere('reviews', (r) => r.reviewedUserId === userId);
  if (!reviews.length) {
    db.update('users', userId, { ratingAvg: 0, ratingCount: 0 });
    return;
  }
  const avg = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
  db.update('users', userId, {
    ratingAvg: Math.round(avg * 10) / 10,
    ratingCount: reviews.length,
  });
}

function normalizePromoCode(raw) {
  return String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
}

function findPromo(code) {
  const key = normalizePromoCode(code);
  if (!key) return null;
  return db.findOne('promoCodes', (p) => normalizePromoCode(p.code) === key);
}

function promoUsable(promo) {
  if (!promo || promo.active === false) return 'Código promocional inválido.';
  const max = Number(promo.maxUses || 0);
  if (max > 0 && Number(promo.usedCount || 0) >= max) return 'Este código já atingiu o limite de usos.';
  const pct = Number(promo.discountPercent);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return 'Código promocional inválido.';
  return null;
}

function pixPayload(listingId, amount) {
  const { buildPix } = require('./pix');
  const txid = ('CATIRA' + String(listingId).replace(/-/g, '')).slice(0, 25);
  return buildPix({ amount, txid, description: 'Anuncio CATIRA' });
}

const { LISTING_DAYS } = require('./seed');

function isPremiumLive(l) {
  if (!l || !l.premium) return false;
  if (l.premiumUntil && new Date(l.premiumUntil).getTime() < Date.now()) return false;
  const days = Array.isArray(l.premiumDays) ? l.premiumDays : [];
  if (!days.length) return !!l.premiumUntil;
  const { brazilToday } = require('./pix');
  const today = brazilToday();
  return days.some((d) => String(d).slice(0, 10) >= today);
}

function listingPlan(l) {
  if (!l) return 'comum';
  if (l.premium) return 'premium';
  if (l.vip || l.featured) return 'destaque';
  return 'comum';
}

function listingPayment(listingId) {
  const rows = db.findWhere('payments', (p) => p && p.listingId === listingId);
  if (!rows.length) return null;
  const open = rows
    .filter((p) => p.status !== 'paid' && p.status !== 'rejected' && p.status !== 'expired')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (open[0]) return open[0];
  return rows.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
}

function todaysPremiumListing() {
  const { brazilToday } = require('./pix');
  const today = brazilToday();
  const list = db.findWhere('listings', (l) => (
    l
    && l.status === 'published'
    && l.premium
    && Array.isArray(l.premiumDays)
    && l.premiumDays.some((d) => String(d).slice(0, 10) === today)
  ));
  list.sort((a, b) => new Date(b.publishedAt || b.createdAt) - new Date(a.publishedAt || a.createdAt));
  return list[0] || null;
}

function publicPremiumBanner() {
  const l = todaysPremiumListing();
  if (!l) return null;
  const images = imagesOf(l.id);
  const imageUrl = (images[0] && images[0].url) || '';
  if (!imageUrl) return null;
  return {
    listingId: l.id,
    title: l.title || '',
    imageUrl,
    link: '/anuncio/' + l.id,
  };
}

const PAY_CONFIRM_MS = 60 * 60 * 1000;

function expireStalePayments() {
  const now = Date.now();
  db.findWhere('payments', (p) => p && p.status === 'awaiting_confirmation' && p.userDeclaredAt).forEach((p) => {
    const t = new Date(p.userDeclaredAt).getTime();
    if (!Number.isFinite(t) || now - t < PAY_CONFIRM_MS) return;
    db.update('payments', p.id, { status: 'expired' });
    if (p.listingId) {
      const l = db.findById('listings', p.listingId);
      if (l && (l.status === 'awaiting_confirmation' || l.status === 'awaiting_payment')) {
        db.update('listings', l.id, { status: 'payment_expired' });
      }
    }
  });
}

function confirmPaymentRecord(payment, listing, opts = {}) {
  const now = new Date().toISOString();
  db.update('payments', payment.id, { status: 'paid', paidAt: now, method: payment.method || 'pix' });
  if (payment.kind === 'vip_access') {
    const { vipDays } = require('./pix');
    const u = db.findById('users', payment.userId);
    const days = Number(payment.vipDays) || vipDays();
    const currentEnd = u && u.vipUntil && new Date(u.vipUntil).getTime() > Date.now()
      ? new Date(u.vipUntil).getTime()
      : Date.now();
    const vipUntil = new Date(currentEnd + days * 86400000).toISOString();
    db.update('users', payment.userId, { vipUntil });
    return { vipUntil, days };
  }
  if (!listing) listing = db.findById('listings', payment.listingId);
  if (!listing) return null;
  const live = listing.status === 'published' || listing.status === 'paused';
  const publish = live ? false : opts.publish !== false;
  const patch = { paidAt: now };
  if (live) {
    patch.status = listing.status;
  } else if (publish && listing.quickOfferEnabled && listing.waitForEvaluation) {
    patch.status = 'awaiting_review';
    patch.adminNote = listing.adminNote || '';
    patch.previousStatus = listing.previousStatus || '';
  } else if (publish) {
    patch.status = 'published';
    patch.publishedAt = listing.publishedAt || now;
    patch.expiresAt = listing.expiresAt || new Date(Date.now() + LISTING_DAYS * 86400000).toISOString();
  } else {
    patch.status = 'awaiting_review';
    patch.adminNote = '';
    patch.previousStatus = listing.status === 'changes_requested' ? (listing.previousStatus || '') : '';
  }
  if (payment.kind === 'vip_listing' || listing.vip) {
    patch.vip = true;
    patch.featured = true;
  }
  if (payment.kind === 'premium_listing' || listing.premium) {
    const { premiumUntilIso } = require('./pix');
    const fromPay = Array.isArray(payment.premiumDays) ? payment.premiumDays : ((payment.premiumQuote && payment.premiumQuote.days) || []);
    const days = (fromPay.length ? fromPay : (Array.isArray(listing.premiumDays) ? listing.premiumDays : [])).slice().sort();
    patch.premium = true;
    patch.featured = true;
    patch.premiumDays = days;
    patch.premiumUntil = premiumUntilIso(days[days.length - 1]) || listing.premiumUntil;
    patch.featuredUntil = patch.premiumUntil;
  }
  const updated = db.update('listings', listing.id, patch);
  if (publish) notifyAlerts(updated);
  return updated;
}

function notifyAlerts(listing) {
  if (!listing || listing.status !== 'published') return;
  if (require('./official').isOfficialListing(listing)) return;
  const alerts = db.all('alerts') || [];
  const hay = [listing.title, listing.description, listing.subcategory].filter(Boolean).join(' ').toLowerCase();
  alerts.forEach((a) => {
    if (!a || a.userId === listing.userId) return;
    const q = String(a.query || '').trim().toLowerCase();
    if (q && !hay.includes(q)) return;
    if (a.categoryId && a.categoryId !== listing.categoryId) return;
    const hits = Array.isArray(a.hits) ? a.hits.slice() : [];
    if (hits.some((h) => h.listingId === listing.id)) return;
    hits.unshift({
      listingId: listing.id,
      title: listing.title,
      price: listing.price,
      createdAt: new Date().toISOString(),
      read: false,
    });
    db.update('alerts', a.id, { hits: hits.slice(0, 20), lastHitAt: new Date().toISOString() });
  });
}

function sellerScore(user) {
  if (!user) return { score: 0, published: 0, sold: 0, deals: 0, views: 0, favorites: 0 };
  if (user.role === 'platform') return { score: 0, published: 0, sold: 0, deals: 0, views: 0, favorites: 0 };
  const listings = db.findWhere('listings', (l) => l.userId === user.id);
  const published = listings.filter((l) => l.status === 'published').length;
  const sold = listings.filter((l) => l.status === 'sold' || l.status === 'traded' || l.status === 'negotiated').length;
  const deals = sold;
  const views = listings.reduce((s, l) => s + (l.views || 0), 0);
  const favorites = listings.reduce(
    (s, l) => s + db.count('favorites', (f) => f.listingId === l.id),
    0
  );
  const ratingPts = (Number(user.ratingAvg) || 0) * (Number(user.ratingCount) || 0);
  const listingRatePts = listings.reduce((s, l) => {
    const r = listingRating(l.id);
    return s + r.ratingAvg * r.ratingCount;
  }, 0);
  const score =
    published * 10 +
    sold * 20 +
    Math.round(views * 0.1) +
    Math.round(ratingPts * 8) +
    Math.round(listingRatePts * 4) +
    favorites * 2;
  return { score, published, sold, deals, views, favorites, listingsCount: listings.length };
}

function rankedSellers() {
  return db
    .findWhere('users', (u) => u.status !== 'blocked' && u.role !== 'platform' && !u.systemAccount)
    .map((u) => {
      const stats = sellerScore(u);
      return {
        id: u.id,
        name: u.name,
        city: u.city,
        avatarColor: u.avatarColor || '#E85D04',
        ratingAvg: u.ratingAvg || 0,
        ratingCount: u.ratingCount || 0,
        ...stats,
      };
    })
    .filter((u) => u.published + u.sold > 0)
    .sort((a, b) => b.score - a.score || b.published - a.published)
    .map((u, i) => ({ ...u, rank: i + 1 }));
}

function rankOf(userId) {
  const found = rankedSellers().find((u) => u.id === userId);
  return found ? found.rank : null;
}

module.exports = {
  timeAgo,
  imagesOf,
  serializeListing,
  isFavorited,
  conversationKey,
  recalcRating,
  pixPayload,
  confirmPaymentRecord,
  expireStalePayments,
  PAY_CONFIRM_MS,
  sellerScore,
  rankedSellers,
  rankOf,
  listingRating,
  categoryOf,
  normalizePromoCode,
  findPromo,
  promoUsable,
  isVipUser,
  canAccessVipContact,
  listingTypeOf,
  listingTypeLabel,
  LISTING_TYPES,
  isPremiumLive,
  listingPlan,
  listingPayment,
  todaysPremiumListing,
  publicPremiumBanner,
  notifyAlerts,
};
