const express = require('express');
const { authRequired, adminRequired } = require('../middleware');

const UNAVAILABLE = 'A compra pelo Catira ainda não está disponível nesta fase.';

function denyPublic(_req, res) {
  return res.status(403).json({ error: UNAVAILABLE });
}

function sendErr(res, err) {
  const status = (err && err.status) || 500;
  return res.status(status).json({ error: (err && err.message) || 'Falha no pedido.' });
}

function asOwner(req, order) {
  if (!order || order.userId !== req.user.id) {
    const err = new Error('Pedido não encontrado.');
    err.status = 404;
    throw err;
  }
  return order;
}

const router = express.Router();

router.post('/', authRequired, (req, res) => {
  try {
    const orders = require('../orders');
    const body = req.body || {};
    const out = orders.createOrder({
      userId: req.user.id,
      offerId: body.offerId,
      quantity: body.quantity == null ? 1 : body.quantity,
      address: body.address,
      idempotencyKey: body.idempotencyKey,
    });
    return res.json(orders.serializeBuyerOrder(out));
  } catch (err) {
    return sendErr(res, err);
  }
});

router.get('/', authRequired, denyPublic);

router.get('/:id', authRequired, (req, res) => {
  try {
    const orders = require('../orders');
    const detail = orders.getOrder(req.params.id);
    asOwner(req, detail.order);
    return res.json(orders.serializeBuyerOrder(detail));
  } catch (err) {
    if (err && err.status === 404) return res.status(404).json({ error: 'Pedido não encontrado.' });
    return sendErr(res, err);
  }
});

router.post('/:id/pix', authRequired, async (req, res) => {
  try {
    const orders = require('../orders');
    const detail = orders.getOrder(req.params.id);
    asOwner(req, detail.order);
    const charged = await orders.preparePixCharge(req.params.id, req.body || {});
    return res.json(orders.serializeBuyerOrder(charged));
  } catch (err) {
    if (err && err.status === 404) return res.status(404).json({ error: 'Pedido não encontrado.' });
    return sendErr(res, err);
  }
});

router.get('/:id/installments', authRequired, async (req, res) => {
  try {
    const orders = require('../orders');
    const detail = orders.getOrder(req.params.id);
    asOwner(req, detail.order);
    const quoted = await orders.quoteInstallments(req.params.id, {
      installments: req.query.installments,
    });
    return res.json(quoted);
  } catch (err) {
    if (err && err.status === 404) return res.status(404).json({ error: 'Pedido não encontrado.' });
    return sendErr(res, err);
  }
});

router.post('/:id/card', authRequired, async (req, res) => {
  try {
    const orders = require('../orders');
    const detail = orders.getOrder(req.params.id);
    asOwner(req, detail.order);
    const charged = await orders.prepareCardCharge(req.params.id, req.body || {});
    return res.json(orders.serializeBuyerOrder(charged));
  } catch (err) {
    if (err && err.status === 404) return res.status(404).json({ error: 'Pedido não encontrado.' });
    return sendErr(res, err);
  }
});

const checkout = express.Router();
checkout.post('/sessions', authRequired, denyPublic);
checkout.get('/sessions/:id', authRequired, denyPublic);

function attachAdmin(adminRouter) {
  adminRouter.get('/orders', adminRequired, (req, res) => {
    const orders = require('../orders');
    res.json(orders.listOrdersAdmin(req.query));
  });
  adminRouter.get('/orders/:id', adminRequired, (req, res) => {
    const orders = require('../orders');
    const detail = orders.getOrderAdmin(req.params.id);
    if (!detail) return res.status(404).json({ error: 'Pedido não encontrado.' });
    res.json(detail);
  });
}

module.exports = router;
module.exports.checkout = checkout;
module.exports.attachAdmin = attachAdmin;
module.exports.UNAVAILABLE = UNAVAILABLE;
