# Catira Pix Test Product Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Abrir compra Pix só no produto oficial Teste Pix R$ 10, para qualquer usuário logado, na Appmax produção.

**Architecture:** Flag `buyEnabled` na oferta Catira. `createOrder` exige a flag. Rotas HTTP `POST /api/orders`, `GET /api/orders/:id` (dono) e `POST /api/orders/:id/pix` substituem o 403 nesses três caminhos. Checkout session HTTP continua 403. Seed `ensureTestPixProduct` cria o item de R$ 10. Ficha mostra Comprar só com a flag; Appmax JS só para IP.

**Tech Stack:** Node CommonJS, Express, SQLite, React/Vite. Testes `node src/*.test.js` e `node --test frontend/src/*.test.mjs`. Appmax mock nos testes; sem rede real nos unitários.

## Global Constraints

- Só Pix. Sem `AppmaxCardForm` na ficha. Sem rota pública de cartão.
- `commercialReady` continua `false` em toda oferta Catira. Recusar `commercialReady: true`.
- `POST/GET /api/checkout/sessions` e `GET /api/orders` (lista) continuam 403.
- Frete 0. Sem reembolso, VIP/`pix.js`, fornecedor.
- Cliente não manda preço. Total do produto de teste = 1000 centavos (qty 1).
- Webhook já existente; confirmação via `GET /v1/orders/{id}`.
- Sem commit, unless the user asks.
- Sem secrets no chat. Testes de Appmax usam mock.
- Mensagem 403 inalterada: `A compra pelo Catira ainda não está disponível nesta fase.`

---

### Task 1: Flag `buyEnabled` na oferta Catira

**Files:**
- Modify: `backend/src/official.js`
- Modify: `backend/src/official.test.js`

**Interfaces:**
- Consumes: `sanitizeOfferInput`, `upsertOffer`, `updateOffer`, `serializeOffer`
- Produces: `offer.buyEnabled` boolean (default false); `serializeOffer` público com `buyEnabled` e `commercialAvailability` `'available'|'preparing'`

- [ ] **Step 1: Write the failing tests**

No bloco Catira de `backend/src/official.test.js` (depois de `assert.strictEqual(catiraUp.offer.commercialReady, false, 'sempre em preparação');`), acrescente:

```js
    assert.strictEqual(catiraUp.offer.buyEnabled, false, 'Catira nova sem compra');
    assert.strictEqual(shownPublic && shownPublic.buyEnabled, undefined);
```

Esse `shownPublic` ainda não existe nesse ponto. Em vez disso, acrescente **depois** de `const shownPublic = official.serializeOffer(publicCatira, { public: true });`:

```js
    assert.strictEqual(shownPublic.buyEnabled, false);
    assert.strictEqual(shownPublic.commercialAvailability, 'preparing');
```

(`shownPublic.commercialAvailability === 'preparing'` já existe; mantenha.)

Ainda no mesmo `try`, depois do teste que recusa `commercialReady: true`, acrescente:

```js
    const opened = official.upsertOffer(
      product.id,
      { provider: 'catira', price: 125, buyEnabled: true },
      { id: seller.id }
    );
    assert.strictEqual(opened.offer.buyEnabled, true, 'buyEnabled grava');
    assert.strictEqual(opened.offer.commercialReady, false, 'commercialReady segue false');
    const shownOpen = official.serializeOffer(opened.offer, { public: true });
    assert.strictEqual(shownOpen.buyEnabled, true);
    assert.strictEqual(shownOpen.commercialAvailability, 'available');
    official.upsertOffer(
      product.id,
      { provider: 'catira', price: 125, buyEnabled: false },
      { id: seller.id }
    );
```

O teste existente `expectStatus(..., commercialReady: true, 400)` permanece.

- [ ] **Step 2: Run test to verify it fails**

Run: `node src/official.test.js` (workdir `/workspace/backend`)

Expected: FAIL (`buyEnabled` undefined / sanitize ainda recusa `buyEnabled: true`)

- [ ] **Step 3: Write minimal implementation**

