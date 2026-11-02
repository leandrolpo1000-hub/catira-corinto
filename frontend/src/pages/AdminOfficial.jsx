import { useEffect, useState } from 'react';
import { api, money, formatBRLInput, parseBRL, condLabel } from '../api';

const PROVIDERS = [
  ['mercadolivre', 'Mercado Livre'],
  ['shopee', 'Shopee'],
  ['amazon', 'Amazon'],
  ['other', 'Outra plataforma'],
];

const OFFER_STATUS = [
  ['manual', 'Manual'],
  ['active', 'Ativa'],
  ['stale', 'Desatualizada'],
  ['suspended', 'Suspensa'],
];

const OFFER_LABEL = Object.fromEntries(OFFER_STATUS);

function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function toLabel(value) {
  const n = Number(value || 0);
  if (!n) return '';
  return formatBRLInput(String(Math.round(n * 100)));
}

export default function AdminOfficial() {
  const [items, setItems] = useState([]);
  const [cats, setCats] = useState([]);
  const [cities, setCities] = useState([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(null);
  const [offerForm, setOfferForm] = useState(null);
  const [offerErr, setOfferErr] = useState('');
  const [meli, setMeli] = useState(null);
  const [meliUrl, setMeliUrl] = useState('');
  const [meliBusy, setMeliBusy] = useState(false);
  const [meliApp, setMeliApp] = useState({ clientId: '', clientSecret: '', redirectUri: '' });

  async function load() {
    const [list, cs, ct, st] = await Promise.all([
      api('/api/admin/official/products'),
      api('/api/admin/categories').catch(() => ({ items: [] })),
      api('/api/auth/cities').catch(() => []),
      api('/api/admin/official/meli/status').catch((e) => ({ configured: false, connected: false, error: e.message })),
    ]);
    setItems(list.items || []);
    setCats(cs.items || []);
    setCities(Array.isArray(ct) ? ct : []);
    setMeli(st);
    const app = st.app || {};
    setMeliApp({
      clientId: app.clientId || '',
      clientSecret: '',
      redirectUri: app.redirectUri || (typeof window !== 'undefined' ? window.location.origin.replace(/\/+$/, '') + '/api/meli/callback' : ''),
    });
  }

  useEffect(() => {
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const state = params.get('state');
      const meliFlag = params.get('meli');
      const meliMsg = params.get('meliMsg');
      if (code && state) {
        try {
          await api('/api/admin/official/meli/callback', {
            method: 'POST',
            body: JSON.stringify({ code, state }),
          });
          setOk('Mercado Livre conectado.');
        } catch (e) {
          setErr(e.message);
        }
      } else if (meliFlag === 'ok') {
        setOk('Mercado Livre conectado.');
      } else if (meliFlag === 'err') {
        setErr(meliMsg || 'Falha ao conectar o Mercado Livre.');
      }
      if (code || state || meliFlag) {
        params.delete('code');
        params.delete('state');
        params.delete('meli');
        params.delete('meliMsg');
        const qs = params.toString();
        window.history.replaceState({}, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash);
      }
      await load();
    })().catch((e) => setErr(e.message));
  }, []);

  function resetMessages() {
    setErr('');
    setOk('');
  }

  function blankForm() {
    return {
      id: '',
      title: '',
      description: '',
      categoryId: cats[0] ? cats[0].id : '',
      subcategory: '',
      condition: 'novo',
      costPriceLabel: '',
      pricingRule: 'fixed',
      marginLabel: '',
      manualPriceLabel: '',
      published: true,
      city: '',
      cityId: '',
      deliveryMode: 'cities',
      deliveryCities: [],
      providerSummary: '',
      images: [],
    };
  }

  function openCreate() {
    resetMessages();
    setEditing(null);
    setForm(blankForm());
  }

  function openEdit(product) {
    resetMessages();
    setEditing(product);
    const delivery = product.delivery || { mode: 'cities', cityIds: [] };
    setForm({
      id: product.id,
      title: product.title || '',
      description: product.description || '',
      categoryId: product.categoryId || (cats[0] && cats[0].id) || '',
      subcategory: product.subcategory || '',
      condition: product.condition || 'novo',
      costPriceLabel: toLabel(product.costPrice),
      pricingRule: product.pricingRule || 'fixed',
      marginLabel: product.pricingRule === 'percent' ? String(product.marginValue || '') : toLabel(product.marginValue),
      manualPriceLabel: toLabel(product.manualPrice),
      published: !!product.published,
      city: product.city || '',
      cityId: product.cityId || '',
      deliveryMode: delivery.mode === 'all' ? 'all' : 'cities',
      deliveryCities: Array.isArray(delivery.cityIds) ? delivery.cityIds.slice() : [],
      providerSummary: product.providerSummary || '',
      images: Array.isArray(product.images) ? product.images.slice() : [],
    });
  }

  function payload() {
    return {
      title: form.title,
      description: form.description,
      categoryId: form.categoryId,
      subcategory: form.subcategory,
      condition: form.condition,
      costPrice: parseBRL(form.costPriceLabel),
      pricingRule: form.pricingRule,
      marginValue: form.pricingRule === 'percent' ? Number(form.marginLabel || 0) : parseBRL(form.marginLabel),
      manualPrice: form.manualPriceLabel ? parseBRL(form.manualPriceLabel) : null,
      published: !!form.published,
      city: form.city,
      cityId: form.cityId,
      delivery: {
        mode: form.deliveryMode,
        cityIds: form.deliveryMode === 'all' ? [] : form.deliveryCities,
      },
      providerSummary: form.providerSummary,
      images: form.images.map((im) => ({ url: im.url })),
    };
  }

  async function save(e) {
    if (e) e.preventDefault();
    setBusy(true);
    resetMessages();
    try {
      const body = JSON.stringify(payload());
      if (editing) {
        await api('/api/admin/official/products/' + editing.id, { method: 'PUT', body });
        setOk('Produto atualizado.');
      } else {
        await api('/api/admin/official/products', { method: 'POST', body });
        setOk('Produto criado.');
      }
      setForm(null);
      setEditing(null);
      await load();
    } catch (ex) {
      setErr(ex.message);
    }
    setBusy(false);
  }

  async function remove(product) {
    if (!window.confirm('Remover "' + product.title + '" do catálogo oficial?')) return;
    setBusy(true);
    resetMessages();
    try {
      await api('/api/admin/official/products/' + product.id, { method: 'DELETE' });
      setOk('Produto removido.');
      if (editing && editing.id === product.id) {
        setEditing(null);
        setForm(null);
      }
      await load();
    } catch (ex) {
      setErr(ex.message);
    }
    setBusy(false);
  }

  function toggleCity(id) {
    setForm((f) => {
      const has = f.deliveryCities.includes(id);
      return {
        ...f,
        deliveryCities: has ? f.deliveryCities.filter((x) => x !== id) : f.deliveryCities.concat(id),
      };
    });
  }

  async function uploadImage(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    e.target.value = '';
    setBusy(true);
    resetMessages();
    try {
      const fd = new FormData();
      fd.append('image', file);
      const d = await api('/api/admin/official/upload', { method: 'POST', body: fd });
      setForm((f) => ({ ...f, images: f.images.concat({ url: d.url }) }));
    } catch (ex) {
      setErr(ex.message);
    }
    setBusy(false);
  }

  function removeImage(idx) {
    setForm((f) => ({ ...f, images: f.images.filter((_, i) => i !== idx) }));
  }

  function openOffer(product, offer) {
    setOfferErr('');
    setOfferForm({
      productId: product.id,
      offerId: offer ? offer.id : '',
      title: product.title,
      provider: offer ? offer.provider : 'mercadolivre',
      priceLabel: offer ? toLabel(offer.price) : '',
      previousPriceLabel: offer ? toLabel(offer.previousPrice) : '',
      url: offer ? (offer.url || '') : '',
      stock: offer && offer.stock ? String(offer.stock) : '',
      status: offer ? offer.status : 'manual',
      affiliateTag: offer ? (offer.affiliateTag || '') : '',
      note: offer ? (offer.note || '') : '',
    });
  }

  async function saveOffer(e) {
    if (e) e.preventDefault();
    setOfferErr('');
    setBusy(true);
    try {
      const body = JSON.stringify({
        provider: offerForm.provider,
        price: offerForm.priceLabel ? parseBRL(offerForm.priceLabel) : null,
        previousPrice: offerForm.previousPriceLabel ? parseBRL(offerForm.previousPriceLabel) : null,
        url: offerForm.url,
        stock: Number(offerForm.stock || 0),
        status: offerForm.status,
        affiliateTag: offerForm.affiliateTag,
        note: offerForm.note,
      });
      if (offerForm.offerId) {
        await api('/api/admin/official/products/' + offerForm.productId + '/offers/' + offerForm.offerId, {
          method: 'PUT',
          body,
        });
      } else {
        await api('/api/admin/official/products/' + offerForm.productId + '/offers', { method: 'POST', body });
      }
      setOfferForm(null);
      setOk('Oferta salva.');
      await load();
    } catch (ex) {
      setOfferErr(ex.message);
    }
    setBusy(false);
  }

  async function toggleOffer(product, offer) {
    setBusy(true);
    resetMessages();
    try {
      const status = offer.status === 'suspended'
        ? (offer.source === 'process' ? 'active' : 'manual')
        : 'suspended';
      await api('/api/admin/official/products/' + product.id + '/offers/' + offer.id + '/status', {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      setOk(status === 'suspended' ? 'Oferta suspensa.' : 'Oferta reativada.');
      await load();
    } catch (ex) {
      setErr(ex.message);
    }
    setBusy(false);
  }

  async function saveMeliApp(e) {
    if (e) e.preventDefault();
    setMeliBusy(true);
    resetMessages();
    try {
      const body = {
        clientId: meliApp.clientId,
        redirectUri: meliApp.redirectUri,
      };
      if (meliApp.clientSecret && meliApp.clientSecret.trim()) body.clientSecret = meliApp.clientSecret.trim();
      const d = await api('/api/admin/official/meli/settings', { method: 'PUT', body: JSON.stringify(body) });
      setMeli(d);
      setMeliApp({
        clientId: (d.app && d.app.clientId) || meliApp.clientId,
        clientSecret: '',
        redirectUri: (d.app && d.app.redirectUri) || meliApp.redirectUri,
      });
      setOk(d.configured ? 'Aplicativo Mercado Livre salvo.' : 'Salvo. Preencha Client ID, Secret e Redirect HTTPS.');
    } catch (ex) {
      setErr(ex.message);
    }
    setMeliBusy(false);
  }

  async function connectMeli() {
    setMeliBusy(true);
    resetMessages();
    try {
      const d = await api('/api/admin/official/meli/connect');
      window.location.href = d.url;
    } catch (ex) {
      setErr(ex.message);
      setMeliBusy(false);
    }
  }

  async function disconnectMeli() {
    if (!window.confirm('Desconectar a conta do Mercado Livre?')) return;
    setMeliBusy(true);
    resetMessages();
    try {
      await api('/api/admin/official/meli/disconnect', { method: 'POST', body: '{}' });
      setOk('Mercado Livre desconectado.');
      await load();
    } catch (ex) {
      setErr(ex.message);
    }
    setMeliBusy(false);
  }

  async function importMeli(e) {
    if (e) e.preventDefault();
    setMeliBusy(true);
    resetMessages();
    try {
      const d = await api('/api/admin/official/meli/import', {
        method: 'POST',
        body: JSON.stringify({ url: meliUrl }),
      });
      setMeliUrl('');
      await load();
      if (d.product) openEdit(d.product);
      setOk(d.created ? 'Anúncio importado como rascunho.' : 'Anúncio já existia e foi atualizado.');
    } catch (ex) {
      setErr(ex.message);
    }
    setMeliBusy(false);
  }

  async function syncNow() {
    if (!editing) return;
    setBusy(true);
    resetMessages();
    try {
      const d = await api('/api/admin/official/products/' + editing.id + '/meli/sync', {
        method: 'POST',
        body: '{}',
      });
      await load();
      if (d.product) openEdit(d.product);
      setOk('Ficha atualizada pelo Mercado Livre.');
    } catch (ex) {
      setErr(ex.message);
    }
    setBusy(false);
  }

  async function removeOffer(product, offer) {
    if (!window.confirm('Remover a oferta ' + offer.providerLabel + '?')) return;
    setBusy(true);
    resetMessages();
    try {
      await api('/api/admin/official/products/' + product.id + '/offers/' + offer.id, { method: 'DELETE' });
      setOk('Oferta removida.');
      await load();
    } catch (ex) {
      setErr(ex.message);
    }
    setBusy(false);
  }

  return (
    <>
      {err && <div className="error">{err}</div>}
      {ok && <div className="okbox">{ok}</div>}

      {!form && (
        <>
          <div className="meli-box">
            <strong>Mercado Livre</strong>
            <p className="hint">Cole o Client ID e o Client Secret do app no Mercado Livre. O Redirect URI tem que ser exatamente o mesmo cadastrado lá. O secret não aparece depois de salvo.</p>
            <form onSubmit={saveMeliApp}>
              <div className="field">
                <label>Client ID</label>
                <input value={meliApp.clientId} onChange={(e) => setMeliApp({ ...meliApp, clientId: e.target.value })} placeholder="App ID" autoComplete="off" />
              </div>
              <div className="field">
                <label>Client Secret</label>
                <input
                  type="password"
                  value={meliApp.clientSecret}
                  onChange={(e) => setMeliApp({ ...meliApp, clientSecret: e.target.value })}
                  placeholder={(meli && meli.app && meli.app.secretHint) || 'App Secret'}
                  autoComplete="off"
                />
              </div>
              <div className="field">
                <label>Redirect URI</label>
                <input value={meliApp.redirectUri} onChange={(e) => setMeliApp({ ...meliApp, redirectUri: e.target.value })} placeholder="https://seu-dominio/api/meli/callback" autoComplete="off" />
                <div className="hint">Ex.: {typeof window !== 'undefined' ? window.location.origin.replace(/\/+$/, '') + '/api/meli/callback' : '/api/meli/callback'}</div>
              </div>
              <button type="submit" className="btn btn-primary" disabled={meliBusy}>Salvar aplicativo</button>
            </form>
            {meli && meli.configured ? (
              <>
                <p className="hint">
                  {meli.connected ? ('Conta ' + meli.meliUserId + (meli.tokenExpired ? ' · token vencido' : ' · conectada')) : 'Desconectado'}
                </p>
                {meli.connected
                  ? <button type="button" className="chip" onClick={disconnectMeli} disabled={meliBusy}>Desconectar</button>
                  : <button type="button" className="chip" onClick={connectMeli} disabled={meliBusy}>Conectar</button>}
                <form onSubmit={importMeli}>
                  <input value={meliUrl} onChange={(e) => setMeliUrl(e.target.value)} placeholder="URL do anúncio, /p/ ou código MLB…" />
                  <button type="submit" className="btn" disabled={meliBusy}>{meliBusy ? 'Importando…' : 'Importar'}</button>
                  <div className="hint">Cole anúncio próprio (MLB) ou página /p/ de terceiro (wid= escolhe o vendedor; senão o menor preço). Catálogo /up/MLBU não importa.</div>
                </form>
              </>
            ) : (
              <p className="hint">Depois de salvar as 3 chaves, o botão Conectar aparece aqui.</p>
            )}
          </div>
          <div className="chips" style={{ marginBottom: 12 }}>
            <button type="button" className="btn btn-primary" onClick={openCreate}>Novo produto oficial</button>
          </div>
          {!items.length && <p className="hint">Nenhum produto oficial cadastrado.</p>}
          {items.map((p) => (
            <div key={p.id} className="official-admin-card">
              <div className="official-admin-head">
                <div>
                  <strong>{p.title}</strong>
                  <div className="hint">
                    {p.categoryId ? (cats.find((c) => c.id === p.categoryId) || {}).name : 'Sem categoria'}
                    {' · '}{money(p.price)}
                    {' · '}{p.published ? 'publicado' : 'pausado'}
                    {' · '}{p.offers.length} {p.offers.length === 1 ? 'oferta' : 'ofertas'}
                    {!p.manualPrice && !p.costPrice ? <em className="awaiting-price"> Aguardando preço</em> : null}
                  </div>
                </div>
                <div className="row-btns">
                  <button type="button" className="chip" onClick={() => openEdit(p)}>Editar</button>
                  <button type="button" className="chip" onClick={() => openOffer(p)}>Oferta</button>
                  <button type="button" className="chip" onClick={() => remove(p)}>Excluir</button>
                </div>
              </div>
              <div className="official-admin-offers">
                {p.offers.map((o) => (
                  <div key={o.id} className={'official-admin-offer' + (o.incomplete ? ' incomplete' : '') + (o.live ? '' : ' off')}>
                    <span>{o.providerLabel}</span>
                    <b>{o.price ? money(o.price) : 'sem preço'}</b>
                    {o.previousPrice ? <s>{money(o.previousPrice)}</s> : null}
                    <em className={'offer-state ' + (o.live ? 'live' : 'off')}>
                      {o.live ? (OFFER_LABEL[o.status] || o.status) : (OFFER_LABEL[o.status] || 'Inativa')}
                    </em>
                    {o.incomplete && <em className="offer-state warn">incompleta</em>}
                    {o.source === 'process' && o.lastSyncAt && <span className="hint">sync {formatWhen(o.lastSyncAt)}</span>}
                    {o.updatedAt && <span className="hint">atualizada {formatWhen(o.updatedAt)}</span>}
                    {o.url && <a href={o.url} target="_blank" rel="noopener noreferrer nofollow">abrir</a>}
                    {o.source !== 'process' && <button type="button" className="chip" onClick={() => openOffer(p, o)}>editar</button>}
                    <button type="button" className="chip" onClick={() => toggleOffer(p, o)}>{o.status === 'suspended' ? 'reativar' : 'suspender'}</button>
                    <button type="button" className="chip" onClick={() => removeOffer(p, o)}>remover</button>
                  </div>
                ))}
                {!p.offers.length && <p className="hint">Nenhuma oferta cadastrada. Sem oferta ativa o produto fica fora do catálogo.</p>}
              </div>
            </div>
          ))}
        </>
      )}

      {form && (
        <form className="official-form" onSubmit={save}>
          <h3>{editing ? 'Editar produto oficial' : 'Novo produto oficial'}</h3>
          {form.id && editing && editing.meliItemId ? (
            <button type="button" className="chip" onClick={syncNow} disabled={busy}>Atualizar agora</button>
          ) : null}
          <div className="field">
            <label>Título</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </div>
          <div className="field">
            <label>Descrição</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="grid2">
            <div className="field">
              <label>Categoria</label>
              <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} required>
                <option value="">Escolha</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Subcategoria</label>
              <input value={form.subcategory} onChange={(e) => setForm({ ...form, subcategory: e.target.value })} />
            </div>
            <div className="field">
              <label>Condição</label>
              <select value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })}>
                {Object.entries(condLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Publicado</label>
              <select value={form.published ? '1' : '0'} onChange={(e) => setForm({ ...form, published: e.target.value === '1' })}>
                <option value="1">Sim</option>
                <option value="0">Não</option>
              </select>
            </div>
          </div>

          <h4>Preço</h4>
          <div className="grid2">
            <div className="field">
              <label>Custo do fornecedor</label>
              <input value={form.costPriceLabel} onChange={(e) => setForm({ ...form, costPriceLabel: formatBRLInput(e.target.value) })} inputMode="numeric" placeholder="0,00" />
            </div>
            <div className="field">
              <label>Regra de margem</label>
              <select value={form.pricingRule} onChange={(e) => setForm({ ...form, pricingRule: e.target.value, marginLabel: '' })}>
                <option value="fixed">Valor fixo</option>
                <option value="percent">Percentual</option>
              </select>
            </div>
            <div className="field">
              <label>{form.pricingRule === 'percent' ? 'Margem (%)' : 'Margem (R$)'}</label>
              {form.pricingRule === 'percent' ? (
                <input value={form.marginLabel} onChange={(e) => setForm({ ...form, marginLabel: e.target.value.replace(/[^\d.]/g, '') })} inputMode="decimal" placeholder="0" />
              ) : (
                <input value={form.marginLabel} onChange={(e) => setForm({ ...form, marginLabel: formatBRLInput(e.target.value) })} inputMode="numeric" placeholder="0,00" />
              )}
            </div>
            <div className="field">
              <label>Preço comercial manual (opcional)</label>
              <input value={form.manualPriceLabel} onChange={(e) => setForm({ ...form, manualPriceLabel: formatBRLInput(e.target.value) })} inputMode="numeric" placeholder="0,00" />
            </div>
          </div>
          <p className="hint">A decisão manual de preço não é sobrescrita por mudança de custo.</p>

          <h4>Entrega e cobertura</h4>
          <div className="grid2">
            <div className="field">
              <label>Cobertura</label>
              <select value={form.deliveryMode} onChange={(e) => setForm({ ...form, deliveryMode: e.target.value })}>
                <option value="cities">Cidades específicas</option>
                <option value="all">Nacional</option>
              </select>
            </div>
            <div className="field">
              <label>Cidade de exibição (opcional)</label>
              <select value={form.cityId} onChange={(e) => {
                const row = cities.find((c) => (c.id || c.name) === e.target.value);
                setForm({ ...form, cityId: e.target.value, city: row ? row.name : '' });
              }}>
                <option value="">Não informar</option>
                {cities.map((c) => <option key={c.id || c.name} value={c.id || c.name}>{c.name}{c.state ? '/' + c.state : ''}</option>)}
              </select>
            </div>
          </div>
          {form.deliveryMode === 'cities' && (
            <div className="official-cities">
              {cities.map((c) => {
                const id = c.id || c.name;
                return (
                  <label key={id} className={'chip' + (form.deliveryCities.includes(id) ? ' on' : '')}>
                    <input type="checkbox" checked={form.deliveryCities.includes(id)} onChange={() => toggleCity(id)} style={{ display: 'none' }} />
                    {c.name}
                  </label>
                );
              })}
            </div>
          )}

          <div className="field">
            <label>Resumo do fornecedor</label>
            <input value={form.providerSummary} onChange={(e) => setForm({ ...form, providerSummary: e.target.value })} placeholder="Ex.: fornecedor autorizado, prazo de envio" />
          </div>

          <div className="field">
            <label>Imagens</label>
            <input type="file" accept="image/*" onChange={uploadImage} />
            <div className="official-form-images">
              {form.images.map((im, i) => (
                <span key={i} className="official-form-image">
                  <img src={im.url} alt="" />
                  <button type="button" className="chip" onClick={() => removeImage(i)}>remover</button>
                </span>
              ))}
            </div>
          </div>

          <button className="btn btn-primary" disabled={busy}>{editing ? 'Salvar produto' : 'Criar produto'}</button>
          <button type="button" className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => { setForm(null); setEditing(null); }}>
            Cancelar
          </button>
        </form>
      )}

      {offerForm && (
        <div className="modal-bg" onClick={() => setOfferForm(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={saveOffer}>
            <h3>{offerForm.offerId ? 'Editar oferta' : 'Nova oferta'} — {offerForm.title}</h3>
            {offerErr && <div className="error">{offerErr}</div>}
            <p className="hint">A compra acontece na plataforma parceira. Preço informado não altera o preço comercial do produto.</p>
            <div className="field">
              <label>Plataforma</label>
              <select value={offerForm.provider} onChange={(e) => setOfferForm({ ...offerForm, provider: e.target.value })} disabled={!!offerForm.offerId}>
                {PROVIDERS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Preço anunciado (opcional)</label>
              <input value={offerForm.priceLabel} onChange={(e) => setOfferForm({ ...offerForm, priceLabel: formatBRLInput(e.target.value) })} inputMode="numeric" placeholder="0,00" />
            </div>
            <div className="field">
              <label>Preço anterior (opcional)</label>
              <input value={offerForm.previousPriceLabel} onChange={(e) => setOfferForm({ ...offerForm, previousPriceLabel: formatBRLInput(e.target.value) })} inputMode="numeric" placeholder="0,00" />
            </div>
            <div className="field">
              <label>Link oficial</label>
              <input value={offerForm.url} onChange={(e) => setOfferForm({ ...offerForm, url: e.target.value })} placeholder="https://" required={offerForm.status !== 'suspended'} />
            </div>
            <div className="grid2">
              <div className="field">
                <label>Estoque</label>
                <input value={offerForm.stock} onChange={(e) => setOfferForm({ ...offerForm, stock: e.target.value.replace(/\D/g, '') })} inputMode="numeric" placeholder="0" />
              </div>
              <div className="field">
                <label>Situação</label>
                <select value={offerForm.status} onChange={(e) => setOfferForm({ ...offerForm, status: e.target.value })}>
                  {OFFER_STATUS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            <div className="field">
              <label>Identificador de afiliado (opcional)</label>
              <input value={offerForm.affiliateTag} onChange={(e) => setOfferForm({ ...offerForm, affiliateTag: e.target.value })} />
            </div>
            <div className="field">
              <label>Observação</label>
              <input value={offerForm.note} onChange={(e) => setOfferForm({ ...offerForm, note: e.target.value })} />
            </div>
            <button className="btn btn-primary" disabled={busy}>Salvar oferta</button>
            <button type="button" className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => setOfferForm(null)}>Cancelar</button>
          </form>
        </div>
      )}
    </>
  );
}
