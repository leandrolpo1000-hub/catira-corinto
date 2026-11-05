# 5 oficiais de exemplo + checkout Pix ou cartão

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cinco produtos oficiais de Corinto compráveis pelo Catira, e checkout com Pix **ou** cartão (não os dois no mesmo pedido), confirmação só se `paid`.

**Architecture:** `ensureSampleOfficialProducts()` no boot, idempotente por título, reusa `createProduct` + `upsertOffer` com `buyEnabled: true`. HTTP nova: `GET /api/orders/:id/installments` e `POST /api/orders/:id/card` no router já autenticado, delegando a `quoteInstallments` / `prepareCardCharge`. Checkout escolhe método na tela de pagamento; cartão usa `AppmaxCardForm` (token + IP); poll 8s; `/ok` só com `status === 'paid'`.

**Tech Stack:** Express + `official.js` / `orders.js` existentes, React/Vite, Appmax JS já em `appmax.js` + `AppmaxCardForm.jsx`, testes `node src/*.test.js` e `node --test frontend/src/*.test.mjs`.

## Global Constraints

- Um produto por pedido. Quantidade fixa 1.
- Pix **ou** cartão. Pedido com `pixEmv` não aceita cartão; pedido com `appmaxPaymentId` de cartão não aceita Pix (já no domínio).
- Sem Minhas compras, rastreio, cancelar, reembolso, cupom, retirada, multi-item.
- `commercialReady` continua `false`. Compra só via `buyEnabled`.
- Não alterar o client Appmax. Não misturar `Pay.jsx` / VIP / taxa de anúncio.
- Cliente não manda preço. Frete R$ 0,00 verdadeiro.
- `GET /api/orders` (lista) e `/api/checkout/sessions` continuam 403.
- Identidade Catira (creme / laranja / branco).
- Teste Pix R$ 10 permanece.
- Cobrança Appmax é **real** (R$ 35–89 nestes 5).
- Sem commit, merge, push ou PR até o usuário pedir. Sem secrets.
- Não corrigir o teste preexistente do Vosk.

## File map

| Arquivo | Papel |
|---|---|
| `backend/src/official.js` | Constante dos 5 + `ensureSampleOfficialProducts()` |
| `backend/src/server.js` | Boot após Teste Pix |
| `backend/src/official.test.js` | Idempotência e `buyEnabled` dos 5 |
| `backend/src/routes/orders.js` | `GET /:id/installments`, `POST /:id/card` |
| `backend/src/orders.test.js` | HTTP 400/404/409 cartão; lista 403 |
| `frontend/src/pages/Checkout.jsx` | Escolha Pix/cartão; POST `/card`; aguardo cartão |
| `frontend/src/App.jsx` | Rota `/checkout/:orderId/aguardando` |
| `frontend/src/styles.css` | Escolha de método |
| `frontend/src/checkout.test.mjs` | Contratos UI com cartão |
| `frontend/src/appmaxCard.test.mjs` | Form de cartão no checkout, não na ficha |

Não tocar: `appmax.js` client, `Pay.jsx`, `Listing.jsx` (já navega ao checkout), `commercialReady`.

---

### Task 1: Seed dos 5 oficiais

**Files:**
- Modify: `backend/src/official.js` (junto de `ensureTestPixProduct`)
- Modify: `backend/src/official.js` `module.exports`
- Modify: `backend/src/server.js:37`
- Test: `backend/src/official.test.js` (bloco após `ensureTestPixProduct`)

**Interfaces:**
- Consumes: `createProduct`, `upsertOffer`, `productOf`, `ensureOfficialSeller`, `db.findOne`
- Produces: `SAMPLE_OFFICIAL_PRODUCTS` (array de 5), `ensureSampleOfficialProducts()` → `{ items: [{ product, offer, listing, created }], createdCount }`

- [ ] **Step 1: Write the failing test**

No fim de `backend/src/official.test.js`, **antes** de `console.log('OK official tests')`, depois do bloco `ensureTestPixProduct` existente:

