# Official Catira PDP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dedicated `/produto/:id` page for Catira official products that shows one delivery ETA for the phone’s city, with address confirmation only at checkout.

**Architecture:** Pure helpers (`deliveryEta`, `cityCentroids`, `geoCity`, `productPath`) drive a new `OfficialProduct.jsx`. Listing/cards redirect or link via `productPath`. Checkout keeps the existing address form and only adds ETA copy from the same helper.

**Tech Stack:** React 18, react-router-dom 6, Vite, `node --test` on `frontend/src/*.test.mjs`, Catira cream/orange/white CSS.

## Global Constraints

- No cart. No “Adicionar ao carrinho”.
- Do not rewrite Appmax, `Pay.jsx`, VIP, listing-fee Pix, or `commercialReady` (stays false).
- Client never sends price. Price comes from `catiraOffer` on the listing payload.
- `GET /api/orders` list and `/api/checkout/sessions` stay 403.
- Do not collect CEP/street/number on the PDP.
- Do not show both ETA bands (“Corinto e região” and “Demais cidades”) on the PDP at once.
- No geolocation on private (non-official) listings.
- No Nominatim/Google geocode HTTP. Centroids only.
- Copy on PDP CTA is exactly `Comprar pelo Catira`.
- Região = city in the 34 `CITY_NAMES` → `2 a 5 dias úteis`. Fora → `5 a 12 dias úteis`.
- Do not invent weekday names (“domingo”).
- Do not commit unless the user asks. Skip every Commit step.
- Catira cream/orange/white. No Mercado Livre blue, no Black Friday badge, no installments UI, no color/RAM pickers.
- Existing `frontend/src/*.test.mjs` must stay green; update `checkout.test.mjs` string asserts that currently require `Comprar no Catira` on `Listing.jsx`.

---

### Task 1: Helpers — zone, ETA, centroids, path

**Files:**
- Create: `frontend/src/cityCentroids.js`
- Create: `frontend/src/deliveryEta.js`
- Create: `frontend/src/geoCity.js`
- Create: `frontend/src/productPath.js`
- Create: `frontend/src/officialProduct.test.mjs`

**Interfaces:**
- Consumes: none
- Produces:
  - `CITY_CENTROIDS`: `Array<{ name: string, id: string, lat: number, lng: number }>` length 34
  - `nearestCity(lat, lng, maxKm = 80)` → `{ name, id, km }` if within maxKm, else `{ name: null, id: null, km, zone: 'fora' }`
  - `REGION_CITY_NAMES`: string[] length 34 (same names as seed `CITY_NAMES`)
  - `deliveryZone(cityName)` → `'regiao' | 'fora'`
  - `deliveryEta(cityName)` → `{ zone, city, daysLabel, label }`
  - `resolveGeoCity({ geolocation, storage, fallbackCity })` → Promise<string> (`'Corinto'` | city name | never throws)
  - `productPath(item)` → `'/produto/' + id` if `item.isOfficial`, else `'/anuncio/' + id`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/officialProduct.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import { nearestCity, CITY_CENTROIDS } from './cityCentroids.js';
import { deliveryZone, deliveryEta, REGION_CITY_NAMES } from './deliveryEta.js';
import { resolveGeoCity } from './geoCity.js';
import { productPath } from './productPath.js';

assert.equal(CITY_CENTROIDS.length, 34);
assert.equal(REGION_CITY_NAMES.length, 34);
['Dores do Indaiá', 'Luz', 'Bom Despacho', 'Quartel Geral', 'Cedro do Abaeté', 'Corinto'].forEach((n) => {
  assert.equal(REGION_CITY_NAMES.includes(n), true, n);
});

const corinto = nearestCity(-18.378, -44.456);
assert.equal(corinto.name, 'Corinto');
assert.equal(corinto.id, 'corinto');

const bh = nearestCity(-19.9167, -43.9345);
assert.equal(bh.zone, 'fora');
assert.equal(bh.name, null);

