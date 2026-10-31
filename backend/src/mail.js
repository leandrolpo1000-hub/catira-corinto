const fs = require('fs');
const nodemailer = require('nodemailer');
const db = require('./db');

const DEFAULTS = {
  id: 'mail',
  provider: 'resend',
  apiKey: '',
  fromEmail: '',
  fromName: 'CATIRA',
  enabled: false,
};

function hintKey(key) {
  const s = String(key || '');
  if (!s) return '';
  if (s.length < 8) return '••••';
  return s.slice(0, 3) + '••••' + s.slice(-4);
}

function getMailSettings() {
  const row = db.findOne('settings', (s) => s.id === 'mail') || {};
  return { ...DEFAULTS, ...row, id: 'mail' };
}

function publicMailSettings() {
  const s = getMailSettings();
  const apiKeySet = !!(s.apiKey && String(s.apiKey).trim());
  return {
    provider: 'resend',
    fromEmail: s.fromEmail || '',
    fromName: s.fromName || 'CATIRA',
    enabled: s.enabled === true || s.enabled === 'true' || s.enabled === 1,
    configured: apiKeySet && !!(s.fromEmail && String(s.fromEmail).trim()),
    apiKeySet,
    apiKeyHint: apiKeySet ? hintKey(s.apiKey) : '',
  };
}

function looksMasked(value) {
  return /[•*]/.test(String(value || ''));
}

function saveMailSettings(patch) {
  const current = getMailSettings();
  const incomingKey = patch.apiKey !== undefined ? String(patch.apiKey).trim() : '';
  const next = {
    id: 'mail',
    provider: 'resend',
    apiKey: incomingKey && !looksMasked(incomingKey) ? incomingKey : current.apiKey,
    fromEmail: patch.fromEmail !== undefined ? String(patch.fromEmail).trim() : current.fromEmail,
    fromName: patch.fromName !== undefined ? (String(patch.fromName).trim() || 'CATIRA') : (current.fromName || 'CATIRA'),
    enabled: patch.enabled === undefined
      ? (current.enabled === true || current.enabled === 'true' || current.enabled === 1)
      : (patch.enabled === true || patch.enabled === 'true' || patch.enabled === 1),
  };
  if (next.enabled && !next.apiKey) {
    const err = new Error('Informe a API key do Resend.');
    err.status = 400;
    throw err;
  }
  if (next.enabled && !next.fromEmail) {
    const err = new Error('Informe o e-mail remetente do Resend.');
    err.status = 400;
    throw err;
  }
  if (next.fromEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.fromEmail)) {
    const err = new Error('E-mail remetente inválido.');
    err.status = 400;
    throw err;
  }
  const existing = db.findById('settings', 'mail');
  return existing ? db.update('settings', 'mail', next) : db.insert('settings', next);
}

function mailFrom() {
  const s = getMailSettings();
  if (s.fromEmail) {
    const name = (s.fromName || 'CATIRA').replace(/[<>]/g, '');
    return name + ' <' + s.fromEmail + '>';
  }
  return process.env.CATIRA_MAIL_FROM || 'CATIRA <noreply@catira.com>';
}

function hasSmtp() {
  return !!(process.env.CATIRA_SMTP_HOST || process.env.SMTP_HOST);
}

function resendReady() {
  const s = getMailSettings();
  return !!(s.enabled && s.apiKey && s.fromEmail);
}

function sendmailPath() {
  const p = process.env.SENDMAIL_PATH || '/usr/sbin/sendmail';
  return fs.existsSync(p) ? p : '';
}

function createTransport() {
  const host = process.env.CATIRA_SMTP_HOST || process.env.SMTP_HOST;
  if (host) {
    const user = process.env.CATIRA_SMTP_USER || process.env.SMTP_USER || '';
    const pass = process.env.CATIRA_SMTP_PASS || process.env.SMTP_PASS || '';
    return nodemailer.createTransport({
      host,
      port: Number(process.env.CATIRA_SMTP_PORT || process.env.SMTP_PORT || 587),
      secure: process.env.CATIRA_SMTP_SECURE === 'true' || process.env.SMTP_SECURE === 'true',
      auth: user ? { user, pass } : undefined,
    });
  }
  const path = sendmailPath();
  if (!path) {
    const err = new Error('Envio de e-mail não configurado.');
    err.code = 'NO_MAILER';
    throw err;
  }
  return nodemailer.createTransport({
    sendmail: true,
    newline: 'unix',
    path,
  });
}

async function sendViaResend({ to, subject, text, html }) {
  const s = getMailSettings();
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + s.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: mailFrom(),
      to: [to],
      subject,
      text,
      html: html || undefined,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body && (body.message || body.error) ? (body.message || body.error) : 'Falha no Resend.';
    const err = new Error(typeof msg === 'string' ? msg : 'Falha no Resend.');
    err.status = res.status;
    throw err;
  }
  return body;
}

async function sendMail({ to, subject, text, html }) {
  if (resendReady()) {
    return sendViaResend({ to, subject, text, html });
  }
  const transport = createTransport();
  await transport.sendMail({
    from: mailFrom(),
    to,
    subject,
    text,
    html: html || undefined,
  });
}

async function sendVerificationCode(to, code) {
  const subject = 'Confirme seu e-mail no CATIRA';
  const text =
    'Olá!\n\nSeu código para confirmar o e-mail no CATIRA é: ' +
    code +
    '\n\nEle vale por 15 minutos. Se você não criou esta conta, ignore esta mensagem.';
  const html =
    '<p>Olá!</p><p>Seu código para confirmar o e-mail no CATIRA é:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">' +
    code +
    '</p><p>Ele vale por 15 minutos. Se você não criou esta conta, ignore esta mensagem.</p>';
  await sendMail({ to, subject, text, html });
}

async function sendTestEmail(to) {
  const subject = 'Teste de e-mail do CATIRA';
  const text = 'Se você recebeu esta mensagem, o Resend do CATIRA está funcionando.';
  const html = '<p>Se você recebeu esta mensagem, o Resend do CATIRA está funcionando.</p>';
  await sendMail({ to, subject, text, html });
}

module.exports = {
  sendMail,
  sendVerificationCode,
  sendTestEmail,
  hasSmtp,
  resendReady,
  getMailSettings,
  publicMailSettings,
  saveMailSettings,
};
