import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, money, statusLabel } from '../api';
import { useAuth } from '../auth';
import { BrandLogo, NeedAuth, Top } from '../components';
import { useConfig } from '../config';

function remainingLabel(until) {
  const end = new Date(until).getTime();
  if (!Number.isFinite(end)) return '';
  const ms = end - Date.now();
  if (ms <= 0) return 'Seu VIP venceu. Renove para continuar.';
  const totalMin = Math.floor(ms / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  if (days >= 2) return 'Faltam ' + days + ' dias para renovar.';
  if (days === 1) return hours > 0 ? 'Falta 1 dia e ' + hours + ' h para renovar.' : 'Falta 1 dia para renovar.';
  if (hours >= 2) return 'Faltam ' + hours + ' horas para renovar.';
  if (hours === 1) return 'Falta 1 hora para renovar.';
  if (totalMin >= 2) return 'Faltam ' + totalMin + ' minutos para renovar.';
  return 'Falta menos de 1 minuto para renovar.';
}

export default function Vip() {
  const { user, setUser } = useAuth();
  const { vipAccessFee, vipDays } = useConfig();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function load() {
    const d = await api('/api/vip');
    setData(d);
    if (d.user) setUser(d.user);
    return d;
  }

  useEffect(() => {
    if (!user) return;
    load().catch((e) => setErr(e.message));
  }, [user && user.id]);

  useEffect(() => {
    if (!data || data.user?.vip || data.payment?.status === 'paid') return;
    const t = setInterval(() => { load().catch(() => {}); }, 8000);
    return () => clearInterval(t);
  }, [data?.user?.vip, data?.payment?.status]);

  if (!user) return <NeedAuth next="/vip" />;

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

  async function declarePaid() {
    setBusy(true);
    setErr('');
    try {
      const d = await api('/api/vip/pay', { method: 'POST', body: JSON.stringify({}) });
      if (d.user?.vip) {
        setOk('VIP ativado. Você já pode falar com anúncios VIP.');
        setUser(d.user);
      } else {
        setOk('Recebemos o aviso. O VIP só libera quando o pagamento for confirmado.');
      }
      await load();
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  }

  const payment = data?.payment;
  const active = user.vip || data?.user?.vip;
  const waiting = payment?.status === 'awaiting_confirmation';
  const feeNow = payment?.amount ?? data?.fee ?? vipAccessFee;
  const days = data?.days ?? vipDays;
  const until = user.vipUntil || data?.user?.vipUntil;
  const groupUrl = active ? (data?.whatsappGroup || '') : '';
  const renewHint = until ? remainingLabel(until) : '';
  const renewSoon = until && (new Date(until).getTime() - Date.now()) <= 7 * 86400000;

  return (
    <>
      <Top back title="VIP" />
      <div className="page">
        <div className="pay-card">
          <div className="brand-center"><BrandLogo size="md" /></div>
          {active ? (
            <>
              <h1>Você é VIP</h1>
              <p className="lead">Acesso liberado ao chat e WhatsApp dos anúncios VIP.</p>
              {until && (
                <div className="vip-term">
                  <p className="vip-until">Vigência até {new Date(until).toLocaleDateString('pt-BR')}.</p>
                  {renewHint && (
                    <p className={'vip-renew' + (renewSoon ? ' soon' : '')}>{renewHint}</p>
                  )}
                </div>
              )}
              {groupUrl && (
                <a className="btn btn-wa" href={groupUrl} target="_blank" rel="noopener noreferrer">
                  Entrar no grupo VIP
                </a>
              )}
              <Link className="btn btn-primary" to="/" style={{ marginTop: groupUrl ? 10 : 0 }}>Ver anúncios</Link>
            </>
          ) : (
            <>
              <h1>Assine o VIP</h1>
              <p className="lead">
                Pague {money(feeNow)} e tenha acesso ao contato dos anúncios VIP por {days} {days === 1 ? 'dia' : 'dias'}.
              </p>
              <div className="fee">{money(feeNow)}</div>
              <p className="hint">{days} {days === 1 ? 'dia' : 'dias'} de acesso.</p>
              {err && <div className="error">{err}</div>}
              {ok && <div className="okbox">{ok}</div>}
              {!data?.pixConfigured && (
                <div className="error">A chave PIX ainda não foi configurada pelo administrador.</div>
              )}
              {data?.qrDataUrl && <img className="pix-qr" src={data.qrDataUrl} alt="QR Code PIX" />}
              {payment?.pixKey && <p className="hint">Chave: {payment.pixKey}</p>}
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
                <div className="okbox">Aguardando confirmação. O VIP ainda não está ativo.</div>
              )}
              <button className="btn btn-primary" disabled={busy || waiting || !payment?.pixCode} onClick={declarePaid} style={{ marginTop: 10 }}>
                {busy ? 'Enviando...' : waiting ? 'Aguardando confirmação' : 'Já paguei o PIX'}
              </button>
              {payment?.status && (
                <p className="hint">Status: {statusLabel[payment.status] || payment.status}</p>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