assert.equal(deliveryZone('Corinto'), 'regiao');
assert.equal(deliveryZone('Luz'), 'regiao');
assert.equal(deliveryZone('Belo Horizonte'), 'fora');
assert.equal(deliveryZone(''), 'fora');

const etaC = deliveryEta('Corinto');
assert.equal(etaC.zone, 'regiao');
assert.equal(etaC.daysLabel, '2 a 5 dias úteis');
assert.equal(etaC.label, 'Chega em 2 a 5 dias úteis em Corinto');
assert.equal(etaC.label.includes('Demais'), false);

const etaF = deliveryEta('Belo Horizonte');
assert.equal(etaF.zone, 'fora');
assert.equal(etaF.daysLabel, '5 a 12 dias úteis');
assert.equal(etaF.label, 'Chega em 5 a 12 dias úteis');
assert.equal(etaF.label.includes('Corinto e região'), false);
assert.equal(etaF.label.includes('domingo'), false);

assert.equal(productPath({ id: 'abc', isOfficial: true }), '/produto/abc');
assert.equal(productPath({ id: 'xyz', isOfficial: false }), '/anuncio/xyz');
assert.equal(productPath({ id: 'n' }), '/anuncio/n');

const mem = {};
const storage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
};

const denied = {
  getCurrentPosition(ok, err) { err({ code: 1 }); },
};
const c1 = await resolveGeoCity({ geolocation: denied, storage, fallbackCity: 'Curvelo' });
assert.equal(c1, 'Curvelo');

const c2 = await resolveGeoCity({ geolocation: denied, storage, fallbackCity: '' });
assert.equal(c2, 'Corinto');

mem.catira_geo_city = 'Diamantina';
const c3 = await resolveGeoCity({ geolocation: denied, storage, fallbackCity: 'Curvelo' });
assert.equal(c3, 'Diamantina');

const geoOk = {
  getCurrentPosition(ok) { ok({ coords: { latitude: -18.378, longitude: -44.456 } }); },
};
delete mem.catira_geo_city;
const c4 = await resolveGeoCity({ geolocation: geoOk, storage, fallbackCity: 'Luz' });
assert.equal(c4, 'Corinto');
assert.equal(mem.catira_geo_city, 'Corinto');

console.log('OK official product helpers');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/officialProduct.test.mjs`

Expected: FAIL — `Cannot find module './cityCentroids.js'` (or equivalent ERR_MODULE_NOT_FOUND).

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/cityCentroids.js`:

```javascript
export const CITY_CENTROIDS = [
  { name: 'Corinto', id: 'corinto', lat: -18.378, lng: -44.456 },
  { name: 'Curvelo', id: 'curvelo', lat: -18.757, lng: -44.431 },
  { name: 'Três Marias', id: 'tres-marias', lat: -18.206, lng: -45.233 },
  { name: 'Felixlândia', id: 'felixlandia', lat: -18.758, lng: -44.9 },
  { name: 'Abaeté', id: 'abaete', lat: -19.16, lng: -45.452 },
  { name: 'Martinho Campos', id: 'martinho-campos', lat: -19.332, lng: -45.243 },
  { name: 'Morro da Garça', id: 'morro-da-garca', lat: -18.548, lng: -44.603 },
  { name: 'Santo Hipólito', id: 'santo-hipolito', lat: -18.305, lng: -44.211 },
  { name: 'Monjolos', id: 'monjolos', lat: -18.325, lng: -44.119 },
  { name: 'Augusto de Lima', id: 'augusto-de-lima', lat: -18.107, lng: -44.265 },
  { name: 'Inimutaba', id: 'inimutaba', lat: -18.73, lng: -44.358 },
  { name: 'Presidente Juscelino', id: 'presidente-juscelino', lat: -18.637, lng: -44.078 },
  { name: 'Lassance', id: 'lassance', lat: -17.887, lng: -44.574 },
  { name: 'Buenópolis', id: 'buenopolis', lat: -17.874, lng: -44.18 },
  { name: 'Joaquim Felício', id: 'joaquim-felicio', lat: -17.758, lng: -44.173 },
  { name: 'Gouveia', id: 'gouveia', lat: -18.454, lng: -43.741 },
  { name: 'Várzea da Palma', id: 'varzea-da-palma', lat: -17.598, lng: -44.731 },
  { name: 'Diamantina', id: 'diamantina', lat: -18.244, lng: -43.6 },
  { name: 'Paraopeba', id: 'paraopeba', lat: -19.275, lng: -44.404 },
  { name: 'Santana de Pirapama', id: 'santana-de-pirapama', lat: -19.006, lng: -44.042 },
  { name: 'Morada Nova de Minas', id: 'morada-nova-de-minas', lat: -18.601, lng: -45.357 },
  { name: 'Pompéu', id: 'pompeu', lat: -19.225, lng: -45.01 },
  { name: 'Cordisburgo', id: 'cordisburgo', lat: -19.125, lng: -44.322 },
  { name: 'Jequitaí', id: 'jequitai', lat: -17.236, lng: -44.446 },
  { name: 'Datas', id: 'datas', lat: -18.446, lng: -43.656 },
  { name: 'Presidente Kubitschek', id: 'presidente-kubitschek', lat: -18.614, lng: -43.562 },
  { name: 'São Gonçalo do Abaeté', id: 'sao-goncalo-do-abaete', lat: -18.344, lng: -45.832 },
  { name: 'Paineiras', id: 'paineiras', lat: -18.904, lng: -45.532 },
  { name: 'Biquinhas', id: 'biquinhas', lat: -18.775, lng: -45.502 },
  { name: 'Dores do Indaiá', id: 'dores-do-indaia', lat: -19.463, lng: -45.602 },
  { name: 'Luz', id: 'luz', lat: -19.801, lng: -45.686 },
  { name: 'Bom Despacho', id: 'bom-despacho', lat: -19.736, lng: -45.252 },
  { name: 'Quartel Geral', id: 'quartel-geral', lat: -19.27, lng: -45.557 },
  { name: 'Cedro do Abaeté', id: 'cedro-do-abaete', lat: -19.145, lng: -45.712 },
];

function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function nearestCity(lat, lng, maxKm = 80) {
  let best = null;
  let bestKm = Infinity;
  CITY_CENTROIDS.forEach((c) => {
    const km = haversineKm(lat, lng, c.lat, c.lng);
    if (km < bestKm) {
      bestKm = km;
      best = c;
    }
  });
  if (!best || bestKm > maxKm) return { name: null, id: null, km: bestKm, zone: 'fora' };
  return { name: best.name, id: best.id, km: bestKm };
}
```

Create `frontend/src/deliveryEta.js`:

```javascript
import { CITY_CENTROIDS } from './cityCentroids.js';

export const REGION_CITY_NAMES = CITY_CENTROIDS.map((c) => c.name);

export function deliveryZone(cityName) {
  const n = String(cityName || '').trim();
  if (!n) return 'fora';
  return REGION_CITY_NAMES.includes(n) ? 'regiao' : 'fora';
}

export function deliveryEta(cityName) {
  const zone = deliveryZone(cityName);
  if (zone === 'regiao') {
    const city = String(cityName).trim();
    return {
      zone,
      city,
      daysLabel: '2 a 5 dias úteis',
      label: 'Chega em 2 a 5 dias úteis em ' + city,
    };
  }
  return {
    zone: 'fora',
    city: String(cityName || '').trim(),
    daysLabel: '5 a 12 dias úteis',
    label: 'Chega em 5 a 12 dias úteis',
  };
}
```

Create `frontend/src/geoCity.js`:

```javascript
import { nearestCity } from './cityCentroids.js';
import { REGION_CITY_NAMES } from './deliveryEta.js';

const KEY = 'catira_geo_city';

function readStored(storage) {
  try {
    const v = storage && storage.getItem(KEY);
    if (v && REGION_CITY_NAMES.includes(v)) return v;
  } catch {}
  return '';
}

function writeStored(storage, city) {
  try {
    if (storage && city && REGION_CITY_NAMES.includes(city)) storage.setItem(KEY, city);
  } catch {}
}

function gpsOnce(geolocation) {
  if (!geolocation || typeof geolocation.getCurrentPosition !== 'function') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const t = setTimeout(() => finish(null), 6000);
    try {
      geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(t);
          const lat = pos && pos.coords && pos.coords.latitude;
          const lng = pos && pos.coords && pos.coords.longitude;
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return finish(null);
          const hit = nearestCity(lat, lng, 80);
          finish(hit && hit.name ? hit.name : null);
        },
        () => {
          clearTimeout(t);
          finish(null);
        },
        { timeout: 6000, maximumAge: 30 * 60 * 1000, enableHighAccuracy: false }
      );
    } catch {
      clearTimeout(t);
      finish(null);
    }
  });
}

export async function resolveGeoCity({ geolocation, storage, fallbackCity } = {}) {
  const stored = readStored(storage);
  if (stored) return stored;
  const fromGps = await gpsOnce(geolocation);
  if (fromGps) {
    writeStored(storage, fromGps);
    return fromGps;
  }
  const chip = String(fallbackCity || '').trim();
  if (chip) return chip;
  return 'Corinto';
}
```

Create `frontend/src/productPath.js`:

```javascript
export function productPath(item) {
  if (item && item.isOfficial && item.id) return '/produto/' + item.id;
  return '/anuncio/' + ((item && item.id) || '');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/officialProduct.test.mjs`

Expected: `OK official product helpers` and exit 0.

- [ ] **Step 5: Commit**

Skip. Do not commit.

---

### Task 2: `OfficialProduct.jsx` + route + styles

**Files:**
- Create: `frontend/src/pages/OfficialProduct.jsx`
- Modify: `frontend/src/App.jsx` (add import + `<Route path="/produto/:id" element={<OfficialProduct />} />` next to `/anuncio/:id`)
- Modify: `frontend/src/styles.css` (PDP classes)
- Modify: `frontend/src/officialProduct.test.mjs` (source-string asserts)

**Interfaces:**
- Consumes: `productPath`, `deliveryEta`, `resolveGeoCity`, `useCity`, `api`, `money`, `useAuth`, existing `Top` optional (PDP has its own back on gallery)
- Produces: page at `/produto/:id`; non-official → `<Navigate to={'/anuncio/' + id} replace />`

- [ ] **Step 1: Extend the failing test**

Append to `frontend/src/officialProduct.test.mjs`:

```javascript
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(path.join(dir, 'pages/OfficialProduct.jsx'), 'utf8');
const app = fs.readFileSync(path.join(dir, 'App.jsx'), 'utf8');
const css = fs.readFileSync(path.join(dir, 'styles.css'), 'utf8');

assert.equal(app.includes('/produto/:id'), true, 'rota /produto/:id');
assert.equal(app.includes('OfficialProduct'), true, 'App importa OfficialProduct');
assert.equal(page.includes('Comprar pelo Catira'), true, 'CTA copy');
assert.equal(page.includes('Adicionar ao carrinho'), false, 'sem carrinho');
assert.equal(page.includes('Corinto e região'), false, 'sem duas faixas');
assert.equal(page.includes('Demais cidades'), false, 'sem demais');
assert.equal(page.includes('domingo'), false, 'sem dia da semana');
assert.equal(page.includes('/checkout?listing='), true, 'vai ao checkout');
assert.equal(page.includes('/api/orders'), false, 'PDP não cria pedido');
assert.equal(page.includes('resolveGeoCity'), true, 'usa GPS helper');
assert.equal(page.includes('deliveryEta'), true, 'usa ETA helper');
assert.equal(page.includes('catiraOffer'), true, 'preço da oferta');
assert.equal(page.includes('Navigate'), true, 'redirect não-oficial');
assert.equal(css.includes('.pdp-eta'), true, 'estilo prazo');
assert.equal(css.includes('.pdp-cta'), true, 'CTA sticky');

console.log('OK official product page strings');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/officialProduct.test.mjs`

