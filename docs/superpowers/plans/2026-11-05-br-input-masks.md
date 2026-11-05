# Brazilian Input Masks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Brazilian-format field in the Catira app shows the local mask while the user types; APIs still receive digits / numbers / ISO as they do today.

**Architecture:** Pure helpers in `frontend/src/masks.js` (same pattern as `formatBRLInput` in `api.js`). Screens store the masked string and strip on POST where the backend does not already `replace(/\D/g)`. No new library, no generic MaskedInput component.

**Tech Stack:** React 18, existing `digitsOnly` / `formatBRLInput` / `parseBRL` in `frontend/src/api.js`, `node --test` on `frontend/src/*.test.mjs`.

## Global Constraints

- No new npm dependency. No `react-imask`. No generic `<MaskedInput>`.
- Do not rewrite Appmax tokenize flow, Pix EMV, VIP, listing-fee Pix, or `commercialReady` (stays false).
- Client never sends price on checkout. `GET /api/orders` list and `/api/checkout/sessions` stay 403.
- Mask ≠ CPF/CNPJ check-digit validation. No ViaCEP. No extra error toasts.
- Email, password, name, street, district, complement, free search, 6-digit codes, URLs, API keys, IDs, percents, hours/minutes, stock, integer admin fields: no mask.
- Money fields that already use `formatBRLInput` stay. Remaining **R$** `type="number"` fields switch to that helper. Integers stay `type="number"`.
- Backend already strips digits on auth phone, checkout address, documentNumber, Pix key (phone/cpf/cnpj). Do not change backend contracts.
- Appmax card form stays **uncontrolled**. Keep `name="card-number"`, `name="exp-month"`, `name="exp-year"`, `name="cvv"`. Number: digits only, `maxLength={16}`, placeholder `0000 0000 0000 0000`. Year placeholder `AA` not `AAAA`. Do not put spaces in `card-number` value.
- Do not commit unless the user asks. Skip every Commit step.
- Existing `frontend/src/*.test.mjs` must stay green (`appmaxCard.test.mjs` still requires the four `name=` attributes).
- Do not start a new long-running server unless the user asks.

---

### Task 1: Mask helpers + unit tests

**Files:**
- Create: `frontend/src/masks.js`
- Create: `frontend/src/masks.test.mjs`

**Interfaces:**
- Consumes: `digitsOnly` from `./api.js`
- Produces:
  - `formatPhoneBr(value)` → string
  - `formatCep(value)` → string
  - `formatCpf(value)` → string
  - `formatCnpj(value)` → string
  - `formatCpfCnpj(value)` → string
  - `formatUf(value)` → string (A–Z, max 2)
  - `formatBrDate(value)` → `dd/mm/aaaa`
  - `parseBrDate(value)` → `yyyy-mm-dd` or `''`
  - `isoToBrDate(value)` → `dd/mm/aaaa`
  - `formatCardNumber(value)` → digits only, max 16
  - `formatCardExpiry(value)` → `MM/AA`
  - `formatCvv(value)` → digits, max 4

- [ ] **Step 1: Write the failing test**

Create `frontend/src/masks.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import { digitsOnly } from './api.js';
import {
  formatPhoneBr,
  formatCep,
  formatCpf,
  formatCnpj,
  formatCpfCnpj,
  formatUf,
  formatBrDate,
  parseBrDate,
  isoToBrDate,
  formatCardNumber,
  formatCardExpiry,
  formatCvv,
} from './masks.js';

assert.equal(formatPhoneBr('38999999999'), '(38) 99999-9999');
assert.equal(formatPhoneBr('3833333333'), '(38) 3333-3333');
assert.equal(formatPhoneBr('(38) 99999-9999'), '(38) 99999-9999');
assert.equal(formatPhoneBr('38'), '(38');
assert.equal(digitsOnly(formatPhoneBr('38999999999')), '38999999999');

assert.equal(formatCep('39200000'), '39200-000');
assert.equal(formatCep('39200'), '39200');
assert.equal(digitsOnly(formatCep('39200-000')), '39200000');

assert.equal(formatCpf('52998224725'), '529.982.247-25');
assert.equal(formatCnpj('12345678000195'), '12.345.678/0001-95');
assert.equal(formatCpfCnpj('52998224725'), '529.982.247-25');
assert.equal(formatCpfCnpj('12345678000195'), '12.345.678/0001-95');

assert.equal(formatUf('mgx'), 'MG');
assert.equal(formatUf('M'), 'M');
assert.equal(formatUf('12mg'), 'MG');

assert.equal(formatBrDate('25122026'), '25/12/2026');
assert.equal(parseBrDate('25/12/2026'), '2026-12-25');
assert.equal(parseBrDate('31/02/2026'), '');
assert.equal(isoToBrDate('2026-12-25'), '25/12/2026');

assert.equal(formatCardNumber('4111 1111 1111 1111 extra'), '4111111111111111');
assert.equal(formatCardExpiry('1226'), '12/26');
assert.equal(formatCvv('12a34'), '1234');

console.log('OK masks helpers');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/masks.test.mjs`

