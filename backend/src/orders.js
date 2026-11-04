const db = require('./db');
const official = require('./official');

const SESSION_TTL_MS = 30 * 60 * 1000;
const OPEN_ORDER_STATUSES = ['draft', 'awaiting_payment'];
const OPEN_SESSION_STATUSES = ['open'];
const UF = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);
const CLIENT_PRICE_KEYS = ['unitPrice', 'total', 'unitPriceCents', 'totalCents', 'price', 'freight', 'discount', 'freightCents', 'discountCents'];
const TRANSITIONS = {
  draft: ['awaiting_payment', 'cancelled'],
  awaiting_payment: ['paid', 'expired', 'failed', 'cancelled'],
  paid: ['awaiting_supplier', 'refunded'],
  awaiting_supplier: ['purchased', 'refunded'],
  purchased: ['shipped', 'refunded'],
  shipped: ['completed', 'refunded'],
  completed: ['refunded'],
  expired: [],
  failed: [],
  cancelled: [],
  refunded: [],
};

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function nowIso(ms) {
  return new Date(ms || Date.now()).toISOString();
}

function digits(raw) {
  return String(raw || '').replace(/\D/g, '');
}

const MAX_UNIT_CENTS = 99999999;

function toCents(reais) {
  const value = Number(reais);
  if (!Number.isFinite(value) || value < 0) return 0;
  const cents = Math.round(Number((value * 100).toFixed(8)));
  if (cents > MAX_UNIT_CENTS) throw httpError(400, 'Valor acima do limite permitido.');
  return cents;
}

function clip(raw, max) {
  return String(raw || '').trim().slice(0, max);
}

function ipOf(raw) {
  if (raw && typeof raw === 'object' && raw.ip != null) return clip(raw.ip, 45);
  return clip(raw, 45);
}

function validateAddress(raw) {
  const input = raw || {};
  const recipientName = clip(input.recipientName, 120);
  const phone = digits(input.phone);
  const cep = digits(input.cep);
  const street = clip(input.street, 180);
  const number = clip(input.number, 20);
  const complement = clip(input.complement, 80);
  const district = clip(input.district, 80);
  const city = clip(input.city, 80);
  const state = clip(input.state, 2).toUpperCase();
  const cityId = clip(input.cityId, 80);
  if (!recipientName || !street || !number || !district || !city) {
    throw httpError(400, 'Informe destinatário, logradouro, número, bairro e cidade.');
  }
  if (phone.length < 10 || phone.length > 11) {
    throw httpError(400, 'Telefone de entrega inválido.');
  }
  if (cep.length !== 8) {
    throw httpError(400, 'CEP deve ter 8 dígitos.');
  }
  if (!UF.has(state)) {
    throw httpError(400, 'UF inválida.');
  }
  return {
    recipientName,
    phone,
    cep,
    street,
    number,
    complement,
    district,
    city,
    state,
    cityId,
  };
}

function rejectClientPrices(input) {
  if (!input) return;
  for (let i = 0; i < CLIENT_PRICE_KEYS.length; i++) {
    if (input[CLIENT_PRICE_KEYS[i]] !== undefined) {
      throw httpError(400, 'O valor do pedido é calculado pelo servidor.');
    }
  }
}

function catiraOfferOf(offerId) {
  const offer = db.findById('officialProductOffers', offerId);
  if (!offer) throw httpError(404, 'Oferta não encontrada.');
  if (offer.provider !== 'catira') {
    throw httpError(400, 'Somente a oferta Catira gera pedido interno.');
  }
  if (offer.enabled === false || !['manual', 'active'].includes(offer.status || 'manual')) {
    throw httpError(400, 'Oferta Catira indisponível.');
  }
  if (!(toCents(offer.price) > 0)) {
    throw httpError(400, 'Oferta Catira sem preço.');
  }
  if (offer.buyEnabled !== true) {
    throw httpError(403, 'A compra pelo Catira ainda não está disponível nesta fase.');
  }
  return offer;
}

function quantityOf(raw) {
  const qty = Number(raw);
  if (!Number.isInteger(qty) || qty < 1 || qty > 999) {
    throw httpError(400, 'Quantidade inválida.');
  }
  return qty;
}

function findByIdempotencyKey(key) {
  if (!key) return null;
  return db.findOne('orders', (o) => o.idempotencyKey === key) || null;
}

