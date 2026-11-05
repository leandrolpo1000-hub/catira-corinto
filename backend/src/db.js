const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { DatabaseSync } = require('node:sqlite');

function isTestEntrypoint() {
  const main = require.main && require.main.filename;
  return !!(main && /\.test\.js$/.test(main));
}

const DATA_DIR = process.env.CATIRA_DATA_DIR || path.join(__dirname, '..', 'data');
const JSON_FILE = process.env.CATIRA_JSON_PATH || path.join(DATA_DIR, 'db.json');
const SQLITE_FILE = process.env.CATIRA_SQLITE_PATH
  || (isTestEntrypoint()
    ? path.join(os.tmpdir(), 'catira-test-' + process.pid + '-' + Date.now() + '.sqlite')
    : path.join(DATA_DIR, 'catira.sqlite'));
const BACKUP_DIR = process.env.CATIRA_BACKUP_DIR
  || (isTestEntrypoint()
    ? path.join(os.tmpdir(), 'catira-test-backups-' + process.pid)
    : path.join(DATA_DIR, 'backups'));

const EMPTY = {
  users: [],
  categories: [],
  listings: [],
  listingImages: [],
  payments: [],
  favorites: [],
  messages: [],
  conversations: [],
  tradeProposals: [],
  reports: [],
  reviews: [],
  listingReviews: [],
  blocks: [],
  passwordResets: [],
  emailVerifications: [],
  cities: [],
  settings: [],
  promoCodes: [],
  alerts: [],
  auctions: [],
  auctionEditions: [],
  auctionImages: [],
  auctionBids: [],
  auctionWatchers: [],
  auctionWinners: [],
  auctionPayments: [],
  auctionPenalties: [],
  auctionReputation: [],
  auctionPoints: [],
  auctionBadges: [],
  auctionAchievements: [],
  auctionNotifications: [],
  auctionAdminLogs: [],
  dealerApplications: [],
  dealerProfiles: [],
  opportunities: [],
  opportunityOffers: [],
  opportunityInterests: [],
  opportunityEvents: [],
  actionPosts: [],
  actionPostImages: [],
  actionPostLikes: [],
  actionPostComments: [],
  actionCommentLikes: [],
  actionNotifications: [],
  listingLikes: [],
  listingComments: [],
  listingCommentLikes: [],
  listingNotifications: [],
  messageReactions: [],
  messageStars: [],
  officialProducts: [],
  officialProductOffers: [],
  officialAdminLogs: [],
  meliAuth: [],
  meliOauthStates: [],
  orders: [],
  orderItems: [],
  orderEvents: [],
  checkoutSessions: [],
  userAddresses: [],
  intelligenceEvents: [],
  intelligenceDaily: [],
};