Em `sanitizeOfferInput` (`backend/src/official.js`), no bloco `provider === 'catira'`, **trocar**:

```js
    if (b.commercialReady === true || b.buyEnabled === true || b.commercialAvailability === 'available') {
      throw httpError(400, 'A compra pelo Catira ainda não está disponível nesta fase.');
    }
    out.commercialReady = false;
```

por:

```js
    if (b.commercialReady === true || b.commercialAvailability === 'available') {
      throw httpError(400, 'A compra pelo Catira ainda não está disponível nesta fase.');
    }
    out.commercialReady = false;
    if (b.buyEnabled !== undefined) out.buyEnabled = !!b.buyEnabled;
```

Em `upsertOffer`, no `patch` de Catira, **não** force `buyEnabled: false`. Se `input.buyEnabled === undefined` e não há `existing`, `patch.buyEnabled = false`. Se há `existing` e o input não manda `buyEnabled`, preserve `existing.buyEnabled`.

```js
  if (input.provider === 'catira') {
    patch.commercialReady = false;
    patch.url = '';
    if (input.buyEnabled === undefined) {
      patch.buyEnabled = existing ? !!existing.buyEnabled : false;
    }
  }
```

Em `updateOffer`, o `sanitizeOfferInput` já devolve `buyEnabled` se veio no body; não zere.

Em `serializeOffer`:

```js
    const catiraBuy = catira && offer.buyEnabled === true && money2(offer.price) > 0;
    ...
    commercialReady: catira ? false : undefined,
    commercialAvailability: catira ? (catiraBuy ? 'available' : 'preparing') : undefined,
    buyEnabled: catira ? catiraBuy : undefined,
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `node src/official.test.js`

Expected: `OK` (ou o log atual do arquivo) sem falha.

- [ ] **Step 5: Commit**

Pular.

---

### Task 2: `createOrder` exige `buyEnabled`

**Files:**
- Modify: `backend/src/orders.js`
- Modify: `backend/src/orders.test.js`
- Modify: `backend/src/orders.pix.test.js`
- Modify: `backend/src/orders.card.test.js`
- Modify: `backend/src/orders.webhook.test.js`
- Modify: `backend/src/orders.homolog.test.js`

**Interfaces:**
- Consumes: `catiraOfferOf(offerId)`
- Produces: `createOrder` / `createCheckoutSession` lançam 403 `A compra pelo Catira ainda não está disponível nesta fase.` se `offer.buyEnabled !== true`

- [ ] **Step 1: Write the failing test**

Em `backend/src/orders.test.js`, no `upsertOffer` da Catira de domínio, **ainda não** ligue a flag. Primeiro acrescente, logo após `assert.strictEqual(catira.offer.commercialReady, false);`:

```js
    expectStatus(
      () => orders.createOrder({
        userId: joao.id,
        offerId: catira.offer.id,
        quantity: 1,
        address: ADDRESS,
      }),
      403,
      'oferta Catira sem buyEnabled não gera pedido'
    );
```

Esse teste deve falhar hoje (createOrder passa). Depois da implementação, passe a flag nas ofertas de domínio (passo 3).

- [ ] **Step 2: Run test to verify it fails**

Run: `node src/orders.test.js`

Expected: FAIL (`oferta Catira sem buyEnabled não gera pedido deveria lançar`)

- [ ] **Step 3: Write minimal implementation**

Em `catiraOfferOf` (`backend/src/orders.js`), depois da checagem de preço:

```js
  if (offer.buyEnabled !== true) {
    throw httpError(403, 'A compra pelo Catira ainda não está disponível nesta fase.');
  }
