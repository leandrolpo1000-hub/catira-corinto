const assert = require('assert');
const db = require('./db');
const trades = require('./trades');

function user(email) {
  return db.findOne('users', (u) => u.email === email);
}

function addListing(owner, patch) {
  const cat = db.findOne('categories', (c) => c.active !== false);
  const now = new Date().toISOString();
  return db.insert('listings', {
    userId: owner.id,
    title: patch.title || '[TESTE] troca',
    description: 'Item de teste da proposta de troca.',
    categoryId: cat.id,
    subcategory: '',
    price: patch.price || 100,
    condition: 'usado',
    city: 'Corinto',
    cityId: 'corinto',
    listingType: patch.listingType || 'venda_troca',
    acceptsTrade: patch.acceptsTrade !== undefined ? patch.acceptsTrade : true,
    acceptsCash: true,
    tradeWishes: 'Aceito troca.',
    status: patch.status || 'published',
    featured: false,
    vip: false,
    views: 0,
    createdAt: now,
    publishedAt: now,
  });
}

function run() {
  const joao = user('joao@email.com');
  const maria = user('maria@email.com');
  assert.ok(joao && maria, 'usuários demo');

  assert.strictEqual(trades.parseExtraValue('1.250,50'), 1250.5);
  assert.strictEqual(trades.parseExtraValue(0), 0);
  assert.strictEqual(trades.extraDirectionOf(10, 'ask'), 'ask');
  assert.strictEqual(trades.extraDirectionOf(0, 'ask'), '');
  assert.strictEqual(trades.extraDirectionOf(10, 'x'), 'offer');

  const wanted = addListing(maria, { title: '[TESTE] TV da Maria', price: 800 });
  const mine = addListing(joao, { title: '[TESTE] Bike do João', price: 400 });
  const paused = addListing(joao, { title: '[TESTE] pausado', status: 'paused' });
  const others = addListing(maria, { title: '[TESTE] da Maria' });
  const ids = { listings: [wanted.id, mine.id, paused.id, others.id], trades: [] };

  try {
    try {
      trades.createTrade(joao, { listingId: wanted.id });
      throw new Error('vazio deveria falhar');
    } catch (e) {
      assert.strictEqual(e.status, 400);
    }

    const textOnly = trades.createTrade(joao, {
      listingId: wanted.id,
      description: 'Tenho uma TV 32 e posso voltar um valor.',
      extraValue: '200,00',
    });
    ids.trades.push(textOnly.id);
    assert.strictEqual(textOnly.description.includes('TV 32'), true);
    assert.strictEqual(textOnly.extraValue, 200);
    assert.strictEqual(textOnly.extraDirection, 'offer');
    assert.strictEqual(textOnly.offerListingId, '');
    assert.strictEqual(textOnly.listing.title, wanted.title);
    assert.strictEqual(wanted.status, 'published');

    try {
      trades.createTrade(joao, { listingId: wanted.id, offerListingId: paused.id });
      throw new Error('pausado deveria falhar');
    } catch (e) {
      assert.strictEqual(e.status, 400);
    }

    try {
      trades.createTrade(joao, { listingId: wanted.id, offerListingId: others.id });
      throw new Error('alheio deveria falhar');
    } catch (e) {
      assert.strictEqual(e.status, 403);
    }

    const withListing = trades.createTrade(joao, {
      listingId: wanted.id,
      offerListingId: mine.id,
      extraValue: 150,
      extraDirection: 'ask',
    });
    ids.trades.push(withListing.id);
    assert.strictEqual(withListing.offerListingId, mine.id);
    assert.strictEqual(withListing.offeredListing.title, mine.title);
    assert.strictEqual(withListing.extraDirection, 'ask');
    assert.strictEqual(db.findById('listings', wanted.id).status, 'published');
    assert.strictEqual(db.findById('listings', mine.id).status, 'published');

    db.update('listings', mine.id, { status: 'paused' });
    const listed = trades.listTrades(maria).find((t) => t.id === withListing.id);
    assert.ok(listed.offeredListing);
    assert.strictEqual(listed.offeredListing.unavailable, true);
    assert.strictEqual(listed.offeredListing.title, mine.title);

    const old = db.insert('tradeProposals', {
      listingId: wanted.id,
      proposerId: joao.id,
      ownerId: maria.id,
      description: 'proposta antiga só texto',
      extraValue: 50,
      status: 'sent',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    ids.trades.push(old.id);
    const oldView = trades.serializeTrade(old, maria);
    assert.strictEqual(oldView.description, 'proposta antiga só texto');
    assert.strictEqual(oldView.extraValue, 50);
    assert.strictEqual(oldView.extraDirection, 'offer');
    assert.strictEqual(oldView.offeredListing, null);

    const accepted = trades.setTradeStatus(maria, withListing.id, 'accept');
    assert.strictEqual(accepted.status, 'accepted');
    const finished = trades.setTradeStatus(maria, withListing.id, 'finish');
    assert.strictEqual(finished.status, 'finished');
    assert.strictEqual(db.findById('listings', wanted.id).status, 'published');

    console.log('OK trades tests');
  } finally {
    ids.trades.forEach((id) => db.remove('tradeProposals', id));
    ids.listings.forEach((id) => db.remove('listings', id));
  }
}

run();