Expected: FAIL — `OfficialProduct.jsx` missing.

- [ ] **Step 3: Implement page, route, CSS**

Create `frontend/src/pages/OfficialProduct.jsx`:

```javascript
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api, money } from '../api';
import { useAuth } from '../auth';
import { useCity } from '../city';
import { deliveryEta } from '../deliveryEta';
import { resolveGeoCity } from '../geoCity';
import { officialLocation } from '../components';

export default function OfficialProduct() {
  const { id } = useParams();
  const { user } = useAuth();
  const { city: chipCity } = useCity();
  const nav = useNavigate();
  const [item, setItem] = useState(null);
  const [err, setErr] = useState('');
  const [idx, setIdx] = useState(0);
  const [geoCity, setGeoCity] = useState(chipCity || 'Corinto');

  useEffect(() => {
    api('/api/listings/' + id)
      .then(setItem)
      .catch((e) => setErr(e.message));
  }, [id]);

  useEffect(() => {
    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : null;
    const storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null;
    resolveGeoCity({ geolocation: geo, storage, fallbackCity: chipCity })
      .then(setGeoCity)
      .catch(() => setGeoCity(chipCity || 'Corinto'));
  }, [chipCity]);

  if (err && !item) {
    return (
      <div className="page">
        <div className="error">{err}</div>
      </div>
    );
  }
  if (!item) return <div className="page">Carregando...</div>;
  if (!item.isOfficial) return <Navigate to={'/anuncio/' + id} replace />;

  const images = item.images || [];
  const img = images[idx]?.url || images[0]?.url;
  const officialOffers = Array.isArray(item.officialOffers) ? item.officialOffers : [];
  const catiraOffer = officialOffers.find((o) => o.provider === 'catira');
  const externalOffers = officialOffers.filter((o) => o.provider !== 'catira');
  const eta = deliveryEta(geoCity);
  const price = catiraOffer && catiraOffer.price;
  const prev = catiraOffer && catiraOffer.previousPrice;

  function goCheckout() {
    if (!catiraOffer) return;
    const next = '/checkout?listing=' + item.id + '&offer=' + catiraOffer.id;
    if (!user) {
      nav('/entrar?next=' + encodeURIComponent(next));
      return;
    }
    nav(next);
  }

  async function fav() {
    if (!user) {
      nav('/entrar?next=' + encodeURIComponent(location.pathname));
      return;
    }
    try {
      const d = await api('/api/favorites/' + item.id, { method: 'POST' });
      setItem({ ...item, favorited: d.favorited });
    } catch (e) {
      setErr(e.message);
    }
  }

  async function share() {
    const url = window.location.href;
    api('/api/listings/' + item.id + '/share', { method: 'POST' }).catch(() => {});
    try {
      if (navigator.share) {
        await navigator.share({ title: item.title, text: item.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
    } catch {}
  }

  return (
    <div className="pdp">
      <div className="pdp-gallery">
        {img ? <img src={img} alt={item.title} /> : <div className="pdp-gallery-empty" />}
        <button type="button" className="pdp-icon pdp-back" onClick={() => nav(-1)} aria-label="Voltar">
          ‹
        </button>
        <button type="button" className="pdp-icon pdp-share" onClick={share} aria-label="Compartilhar">
          ↗
        </button>
        {images.length > 0 && (
          <span className="pdp-count">
            {idx + 1}/{images.length}
          </span>
        )}
        {images.length > 1 && (
          <div className="pdp-dots">
            {images.map((_, i) => (
              <button
                key={i}
                type="button"
                className={i === idx ? 'on' : ''}
                aria-label={'Foto ' + (i + 1)}
                onClick={() => setIdx(i)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="pdp-body">
        <span className="badge-official">CATIRA OFICIAL</span>
        <h1 className="pdp-title">{item.title}</h1>
        {!!price && (
          <div className="pdp-price">
            {prev && prev > price ? <s>{money(prev)}</s> : null}
            <strong>{money(price)}</strong>
          </div>
        )}

        <div className="pdp-eta">
          <p className="pdp-eta-line">{eta.label}</p>
          <p className="hint">Prazo estimado, sujeito à confirmação do endereço na compra.</p>
        </div>

        {catiraOffer && catiraOffer.buyEnabled && (
          <button type="button" className="btn btn-primary pdp-buy" onClick={goCheckout}>
            Comprar pelo Catira
          </button>
        )}
        {catiraOffer && !catiraOffer.buyEnabled && (
          <p className="hint">Em preparação · compra pelo Catira ainda não está disponível.</p>
        )}

        {externalOffers.length > 0 && (
          <div className="pdp-ml">
            <p>Prefere comprar no Mercado Livre?</p>
            {externalOffers.map((o) => (
              <a
                key={o.id}
                className="btn btn-ghost"
                href={o.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
              >
                {o.providerLabel || 'Comprar no Mercado Livre'}
              </a>
            ))}
          </div>
        )}

        {item.description && <p className="pdp-desc">{item.description}</p>}

        <div className="seller official-seller">
          <div className="avatar official-avatar">C</div>
          <div>
            <strong>CATIRA OFICIAL</strong>
            <div className="verified">Produto vendido pela plataforma · {officialLocation(item)}</div>
          </div>
        </div>

        <div className="row-btns">
          <button type="button" className="btn btn-ghost" onClick={fav}>
            {item.favorited ? 'Favoritado' : 'Favoritar'}
          </button>
        </div>
      </div>

      {catiraOffer && catiraOffer.buyEnabled && (
        <div className="pdp-cta">
          <button type="button" className="btn btn-primary" onClick={goCheckout}>
            Comprar pelo Catira
          </button>
        </div>
      )}
    </div>
  );
}
```

