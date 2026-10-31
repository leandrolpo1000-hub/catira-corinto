const jwt = require('jsonwebtoken');
const db = require('./db');

const ADMIN_ROLES = ['admin', 'master'];

function isAdminRole(role) {
  return ADMIN_ROLES.includes(role);
}

function isVipUser() {
  return false;
}

const JWT_SECRET = process.env.CATIRA_JWT_SECRET || 'catira-corinto-dev-secret-change-me';

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function publicUser(u) {
  if (!u) return null;
  const dealer = extraDealer(u);
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    city: u.city,
    cityId: u.cityId,
    role: u.role,
    status: u.status,
    phoneVerified: !!u.phoneVerified,
    emailVerified: !!u.emailVerified,
    createdAt: u.createdAt,
    ratingAvg: u.ratingAvg || 0,
    ratingCount: u.ratingCount || 0,
    avatarColor: u.avatarColor || '#E85D04',
    dealerStatus: dealer.dealerStatus,
    dealerFounder: dealer.dealerFounder,
    dealerBenefitUntil: dealer.dealerBenefitUntil,
  };
}

function extraDealer(u) {
  if (!u) return { dealerStatus: 'none', dealerFounder: false, dealerBenefitUntil: null };
  try {
    const lance = require('./lance');
    if (!lance || typeof lance.dealerPublic !== 'function') {
      return { dealerStatus: 'none', dealerFounder: false, dealerBenefitUntil: null };
    }
    return lance.dealerPublic(u);
  } catch {
    return { dealerStatus: 'none', dealerFounder: false, dealerBenefitUntil: null };
  }
}

function safeUser(u) {
  if (!u) return null;
  const { email, phone, ...rest } = publicUser(u);
  return {
    id: rest.id,
    name: rest.name,
    city: rest.city,
    cityId: rest.cityId,
    phoneVerified: rest.phoneVerified,
    emailVerified: rest.emailVerified,
    createdAt: rest.createdAt,
    ratingAvg: rest.ratingAvg,
    ratingCount: rest.ratingCount,
    avatarColor: rest.avatarColor,
    listingsCount: db.count('listings', (l) => l.userId === u.id && l.status === 'published'),
  };
}

function authOptional(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.findById('users', payload.id);
    req.user = user && user.status !== 'blocked' ? user : null;
  } catch {
    req.user = null;
  }
  next();
}

function authRequired(req, res, next) {
  authOptional(req, res, () => {
    if (!req.user) return res.status(401).json({ error: 'Faça login para continuar.' });
    if (req.user.status === 'blocked') {
      return res.status(403).json({ error: 'Sua conta foi bloqueada.' });
    }
    next();
  });
}

function adminRequired(req, res, next) {
  authRequired(req, res, () => {
    if (!isAdminRole(req.user.role)) {
      return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
    }
    next();
  });
}

function masterRequired(req, res, next) {
  authRequired(req, res, () => {
    if (req.user.role !== 'master') {
      return res.status(403).json({ error: 'Acesso restrito ao admin master.' });
    }
    next();
  });
}

function emailVerifiedRequired(req, res, next) {
  if (isAdminRole(req.user && req.user.role)) return next();
  if (req.user && req.user.emailVerified) return next();
  return res.status(403).json({ error: 'Confirme seu e-mail para publicar um anúncio.', emailVerifyRequired: true });
}

module.exports = {
  JWT_SECRET,
  signToken,
  publicUser,
  safeUser,
  authOptional,
  authRequired,
  adminRequired,
  masterRequired,
  emailVerifiedRequired,
  isAdminRole,
  ADMIN_ROLES,
};
