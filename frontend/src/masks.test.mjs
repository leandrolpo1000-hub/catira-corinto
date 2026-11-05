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

const checkout = fs.readFileSync(path.join(dir, 'pages/Checkout.jsx'), 'utf8');
assert.equal(checkout.includes('formatPhoneBr'), true, 'checkout telefone');
assert.equal(checkout.includes('formatCep'), true, 'checkout CEP');
assert.equal(checkout.includes('formatUf'), true, 'checkout UF');
assert.equal(checkout.includes('formatCpfCnpj'), true, 'checkout CPF/CNPJ');
assert.equal(checkout.includes('digitsOnly(docNumber)'), true, 'doc só dígitos no POST');
console.log('OK masks checkout');

const cardForm = fs.readFileSync(path.join(dir, 'AppmaxCardForm.jsx'), 'utf8');
assert.equal(cardForm.includes('name="card-number"'), true, 'name card-number');
assert.equal(cardForm.includes('name="exp-month"'), true, 'name exp-month');
assert.equal(cardForm.includes('name="exp-year"'), true, 'name exp-year');
assert.equal(cardForm.includes('name="cvv"'), true, 'name cvv');
assert.equal(cardForm.includes('placeholder="AAAA"'), false, 'ano não AAAA');
assert.equal(cardForm.includes('placeholder="AA"'), true, 'ano AA');
  assert.equal(cardForm.includes('maxLength={16}') || cardForm.includes('maxLength="16"'), true, 'cartão 16');
console.log('OK masks card form');

const admin = fs.readFileSync(path.join(dir, 'pages/Admin.jsx'), 'utf8');
const auctions = fs.readFileSync(path.join(dir, 'pages/AdminAuctions.jsx'), 'utf8');
assert.equal(admin.includes('formatPhoneBr'), true, 'admin pix phone');
assert.equal(admin.includes('formatCpf'), true, 'admin pix cpf');
assert.equal(admin.includes('formatCnpj'), true, 'admin pix cnpj');
assert.equal(auctions.includes('formatBrDate'), true, 'leilão data BR');
assert.equal(auctions.includes('type="date"'), false, 'sem type=date');
assert.equal(auctions.includes('parseBrDate'), true, 'POST ISO');
console.log('OK masks admin');