```js
  const sampleIds = { products: [], offers: [] };
  try {
    assert.equal(typeof official.ensureSampleOfficialProducts, 'function', 'ensureSampleOfficialProducts exportada');
    const first = official.ensureSampleOfficialProducts();
    assert.strictEqual(first.items.length, 5, 'cinco oficiais');
    const titles = first.items.map((row) => row.product.title).sort();
    assert.deepStrictEqual(titles, [
      'Boné trucker Corinto',
      'Fone Bluetooth Catira',
      'Kit chaves 40 peças',
      'Luminária LED de mesa',
      'Pulverizador 5 L',
    ].sort());
    first.items.forEach((row) => {
      sampleIds.products.push(row.product.id);
      sampleIds.offers.push(row.offer.id);
      assert.strictEqual(row.offer.provider, 'catira');
      assert.strictEqual(row.offer.buyEnabled, true);
      assert.strictEqual(row.offer.commercialReady, false);
      assert.strictEqual(row.offer.stock, 10);
      assert.ok(row.product.published);
      assert.strictEqual(row.product.cityId, 'corinto');
      assert.ok(row.listing);
    });
    const fone = first.items.find((row) => row.product.title === 'Fone Bluetooth Catira');
    assert.strictEqual(fone.offer.price, 49);
    const second = official.ensureSampleOfficialProducts();
    assert.strictEqual(second.items.length, 5);
    assert.deepStrictEqual(
      second.items.map((row) => row.product.id).sort(),
      first.items.map((row) => row.product.id).sort(),
      'idempotente por título'
    );
    assert.deepStrictEqual(
      second.items.map((row) => row.offer.id).sort(),
      first.items.map((row) => row.offer.id).sort(),
      'oferta Catira reusada'
    );
  } finally {
    cleanup(sampleIds);
  }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node src/official.test.js` em `backend/`

Expected: FAIL (`ensureSampleOfficialProducts` undefined ou `typeof` !== `function`)

- [ ] **Step 3: Write minimal implementation**

Em `backend/src/official.js`, imediatamente após `ensureTestPixProduct`:

```js
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
```

Exportar no `module.exports` ao lado de `ensureTestPixProduct`:

```js
  ensureTestPixProduct,
  ensureSampleOfficialProducts,
  SAMPLE_OFFICIAL_PRODUCTS,
```

Em `backend/src/server.js`, logo após o Teste Pix:

```js
try { require('./official').ensureTestPixProduct(); } catch {}
try { require('./official').ensureSampleOfficialProducts(); } catch {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node src/official.test.js` em `backend/`

Expected: `OK official tests`

- [ ] **Step 5: Commit**

Não commitar. Só se o usuário pedir.

---

### Task 2: Rotas HTTP de cartão e parcelas

**Files:**
- Modify: `backend/src/routes/orders.js`
- Test: `backend/src/orders.test.js` (bloco HTTP já existente, após `pixNoDoc`)

**Interfaces:**
- Consumes: `orders.quoteInstallments(orderId, { installments })`, `orders.prepareCardCharge(orderId, body)`, `orders.serializeBuyerOrder`, `asOwner`
- Produces: `GET /api/orders/:id/installments?installments=`, `POST /api/orders/:id/card`

Não chamar Appmax de verdade nos testes HTTP. Cobrir 400/404/409. O domínio `orders.card.test.js` já cobre cobrança com mock.

- [ ] **Step 1: Write the failing HTTP tests**

Em `backend/src/orders.test.js`, depois de `assert.strictEqual(pixNoDoc.status, 400)` e **antes** de `listStill`:

```js
      const cardDeniedOther = await jsonRequest(server, {
        method: 'POST',
        path: '/api/orders/' + openCreate.body.id + '/card',
        token: signToken(other),
        body: { token: 'tok_x', documentNumber: '19100000000', ip: '127.0.0.1' },
      });
      assert.strictEqual(cardDeniedOther.status, 404, 'outro usuário não cobra cartão');

      const cardNoToken = await jsonRequest(server, {
        method: 'POST',
        path: '/api/orders/' + openCreate.body.id + '/card',
        token: signToken(buyer),
        body: { documentNumber: '19100000000', ip: '127.0.0.1' },
      });
      assert.strictEqual(cardNoToken.status, 400, 'cartão exige token');
      assert.match(String(cardNoToken.body && cardNoToken.body.error), /token/i);

      const instDeniedOther = await jsonRequest(server, {
        path: '/api/orders/' + openCreate.body.id + '/installments',
        token: signToken(other),
      });
      assert.strictEqual(instDeniedOther.status, 404, 'outro usuário não lê parcelas');

      db.update('orders', openCreate.body.id, { pixEmv: '00020126...', appmaxOrderId: 77 }, { allowOrderWrite: true });
      const cardAfterPix = await jsonRequest(server, {
        method: 'POST',
        path: '/api/orders/' + openCreate.body.id + '/card',
        token: signToken(buyer),
        body: { token: 'tok_x', documentNumber: '19100000000', ip: '127.0.0.1' },
      });
      assert.strictEqual(cardAfterPix.status, 409, 'pedido com Pix não aceita cartão');
```