function findOpenOrder(userId, offerId) {
  return db.findOne(
    'orders',
    (o) => o.userId === userId && o.offerId === offerId && OPEN_ORDER_STATUSES.includes(o.status)
  ) || null;
}

function findOpenSession(userId, offerId, now) {
  return db.findOne('checkoutSessions', (s) => (
    s.userId === userId
    && s.offerId === offerId
    && OPEN_SESSION_STATUSES.includes(s.status)
    && new Date(s.expiresAt).getTime() > now
  )) || null;
}

function appendEvent(orderId, patch) {
  return db.insert('orderEvents', {
    orderId,
    type: patch.type,
    fromStatus: patch.fromStatus || null,
    toStatus: patch.toStatus || null,
    source: patch.source || 'system',
    payload: patch.payload || null,
    at: patch.at || nowIso(),
  }, { allowOrderWrite: true });
}

function itemsOf(orderId) {
  return db.findWhere('orderItems', (i) => i.orderId === orderId);
}

function eventsOf(orderId) {
  return db
    .findWhere('orderEvents', (e) => e.orderId === orderId)
    .sort((a, b) => new Date(a.at) - new Date(b.at));
}

function getOrder(orderId) {
  const order = db.findById('orders', orderId);
  if (!order) throw httpError(404, 'Pedido não encontrado.');
  return { order, items: itemsOf(orderId), events: eventsOf(orderId) };
}

function updateOrderSnapshot() {
  throw httpError(409, 'O snapshot do pedido é imutável.');
}

function splitRecipientName(raw) {
  const parts = String(raw || '').trim().split(/\s+/).filter(Boolean);
  const first_name = parts[0] || 'Cliente';
  const last_name = parts.slice(1).join(' ') || first_name;
  return { first_name, last_name };
}

function patchOrder(orderId, patch) {
  const opts = { allowOrderWrite: true };
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'address')) {
    opts.allowAddressUpdate = true;
  }
  return db.update('orders', orderId, { ...patch, updatedAt: nowIso() }, opts);
}

function pixFromResponse(raw) {
  const src = raw || {};
  const nested = src.pix || src.payment || src;
  return {
    pixEmv: nested.pix_emv || nested.pixEmv || src.pix_emv || null,
    pixQrcode: nested.pix_qrcode || nested.pixQrcode || src.pix_qrcode || null,
    pixExpirationDate: nested.pix_expiration_date || nested.pixExpirationDate || src.pix_expiration_date || null,
    pixRef: nested.pix_ref || nested.pixRef || src.pix_ref || null,
  };
}

const CARD_FORBIDDEN = ['number', 'cvv', 'expiration_month', 'expiration_year'];

function rejectCardSecrets(input) {
  const src = input || {};
  const nested = src.credit_card || (src.payment_data && src.payment_data.credit_card) || {};
  for (let i = 0; i < CARD_FORBIDDEN.length; i++) {
    const key = CARD_FORBIDDEN[i];
    if (src[key] !== undefined || nested[key] !== undefined) {
      throw httpError(400, 'Pagamento com cartão exige token gerado no frontend. Não envie dados do cartão.');
    }
  }
}

function installmentCount(raw) {
  const n = raw == null || raw === '' ? 1 : Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 12) {
    throw httpError(400, 'Quantidade de parcelas inválida.');
  }
  return n;
}

function installmentsListOf(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.installments)) return raw.installments;
  if (raw && raw.data && Array.isArray(raw.data.installments)) return raw.data.installments;
  return [];
}

function cardFromResponse(raw) {
  const src = raw || {};
  const payment = src.payment || src.pay || (src.data && src.data.payment) || src;
  const appmaxOrder = src.order || (src.data && src.data.order) || {};
  return {
    appmaxPaymentId: payment && payment.id != null ? payment.id : null,
    appmaxPaymentStatus: (payment && payment.status) || appmaxOrder.status || null,
    cardInstallments: payment && payment.installments != null ? payment.installments : null,
  };
}

