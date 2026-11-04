# Admin Appmax Sandbox Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O admin master grava Client ID, Client Secret e External ID da Appmax Sandbox pela aba Appmax; o Catira gera o token do webhook, persiste em `settings` e testa só o login OAuth.

**Architecture:** `appmax.js` passa a ler cada `USER_APPMAX_*` com merge por chave (env não vazio ganha; senão `settings` id `appmax`). Novas funções `publicAppmaxSettings`, `saveAppmaxSettings` e `testAuth` alimentam `GET/PUT /api/admin/appmax` (`masterRequired`). A rota de webhook usa o token efetivo. A aba Appmax em `Admin.jsx` replica o padrão do Resend (senha vazia = manter, hint mascarado).

**Tech Stack:** Node CommonJS, Express, SQLite `settings`, React/Vite. Testes `node src/*.test.js` (assert), fetch mock, zero rede real.

## Global Constraints

- Só master. Outro papel: 403. Sem login: 401.
- Persistência só em `settings` id `appmax`. Não editar `config.js`. Não gravar `.env`.
- Merge por chave: `process.env` trimmed não vazio ganha; senão o campo do banco.
- Ambiente fixo sandbox no formulário. `USER_APPMAX_ENV=production`/`prod` continua `describeConfig.env=invalid`.
- Token do webhook: `crypto.randomBytes(32).toString('hex')` na primeira gravação se banco e env estiverem vazios. Sem botão de rotacionar. Master não cola token.
- PUT grava primeiro; depois só `getAccessToken()`. Sem customers/orders/pagamentos.
- Login falhou: HTTP 200, chaves salvas, `authTest.ok=false`.
- Sem Client ID + Secret efetivo + External ID: 400, não grava.
- Secret vazio ou mascarado (`•`/`*`): mantém o atual.
- GET/PUT nunca devolvem `clientSecret` nem campo `webhookToken`. Token só dentro de `webhookUrl`.
- `webhookUrl`: `https://SEU-DOMINIO/api/appmax/webhooks/<TOKEN_EFETIVO>`. Sem domínio configurado: prefixo literal.
- Sem checkout público, Comprar, `commercialReady`, 2E, `AppmaxCardForm` na ficha, commit, secrets no chat.
- Testes: Appmax falsa. Sem chamada de rede real.
- Commit: pular, a menos que o usuário peça.

---

### Task 1: Merge env+banco e persistência `settings.appmax`

**Files:**
- Modify: `backend/src/appmax.js`
- Modify: `backend/src/appmax.test.js`

**Interfaces:**
- Consumes: `db.findOne` / `db.insert` / `db.update` em `settings`; `crypto.randomBytes`
- Produces:
  - `readCredential(env, key)` — env trimmed não vazio; senão campo do banco
  - `publicAppmaxSettings()` — JSON do GET (sem secret cru, sem campo `webhookToken`)
  - `saveAppmaxSettings(patch)` — grava linha `id: 'appmax'`; gera token se faltar; lança `status=400` se faltar os três
  - `testAuth(opts)` — `createClient({ fetch: opts.fetch }).getAccessToken()`
  - `effectiveWebhookToken()` — token efetivo (merge)
  - `publicConfig` / `describeConfig` / `credentialsOf` passam a usar o merge via `readCredential`

- [ ] **Step 1: Write the failing tests**

No final de `run()` em `backend/src/appmax.test.js`, antes do `console.log`, acrescente (e `const db = require('./db');` no topo):