O `db.update` com `pixEmv` **depois** dos 400/404 e **antes** do POST cartão 409. Não apagar os asserts de lista 403.

- [ ] **Step 2: Run test to verify it fails**

Run: `node src/orders.test.js` em `backend/`

Expected: FAIL (404/400 viram 404 de rota inexistente **ou** 404 genérico; o 400 de token não ocorre porque a rota não existe — Express cai em 404). Se o app de teste não tem 404 handler, `status` pode ser 404. O assert `cardNoToken.status === 400` falha.

- [ ] **Step 3: Write the routes**

Em `backend/src/routes/orders.js`, **depois** de `POST /:id/pix` e **antes** de `const checkout = express.Router()`:

```js
router.get('/:id/installments', authRequired, async (req, res) => {
  try {
    const orders = require('../orders');
    const detail = orders.getOrder(req.params.id);
    asOwner(req, detail.order);
    const quoted = await orders.quoteInstallments(req.params.id, {
      installments: req.query.installments,
    });
    return res.json(quoted);
  } catch (err) {
    if (err && err.status === 404) return res.status(404).json({ error: 'Pedido não encontrado.' });
    return sendErr(res, err);
  }
});

router.post('/:id/card', authRequired, async (req, res) => {
  try {
    const orders = require('../orders');
    const detail = orders.getOrder(req.params.id);
    asOwner(req, detail.order);
    const charged = await orders.prepareCardCharge(req.params.id, req.body || {});
    return res.json(orders.serializeBuyerOrder(charged));
  } catch (err) {
    if (err && err.status === 404) return res.status(404).json({ error: 'Pedido não encontrado.' });
    return sendErr(res, err);
  }
});
```

Não passar preço do query/body. `prepareCardCharge` já recusa PAN e totais do cliente.

- [ ] **Step 4: Run test to verify it passes**

Run: `node src/orders.test.js` em `backend/`

Expected: `OK orders tests`

Também: `node src/orders.card.test.js` — continua `ok` (domínio inalterado).

- [ ] **Step 5: Commit**

Não commitar.

---

### Task 3: Checkout Pix ou cartão

**Files:**
- Modify: `frontend/src/pages/Checkout.jsx` (`Payment`, `Confirmed`, default export)
- Modify: `frontend/src/App.jsx` (rota aguardando)
- Modify: `frontend/src/styles.css` (escolha de método)
- Test: `frontend/src/checkout.test.mjs`
- Test: `frontend/src/appmaxCard.test.mjs`

**Interfaces:**
- Consumes: `GET /api/orders/:id`, `POST /api/orders/:id/pix`, `POST /api/orders/:id/card`, `GET /api/orders/:id/installments`, `AppmaxCardForm`
- Produces: UI de método; `/checkout/:orderId/aguardando`; `/ok` só se `paid`

- [ ] **Step 1: Update failing frontend tests first**

Em `frontend/src/checkout.test.mjs` **trocar** as linhas que hoje proíbem cartão:

```js
assert.equal(checkout.includes('data-appmax-checkout'), false, 'sem form de cartão na fonte do Checkout (vive no AppmaxCardForm)');
assert.equal(checkout.includes('AppmaxCardForm'), true, 'pagamento usa AppmaxCardForm');
assert.equal(checkout.includes("'/card'"), true, 'POST cartão');
assert.equal(checkout.includes('/installments'), true, 'quote parcelas');
assert.equal(checkout.includes("method === 'pix'") || checkout.includes("'pix'"), true, 'escolhe Pix');
assert.equal(checkout.includes('Cartão') || checkout.includes('Cartao'), true, 'escolhe cartão');
assert.equal(checkout.includes('/aguardando'), true, 'aguardo cartão');
assert.equal(checkout.includes('prepareCardCharge'), false, 'front não chama o domínio');
assert.equal(listing.includes('AppmaxCardForm'), false, 'ficha sem cartão');
```

Manter: `Pagar e finalizar`, `Pague com Pix`, `8000`, `status === 'paid'`, `/minhas-compras` false, `cupom` false, `quantity: 1`, `Frete R$ 0,00 nesta fase`.

