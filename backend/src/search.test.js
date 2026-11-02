const assert = require('assert');
const http = require('http');
const express = require('express');
const db = require('./db');
const { authOptional } = require('./middleware');

function user(email) {
  return db.findOne('users', (u) => u.email === email);
}

function get(server, path) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function makeListing(userId, title, cat) {
  const now = new Date().toISOString();
  return db.insert('listings', {
    userId,
    title,
    description: 'Item de teste da busca por anunciante.',
    categoryId: cat.id,
    subcategory: '',
    price: 120,
    condition: 'usado',
    city: 'Corinto',
    cityId: 'corinto',
    listingType: 'venda',
    acceptsTrade: false,
    acceptsCash: true,
    tradeWishes: '',
    status: 'published',
    featured: false,
    vip: false,
    premium: false,
    views: 0,
    createdAt: now,
    publishedAt: now,
  });
}

async function run() {
  const joao = user('joao@email.com');
  assert.ok(joao, 'usuário demo');
  const cat = db.findOne('categories', () => true);
  const productMatch = makeListing(joao.id, '[TESTE] Ferreira plaina manual', cat);
  const sellerOnly = makeListing(joao.id, '[TESTE] Gol bola antigo', cat);

  const app = express();
  app.use(express.json());
  app.use(authOptional);
  app.use('/api/listings', require('./routes/listings'));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));

  try {
    const bySeller = await get(server, '/api/listings?q=joao&limit=48');
    assert.ok(bySeller.items.some((i) => i.id === sellerOnly.id), 'acha anúncio pelo nome do anunciante');
    assert.ok(bySeller.sellers.some((s) => s.id === joao.id), 'lista o anunciante');

    const reordered = await get(server, '/api/listings?q=' + encodeURIComponent('ferreira joao') + '&limit=48');
    assert.ok(reordered.items.some((i) => i.id === sellerOnly.id), 'ignora ordem das palavras');

    const accents = await get(server, '/api/listings?q=' + encodeURIComponent('joão ferreira') + '&limit=48');
    assert.ok(accents.items.some((i) => i.id === sellerOnly.id), 'busca sem acento encontra nome com acento');

    const byProduct = await get(server, '/api/listings?q=plaina&limit=48');
    assert.ok(byProduct.items.some((i) => i.id === productMatch.id), 'acha anúncio pelo produto');

    const mixed = await get(server, '/api/listings?q=ferreira&limit=48');
    const productIdx = mixed.items.findIndex((i) => i.id === productMatch.id);
    const sellerIdx = mixed.items.findIndex((i) => i.id === sellerOnly.id);
    assert.ok(productIdx >= 0 && sellerIdx >= 0, 'ambos aparecem no termo do anunciante');
    assert.ok(productIdx < sellerIdx, 'produto vem antes dos anúncios achados só pelo anunciante');

    const short = await get(server, '/api/listings?q=j&limit=48');
    assert.strictEqual(short.sellers.length, 0, 'termo curto não sugere anunciantes');
  } finally {
    await new Promise((r) => server.close(r));
    db.remove('listings', productMatch.id);
    db.remove('listings', sellerOnly.id);
  }
  console.log('OK search tests');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