```

Atualize **todas** as ofertas Catira usadas para `createOrder` / `preparePixCharge` / `prepareCardCharge` / webhook / homolog para incluir `buyEnabled: true`:

- `backend/src/orders.test.js` — o `upsertOffer` principal da Catira: `{ provider: 'catira', price: 135.5, stock: 3, status: 'manual', buyEnabled: true }`. O `expectStatus` 403 do passo 1 deve usar **outra** oferta: crie um segundo produto (`title: '[TESTE] Catira fechada'`) com Catira **sem** `buyEnabled` e aponte o 403 para esse `offerId`. Os `upsertOffer` posteriores que só mudam `price`/`status` **não** devem mandar `buyEnabled: false` (preserve).
- `backend/src/orders.pix.test.js` — `{ provider: 'catira', price: 135.5, stock: 3, status: 'manual', buyEnabled: true }`
- `backend/src/orders.card.test.js` — idem no upsert inicial
- `backend/src/orders.webhook.test.js` — idem
- `backend/src/orders.homolog.test.js` — idem

O bloco HTTP de `orders.test.js` que espera 403 em `POST /api/orders` deve usar o `offerId` **sem** flag (produto fechado), não o de domínio.

- [ ] **Step 4: Run the tests and make sure they pass**

Run:

```bash
node src/orders.test.js && node src/orders.pix.test.js && node src/orders.card.test.js && node src/orders.webhook.test.js && node src/orders.homolog.test.js
```

Expected: todos `ok` / `OK orders tests`.

- [ ] **Step 5: Commit**

Pular.

---

### Task 3: Rotas públicas de pedido e Pix

**Files:**
- Modify: `backend/src/orders.js` (export `serializeBuyerOrder`)
- Modify: `backend/src/routes/orders.js`
- Modify: `backend/src/orders.test.js` (HTTP 200 no produto com flag + GET dono + Pix HTTP)

**Interfaces:**
- Consumes: `createOrder`, `getOrder`, `preparePixCharge`, `authRequired`
- Produces:
  - `serializeBuyerOrder(detail)` → `{ id, status, totalCents, quantity, productSnapshot, address, pixEmv, pixQrcode, pixExpirationDate, commercialReady: false }`
  - `POST /api/orders` logado → 200 body `serializeBuyerOrder`
  - `GET /api/orders/:id` dono → 200; outro usuário → 404; lista `GET /api/orders` → 403
  - `POST /api/orders/:id/pix` dono → `preparePixCharge`; body `{ documentNumber, ip }`
  - checkout sessions HTTP → 403

- [ ] **Step 1: Write the failing tests**

Em `backend/src/orders.test.js`, no servidor HTTP já montado, **depois** do 403 da oferta fechada, use a oferta **com** `buyEnabled` (`catira.offer.id`):

```js
      const openCreate = await jsonRequest(server, {
        method: 'POST',
        path: '/api/orders',
        token: signToken(joao),
        body: { offerId: catira.offer.id, quantity: 1, address: ADDRESS },
      });
      assert.strictEqual(openCreate.status, 200, 'logado compra oferta buyEnabled');
      assert.strictEqual(openCreate.body.totalCents, 13550);
      assert.strictEqual(openCreate.body.quantity, 1);
      assert.strictEqual(openCreate.body.commercialReady, false);
      assert.ok(openCreate.body.id);
      assert.ok(openCreate.body.productSnapshot);
      assert.strictEqual(openCreate.body.address.street, 'Rua das Flores');
      assert.ok(!('userId' in openCreate.body), 'comprador não vê userId cru se omitido no serialize');
      ids.orders.push(openCreate.body.id);

      const other = extraBuyer(ids, 'Outro', 'outro-buy@test.local');
      const stolen = await jsonRequest(server, {
        path: '/api/orders/' + openCreate.body.id,
        token: signToken(other),
      });
      assert.strictEqual(stolen.status, 404, 'outro usuário não lê o pedido');

      const mine = await jsonRequest(server, {
        path: '/api/orders/' + openCreate.body.id,
        token: signToken(joao),
      });
      assert.strictEqual(mine.status, 200);
      assert.strictEqual(mine.body.id, openCreate.body.id);

      const pixHttp = await jsonRequest(server, {
        method: 'POST',
        path: '/api/orders/' + openCreate.body.id + '/pix',
        token: signToken(joao),
        body: { documentNumber: '19100000000', ip: '127.0.0.1' },
      });
      assert.ok(pixHttp.status === 502 || pixHttp.status === 504 || pixHttp.status === 200);
      if (pixHttp.status !== 200) {
        assert.match(String(pixHttp.body && pixHttp.body.error), /Appmax|Tempo esgotado|Credencial/i);
      }

      const listStill = await jsonRequest(server, {
        path: '/api/orders',
        token: signToken(joao),
      });
      assert.strictEqual(listStill.status, 403, 'lista pública segue fechada');

      const checkoutStill = await jsonRequest(server, {
        method: 'POST',
        path: '/api/checkout/sessions',
        token: signToken(joao),
        body: { offerId: catira.offer.id, quantity: 1, address: ADDRESS },
      });
      assert.strictEqual(checkoutStill.status, 403, 'checkout session segue fechada');
