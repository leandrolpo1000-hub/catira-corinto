import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api, money, formatBRLInput, parseBRL, listingTypes, condLabel } from '../api';
import { useAuth, isAdminRole } from '../auth';
import { useConfig } from '../config';
import { NeedAuth, Top } from '../components';
import { compressImage, compressImages } from '../compressImage';

const MIN_PHOTOS = 3;
const MAX_PHOTOS = 8;
const DRAFT_KEY = 'catira_smart_draft';

const STEP_ORDER = ['start', 'analyzing', 'review', 'price', 'condition', 'photos', 'preview'];
const STEP_LABEL = {
  start: 'Foto',
  review: 'Revisão',
  price: 'Preço',
  condition: 'Estado',
  photos: 'Fotos',
  preview: 'Prévia',
};

const LOAD_STAGES = ['Lendo a foto', 'Olhando o produto', 'Preparando a sugestão', 'Quase pronto'];

const QUALITY_MSG = {
  dark: 'A foto está escura. Toque em "Tirar outra foto" para ficar mais fácil de ver.',
  blurry: 'A foto está desfocada. Tente de novo, mais de perto e com boa luz.',
};

export default function IntelligentCreate() {
  const { user } = useAuth();
  const { assistantEnabled, fee, feeEnabled, commonFeeEnabled } = useConfig();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);
  const photosRef = useRef([]);
  const submittingRef = useRef(false);

  const [step, setStep] = useState('start');
  const [cats, setCats] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');
  const [photos, setPhotos] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [draft, setDraft] = useState(null);
  const [done, setDone] = useState(null);
  const [loadPct, setLoadPct] = useState(0);
  const [loadStage, setLoadStage] = useState(0);
  const [form, setForm] = useState({
    listingType: sp.get('type') || 'venda',
    title: '',
    description: '',
    categoryId: '',
    price: '',
    condition: 'usado',
    tradeWishes: '',
    quickOfferEnabled: false,
    waitForEvaluation: false,
  });

  const commonOn = commonFeeEnabled !== undefined ? !!commonFeeEnabled : !!feeEnabled;
  const isWant = form.listingType === 'procuro';
  const isTrade = form.listingType === 'troca' || form.listingType === 'venda_troca';

  useEffect(() => {
    api('/api/categories').then(setCats).catch(() => {});
  }, []);

  // Recupera rascunho de texto caso algo tenha falhado antes.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved && saved.title) setDraft(saved);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    return () => {
      photosRef.current.forEach((p) => { if (p.preview) URL.revokeObjectURL(p.preview); });
    };
  }, []);

  // Barra de progresso da análise: avança rápido no início e desacelera perto do fim,
  // porque o tempo da IA varia. Nunca chega a 100% antes da resposta.
  useEffect(() => {
    if (step !== 'analyzing') return undefined;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setLoadPct((prev) => {
        if (prev >= 92) return prev;
        const stepSize = prev < 45 ? 4 : prev < 70 ? 2 : prev < 85 ? 1 : 0.4;
        return Math.min(92, prev + stepSize);
      });
      setLoadStage(elapsed > 9000 ? 2 : elapsed > 2500 ? 1 : 0);
    }, 280);
    return () => clearInterval(timer);
  }, [step]);

  photosRef.current = photos;

  const nextPath = '/anunciar-inteligente';
  if (!user) return <NeedAuth next={nextPath} />;
  if (!user.emailVerified && !isAdminRole(user.role)) {
    return <Navigate to={'/confirmar-email?next=' + encodeURIComponent(nextPath)} replace />;
  }

  function persistDraft(patch) {
    const next = { ...draft, ...patch };
    setDraft(next);
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); persistDraft({ [k]: v }); }

  function addFiles(files) {
    const incoming = [...files];
    if (!incoming.length) return;
    setErr('');
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) { setErr('No máximo ' + MAX_PHOTOS + ' fotos.'); return; }
    compressImages(incoming, room)
      .then((compressed) => setPhotos((prev) => [...prev, ...compressed]))
      .catch((ex) => setErr(ex.message || 'Não foi possível ler as fotos.'));
  }

  function removePhoto(idx) {
    setPhotos((prev) => {
      const next = prev.slice();
      if (next[idx] && next[idx].file) URL.revokeObjectURL(next[idx].preview);
      next.splice(idx, 1);
      return next;
    });
  }

  function openPicker(ref) {
    if (notConfigured) {
      setErr('A foto inteligente ainda não está ativa. Peça ao administrador para ligar o assistente ou use o anúncio tradicional.');
      return;
    }
    if (ref.current) ref.current.click();
  }

  function retryAnalyze() {
    const file = photos[0] && photos[0].file;
    if (file) analyze([file]);
  }

  async function analyze(files) {
    const list = [...(files || [])].filter((f) => f && f.type && f.type.startsWith('image/'));
    if (!list.length) {
      setErr('Não conseguimos abrir essa foto. Tente escolher outra imagem.');
      return;
    }
    setErr('');
    setLoadPct(6);
    setLoadStage(0);
    setStep('analyzing');
    try {
      const compact = await compressImage(list[0]);
      const previewUrl = URL.createObjectURL(compact);
      setPhotos([{ file: compact, preview: previewUrl }]);
      const rest = await compressImages(list.slice(1), MAX_PHOTOS - 1).catch(() => []);
      if (rest.length) setPhotos([{ file: compact, preview: previewUrl }, ...rest]);
      const fd = new FormData();
      fd.append('photo', compact);
      fd.append('listingType', form.listingType);
      if (hint.trim()) fd.append('hint', hint.trim());
      if (user.city) fd.append('city', user.city);
      const d = await api('/api/listings/assistant/analyze', { method: 'POST', body: fd });
      const a = d.analysis || {};
      setAnalysis(a);
      const patch = {
        title: a.title || draft?.title || '',
        description: a.description || draft?.description || '',
        categoryId: a.categoryId || draft?.categoryId || (cats[0] && cats[0].id) || '',
        condition: a.condition || draft?.condition || 'usado',
      };
      setForm((f) => ({ ...f, ...patch }));
      persistDraft(patch);
      setLoadPct(100);
      setLoadStage(3);
      await new Promise((r) => setTimeout(r, 420));
      setStep('review');
    } catch (ex) {
      setLoadPct(0);
      setErr(ex.message || 'Não foi possível analisar a foto.');
      setStep('start');
    }
  }

  async function improve() {
    setErr('');
    setBusy(true);
    try {
      const d = await api('/api/listings/assistant/improve', {
        method: 'POST',
        body: JSON.stringify({ title: form.title, description: form.description, listingType: form.listingType, categoryId: form.categoryId }),
      });
      const s = d.suggestion || {};
      set('title', s.title || form.title);
      set('description', s.description || form.description);
    } catch (ex) {
      setErr(ex.message);
    }
    setBusy(false);
  }

  function validatePhotos(list) {
    if (isWant) return '';
    if (list.length < MIN_PHOTOS) return 'Faltam ' + (MIN_PHOTOS - list.length) + ' foto(s) para o anúncio ficar completo.';
    return '';
  }

  function canPublish() {
    if (!form.title.trim()) return 'Precisamos de um título.';
    if (!form.categoryId) return 'Escolha uma categoria.';
    if (!form.description.trim()) return 'Falta uma descrição. Toque em "Melhorar o texto" se precisar de ajuda.';
    const value = parseBRL(form.price);
    if (!value || value <= 0) return 'Informe o preço.';
    if (!isWant && photos.length < MIN_PHOTOS) return 'Adicione pelo menos ' + MIN_PHOTOS + ' fotos.';
    if (isTrade && !form.tradeWishes.trim()) return 'Diga o que você aceita em troca.';
    return '';
  }

  async function publish() {
    if (submittingRef.current) return;
    const msg = canPublish();
    if (msg) { setErr(msg); return; }
    setErr('');
    setBusy(true);
    submittingRef.current = true;
    try {
      const value = parseBRL(form.price);
      const fd = new FormData();
      fd.append('listingType', form.listingType);
      fd.append('title', form.title);
      fd.append('description', form.description);
      fd.append('categoryId', form.categoryId);
      fd.append('price', String(value.toFixed(2)));
      fd.append('condition', isWant ? 'usado' : form.condition);
      if (user.city) fd.append('city', user.city);
      fd.append('acceptsTrade', String(isTrade));
      fd.append('tradeWishes', form.tradeWishes);
      fd.append('vip', 'false');
      fd.append('premium', 'false');
      fd.append('quickOfferEnabled', String(!!form.quickOfferEnabled && !isWant));
      fd.append('waitForEvaluation', String(!!form.quickOfferEnabled && !!form.waitForEvaluation && !isWant));
      photos.forEach((p) => { if (p.file) fd.append('photos', p.file); });
      const d = await api('/api/listings', { method: 'POST', body: fd });
      try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      if (d.published) {
        setDone({ id: d.listing.id, published: true });
      } else {
        nav('/pagar/' + d.listing.id);
      }
    } catch (ex) {
      setErr(ex.message);
    }
    submittingRef.current = false;
    setBusy(false);
  }

  if (done) {
    return (
      <>
        <Top back title="Anúncio publicado" />
        <div className="page smart-done">
          <div className="smart-done-badge">&#10004;</div>
          <h1>Tudo pronto!</h1>
          <p className="lead">Seu anúncio já está no ar no CATIRA.</p>
          <button className="btn btn-primary" onClick={() => nav('/anuncio/' + done.id)}>Ver meu anúncio</button>
          <button className="btn btn-ghost" onClick={() => nav('/')}>Voltar ao início</button>
        </div>
      </>
    );
  }

  const stepIdx = STEP_ORDER.indexOf(step);
  const catName = (cats.find((c) => c.id === form.categoryId) || {}).name || '';
  const estimate = analysis && analysis.priceEstimate;
  const notConfigured = !assistantEnabled;

  return (
    <>
      <Top back title="Anunciar com uma foto" />
      <div className="page smart-page">
        {stepIdx >= 0 && step !== 'start' && step !== 'analyzing' && (
          <div className="smart-progress" aria-hidden="true">
            {['review', 'price', 'condition', 'photos', 'preview'].map((s, i) => (
              <span key={s} className={'smart-dot' + (STEP_ORDER.indexOf(s) <= stepIdx ? ' on' : '')} />
            ))}
          </div>
        )}

        {err && (
          <div className="error">
            {err}
            {step === 'start' && photos[0] && photos[0].file && (
              <button type="button" className="btn btn-ghost" style={{ marginTop: 10 }} onClick={retryAnalyze}>
                Tentar de novo com esta foto
              </button>
            )}
          </div>
        )}

        {step === 'start' && (
          <div className="smart-start">
            <h1>Anuncie com uma foto</h1>
            <p className="lead">Tire uma foto do que você quer vender. Nós ajudamos com o resto.</p>

            {notConfigured && (
              <div className="smart-warn">
                O recurso de foto inteligente ainda está sendo preparado pela equipe do CATIRA.
                Enquanto isso, você pode anunciar do jeito tradicional.
                <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => nav('/anunciar')}>Anunciar do jeito tradicional</button>
              </div>
            )}

            <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => { const picked = [...(e.target.files || [])]; e.target.value = ''; analyze(picked); }} />
            <input ref={galleryRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const picked = [...(e.target.files || [])]; e.target.value = ''; analyze(picked); }} />

            <button type="button" className="smart-photo-btn" onClick={() => openPicker(cameraRef)}>
              <span className="smart-photo-ico" aria-hidden="true">&#128247;</span>
              <span>Tirar uma foto agora</span>
            </button>
            <button type="button" className="smart-photo-btn alt" onClick={() => openPicker(galleryRef)}>
              <span className="smart-photo-ico" aria-hidden="true">&#128444;</span>
              <span>Escolher da galeria</span>
            </button>

            <div className="field" style={{ marginTop: 18 }}>
              <label>Quer contar algo sobre o produto? (opcional)</label>
              <input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="Ex.: é novo, tem 2 anos de uso" />
            </div>

            {draft && draft.title && (
              <button type="button" className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => {
                setForm((f) => ({ ...f, ...draft }));
                setAnalysis({ title: draft.title, description: draft.description, categoryId: draft.categoryId, condition: draft.condition, features: [], missing: [] });
                setStep('review');
              }}>
                Continuar rascunho de antes
              </button>
            )}
            <button type="button" className="smart-skip" onClick={() => nav('/anunciar')}>Prefiro preencher tudo sozinho</button>
          </div>
        )}

        {step === 'analyzing' && (
          <div className="smart-loading">
            <div className="smart-spinner" aria-hidden="true"><span /><span /><span /><span /><span /><span /><span /><span /></div>
            <h2>Preparando seu anúncio...</h2>
            <p className="lead">Estamos olhando a foto para sugerir título, categoria e descrição.</p>

            <div className="smart-bar-wrap">
              <div
                className="smart-bar"
                role="progressbar"
                aria-label="Carregando análise da foto"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(loadPct)}
              >
                <span className="smart-bar-fill" style={{ width: loadPct + '%' }} />
              </div>
              <div className="smart-bar-info">
                <span className="smart-bar-stage">{LOAD_STAGES[loadStage] || LOAD_STAGES[0]}</span>
                <span className="smart-bar-pct">{Math.round(loadPct)}%</span>
              </div>
            </div>

            {photos[0] && <img className="smart-loading-photo" src={photos[0].preview} alt="Foto enviada" />}
          </div>
        )}

        {step === 'review' && (
          <div className="smart-step">
            <h2>Veja o que preparamos</h2>
            <p className="lead">Confira e corrija o que quiser. Está tudo fácil de mudar.</p>

            {analysis && analysis.imageQuality && analysis.imageQuality !== 'ok' && (
              <div className="smart-warn">
                {QUALITY_MSG[analysis.imageQuality]}
                <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => galleryRef.current && galleryRef.current.click()}>Tirar outra foto</button>
              </div>
            )}
            {analysis && analysis.prohibited && (
              <div className="error">
                Este produto pode não ser permitido no CATIRA{analysis.prohibitedReason ? ': ' + analysis.prohibitedReason : '.'} Vamos analisar antes de publicar.
              </div>
            )}
            {analysis && analysis.duplicate && (
              <div className="smart-warn">
                Você já tem um anúncio parecido: “{analysis.duplicate.title}”. Confira se não é o mesmo produto.
                <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => nav('/anuncio/' + analysis.duplicate.id)}>Ver anúncio existente</button>
              </div>
            )}
            {analysis && !analysis.identified && (
              <div className="smart-warn">Não consegui reconhecer o produto com certeza. Escreva o nome dele abaixo.</div>
            )}

            {photos[0] && <img className="smart-review-photo" src={photos[0].preview} alt="Produto" />}

            <div className="field">
              <label>O que é este produto?</label>
              <input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder={isWant ? 'Ex.: iPhone 13' : 'Ex.: Geladeira usada'} />
            </div>
            <div className="field">
              <label>Categoria</label>
              <select value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Descrição</label>
              <textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={3} />
              <button type="button" className="btn btn-ghost" disabled={busy} style={{ marginTop: 8 }} onClick={improve}>
                {busy ? 'Melhorando...' : 'Melhorar o texto com um toque'}
              </button>
            </div>

            {analysis && analysis.features && analysis.features.length > 0 && (
              <div className="smart-chips">
                <span className="smart-chips-label">O que aparece na foto</span>
                <div className="smart-chip-row">
                  {analysis.features.map((f) => <span key={f} className="smart-chip">{f}</span>)}
                </div>
              </div>
            )}

            <div className="field">
              <label>Este anúncio é para</label>
              <div className="cond wrap">
                {listingTypes.map((t) => (
                  <label key={t.id}>
                    <input type="radio" name="smarttype" checked={form.listingType === t.id} onChange={() => set('listingType', t.id)} />
                    <span>{t.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {isTrade && (
              <div className="field">
                <label>O que você aceita em troca?</label>
                <input value={form.tradeWishes} onChange={(e) => set('tradeWishes', e.target.value)} placeholder="Ex.: outra moto, celular, ferramentas" />
              </div>
            )}

            <button className="btn btn-primary smart-next" onClick={() => setStep('price')}>Continuar</button>
          </div>
        )}

        {step === 'price' && (
          <div className="smart-step">
            <h2>{isWant ? 'Quanto você quer pagar?' : 'Por quanto você quer vender?'}</h2>
            <p className="lead">Digite só números. Ex.: 2500 vira R$ 25,00.</p>
            <input
              className="smart-price-input"
              value={form.price}
              onChange={(e) => set('price', formatBRLInput(e.target.value))}
              inputMode="numeric"
              autoComplete="off"
              placeholder="0,00"
              autoFocus
            />
            {form.price && <p className="smart-price-show">R$ {form.price}</p>}
            {estimate && !form.price && (
              <p className="hint">Por produtos parecidos no CATIRA, costuma ficar entre {money(estimate.min)} e {money(estimate.max)}. É só uma referência.</p>
            )}
            {analysis && analysis.missing && analysis.missing.some((m) => /preco|preço|valor/i.test(m)) && (
              <p className="hint">O preço ficou faltando no anúncio. Você decide o valor.</p>
            )}
            <div className="smart-actions">
              <button className="btn btn-primary" onClick={() => {
                if (!form.price) {
                  if (estimate) { set('price', formatBRLInput(String(Math.round((estimate.min + estimate.max) / 2 * 100)))); return; }
                  setErr('Digite um valor aproximado. Você pode combinar depois.'); return;
                }
                setErr(''); setStep(isWant ? 'photos' : 'condition');
              }}>Continuar</button>
              <button className="btn btn-ghost" onClick={() => {
                if (estimate) { set('price', formatBRLInput(String(Math.round((estimate.min + estimate.max) / 2 * 100)))); setErr(''); setStep(isWant ? 'photos' : 'condition'); }
                else setErr('Sem preço não dá para publicar. Coloque um valor aproximado e combine o resto depois.');
              }}>Não sei o preço</button>
            </div>
            <button className="smart-back" onClick={() => setStep('review')}>Voltar</button>
          </div>
        )}

        {step === 'condition' && (
          <div className="smart-step">
            <h2>Como está o produto?</h2>
            <p className="lead">Escolha o estado de conservação.</p>
            <div className="smart-choice">
              {['novo', 'seminovo', 'usado'].map((c) => (
                <button key={c} type="button" className={'smart-choice-btn' + (form.condition === c ? ' on' : '')} onClick={() => { set('condition', c); setStep('photos'); }}>
                  {condLabel[c] || c}
                </button>
              ))}
              <button type="button" className="smart-choice-btn alt" onClick={() => setStep('photos')}>Não sei / prefiro não dizer</button>
            </div>
            <button className="smart-back" onClick={() => setStep('price')}>Voltar</button>
          </div>
        )}

        {step === 'photos' && (
          <div className="smart-step">
            <h2>{isWant ? 'Quer adicionar uma foto?' : 'Falta pouco: mais fotos'}</h2>
            <p className="lead">
              {isWant
                ? 'Uma foto de referência ajuda, mas não é obrigatória.'
                : 'Anúncios com ' + MIN_PHOTOS + ' fotos vendem mais. Você tem ' + photos.length + ' de ' + MIN_PHOTOS + '.'}
            </p>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => { const picked = [...(e.target.files || [])]; e.target.value = ''; addFiles(picked); }} />
            <input ref={galleryRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => { const picked = [...(e.target.files || [])]; e.target.value = ''; addFiles(picked); }} />
            <div className="photo-grid">
              {photos.map((p, i) => (
                <div key={p.preview} className={'photo-item' + (i === 0 ? ' is-main' : '')}>
                  <img src={p.preview} alt={'Foto ' + (i + 1)} />
                  {i === 0 && <span className="photo-main-tag">Principal</span>}
                  <button type="button" className="photo-remove" onClick={() => removePhoto(i)}>Remover</button>
                </div>
              ))}
              {photos.length < MAX_PHOTOS && (
                <button type="button" className="smart-photo-add" onClick={() => galleryRef.current && galleryRef.current.click()}>
                  <span aria-hidden="true">+</span>
                  Adicionar
                </button>
              )}
            </div>
            {validatePhotos(photos) && <p className="hint">{validatePhotos(photos)}</p>}
            <button className="btn btn-primary smart-next" onClick={() => {
              const msg = validatePhotos(photos);
              if (msg) { setErr(msg); return; }
              setErr(''); setStep('preview');
            }}>
              Continuar
            </button>
            <button className="smart-back" onClick={() => setStep(isWant ? 'price' : 'condition')}>Voltar</button>
          </div>
        )}

        {step === 'preview' && (
          <div className="smart-step">
            <h2>Ficou assim</h2>
            <p className="lead">Confira antes de publicar.</p>
            <div className="smart-preview-card">
              {photos[0] && <img className="smart-preview-img" src={photos[0].preview} alt="Produto" />}
              <div className="smart-preview-body">
                <span className="smart-preview-cat">{catName || 'Sem categoria'}</span>
                <h3>{form.title || 'Sem título'}</h3>
                <div className="price">{form.price ? money(parseBRL(form.price)) : 'Preço a combinar'}</div>
                <p className="smart-preview-meta">
                  {(listingTypes.find((t) => t.id === form.listingType) || {}).label}
                  {!isWant ? ' · ' + (condLabel[form.condition] || form.condition) : ''}
                  {user.city ? ' · ' + user.city + '/MG' : ''}
                </p>
                <p className="smart-preview-desc">{form.description || 'Sem descrição.'}</p>
                {isTrade && form.tradeWishes && <p className="smart-preview-meta">Aceita em troca: {form.tradeWishes}</p>}
              </div>
            </div>
            {!isWant && (
              <>
              <label className={'fee-toggle' + (form.quickOfferEnabled ? ' on' : '')} style={{ margin: '12px 0' }}>
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
                <label className={'fee-toggle' + (form.waitForEvaluation ? ' on' : '')} style={{ marginBottom: 12 }}>
                  <span className="fee-toggle-info">
                    <strong>Aguardar avaliação antes de publicar</strong>
                    <small>Opcional. Sem isso, o anúncio entra no marketplace e também na fila de avaliação.</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={!!form.waitForEvaluation}
                    onChange={(e) => setForm({ ...form, waitForEvaluation: e.target.checked })}
                  />
                </label>
              )}
              </>
            )}
            {commonOn && <p className="hint">Publicação comum: {money(fee)} (você confirma o pagamento na próxima tela).</p>}
            {!commonOn && <p className="hint">Publicação gratuita.</p>}
            <button className="btn btn-primary smart-next" disabled={busy} onClick={publish}>
              {busy ? 'Publicando...' : 'PUBLICAR ANÚNCIO'}
            </button>
            <button className="btn btn-ghost" style={{ marginTop: 8 }} disabled={busy} onClick={() => setStep('review')}>CORRIGIR INFORMAÇÕES</button>
          </div>
        )}
      </div>
    </>
  );
}