async function ensureAppmaxOrder(orderId, { documentNumber, ip }, appmax) {
  let { order, items } = getOrder(orderId);
  const buyer = db.findById('users', order.userId);
  if (!buyer || !buyer.email) throw httpError(400, 'Usuário inválido.');
  const address = order.address || {};

  if (order.appmaxCustomerId == null) {
    const names = splitRecipientName(address.recipientName);
    const customer = await appmax.createCustomer({
      first_name: names.first_name,
      last_name: names.last_name,
      email: buyer.email,
      phone: address.phone,
      document_number: documentNumber,
      ip,
      address: {
        postcode: address.cep,
        street: address.street,
        number: address.number,
        complement: address.complement,
        district: address.district,
        city: address.city,
        state: address.state,
      },
    });
    patchOrder(order.id, { appmaxCustomerId: customer.id });
    appendEvent(order.id, {
      type: 'order.appmax_customer_created',
      source: 'appmax',
      payload: { appmaxCustomerId: customer.id },
    });
    order = getOrder(orderId).order;
  }

  if (order.appmaxOrderId == null) {
    const line = items[0] || {};
    const productsValue = order.unitPriceCents * order.quantity;
    const appmaxOrder = await appmax.createOrder({
      customer_id: order.appmaxCustomerId,
      products_value: productsValue,
      discount_value: order.discountCents,
      shipping_value: order.freightCents,
      products: [{
        sku: line.sku || order.offerId,
        name: (order.productSnapshot && order.productSnapshot.title) || line.title || 'Pedido Catira',
        quantity: order.quantity,
        unit_value: order.unitPriceCents,
        type: 'physical',
      }],
    });
    patchOrder(order.id, { appmaxOrderId: appmaxOrder.id });
    appendEvent(order.id, {
      type: 'order.appmax_order_created',
      source: 'appmax',
      payload: { appmaxOrderId: appmaxOrder.id },
    });
  }
  return getOrder(orderId);
}

function appmaxClientOf(opts) {
  if (opts && opts.appmax) return opts.appmax;
  return require('./appmax').createClient();
}

async function preparePixCharge(orderId, input, opts) {
  rejectClientPrices(input);
  const documentNumber = digits(input && (input.documentNumber || input.document_number));
  const ip = ipOf(input && input.ip);
  if (documentNumber.length !== 11 && documentNumber.length !== 14) {
    throw httpError(400, 'Informe o CPF ou CNPJ do pagador.');
  }
  if (!ip) throw httpError(400, 'IP do comprador é obrigatório (Appmax JS).');

  let { order, items } = getOrder(orderId);
  if (order.status === 'paid' || order.status === 'refunded' || order.status === 'completed') {
    throw httpError(409, 'Pedido pago não aceita nova cobrança Pix.');
  }
  if (!['draft', 'awaiting_payment'].includes(order.status)) {
    throw httpError(409, 'Pedido não aceita nova cobrança Pix.');
  }
  if (order.pixEmv && order.appmaxOrderId) {
    return getOrder(orderId);
  }

  if (order.paymentMethod === 'credit_card' && order.appmaxPaymentId) {
    throw httpError(409, 'Pedido com cartão não aceita cobrança Pix.');
  }

  const appmax = appmaxClientOf(opts);
  ({ order, items } = await ensureAppmaxOrder(orderId, { documentNumber, ip }, appmax));

  if (!order.pixEmv) {
    const pixRaw = await appmax.createPixPayment({
      order_id: order.appmaxOrderId,
      document_number: documentNumber,
    });
    const pix = pixFromResponse(pixRaw);
    if (!pix.pixEmv) throw httpError(502, 'Resposta inválida da Appmax.');
    patchOrder(order.id, {
      paymentMethod: 'pix',
      pixEmv: pix.pixEmv,
      pixQrcode: pix.pixQrcode,
      pixExpirationDate: pix.pixExpirationDate,
      pixRef: pix.pixRef,
    });
    appendEvent(order.id, {
      type: 'order.pix_created',
      source: 'appmax',
      payload: {
        appmaxOrderId: order.appmaxOrderId,
        pixExpirationDate: pix.pixExpirationDate,
      },
    });
    order = getOrder(orderId).order;
  }

  if (order.status === 'draft') {
    transition(order.id, 'awaiting_payment', {
      type: 'order.transitioned',
      source: 'appmax',
    });
  }
  return getOrder(orderId);
}

async function quoteInstallments(orderId, input, opts) {
  rejectClientPrices(input);
  const { order } = getOrder(orderId);
  const n = installmentCount(input && input.installments);
  const appmax = appmaxClientOf(opts);
  const raw = await appmax.getInstallments({
    installments: n,
    total_value: order.totalCents,
    settings: true,
  });
  return { installments: installmentsListOf(raw) };
}