Expected: FAIL — `Cannot find module './masks.js'` (ERR_MODULE_NOT_FOUND).

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/masks.js`:

```javascript
import { digitsOnly } from './api.js';

export function formatPhoneBr(value) {
  const d = digitsOnly(value).slice(0, 11);
  if (!d) return '';
  if (d.length <= 2) return '(' + d;
  if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
  if (d.length <= 10) {
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
  }
  return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
}

export function formatCep(value) {
  const d = digitsOnly(value).slice(0, 8);
  if (!d) return '';
  if (d.length <= 5) return d;
  return d.slice(0, 5) + '-' + d.slice(5);
}

export function formatCpf(value) {
  const d = digitsOnly(value).slice(0, 11);
  if (!d) return '';
  if (d.length <= 3) return d;
  if (d.length <= 6) return d.slice(0, 3) + '.' + d.slice(3);
  if (d.length <= 9) return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6);
  return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
}

export function formatCnpj(value) {
  const d = digitsOnly(value).slice(0, 14);
  if (!d) return '';
  if (d.length <= 2) return d;
  if (d.length <= 5) return d.slice(0, 2) + '.' + d.slice(2);
  if (d.length <= 8) return d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5);
  if (d.length <= 12) {
    return d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8);
  }
  return (
    d.slice(0, 2) +
    '.' +
    d.slice(2, 5) +
    '.' +
    d.slice(5, 8) +
    '/' +
    d.slice(8, 12) +
    '-' +
    d.slice(12)
  );
}

export function formatCpfCnpj(value) {
  const d = digitsOnly(value).slice(0, 14);
  if (d.length <= 11) return formatCpf(d);
  return formatCnpj(d);
}

export function formatUf(value) {
  return String(value || '')
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase()
    .slice(0, 2);
}

export function formatBrDate(value) {
  const d = digitsOnly(value).slice(0, 8);
  if (!d) return '';
  if (d.length <= 2) return d;
  if (d.length <= 4) return d.slice(0, 2) + '/' + d.slice(2);
  return d.slice(0, 2) + '/' + d.slice(2, 4) + '/' + d.slice(4);
}

export function parseBrDate(value) {
  const m = String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return '';
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const dt = new Date(year, month - 1, day);
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) return '';
  return (
    String(year) +
    '-' +
    String(month).padStart(2, '0') +
    '-' +
    String(day).padStart(2, '0')
  );
}

export function isoToBrDate(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return formatBrDate(value);
  return m[3] + '/' + m[2] + '/' + m[1];
}

export function formatCardNumber(value) {
  return digitsOnly(value).slice(0, 16);
}

export function formatCardExpiry(value) {
  const d = digitsOnly(value).slice(0, 4);
  if (!d) return '';
  if (d.length <= 2) return d;
  return d.slice(0, 2) + '/' + d.slice(2);
}

