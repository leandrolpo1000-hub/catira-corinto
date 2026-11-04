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
      assert.ok(String(url).includes('auth.appmax.com.br'));
      assert.ok(!String(url).includes('sandboxappmax'));
      const body = String(init && init.body);
      assert.match(body, /client_id=id-ok/);
      assert.ok(body.includes(SECRET));
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