async function prepareCardCharge(orderId, input, opts) {
  rejectClientPrices(input);
  rejectCardSecrets(input);
  const documentNumber = digits(input && (input.documentNumber || input.document_number || input.holder_document_number));
  const ip = ipOf(input && input.ip);
  const token = clip(input && input.token, 120);
  const holderName = clip(input && (input.holderName || input.holder_name), 120);
  const installments = installmentCount(input && input.installments);
  if (!token) throw httpError(400, 'Pagamento com cartão exige token gerado no frontend.');
  if (documentNumber.length !== 11 && documentNumber.length !== 14) {
    throw httpError(400, 'Informe o CPF ou CNPJ do pagador.');
  }
  if (!ip) throw httpError(400, 'IP do comprador é obrigatório (Appmax JS).');

  let { order } = getOrder(orderId);
  if (order.status === 'paid' || order.status === 'refunded' || order.status === 'completed') {
    throw httpError(409, 'Pedido pago não aceita nova cobrança de cartão.');
  }
  if (!['draft', 'awaiting_payment'].includes(order.status)) {
    throw httpError(409, 'Pedido não aceita nova cobrança de cartão.');
  }
  if (order.paymentMethod === 'pix' && order.pixEmv) {
    throw httpError(409, 'Pedido com Pix não aceita cobrança de cartão.');
  }
  if (order.appmaxPaymentId && order.appmaxOrderId) {
    return getOrder(orderId);
  }

  const appmax = appmaxClientOf(opts);
  if (installments > 1) {
    const quoted = await appmax.getInstallments({
      installments,
      total_value: order.totalCents,
      settings: true,
    });
    const allowed = installmentsListOf(quoted).some((row) => Number(row.installment) === installments);
    if (!allowed) throw httpError(400, 'Quantidade de parcelas inválida.');
  }

  ({ order } = await ensureAppmaxOrder(orderId, { documentNumber, ip }, appmax));

  if (!order.appmaxPaymentId) {
    const cardRaw = await appmax.createCreditCardPayment({
      order_id: order.appmaxOrderId,
      customer_id: order.appmaxCustomerId,
      token,
      holder_document_number: documentNumber,
      holder_name: holderName || (order.address && order.address.recipientName) || '',
      installments,
    });
    const card = cardFromResponse(cardRaw);
    if (card.appmaxPaymentId == null) throw httpError(502, 'Resposta inválida da Appmax.');
    patchOrder(order.id, {
      paymentMethod: 'credit_card',
      appmaxPaymentId: card.appmaxPaymentId,
      appmaxPaymentStatus: card.appmaxPaymentStatus,
      cardInstallments: card.cardInstallments != null ? card.cardInstallments : installments,
    });
    appendEvent(order.id, {
      type: 'order.card_created',
      source: 'appmax',
      payload: {
        appmaxOrderId: order.appmaxOrderId,
        appmaxPaymentId: card.appmaxPaymentId,
        appmaxPaymentStatus: card.appmaxPaymentStatus,
        cardInstallments: card.cardInstallments != null ? card.cardInstallments : installments,
      },
    });
    order = getOrder(orderId).order;
  }

  if (order.status === 'draft') {
    transition(order.id, 'awaiting_payment', {
      type: 'order.transitioned',
      source: 'appmax',
    });
  }
  return getOrder(orderId);
}

function extractAppmaxOrderId(payload) {
  const src = payload || {};
  const nested = src.data || src.order || {};
  if (src.order_id != null && src.order_id !== '') return src.order_id;
  if (nested.id != null && nested.id !== '') return nested.id;
  if (src.id != null && src.id !== '') return src.id;
  return null;
}

