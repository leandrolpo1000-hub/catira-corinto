const fs = require('fs');
const express = require('express');
const cors = require('cors');
const path = require('path');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  text.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq < 1) return;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  });
}

loadEnvFile(path.join(__dirname, '..', '..', '.env'));
loadEnvFile(path.join(__dirname, '..', '.env'));

const { seedIfEmpty, ensureExtras, ensureMaster } = require('./seed');
const { authOptional } = require('./middleware');
const { assertRuntimeConfig } = require('./config');
assertRuntimeConfig();

seedIfEmpty();
ensureExtras();
ensureMaster();
try { require('./db').ensureDailyBackup(); } catch {}
try { require('./lance').ensureSettings(); } catch {}
try { require('./official').ensureOfficialSeller(); } catch {}
try { require('./official').ensureTestPixProduct(); } catch {}
try { require('./official').ensureSampleOfficialProducts(); } catch {}
try { require('./intelligence').ensureSettings(); } catch {}
try { require('./intelligence').ensureDemoEvents(); } catch {}
try { require('./auctions/editions').ensureEditions(); } catch {}

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(authOptional);
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

const AUDIO_DIR = path.join(__dirname, '..', 'data', 'audio');
const AUDIO_TRACKS = {
  durante: 'Durante',
  arrematado: 'Arrematado',
  contagem: 'Contagem regressiva',
  tensao: 'Clima de tensão',
  ultimo: 'Ultimo lote',
  importante: 'Lote Importante',
  novo: 'Novo lote',
  antes: 'Antes de começar',
};
const AUDIO_EXTS = ['.mp3', '.wav', '.ogg', '.m4a'];
function audioMime(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.ogg') return 'audio/ogg';
  if (ext === '.m4a') return 'audio/mp4';
  return 'application/octet-stream';
}
app.get('/audio/:id', (req, res, next) => {
  const id = String(req.params.id || '');
  const name = AUDIO_TRACKS[id];
  if (!name) return next();
  const found = AUDIO_EXTS.map((ext) => path.join(AUDIO_DIR, name + ext)).find((p) => require('fs').existsSync(p));
  if (!found) return res.status(404).end();
  res.setHeader('Content-Type', audioMime(found));
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(found);
});
app.use('/audio', express.static(AUDIO_DIR));

app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'CATIRA' }));

app.get('/api/config', (_req, res) => {
  const { listingFee, vipListingFee, vipAccessFee, vipDays, highlightFee, highlightDays, premiumDayFee, commonChargingEnabled, vipChargingEnabled, premiumChargingEnabled } = require('./pix');
  const { publicBanner } = require('./banner');
  const { publicPremiumBanner } = require('./helpers');
  const { assistantReady } = require('./assistant');
  const { publicAuctionConfig } = require('./auctions/config');
  const auction = publicAuctionConfig();
  res.json({
    assistantEnabled: assistantReady(),
    auctionEnabled: auction.enabled,
    auction,
    fee: listingFee(),
    vipListingFee: vipListingFee(),
    vipAccessFee: vipAccessFee(),
    vipDays: vipDays(),
    highlightFee: highlightFee(),
    highlightDays: highlightDays(),
    premiumDayFee: premiumDayFee(),
    feeEnabled: commonChargingEnabled(),
    commonFeeEnabled: commonChargingEnabled(),
    vipFeeEnabled: vipChargingEnabled(),
    premiumFeeEnabled: premiumChargingEnabled(),
    homeBanner: publicBanner(),
    premiumBanner: publicPremiumBanner(),
    appmax: require('./appmax').publicConfig(),
  });
});

app.get('/api/placeholder/:listingId/:idx', (req, res) => {
  const color = (req.query.c || '#E85D04').replace(/[^#A-Fa-f0-9]/g, '') || '#E85D04';
  const text = String(req.query.t || 'CATIRA').slice(0, 28);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${color}"/>
      <stop offset="100%" stop-color="#1a1a1a"/>
    </linearGradient>
  </defs>
  <rect width="800" height="600" fill="url(#g)"/>
  <circle cx="640" cy="80" r="90" fill="rgba(255,255,255,0.06)"/>
  <circle cx="90" cy="520" r="120" fill="rgba(255,255,255,0.05)"/>
  <text x="400" y="270" text-anchor="middle" font-family="Georgia, serif" font-size="28" fill="rgba(255,255,255,0.55)" letter-spacing="6">CATIRA</text>
  <text x="400" y="330" text-anchor="middle" font-family="Arial, sans-serif" font-size="36" font-weight="700" fill="#fff">${escapeXml(text)}</text>
</svg>`;
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(svg);
});

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

app.get('/api/meli/callback', async (req, res) => {
  const meli = require('./meli');
  const env = meli.envConfig();
  const redirect = env && env.redirectUri;
  try {
    if (req.query.error) {
      const err = new Error('Autorização recusada no Mercado Livre.');
      err.status = 400;
      throw err;
    }
    await meli.completeAuth(null, req.query.code, req.query.state);
    require('./db').insert('officialAdminLogs', {
      actorId: null,
      action: 'meli_connected',
      payload: {},
      createdAt: new Date().toISOString(),
    });
    return res.redirect(meli.frontendReturnUrl(redirect, 'ok', ''));
  } catch (e) {
    return res.redirect(meli.frontendReturnUrl(redirect, 'err', e.message || 'Falha ao conectar.'));
  }
});

const orderRoutes = require('./routes/orders');
app.use('/api/auth', require('./routes/auth'));
app.use('/api/orders', orderRoutes);
app.use('/api/checkout', orderRoutes.checkout);
app.use('/api/appmax/webhooks', require('./routes/appmaxWebhooks'));
app.use('/api/listings', require('./routes/listings'));
app.use('/api/auctions', require('./routes/auctions'));
app.use('/api', require('./routes/social'));
const actionRoutes = require('./routes/action');
app.use('/api/acao', actionRoutes.router);
app.use('/api/admin/acao', actionRoutes.adminRouter);
app.use('/api/admin/auctions', require('./routes/adminAuctions'));
app.use('/api/admin', require('./routes/admin'));
const lanceRoutes = require('./routes/lance');
app.use('/api/lance', lanceRoutes.publicRouter);
app.use('/api/admin/lance', lanceRoutes.adminRouter);

app.get('/api/merchant/intelligence', require('./middleware').authRequired, (_req, res) => {
  require('./intelligence').denyCommercial(res);
});
app.get('/api/intelligence/commercial', require('./middleware').authRequired, (_req, res) => {
  require('./intelligence').denyCommercial(res);
});

const { runAuctionTicks } = require('./auctions/engine');
const auctionTick = setInterval(() => {
  try { runAuctionTicks(); } catch (e) { /* mantém o serviço de pé */ }
}, 5000);
if (auctionTick.unref) auctionTick.unref();
const lanceTick = setInterval(() => {
  try { require('./lance').expireLance(); } catch (e) { /* mantém o serviço de pé */ }
}, 15000);
if (lanceTick.unref) lanceTick.unref();
const meliTick = setInterval(() => {
  try { require('./meli').runSyncTick().catch(() => {}); } catch (e) { /* mantém o serviço de pé */ }
}, 15 * 60 * 1000);
if (meliTick.unref) meliTick.unref();

app.use((err, _req, res, _next) => {
  if (err && err.message) return res.status(400).json({ error: err.message });
  res.status(500).json({ error: 'Erro interno.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`CATIRA API on http://localhost:${PORT}`);
});
