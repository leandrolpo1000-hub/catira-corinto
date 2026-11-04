const express = require('express');
const { timingSafeEqual } = require('crypto');
const { effectiveWebhookToken } = require('../appmax');

const router = express.Router();

function configuredToken() {
  return effectiveWebhookToken();
}

function tokensMatch(provided, expected) {
  if (!expected || !provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

router.post('/:token', async (req, res, next) => {
  try {
    const expected = configuredToken();
    if (!tokensMatch(req.params.token, expected)) {
      return res.status(404).json({ error: 'Não encontrado.' });
    }
    const orders = require('../orders');
    await orders.handleAppmaxWebhook(req.body || {});
    return res.status(200).json({ ok: true });
  } catch (err) {
    if (err && err.status) {
      return res.status(err.status).json({ error: err.message || 'Falha no webhook.' });
    }
    return next(err);
  }
});

module.exports = router;