let sqlite = null;
let stmts = null;
let cache = null;
let batchDepth = 0;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sqlPath(filePath) {
  return String(filePath).replace(/'/g, "''");
}

function openSqlite() {
  if (sqlite) return;
  ensureDir(path.dirname(SQLITE_FILE));
  sqlite = new DatabaseSync(SQLITE_FILE);
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA synchronous = NORMAL');
  sqlite.exec('PRAGMA busy_timeout = 5000');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS records (
      table_name TEXT NOT NULL,
      id TEXT NOT NULL,
      json TEXT NOT NULL,
      PRIMARY KEY (table_name, id)
    )
  `);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  stmts = {
    upsert: sqlite.prepare(
      'INSERT INTO records (table_name, id, json) VALUES (?, ?, ?) ON CONFLICT(table_name, id) DO UPDATE SET json = excluded.json'
    ),
    remove: sqlite.prepare('DELETE FROM records WHERE table_name = ? AND id = ?'),
    all: sqlite.prepare('SELECT table_name, json FROM records'),
    count: sqlite.prepare('SELECT COUNT(*) AS c FROM records'),
    setMeta: sqlite.prepare(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ),
    getMeta: sqlite.prepare('SELECT value FROM meta WHERE key = ?'),
    clear: sqlite.prepare('DELETE FROM records'),
  };
}

function persistRow(table, rec) {
  openSqlite();
  stmts.upsert.run(table, String(rec.id), JSON.stringify(rec));
}

function persistDelete(table, id) {
  openSqlite();
  stmts.remove.run(table, String(id));
}

function writeAll(data) {
  openSqlite();
  stmts.clear.run();
  Object.keys(data).forEach((table) => {
    const list = data[table] || [];
    for (let i = 0; i < list.length; i++) {
      const rec = list[i];
      if (!rec || rec.id == null) continue;
      stmts.upsert.run(table, String(rec.id), JSON.stringify(rec));
    }
  });
}

function loadFromSqlite() {
  openSqlite();
  const data = structuredClone(EMPTY);
  const rows = stmts.all.all();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rec = JSON.parse(row.json);
    if (!data[row.table_name]) data[row.table_name] = [];
    data[row.table_name].push(rec);
  }
  return data;
}

function readJsonFile() {
  if (!fs.existsSync(JSON_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function copyJsonBackup() {
  if (!fs.existsSync(JSON_FILE)) return null;
  ensureDir(BACKUP_DIR);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(BACKUP_DIR, 'db.json.pre-sqlite-' + stamp);
  fs.copyFileSync(JSON_FILE, dest);
  const stable = path.join(BACKUP_DIR, 'db.json.pre-sqlite');
  if (!fs.existsSync(stable)) fs.copyFileSync(JSON_FILE, stable);
  return dest;
}

function maybeImportJson() {
  openSqlite();
  const count = Number(stmts.count.get().c || 0);
  if (count > 0) return false;
  const data = readJsonFile();
  if (!data) return false;
  copyJsonBackup();
  const merged = { ...structuredClone(EMPTY), ...data };
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    writeAll(merged);
    stmts.setMeta.run('imported_from_json_at', new Date().toISOString());
    sqlite.exec('COMMIT');
  } catch (err) {
    sqlite.exec('ROLLBACK');
    throw err;
  }
  return true;
}

function boot() {
  ensureDir(DATA_DIR);
  openSqlite();
  maybeImportJson();
  cache = loadFromSqlite();
}

function persist(opts) {
  if (batchDepth > 0) return;
  if (!(opts && opts.allowOrderWrite)) {
    throw persistConflict('Pedidos só mudam pelo domínio.');
  }
  openSqlite();
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    writeAll(cache);
    sqlite.exec('COMMIT');
  } catch (err) {
    try { sqlite.exec('ROLLBACK'); } catch {}
    throw err;
  }
}

function batch(fn) {
  openSqlite();
  batchDepth += 1;
  const isOuter = batchDepth === 1;
  let snapshot;
  if (isOuter) {
    snapshot = structuredClone(cache);
    sqlite.exec('BEGIN IMMEDIATE');
  }
  try {
    const result = fn();
    batchDepth -= 1;
    if (isOuter) sqlite.exec('COMMIT');
    return result;
  } catch (err) {
    batchDepth -= 1;
    if (isOuter) {
      try { sqlite.exec('ROLLBACK'); } catch {}
      cache = snapshot;
    }
    throw err;
  }
}

function all(table) {
  const rows = cache[table] || [];
  if (!isProtectedTable(table)) return rows;
  return rows.map((row) => structuredClone(row));
}

function findById(table, id) {
  return all(table).find((r) => r.id === id) || null;
}

function findWhere(table, pred) {
  return all(table).filter(pred);
}

function findOne(table, pred) {
  return all(table).find(pred) || null;
}

const PROTECTED_TABLES = [
  'orders',
  'orderItems',
  'orderEvents',
  'checkoutSessions',
  'userAddresses',
];
const ORDER_SNAPSHOT_KEYS = [
  'unitPriceCents',
  'freightCents',
  'discountCents',
  'totalCents',
  'quantity',
  'currency',
  'productSnapshot',
  'offerSnapshot',
  'address',
  'userId',
  'offerId',
  'productId',
  'listingId',
];
const ORDER_ITEM_SNAPSHOT_KEYS = [
  'unitPriceCents',
  'lineTotalCents',
  'quantity',
  'productSnapshot',
  'offerSnapshot',
  'title',
  'provider',
  'orderId',
  'productId',
  'offerId',
  'listingId',
];
const SESSION_SNAPSHOT_KEYS = [
  'unitPriceCents',
  'userId',
  'offerId',
  'productId',
  'quantity',
  'address',
];

function persistConflict(message) {
  const err = new Error(message);
  err.status = 409;
  return err;
}

function isProtectedTable(table) {
  return PROTECTED_TABLES.includes(table);
}

function assertOrderWrite(table, opts) {
  if (isProtectedTable(table) && !(opts && opts.allowOrderWrite)) {
    throw persistConflict('Pedidos só mudam pelo domínio.');
  }
}

function insert(table, row, opts) {
  assertOrderWrite(table, opts);
  const rec = { id: row.id || randomUUID(), ...row };
  if (!cache[table]) cache[table] = [];
  cache[table].push(rec);
  persistRow(table, rec);
  return rec;
}

function assertOrderPatch(table, patch, opts) {
  const keys = Object.keys(patch || {});
  if (table === 'orders') {
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] === 'address' && opts && opts.allowAddressUpdate) continue;
      if (ORDER_SNAPSHOT_KEYS.includes(keys[i])) {
        throw persistConflict('O snapshot do pedido é imutável.');
      }
    }
    if (keys.includes('status') && !(opts && opts.allowOrderStatus)) {
      throw persistConflict('O status do pedido só muda via domínio.');
    }
  }
  if (table === 'orderItems') {
    for (let i = 0; i < keys.length; i++) {
      if (ORDER_ITEM_SNAPSHOT_KEYS.includes(keys[i])) {
        throw persistConflict('O snapshot do item é imutável.');
      }
    }
  }
  if (table === 'orderEvents' && keys.length) {
    throw persistConflict('Eventos do pedido são imutáveis.');
  }
  if (table === 'checkoutSessions') {
    for (let i = 0; i < keys.length; i++) {
      if (SESSION_SNAPSHOT_KEYS.includes(keys[i])) {
        throw persistConflict('O snapshot da sessão é imutável.');
      }
    }
  }
}

function update(table, id, patch, opts) {
  assertOrderPatch(table, patch, opts);
  const list = cache[table] || [];
  const idx = list.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  const prev = list[idx];
  let changed = false;
  const keys = Object.keys(patch || {});
  for (let i = 0; i < keys.length; i++) {
    if (prev[keys[i]] !== patch[keys[i]]) {
      changed = true;
      break;
    }
  }
  if (!changed) return prev;
  list[idx] = { ...prev, ...patch, id };
  persistRow(table, list[idx]);
  return list[idx];
}

function remove(table, id, opts) {
  assertOrderWrite(table, opts);
  const list = cache[table] || [];
  const idx = list.findIndex((r) => r.id === id);
  if (idx < 0) return false;
  list.splice(idx, 1);
  persistDelete(table, id);
  return true;
}

function removeWhere(table, pred, opts) {
  assertOrderWrite(table, opts);
  const list = cache[table] || [];
  const kept = [];
  for (let i = 0; i < list.length; i++) {
    const rec = list[i];
    if (pred(rec)) persistDelete(table, rec.id);
    else kept.push(rec);
  }
  cache[table] = kept;
}

function count(table, pred) {
  const list = all(table);
  return pred ? list.filter(pred).length : list.length;
}

function reset(data, opts) {
  if (!(opts && opts.allowOrderWrite)) {
    throw persistConflict('Pedidos só mudam pelo domínio.');
  }
  cache = { ...structuredClone(EMPTY), ...data };
  openSqlite();
  const outer = batchDepth === 0;
  if (outer) sqlite.exec('BEGIN IMMEDIATE');
  try {
    writeAll(cache);
    if (outer) sqlite.exec('COMMIT');
  } catch (err) {
    if (outer) {
      try { sqlite.exec('ROLLBACK'); } catch {}
    }
    throw err;
  }
}

function getCache() {
  return new Proxy(cache, {
    get(target, prop) {
      if (isProtectedTable(prop) && Array.isArray(target[prop])) {
        return target[prop].map((row) => structuredClone(row));
      }
      return target[prop];
    },
    set(target, prop, value) {
      if (isProtectedTable(prop)) throw persistConflict('Pedidos só mudam pelo domínio.');
      target[prop] = value;
      return true;
    },
    deleteProperty(target, prop) {
      if (isProtectedTable(prop)) throw persistConflict('Pedidos só mudam pelo domínio.');
      delete target[prop];
      return true;
    },
  });
}

function reload() {
  cache = loadFromSqlite();
  return cache;
}

function backupNow() {
  openSqlite();
  ensureDir(BACKUP_DIR);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(BACKUP_DIR, 'catira-' + stamp + '.sqlite');
  sqlite.exec("VACUUM INTO '" + sqlPath(dest) + "'");
  return dest;
}

function ensureDailyBackup() {
  ensureDir(BACKUP_DIR);
  const files = fs.readdirSync(BACKUP_DIR).filter((name) => /^catira-.*\.sqlite$/.test(name));
  const fresh = files.some((name) => {
    const age = Date.now() - fs.statSync(path.join(BACKUP_DIR, name)).mtimeMs;
    return age < 20 * 60 * 60 * 1000;
  });
  if (fresh) return null;
  return backupNow();
}

function close() {
  if (!sqlite) return;
  try { sqlite.close(); } catch {}
  sqlite = null;
  stmts = null;
}

boot();

process.on('exit', () => {
  try { close(); } catch {}
});

module.exports = {
  all,
  findById,
  findWhere,
  findOne,
  insert,
  update,
  remove,
  removeWhere,
  count,
  persist,
  batch,
  reset,
  getCache,
  reload,
  backupNow,
  ensureDailyBackup,
  close,
  DATA_DIR,
  JSON_FILE,
  SQLITE_FILE,
  BACKUP_DIR,
};
