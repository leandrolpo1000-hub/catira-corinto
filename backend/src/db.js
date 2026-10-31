const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

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
};

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  ensureDir();
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(EMPTY, null, 2));
    return structuredClone(EMPTY);
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const data = JSON.parse(raw);
    return { ...structuredClone(EMPTY), ...data };
  } catch {
    return structuredClone(EMPTY);
  }
}

function save(data) {
  ensureDir();
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

let cache = load();
let batchDepth = 0;

function persist() {
  if (batchDepth > 0) return;
  save(cache);
}

function batch(fn) {
  batchDepth += 1;
  try {
    const result = fn();
    batchDepth -= 1;
    persist();
    return result;
  } catch (err) {
    batchDepth -= 1;
    persist();
    throw err;
  }
}

function all(table) {
  return cache[table] || [];
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

function insert(table, row) {
  const rec = { id: row.id || randomUUID(), ...row };
  if (!cache[table]) cache[table] = [];
  cache[table].push(rec);
  persist();
  return rec;
}

function update(table, id, patch) {
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
  persist();
  return list[idx];
}

function remove(table, id) {
  const list = cache[table] || [];
  const idx = list.findIndex((r) => r.id === id);
  if (idx < 0) return false;
  list.splice(idx, 1);
  persist();
  return true;
}

function removeWhere(table, pred) {
  const list = cache[table] || [];
  cache[table] = list.filter((r) => !pred(r));
  persist();
}

function count(table, pred) {
  const list = all(table);
  return pred ? list.filter(pred).length : list.length;
}

function reset(data) {
  cache = { ...structuredClone(EMPTY), ...data };
  persist();
}

function getCache() {
  return cache;
}

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
  DATA_DIR,
};