```js
  const prevAppmaxEnv = {
    USER_APPMAX_CLIENT_ID: process.env.USER_APPMAX_CLIENT_ID,
    USER_APPMAX_CLIENT_SECRET: process.env.USER_APPMAX_CLIENT_SECRET,
    USER_APPMAX_EXTERNAL_ID: process.env.USER_APPMAX_EXTERNAL_ID,
    USER_APPMAX_WEBHOOK_TOKEN: process.env.USER_APPMAX_WEBHOOK_TOKEN,
  };
  function restoreAppmaxEnv() {
    Object.keys(prevAppmaxEnv).forEach((key) => {
      if (prevAppmaxEnv[key] === undefined) delete process.env[key];
      else process.env[key] = prevAppmaxEnv[key];
    });
  }
  function clearAppmaxRow() {
    const row = db.findById('settings', 'appmax');
    if (row) db.remove('settings', 'appmax');
  }

  try {
    delete process.env.USER_APPMAX_CLIENT_ID;
    delete process.env.USER_APPMAX_CLIENT_SECRET;
    delete process.env.USER_APPMAX_EXTERNAL_ID;
    delete process.env.USER_APPMAX_WEBHOOK_TOKEN;
    clearAppmaxRow();

    const emptyPublic = appmax.publicAppmaxSettings();
    assert.strictEqual(emptyPublic.clientId, '');
    assert.strictEqual(emptyPublic.clientSecretSet, false);
    assert.strictEqual(emptyPublic.externalId, '');
    assert.strictEqual(emptyPublic.webhookConfigured, false);
    assert.strictEqual(emptyPublic.webhookUrl, '');
    assert.ok(!('clientSecret' in emptyPublic), 'GET sem clientSecret');
    assert.ok(!('webhookToken' in emptyPublic), 'GET sem webhookToken');
    assert.strictEqual(emptyPublic.source.clientId, 'absent');
    assert.strictEqual(emptyPublic.env, 'sandbox');

    let saveErr;
    try {
      appmax.saveAppmaxSettings({ clientId: 'id-only', clientSecret: '', externalId: 'ext-1' });
    } catch (e) { saveErr = e; }
    assert.ok(saveErr, 'faltou secret');
    assert.strictEqual(saveErr.status, 400);
    assert.strictEqual(db.findById('settings', 'appmax'), null, '400 não grava');

    const saved = appmax.saveAppmaxSettings({
      clientId: 'merchant-from-db',
      clientSecret: SECRET,
      externalId: 'ext-from-db',
    });
    assert.strictEqual(saved.clientId, 'merchant-from-db');
    assert.ok(saved.webhookToken && saved.webhookToken.length >= 32, 'token gerado');
    assert.match(saved.webhookToken, /^[0-9a-f]+$/);

    const pub = appmax.publicAppmaxSettings();
    assert.strictEqual(pub.clientId, 'merchant-from-db');
    assert.strictEqual(pub.externalId, 'ext-from-db');
    assert.strictEqual(pub.clientSecretSet, true);
    assert.ok(pub.clientSecretHint.includes('••••'));
    assert.ok(!JSON.stringify(pub).includes(SECRET), 'hint não vaza secret');
    assert.ok(!('webhookToken' in pub));
    assert.ok(pub.webhookUrl.startsWith('https://SEU-DOMINIO/api/appmax/webhooks/'));
    assert.ok(pub.webhookUrl.endsWith(saved.webhookToken));
    assert.strictEqual(pub.source.clientId, 'settings');
    assert.strictEqual(pub.source.clientSecret, 'settings');
    assert.strictEqual(pub.source.externalId, 'settings');
    assert.strictEqual(pub.source.webhookToken, 'settings');

    const kept = appmax.saveAppmaxSettings({
      clientId: 'merchant-from-db',
      clientSecret: '',
      externalId: 'ext-from-db',
    });
    assert.strictEqual(kept.clientSecret, SECRET, 'vazio mantém secret');
    const masked = appmax.saveAppmaxSettings({
      clientId: 'merchant-from-db',
      clientSecret: pub.clientSecretHint,
      externalId: 'ext-2',
    });
    assert.strictEqual(masked.clientSecret, SECRET, 'mascarado mantém secret');
    assert.strictEqual(masked.externalId, 'ext-2');
    assert.strictEqual(masked.webhookToken, saved.webhookToken, 'não rotaciona');

    const describedDb = appmax.describeConfig({
      USER_APPMAX_CLIENT_ID: '',
      USER_APPMAX_CLIENT_SECRET: '',
      USER_APPMAX_EXTERNAL_ID: '',
      USER_APPMAX_WEBHOOK_TOKEN: '',
    });
    assert.strictEqual(describedDb.clientId, 'configured');
    assert.strictEqual(describedDb.clientSecret, 'configured');
    assert.strictEqual(describedDb.externalId, 'configured');
    assert.strictEqual(describedDb.webhookToken, 'configured');
    assert.ok(!JSON.stringify(describedDb).includes(SECRET));

    const pubCfg = appmax.publicConfig({ USER_APPMAX_EXTERNAL_ID: '' });
    assert.strictEqual(pubCfg.externalId, 'ext-2');
    assert.strictEqual(pubCfg.env, 'sandbox');

    process.env.USER_APPMAX_CLIENT_ID = 'env-client';
    process.env.USER_APPMAX_CLIENT_SECRET = 'env-secret-value-xxxx';
    process.env.USER_APPMAX_EXTERNAL_ID = 'env-ext';
    process.env.USER_APPMAX_WEBHOOK_TOKEN = 'env-webhook-token';
    const sourced = appmax.publicAppmaxSettings();
    assert.strictEqual(sourced.source.clientId, 'env');
    assert.strictEqual(sourced.source.clientSecret, 'env');
    assert.strictEqual(sourced.source.externalId, 'env');
    assert.strictEqual(sourced.source.webhookToken, 'env');
    assert.strictEqual(sourced.clientId, 'merchant-from-db', 'form mostra o banco');
    assert.ok(sourced.webhookUrl.endsWith('env-webhook-token'), 'URL usa token efetivo');
    assert.ok(!JSON.stringify(sourced).includes('env-secret-value-xxxx'));

    const tokenOk = await appmax.testAuth({
      fetch: mockFetch((entry) => tokenHandler(entry)),
    });
    assert.strictEqual(tokenOk, TOKEN);

    let authErr;
    try {
      await appmax.testAuth({
        fetch: mockFetch(() => jsonResponse(401, { error: 'invalid_client' })),
      });
    } catch (e) { authErr = e; }
    assert.ok(authErr);
    assert.match(String(authErr.message), /401/);
    assert.ok(!JSON.stringify(authErr).includes(SECRET));
  } finally {
    clearAppmaxRow();
    restoreAppmaxEnv();
  }
```