function remotePaidCents(remote) {
  const src = remote || {};
  const raw = src.paid_value != null ? src.paid_value : src.paidValue;
  if (Number.isInteger(raw)) return raw;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

function remoteStatusOf(remote) {
  return String((remote && remote.status) || '').trim().toLowerCase();
}

function shouldConfirmPayment(order, remote) {
  if (!order || !remote) return false;
  if (remotePaidCents(remote) !== order.totalCents) return false;
  const status = remoteStatusOf(remote);
  if (order.paymentMethod === 'credit_card') {
    return status === 'aprovado' || status === 'integrado';
  }
  if (order.paymentMethod === 'pix') {
    return status === 'aprovado' || status === 'integrado' || status === 'pago' || status === 'paid';
  }
  return false;
}

function shouldExpirePayment(remote) {
  const status = remoteStatusOf(remote);
  return status === 'expirado' || status === 'expired';
}

function shouldFailPayment(remote) {
  const status = remoteStatusOf(remote);
  return status === 'cancelado' || status === 'cancelled' || status === 'recusado' || status === 'falhou' || status === 'failed';
}

function findOrderByAppmaxId(appmaxOrderId) {
  if (appmaxOrderId == null || appmaxOrderId === '') return null;
  const wanted = String(appmaxOrderId);
  return db.findOne('orders', (o) => o.appmaxOrderId != null && String(o.appmaxOrderId) === wanted) || null;
}

async function handleAppmaxWebhook(payload, opts) {
  const appmaxOrderId = extractAppmaxOrderId(payload);
  if (appmaxOrderId == null) return { confirmed: false, order: null };
  const appmax = appmaxClientOf(opts);
  const remote = await appmax.getOrder(appmaxOrderId);
  if (remote && remote.id != null && String(remote.id) !== String(appmaxOrderId)) {
    return { confirmed: false, order: findOrderByAppmaxId(appmaxOrderId) };
  }
  try {
    return db.batch(() => {
      const current = findOrderByAppmaxId(appmaxOrderId);
      if (!current) return { confirmed: false, order: null };
      if (remote && remote.status) {
        patchOrder(current.id, { appmaxPaymentStatus: remote.status });
      }
      appendEvent(current.id, {
        type: 'order.webhook_received',
        source: 'appmax',
        payload: {
          appmaxOrderId,
          remoteStatus: remote && remote.status ? remote.status : null,
        },
      });
      const latest = getOrder(current.id).order;
      if (latest.status === 'paid' || latest.status === 'refunded' || latest.status === 'completed') {
        return { confirmed: true, order: latest };
      }
      if (latest.status !== 'awaiting_payment') {
        return { confirmed: false, order: latest };
      }
      if (shouldConfirmPayment(latest, remote)) {
        const moved = transition(current.id, 'paid', {
          type: 'order.transitioned',
          source: 'appmax',
          payload: {
            appmaxOrderId,
            remoteStatus: remote.status,
            paidValue: remotePaidCents(remote),
          },
        });
        return { confirmed: true, order: moved.order };
      }
      if (shouldExpirePayment(remote)) {
        const moved = transition(current.id, 'expired', {
          type: 'order.transitioned',
          source: 'appmax',
          payload: { appmaxOrderId, remoteStatus: remote.status },
        });
        return { confirmed: false, order: moved.order };
      }
      if (shouldFailPayment(remote)) {
        const moved = transition(current.id, 'failed', {
          type: 'order.transitioned',
          source: 'appmax',
          payload: { appmaxOrderId, remoteStatus: remote.status },
        });
        return { confirmed: false, order: moved.order };
      }
      return { confirmed: false, order: getOrder(current.id).order };
    });
  } catch (err) {
    if (err && err.status === 409) {
      const existing = findOrderByAppmaxId(appmaxOrderId);
      if (existing && (existing.status === 'paid' || existing.status === 'expired' || existing.status === 'failed')) {
        return { confirmed: existing.status === 'paid', order: existing };
      }
    }
    throw err;
  }
}

function createOrderTx(input) {
  rejectClientPrices(input);
  const userId = input && input.userId;
  if (!userId || !db.findById('users', userId)) {
    throw httpError(400, 'Usuário inválido.');
  }
  const offerId = input && input.offerId;
  const idempotencyKey = clip(input.idempotencyKey, 120) || '';
  if (idempotencyKey) {
    const existingKey = findByIdempotencyKey(idempotencyKey);
    if (existingKey) return getOrder(existingKey.id);
  }
  const open = findOpenOrder(userId, offerId);
  if (open) {
    const address = validateAddress(input.address);
    if (!open.pixEmv && !open.appmaxOrderId) {
      patchOrder(open.id, { address });
    }
    return getOrder(open.id);
  }

  const offer = catiraOfferOf(offerId);
  const product = official.productOf(offer.productId);
  if (!product) throw httpError(404, 'Produto oficial não encontrado.');
  const quantity = quantityOf(input.quantity);
  const address = validateAddress(input.address);
  if (input.frozenUnitPriceCents !== undefined && !input.allowFrozenPrice) {
    throw httpError(400, 'O valor do pedido é calculado pelo servidor.');
  }
  const frozenCents = input.allowFrozenPrice ? input.frozenUnitPriceCents : undefined;
  const unitPriceCents = Number.isInteger(frozenCents) && frozenCents > 0
    ? frozenCents
    : toCents(offer.price);
  if (unitPriceCents > MAX_UNIT_CENTS) {
    throw httpError(400, 'Valor acima do limite permitido.');
  }
  const freightCents = 0;
  const discountCents = 0;
  const totalCents = unitPriceCents * quantity + freightCents - discountCents;
  if (!Number.isSafeInteger(totalCents) || totalCents > MAX_UNIT_CENTS * 999) {
    throw httpError(400, 'Total do pedido acima do limite permitido.');
  }
  const at = nowIso();
  const productSnapshot = {
    productId: product.id,
    listingId: product.listingId || null,
    title: product.title,
    description: product.description || '',
    condition: product.condition || '',
    cityId: product.cityId || '',
    city: product.city || '',
  };
  const offerSnapshot = {
    offerId: offer.id,
    provider: 'catira',
    priceCents: unitPriceCents,
    stock: offer.stock || 0,
    status: offer.status || 'manual',
    commercialReady: false,
  };
  const order = db.insert('orders', {
    userId,
    offerId: offer.id,
    productId: product.id,
    listingId: product.listingId || null,
    status: 'draft',
    currency: 'BRL',
    quantity,
    unitPriceCents,
    freightCents,
    discountCents,
    totalCents,
    address,
    productSnapshot,
    offerSnapshot,
    leadTimeLabel: 'Prazo a confirmar após o pagamento',
    commercialReady: false,
    appmaxOrderId: null,
    paymentId: null,
    idempotencyKey: idempotencyKey || null,
    checkoutSessionId: input.checkoutSessionId || null,
    createdAt: at,
    updatedAt: at,
  }, { allowOrderWrite: true });
  const item = db.insert('orderItems', {
    orderId: order.id,
    productId: product.id,
    offerId: offer.id,
    listingId: product.listingId || null,
    provider: 'catira',
    title: product.title,
    sku: offer.externalId || null,
    quantity,
    unitPriceCents,
    lineTotalCents: unitPriceCents * quantity,
    productSnapshot,
    offerSnapshot,
  }, { allowOrderWrite: true });
  const created = appendEvent(order.id, {
    type: 'order.created',
    fromStatus: null,
    toStatus: 'draft',
    source: input.source || 'system',
    at,
  });
  return { order, items: [item], events: [created] };
}

function createOrder(input) {
  return db.batch(() => createOrderTx(input));
}

function createCheckoutSession(input) {
  rejectClientPrices(input);
  const userId = input && input.userId;
  if (!userId || !db.findById('users', userId)) {
    throw httpError(400, 'Usuário inválido.');
  }
  const offer = catiraOfferOf(input.offerId);
  const quantity = quantityOf(input.quantity);
  const address = validateAddress(input.address);
  const now = Date.now();
  return db.batch(() => {
    const open = findOpenSession(userId, offer.id, now);
    if (open) return open;
    return db.insert('checkoutSessions', {
      userId,
      offerId: offer.id,
      productId: offer.productId,
      quantity,
      address,
      unitPriceCents: toCents(offer.price),
      status: 'open',
      orderId: null,
      createdAt: nowIso(now),
      expiresAt: nowIso(now + SESSION_TTL_MS),
    }, { allowOrderWrite: true });
  });
}

function promoteSession(sessionId) {
  return db.batch(() => {
    const session = db.findById('checkoutSessions', sessionId);
    if (!session) throw httpError(404, 'Sessão não encontrada.');
    if (session.status === 'promoted' && session.orderId) return getOrder(session.orderId);
    if (session.status !== 'open') throw httpError(409, 'Sessão indisponível.');
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      db.update('checkoutSessions', session.id, { status: 'expired' });
      throw httpError(409, 'Sessão expirada.');
    }
    const out = createOrderTx({
      userId: session.userId,
      offerId: session.offerId,
      quantity: session.quantity,
      address: session.address,
      idempotencyKey: 'session:' + session.id,
      checkoutSessionId: session.id,
      frozenUnitPriceCents: session.unitPriceCents,
      allowFrozenPrice: true,
    });
    db.update('checkoutSessions', session.id, {
      status: 'promoted',
      orderId: out.order.id,
    });
    return out;
  });
}