```

O `POST /pix` neste teste bate na Appmax real se as credenciais existirem. **Não faça isso.** Use mock: em vez de chamar Pix HTTP aqui, teste `serializeBuyerOrder` + GET, e cubra Pix HTTP em `orders.pix.test.js` com `app.use` + mock injetável **ou** só teste a rota Pix com `preparePixCharge` já mockado no módulo (a rota chama o módulo). Para não bater rede: no handler, `preparePixCharge` usa `createClient()` real. Então **não** chame `/pix` neste teste de `orders.test.js`. Troque o bloco `pixHttp` por:

```js
      const pixDeniedOther = await jsonRequest(server, {
        method: 'POST',
        path: '/api/orders/' + openCreate.body.id + '/pix',
        token: signToken(other),
        body: { documentNumber: '19100000000', ip: '127.0.0.1' },
      });
      assert.strictEqual(pixDeniedOther.status, 404);
```

Pix com mock: em `orders.pix.test.js` no final de `run()`, monte um Express igual ao de `orders.test.js`, faça `POST /api/orders` (oferta já `buyEnabled`) e **não** chame Appmax. A cobrança Pix HTTP fica coberta só se injetarmos client. **Não injete.** A rota chama `orders.preparePixCharge(id, body)` sem opts → Appmax real. Para o teste da rota Pix, acrescente em `orders.js` suporte opcional **não**. Em vez disso, teste unitário da rota com stub: no teste HTTP de Pix, chame a função `preparePixCharge` já testada e, na rota, apenas:

1. auth + dono
2. `await preparePixCharge(id, req.body)`
3. `serializeBuyerOrder`

Cubra o 400 da rota Pix (sem CPF) — isso **não** chama Appmax:

```js
      const pixNoDoc = await jsonRequest(server, {
        method: 'POST',
        path: '/api/orders/' + openCreate.body.id + '/pix',
        token: signToken(joao),
        body: { ip: '127.0.0.1' },
      });
      assert.strictEqual(pixNoDoc.status, 400);
      assert.match(String(pixNoDoc.body && pixNoDoc.body.error), /CPF|CNPJ/i);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node src/orders.test.js`

Expected: FAIL (`logado compra oferta buyEnabled` status 403)

- [ ] **Step 3: Write minimal implementation**

Em `backend/src/orders.js`, antes de `module.exports`:

```js
function serializeBuyerOrder(detail) {
  const order = detail.order || detail;
  const snap = order.productSnapshot || {};
  return {
    id: order.id,
    status: order.status,
    totalCents: order.totalCents,
    quantity: order.quantity,
    productSnapshot: { title: snap.title || '' },
    address: order.address || null,
    pixEmv: order.pixEmv || null,
    pixQrcode: order.pixQrcode || null,
    pixExpirationDate: order.pixExpirationDate || null,
    commercialReady: false,
  };
}
```

Exporte `serializeBuyerOrder`.

Substitua `backend/src/routes/orders.js` por:

```js
const express = require('express');
const { authRequired, adminRequired } = require('../middleware');

const UNAVAILABLE = 'A compra pelo Catira ainda não está disponível nesta fase.';

function denyPublic(_req, res) {
  return res.status(403).json({ error: UNAVAILABLE });
}

function sendErr(res, err) {
  const status = (err && err.status) || 500;
  return res.status(status).json({ error: (err && err.message) || 'Falha no pedido.' });
}