Ajuste `tokenHandler` para não exigir `client_id=merchant-client-id` quando o body vier do banco/env de teste: extraia a asserção de `client_id` para os testes antigos, ou aceite qualquer `client_id` presente. Os testes antigos de `createClient` continuam passando `env({...})` com `merchant-client-id`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/backend && node src/appmax.test.js`

Expected: FAIL (`publicAppmaxSettings is not a function` ou equivalente).

- [ ] **Step 3: Write minimal implementation**

Em `backend/src/appmax.js`:

1. `const { randomBytes } = require('crypto');` e `const db = require('./db');`
2. Mapa:

```js
const CREDENTIAL_FIELDS = {
  USER_APPMAX_CLIENT_ID: 'clientId',
  USER_APPMAX_CLIENT_SECRET: 'clientSecret',
  USER_APPMAX_EXTERNAL_ID: 'externalId',
  USER_APPMAX_WEBHOOK_TOKEN: 'webhookToken',
};
```

3. `hintKey` / `looksMasked` iguais a `mail.js`.
4. `emptyStored()` → `{ id: 'appmax', clientId: '', clientSecret: '', externalId: '', webhookToken: '' }`.
5. `getStored()` → `db.findOne('settings', (s) => s.id === 'appmax')` mesclado com `emptyStored()`.
6. `readEnvOnly(env, key)` → só o objeto `env` (ou `process.env`), trimmed.
7. Trocar `readCredential` para: se `readEnvOnly` não vazio, retorna; senão `getStored()[CREDENTIAL_FIELDS[key]]`.
8. `credentialSource(key)`: env não vazio → `'env'`; banco não vazio → `'settings'`; senão `'absent'`. Sempre olha `process.env` para a fonte (não o `env` injetado dos testes de client), **exceto** que `describeConfig(env)` continua presença via `readCredential(env, key)` (merge env-arg + banco).
9. `effectiveWebhookToken()` → `readCredential(process.env, 'USER_APPMAX_WEBHOOK_TOKEN')`.
10. `publicAppmaxSettings()` conforme o spec (clientId/externalId do **banco**; webhookUrl/webhookConfigured do token **efetivo**; `env` de `describeConfig()`; `source` via `credentialSource`).
11. `saveAppmaxSettings(patch)`:
    - secret novo só se trimmed e `!looksMasked`
    - se `!next.clientId || !next.clientSecret || !next.externalId` → `httpError(400, 'Informe Client ID, Client Secret e External ID.')`
    - se `!next.webhookToken && !readEnvOnly(process.env, 'USER_APPMAX_WEBHOOK_TOKEN')` → `next.webhookToken = randomBytes(32).toString('hex')`
    - insert ou update `settings` / `'appmax'`
12. `async function testAuth(opts)` → `createClient({ fetch: opts && opts.fetch }).getAccessToken()`.
13. Exportar `publicAppmaxSettings`, `saveAppmaxSettings`, `testAuth`, `effectiveWebhookToken`.

Não alterar URLs sandbox/production. Não logar secret.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /workspace/backend && node src/appmax.test.js`