export function formatCvv(value) {
  return digitsOnly(value).slice(0, 4);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/masks.test.mjs`

Expected: `OK masks helpers`, pass 1, fail 0, exit 0.

- [ ] **Step 5: Commit**

Skip. Do not commit.

---

### Task 2: Phone fields — Auth, Profile, LanceHub

**Files:**
- Modify: `frontend/src/pages/Auth.jsx`
- Modify: `frontend/src/pages/Profile.jsx`
- Modify: `frontend/src/pages/LanceHub.jsx`
- Modify: `frontend/src/masks.test.mjs` (append source greps)

**Interfaces:**
- Consumes: `formatPhoneBr` from `../masks`
- Produces: masked phone on screen; POST still a string the backend `replace(/\D/g)` accepts (Auth register / Profile PUT already strip)

- [ ] **Step 1: Append failing greps to `frontend/src/masks.test.mjs`**

```javascript
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const auth = fs.readFileSync(path.join(dir, 'pages/Auth.jsx'), 'utf8');
const profile = fs.readFileSync(path.join(dir, 'pages/Profile.jsx'), 'utf8');
const lance = fs.readFileSync(path.join(dir, 'pages/LanceHub.jsx'), 'utf8');

assert.equal(auth.includes('formatPhoneBr'), true, 'Auth mascara telefone');
assert.equal(auth.includes("set('phone', e.target.value)"), false, 'Auth telefone cru');
assert.equal(profile.includes('formatPhoneBr'), true, 'Profile mascara telefone');
assert.equal(lance.includes('formatPhoneBr'), true, 'LanceHub mascara telefone');

console.log('OK masks phone screens');
```

- [ ] **Step 2: Run to fail**

Run: `cd frontend && node --test src/masks.test.mjs`

Expected: FAIL — Auth does not include `formatPhoneBr`.

- [ ] **Step 3: Wire the three screens**

`Auth.jsx`: add `import { formatPhoneBr } from '../masks';`

Replace the Telefone / WhatsApp input:

```javascript
<div className="field">
  <label>Telefone / WhatsApp</label>
  <input
    value={form.phone}
    onChange={(e) => set('phone', formatPhoneBr(e.target.value))}
    required
    inputMode="tel"
    autoComplete="tel"
    placeholder="(38) 99999-9999"
  />
</div>
```

Leave `register({ ...form, cityId })` as-is (backend strips digits).

`Profile.jsx`: add `import { formatPhoneBr } from '../masks';`

On load:

```javascript
setForm({ name: user.name, phone: formatPhoneBr(user.phone), city: user.city });
```

Input:

```javascript
<div className="field">
  <label>Telefone</label>
  <input
    value={form.phone}
    onChange={(e) => setForm({ ...form, phone: formatPhoneBr(e.target.value) })}
    inputMode="tel"
    autoComplete="tel"
    placeholder="(38) 99999-9999"
  />
</div>
```

Leave `JSON.stringify(form)` on save (backend strips).

`LanceHub.jsx` `DealerApply`: add `import { formatPhoneBr } from '../masks';`

Init: `phone: formatPhoneBr(user?.phone || '')`

Input:

```javascript
<div className="field">
  <label>Telefone</label>
  <input
    value={form.phone}
    onChange={(e) => setForm({ ...form, phone: formatPhoneBr(e.target.value) })}
    required
    inputMode="tel"
    autoComplete="tel"
    placeholder="(38) 99999-9999"
  />
</div>
```

Leave apply POST body as `form` (if lance apply does not strip, masked digits still contain 10–11 digits; do **not** change the lance backend).

- [ ] **Step 4: Run tests**

Run: `cd frontend && node --test src/masks.test.mjs`

Expected: both `OK` lines, exit 0.

- [ ] **Step 5: Commit**

Skip. Do not commit.

---

### Task 3: Checkout — phone, CEP, UF, CPF/CNPJ

**Files:**
- Modify: `frontend/src/pages/Checkout.jsx`
- Modify: `frontend/src/masks.test.mjs`

**Interfaces:**
- Consumes: `formatPhoneBr`, `formatCep`, `formatUf`, `formatCpfCnpj` from `../masks`; `digitsOnly` from `../api`
- Produces: masked fields on entrega/pagamento; `validateAddress` already `digits(phone/cep)` and `state` 2 letters; Pix/card POST `documentNumber` already `digits()` — still send `digitsOnly(docNumber)` explicitly

- [ ] **Step 1: Append failing greps**

```javascript
const checkout = fs.readFileSync(path.join(dir, 'pages/Checkout.jsx'), 'utf8');
assert.equal(checkout.includes('formatPhoneBr'), true, 'checkout telefone');
assert.equal(checkout.includes('formatCep'), true, 'checkout CEP');
assert.equal(checkout.includes('formatUf'), true, 'checkout UF');
assert.equal(checkout.includes('formatCpfCnpj'), true, 'checkout CPF/CNPJ');
assert.equal(checkout.includes('digitsOnly(docNumber)'), true, 'doc só dígitos no POST');
console.log('OK masks checkout');
```

- [ ] **Step 2: Run to fail**

Run: `cd frontend && node --test src/masks.test.mjs`

Expected: FAIL — Checkout missing `formatCep`.

- [ ] **Step 3: Wire Checkout**

Add import:

```javascript
import { digitsOnly } from '../api';
```

If `api` is already imported, extend that import with `digitsOnly` instead of a second import.

```javascript
import { formatPhoneBr, formatCep, formatUf, formatCpfCnpj } from '../masks';
```

Initial form phone:

```javascript
phone: formatPhoneBr(user && user.phone ? user.phone : ''),
state: 'MG',
```

If `loadDraft` returns a previous unmasked phone/cep, format when applying `saved`:

```javascript
const [form, setForm] = useState((() => {
  const base = saved || {
    recipientName: user && user.name ? user.name : '',
    phone: user && user.phone ? user.phone : '',
    cep: '',
    street: '',
    number: '',
    complement: '',
    district: '',
    city: '',
    state: 'MG',
    cityId: 'corinto',
  };
  return {
    ...base,
    phone: formatPhoneBr(base.phone),
    cep: formatCep(base.cep),
    state: formatUf(base.state || 'MG'),
  };
})());
```

Keep `setF`; change only the four inputs:

```javascript
<div className="field"><label>Telefone</label><input value={form.phone} onChange={(e) => setF('phone', formatPhoneBr(e.target.value))} required inputMode="tel" autoComplete="tel" placeholder="(38) 99999-9999" /></div>
<div className="field"><label>CEP</label><input value={form.cep} onChange={(e) => setF('cep', formatCep(e.target.value))} required inputMode="numeric" autoComplete="postal-code" placeholder="00000-000" /></div>
```

Estado:

```javascript
<div className="field"><label>Estado</label><input value={form.state} onChange={(e) => setF('state', formatUf(e.target.value))} required maxLength={2} placeholder="MG" /></div>
```

CPF/CNPJ:

```javascript
<input
  value={docNumber}
  onChange={(e) => setDocNumber(formatCpfCnpj(e.target.value))}
  required
  inputMode="numeric"
  autoComplete="off"
  placeholder="000.000.000-00"
/>
```

In `pay()`, both card and pix bodies: `documentNumber: digitsOnly(docNumber)` (replace the raw `docNumber`).

Address POST can stay `address: form` — `orders.js` `validateAddress` already `digits(phone)` / `digits(cep)` / `state` uppercased.

Do not touch Appmax, Pix QR, or offer price.

- [ ] **Step 4: Run tests**

Run: `cd frontend && node --test src/masks.test.mjs src/checkout.test.mjs src/appmaxCard.test.mjs`

Expected: all pass.

- [ ] **Step 5: Commit**

Skip. Do not commit.

---

### Task 4: Appmax card placeholders + digit caps

**Files:**
- Modify: `frontend/src/AppmaxCardForm.jsx`
- Modify: `frontend/src/masks.test.mjs`

**Interfaces:**
- Consumes: `formatCardNumber`, `formatCvv` from `./masks` (optional; `onInput` may inline digits). Do **not** control `value` with React.
- Produces: same `name=` attributes; `maxLength` + `onInput` stripping non-digits; year placeholder `AA`

- [ ] **Step 1: Append greps**

```javascript
const cardForm = fs.readFileSync(path.join(dir, 'AppmaxCardForm.jsx'), 'utf8');
assert.equal(cardForm.includes('name="card-number"'), true, 'name card-number');
assert.equal(cardForm.includes('name="exp-month"'), true, 'name exp-month');
assert.equal(cardForm.includes('name="exp-year"'), true, 'name exp-year');
assert.equal(cardForm.includes('name="cvv"'), true, 'name cvv');
assert.equal(cardForm.includes('placeholder="AAAA"'), false, 'ano não AAAA');
assert.equal(cardForm.includes('placeholder="AA"'), true, 'ano AA');
assert.equal(cardForm.includes('maxLength={16}') || cardForm.includes('maxLength="16"'), true, 'cartão 16');
console.log('OK masks card form');
```

- [ ] **Step 2: Run to fail**

Run: `cd frontend && node --test src/masks.test.mjs src/appmaxCard.test.mjs`

Expected: FAIL on `AAAA` still present.

- [ ] **Step 3: Patch `AppmaxCardForm.jsx`**

Keep the form uncontrolled. Add a tiny `onInput` that writes digits back to the node:

```javascript
function keepDigits(max) {
  return (e) => {
    const next = String(e.target.value || '').replace(/\D/g, '').slice(0, max);
    if (e.target.value !== next) e.target.value = next;
  };
}
```

Replace the four numeric inputs (holder name unchanged):

```javascript
<input required name="card-number" placeholder="0000 0000 0000 0000" inputMode="numeric" autoComplete="cc-number" maxLength={16} onInput={keepDigits(16)} />
<input required name="card-holder-name" placeholder="Nome impresso no cartão" autoComplete="cc-name" />
<input required name="exp-month" placeholder="MM" inputMode="numeric" autoComplete="cc-exp-month" maxLength={2} onInput={keepDigits(2)} />
<input required name="exp-year" placeholder="AA" inputMode="numeric" autoComplete="cc-exp-year" maxLength={2} onInput={keepDigits(2)} />
<input required name="cvv" placeholder="CVV" inputMode="numeric" autoComplete="cc-csc" maxLength={4} onInput={keepDigits(4)} />
```

Year is **2 digits (AA)**, not 4. Do not merge month/year into one field (tests require both `name=`). Do not set React `value`. Do not POST PAN.

- [ ] **Step 4: Run tests**

Run: `cd frontend && node --test src/masks.test.mjs src/appmaxCard.test.mjs src/checkout.test.mjs`

Expected: all pass.

- [ ] **Step 5: Commit**

Skip. Do not commit.

---

### Task 5: Admin Pix key + auction date + R$ number fields

**Files:**
- Modify: `frontend/src/pages/Admin.jsx` (Pix key `onChange` by `pixKeyType`; format on load)
- Modify: `frontend/src/pages/AdminAuctions.jsx` (edition date; R$ `type="number"` settings)
- Modify: `frontend/src/masks.test.mjs`

**Interfaces:**
- Consumes: `formatPhoneBr`, `formatCpf`, `formatCnpj`, `formatBrDate`, `parseBrDate`, `isoToBrDate`; `formatBRLInput` / `parseBRL` from `api.js`
- Produces: Pix key masked in UI; `normalizeKey` still strips on EMV build. Edition POST `date` is `yyyy-mm-dd` via `parseBrDate`. Auction R$ settings sent as numbers via `parseBRL` on save.

- [ ] **Step 1: Append greps**

```javascript
const admin = fs.readFileSync(path.join(dir, 'pages/Admin.jsx'), 'utf8');
const auctions = fs.readFileSync(path.join(dir, 'pages/AdminAuctions.jsx'), 'utf8');
assert.equal(admin.includes('formatPhoneBr'), true, 'admin pix phone');
assert.equal(admin.includes('formatCpf'), true, 'admin pix cpf');
assert.equal(admin.includes('formatCnpj'), true, 'admin pix cnpj');
assert.equal(auctions.includes('formatBrDate'), true, 'leilão data BR');
assert.equal(auctions.includes('type="date"'), false, 'sem type=date');
assert.equal(auctions.includes('parseBrDate'), true, 'POST ISO');
console.log('OK masks admin');
```

- [ ] **Step 2: Run to fail**

Run: `cd frontend && node --test src/masks.test.mjs`

Expected: FAIL — Admin missing `formatCpf`.

- [ ] **Step 3: Admin Pix key**

In `Admin.jsx` import `{ formatPhoneBr, formatCpf, formatCnpj } from '../masks';`

Helper (local function in the file, next to pix state):

```javascript
function formatPixKey(type, value) {
  if (type === 'phone') return formatPhoneBr(value);
  if (type === 'cpf') return formatCpf(value);
  if (type === 'cnpj') return formatCnpj(value);
  return value;
}
```

When settings load into `pix`, set `pixKey: formatPixKey(d.pixKeyType || d.pixKeyType, d.pixKey)`.

`onChange` of tipo: `setPix({ ...pix, pixKeyType: e.target.value, pixKey: formatPixKey(e.target.value, pix.pixKey) })`

Chave input:

```javascript
<input
  value={pix.pixKey}
  onChange={(e) => setPix({ ...pix, pixKey: formatPixKey(pix.pixKeyType, e.target.value) })}
  required={!!(pix.commonFeeEnabled || pix.vipFeeEnabled || pix.premiumFeeEnabled)}
  placeholder={
    pix.pixKeyType === 'phone'
      ? '(38) 99999-9999'
      : pix.pixKeyType === 'cpf'
        ? '000.000.000-00'
        : pix.pixKeyType === 'cnpj'
          ? '00.000.000/0001-00'
          : 'Sua chave para receber a taxa'
  }
  inputMode={pix.pixKeyType === 'phone' ? 'tel' : (pix.pixKeyType === 'cpf' || pix.pixKeyType === 'cnpj' ? 'numeric' : undefined)}
/>
```

PUT body can still send `pixKey: pix.pixKey` — `normalizeKey` strips phone/cpf/cnpj. Email/random stay unmasked.

- [ ] **Step 4: AdminAuctions date + R$**

Import:

```javascript
import { formatBRLInput, parseBRL } from '../api';
import { formatBrDate, parseBrDate, isoToBrDate } from '../masks';
```

(Merge into the existing `api` import if present.)

Edition date input — replace `type="date"`:

```javascript
<div className="field">
  <label>Data</label>
  <input
    value={edForm.date}
    onChange={(e) => setEdForm({ ...edForm, date: formatBrDate(e.target.value) })}
    required
    inputMode="numeric"
    placeholder="dd/mm/aaaa"
  />
</div>
```

POST:

```javascript
date: parseBrDate(edForm.date),
```

If `parseBrDate` returns `''`, do not POST (setErr `'Data inválida.'` and return).

R$ settings that are currently `type="number" step="0.01"`: `startingBidMin`, `minIncrement`, `earlyUnlockFee`.

Display/onChange:

```javascript
<input
  value={formatBRLInput(String(Math.round(Number(settings.startingBidMin || 0) * 100)))}
  onChange={(e) => setS('startingBidMin', parseBRL(e.target.value))}
  inputMode="numeric"
  placeholder="0,00"
  disabled={!isMaster}
/>
```

Same pattern for `minIncrement` and `earlyUnlockFee`. `saveSettings` already sends `settings` numbers — `parseBRL` keeps them numeric.

`lotForm.minIncrement` (already text): `onChange={(e) => setLotForm({ ...lotForm, minIncrement: formatBRLInput(e.target.value) })}` and keep the existing `replace(',', '.')` on FormData **or** send `String(parseBRL(lotForm.minIncrement))`. Prefer `parseBRL` so `1.234,56` does not become `1.234.56`.

Leave hours/minutes/days/`type="time"`/`type="number"` integers untouched.

- [ ] **Step 5: Run tests**

Run: `cd frontend && node --test src/masks.test.mjs src/checkout.test.mjs src/appmaxCard.test.mjs src/catiraOffer.test.mjs src/intelligence.test.mjs src/officialProduct.test.mjs src/searchLayout.test.mjs`

Expected: all pass.

Run: `cd frontend && npm run build`

Expected: exit 0.

- [ ] **Step 6: Commit**

Skip. Do not commit.

---

### Task 6: Guard + existing suite (no new server)

**Files:** none unless a bug in Tasks 1–5.

- [ ] **Step 1: Guard strings**

Confirm Auth/Profile/LanceHub/Checkout use the helpers; Appmax still has the four `name=` attributes; no `type="date"` in `AdminAuctions.jsx`; Create/Search price still `formatBRLInput`.

- [ ] **Step 2: Re-run the frontend `*.test.mjs` list from Task 5 Step 5 plus `src/masks.test.mjs`.** Expected pass.

- [ ] **Step 3: If preview is already running**, type a phone on `/criar-conta` and CEP on checkout. Do not start a new server.

- [ ] **Step 4: Commit**

Skip. Do not commit.

---

## Spec coverage

| Spec | Task |
|---|---|
| helpers + unit cases | 1 |
| Auth / Profile / LanceHub phone | 2 |
| Checkout phone, CEP, UF, CPF/CNPJ | 3 |
| Appmax visual caps, no PAN rewrite | 4 |
| Admin Pix key by type | 5 |
| Auction `dd/mm/aaaa` + remaining R$ | 5 |
| money already using `formatBRLInput` | no change |
| tests + build | 5–6 |

## Placeholder scan

No TBD. Helper source, greps, and screen snippets are inlined.

## Type consistency

- `formatPhoneBr` / `formatCep` / `formatCpf` / `formatCnpj` / `formatCpfCnpj` / `formatUf` / `formatBrDate` / `parseBrDate` / `isoToBrDate` / `formatCardNumber` / `formatCardExpiry` / `formatCvv` defined in Task 1, consumed by 2–5.
- Checkout POST `documentNumber: digitsOnly(docNumber)`.
- Auction edition `date: parseBrDate(edForm.date)` ISO.
- Appmax year placeholder `AA`, `maxLength={2}`, fields stay split.