Em `frontend/src/appmaxCard.test.mjs`, depois dos asserts da ficha:

```js
const checkout = fs.readFileSync(path.join(dir, 'pages/Checkout.jsx'), 'utf8');
assert.equal(checkout.includes('AppmaxCardForm'), true, 'checkout tem form de cartão');
assert.equal(listing.includes('AppmaxCardForm'), false, 'ficha sem form de cartão');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/checkout.test.mjs src/appmaxCard.test.mjs` em `frontend/`

Expected: FAIL (`AppmaxCardForm` ausente no Checkout)

- [ ] **Step 3: Implement Payment + WaitPay**

No topo de `frontend/src/pages/Checkout.jsx`, importar:

```js
import AppmaxCardForm from '../AppmaxCardForm';
```

Substituir `Payment` para escolher método. Contrato:

- Estado `method` `'pix' | 'card'`, default `'pix'`.
- Pix: igual ao atual (CPF, IP, `POST .../pix`, navega `/pix`).
- Cartão: `AppmaxCardForm` com `visible`, `externalId`, `scriptUrl`, `onIp` (mesmo extract `payload.ip`), `onToken` guarda token, `onError` em `setErr`.
- CPF compartilhado. Parcelas: `useEffect` chama `GET /api/orders/${orderId}/installments` quando `method === 'card'`; se falhar ou lista vazia, select só `1`.
- Submit cartão: exige `payerIp`, `cardToken`, `docNumber`; `POST /api/orders/${orderId}/card` body `{ token, documentNumber, ip, holderName, installments }`. Se `charged.status === 'paid'` → `/ok`; senão → `/aguardando`.
- Sem IP: `Aguarde a verificação da Appmax (IP).`
- Não montar `AppmaxCardForm` no método Pix (evita dois `data-appmax-customer`). No Pix manter `<form data-appmax-customer hidden />` como hoje.
- CTA continua `Pagar e finalizar`.

Esboço da escolha e do submit cartão:

```js
const [method, setMethod] = useState('pix');
const [cardToken, setCardToken] = useState('');
const [installments, setInstallments] = useState(1);
const [installmentOpts, setInstallmentOpts] = useState([{ installment: 1 }]);

useEffect(() => {
  if (!user || !orderId || method !== 'card') return;
  api('/api/orders/' + orderId + '/installments')
    .then((d) => {
      const rows = d && Array.isArray(d.installments) ? d.installments : [];
      setInstallmentOpts(rows.length ? rows : [{ installment: 1 }]);
    })
    .catch(() => setInstallmentOpts([{ installment: 1 }]));
}, [user, orderId, method]);

async function pay(e) {
  e.preventDefault();
  setErr('');
  if (!payerIp) {
    setErr('Aguarde a verificação da Appmax (IP).');
    return;
  }
  setBusy(true);
  try {
    if (method === 'card') {
      if (!cardToken) {
        setErr('Preencha o cartão e aguarde a tokenização da Appmax.');
        setBusy(false);
        return;
      }
      const charged = await api('/api/orders/' + orderId + '/card', {
        method: 'POST',
        body: JSON.stringify({
          token: cardToken,
          documentNumber: docNumber,
          ip: payerIp,
          installments,
        }),
      });
      setOrder(charged);
      nav(charged.status === 'paid'
        ? '/checkout/' + orderId + '/ok'
        : '/checkout/' + orderId + '/aguardando');
    } else {
      const charged = await api('/api/orders/' + orderId + '/pix', {
        method: 'POST',
        body: JSON.stringify({ documentNumber: docNumber, ip: payerIp }),
      });
      setOrder(charged);
      nav('/checkout/' + orderId + '/pix');
    }
  } catch (ex) {
    setErr(ex.message);
  }
  setBusy(false);
}
```

Na marcação, dois botões/opções `Pix` e `Cartão`. Com `method === 'card'`:

```jsx
<AppmaxCardForm
  visible
  externalId={cfg.appmax && cfg.appmax.externalId}
  scriptUrl={cfg.appmax && cfg.appmax.scriptUrl}
  onIp={(ip) => setPayerIp(typeof ip === 'string' ? ip : '')}
  onToken={(token) => setCardToken(token || '')}
  onError={(e) => setErr((e && e.message) || 'Falha no cartão.')}
/>
```

