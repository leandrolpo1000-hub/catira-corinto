const express = require('express');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const db = require('../db');
const { signToken, publicUser, authRequired, isAdminRole } = require('../middleware');
const { sendVerificationCode } = require('../mail');

const router = express.Router();

const { CITY_NAMES } = require('../seed');
const CODE_TTL_MS = 15 * 60 * 1000;

function sixDigitCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function latestOpenCode(userId) {
  return db
    .findWhere('emailVerifications', (r) => r.userId === userId && !r.used)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
}

async function issueEmailCode(user) {
  db.findWhere('emailVerifications', (r) => r.userId === user.id && !r.used).forEach((r) => {
    db.update('emailVerifications', r.id, { used: true });
  });
  const code = sixDigitCode();
  const now = Date.now();
  db.insert('emailVerifications', {
    id: randomUUID(),
    userId: user.id,
    email: user.email,
    code,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CODE_TTL_MS).toISOString(),
    used: false,
  });
  let emailed = false;
  let mailError = '';
  try {
    await sendVerificationCode(user.email, code);
    emailed = true;
  } catch (e) {
    mailError = e && e.message ? e.message : 'Falha ao enviar e-mail.';
  }
  return { code, emailed, mailError };
}

router.get('/cities', (_req, res) => {
  const cities = db.all('cities').filter((c) => c.active);
  res.json(cities.length ? cities : CITY_NAMES.map((name) => ({ name, state: 'MG' })));
});

router.post('/register', async (req, res) => {
  const { name, email, phone, city, cityId, password, passwordConfirm } = req.body || {};
  if (!name || !email || !phone || !city || !password) {
    return res.status(400).json({ error: 'Preencha nome, e-mail, telefone, cidade e senha.' });
  }
  if (passwordConfirm !== undefined && String(password) !== String(passwordConfirm)) {
    return res.status(400).json({ error: 'As senhas não coincidem.' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'A senha precisa ter pelo menos 6 caracteres.' });
  }
  const exists = db.findOne('users', (u) => u.email.toLowerCase() === String(email).toLowerCase());
  if (exists) return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });

  const user = db.insert('users', {
    name: String(name).trim(),
    email: String(email).trim().toLowerCase(),
    phone: String(phone).replace(/\D/g, ''),
    city: String(city).trim(),
    cityId: cityId || '',
    passwordHash: bcrypt.hashSync(String(password), 10),
    role: 'user',
    status: 'active',
    phoneVerified: true,
    emailVerified: false,
    createdAt: new Date().toISOString(),
    ratingAvg: 0,
    ratingCount: 0,
    avatarColor: ['#E85D04', '#2D6A4F', '#9B2226', '#1D3557', '#7B2D8E'][Math.floor(Math.random() * 5)],
  });

  const issued = await issueEmailCode(user);
  const token = signToken(user);
  res.status(201).json({
    token,
    user: publicUser(user),
    emailSent: issued.emailed,
    needsEmailVerification: true,
    demoCode: issued.emailed ? undefined : issued.code,
  });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Informe e-mail e senha.' });
  const user = db.findOne('users', (u) => u.email.toLowerCase() === String(email).toLowerCase());
  if (!user || !bcrypt.compareSync(String(password), user.passwordHash)) {
    return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  }
  if (user.status === 'blocked') {
    return res.status(403).json({ error: 'Sua conta foi bloqueada.' });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/me', authRequired, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.put('/me', authRequired, (req, res) => {
  const { name, phone, city, cityId } = req.body || {};
  const patch = {};
  if (name) patch.name = String(name).trim();
  if (phone) patch.phone = String(phone).replace(/\D/g, '');
  if (city) patch.city = String(city).trim();
  if (cityId !== undefined) patch.cityId = cityId;
  const updated = db.update('users', req.user.id, patch);
  res.json({ user: publicUser(updated) });
});

router.post('/verify-email', authRequired, async (req, res) => {
  if (req.user.emailVerified) {
    return res.json({ ok: true, already: true, user: publicUser(req.user) });
  }
  const code = String((req.body && req.body.code) || '').trim();
  if (!code) return res.status(400).json({ error: 'Informe o código enviado no e-mail.' });
  const rec = latestOpenCode(req.user.id);
  if (!rec || rec.code !== code) return res.status(400).json({ error: 'Código inválido.' });
  if (new Date(rec.expiresAt).getTime() < Date.now()) {
    return res.status(400).json({ error: 'Código expirado. Peça um novo.' });
  }
  db.update('emailVerifications', rec.id, { used: true });
  const updated = db.update('users', req.user.id, { emailVerified: true });
  res.json({ ok: true, user: publicUser(updated) });
});

router.post('/resend-verification', authRequired, async (req, res) => {
  if (isAdminRole(req.user.role) || req.user.emailVerified) {
    return res.json({ ok: true, already: true, user: publicUser(req.user) });
  }
  const last = latestOpenCode(req.user.id);
  if (last && Date.now() - new Date(last.createdAt).getTime() < 60000) {
    return res.status(429).json({ error: 'Aguarde um minuto para pedir outro código.' });
  }
  const issued = await issueEmailCode(req.user);
  res.json({
    ok: true,
    emailSent: issued.emailed,
    message: issued.emailed
      ? 'Enviamos um novo código para o seu e-mail.'
      : 'Não foi possível enviar o e-mail agora. Use o código abaixo.',
    demoCode: issued.emailed ? undefined : issued.code,
  });
});

router.post('/forgot', (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Informe o e-mail.' });
  const user = db.findOne('users', (u) => u.email.toLowerCase() === String(email).toLowerCase());
  if (!user) {
    return res.json({ ok: true, message: 'Se o e-mail existir, enviaremos as instruções.' });
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  db.insert('passwordResets', {
    id: randomUUID(),
    userId: user.id,
    code,
    email: user.email,
    createdAt: new Date().toISOString(),
    used: false,
  });
  res.json({
    ok: true,
    message: 'Código gerado. Em produção isso iria por e-mail.',
    demoCode: code,
  });
});

router.post('/reset', (req, res) => {
  const { email, code, password } = req.body || {};
  if (!email || !code || !password) {
    return res.status(400).json({ error: 'Informe e-mail, código e nova senha.' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'A senha precisa ter pelo menos 6 caracteres.' });
  }
  const rec = db.findOne(
    'passwordResets',
    (r) => r.email === String(email).toLowerCase() && r.code === String(code) && !r.used
  );
  if (!rec) return res.status(400).json({ error: 'Código inválido ou expirado.' });
  const user = db.findById('users', rec.userId);
  if (!user) return res.status(400).json({ error: 'Usuário não encontrado.' });
  db.update('users', user.id, { passwordHash: bcrypt.hashSync(String(password), 10) });
  db.update('passwordResets', rec.id, { used: true });
  res.json({ ok: true, message: 'Senha redefinida. Faça login.' });
});

module.exports = router;