In `frontend/src/App.jsx`, add import next to Listing:

```javascript
import OfficialProduct from './pages/OfficialProduct';
```

Add route immediately after `/anuncio/:id`:

```javascript
<Route path="/anuncio/:id" element={<Listing />} />
<Route path="/produto/:id" element={<OfficialProduct />} />
```

Append to `frontend/src/styles.css`:

```css
.pdp { padding-bottom: 88px; background: #fff; }
.pdp-gallery { position: relative; background: #FFF8F0; aspect-ratio: 1 / 1; overflow: hidden; }
.pdp-gallery img { width: 100%; height: 100%; object-fit: contain; display: block; }
.pdp-icon { position: absolute; top: 12px; width: 44px; height: 44px; border: 0; border-radius: 22px; background: #fff; color: #1a1a1a; font-size: 22px; cursor: pointer; }
.pdp-back { left: 12px; }
.pdp-share { right: 12px; }
.pdp-count { position: absolute; right: 12px; bottom: 12px; background: rgba(0,0,0,.55); color: #fff; font-size: 12px; padding: 4px 8px; border-radius: 12px; }
.pdp-dots { position: absolute; left: 0; right: 0; bottom: 10px; display: flex; justify-content: center; gap: 6px; }
.pdp-dots button { width: 8px; height: 8px; border-radius: 4px; border: 0; background: #ccc; padding: 0; cursor: pointer; }
.pdp-dots button.on { background: #E85D04; }
.pdp-body { padding: 16px 16px 24px; }
.pdp-title { font-size: 18px; line-height: 1.35; margin: 10px 0 8px; font-weight: 700; }
.pdp-price { display: flex; align-items: baseline; gap: 8px; margin-bottom: 12px; }
.pdp-price strong { font-size: 28px; color: #1a1a1a; }
.pdp-price s { color: #888; font-size: 14px; }
.pdp-eta { margin: 8px 0 16px; }
.pdp-eta-line { color: #2D6A4F; font-weight: 700; font-size: 16px; margin: 0 0 4px; }
.pdp-buy { width: 100%; }
.pdp-ml { margin-top: 20px; padding-top: 16px; border-top: 1px solid #eee; }
.pdp-ml p { margin: 0 0 8px; color: #444; }
.pdp-desc { margin-top: 20px; line-height: 1.5; white-space: pre-wrap; }
.pdp-cta { position: sticky; bottom: 0; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); background: #fff; border-top: 1px solid #eee; z-index: 20; }
.pdp-cta .btn { width: 100%; }
```