Expected: `appmax.test.js ok`

- [ ] **Step 5: Commit**

Pular (usuário não pediu commit).

---

### Task 2: Rotas admin GET/PUT e webhook com token efetivo

**Files:**
- Create: `backend/src/appmax.admin.test.js`
- Modify: `backend/src/routes/admin.js`
- Modify: `backend/src/routes/appmaxWebhooks.js`
- Modify: `backend/package.json` (script `test` inclui `node src/appmax.admin.test.js` depois de `appmax.test.js`)

**Interfaces:**
- Consumes: `publicAppmaxSettings`, `saveAppmaxSettings`, `testAuth`, `effectiveWebhookToken`, `masterRequired`
- Produces: `GET /api/admin/appmax`, `PUT /api/admin/appmax`; webhook compara token efetivo

- [ ] **Step 1: Write the failing HTTP test**

Criar `backend/src/appmax.admin.test.js`:

```js
const assert = require('assert');
const http = require('http');
const express = require('express');
const db = require('./db');
const appmax = require('./appmax');
const { authOptional, signToken } = require('./middleware');

const SECRET = 'super-secret-appmax-client-secret-do-not-leak';

function jsonRequest(server, { method, path: urlPath, token, body }) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: urlPath,
        method: method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          let parsed = null;
          try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get() { return 'application/json'; } },
    async json() { return body; },
  };
}

async function run() {
  const master = db.findOne('users', (u) => u.role === 'master');
  assert.ok(master, 'seed master');
  const adminUser = db.insert('users', {
    name: 'Admin comum',
    email: 'admin-comum-appmax@test.local',
    role: 'admin',
    status: 'active',
    passwordHash: 'x',
  });
  const masterTok = signToken(master);
  const adminTok = signToken(adminUser);

  const prev = {
    USER_APPMAX_CLIENT_ID: process.env.USER_APPMAX_CLIENT_ID,
    USER_APPMAX_CLIENT_SECRET: process.env.USER_APPMAX_CLIENT_SECRET,
    USER_APPMAX_EXTERNAL_ID: process.env.USER_APPMAX_EXTERNAL_ID,
    USER_APPMAX_WEBHOOK_TOKEN: process.env.USER_APPMAX_WEBHOOK_TOKEN,
  };
  const origFetch = global.fetch;
  const ids = { users: [adminUser.id] };

  function restoreEnv() {
    Object.keys(prev).forEach((key) => {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    });
  }

  delete process.env.USER_APPMAX_CLIENT_ID;
  delete process.env.USER_APPMAX_CLIENT_SECRET;
  delete process.env.USER_APPMAX_EXTERNAL_ID;
  delete process.env.USER_APPMAX_WEBHOOK_TOKEN;
  if (db.findById('settings', 'appmax')) db.remove('settings', 'appmax');

  const app = express();
  app.use(express.json());
  app.use(authOptional);
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api/appmax/webhooks', require('./routes/appmaxWebhooks'));
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || 'Erro interno.' });
  });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  try {
    const anon = await jsonRequest(server, { path: '/api/admin/appmax' });
    assert.strictEqual(anon.status, 401);

    const asAdmin = await jsonRequest(server, { path: '/api/admin/appmax', token: adminTok });
    assert.strictEqual(asAdmin.status, 403);

    const asMasterGet = await jsonRequest(server, { path: '/api/admin/appmax', token: masterTok });
    assert.strictEqual(asMasterGet.status, 200);
    assert.strictEqual(asMasterGet.body.clientSecretSet, false);
    assert.ok(!('clientSecret' in asMasterGet.body));
    assert.ok(!('webhookToken' in asMasterGet.body));

    const bad = await jsonRequest(server, {
      method: 'PUT',
      path: '/api/admin/appmax',
      token: masterTok,
      body: { clientId: 'only-id', clientSecret: '', externalId: 'ext' },
    });
    assert.strictEqual(bad.status, 400);
    assert.strictEqual(db.findById('settings', 'appmax'), null);

    let fetchCalls = 0;
    global.fetch = async (url, init) => {
      fetchCalls += 1;
      assert.ok(String(url).includes('auth.sandboxappmax.com.br'));
      const body = String(init && init.body);
      assert.match(body, /client_id=id-ok/);
      assert.ok(!body.includes(SECRET) === false);
      return jsonResponse(200, { access_token: 'tok-ok', expires_in: 3600 });
    };

    const ok = await jsonRequest(server, {
      method: 'PUT',
      path: '/api/admin/appmax',
      token: masterTok,
      body: { clientId: 'id-ok', clientSecret: SECRET, externalId: 'ext-ok' },
    });
    assert.strictEqual(ok.status, 200, 'gravou mesmo após auth');
    assert.strictEqual(ok.body.authTest.ok, true);
    assert.ok(ok.body.webhookUrl.includes('/api/appmax/webhooks/'));
    assert.ok(!JSON.stringify(ok.body).includes(SECRET));
    assert.ok(!('webhookToken' in ok.body));
    assert.ok(fetchCalls >= 1, 'testou OAuth');
    const row = db.findById('settings', 'appmax');
    assert.ok(row && row.webhookToken);

    const keep = await jsonRequest(server, {
      method: 'PUT',
      path: '/api/admin/appmax',
      token: masterTok,
      body: { clientId: 'id-ok', clientSecret: '', externalId: 'ext-ok' },
    });
    assert.strictEqual(keep.status, 200);
    assert.strictEqual(db.findById('settings', 'appmax').clientSecret, SECRET);

    global.fetch = async () => jsonResponse(401, { error: 'invalid_client' });
    const failAuth = await jsonRequest(server, {
      method: 'PUT',
      path: '/api/admin/appmax',
      token: masterTok,
      body: { clientId: 'id-ok', clientSecret: 'wrong-secret-xxxx', externalId: 'ext-ok' },
    });
    assert.strictEqual(failAuth.status, 200, 'login falho ainda grava');
    assert.strictEqual(failAuth.body.authTest.ok, false);
    assert.match(String(failAuth.body.authTest.error), /401/);
    assert.ok(!JSON.stringify(failAuth.body).includes('wrong-secret-xxxx'));
    assert.strictEqual(db.findById('settings', 'appmax').clientSecret, 'wrong-secret-xxxx');

    const token = db.findById('settings', 'appmax').webhookToken;
    const denied = await jsonRequest(server, {
      method: 'POST',
      path: '/api/appmax/webhooks/wrong-token',
      body: {},
    });
    assert.strictEqual(denied.status, 404);

    const hooked = await jsonRequest(server, {
      method: 'POST',
      path: '/api/appmax/webhooks/' + token,
      body: {},
    });
    assert.strictEqual(hooked.status, 200);
  } finally {
    await new Promise((r) => server.close(r));
    global.fetch = origFetch;
    restoreEnv();
    if (db.findById('settings', 'appmax')) db.remove('settings', 'appmax');
    ids.users.forEach((id) => db.remove('users', id));
  }

  console.log('appmax.admin.test.js ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Corrija a asserção confusa `assert.ok(!body.includes(SECRET) === false)` para `assert.ok(body.includes(SECRET))` no fetch mock do PUT de sucesso — o secret **vai** no form-urlencoded da Appmax, mas **não** na resposta HTTP do admin.

No `package.json` do backend, o script `test` ainda **não** inclui este arquivo neste step (ele entra no Step 3). Rodar o arquivo direto.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/backend && node src/appmax.admin.test.js`

