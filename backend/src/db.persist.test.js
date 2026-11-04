const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ORIGINAL_JSON = path.join(__dirname, '..', 'data', 'db.json');
const originalStat = fs.existsSync(ORIGINAL_JSON) ? fs.statSync(ORIGINAL_JSON) : null;
const originalJson = originalStat ? fs.readFileSync(ORIGINAL_JSON) : null;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'catira-2d01-'));
const jsonPath = path.join(tmp, 'db.json');
const sqlitePath = path.join(tmp, 'catira.sqlite');
const backupDir = path.join(tmp, 'backups');

const fixture = {
  users: [{ id: 'u1', name: 'Ada', email: 'ada@example.com' }],
  listings: [{ id: 'l1', title: 'Furadeira', userId: 'u1', price: 10 }],
};
fs.writeFileSync(jsonPath, JSON.stringify(fixture, null, 2));
const fixtureRaw = fs.readFileSync(jsonPath);

process.env.CATIRA_JSON_PATH = jsonPath;
process.env.CATIRA_SQLITE_PATH = sqlitePath;
process.env.CATIRA_BACKUP_DIR = backupDir;

const db = require('./db');

function assertOriginalUntouched() {
  if (!originalStat) return;
  const now = fs.statSync(ORIGINAL_JSON);
  assert.strictEqual(now.size, originalStat.size, 'db.json original não mudou de tamanho');
  assert.strictEqual(now.mtimeMs, originalStat.mtimeMs, 'db.json original não foi reescrito');
  assert.ok(fs.readFileSync(ORIGINAL_JSON).equals(originalJson), 'db.json original intacto');
}

function run() {
  assert.strictEqual(db.JSON_FILE, jsonPath, 'JSON_FILE isolado');
  assert.strictEqual(db.SQLITE_FILE, sqlitePath, 'SQLITE_FILE isolado');
  assert.strictEqual(db.BACKUP_DIR, backupDir, 'BACKUP_DIR isolado');
  assert.ok(fs.existsSync(sqlitePath), 'sqlite criado');
  assert.strictEqual(fs.readFileSync(jsonPath).equals(fixtureRaw), true, 'json de origem não reescrito na carga');

  assert.strictEqual(db.findById('users', 'u1').name, 'Ada', 'importou users do json');
  assert.strictEqual(db.findById('listings', 'l1').title, 'Furadeira', 'importou listings do json');
  assert.ok(Array.isArray(db.all('payments')), 'tabelas vazias existem após merge');

  db.insert('users', { id: 'u2', name: 'Bob' });
  assert.strictEqual(db.findById('users', 'u2').name, 'Bob');
  assert.ok(fs.readFileSync(jsonPath).equals(fixtureRaw), 'insert não grava db.json');

  const updated = db.update('users', 'u2', { name: 'Robert' });
  assert.strictEqual(updated.name, 'Robert');
  db.remove('users', 'u2');
  assert.strictEqual(db.findById('users', 'u2'), null);

  const before = db.count('users');
  let threw = false;
  try {
    db.batch(() => {
      db.insert('users', { id: 'u-rollback', name: 'Ghost' });
      assert.ok(db.findById('users', 'u-rollback'));
      throw new Error('boom');
    });
  } catch (err) {
    threw = err.message === 'boom';
  }
  assert.ok(threw, 'batch propaga o erro');
  assert.strictEqual(db.count('users'), before, 'rollback restaura contagem');
  assert.strictEqual(db.findById('users', 'u-rollback'), null, 'rollback remove inserção da memória');

  db.batch(() => {
    db.insert('users', { id: 'u3', name: 'Cara' });
    db.update('listings', 'l1', { price: 99 });
  });
  assert.strictEqual(db.findById('users', 'u3').name, 'Cara');
  assert.strictEqual(db.findById('listings', 'l1').price, 99);

  db.reload();
  assert.strictEqual(db.findById('users', 'u1').name, 'Ada', 'reload lê sqlite');
  assert.strictEqual(db.findById('users', 'u3').name, 'Cara', 'commit sobreviveu ao reload');
  assert.strictEqual(db.findById('listings', 'l1').price, 99);
  assert.strictEqual(db.findById('users', 'u-rollback'), null, 'rollback não persistiu');
  assert.ok(fs.readFileSync(jsonPath).equals(fixtureRaw), 'json intacto após reload');

  const order = db.insert('orders', {
    id: 'o1',
    status: 'draft',
    unitPriceCents: 13550,
    totalCents: 27100,
    quantity: 2,
    productSnapshot: { title: 'Furadeira' },
  }, { allowOrderWrite: true });
  db.insert('orderItems', {
    id: 'oi1',
    orderId: order.id,
    unitPriceCents: 13550,
    lineTotalCents: 27100,
  }, { allowOrderWrite: true });
  db.insert('orderEvents', {
    id: 'oe1',
    orderId: order.id,
    type: 'order.created',
  }, { allowOrderWrite: true });
  db.close();
  db.reload();
  assert.strictEqual(db.findById('orders', 'o1').unitPriceCents, 13550, 'pedido reabre do sqlite');
  assert.strictEqual(db.findById('orderItems', 'oi1').orderId, 'o1');
  assert.strictEqual(db.findById('orderEvents', 'oe1').type, 'order.created');
  assert.strictEqual(db.findById('orders', 'o1').productSnapshot.title, 'Furadeira');

  const backup = db.backupNow();
  assert.ok(backup && fs.existsSync(backup), 'backupNow gera arquivo');
  assert.ok(backup.startsWith(backupDir), 'backup fica no diretório configurado');
  assert.ok(fs.readdirSync(backupDir).length >= 1, 'há pelo menos um backup');
  assert.strictEqual(db.ensureDailyBackup(), null, 'backup recente evita cópia extra');

  assertOriginalUntouched();
  db.close();
  assertOriginalUntouched();
  console.log('db.persist.test.js ok');
}

run();