Do not add a second tab-bar hide unless `components.jsx` already hides `/checkout`; PDP can keep the app tab bar. Sticky CTA sits above it.

- [ ] **Step 4: Run tests**

Run: `cd frontend && node --test src/officialProduct.test.mjs`

Expected: both `OK` lines, exit 0.

- [ ] **Step 5: Commit**

Skip. Do not commit.

---

### Task 3: Listing redirect, cards, checkout ETA + back link

**Files:**
- Modify: `frontend/src/pages/Listing.jsx` (redirect if `item.isOfficial`; keep file for classifieds)
- Modify: `frontend/src/components.jsx` (`ListingCard` and other `/anuncio/` + `item.id` links that show products → `productPath(item)`)
- Modify: `frontend/src/pages/Home.jsx` (want-card official link)
- Modify: `frontend/src/pages/Checkout.jsx` (back link via `productPath`; ETA line from `deliveryEta(form.city)`)
- Modify: `frontend/src/checkout.test.mjs` (CTA strings move to OfficialProduct)
- Modify: `frontend/src/officialProduct.test.mjs` (listing redirect + checkout copy)

**Interfaces:**
- Consumes: `productPath`, `deliveryEta`
- Produces: official traffic lands on `/produto/:id`; checkout back goes to PDP for official; checkout shows one ETA from `form.city`

**Listing.jsx change (after `item` is loaded, before the classified UI):**

Right after `if (!item) return ...` add:

```javascript
  if (item.isOfficial) return <Navigate to={'/produto/' + item.id} replace />;
```

Add `Navigate` to the `react-router-dom` import in `Listing.jsx`. Leave the existing `official-buy` block in the file (it becomes unreachable for oficiais). Do **not** delete it in this task if `checkout.test.mjs` still grepped it — Task 3 updates that test instead, so the block may stay as dead code **or** be removed. Prefer **remove** the `item.isOfficial && officialOffers` buy block and the official seller duplicate only if tests no longer require those strings in Listing.jsx.

**checkout.test.mjs updates (exact replacements):**

Replace:

```javascript
assert.equal(listing.includes('Comprar no Catira'), true, 'ficha tem Comprar');
assert.equal(listing.includes('/checkout?listing='), true, 'ficha navega ao checkout');
```

with:

```javascript
const product = fs.readFileSync(path.join(dir, 'pages/OfficialProduct.jsx'), 'utf8');
assert.equal(product.includes('Comprar pelo Catira'), true, 'PDP tem Comprar');
assert.equal(product.includes('/checkout?listing='), true, 'PDP navega ao checkout');
assert.equal(listing.includes("Navigate to={'/produto/'"), true, 'oficial redireciona à PDP');
```

Keep the asserts `listing.includes('/api/orders') === false` and `listing.includes('AppmaxCardForm') === false`.

Add:

```javascript
assert.equal(checkout.includes('deliveryEta'), true, 'checkout usa prazo helper');
assert.equal(app.includes('/produto/:id'), true, 'rota produto');
```

**components.jsx:** add `import { productPath } from './productPath';` and change ListingCard Link to `to={productPath(item)}`. Same for the list-item Link at line 597 and acao-ig-view-ad at 529 if `item.isOfficial` can appear there.

**Home.jsx** want-card: `to={productPath(it)}` (import helper).

**Checkout.jsx:**