Expected: FAIL (404 em `/api/admin/appmax` ou webhook ainda só lê env).

- [ ] **Step 3: Implement routes**

`backend/src/routes/admin.js` — import:

```js
const { publicAppmaxSettings, saveAppmaxSettings, testAuth } = require('../appmax');
```

Depois das rotas de mail/assistant:

```js
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
```

`backend/src/routes/appmaxWebhooks.js` — trocar `configuredToken`:

```js
const { effectiveWebhookToken } = require('../appmax');

function configuredToken() {
  return effectiveWebhookToken();
}
```

`backend/package.json` script `test`: inserir `node src/appmax.admin.test.js` imediatamente após `node src/appmax.test.js`.

- [ ] **Step 4: Run tests**

Run: `cd /workspace/backend && node src/appmax.admin.test.js && node src/appmax.test.js && node src/orders.webhook.test.js`

Expected: os três imprimem `ok`. Webhook antigo ainda seta `process.env.USER_APPMAX_WEBHOOK_TOKEN`, então env continua ganhando.

- [ ] **Step 5: Commit**

Pular.

---

### Task 3: Aba Appmax no admin master

**Files:**
- Modify: `frontend/src/pages/Admin.jsx`

**Interfaces:**
- Consumes: `GET/PUT /api/admin/appmax` (mesmo contrato da Task 2)
- Produces: aba `appmax` só se `isMaster`