function expireSessions(nowMs) {
  const now = nowMs || Date.now();
  let count = 0;
  db.batch(() => {
    db.findWhere('checkoutSessions', (s) => (
      s.status === 'open' && new Date(s.expiresAt).getTime() <= now
    )).forEach((s) => {
      db.update('checkoutSessions', s.id, { status: 'expired' });
      count += 1;
    });
  });
  return count;
}

function transition(orderId, toStatus, opts = {}) {
  return db.batch(() => {
    const order = db.findById('orders', orderId);
    if (!order) throw httpError(404, 'Pedido não encontrado.');
    const allowed = TRANSITIONS[order.status] || [];
    if (!allowed.includes(toStatus)) {
      throw httpError(409, 'Transição inválida de ' + order.status + ' para ' + toStatus + '.');
    }
    const at = nowIso();
    const updated = db.update('orders', order.id, { status: toStatus, updatedAt: at }, { allowOrderStatus: true });
    const event = appendEvent(order.id, {
      type: opts.type || 'order.transitioned',
      fromStatus: order.status,
      toStatus,
      source: opts.source || 'system',
      payload: opts.payload || null,
      at,
    });
    return { order: updated, event };
  });
}

function saveUserAddress(userId, raw) {
  if (!userId || !db.findById('users', userId)) {
    throw httpError(400, 'Usuário inválido.');
  }
  const address = validateAddress(raw);
  return db.insert('userAddresses', {
    userId,
    ...address,
    createdAt: nowIso(),
  }, { allowOrderWrite: true });
}