- `import { productPath } from '../productPath';`
- `import { deliveryEta } from '../deliveryEta';`
- Replace every `to={'/anuncio/' + listingId}` (and `order.listingId`) used as “Voltar ao anúncio” on an official flow with `to={productPath({ id: listingId || order.listingId, isOfficial: true })}` **only when the loaded listing is official**. Simplest: `to={productPath(listing || { id: listingId, isOfficial: !!(listing && listing.isOfficial) })}`. If `listing` is already in scope, use `productPath(listing)`.
- On the address step, under the city field, render:

```javascript
const eta = deliveryEta(form.city);
<p className="hint pdp-eta-line">{eta.label}</p>
<p className="hint">O endereço acima confirma o prazo da entrega.</p>
```

Do not add a new checkout step. Do not touch Pix/card/Appmax.

- [ ] **Step 1: Write/adjust failing tests** as above in `checkout.test.mjs` and append to `officialProduct.test.mjs`:

```javascript
const listingSrc = fs.readFileSync(path.join(dir, 'pages/Listing.jsx'), 'utf8');
assert.equal(listingSrc.includes("to={'/produto/'"), true, 'Listing redireciona oficial');
const componentsSrc = fs.readFileSync(path.join(dir, 'components.jsx'), 'utf8');
assert.equal(componentsSrc.includes('productPath'), true, 'cards usam productPath');
const checkoutSrc = fs.readFileSync(path.join(dir, 'pages/Checkout.jsx'), 'utf8');
assert.equal(checkoutSrc.includes('deliveryEta'), true, 'checkout ETA');
```

- [ ] **Step 2: Run to fail**

Run: `cd frontend && node --test src/officialProduct.test.mjs src/checkout.test.mjs`

Expected: FAIL on Listing redirect / productPath / deliveryEta in Checkout.

- [ ] **Step 3: Implement the wiring described above**

- [ ] **Step 4: Run tests**

Run: `cd frontend && node --test src/officialProduct.test.mjs src/checkout.test.mjs src/appmaxCard.test.mjs src/intelligence.test.mjs`

Expected: all pass.

Run: `cd frontend && npm run build`

Expected: exit 0.

- [ ] **Step 5: Commit**

Skip. Do not commit.

---

### Task 4: Manual boot check (no Appmax, no long server unless already up)

**Files:** none unless a bug in Tasks 1–3.

- [ ] **Step 1: Guard strings**

Already in tests. Confirm `OfficialProduct.jsx` has no `Adicionar ao carrinho`, no `Corinto e região` list, no `/api/orders`.

- [ ] **Step 2: Run frontend tests + build** (same commands as Task 3 Step 4). Expected pass.

- [ ] **Step 3: If a preview server is already running**, open an official sample at `/produto/:id`. Do not start a new long-running server unless the user asked. Checklist:

- One ETA line, city from GPS or chip.
- CTA **Comprar pelo Catira** → checkout address form.
- Changing checkout city between Corinto and a non-list city flips 2–5 vs 5–12.
- Classified listing still `/anuncio/:id`.

- [ ] **Step 4: Commit**

Skip. Do not commit.

---

## Spec coverage

| Spec | Task |
|---|---|
| `/produto/:id` OfficialProduct | 2 |
| GPS → centroid 80 km → chip → Corinto | 1, 2 |
| One ETA, no dual bands, no weekday | 1, 2 |
| Address only at checkout | 3 |
| Listing redirect + cards `productPath` | 3 |
| Checkout ETA + back to PDP | 3 |
| No cart / no Appmax rewrite / no price from client | 2, 3 |
| Tests | 1–4 |

## Placeholder scan

No TBD. Centroids, copy, routes, and test source are inlined.

## Type consistency

- `deliveryEta(cityName)` → `{ zone, city, daysLabel, label }` used by PDP and Checkout.
- `resolveGeoCity({ geolocation, storage, fallbackCity })` → Promise<string>.
- `productPath(item)` → `'/produto/'+id` \| `'/anuncio/'+id`.
- `nearestCity` fora object includes `zone: 'fora'` and `name: null`.