O `onIp` do form já recebe string (AppmaxCardForm extrai `payload.ip`). Não passar objeto.

**WaitPay** (tela `/aguardando`):

```js
function WaitPay() {
  const { user } = useAuth();
  const { orderId } = useParams();
  const nav = useNavigate();
  const next = '/checkout/' + orderId + '/aguardando';
  const [order, setOrder] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!user || !orderId) return;
    api('/api/orders/' + orderId).then(setOrder).catch((e) => setErr(e.message));
  }, [user, orderId]);

  useEffect(() => {
    if (!order || !user) return undefined;
    if (['paid', 'expired', 'failed', 'cancelled', 'completed', 'refunded'].includes(order.status)) return undefined;
    const t = setInterval(() => {
      api('/api/orders/' + orderId).then(setOrder).catch(() => {});
    }, 8000);
    return () => clearInterval(t);
  }, [order && order.status, orderId, user]);

  useEffect(() => {
    if (order && order.status === 'paid') nav('/checkout/' + orderId + '/ok', { replace: true });
  }, [order, orderId, nav]);

  if (!user) return <NeedAuth next={next} />;

  return (
    <>
      <Top back title="Aguardando confirmação" />
      <div className="page ck-page">
        <Steps current="pay" />
        {err && <div className="error">{err}</div>}
        {!order && !err && <p className="hint">Carregando...</p>}
        {order && (
          <div className="ck-pix">
            <p className="ck-price">{centsMoney(order.totalCents)}</p>
            <p className={'ck-pix-status status-' + order.status}>{pixStatusLabel(order.status)}</p>
            <p className="hint">Pagamento com cartão enviado. A confirmação vem do banco. Não feche esta tela.</p>
          </div>
        )}
      </div>
    </>
  );
}
```

**Confirmed:** se `order && order.status !== 'paid'`:

```js
if (order && order.status !== 'paid') {
  const wait = order.paymentMethod === 'credit_card'
    ? '/checkout/' + orderId + '/aguardando'
    : '/checkout/' + orderId + '/pix';
  return <Navigate to={wait} replace />;
}
```

No resumo pago, método: `order.paymentMethod === 'credit_card' ? 'Cartão' : 'Pix'` (não fixar “· Pix”).

**Router** em `Checkout` default:

```js
if (loc.pathname.endsWith('/aguardando')) return 'wait';
```

```js
if (step === 'wait') return <WaitPay />;
```

Em `frontend/src/App.jsx`, junto das rotas de checkout:

```jsx
<Route path="/checkout/:orderId/aguardando" element={<Checkout />} />
```

CSS no fim de `frontend/src/styles.css`:

```css
.ck-methods { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px; }
.ck-method {
  background: var(--paper); border: 1px solid var(--line);
  border-radius: 14px; padding: 12px; font-weight: 700; text-align: center;
}
.ck-method.on { border-color: var(--brand); color: var(--brand); background: var(--brand-soft); }
```

- [ ] **Step 4: Run frontend tests and build**

Run em `frontend/`:

```bash
node --test src/*.test.mjs
npm run build
```

Expected: 4 testes `ok`; Vite `built` (chunk size warning ok).

Run em `backend/`:

```bash
node src/official.test.js
node src/orders.test.js
node src/orders.card.test.js
```

Expected: os três `OK`.

- [ ] **Step 5: Commit**

Não commitar. Relatar arquivos, testes e riscos. Esperar autorização.

---

## Fora desta entrega

Minhas compras, rastreio, cancel/reembolso, fotos reais, `commercialReady`, Appmax client, lista GET, PATCH, `Pay.jsx`, Vosk.

## Riscos residuais

- Cobrança **real** nos 5 (não só R$ 10).
- Quote de parcelas: fallback 1x se Appmax falhar.
- Pedido aberto com Pix trava cartão até cancelamento (fase futura).
- Tokenização: o botão nativo do `AppmaxCardForm` (“Pagar com cartão”) só tokeniza; o CTA Catira “Pagar e finalizar” envia o token. Se o usuário não submeter o form Appmax antes, o POST `/card` falha com o erro de token vazio.
- HTTP de cartão **não** mocka Appmax; testes cobrem 400/404/409. Cobrança feliz continua em `orders.card.test.js` com mock.

## Estimativa

Seed + rotas + Checkout cartão + testes + build: uma sessão. Sem commit até o usuário pedir.
