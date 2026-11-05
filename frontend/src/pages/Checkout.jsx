import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, money } from '../api';
import { useAuth } from '../auth';
import { NeedAuth, Top } from '../components';
import { useConfig } from '../config';
import { loadAppmaxScript, initAppmaxScripts } from '../appmax';
import AppmaxCardForm from '../AppmaxCardForm';

function checkoutPath(listingId, offerId) {
  return '/checkout?listing=' + encodeURIComponent(listingId || '') + '&offer=' + encodeURIComponent(offerId || '');
}

function entregaPath(listingId, offerId) {
  return '/checkout/entrega?listing=' + encodeURIComponent(listingId || '') + '&offer=' + encodeURIComponent(offerId || '');
}

function centsMoney(cents) {
  return money((Number(cents) || 0) / 100);
}

function pixSrc(raw) {
  if (!raw) return '';
  return String(raw).startsWith('data:') ? raw : ('data:image/png;base64,' + raw);
}

function pixStatusLabel(status) {
  if (status === 'paid' || status === 'completed') return 'Pagamento confirmado';
  if (status === 'expired') return 'Pagamento expirado';
  if (status === 'failed' || status === 'cancelled') return 'Pagamento recusado ou falhou';
  return 'Aguardando pagamento';
}

function Steps({ current }) {
  const items = [
    { id: 'cart', label: 'Carrinho' },
    { id: 'ship', label: 'Entrega' },
    { id: 'pay', label: 'Pagamento' },
  ];
  return (
    <ol className="ck-steps">
      {items.map((s) => (
        <li key={s.id} className={'ck-step' + (s.id === current ? ' on' : '')}>{s.label}</li>
      ))}
    </ol>
  );
}

function Summary({ title, qty, unitCents, freightCents, discountCents, totalCents }) {
  return (
    <div className="ck-summary">
      <h3>Resumo</h3>
      <div className="ck-row"><span>Produtos</span><strong>{title || '—'}</strong></div>
      <div className="ck-row"><span>Quantidade</span><strong>{qty}</strong></div>
      <div className="ck-row"><span>Subtotal</span><strong>{centsMoney(unitCents * qty)}</strong></div>
      {discountCents > 0 && (
        <div className="ck-row"><span>Desconto</span><strong>-{centsMoney(discountCents)}</strong></div>
      )}
      <div className="ck-row"><span>Frete</span><strong>{centsMoney(freightCents)}</strong></div>
      <p className="hint">Frete R$ 0,00 nesta fase.</p>
      <div className="ck-row ck-total"><span>Total</span><strong>{centsMoney(totalCents)}</strong></div>
    </div>
  );
}

function ProductCard({ listing, offer }) {
  const img = listing && listing.images && listing.images[0] && listing.images[0].url;
  return (
    <div className="ck-product">
      {img ? <img src={img} alt="" /> : <div className="ck-product-ph" />}
      <div>
        <p className="hint">Catira oficial</p>
        <strong>{listing && listing.title}</strong>
        <p className="hint">Quantidade 1</p>
        {offer && offer.price != null && <p className="ck-price">{money(offer.price)}</p>}
      </div>
    </div>
  );
}

