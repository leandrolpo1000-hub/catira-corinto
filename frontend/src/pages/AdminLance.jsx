import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, money, formatBRLInput, parseBRL, statusLabel, condLabel } from '../api';
import { isMasterRole } from '../auth';
import { PhotoGallery } from '../components';

const STATUS_OPTS = [
  ['under_review', 'Em análise'],
  ['available', 'Disponível'],
  ['reserved', 'Reservada'],
  ['negotiating', 'Em negociação'],
  ['completed', 'Concluída'],
  ['cancelled', 'Cancelada'],
  ['expired', 'Expirada'],
  ['disputed', 'Em disputa'],
];

export default function AdminLance({ user }) {
  const isMaster = isMasterRole(user && user.role);
  const [tab, setTab] = useState('fila');
  const [queue, setQueue] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [settings, setSettings] = useState(null);
  const [dealers, setDealers] = useState({ applications: [], profiles: [] });
  const [audit, setAudit] = useState([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState('');
  const [offer, setOffer] = useState({ amount: '', validHours: '48', conditions: '', origin: 'third_party', presentedBy: '' });
  const [fwd, setFwd] = useState({ referencePrice: '', goodsPrice: '', intermediationFee: '', validHours: '72', conditions: '', mode: 'intermediation' });
  const [ownBox, setOwnBox] = useState([]);
  const [disputeWhy, setDisputeWhy] = useState('');
  const [reserve, setReserve] = useState({ dealerId: '', hours: '24' });
  const [resolution, setResolution] = useState('');
  const [filaQ, setFilaQ] = useState('');
  const [filaStatus, setFilaStatus] = useState('');
  const [filaCity, setFilaCity] = useState('');
  const [filaConsent, setFilaConsent] = useState('');
  const [filaListing, setFilaListing] = useState('');

  async function load() {
    setErr('');
    const settled = await Promise.allSettled([
      api('/api/admin/lance/queue'),
      api('/api/admin/lance/metrics'),
      api('/api/admin/lance/settings'),
      api('/api/admin/lance/dealers'),
    ]);
    const [q, m, s, d] = settled;
    if (q.status === 'fulfilled') setQueue((q.value && q.value.items) || []);
    else setErr(q.reason && q.reason.message ? q.reason.message : 'Não deu para carregar a fila.');
    if (m.status === 'fulfilled') setMetrics(m.value);
    if (s.status === 'fulfilled') setSettings(s.value);
    if (d.status === 'fulfilled') setDealers(d.value);
    if (isMaster) {
      try {
        const a = await api('/api/admin/lance/audit');
        setAudit(a.items || []);
      } catch (_) {}
    }
    try {
      const box = await api('/api/admin/lance/own-box');
      setOwnBox(box.items || []);
    } catch (_) {
      setOwnBox([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function sendOffer(listingId) {
    setErr('');
    setMsg('');
    try {
      await api('/api/admin/lance/listings/' + listingId + '/offer', {
        method: 'POST',
        body: JSON.stringify({
          amount: parseBRL(offer.amount),
          validHours: offer.validHours,
          conditions: offer.conditions,
          origin: offer.origin || 'third_party',
          presentedBy: offer.presentedBy,
        }),
      });
      setMsg('Proposta enviada ao vendedor. Não é compra do CATIRA.');
      setOffer({ amount: '', validHours: '48', conditions: '', origin: 'third_party', presentedBy: '' });
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function forward(opp) {
    setErr('');
    setMsg('');
    try {
      const payload = {
        mode: 'intermediation',
        referencePrice: parseBRL(fwd.referencePrice) || opp.referencePrice,
        validHours: fwd.validHours,
        conditions: fwd.conditions || opp.conditions,
      };
      if (isMaster) {
        payload.goodsPrice = parseBRL(fwd.goodsPrice) || opp.goodsPrice;
        if (fwd.intermediationFee) payload.intermediationFee = parseBRL(fwd.intermediationFee);
      }
      await api('/api/admin/lance/opportunities/' + opp.id + '/forward', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setMsg('Encaminhada à Central de Repasse.');
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function setStatus(id, status) {
    setErr('');
    try {
      if (status === 'completed') {
        throw new Error('Conclusão só com a confirmação das duas partes. O chip não fecha a venda.');
      }
      if (status === 'reserved') {
        throw new Error('Use Reservar temporariamente e escolha o interessado. O chip não reserva sozinho.');
      }
      if (status === 'negotiating') {
        throw new Error('Use Passar para em negociação depois da reserva. O chip não muda sozinho.');
      }
      const body = { status };
      if (status === 'disputed' || status === 'cancelled') body.reason = disputeWhy;
      await api('/api/admin/lance/opportunities/' + id + '/status', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setDisputeWhy('');
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function completeDeal(id) {
    setErr('');
    setMsg('');
    try {
      await api('/api/admin/lance/opportunities/' + id + '/status', {
        method: 'POST',
        body: JSON.stringify({ status: 'completed', acceptedConditions: true }),
      });
      setMsg('Venda concluída. A taxa ficou devida. Nada foi cobrado automaticamente.');
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function requestConsent(opp) {
    setErr('');
    setMsg('');
    try {
      await api('/api/admin/lance/opportunities/' + opp.id + '/request-consent', {
        method: 'POST',
        body: JSON.stringify({
          goodsPrice: parseBRL(fwd.goodsPrice) || opp.goodsPrice,
          validHours: fwd.validHours,
          conditions: fwd.conditions || opp.conditions,
          ...(isMaster && fwd.intermediationFee ? { intermediationFee: parseBRL(fwd.intermediationFee) } : {}),
        }),
      });
      setMsg('Pedido de autorização enviado ao vendedor, com o resumo do que será divulgado.');
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function reserveDeal(opp) {
    setErr('');
    setMsg('');
    try {
      await api('/api/admin/lance/opportunities/' + opp.id + '/reserve', {
        method: 'POST',
        body: JSON.stringify({ dealerId: reserve.dealerId, hours: reserve.hours || 24 }),
      });
      setMsg('Reserva temporária criada. Não é venda concluída.');
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function negotiate(opp) {
    setErr('');
    setMsg('');
    try {
      await api('/api/admin/lance/opportunities/' + opp.id + '/negotiate', {
        method: 'POST',
        body: JSON.stringify({ dealerId: reserve.dealerId || opp.reservedBy }),
      });
      setMsg('Em negociação. Ainda não é compra nem taxa devida.');
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function resolveDisp(id) {
    setErr('');
    setMsg('');
    try {
      await api('/api/admin/lance/opportunities/' + id + '/resolve-dispute', {
        method: 'POST',
        body: JSON.stringify({ resolution, nextStatus: 'available' }),
      });
      setResolution('');
      setMsg('Disputa resolvida com registro. As partes precisam confirmar de novo.');
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function toOwnBox(id) {
    setErr('');
    setMsg('');
    try {
      await api('/api/admin/lance/opportunities/' + id + '/own-box', { method: 'POST', body: JSON.stringify({}) });
      setMsg('Foi para Minhas Oportunidades Próprias. Não vai à Central.');
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function saveSettings(patch) {
    setErr('');
    try {
      const d = await api('/api/admin/lance/settings', { method: 'PUT', body: JSON.stringify(patch) });
      setSettings(d);
      setMsg('Configurações salvas.');
    } catch (e) {
      setErr(e.message);
    }
  }

  async function review(id, action) {
    try {
      await api('/api/admin/lance/dealers/' + id + '/review', { method: 'POST', body: JSON.stringify({ action }) });
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  const filaCities = Array.from(new Set(queue.map((r) => r.listing && r.listing.city).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const filaRows = queue.filter((row) => {
    const l = row.listing || {};
    const opp = row.opportunity || {};
    const hay = [l.title, l.city, l.status, opp.status, opp.statusLabel, opp.modeLabel, l.id, opp.id].join(' ').toLowerCase();
    if (filaQ && !hay.includes(filaQ.trim().toLowerCase())) return false;
    if (filaStatus && opp.status !== filaStatus) return false;
    if (filaCity && l.city !== filaCity) return false;
    if (filaConsent === 'yes' && !opp.consentToShare) return false;
    if (filaConsent === 'no' && opp.consentToShare) return false;
    if (filaListing && l.status !== filaListing) return false;
    return true;
  });

  async function benefit(id) {
    try {
      await api('/api/admin/lance/dealers/' + id + '/benefit', { method: 'POST', body: JSON.stringify({ days: settings?.founderFreeDays || 90 }) });
      setMsg('Benefício ativado a partir de agora.');
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div>
      <h2 style={{ fontSize: 18, margin: '8px 0 12px' }}>Gestão de Oportunidades</h2>
      <p className="lead">Anúncios com proposta rápida entram nesta fila. Intermediação sem estoque. Compra própria fica desligada até o master autorizar.</p>
      <button className="btn btn-ghost" type="button" onClick={() => load().catch((e) => setErr(e.message))} style={{ marginBottom: 10 }}>Atualizar fila</button>
      {err && <div className="error">{err}</div>}
      {msg && <div className="okbox">{msg}</div>}
      <div className="chips">
        {[['fila', 'Fila' + (queue.length ? ' (' + queue.length + ')' : '')], ['caixa', 'Caixa própria'], ['cats', 'Catireiros'], ['ind', 'Indicadores'], isMaster ? ['cfg', 'Modelos'] : null, isMaster ? ['log', 'Auditoria'] : null].filter(Boolean).map(([k, l]) => (
          <button key={k} className={'chip' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'ind' && metrics && (
        <>
          <h3>Intermediação</h3>
          <div className="opp-metrics">
            <div><strong>{metrics.intermediation ? metrics.intermediation.forwarded : metrics.opportunities}</strong><span>Encaminhadas</span></div>
            <div><strong>{metrics.intermediation ? metrics.intermediation.interests : metrics.interests}</strong><span>Interesses</span></div>
            <div><strong>{metrics.intermediation ? metrics.intermediation.completed : metrics.completed}</strong><span>Concluídas</span></div>
            <div><strong>{metrics.intermediation ? metrics.intermediation.disputed || 0 : 0}</strong><span>Em disputa</span></div>
            <div><strong>{money(metrics.intermediation ? metrics.intermediation.feesDue : metrics.intermediationFeeSum)}</strong><span>Taxa devida</span></div>
            <div><strong>{money(metrics.intermediation ? metrics.intermediation.feesCharged : 0)}</strong><span>Taxa recebida</span></div>
          </div>
          <h3>Compra própria (desligada até o master autorizar)</h3>
          <div className="opp-metrics">
            <div><strong>{metrics.ownBuy ? metrics.ownBuy.inBox : 0}</strong><span>Na caixa</span></div>
            <div><strong>{metrics.ownBuy ? metrics.ownBuy.acquired : 0}</strong><span>Adquiridas</span></div>
            <div><strong>{metrics.ownBuy ? metrics.ownBuy.availableForResale : 0}</strong><span>Para revenda</span></div>
            <div><strong>{money(metrics.ownBuy ? metrics.ownBuy.estimatedMargin : 0)}</strong><span>Margem estimada (não é lucro)</span></div>
          </div>
        </>
      )}

      {tab === 'cfg' && isMaster && settings && (
        <>
          <div className={'opp-model' + (settings.intermediationEnabled !== false ? ' on' : '')}>
            <h3>Modelo A — Intermediação sem estoque</h3>
            <p>O CATIRA conecta vendedor e catireiro. A remuneração é acordada e identificada à parte do preço da mercadoria.</p>
            <label className="fee-toggle">
              <span className="fee-toggle-info"><strong>Intermediação</strong><small>Operação atual</small></span>
              <input type="checkbox" checked={settings.intermediationEnabled !== false} onChange={(e) => saveSettings({ ...settings, intermediationEnabled: e.target.checked })} />
            </label>
          </div>
          <div className={'opp-model own' + (settings.ownBuyEnabled ? ' on' : '')}>
            <h3>Modelo B — Compra e revenda própria</h3>
            <p>Arquitetura pronta, desativada. Só ligue após regularização comercial, jurídica e fiscal.</p>
            <label className="fee-toggle">
              <span className="fee-toggle-info"><strong>Compra própria</strong><small>Desligada por padrão</small></span>
              <input type="checkbox" checked={!!settings.ownBuyEnabled} onChange={(e) => saveSettings({ ...settings, ownBuyEnabled: e.target.checked })} />
            </label>
          </div>
          <div className="field">
            <label>Tipo da taxa de intermediação</label>
            <select value={settings.feeType || 'fixed'} onChange={(e) => setSettings({ ...settings, feeType: e.target.value })}>
              <option value="fixed">Valor fixo</option>
              <option value="percent">Percentual</option>
              <option value="both">Percentual + fixo</option>
            </select>
          </div>
          {(settings.feeType === 'percent' || settings.feeType === 'both') && (
            <div className="field">
              <label>Percentual (%)</label>
              <input value={settings.feePercent || ''} onChange={(e) => setSettings({ ...settings, feePercent: e.target.value.replace(/[^\d.,]/g, '') })} />
            </div>
          )}
          {(settings.feeType === 'fixed' || settings.feeType === 'both') && (
            <div className="field">
              <label>Taxa fixa (R$)</label>
              <input value={settings.feeFixed || ''} onChange={(e) => setSettings({ ...settings, feeFixed: e.target.value.replace(/[^\d.,]/g, '') })} />
            </div>
          )}
          <div className="field">
            <label>Taxa mínima (R$)</label>
            <input value={settings.feeMin || ''} onChange={(e) => setSettings({ ...settings, feeMin: e.target.value.replace(/[^\d.,]/g, '') })} />
          </div>
          <p className="hint">A taxa é cobrada só do catireiro e só quando a venda intermediada for concluída. Não cobra o vendedor.</p>
          <div className="field">
            <label>Reserva padrão (horas)</label>
            <input value={settings.defaultHoldHours} onChange={(e) => setSettings({ ...settings, defaultHoldHours: e.target.value.replace(/\D/g, '') })} />
          </div>
          <button className="btn btn-primary" type="button" onClick={() => saveSettings(settings)}>Salvar</button>
        </>
      )}

      {tab === 'cats' && (
        <>
          <h3>Solicitações</h3>
          {dealers.applications.filter((a) => a.status === 'pending').map((a) => (
            <div key={a.id} className="opp-card">
              <strong>{a.name}</strong>
              <p className="hint">{a.city} · {a.phone}</p>
              <div className="row-btns">
                <button className="btn btn-primary" type="button" onClick={() => review(a.id, 'approve')}>Aprovar</button>
                <button className="btn btn-ghost" type="button" onClick={() => review(a.id, 'reject')}>Recusar</button>
              </div>
            </div>
          ))}
          <h3>Credenciados</h3>
          {dealers.profiles.map((p) => (
            <div key={p.id} className="opp-card">
              <strong>{p.user ? p.user.name : p.userId}</strong>
              {p.founder && <span className="status published">Fundador</span>}
              <p className="hint">{p.city} · {p.status}{p.benefitUntil ? ' · benefício até ' + new Date(p.benefitUntil).toLocaleDateString('pt-BR') : ''}</p>
              {isMaster && p.status === 'active' && (
                <button className="btn btn-ghost" type="button" onClick={() => benefit(p.id)}>Ativar 90 dias de benefício agora</button>
              )}
            </div>
          ))}
        </>
      )}

      {tab === 'caixa' && (
        <>
          {!settings || !settings.ownBuyEnabled ? (
            <p className="empty">Compra própria desligada. A caixa existe, mas não opera estoque nem envia à vitrine.</p>
          ) : null}
          {!ownBox.length && <p className="empty">Nenhuma oportunidade na caixa própria.</p>}
          {ownBox.map((opp) => (
            <div key={opp.id} className="opp-card">
              <strong>{opp.listing ? opp.listing.title : opp.id}</strong>
              <p className="hint">{opp.ownBuyStatusLabel || 'Na caixa'} · {opp.city}</p>
              <p className="hint">Aquisição {money(opp.acquisition && opp.acquisition.acquisitionPrice)} · Revenda {money(opp.acquisition && opp.acquisition.resalePrice)} · Margem estimada {money(opp.acquisition && opp.acquisition.estimatedMargin)}</p>
            </div>
          ))}
        </>
      )}

      {tab === 'log' && isMaster && (
        <div className="opp-log">
          {audit.map((e) => (
            <div key={e.id} className="hint">{new Date(e.createdAt).toLocaleString('pt-BR')} · {e.action} · {e.actorRole || '-'}</div>
          ))}
        </div>
      )}

      {tab === 'fila' && (
        <>
          <div className="filters">
            <div className="field">
              <label>Buscar</label>
              <input value={filaQ} onChange={(e) => setFilaQ(e.target.value)} placeholder="Título, cidade ou ID" />
            </div>
            <div className="grid2">
              <div className="field">
                <label>Situação da oportunidade</label>
                <select value={filaStatus} onChange={(e) => setFilaStatus(e.target.value)}>
                  <option value="">Todas</option>
                  {STATUS_OPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Cidade</label>
                <select value={filaCity} onChange={(e) => setFilaCity(e.target.value)}>
                  <option value="">Todas</option>
                  {filaCities.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Autorização da Central</label>
                <select value={filaConsent} onChange={(e) => setFilaConsent(e.target.value)}>
                  <option value="">Todas</option>
                  <option value="yes">Autorizada</option>
                  <option value="no">Pendente</option>
                </select>
              </div>
              <div className="field">
                <label>Anúncio</label>
                <select value={filaListing} onChange={(e) => setFilaListing(e.target.value)}>
                  <option value="">Todos</option>
                  <option value="published">Ativo</option>
                  <option value="awaiting_review">Em revisão</option>
                  <option value="paused">Pausado</option>
                  <option value="sold">Vendido</option>
                </select>
              </div>
            </div>
          </div>
          {!!queue.length && <p className="hint">{filaRows.length} de {queue.length} na fila</p>}
        </>
      )}
      {tab === 'fila' && !queue.length && !err && (
        <p className="empty">Nenhum anúncio com proposta rápida. Quando o vendedor marcar a opção, ele aparece aqui.</p>
      )}
      {tab === 'fila' && !!queue.length && !filaRows.length && (
        <p className="empty">Nenhuma oportunidade com esses filtros.</p>
      )}
      {tab === 'fila' && filaRows.map((row) => {
        const opp = row.opportunity;
        const opened = open === row.listing.id;
        return (
          <div key={row.listing.id} className="opp-card">
            <div className="opp-head">
              {row.listing.images && row.listing.images[0] && <img src={row.listing.images[0].url} alt="" />}
              <div>
                <Link to={'/anuncio/' + row.listing.id}><strong>{row.listing.title}</strong></Link>
                <div className="price">{money(row.listing.price)}</div>
                <p className="hint">{row.listing.city} · {condLabel[row.listing.condition] || row.listing.condition} · {statusLabel[row.listing.status] || row.listing.status}</p>
                {opp && <span className={'status ' + opp.status}>{opp.statusLabel}</span>}
                {opp && <span className="hint"> · {opp.modeLabel}</span>}
              </div>
            </div>
            <button className="btn btn-ghost" type="button" onClick={() => setOpen(opened ? '' : row.listing.id)}>{opened ? 'Fechar' : 'Gerir'}</button>
            {opened && opp && (
              <div className="opp-admin">
                <PhotoGallery images={(opp.listing && opp.listing.images) || row.listing.images} alt={row.listing.title} size="hero" />
                <p className="hint">Autorização para a Central: {opp.consentToShare ? 'válida' : 'pendente'}{opp.consentTermsVersion ? ' · termos v' + opp.consentTermsVersion : ''}{opp.pendingConsent ? ' · pedido enviado' : ''}</p>
                <p className="hint">Mercadoria {money(opp.goodsPrice)} · Referência {money(opp.referencePrice)} · Remuneração {money(opp.intermediationFee)}{opp.feeConfigured ? '' : ' · taxa ainda não definida'}</p>
                <p className="hint">Confirmação: vendedor {opp.confirmations && opp.confirmations.seller ? 'sim' : 'não'} · catireiro {opp.confirmations && opp.confirmations.dealer ? 'sim' : 'não'}</p>
                {opp.completionBlocked ? <p className="hint">Conclusão bloqueada: {opp.completionBlocked}</p> : null}
                {opp.disputeReason && <p className="error">Disputa: {opp.disputeReason}</p>}
                {(opp.interests || []).length > 0 && (
                  <div>
                    <strong>Interessados</strong>
                    {opp.interests.map((i) => (
                      <p key={i.id} className="hint">{i.dealer && i.dealer.name} · {i.dealer && i.dealer.city} · {i.status} · {new Date(i.createdAt).toLocaleString('pt-BR')}</p>
                    ))}
                  </div>
                )}
                {(opp.offers || []).map((o) => (
                  <p key={o.id} className="hint">{o.originLabel || 'Proposta'} {money(o.amount)} · {o.status} · {o.presentedBy || ''} · até {new Date(o.validUntil).toLocaleString('pt-BR')}</p>
                ))}
                <h4>Enviar proposta ao vendedor</h4>
                <div className="field"><label>Valor da proposta</label><input value={offer.amount} onChange={(e) => setOffer({ ...offer, amount: formatBRLInput(e.target.value) })} inputMode="numeric" /></div>
                <div className="field"><label>Validade (horas)</label><input value={offer.validHours} onChange={(e) => setOffer({ ...offer, validHours: e.target.value.replace(/\D/g, '') })} /></div>
                <div className="field"><label>Condições</label><textarea value={offer.conditions} onChange={(e) => setOffer({ ...offer, conditions: e.target.value })} /></div>
                <div className="field">
                  <label>Origem da proposta</label>
                  <select value={offer.origin} onChange={(e) => setOffer({ ...offer, origin: e.target.value })}>
                    <option value="third_party">Terceiro, encaminhada ao vendedor</option>
                    <option value="own_buy">Compra própria do administrador</option>
                  </select>
                </div>
                <div className="field"><label>Quem apresenta</label><input value={offer.presentedBy} onChange={(e) => setOffer({ ...offer, presentedBy: e.target.value })} placeholder="Nome ou empresa" /></div>
                <button className="btn btn-primary" type="button" onClick={() => sendOffer(row.listing.id)}>Enviar proposta</button>
                <h4>Autorização e Central</h4>
                <p className="hint">Aceitar proposta não autoriza divulgação. Peça autorização específica, com o que será mostrado, para quem, por quanto tempo e como a taxa do catireiro é calculada.</p>
                <div className="field"><label>Preço ao catireiro</label><input value={fwd.referencePrice} onChange={(e) => setFwd({ ...fwd, referencePrice: formatBRLInput(e.target.value) })} inputMode="numeric" placeholder={String(opp.referencePrice || '')} /></div>
                {isMaster && (
                  <>
                    <div className="field"><label>Preço da mercadoria</label><input value={fwd.goodsPrice} onChange={(e) => setFwd({ ...fwd, goodsPrice: formatBRLInput(e.target.value) })} inputMode="numeric" /></div>
                    <div className="field"><label>Remuneração CATIRA</label><input value={fwd.intermediationFee} onChange={(e) => setFwd({ ...fwd, intermediationFee: formatBRLInput(e.target.value) })} inputMode="numeric" /></div>
                  </>
                )}
                <div className="field"><label>Condições apresentadas</label><textarea value={fwd.conditions} onChange={(e) => setFwd({ ...fwd, conditions: e.target.value })} /></div>
                <div className="row-btns">
                  <button className="btn btn-ghost" type="button" onClick={() => requestConsent(opp)}>Pedir autorização</button>
                  <button className="btn btn-dark" type="button" disabled={!opp.consentToShare} onClick={() => forward(opp)}>Encaminhar à Central</button>
                </div>
                <h4>Interessados e reserva</h4>
                <div className="field">
                  <label>Selecionar interessado</label>
                  <select value={reserve.dealerId} onChange={(e) => setReserve({ ...reserve, dealerId: e.target.value })}>
                    <option value="">Escolha</option>
                    {(opp.interests || []).filter((i) => i.status === 'interested' || i.status === 'selected').map((i) => (
                      <option key={i.id} value={i.dealerId}>{i.dealer && i.dealer.name} · {i.dealer && i.dealer.city}</option>
                    ))}
                  </select>
                </div>
                <div className="field"><label>Prazo da reserva (horas)</label><input value={reserve.hours} onChange={(e) => setReserve({ ...reserve, hours: e.target.value.replace(/\D/g, '') })} /></div>
                <div className="row-btns">
                  <button className="btn btn-ghost" type="button" onClick={() => reserveDeal(opp)}>Reservar temporariamente</button>
                  <button className="btn btn-ghost" type="button" onClick={() => negotiate(opp)}>Passar para em negociação</button>
                </div>
                <button className="btn btn-ghost" type="button" onClick={() => toOwnBox(opp.id)}>Avaliar compra própria</button>
                {opp.status === 'disputed' && (
                  <>
                    <div className="field"><label>Resolução da disputa (obrigatória)</label><textarea value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Não encerre no silêncio. Descreva a resolução." /></div>
                    <button className="btn btn-dark" type="button" onClick={() => resolveDisp(opp.id)}>Registrar resolução</button>
                  </>
                )}
                {opp.confirmations && opp.confirmations.seller && opp.confirmations.dealer && opp.status !== 'disputed' && opp.status !== 'completed' && (
                  <button className="btn btn-primary" type="button" onClick={() => completeDeal(opp.id)}>Registrar conclusão (taxa devida)</button>
                )}
                <div className="field" style={{ marginTop: 10 }}>
                  <label>Motivo (cancelar ou abrir disputa)</label>
                  <textarea value={disputeWhy} onChange={(e) => setDisputeWhy(e.target.value)} placeholder="Obrigatório para disputa ou cancelamento." />
                </div>
                <div className="chips" style={{ marginTop: 10 }}>
                  {STATUS_OPTS.filter(([k]) => !['completed', 'reserved', 'negotiating'].includes(k)).map(([k, l]) => (
                    <button key={k} className={'chip' + (opp.status === k ? ' on' : '')} type="button" onClick={() => setStatus(opp.id, k)}>{l}</button>
                  ))}
                </div>
                <p className="hint">O chip não marca venda concluída, reserva ou taxa devida. Isso só acontece pelas ações correspondentes.</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
