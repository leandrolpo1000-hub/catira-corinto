import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { api, money, quotePremiumDays, addDaysISO, todayISO, weekdayName } from '../api';
import { useAuth, isAdminRole } from '../auth';
import { NeedAuth, Top } from '../components';
import { useConfig } from '../config';

export default function Boost() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const { vipListingFee, vipFeeEnabled, premiumFeeEnabled, premiumDayFee } = useConfig();
  const vipOn = !!vipFeeEnabled;
  const premiumOn = premiumFeeEnabled !== undefined ? !!premiumFeeEnabled : true;
  const [item, setItem] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState('');
  const [premiumDays, setPremiumDays] = useState([]);
  const [takenDays, setTakenDays] = useState([]);

  useEffect(() => {
    if (!user) return;
    api('/api/listings/' + id)
      .then((d) => {
        if (d.userId !== user.id && !isAdminRole(user.role)) {
          setErr('Sem permissão para turbinar este anúncio.');
          return;
        }
        setItem(d);
        if (d.vip && !d.premium) setPlan('premium');
        else if (!d.vip) setPlan('vip');
      })
      .catch((e) => setErr(e.message || 'Anúncio não encontrado.'));
    api('/api/listings/premium-days?days=14').then((d) => setTakenDays(d.taken || [])).catch(() => {});
  }, [id, user]);

  if (!user) return <NeedAuth next={'/turbinar/' + id} />;
  if (!user.emailVerified && !isAdminRole(user.role)) {
    return <Navigate to={'/confirmar-email?next=' + encodeURIComponent('/turbinar/' + id)} replace />;
  }

  const takenSet = new Set(takenDays);
  const dayOptions = Array.from({ length: 14 }, (_, i) => addDaysISO(todayISO(), i));
  const premiumQuote = quotePremiumDays(premiumDays, premiumDayFee);
  const payNow = plan === 'premium' ? (premiumOn ? premiumQuote.total : 0) : (vipOn ? vipListingFee : 0);
  const canVip = item && !item.vip && !item.featured && !item.premium;
  const canPremium = item && !item.premium;

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (!plan) return setErr('Escolha Destaque ou Premium.');
    if (plan === 'premium' && !premiumDays.length) return setErr('Escolha pelo menos um dia para o anúncio Premium.');
    setBusy(true);
    try {
      const d = await api('/api/listings/' + id + '/upgrade', {
        method: 'POST',
        body: JSON.stringify({
          plan,
          premiumDays: plan === 'premium' ? premiumDays : [],
        }),
      });
      nav(d.published || !(d.fee > 0) ? '/meus-anuncios' : '/pagar/' + id);
    } catch (ex) {
      setErr(ex.message);
    }
    setBusy(false);
  }

  return (
    <>
      <Top back title="Turbinar" />
      <div className="page">
        <h1>Turbinar anúncio</h1>
        {item && <p className="lead">{item.title}. O anúncio continua no ar. O plano novo entra depois do pagamento confirmado.</p>}
        {err && <div className="error">{err}</div>}
        {item && item.premium && <p className="hint">Este anúncio já é Premium.</p>}
        {item && !item.premium && (
          <form onSubmit={submit}>
            <div className="field">
              <label>Novo plano</label>
              <div className="cond wrap">
                {canVip && (
                  <label>
                    <input type="radio" name="boost" checked={plan === 'vip'} onChange={() => { setPlan('vip'); setPremiumDays([]); }} />
                    <span>Destaque{vipOn ? ' ' + money(vipListingFee) : ' grátis'}</span>
                  </label>
                )}
                {canPremium && (
                  <label>
                    <input type="radio" name="boost" checked={plan === 'premium'} onChange={() => setPlan('premium')} />
                    <span>Premium{premiumOn ? '' : ' grátis'}</span>
                  </label>
                )}
              </div>
              <div className="hint">
                {plan === 'premium'
                  ? 'Premium ocupa o banner na data reservada e segue na lista até venda ou remoção.'
                  : 'Destaque: aparece na frente na home e na busca. Contato aberto para todo mundo.'}
              </div>
            </div>
            {plan === 'premium' && (
              <div className="field">
                <label>Dias do Premium</label>
                <div className="cond wrap premium-days">
                  {dayOptions.map((d) => {
                    const taken = takenSet.has(d);
                    const on = !taken && premiumDays.includes(d);
                    const rate = quotePremiumDays([d], premiumDayFee).total;
                    const [, m, day] = d.split('-');
                    return (
                      <label key={d} className={taken ? 'day-taken' : (on ? 'day-on' : '')}>
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={taken}
                          onChange={() => {
                            if (taken) return;
                            const next = on
                              ? premiumDays.filter((x) => x !== d)
                              : [...premiumDays.filter((x) => !takenSet.has(x)), d].sort();
                            setPremiumDays(next);
                          }}
                        />
                        <span>
                          {day}/{m} {weekdayName(d).slice(0, 3)}
                          <small>{taken ? 'Reservado' : money(rate)}</small>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <div className="hint">
                  {premiumDays.length
                    ? 'Total: ' + money(premiumQuote.total) + ' · ' + premiumDays.length + (premiumDays.length === 1 ? ' dia' : ' dias')
                    : 'Marque os dias livres. Datas em cinza já foram reservadas.'}
                </div>
              </div>
            )}
            <button className="btn btn-primary" disabled={busy || !plan}>
              {busy ? 'Enviando...' : payNow > 0 ? 'Continuar para pagamento (' + money(payNow) + ')' : 'Turbinar agora'}
            </button>
          </form>
        )}
      </div>
    </>
  );
}
