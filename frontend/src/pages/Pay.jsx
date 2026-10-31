import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, money, statusLabel } from '../api';
import { useAuth } from '../auth';
import { BrandLogo, NeedAuth, Top } from '../components';

export default function Pay() {
  const { id } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [promoCode, setPromoCode] = useState('');

  async function load() {
    const d = await api('/api/listings/' + id + '/payment');
    setData(d);
    return d;
  }

  useEffect(() => {
    if (!user) return;
    load().catch((e) => setErr(e.message));
  }, [id, user]);

  useEffect(() => {
    if (!data || data.listing?.status === 'payment_expired' || data.payment?.status === 'paid' || data.payment?.status === 'expired') return;
    const t = setInterval(() => {
      load().catch(() => {});
    }, 8000);
    return () => clearInterval(t);
  }, [id, data?.listing?.status, data?.payment?.status]);

  if (!user) return <NeedAuth next={'/pagar/' + id} />;

  async function copyPix() {
    const code = data?.payment?.pixCode;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setErr('Não foi possível copiar. Selecione o código manualmente.');
    }
  }

  async function applyPromo(skip) {
    setBusy(true);
    setErr('');
    try {
      const d = await api('/api/listings/' + id + '/promo', {
        method: 'POST',
        body: JSON.stringify(skip ? { skip: true } : { code: promoCode }),
      });
      if (d.published) {
        setOk(d.free ? 'Código com 100% de desconto. Anúncio publicado.' : 'Anúncio publicado.');
      } else if (d.payment && d.payment.discountPercent) {
        setOk('Desconto de ' + d.payment.discountPercent + '% aplicado. Pague o valor com PIX.');
      }
      await load();
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  }

  async function declarePaid() {
    setBusy(true);
    setErr('');
    try {
      const d = await api('/api/listings/' + id + '/pay', { method: 'POST', body: JSON.stringify({}) });
      if (d.published && upgrade) {
        setOk('Recebemos o aviso. O anúncio continua no ar. O plano novo entra quando o PIX for confirmado.');
      } else if (d.published) {
        setOk('Pagamento confirmado. Anúncio publicado.');
      } else {
        setOk(upgrade
          ? 'Recebemos o aviso. O anúncio continua no ar. O plano novo entra quando o PIX for confirmado.'
          : 'Recebemos o aviso. O anúncio só fica público quando o pagamento for confirmado na conta PIX.');
      }
      await load();
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  }

  const listing = data?.listing;
  const payment = data?.payment;
  const upgrade = !!(payment?.upgrade || data?.upgrade);
  const paid = payment?.status === 'paid';
  const published = paid && listing?.status === 'published' && !upgrade;
  const paidPending = paid && !published;
  const expired = listing?.status === 'payment_expired' || payment?.status === 'expired';
  const waiting = payment?.status === 'awaiting_confirmation' && !expired;
  const needsPromo = !paid && (data?.needsPromo || (payment && !payment.promoApplied && payment.status !== 'paid'));
  const feeNow = payment?.amount ?? data?.fee ?? 5;
  const feeOriginal = payment?.originalAmount || data?.originalFee || feeNow;
  const kind = payment?.kind || data?.kind || '';
  const isPremiumPay = kind === 'premium_listing' || listing?.premium;
  const isVipPay = kind === 'vip_listing' || listing?.vip;

  return (
    <>
      <Top back />
      <div className="page">
        <div className="pay-card">
          <div className="brand-center"><BrandLogo size="md" /></div>
          {published ? (
            <>
              <h1>Anúncio publicado</h1>
              <p className="lead">Pagamento confirmado. Seu anúncio já está no ar.</p>
              {listing && <p><strong>{listing.title}</strong><br />{money(listing.price)}</p>}
              <Link className="btn btn-primary" to={'/anuncio/' + id}>Ver anúncio</Link>
            </>
          ) : paidPending ? (
            <>
              <h1>{upgrade ? 'Plano atualizado' : 'Pagamento confirmado'}</h1>
              <p className="lead">
                {upgrade
                  ? 'O PIX foi confirmado. O anúncio continua no ar com o plano novo.'
                  : 'O PIX foi confirmado. O anúncio está em revisão e ainda não está público.'}
              </p>
              {listing && <p><strong>{listing.title}</strong><br />{money(listing.price)}</p>}
              <Link className="btn btn-primary" to={upgrade ? '/anuncio/' + id : '/meus-anuncios'}>{upgrade ? 'Ver anúncio' : 'Ver meus anúncios'}</Link>
            </>
          ) : expired ? (
            <>
              <h1>Pagamento expirado</h1>
              <p className="lead">A confirmação do PIX não chegou em 1 hora. Fale com o suporte para resolver.</p>
              {listing && <p><strong>{listing.title}</strong><br />{money(listing.price)}</p>}
              {err && <div className="error">{err}</div>}
              <Link className="btn btn-primary" to="/suporte">Falar com o suporte</Link>
            </>
          ) : (
            <>
              <h1>{needsPromo ? 'Código promocional' : (upgrade ? (isPremiumPay ? 'Pague o Premium' : 'Pague o destaque') : (isPremiumPay ? 'Pague o anúncio Premium' : (isVipPay ? 'Pague o anúncio em destaque' : 'Pague para publicar')))}</h1>
              <p className="lead">
                {needsPromo
                  ? 'Se tiver um código, use agora. Depois geramos o PIX com o valor final.'
                  : upgrade
                    ? (isPremiumPay
                      ? 'O anúncio continua no ar. Depois do PIX, ele ocupa o banner nos dias reservados.'
                      : 'O anúncio continua no ar. Depois do PIX, ele passa a ser destaque.')
                    : isPremiumPay
                      ? 'Premium cobrado por dia: domingo valor cheio, sábado 2/3, dia de semana 1/3.'
                      : isVipPay
                        ? 'Taxa do anúncio em destaque. Aparece na frente na home e na busca.'
                        : 'Taxa de publicação. O anúncio só fica visível depois da confirmação do PIX.'}
              </p>
              <div className="fee">{money(feeNow)}</div>
              {listing?.premium && payment?.premiumQuote?.items?.length > 0 && (
                <p className="hint">
                  {payment.premiumQuote.items.length} {payment.premiumQuote.items.length === 1 ? 'dia' : 'dias'} Premium.
                </p>
              )}
              {payment?.discountPercent > 0 && (
                <p className="hint">De {money(feeOriginal)} com {payment.discountPercent}% de desconto{payment.promoCode ? ' (' + payment.promoCode + ')' : ''}.</p>
              )}
              {err && <div className="error">{err}</div>}
              {ok && <div className="okbox">{ok}</div>}
              {needsPromo ? (
                <>
                  <div className="field" style={{ textAlign: 'left' }}>
                    <label>Código promocional</label>
                    <input
                      value={promoCode}
                      onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                      placeholder="Ex.: CATIRA100"
                      autoComplete="off"
                    />
                  </div>
                  <button className="btn btn-primary" disabled={busy || !promoCode.trim()} onClick={() => applyPromo(false)}>
                    {busy ? 'Aplicando...' : 'Aplicar código'}
                  </button>
                  <button className="btn btn-ghost" style={{ marginTop: 8 }} disabled={busy} onClick={() => applyPromo(true)}>
                    Continuar sem código
                  </button>
                </>
              ) : (
                <>
                  {!data?.pixConfigured && (
                    <div className="error">A chave PIX ainda não foi configurada pelo administrador.</div>
                  )}
                  {data?.qrDataUrl && (
                    <img className="pix-qr" src={data.qrDataUrl} alt="QR Code PIX" />
                  )}
                  {payment?.pixKey && (
                    <p className="hint">Chave: {payment.pixKey}</p>
                  )}
                  {payment?.pixCode && (
                    <>
                      <p className="hint" style={{ marginTop: 12 }}>PIX copia e cola</p>
                      <div className="pix-box">{payment.pixCode}</div>
                      <button className="btn btn-ghost" type="button" onClick={copyPix}>
                        {copied ? 'Código copiado' : 'Copiar código PIX'}
                      </button>
                    </>
                  )}
                  {waiting && (
                    <div className="okbox">{upgrade ? 'Aguardando confirmação do pagamento por até 1 hora. O anúncio continua no ar.' : 'Aguardando confirmação do pagamento por até 1 hora. O anúncio não está público ainda.'}</div>
                  )}
                  <button className="btn btn-primary" disabled={busy || waiting || !payment?.pixCode} onClick={declarePaid} style={{ marginTop: 10 }}>
                    {busy ? 'Enviando...' : waiting ? 'Aguardando confirmação' : 'Já paguei o PIX'}
                  </button>
                  <p className="hint" style={{ marginTop: 12 }}>
                    Pague {money(feeNow)} no app do banco. Depois toque em "Já paguei o PIX". {upgrade ? 'O plano novo entra quando o pagamento for confirmado.' : 'A publicação só acontece quando o pagamento for confirmado.'}
                  </p>
                  {payment?.status && (
                    <p className="hint">Status: {statusLabel[payment.status] || payment.status}</p>
                  )}
                </>
              )}
            </>
          )}
        </div>
        <p style={{ marginTop: 16, textAlign: 'center' }}><Link className="link" to="/meus-anuncios">Ver meus anúncios</Link></p>
      </div>
    </>
  );
}