- [ ] **Step 1: State + load**

Junto dos states de mail:

```js
const [appmaxCfg, setAppmaxCfg] = useState({
  clientId: '',
  clientSecret: '',
  clientSecretSet: false,
  clientSecretHint: '',
  externalId: '',
  webhookConfigured: false,
  webhookUrl: '',
  env: 'sandbox',
  source: {},
});
const [appmaxMsg, setAppmaxMsg] = useState('');
const [appmaxErr, setAppmaxErr] = useState('');
```

No `useEffect` master, depois do mail:

```js
api('/api/admin/appmax').then((d) => setAppmaxCfg({ ...d, clientSecret: '' })).catch(() => {});
```

No array de chips master, depois de PIX:

```js
['dash', 'Dashboard'], ['pix', 'PIX'], ['appmax', 'Appmax'], ['mail', 'E-mail'],
```

(o restante da lista atual permanece igual)

- [ ] **Step 2: Form**

Depois do bloco `{tab === 'pix' && isMaster && (` … `)}`, antes de mail:

```jsx
        {tab === 'appmax' && isMaster && (
          <>
            <h2 style={{ fontSize: 18, margin: '8px 0 12px' }}>Appmax (Sandbox)</h2>
            <p className="lead">Cole Client ID, Client Secret e External ID do painel Merchant da Appmax Sandbox. O Catira gera o token do webhook. Não use produção nesta fase.</p>
            {appmaxErr && <div className="error">{appmaxErr}</div>}
            {appmaxMsg && <div className="okbox">{appmaxMsg}</div>}
            <form className="filters" onSubmit={async (e) => {
              e.preventDefault();
              setAppmaxErr('');
              setAppmaxMsg('');
              try {
                const body = {
                  clientId: appmaxCfg.clientId,
                  externalId: appmaxCfg.externalId,
                };
                if (appmaxCfg.clientSecret && appmaxCfg.clientSecret.trim()) body.clientSecret = appmaxCfg.clientSecret.trim();
                const d = await api('/api/admin/appmax', { method: 'PUT', body: JSON.stringify(body) });
                setAppmaxCfg({ ...d, clientSecret: '' });
                if (d.authTest && d.authTest.ok) setAppmaxMsg('Login na Sandbox ok.');
                else setAppmaxMsg((d.authTest && d.authTest.error) || 'Configuração salva, mas o login na Sandbox falhou.');
              } catch (ex) {
                setAppmaxErr(ex.message);
              }
            }}>
              <div className="field">
                <label>Client ID</label>
                <input
                  value={appmaxCfg.clientId || ''}
                  onChange={(e) => setAppmaxCfg({ ...appmaxCfg, clientId: e.target.value })}
                  autoComplete="off"
                />
              </div>
              <div className="field">
                <label>Client Secret</label>
                <input
                  type="password"
                  value={appmaxCfg.clientSecret || ''}
                  onChange={(e) => setAppmaxCfg({ ...appmaxCfg, clientSecret: e.target.value })}
                  placeholder={appmaxCfg.clientSecretHint || ''}
                  autoComplete="off"
                />
                <div className="hint">{appmaxCfg.clientSecretSet ? 'Secret salvo: ' + appmaxCfg.clientSecretHint + '. Deixe em branco para manter.' : 'Copie no painel Merchant da Appmax Sandbox.'}</div>
              </div>
              <div className="field">
                <label>External ID</label>
                <input
                  value={appmaxCfg.externalId || ''}
                  onChange={(e) => setAppmaxCfg({ ...appmaxCfg, externalId: e.target.value })}
                  autoComplete="off"
                />
              </div>
              <button className="btn btn-primary">Salvar Appmax</button>
            </form>
            {appmaxCfg.webhookUrl ? (
              <div className="field">
                <label>URL do webhook (cole no painel Appmax Sandbox)</label>
                <input readOnly value={appmaxCfg.webhookUrl} />
                <div className="hint">Troque SEU-DOMINIO pelo endereço HTTPS público quando existir. Localhost a Appmax não alcança.</div>
              </div>
            ) : null}
            <p className="hint">
              Client ID: {appmaxCfg.clientId ? 'salvo' : 'faltando'}.
              Secret: {appmaxCfg.clientSecretSet ? 'salvo' : 'faltando'}.
              External ID: {appmaxCfg.externalId ? 'salvo' : 'faltando'}.
              Webhook: {appmaxCfg.webhookConfigured ? 'salvo' : 'faltando'}.
            </p>
          </>
        )}
```

Sem campo de ambiente. Sem campo de token. Sem comentários. Não mostrar `source` (YAGNI na UI).

- [ ] **Step 3: Build**

Run: `cd /workspace/frontend && npm run build`

Expected: build OK.

- [ ] **Step 4: Commit**

Pular.

---

### Task 4: Verificação completa

**Files:** nenhum novo

- [ ] **Step 1: Backend tests**

Run: `cd /workspace/backend && npm test`

Expected: todos os arquivos do script (incluindo `appmax.admin.test.js`) imprimem `ok`; exit 0.

- [ ] **Step 2: Frontend build**

Run: `cd /workspace/frontend && npm run build`

Expected: exit 0.

- [ ] **Step 3: Não avançar**

Não ligar checkout público. Não chamar Appmax de verdade fora do `testAuth` do PUT. Não commit.

---
