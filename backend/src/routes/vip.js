const express = require('express');
const db = require('../db');
const { authRequired, publicUser } = require('../middleware');
const { isVipUser } = require('../helpers');
const { getSettings, vipAccessFee, vipDays, vipWhatsappGroup, buildPix } = require('../pix');
const QRCode = require('qrcode');

const router = express.Router();

function publicPayment(p) {
  if (!p) return null;
  const cfg = getSettings();
  return {
    id: p.id,
    amount: p.amount,
    originalAmount: p.originalAmount || p.amount,
    status: p.status,
    method: p.method,
    kind: p.kind,
    pixCode: p.pixCode,
    transactionId: p.transactionId,
    pixKey: p.pixKey || cfg.pixKey,
    createdAt: p.createdAt,
    paidAt: p.paidAt,
    userDeclaredAt: p.userDeclaredAt || null,
    vipDays: p.vipDays,
    configured: cfg.configured,
    merchantName: cfg.merchantName,
  };
}

async function ensureVipPayment(user) {
  const fee = vipAccessFee();
  const days = vipDays();
  let payment = db.findOne(
    'payments',
    (p) => p.userId === user.id && p.kind === 'vip_access' && p.status !== 'paid' && p.status !== 'rejected'
  );
  const cfg = getSettings();
  const now = new Date().toISOString();
  if (!payment) {
    const txid = ('VIP' + String(user.id).replace(/-/g, '') + Date.now().toString(36)).replace(/[^A-Za-z0-9]/g, '').slice(0, 25);
    const pix = cfg.configured
      ? buildPix({ amount: fee, txid, description: 'Acesso VIP CATIRA' })
      : { pixCode: '', transactionId: txid, pixKey: '' };
    payment = db.insert('payments', {
      userId: user.id,
      listingId: null,
      kind: 'vip_access',
      amount: fee,
      originalAmount: fee,
      discountPercent: 0,
      promoCode: '',
      promoApplied: true,
      status: 'pending',
      method: 'pix',
      transactionId: pix.transactionId || txid,
      pixCode: pix.pixCode || '',
      pixKey: pix.pixKey || '',
      vipDays: days,
      createdAt: now,
      paidAt: null,
      userDeclaredAt: null,
    });
  } else if (Number(payment.amount) !== fee || payment.vipDays !== days || !payment.pixCode) {
    const txid = payment.transactionId || ('VIP' + String(user.id).replace(/-/g, '')).replace(/[^A-Za-z0-9]/g, '').slice(0, 25);
    const pix = cfg.configured
      ? buildPix({ amount: fee, txid, description: 'Acesso VIP CATIRA' })
      : { pixCode: '', transactionId: txid, pixKey: '' };
    payment = db.update('payments', payment.id, {
      amount: fee,
      originalAmount: fee,
      vipDays: days,
      pixCode: pix.pixCode || payment.pixCode || '',
      pixKey: pix.pixKey || '',
      transactionId: pix.transactionId || txid,
    });
  }
  let qrDataUrl = '';
  if (payment.pixCode && Number(payment.amount) > 0) {
    try {
      qrDataUrl = await QRCode.toDataURL(payment.pixCode, { margin: 1, width: 280 });
    } catch {}
  }
  return { payment, qrDataUrl, fee, days, configured: cfg.configured };
}

router.get('/', authRequired, async (req, res) => {
  const user = publicUser(req.user);
  if (isVipUser(req.user)) {
    return res.json({
      user,
      payment: null,
      fee: vipAccessFee(),
      days: vipDays(),
      whatsappGroup: vipWhatsappGroup(),
      qrDataUrl: '',
      pixConfigured: getSettings().configured,
    });
  }
  const d = await ensureVipPayment(req.user);
  res.json({
    user,
    payment: publicPayment(d.payment),
    fee: d.fee,
    days: d.days,
    qrDataUrl: d.qrDataUrl,
    pixConfigured: d.configured,
    whatsappGroup: '',
  });
});

router.post('/pay', authRequired, async (req, res) => {
  const d = await ensureVipPayment(req.user);
  const payment = d.payment;
  if (payment.status === 'paid') {
    return res.json({
      user: publicUser(req.user),
      payment: publicPayment(payment),
      published: true,
    });
  }
  const now = new Date().toISOString();
  const updated = db.update('payments', payment.id, {
    userDeclaredAt: now,
    status: 'awaiting_confirmation',
  });
  res.json({
    user: publicUser(req.user),
    payment: publicPayment(updated),
    published: false,
    message: 'Pagamento informado. O VIP será liberado após a confirmação.',
  });
});

module.exports = router;
