const db = require('./db');
const { serializeListing } = require('./helpers');
const { safeUser } = require('./middleware');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function parseExtraValue(raw) {
  if (raw === undefined || raw === null || raw === '') return 0;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : 0;
  const s = String(raw).trim();
  if (!s) return 0;
  const n = Number(s.replace(/\./g, '').replace(',', '.'));
  if (Number.isFinite(n) && n > 0) return n;
  const fallback = Number(s);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
}

function extraDirectionOf(value, direction) {
  if (!(Number(value) > 0)) return '';
  return direction === 'ask' ? 'ask' : 'offer';
}

function tradeListingCard(listing, viewer) {
  if (!listing) return null;
  const row = serializeListing(listing, { user: viewer, userId: viewer && viewer.id });
  return {
    id: row.id,
    title: row.title,
    price: row.price,
    status: row.status,
    city: row.city,
    images: (row.images || []).slice(0, 1).map((im) => ({ id: im.id, url: im.url })),
    unavailable: listing.status !== 'published',
  };
}

function serializeTrade(t, viewer) {
  const listing = db.findById('listings', t.listingId);
  const offered = t.offerListingId ? db.findById('listings', t.offerListingId) : null;
  const extraValue = Number(t.extraValue) || 0;
  return {
    ...t,
    extraValue,
    extraDirection: extraDirectionOf(extraValue, t.extraDirection),
    listing: tradeListingCard(listing, viewer),
    offeredListing: tradeListingCard(offered, viewer),
    proposer: safeUser(db.findById('users', t.proposerId)),
    owner: safeUser(db.findById('users', t.ownerId)),
    mine: !!(viewer && t.proposerId === viewer.id),
  };
}

function createTrade(user, body) {
  const listing = db.findById('listings', body && body.listingId);
  if (!listing || listing.status !== 'published') {
    throw httpError(404, 'Anúncio não encontrado.');
  }
  // Produto oficial não participa de trocas: venda é concluída no parceiro.
  if (require('./official').isOfficialListing(listing)) {
    throw httpError(403, 'Produto oficial não aceita propostas de troca.');
  }
  if (!listing.acceptsTrade) {
    throw httpError(400, 'Este anúncio não aceita troca.');
  }
  if (listing.userId === user.id) {
    throw httpError(400, 'Você não pode propor troca no próprio anúncio.');
  }
  const text = body && body.description ? String(body.description).trim() : '';
  let offerId = '';
  if (body && body.offerListingId) {
    const offered = db.findById('listings', body.offerListingId);
    if (!offered || offered.status !== 'published') {
      throw httpError(400, 'Escolha um anúncio seu que esteja ativo.');
    }
    if (offered.userId !== user.id) {
      throw httpError(403, 'Só dá para oferecer um anúncio seu.');
    }
    if (offered.id === listing.id) {
      throw httpError(400, 'Ofereça outro item, não o mesmo anúncio.');
    }
    offerId = offered.id;
  }
  if (!offerId && !text) {
    throw httpError(400, 'Escolha um anúncio seu ou descreva o que você oferece.');
  }
  const extra = parseExtraValue(body && body.extraValue);
  const now = new Date().toISOString();
  const proposal = db.insert('tradeProposals', {
    listingId: listing.id,
    offerListingId: offerId,
    proposerId: user.id,
    ownerId: listing.userId,
    description: text,
    extraValue: extra,
    extraDirection: extraDirectionOf(extra, body && body.extraDirection),
    status: 'sent',
    createdAt: now,
    updatedAt: now,
  });
  return serializeTrade(proposal, user);
}

function listTrades(user) {
  return db
    .findWhere(
      'tradeProposals',
      (t) => t.proposerId === user.id || t.ownerId === user.id
    )
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((t) => serializeTrade(t, user));
}

function setTradeStatus(user, id, action) {
  const t = db.findById('tradeProposals', id);
  if (!t) throw httpError(404, 'Proposta não encontrada.');
  const now = new Date().toISOString();
  let status = t.status;
  if (user.id === t.ownerId) {
    if (action === 'accept' && ['sent', 'negotiating'].includes(t.status)) status = 'accepted';
    else if (action === 'reject' && ['sent', 'negotiating'].includes(t.status)) status = 'rejected';
    else if (action === 'negotiate' && t.status === 'sent') status = 'negotiating';
    else if (action === 'finish' && t.status === 'accepted') status = 'finished';
    else throw httpError(400, 'Ação inválida.');
  } else if (user.id === t.proposerId) {
    if (action === 'cancel' && ['sent', 'negotiating'].includes(t.status)) status = 'rejected';
    else if (action === 'finish' && t.status === 'accepted') status = 'finished';
    else throw httpError(400, 'Ação inválida.');
  } else {
    throw httpError(403, 'Sem permissão.');
  }
  const updated = db.update('tradeProposals', t.id, { status, updatedAt: now });
  return serializeTrade(updated, user);
}

module.exports = {
  parseExtraValue,
  extraDirectionOf,
  serializeTrade,
  createTrade,
  listTrades,
  setTradeStatus,
};
