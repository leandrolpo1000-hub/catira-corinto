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