function asOwner(req, order) {
  if (!order || order.userId !== req.user.id) {
    const err = new Error('Pedido não encontrado.');
    err.status = 404;
    throw err;
  }
  return order;
}

const router = express.Router();

router.post('/', authRequired, (req, res) => {
  try {
    const orders = require('../orders');
    const body = req.body || {};
    const out = orders.createOrder({
      userId: req.user.id,
      offerId: body.offerId,
      quantity: body.quantity == null ? 1 : body.quantity,
      address: body.address,
      idempotencyKey: body.idempotencyKey,
    });
    return res.json(orders.serializeBuyerOrder(out));
  } catch (err) {
    return sendErr(res, err);
  }
});

router.get('/', authRequired, denyPublic);

router.get('/:id', authRequired, (req, res) => {
  try {
    const orders = require('../orders');
    const detail = orders.getOrder(req.params.id);
    asOwner(req, detail.order);
    return res.json(orders.serializeBuyerOrder(detail));
  } catch (err) {
    if (err && err.status === 404) return res.status(404).json({ error: 'Pedido não encontrado.' });
    return sendErr(res, err);
  }
});

router.post('/:id/pix', authRequired, async (req, res) => {
  try {
    const orders = require('../orders');
    const detail = orders.getOrder(req.params.id);
    asOwner(req, detail.order);
    const charged = await orders.preparePixCharge(req.params.id, req.body || {});
    return res.json(orders.serializeBuyerOrder(charged));
  } catch (err) {
    if (err && err.status === 404) return res.status(404).json({ error: 'Pedido não encontrado.' });
    return sendErr(res, err);
  }
});

const checkout = express.Router();
checkout.post('/sessions', authRequired, denyPublic);
checkout.get('/sessions/:id', authRequired, denyPublic);

function attachAdmin(adminRouter) {
  adminRouter.get('/orders', adminRequired, (_req, res) => {
    const orders = require('../orders');
    res.json({ items: orders.listOrdersAdmin() });
  });
  adminRouter.get('/orders/:id', adminRequired, (req, res) => {
    const orders = require('../orders');
    const detail = orders.getOrderAdmin(req.params.id);
    if (!detail) return res.status(404).json({ error: 'Pedido não encontrado.' });
    res.json(detail);
  });
}

module.exports = router;
module.exports.checkout = checkout;
module.exports.attachAdmin = attachAdmin;
module.exports.UNAVAILABLE = UNAVAILABLE;
```

`getOrder` hoje lança 404 se o id não existe; `asOwner` cobre pedido de outro usuário. Se `getOrder` lançar 404 antes do owner check, o status já é 404 — correto (não vazar).

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `node src/orders.test.js && node src/orders.pix.test.js`

Expected: pass.

- [ ] **Step 5: Commit**

Pular.

---

### Task 4: Produto `Teste Pix R$ 10`

**Files:**
- Modify: `backend/src/official.js` (`ensureTestPixProduct`)
- Modify: `backend/src/official.test.js`
- Modify: `backend/src/server.js` (chamar no boot)
- Modify: `backend/src/official.js` `module.exports`

**Interfaces:**
- Consumes: `createProduct`, `upsertOffer`, `ensureOfficialSeller`, primeira categoria ativa, cidade Corinto
- Produces: `ensureTestPixProduct()` → `{ product, offer, listing, created: boolean }`; idempotente pelo título `Teste Pix R$ 10`

- [ ] **Step 1: Write the failing test**

No final de `run()` em `backend/src/official.test.js` (antes do log OK), ainda dentro de um `try/finally` próprio:

```js
  const pixIds = { products: [], offers: [] };
  try {
    const first = official.ensureTestPixProduct();
    pixIds.products.push(first.product.id);
    pixIds.offers.push(first.offer.id);
    assert.strictEqual(first.product.title, 'Teste Pix R$ 10');
    assert.strictEqual(first.offer.provider, 'catira');
    assert.strictEqual(first.offer.price, 10);
    assert.strictEqual(first.offer.stock, 10);
    assert.strictEqual(first.offer.buyEnabled, true);
    assert.strictEqual(first.offer.commercialReady, false);
    assert.strictEqual(first.offer.status, 'active');
    assert.ok(first.product.published);
    const second = official.ensureTestPixProduct();
    assert.strictEqual(second.product.id, first.product.id, 'idempotente');
    assert.strictEqual(second.offer.id, first.offer.id);
  } finally {
    cleanup(pixIds);
  }
