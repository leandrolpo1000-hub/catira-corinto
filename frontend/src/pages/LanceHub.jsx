import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, money } from '../api';
import { useAuth, isAdminRole } from '../auth';
import { NeedAuth, PhotoGallery, Top } from '../components';

const STATUS_CHIP = [
  ['', 'Todas'],
  ['under_review', 'Em análise'],
  ['available', 'Disponíveis'],
  ['reserved', 'Reservadas'],
  ['negotiating', 'Em negociação'],
];

export function DealerApply() {
  const { user, setUser } = useAuth();
  const nav = useNavigate();
  const [me, setMe] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [cats, setCats] = useState([]);
  const [form, setForm] = useState({
    name: user?.name || '',
    city: user?.city || 'Corinto',
    phone: user?.phone || '',
    categories: [],
    regions: [],
    termsAccepted: false,
  });

  useEffect(() => {
    if (!user) return;
    api('/api/lance/me').then((d) => {
      setMe(d);
      if (d.user) setUser(d.user);
      if (d.isDealer) nav('/central-repasse', { replace: true });
    }).catch(() => {});
    api('/api/categories').then(setCats).catch(() => {});
  }, [user && user.id]);

  if (!user) return <NeedAuth next="/catireiro" />;

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await api('/api/lance/dealers/apply', { method: 'POST', body: JSON.stringify(form) });
      const d = await api('/api/lance/me');
      setMe(d);
      if (d.user) setUser(d.user);
    } catch (ex) {
      setErr(ex.message);
    }
    setBusy(false);
  }

  const pending = me && me.application && me.application.status === 'pending';
  const rejected = me && me.application && me.application.status === 'rejected';

  return (
    <>
      <Top back title="Catireiro" />
      <div className="page">
        <h1>Catireiro credenciado</h1>
        <p className="lead">
          Acesso à Central de Repasse, com oportunidades comerciais avaliadas pelo CATIRA.
          Não é leilão e não gera compra automática.
        </p>
        {pending && (
          <div className="okbox">Sua solicitação está em análise. Você será avisado quando for aprovado.</div>
        )}
        {rejected && (
          <div className="error">Solicitação não aprovada{me.application.note ? ': ' + me.application.note : '.'}</div>
        )}
        {err && <div className="error">{err}</div>}
        {!pending && (
          <form onSubmit={submit}>
            <div className="field"><label>Nome</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
            <div className="field"><label>Cidade</label><input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} required /></div>
            <div className="field"><label>Telefone</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required /></div>
            <div className="field">
              <label>Categorias de interesse</label>
              <div className="cond wrap">
                {cats.map((c) => {
                  const on = form.categories.includes(c.id);
                  return (
                    <label key={c.id}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setForm({
                          ...form,
                          categories: on ? form.categories.filter((x) => x !== c.id) : [...form.categories, c.id],
                        })}
                      />
                      <span>{c.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="field">
              <label>Regiões de atuação</label>
              <input
                value={form.regions.join(', ')}
                onChange={(e) => setForm({ ...form, regions: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                placeholder="Corinto, Curvelo, Três Marias"
              />
            </div>
            <label className="fee-toggle" style={{ marginBottom: 12 }}>
              <span className="fee-toggle-info">
                <strong>Aceito os termos do catireiro</strong>
                <small>O CATIRA intermedia. Interesse não é compra. Dados do vendedor só após acordo.</small>
              </span>
              <input type="checkbox" checked={form.termsAccepted} onChange={(e) => setForm({ ...form, termsAccepted: e.target.checked })} />
            </label>
            <button className="btn btn-primary" disabled={busy || !form.termsAccepted}>{busy ? 'Enviando...' : 'Enviar solicitação'}</button>
          </form>
        )}
      </div>
    </>
  );
}

export default function LanceHub() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [tab, setTab] = useState('hub');
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');
  const [mine, setMine] = useState([]);
  const [allowed, setAllowed] = useState(null);

  async function load() {
    const me = await api('/api/lance/me');
    if (!me.isDealer) {
      setAllowed(false);
      return;
    }
    setAllowed(true);
    const d = await api('/api/lance/hub' + (status ? '?status=' + encodeURIComponent(status) : ''));
    setItems(d.items || []);
    const h = await api('/api/lance/mine');
    setMine(h.items || []);
  }

  useEffect(() => {
    if (!user) return;
    load().catch((e) => setErr(e.message));
  }, [user && user.id, status]);

  if (!user) return <NeedAuth next="/central-repasse" />;
  if (allowed === false) return <DealerApply />;
  if (allowed === null) return <><Top back title="Central de Repasse" /><div className="page">Carregando...</div></>;

  return (
    <>
      <Top back title="Central de Repasse" />
      <div className="page">
        <h1>Central de Repasse</h1>
        <p className="lead">Oportunidades comerciais. Interesse não é compra nem cobrança.</p>
        {user.dealerFounder && <div className="okbox">Selo Catireiro Fundador</div>}
        {err && <div className="error">{err}</div>}
        <div className="chips">
          <button className={'chip' + (tab === 'hub' ? ' on' : '')} onClick={() => setTab('hub')}>Oportunidades</button>
          <button className={'chip' + (tab === 'mine' ? ' on' : '')} onClick={() => setTab('mine')}>Meu histórico</button>
        </div>
        {tab === 'hub' && (
          <>
            <div className="chips">
              {STATUS_CHIP.map(([k, l]) => (
                <button key={k || 'all'} className={'chip' + (status === k ? ' on' : '')} onClick={() => setStatus(k)}>{l}</button>
              ))}
            </div>
            {!items.length && <p className="empty">Nenhuma oportunidade no momento.</p>}
            {items.map((it) => <OppCard key={it.id} item={it} onDone={load} />)}
          </>
        )}
        {tab === 'mine' && (
          <>
            {!mine.length && <p className="empty">Você ainda não manifestou interesse.</p>}
            {mine.map((row) => (
              <div key={row.interest.id} className="opp-card">
                <div className="hint">Interesse em {new Date(row.interest.createdAt).toLocaleString('pt-BR')}</div>
                {row.opportunity && <OppCard item={row.opportunity} onDone={load} compact />}
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}

function OppCard({ item, onDone, compact }) {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const imgs = (item.listing && item.listing.images) || [];

  async function interest() {
    setBusy(true);
    setMsg('');
    try {
      const d = await api('/api/lance/hub/' + item.id + '/interest', { method: 'POST', body: JSON.stringify({}) });
      setMsg(d.message || 'Interesse registrado. Isso não é uma compra.');
      if (onDone) onDone();
    } catch (e) {
      setMsg(e.message);
    }
    setBusy(false);
  }

  return (
    <article className="opp-card">
      <PhotoGallery images={imgs} alt={item.listing ? item.listing.title : ''} />
      <div className="opp-body">
        <span className={'status ' + item.status}>{item.statusLabel}</span>
        <h3>{item.listing ? item.listing.title : 'Oportunidade'}</h3>
        <div className="price">{money(item.referencePrice)}</div>
        <p className="meta">
          {item.city || 'Cidade não informada'}
          {item.listing && item.listing.condition ? ' · ' + item.listing.condition : ''}
          {item.categoryName ? ' · ' + item.categoryName : ''}
        </p>
        {!compact && item.listing && item.listing.description && (
          <p className="hint">{item.listing.description.slice(0, 160)}</p>
        )}
        {item.conditions && <p className="hint">Condições: {item.conditions}</p>}
        {item.validUntil && <p className="hint">Validade: {new Date(item.validUntil).toLocaleString('pt-BR')}</p>}
        {item.feeBreakdown && (
          <p className="hint">
            Mercadoria {money(item.feeBreakdown.toSeller)} · Taxa Catira {money(item.feeBreakdown.toPlatform)} · Total estimado {money(item.feeBreakdown.totalBuyer)}.
            {item.feeBreakdown.totalNote || 'Estimativa das condições apresentadas. Interesse não cobra nem reserva.'}
          </p>
        )}
        <p className="hint">O CATIRA não comprou este item. É intermediação. Interesse não é compra, pagamento, reserva nem garantia.</p>
        {msg && <div className="okbox">{msg}</div>}
        <div className="row-btns">
          <button className="btn btn-primary" type="button" disabled={busy || !!item.myInterest} onClick={interest}>
            {item.myInterest ? 'Interesse enviado' : busy ? 'Enviando...' : 'Tenho interesse'}
          </button>
          {item.myInterest && item.status === 'available' && (
            <button className="btn btn-ghost" type="button" disabled={busy} onClick={async () => {
              setBusy(true);
              try {
                const d = await api('/api/lance/hub/' + item.id + '/interest/withdraw', { method: 'POST', body: JSON.stringify({}) });
                setMsg(d.message || 'Interesse retirado.');
                if (onDone) onDone();
              } catch (e) {
                setMsg(e.message);
              }
              setBusy(false);
            }}>Retirar interesse</button>
          )}
          <button className="btn btn-ghost" type="button" onClick={() => nav('/central-repasse/' + item.id)}>Ver</button>
        </div>
      </div>
    </article>
  );
}

export function LanceDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [item, setItem] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    api('/api/lance/hub/' + id).then(setItem).catch((e) => setErr(e.message));
  }, [id, user && user.id]);

  if (!user) return <NeedAuth next={'/central-repasse/' + id} />;
  if (err && !item) return <><Top back title="Oportunidade" /><div className="page"><div className="error">{err}</div></div></>;
  if (!item) return <><Top back title="Oportunidade" /><div className="page">Carregando...</div></>;

  const imgs = (item.listing && item.listing.images) || [];

  async function interest() {
    setBusy(true);
    try {
      const d = await api('/api/lance/hub/' + item.id + '/interest', { method: 'POST', body: JSON.stringify({}) });
      setMsg(d.message);
      const fresh = await api('/api/lance/hub/' + id);
      setItem(fresh);
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  }

  return (
    <>
      <Top back title="Oportunidade" />
      <div className="page">
        <PhotoGallery images={imgs} alt={item.listing ? item.listing.title : ''} size="hero" />
        <span className={'status ' + item.status}>{item.statusLabel}</span>
        <h1>{item.listing ? item.listing.title : 'Oportunidade'}</h1>
        <div className="price">{money(item.referencePrice)}</div>
        <p className="lead">{item.city} · {item.listing && item.listing.condition} · {item.categoryName}</p>
        {item.listing && <p style={{ whiteSpace: 'pre-wrap' }}>{item.listing.description}</p>}
        {item.conditions && <p className="hint">Condições: {item.conditions}</p>}
        {item.validUntil && <p className="hint">Validade: {new Date(item.validUntil).toLocaleString('pt-BR')}</p>}
        {item.feeBreakdown && (
          <div className="opp-offer">
            <p>Você paga ao vendedor: {money(item.feeBreakdown.toSeller)}</p>
            <p>Taxa Catira: {money(item.feeBreakdown.toPlatform)}</p>
            <p>Total estimado: {money(item.feeBreakdown.totalBuyer)}</p>
            <p className="hint">{item.feeBreakdown.totalNote || item.feeBreakdown.dueWhen} Interesse não gera cobrança nem reserva.</p>
          </div>
        )}
        <p className="hint">Telefone e endereço do vendedor não são exibidos. Interesse não gera compra, pagamento, reserva nem garantia de disponibilidade.</p>
        {err && <div className="error">{err}</div>}
        {msg && <div className="okbox">{msg}</div>}
        <button className="btn btn-primary" disabled={busy || !!item.myInterest} onClick={interest}>
          {item.myInterest ? 'Interesse já registrado' : 'Tenho interesse'}
        </button>
        {item.myInterest && item.status === 'available' && (
          <button className="btn btn-ghost" type="button" style={{ marginTop: 8 }} disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              const d = await api('/api/lance/hub/' + item.id + '/interest/withdraw', { method: 'POST', body: JSON.stringify({}) });
              setMsg(d.message || 'Interesse retirado.');
              setItem(await api('/api/lance/hub/' + id));
            } catch (e) { setErr(e.message); }
            setBusy(false);
          }}>Retirar interesse</button>
        )}
        {item.myInterest && (item.status === 'reserved' || item.status === 'negotiating') && (
          <button className="btn btn-ghost" type="button" style={{ marginTop: 8 }} onClick={async () => {
            try {
              await api('/api/lance/opportunities/' + item.id + '/confirm', { method: 'POST', body: JSON.stringify({ party: 'dealer' }) });
              setMsg('Confirmação registrada. A taxa só vira devida se a venda for concluída.');
              setItem(await api('/api/lance/hub/' + id));
            } catch (e) { setErr(e.message); }
          }}>Confirmar minha parte</button>
        )}
        {item.myInterest && (item.status === 'reserved' || item.status === 'negotiating') && (
          <button className="btn btn-ghost" type="button" style={{ marginTop: 8 }} onClick={async () => {
            const why = window.prompt('Descreva o motivo da divergência.');
            if (!why) return;
            try {
              await api('/api/lance/opportunities/' + item.id + '/dispute', { method: 'POST', body: JSON.stringify({ reason: why }) });
              setMsg('Disputa aberta. A taxa não é gerada enquanto estiver pendente.');
              setItem(await api('/api/lance/hub/' + id));
            } catch (e) { setErr(e.message); }
          }}>Abrir disputa</button>
        )}
        {item.status === 'disputed' && (
          <button className="btn btn-ghost" type="button" style={{ marginTop: 8 }} onClick={async () => {
            const note = window.prompt('Sua manifestação na disputa');
            if (!note) return;
            try {
              await api('/api/lance/opportunities/' + item.id + '/dispute-note', { method: 'POST', body: JSON.stringify({ note }) });
              setMsg('Manifestação registrada.');
              setItem(await api('/api/lance/hub/' + id));
            } catch (e) { setErr(e.message); }
          }}>Registrar manifestação</button>
        )}
      </div>
    </>
  );
}

export function SellerLance() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  async function load() {
    const d = await api('/api/lance/seller');
    setData(d);
  }

  useEffect(() => {
    if (!user) return;
    load().catch((e) => setErr(e.message));
  }, [user && user.id]);

  if (!user) return <NeedAuth next="/propostas-rapidas" />;

  async function respond(id, action) {
    setErr('');
    setMsg('');
    try {
      await api('/api/lance/offers/' + id + '/respond', { method: 'POST', body: JSON.stringify({ action }) });
      setMsg(action === 'accept' ? 'Proposta aceita. Isso não é uma venda concluída pelo CATIRA.' : 'Proposta recusada.');
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function consent(listingId, on) {
    try {
      await api('/api/lance/listings/' + listingId + '/consent', { method: 'POST', body: JSON.stringify({ consent: on }) });
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <>
      <Top back title="Proposta rápida" />
      <div className="page">
        <h1>Propostas rápidas</h1>
        <p className="lead">O CATIRA avalia e pode apresentar uma proposta. Você decide. Aceitar não significa que o CATIRA comprou o item.</p>
        {err && <div className="error">{err}</div>}
        {msg && <div className="okbox">{msg}</div>}
        {!(data && data.listings && data.listings.length) && <p className="empty">Nenhum anúncio com proposta rápida.</p>}
        {(data?.listings || []).map((l) => (
          <div key={l.id} className="opp-card">
            <h3>{l.title}</h3>
            <div className="price">{money(l.price)}</div>
            <p className="hint">Anúncio: {l.status}{l.waitForEvaluation ? ' · aguardando avaliação' : ''}</p>
            {l.opportunity && (
              <>
                <p className="hint">{l.opportunity.statusLabel}</p>
                {l.opportunity.pendingConsent && !l.opportunity.consentToShare && (
                  <div className="opp-offer">
                    <strong>Pedido de autorização para a Central</strong>
                    <p className="hint">O que será mostrado: fotos, descrição, cidade, valor e condições. Sem telefone nem endereço.</p>
                    <p className="hint">Mercadoria {money(l.opportunity.pendingConsent.goodsPrice)} · Taxa do catireiro {money(l.opportunity.pendingConsent.intermediationFee)} · termos v{l.opportunity.pendingConsent.termsVersion}</p>
                    {l.opportunity.pendingConsent.conditions && <p className="hint">Condições: {l.opportunity.pendingConsent.conditions}</p>}
                    <p className="hint">{l.opportunity.pendingConsent.feeNote}</p>
                    <div className="row-btns">
                      <button className="btn btn-primary" type="button" onClick={() => consent(l.id, true)}>Autorizar divulgação</button>
                      <button className="btn btn-ghost" type="button" onClick={() => consent(l.id, false)}>Recusar</button>
                    </div>
                  </div>
                )}
                {l.opportunity.consentToShare && (
                  <p className="hint">Autorização válida para esta oportunidade{l.opportunity.consentTermsVersion ? ' · termos v' + l.opportunity.consentTermsVersion : ''}.</p>
                )}
                {l.opportunity.consentToShare && (
                  <button className="btn btn-ghost" type="button" onClick={() => consent(l.id, false)}>Revogar autorização</button>
                )}
                {(l.opportunity.offers || []).map((o) => (
                  <div key={o.id} className="opp-offer">
                    <strong>{money(o.amount)}</strong>
                    <p className="hint">{o.originLabel || 'Proposta'} · {o.presentedBy || ''} · válida até {new Date(o.validUntil).toLocaleString('pt-BR')} · {o.status}</p>
                    {o.conditions && <p className="hint">{o.conditions}</p>}
                    {o.status === 'sent' && (
                      <div className="row-btns">
                        <button className="btn btn-primary" type="button" onClick={() => respond(o.id, 'accept')}>Aceitar proposta</button>
                        <button className="btn btn-ghost" type="button" onClick={() => respond(o.id, 'reject')}>Recusar</button>
                      </div>
                    )}
                  </div>
                ))}
                {(l.opportunity.status === 'reserved' || l.opportunity.status === 'negotiating') && (
                  <button className="btn btn-ghost" type="button" onClick={async () => {
                    try {
                      await api('/api/lance/opportunities/' + l.opportunity.id + '/confirm', { method: 'POST', body: JSON.stringify({ party: 'seller' }) });
                      setMsg('Confirmação da sua parte registrada. A taxa só vira devida se a venda for concluída.');
                      await load();
                    } catch (e) { setErr(e.message); }
                  }}>Confirmar minha parte</button>
                )}
                {l.opportunity.status === 'disputed' && (
                  <button className="btn btn-ghost" type="button" onClick={async () => {
                    const note = window.prompt('Sua manifestação na disputa');
                    if (!note) return;
                    try {
                      await api('/api/lance/opportunities/' + l.opportunity.id + '/dispute-note', { method: 'POST', body: JSON.stringify({ note }) });
                      setMsg('Manifestação registrada.');
                      await load();
                    } catch (e) { setErr(e.message); }
                  }}>Registrar manifestação</button>
                )}
              </>
            )}
            <Link className="btn btn-ghost" to={'/anuncio/' + l.id} style={{ marginTop: 8 }}>Ver anúncio</Link>
          </div>
        ))}
      </div>
    </>
  );
}

export function isDealerUser(user) {
  return !!(user && (user.dealerStatus === 'approved' || isAdminRole(user && user.role)));
}