function paymentView(order) {
  return {
    method: order.paymentMethod || null,
    appmaxOrderId: order.appmaxOrderId == null ? null : order.appmaxOrderId,
    appmaxPaymentId: order.appmaxPaymentId == null ? null : order.appmaxPaymentId,
    appmaxPaymentStatus: order.appmaxPaymentStatus || null,
    catiraStatus: order.status,
    cardInstallments: order.cardInstallments != null ? order.cardInstallments : null,
    updatedAt: order.updatedAt || null,
  };
}

function serializeOrderList(order) {
  const payment = paymentView(order);
  return {
    id: order.id,
    status: order.status,
    productTitle: order.productSnapshot ? order.productSnapshot.title : '',
    quantity: order.quantity,
    totalCents: order.totalCents,
    createdAt: order.createdAt,
    paymentMethod: payment.method,
    appmaxOrderId: payment.appmaxOrderId,
    appmaxPaymentId: payment.appmaxPaymentId,
    appmaxPaymentStatus: payment.appmaxPaymentStatus,
    cardInstallments: payment.cardInstallments,
    commercialReady: false,
  };
}

function listOrdersAdmin() {
  return db
    .all('orders')
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(serializeOrderList);
}

function getOrderAdmin(orderId) {
  const order = db.findById('orders', orderId);
  if (!order) return null;
  const {
    pixEmv,
    pixQrcode,
    pixRef,
    pixExpirationDate,
    ...safe
  } = order;
  return {
    order: { ...safe, commercialReady: false, payment: paymentView(order) },
    items: itemsOf(orderId),
    events: eventsOf(orderId),
  };
}

function serializeBuyerOrder(detail) {
  const order = detail.order || detail;
  const snap = order.productSnapshot || {};
  return {
    id: order.id,
    status: order.status,
    totalCents: order.totalCents,
    quantity: order.quantity,
    unitPriceCents: order.unitPriceCents,
    freightCents: order.freightCents || 0,
    discountCents: order.discountCents || 0,
    paymentMethod: order.paymentMethod || null,
    listingId: order.listingId || null,
    createdAt: order.createdAt || null,
    productSnapshot: { title: snap.title || '' },
    address: order.address || null,
    pixEmv: order.pixEmv || null,
    pixQrcode: order.pixQrcode || null,
    pixExpirationDate: order.pixExpirationDate || null,
    commercialReady: false,
  };
}

module.exports = {
  SESSION_TTL_MS,
  TRANSITIONS,
  toCents,
  validateAddress,
  createOrder,
  createCheckoutSession,
  promoteSession,
  expireSessions,
  preparePixCharge,
  quoteInstallments,
  prepareCardCharge,
  handleAppmaxWebhook,
  transition,
  getOrder,
  eventsOf,
  updateOrderSnapshot,
  saveUserAddress,
  listOrdersAdmin,
  getOrderAdmin,
  serializeBuyerOrder,
};