```

Use o `cleanup` já existente do arquivo.

- [ ] **Step 2: Run test to verify it fails**

Run: `node src/official.test.js`

Expected: FAIL (`ensureTestPixProduct is not a function`)

- [ ] **Step 3: Write minimal implementation**

Em `backend/src/official.js`:

```js
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
```

Exporte `ensureTestPixProduct`.

Em `backend/src/server.js`, depois de `require('./official').ensureOfficialSeller()`:

```js
try { require('./official').ensureTestPixProduct(); } catch {}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `node src/official.test.js`

Expected: pass. O `cleanup` apaga o produto de teste do SQLite de dev se o teste rodar contra o mesmo DB — **é o DB real**. `official.test.js` já cria/apaga produtos de teste no mesmo SQLite. O `finally { cleanup(pixIds) }` remove o produto de R$ 10 ao fim do teste. O boot do server recria. Aceitável.

Se o teste apagar o produto e o server já estiver no ar, recrie no próximo boot. Não persista o produto **só** no teste.

- [ ] **Step 5: Commit**

Pular.

---

### Task 5: Ficha — Comprar no Catira (Pix)

**Files:**
- Modify: `frontend/src/config.jsx` (passar `appmax`)
- Modify: `frontend/src/pages/Listing.jsx`
- Modify: `frontend/src/catiraOffer.test.mjs`
- Modify: `frontend/src/appmaxCard.test.mjs`

**Interfaces:**
- Consumes: `catiraOffer.buyEnabled`, `useConfig().appmax` (`scriptUrl`, `externalId`, `env`), `loadAppmaxScript`, `initAppmaxScripts`, `POST /api/orders`, `POST /api/orders/:id/pix`
- Produces: botão **Comprar no Catira** só se `buyEnabled`; formulário endereço+CPF; QR/EMV; sem `AppmaxCardForm`

- [ ] **Step 1: Write the failing tests**

Em `frontend/src/catiraOffer.test.mjs` **mantenha** os asserts de preparação (oferta sem botão href, “Em preparação” ainda no arquivo). Acrescente:

```js
assert.equal(listing.includes('Comprar no Catira'), true, 'ficha tem Comprar no Catira');
assert.equal(listing.includes('catiraOffer.buyEnabled'), true, 'botão respeita buyEnabled');
assert.equal(listing.includes('AppmaxCardForm'), false, 'ficha sem form de cartão');
assert.equal(listing.includes('/api/orders'), true, 'ficha cria pedido');
assert.equal(listing.includes('/pix'), true, 'ficha gera Pix');
```

Em `frontend/src/appmaxCard.test.mjs`, **troque** só:

```js
assert.equal(listing.includes('Comprar pelo Catira'), false, 'ficha sem Comprar pelo');
assert.equal(listing.includes('AppmaxCardForm'), false, 'ficha sem form de cartão');
assert.equal(listing.includes('data-appmax-checkout'), false, 'ficha sem checkout de cartão');
assert.equal(listing.includes('data-appmax-customer'), true, 'ficha pede IP Appmax JS');
```