function loadDraft(listingId, offerId) {
  try {
    const raw = sessionStorage.getItem('catira.checkout.' + listingId + '.' + offerId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveDraft(listingId, offerId, address) {
  try {
    sessionStorage.setItem('catira.checkout.' + listingId + '.' + offerId, JSON.stringify(address));
  } catch {}
}

function Review() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const listingId = params.get('listing') || '';
  const offerId = params.get('offer') || '';
  const next = checkoutPath(listingId, offerId);
  const [listing, setListing] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!user || !listingId) return;
    api('/api/listings/' + listingId).then(setListing).catch((e) => setErr(e.message));
  }, [user, listingId]);

  if (!user) return <NeedAuth next={next} />;

  const offers = listing && Array.isArray(listing.officialOffers) ? listing.officialOffers : [];
  const offer = offers.find((o) => o.id === offerId && o.provider === 'catira');
  const unitCents = offer ? Math.round(Number(offer.price || 0) * 100) : 0;

  return (
    <>
      <Top back title="Meu carrinho" />
      <div className="page ck-page">
        <Steps current="cart" />
        {err && <div className="error">{err}</div>}
        {listing && !offer && (
          <div className="error">
            Esta oferta não está disponível para compra.
            <div style={{ height: 10 }} />
            <Link className="btn btn-ghost" to={'/anuncio/' + listingId}>Voltar ao anúncio</Link>
          </div>
        )}
        {listing && offer && !offer.buyEnabled && (
          <div className="error">
            A compra pelo Catira ainda não está disponível nesta fase.
            <div style={{ height: 10 }} />
            <Link className="btn btn-ghost" to={'/anuncio/' + listingId}>Voltar ao anúncio</Link>
          </div>
        )}
        {listing && offer && offer.buyEnabled && (
          <>
            <ProductCard listing={listing} offer={offer} />
            <Summary
              title={listing.title}
              qty={1}
              unitCents={unitCents}
              freightCents={0}
              discountCents={0}
              totalCents={unitCents}
            />
            <div className="ck-cta">
              <button type="button" className="btn btn-primary" onClick={() => nav(entregaPath(listingId, offerId))}>
                Continuar
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Delivery() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const listingId = params.get('listing') || '';
  const offerId = params.get('offer') || '';
  const next = entregaPath(listingId, offerId);
  const [listing, setListing] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const saved = listingId && offerId ? loadDraft(listingId, offerId) : null;
  const [form, setForm] = useState(saved || {
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
  });

  useEffect(() => {
    if (!user || !listingId) return;
    api('/api/listings/' + listingId).then((d) => {
      setListing(d);
      setForm((prev) => ({ ...prev, cityId: d.cityId || prev.cityId || 'corinto', city: prev.city || d.city || '' }));
    }).catch((e) => setErr(e.message));
  }, [user, listingId]);

  if (!user) return <NeedAuth next={next} />;

  const offers = listing && Array.isArray(listing.officialOffers) ? listing.officialOffers : [];
  const offer = offers.find((o) => o.id === offerId && o.provider === 'catira' && o.buyEnabled);
  const unitCents = offer ? Math.round(Number(offer.price || 0) * 100) : 0;

  function setF(k, v) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (!offer) {
      setErr('Esta oferta não está disponível para compra.');
      return;
    }
    setBusy(true);
    try {
      saveDraft(listingId, offerId, form);
      const created = await api('/api/orders', {
        method: 'POST',
        body: JSON.stringify({ offerId, quantity: 1, address: form }),
      });
      nav('/checkout/' + created.id + '/pagamento');
    } catch (ex) {
      setErr(ex.message);
    }
    setBusy(false);
  }

  return (
    <>
      <Top back title="Finalize sua compra" />
      <div className="page ck-page">
        <Steps current="ship" />
        {err && <div className="error">{err}</div>}
        {listing && !offer && (
          <Link className="btn btn-ghost" to={'/anuncio/' + listingId}>Voltar ao anúncio</Link>
        )}
        {listing && offer && (
          <form onSubmit={submit}>
            <ProductCard listing={listing} offer={offer} />
            <h2 className="ck-h2">Endereço de entrega</h2>
            <div className="field"><label>Nome do destinatário</label><input value={form.recipientName} onChange={(e) => setF('recipientName', e.target.value)} required autoComplete="name" /></div>
            <div className="field"><label>Telefone</label><input value={form.phone} onChange={(e) => setF('phone', e.target.value)} required inputMode="tel" autoComplete="tel" /></div>
            <div className="field"><label>CEP</label><input value={form.cep} onChange={(e) => setF('cep', e.target.value)} required inputMode="numeric" autoComplete="postal-code" /></div>
            <div className="field"><label>Rua</label><input value={form.street} onChange={(e) => setF('street', e.target.value)} required autoComplete="street-address" /></div>
            <div className="ck-grid2">
              <div className="field"><label>Número</label><input value={form.number} onChange={(e) => setF('number', e.target.value)} required /></div>
              <div className="field"><label>Complemento</label><input value={form.complement} onChange={(e) => setF('complement', e.target.value)} /></div>
            </div>
            <div className="field"><label>Bairro</label><input value={form.district} onChange={(e) => setF('district', e.target.value)} required /></div>
            <div className="ck-grid2">
              <div className="field"><label>Cidade</label><input value={form.city} onChange={(e) => setF('city', e.target.value)} required /></div>
              <div className="field"><label>Estado</label><input value={form.state} onChange={(e) => setF('state', e.target.value)} required maxLength={2} /></div>
            </div>
            <Summary
              title={listing.title}
              qty={1}
              unitCents={unitCents}
              freightCents={0}
              discountCents={0}
              totalCents={unitCents}
            />
            <div className="ck-cta">
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? 'Criando pedido...' : 'Continuar para pagamento'}
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}

function Payment() {
  const { user } = useAuth();
  const { orderId } = useParams();
  const nav = useNavigate();
  const cfg = useConfig();
  const next = '/checkout/' + orderId + '/pagamento';
  const [order, setOrder] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [docNumber, setDocNumber] = useState('');
  const [payerIp, setPayerIp] = useState('');
  const [method, setMethod] = useState('pix');
  const [cardToken, setCardToken] = useState('');
  const [installments, setInstallments] = useState(1);
  const [installmentOpts, setInstallmentOpts] = useState([{ installment: 1 }]);

  useEffect(() => {
    if (!user || !orderId) return;
    api('/api/orders/' + orderId).then(setOrder).catch((e) => setErr(e.message));
  }, [user, orderId]);

  useEffect(() => {
    if (!user || !orderId || method !== 'card') return;
    api('/api/orders/' + orderId + '/installments')
      .then((d) => {
        const rows = d && Array.isArray(d.installments) ? d.installments : [];
        setInstallmentOpts(rows.length ? rows : [{ installment: 1 }]);
      })
      .catch(() => setInstallmentOpts([{ installment: 1 }]));
  }, [user, orderId, method]);

  useEffect(() => {
    if (method !== 'pix' || !(cfg.appmax && cfg.appmax.externalId)) return undefined;
    let cancelled = false;
    loadAppmaxScript(cfg.appmax.scriptUrl)
      .then((sdk) => {
        if (cancelled || !sdk) return;
        try {
          initAppmaxScripts({
            sdk,
            externalId: cfg.appmax.externalId,
            onIp: (payload) => {
              const ip = payload && payload.ip ? payload.ip : payload;
              setPayerIp(typeof ip === 'string' ? ip : '');
            },
          });
        } catch (e) {
          setErr(e.message);
        }
      })
      .catch((e) => setErr(e.message));
    return () => { cancelled = true; };
  }, [cfg.appmax, method]);

  if (!user) return <NeedAuth next={next} />;

  async function pay(e) {
    e.preventDefault();
    setErr('');
    if (!payerIp) {
      setErr('Aguarde a verificação da Appmax (IP).');
      return;
    }
    setBusy(true);
    try {
      if (method === 'card') {
        if (!cardToken) {
          setErr('Preencha o cartão e aguarde a tokenização da Appmax.');
          setBusy(false);
          return;
        }
        const charged = await api('/api/orders/' + orderId + '/card', {
          method: 'POST',
          body: JSON.stringify({
            token: cardToken,
            documentNumber: docNumber,
            ip: payerIp,
            installments,
          }),
        });
        setOrder(charged);
        nav(charged.status === 'paid'
          ? '/checkout/' + orderId + '/ok'
          : '/checkout/' + orderId + '/aguardando');
      } else {
        const charged = await api('/api/orders/' + orderId + '/pix', {
          method: 'POST',
          body: JSON.stringify({ documentNumber: docNumber, ip: payerIp }),
        });
        setOrder(charged);
        nav('/checkout/' + orderId + '/pix');
      }
    } catch (ex) {
      setErr(ex.message);
    }
    setBusy(false);
  }

  return (
    <>
      <Top back title="Escolha como deseja pagar" />
      <div className="page ck-page">
        <Steps current="pay" />
        {method === 'pix' && cfg.appmax && cfg.appmax.externalId && <form data-appmax-customer hidden />}
        {err && <div className="error">{err}</div>}
        {!order && !err && <p className="hint">Carregando...</p>}
        {order && (
          <form onSubmit={pay}>
            <div className="ck-methods">
              <button type="button" className={'ck-method' + (method === 'pix' ? ' on' : '')} onClick={() => setMethod('pix')}>Pix</button>
              <button type="button" className={'ck-method' + (method === 'card' ? ' on' : '')} onClick={() => setMethod('card')}>Cartão</button>
            </div>
            {method === 'pix' && (
              <div className="ck-pay-pix">
                <strong>Pix</strong>
                <p className="hint">Pague à vista com o QR Code ou o código copia e cola. Confirmação pelo banco.</p>
                <p className="ck-price">{centsMoney(order.totalCents)}</p>
              </div>
            )}
            {method === 'card' && (
              <>
                <AppmaxCardForm
                  visible
                  externalId={cfg.appmax && cfg.appmax.externalId}
                  scriptUrl={cfg.appmax && cfg.appmax.scriptUrl}
                  onIp={(ip) => setPayerIp(typeof ip === 'string' ? ip : '')}
                  onToken={(token) => setCardToken(token || '')}
                  onError={(e) => setErr((e && e.message) || 'Falha no cartão.')}
                />
                <div className="field">
                  <label>Parcelas</label>
                  <select value={installments} onChange={(e) => setInstallments(Number(e.target.value) || 1)}>
                    {installmentOpts.map((row) => (
                      <option key={row.installment} value={row.installment}>
                        {row.installment}x
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
            <div className="field">
              <label>CPF/CNPJ</label>
              <input value={docNumber} onChange={(e) => setDocNumber(e.target.value)} required inputMode="numeric" autoComplete="off" />
            </div>
            <Summary
              title={order.productSnapshot && order.productSnapshot.title}
              qty={order.quantity || 1}
              unitCents={order.unitPriceCents || order.totalCents}
              freightCents={order.freightCents || 0}
              discountCents={order.discountCents || 0}
              totalCents={order.totalCents}
            />
            <div className="ck-cta">
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? (method === 'card' ? 'Processando...' : 'Gerando Pix...') : 'Pagar e finalizar'}
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}

function PixPay() {
  const { user } = useAuth();
  const { orderId } = useParams();
  const nav = useNavigate();
  const next = '/checkout/' + orderId + '/pix';
  const [order, setOrder] = useState(null);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!user || !orderId) return;
    api('/api/orders/' + orderId).then(setOrder).catch((e) => setErr(e.message));
  }, [user, orderId]);

  useEffect(() => {
    if (!order || !user) return undefined;
    if (['paid', 'expired', 'failed', 'cancelled', 'completed', 'refunded'].includes(order.status)) return undefined;
    const t = setInterval(() => {
      api('/api/orders/' + orderId).then(setOrder).catch(() => {});
    }, 8000);
    return () => clearInterval(t);
  }, [order && order.status, orderId, user]);

  useEffect(() => {
    if (order && order.status === 'paid') nav('/checkout/' + orderId + '/ok', { replace: true });
  }, [order, orderId, nav]);

  if (!user) return <NeedAuth next={next} />;

  async function copyPix() {
    const code = order && order.pixEmv;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setErr('Não foi possível copiar. Selecione o código manualmente.');
    }
  }

  return (
    <>
      <Top back title="Pague com Pix" />
      <div className="page ck-page">
        <Steps current="pay" />
        {err && <div className="error">{err}</div>}
        {!order && !err && <p className="hint">Carregando...</p>}
        {order && (
          <div className="ck-pix">
            <p className="ck-price">{centsMoney(order.totalCents)}</p>
            <p className={'ck-pix-status status-' + order.status}>{pixStatusLabel(order.status)}</p>
            {order.pixExpirationDate && <p className="hint">Expira em {new Date(order.pixExpirationDate).toLocaleString('pt-BR')}</p>}
            {order.pixQrcode && <img className="ck-qr" alt="QR Pix" src={pixSrc(order.pixQrcode)} />}
            {order.pixEmv && (
              <>
                <textarea readOnly value={order.pixEmv} className="ck-emv" />
                <button type="button" className="btn btn-primary" onClick={copyPix}>
                  {copied ? 'Código copiado' : 'Copiar código Pix'}
                </button>
              </>
            )}
            <p className="hint">Abra o app do banco, pague o Pix e aguarde a confirmação. Não feche esta tela.</p>
          </div>
        )}
      </div>
    </>
  );
}

function WaitPay() {
  const { user } = useAuth();
  const { orderId } = useParams();
  const nav = useNavigate();
  const next = '/checkout/' + orderId + '/aguardando';
  const [order, setOrder] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!user || !orderId) return;
    api('/api/orders/' + orderId).then(setOrder).catch((e) => setErr(e.message));
  }, [user, orderId]);

  useEffect(() => {
    if (!order || !user) return undefined;
    if (['paid', 'expired', 'failed', 'cancelled', 'completed', 'refunded'].includes(order.status)) return undefined;
    const t = setInterval(() => {
      api('/api/orders/' + orderId).then(setOrder).catch(() => {});
    }, 8000);
    return () => clearInterval(t);
  }, [order && order.status, orderId, user]);

  useEffect(() => {
    if (order && order.status === 'paid') nav('/checkout/' + orderId + '/ok', { replace: true });
  }, [order, orderId, nav]);

  if (!user) return <NeedAuth next={next} />;

  return (
    <>
      <Top back title="Aguardando confirmação" />
      <div className="page ck-page">
        <Steps current="pay" />
        {err && <div className="error">{err}</div>}
        {!order && !err && <p className="hint">Carregando...</p>}
        {order && (
          <div className="ck-pix">
            <p className="ck-price">{centsMoney(order.totalCents)}</p>
            <p className={'ck-pix-status status-' + order.status}>{pixStatusLabel(order.status)}</p>
            <p className="hint">Pagamento com cartão enviado. A confirmação vem do banco. Não feche esta tela.</p>
          </div>
        )}
      </div>
    </>
  );
}

function Confirmed() {
  const { user } = useAuth();
  const { orderId } = useParams();
  const next = '/checkout/' + orderId + '/ok';
  const [order, setOrder] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!user || !orderId) return;
    api('/api/orders/' + orderId).then(setOrder).catch((e) => setErr(e.message));
  }, [user, orderId]);

  if (!user) return <NeedAuth next={next} />;
  if (order && order.status !== 'paid') {
    const wait = order.paymentMethod === 'credit_card'
      ? '/checkout/' + orderId + '/aguardando'
      : '/checkout/' + orderId + '/pix';
    return <Navigate to={wait} replace />;
  }

  return (
    <>
      <Top back title="Pedido confirmado" />
      <div className="page ck-page">
        {err && <div className="error">{err}</div>}
        {!order && !err && <p className="hint">Carregando...</p>}
        {order && order.status === 'paid' && (
          <div className="ck-ok">
            <div className="ck-ok-mark" aria-hidden="true">OK</div>
            <h1>Pedido confirmado!</h1>
            <p className="lead">Seu pagamento foi confirmado! Agora estamos preparando os próximos passos para que seu pedido chegue até você.</p>
            <p className="hint">Pedido {order.id}</p>
            <p><strong>{order.productSnapshot && order.productSnapshot.title}</strong></p>
            <p>{centsMoney(order.totalCents)} · {order.paymentMethod === 'credit_card' ? 'Cartão' : 'Pix'}</p>
            <p className="hint">{pixStatusLabel(order.status)}{order.createdAt ? ' · ' + new Date(order.createdAt).toLocaleString('pt-BR') : ''}</p>
            <Link className="btn btn-primary" to={'/checkout/' + order.id + '/ok'}>Ver meu pedido</Link>
            <div style={{ height: 10 }} />
            {order.listingId && <Link className="btn btn-ghost" to={'/anuncio/' + order.listingId}>Voltar ao anúncio</Link>}
          </div>
        )}
      </div>
    </>
  );
}

export default function Checkout() {
  const loc = useLocation();
  const params = useParams();
  const step = useMemo(() => {
    if (loc.pathname.endsWith('/ok')) return 'ok';
    if (loc.pathname.endsWith('/aguardando')) return 'wait';
    if (loc.pathname.endsWith('/pix')) return 'pix';
    if (loc.pathname.endsWith('/pagamento')) return 'pay';
    if (loc.pathname.startsWith('/checkout/entrega')) return 'ship';
    return 'cart';
  }, [loc.pathname]);

  if (step === 'ok') return <Confirmed />;
  if (step === 'wait') return <WaitPay />;
  if (step === 'pix') return <PixPay />;
  if (step === 'pay') return <Payment />;
  if (step === 'ship') return <Delivery />;
  if (params.orderId) return <Navigate to={'/checkout/' + params.orderId + '/pagamento'} replace />;
  return <Review />;
}
