import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api, formatBRLInput, parseBRL, money, listingTypes, quotePremiumDays, addDaysISO, todayISO, weekdayName } from '../api';
import { useAuth, isAdminRole } from '../auth';
import { NeedAuth, Top } from '../components';
import { useConfig } from '../config';
import { compressImages } from '../compressImage';

const MIN_PHOTOS = 3;
const MAX_PHOTOS = 8;

export default function Create() {
  const { user } = useAuth();
  const { fee, vipListingFee, feeEnabled, commonFeeEnabled, vipFeeEnabled, premiumFeeEnabled, premiumDayFee } = useConfig();
  const commonOn = commonFeeEnabled !== undefined ? !!commonFeeEnabled : !!feeEnabled;
  const vipOn = !!vipFeeEnabled;
  const premiumOn = premiumFeeEnabled !== undefined ? !!premiumFeeEnabled : true;
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const editId = sp.get('edit');
  const fileRef = useRef(null);
  const photosRef = useRef([]);
  const [cats, setCats] = useState([]);
  const [cities, setCities] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [photos, setPhotos] = useState([]);
  const [preview, setPreview] = useState(false);
  const [takenDays, setTakenDays] = useState([]);
  const [editListing, setEditListing] = useState(null);
  const [adminNote, setAdminNote] = useState('');
  const [form, setForm] = useState({
    listingType: sp.get('type') || 'venda',
    title: '',
    description: '',
    categoryId: '',
    subcategory: '',
    price: '',
    condition: 'usado',
    city: user?.city || 'Corinto',
    acceptsCash: false,
    tradeWishes: '',
      vip: false,
      premium: false,
      premiumDays: [],
      quickOfferEnabled: false,
      waitForEvaluation: false,
    });

  useEffect(() => {
    api('/api/categories').then((c) => {
      setCats(c);
      if (c[0]) setForm((f) => ({ ...f, categoryId: f.categoryId || c[0].id }));
    }).catch(() => {});
    api('/api/auth/cities').then(setCities).catch(() => {});
    api('/api/listings/premium-days?days=14').then((d) => setTakenDays(d.taken || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (editId) return;
    if (user?.city) setForm((f) => ({ ...f, city: user.city }));
  }, [user, editId]);

  useEffect(() => {
    if (!editId || !user) return;
    api('/api/listings/' + editId)
      .then((d) => {
        if (d.userId !== user.id && !isAdminRole(user.role)) {
          setErr('Sem permissão para editar este anúncio.');
          return;
        }
        setEditListing(d);
        setAdminNote(d.adminNote || '');
        setForm({
          listingType: d.listingType || 'venda',
          title: d.title || '',
          description: d.description || '',
          categoryId: d.categoryId || '',
          subcategory: d.subcategory || '',
          price: formatBRLInput(String(Math.round(Number(d.price || 0) * 100))),
          condition: d.condition || 'usado',
          city: d.city || user.city || 'Corinto',
          acceptsCash: !!d.acceptsCash,
          tradeWishes: d.tradeWishes || '',
          vip: !!d.vip,
          premium: !!d.premium,
          premiumDays: Array.isArray(d.premiumDays) ? d.premiumDays : [],
          quickOfferEnabled: !!d.quickOfferEnabled,
          waitForEvaluation: !!d.waitForEvaluation,
        });
        setPhotos((d.images || []).map((img) => ({ id: img.id, preview: img.url })));
      })
      .catch((e) => setErr(e.message || 'Anúncio não encontrado.'));
  }, [editId, user]);

  photosRef.current = photos;
  useEffect(() => () => {
    photosRef.current.forEach((p) => {
      if (p.file && p.preview) URL.revokeObjectURL(p.preview);
    });
  }, []);

  const nextPath = editId ? '/anunciar?edit=' + editId : '/anunciar';
  if (!user) return <NeedAuth next={nextPath} />;
  if (!user.emailVerified && !isAdminRole(user.role)) {
    return <Navigate to={'/confirmar-email?next=' + encodeURIComponent(nextPath)} replace />;
  }

  function set(k, v) { setForm({ ...form, [k]: v }); }
  const isWant = form.listingType === 'procuro';
  const isTrade = form.listingType === 'troca' || form.listingType === 'venda_troca';
  const catName = (cats.find((c) => c.id === form.categoryId) || {}).name || '';
  const dayOptions = Array.from({ length: 14 }, (_, i) => addDaysISO(todayISO(), i));
  const takenSet = new Set(takenDays);
  const premiumQuote = quotePremiumDays(form.premiumDays, premiumDayFee);
  const payNow = form.premium
    ? (premiumOn ? premiumQuote.total : 0)
    : form.vip
      ? (vipOn ? vipListingFee : 0)
      : (commonOn ? fee : 0);

  async function onPhotos(e) {
    const incoming = [...(e.target.files || [])];
    e.target.value = '';
    if (!incoming.length) return;
    setErr('');
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      setErr('No máximo 8 fotos por anúncio.');
      return;
    }
    try {
      const compressed = await compressImages(incoming, room);
      setPhotos((prev) => [...prev, ...compressed]);
    } catch (ex) {
      setErr(ex.message || 'Não foi possível ler as fotos.');
    }
  }

  function removePhoto(idx) {
    setPhotos((prev) => {
      const next = prev.slice();
      URL.revokeObjectURL(next[idx].preview);
      next.splice(idx, 1);
      return next;
    });
  }

  function movePhoto(idx, dir) {
    setPhotos((prev) => {
      const next = prev.slice();
      const to = idx + dir;
      if (to < 0 || to >= next.length) return prev;
      const tmp = next[idx];
      next[idx] = next[to];
      next[to] = tmp;
      return next;
    });
  }

  function setMainPhoto(idx) {
    if (idx <= 0) return;
    setPhotos((prev) => {
      const next = prev.slice();
      const [main] = next.splice(idx, 1);
      next.unshift(main);
      return next;
    });
  }

  function validate() {
    const value = parseBRL(form.price);
    if (!form.title.trim() || !form.description.trim() || !form.categoryId) {
      return 'Preencha título, descrição e categoria.';
    }
    if (!form.price || value <= 0) return 'Informe um preço válido, só com números.';
    if (!isWant && photos.length < MIN_PHOTOS) return 'Adicione no mínimo 3 fotos do produto.';
    if (isTrade && !form.tradeWishes.trim()) return 'Diga o que você aceita em troca.';
    if (form.premium && !form.premiumDays.length) return 'Escolha pelo menos um dia para o anúncio Premium.';
    if (form.premium && form.premiumDays.some((d) => takenSet.has(d))) return 'Uma das datas Premium já foi reservada. Escolha outra.';
    return '';
  }

  function openPreview(e) {
    e.preventDefault();
    const msg = validate();
    if (msg) {
      setErr(msg);
      return;
    }
    setErr('');
    setPreview(true);
  }

  async function submit() {
    setErr('');
    const msg = validate();
    if (msg) {
      setErr(msg);
      setPreview(false);
      return;
    }
    setBusy(true);
    try {
      const value = parseBRL(form.price);
      const fd = new FormData();
      fd.append('listingType', form.listingType);
      fd.append('title', form.title);
      fd.append('description', form.description);
      fd.append('categoryId', form.categoryId);
      fd.append('subcategory', form.subcategory);
      fd.append('price', String(value.toFixed(2)));
      fd.append('condition', form.condition);
      fd.append('city', form.city);
      fd.append('acceptsTrade', String(isTrade));
      fd.append('acceptsCash', String(!!form.acceptsCash));
      fd.append('tradeWishes', form.tradeWishes);
      const city = cities.find((c) => c.name === form.city);
      if (city) fd.set('cityId', city.id);
      if (editListing) {
        fd.append('keepImageIds', JSON.stringify(photos.filter((p) => p.id).map((p) => p.id)));
        photos.filter((p) => p.file).forEach((p) => fd.append('photos', p.file));
        fd.append('quickOfferEnabled', String(!!form.quickOfferEnabled && !isWant));
        fd.append('waitForEvaluation', String(!!form.quickOfferEnabled && !!form.waitForEvaluation && !isWant));
        await api('/api/listings/' + editListing.id, { method: 'PUT', body: fd });
        nav('/meus-anuncios');
      } else {
        fd.append('vip', String(!!form.vip && !form.premium));
        fd.append('premium', String(!!form.premium));
        if (form.premium) fd.append('premiumDays', JSON.stringify(form.premiumDays));
        fd.append('quickOfferEnabled', String(!!form.quickOfferEnabled && !isWant));
        fd.append('waitForEvaluation', String(!!form.quickOfferEnabled && !!form.waitForEvaluation && !isWant));
        photos.forEach((p) => { if (p.file) fd.append('photos', p.file); });
        const d = await api('/api/listings', { method: 'POST', body: fd });
        nav(d.published ? '/anuncio/' + d.listing.id : '/pagar/' + d.listing.id);
      }
    } catch (ex) {
      setErr(ex.message);
      setPreview(false);
    }
    setBusy(false);
  }

  return (
    <>
      <Top back title={editListing ? (editListing.status === 'changes_requested' ? 'Corrigir' : 'Editar') : 'Anunciar'} />
      <div className="page">
        <h1>{editListing ? (editListing.status === 'changes_requested' ? 'Corrigir anúncio' : 'Editar anúncio') : 'Novo anúncio'}</h1>
        {adminNote && <p className="admin-note">Correção pedida: {adminNote}</p>}
        <p className="lead">
          {editListing
            ? (editListing.status === 'changes_requested'
              ? 'Ajuste o que foi pedido e envie de novo. O plano já pago permanece.'
              : 'Ao salvar, o anúncio sai do ar e volta para aprovação.')
            : [
                commonOn ? `Anúncio comum: ${money(fee)}.` : 'Anúncio comum é grátis.',
                vipOn ? `Destaque: ${money(vipListingFee)}.` : 'Destaque sem taxa.',
                premiumOn ? `Premium: ${money(premiumDayFee)} no domingo.` : 'Premium sem taxa.',
              ].join(' ')}
        </p>
        {err && <div className="error">{err}</div>}
        {editListing && editListing.status === 'changes_requested' && (
          <button
            className="btn btn-ghost"
            type="button"
            style={{ marginBottom: 12 }}
            onClick={async () => {
              if (!window.confirm('Cancelar esta publicação?')) return;
              try {
                await api('/api/listings/' + editListing.id + '/status', { method: 'POST', body: JSON.stringify({ action: 'cancel' }) });
                nav('/meus-anuncios');
              } catch (ex) {
                setErr(ex.message);
              }
            }}
          >
            Cancelar publicação
          </button>
        )}
        {!editListing && (
          <button
            type="button"
            className="smart-entry-btn"
            onClick={() => nav('/anunciar-inteligente')}
          >
            <span className="smart-entry-ico" aria-hidden="true">&#128247;</span>
            <span className="smart-entry-text">
              <strong>Anunciar com uma foto</strong>
              <small>Tire a foto e a gente ajuda com o resto</small>
            </span>
          </button>
        )}
        <form onSubmit={openPreview}>
          <div className="field">
            <label>Tipo de anúncio</label>
            <div className="cond wrap">
              {listingTypes.map((t) => (
                <label key={t.id}>
                  <input type="radio" name="listingType" checked={form.listingType === t.id} onChange={() => set('listingType', t.id)} />
                  <span>{t.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="field photos">
            <label>Fotos {isWant ? '(opcional)' : 'do produto'}</label>
            <input ref={fileRef} type="file" accept="image/*" multiple onChange={onPhotos} />
            <div className="hint">
              {isWant ? 'Fotos ajudam, mas não são obrigatórias no Procuro.' : 'Obrigatório no mínimo ' + MIN_PHOTOS + ' fotos. Até ' + MAX_PHOTOS + '. ' + photos.length + '/' + MIN_PHOTOS + ' no mínimo.'}
              {photos.length > 1 ? ' A primeira é a principal. Use as setas para ordenar.' : ''}
            </div>
            {photos.length > 0 && (
              <div className="photo-grid">
                {photos.map((p, i) => (
                  <div key={p.preview} className={'photo-item' + (i === 0 ? ' is-main' : '')}>
                    <img src={p.preview} alt={'Foto ' + (i + 1)} />
                    {i === 0 && <span className="photo-main-tag">Principal</span>}
                    <div className="photo-tools">
                      <button type="button" disabled={i === 0} onClick={() => movePhoto(i, -1)} aria-label="Mover para a esquerda">&#8592;</button>
                      <button type="button" disabled={i === photos.length - 1} onClick={() => movePhoto(i, 1)} aria-label="Mover para a direita">&#8594;</button>
                    </div>
                    {i > 0 && <button type="button" className="photo-main-btn" onClick={() => setMainPhoto(i)}>Tornar principal</button>}
                    <button type="button" className="photo-remove" onClick={() => removePhoto(i)}>Remover</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="field">
            <label>{isWant ? 'O que você procura?' : 'Título do anúncio'}</label>
            <input value={form.title} onChange={(e) => set('title', e.target.value)} required placeholder={isWant ? 'Ex.: iPhone 13' : 'Ex.: iPhone 13 128GB'} />
          </div>
          <div className="field">
            <label>Categoria</label>
            <select value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>{isWant ? 'Preço máximo (R$)' : 'Preço (R$)'}</label>
            <input
              value={form.price}
              onChange={(e) => set('price', formatBRLInput(e.target.value))}
              inputMode="numeric"
              autoComplete="off"
              placeholder="0,00"
              required
            />
            <div className="hint">{form.price ? 'Valor: R$ ' + form.price : 'Digite só números. Ex.: 2500 vira R$ 25,00'}</div>
          </div>
          <div className="field"><label>Descrição</label><textarea value={form.description} onChange={(e) => set('description', e.target.value)} required placeholder={isWant ? 'Se alguém tiver um em bom estado, tenho interesse.' : ''} /></div>
          {!isWant && (
            <div className="field">
              <label>Condição</label>
              <div className="cond">
                {['novo', 'seminovo', 'usado'].map((c) => (
                  <label key={c}><input type="radio" name="cond" checked={form.condition === c} onChange={() => set('condition', c)} /><span>{c[0].toUpperCase() + c.slice(1)}</span></label>
                ))}
              </div>
            </div>
          )}
          <div className="field">
            <label>Cidade</label>
            <select value={form.city} onChange={(e) => set('city', e.target.value)}>
              {cities.map((c) => <option key={c.id || c.name} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          {isTrade && (
            <>
              <div className="field">
                <label>O que você aceita em troca?</label>
                <textarea value={form.tradeWishes} onChange={(e) => set('tradeWishes', e.target.value)} placeholder="Aceito celular, bicicleta ou ferramenta." />
              </div>
              <div className="field">
                <label>Posso aceitar dinheiro como parte da negociação</label>
                <div className="cond">
                  <label><input type="radio" name="cash" checked={form.acceptsCash === true} onChange={() => set('acceptsCash', true)} /><span>Sim</span></label>
                  <label><input type="radio" name="cash" checked={form.acceptsCash === false} onChange={() => set('acceptsCash', false)} /><span>Não</span></label>
                </div>
              </div>
            </>
          )}
          {!editListing && (
          <>
          <div className="field">
            <label>Plano do anúncio</label>
            <div className="cond wrap">
              <label>
                <input type="radio" name="plan" checked={!form.vip && !form.premium} onChange={() => setForm({ ...form, vip: false, premium: false, premiumDays: [] })} />
                <span>Comum{commonOn ? ' ' + money(fee) : ' grátis'}</span>
              </label>
              <label>
                <input type="radio" name="plan" checked={form.vip && !form.premium} onChange={() => setForm({ ...form, vip: true, premium: false, premiumDays: [] })} />
                <span>Destaque{vipOn ? ' ' + money(vipListingFee) : ' grátis'}</span>
              </label>
              <label>
                <input type="radio" name="plan" checked={!!form.premium} onChange={() => setForm({ ...form, premium: true, vip: false })} />
                <span>Premium{premiumOn ? '' : ' grátis'}</span>
              </label>
            </div>
            <div className="hint">
              {form.premium
                ? 'Premium fica em destaque nos dias escolhidos. Domingo valor cheio, sábado 2/3, dia de semana 1/3.'
                : form.vip
                  ? 'Destaque: aparece na frente na home e na busca. Contato aberto para todo mundo.'
                  : 'Anúncio comum: qualquer usuário pode entrar em contato.'}
            </div>
          </div>
          {form.premium && (
            <div className="field">
              <label>Dias do Premium</label>
              <div className="cond wrap premium-days">
                {dayOptions.map((d) => {
                  const taken = takenSet.has(d);
                  const on = !taken && form.premiumDays.includes(d);
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
                            ? form.premiumDays.filter((x) => x !== d)
                            : [...form.premiumDays.filter((x) => !takenSet.has(x)), d].sort();
                          setForm({ ...form, premiumDays: next });
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
                {form.premiumDays.length
                  ? 'Total: ' + money(premiumQuote.total) + ' · ' + form.premiumDays.length + (form.premiumDays.length === 1 ? ' dia' : ' dias')
                  : 'Marque os dias livres. Datas em cinza já foram reservadas.'}
              </div>
            </div>
          )}
          </>
          )}
          {!isWant && (
            <div className="field">
              <label className={'fee-toggle' + (form.quickOfferEnabled ? ' on' : '')}>
                <span className="fee-toggle-info">
                  <strong>Aceito receber uma proposta rápida</strong>
                  <small>Você poderá receber uma proposta sobre este item. Aceitar uma proposta não significa concluir a venda nem autoriza automaticamente a divulgação na Central de Repasse.</small>
                </span>
                <input
                  type="checkbox"
                  checked={!!form.quickOfferEnabled}
                  onChange={(e) => setForm({ ...form, quickOfferEnabled: e.target.checked, waitForEvaluation: e.target.checked ? form.waitForEvaluation : false })}
                />
              </label>
              {form.quickOfferEnabled && (
                <label className={'fee-toggle' + (form.waitForEvaluation ? ' on' : '')} style={{ marginTop: 8 }}>
                  <span className="fee-toggle-info">
                    <strong>Aguardar avaliação antes de publicar</strong>
                    <small>Opcional. Sem isso, o anúncio entra no marketplace normalmente e também na fila de avaliação.</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={!!form.waitForEvaluation}
                    onChange={(e) => setForm({ ...form, waitForEvaluation: e.target.checked })}
                  />
                </label>
              )}
            </div>
          )}
          <button className="btn btn-primary">Ver prévia</button>
        </form>
      </div>
      {preview && (
        <div className="modal-bg" onClick={() => setPreview(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Prévia do anúncio</h3>
            {photos[0] && <img src={photos[0].preview} alt="" style={{ width: '100%', height: 160, objectFit: 'cover', borderRadius: 12, margin: '10px 0' }} />}
            <strong>{form.title}</strong>
            <div className="price">{isWant ? 'Até R$ ' + form.price : 'R$ ' + form.price}</div>
            <p className="hint">{(listingTypes.find((t) => t.id === form.listingType) || {}).label} · {catName} · {form.city}/MG{form.premium ? ' · Premium' : form.vip ? ' · Destaque' : ''}</p>
            {form.premium && form.premiumDays.length > 0 && <p className="hint">Premium: {form.premiumDays.length} {form.premiumDays.length === 1 ? 'dia' : 'dias'} · {money(premiumQuote.total)}</p>}
            {isTrade && form.tradeWishes && <p className="hint">Procura por: {form.tradeWishes}</p>}
            {form.quickOfferEnabled && !isWant && <p className="hint">Proposta rápida: o CATIRA pode avaliar. Você decide se aceita.{form.waitForEvaluation ? ' O anúncio espera a avaliação antes de ir ao ar.' : ''}</p>}
            <p style={{ marginTop: 8, fontSize: 14, whiteSpace: 'pre-wrap' }}>{form.description}</p>
            <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={busy} onClick={submit}>
              {busy ? 'Enviando...' : editListing ? (editListing.status === 'changes_requested' ? 'Enviar correção' : 'Salvar e enviar para aprovação') : payNow > 0 ? 'Continuar para pagamento (' + money(payNow) + ')' : 'Publicar anúncio'}
            </button>
            <button className="btn btn-ghost" style={{ marginTop: 8 }} type="button" onClick={() => setPreview(false)}>Voltar e editar</button>
          </div>
        </div>
      )}
    </>
  );
}