O assert antigo `listing.includes('Comprar pelo Catira'), false` já existe; não mude o texto do botão para “pelo”.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/catiraOffer.test.mjs src/appmaxCard.test.mjs` (workdir `/workspace/frontend`)

Expected: FAIL (`ficha tem Comprar no Catira`)

- [ ] **Step 3: Write minimal implementation**

`frontend/src/config.jsx`: em `emptyCfg` acrescente `appmax: { scriptUrl: '', externalId: '', env: 'production' }`. No `setCfg`, `appmax: d.appmax && d.appmax.scriptUrl ? d.appmax : { scriptUrl: '', externalId: '', env: 'production' }`.

`frontend/src/pages/Listing.jsx`:

- Importar `useConfig` de `../config`, `{ loadAppmaxScript, initAppmaxScripts }` de `../appmax`.
- Estados: `buyOpen`, `buyErr`, `buyBusy`, `pixOrder`, `payerIp`, `docNumber`, e campos de endereço (`recipientName`, `phone`, `cep`, `street`, `number`, `complement`, `district`, `city`, `state` default `'MG'`, `cityId` default `item.cityId || 'corinto'`).
- `useEffect` quando `catiraOffer && catiraOffer.buyEnabled` e `cfg.appmax.externalId`: `loadAppmaxScript(cfg.appmax.scriptUrl)` + `initAppmaxScripts({ externalId, onIp: setPayerIp })`. Incluir `<form data-appmax-customer hidden />` só nesse ramo.
- Bloco Catira: se `catiraOffer.buyEnabled`, botão `Comprar no Catira` + `{money(catiraOffer.price)}`. Clique: se `!user`, `nav('/entrar?next=' + encodeURIComponent(location.pathname))`; senão `setBuyOpen(true)`.
- Se `!catiraOffer.buyEnabled`, manter o bloco “em preparação” atual.
- Form (quando `buyOpen` e sem `pixOrder`): inputs endereço + CPF/CNPJ. Submit: `POST /api/orders` `{ offerId: catiraOffer.id, quantity: 1, address }` depois `POST /api/orders/${id}/pix` `{ documentNumber: docNumber, ip: payerIp }`. Sem IP: erro `Aguarde a verificação da Appmax (IP).`. Sem login já tratado.
- Sucesso: guardar resposta em `pixOrder`. Mostrar `pixQrcode` como `<img alt="QR Pix" src={pixOrder.pixQrcode.startsWith('data:') ? pixOrder.pixQrcode : ('data:image/png;base64,' + pixOrder.pixQrcode)} />` se houver, e `<textarea readOnly value={pixOrder.pixEmv} />` + texto “Aguardando pagamento Pix.”
- Erros: `buyErr` com `ex.message`.
- **Não** importar `AppmaxCardForm`. **Não** usar `data-appmax-checkout`.

- [ ] **Step 4: Run the tests and make sure they pass**

Run:

```bash
node --test src/catiraOffer.test.mjs src/appmaxCard.test.mjs
```

workdir `/workspace/frontend`

Expected: `OK catira offer ui tests` e `OK appmax card ui tests`.

- [ ] **Step 5: Commit**

Pular.

---

### Task 6: Verificação completa

**Files:** nenhum novo.

- [ ] **Step 1: Backend tests**

Run: `npm test` (workdir `/workspace/backend`)

Expected: todos os arquivos `ok`.

- [ ] **Step 2: Frontend tests + build**

Run:

```bash
node --test src/catiraOffer.test.mjs src/appmaxCard.test.mjs src/appmax.js
npm run build
```

workdir `/workspace/frontend`

Se `node --test src/appmax.js` não for teste, rode só os `*.test.mjs`.

Expected: testes OK, build sem erro.

- [ ] **Step 3: Reiniciar API se estiver no ar**

A API precisa recarregar `ensureTestPixProduct` e as rotas. Mate o terminal da API anterior e suba `node src/server.js` em background no backend. Confirme log `CATIRA API on http://localhost:3001`.

- [ ] **Step 4: Commit**

Pular.

---

## Spec coverage

| Spec | Task |
|---|---|
| Flag `buyEnabled`, `commercialReady` false | 1 |
| `createOrder` exige flag; 403 mensagem atual | 2 |
| HTTP pedido + Pix dono; lista/checkout 403 | 3 |
| Produto Teste Pix R$ 10 idempotente | 4 |
| Ficha Comprar + Pix + IP Appmax JS | 5 |
| Testes oficiais + build | 6 |
| Cartão público fechado | 3 + 5 (`AppmaxCardForm` ausente) |
| Frete 0 / sem commit | constraints |

## Placeholder scan

Sem TBD. Commits pulados de propósito.
