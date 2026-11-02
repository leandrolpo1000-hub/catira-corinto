import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { AccountButton, BrandLogo, Empty, NeedAuth, PhotoGallery, Top } from '../components';
import { useAuth, isAdminRole } from '../auth';
import { compressImages, revokePreviews } from '../compressImage';
import { Ico } from '../icons';
import { CommentsSheet } from '../CommentsSheet';

const AUDIO_MAX_SEC = 60;
const SILENCE_MS = 3000;

function speechEngine() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function joinCaption(base, spoken) {
  const a = String(base || '').trim();
  const b = String(spoken || '').replace(/\s+/g, ' ').trim();
  return [a, b].filter(Boolean).join(' ').slice(0, 500);
}

const STATUS_LABEL = {
  sold: 'Vendido',
  traded: 'Trocado',
  negotiated: 'Negociado',
};

function ActionAudio({ url, transcript, compact }) {
  if (!url) return null;
  return (
    <div className={'acao-audio' + (compact ? ' compact' : '')}>
      <audio controls preload="none" src={url}>Seu navegador não toca este áudio.</audio>
      {transcript ? <p className="acao-transcript">{transcript}</p> : null}
    </div>
  );
}

function likesLabel(n) {
  if (!n) return '';
  if (n === 1) return '1 curtida';
  return n + ' curtidas';
}

export function ActionPostCard({ post, onReport, onChange, user, onOpenComments }) {
  if (!post) return null;
  const author = post.author;
  const liked = !!post.liked;
  const [menu, setMenu] = useState(false);
  const [openCap, setOpenCap] = useState(false);
  const nav = useNavigate();
  const longCap = String(post.text || '').length > 110;
  const shown = openCap || !longCap ? post.text : String(post.text).slice(0, 110).trim();

  async function like() {
    if (!user) {
      nav('/entrar?next=/em-acao');
      return;
    }
    try {
      const next = await api('/api/acao/' + post.id + '/like', { method: 'POST' });
      onChange && onChange(next);
    } catch {}
  }

  return (
    <article className="acao-ig">
      <header className="acao-ig-head">
        {author ? (
          <Link to={'/usuario/' + author.id} className="acao-ig-user">
            <span className="acao-ig-ring">
              <span className="avatar sm" style={{ background: author.avatarColor }}>{(author.name || '?').slice(0, 1)}</span>
            </span>
            <span>
              <strong>{author.name}</strong>
              <em>{author.city || 'Corinto'}</em>
            </span>
          </Link>
        ) : <span>Anunciante</span>}
        {onReport && (
          <button type="button" className="acao-ig-more" onClick={() => setMenu((v) => !v)} aria-label="Mais opções">
            <Ico name="more" size={22} />
          </button>
        )}
        {menu && (
          <div className="acao-ig-menu">
            <button type="button" onClick={() => { setMenu(false); onReport(post); }}>Denunciar</button>
          </div>
        )}
      </header>
      {post.images && post.images.length > 0 && (
        <PhotoGallery images={post.images} alt="" size="feed" onDoubleTap={like} />
      )}
      <div className="acao-ig-actions">
        <button type="button" className={'acao-ig-btn' + (liked ? ' on' : '')} onClick={like} aria-label={liked ? 'Descurtir' : 'Curtir'} aria-pressed={liked}>
          <Ico name="heart" size={26} stroke={1.7} fill={liked ? 'currentColor' : 'none'} />
        </button>
        <button type="button" className="acao-ig-btn" onClick={() => onOpenComments && onOpenComments(post)} aria-label="Comentar">
          <Ico name="chat" size={26} stroke={1.7} />
        </button>
      </div>
      {!!post.likeCount && <p className="acao-ig-likes">{likesLabel(post.likeCount)}</p>}
      <p className="acao-ig-cap">
        {author && <Link to={'/usuario/' + author.id}>{author.name}</Link>}
        {' '}{shown}{longCap && !openCap ? '... ' : ' '}
        {longCap && !openCap && (
          <button type="button" className="acao-ig-more-text" onClick={() => setOpenCap(true)}>mais</button>
        )}
      </p>
      {!!post.commentCount && (
        <button type="button" className="acao-ig-view" onClick={() => onOpenComments && onOpenComments(post)}>
          Ver {post.commentCount === 1 ? '1 comentário' : 'todos os ' + post.commentCount + ' comentários'}
        </button>
      )}
      <p className="acao-ig-time">{post.timeAgo}</p>
      <button type="button" className="acao-ig-add" onClick={() => onOpenComments && onOpenComments(post)}>
        Adicione um comentário...
      </button>
      <ActionAudio url={post.audioUrl} transcript={post.audioTranscript} />
    </article>
  );
}

export default function ActionFeed() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [reportFor, setReportFor] = useState(null);
  const [reason, setReason] = useState('falso');
  const [desc, setDesc] = useState('');
  const [ok, setOk] = useState('');
  const [err, setErr] = useState('');
  const [openPost, setOpenPost] = useState(null);

  function patchPost(next) {
    setItems((prev) => prev.map((p) => (p.id === next.id ? { ...p, ...next } : p)));
    setOpenPost((cur) => (cur && cur.id === next.id ? { ...cur, ...next } : cur));
  }

  function load(nextPage) {
    setLoading(true);
    api('/api/acao?page=' + nextPage + '&limit=12')
      .then((d) => {
        setItems(nextPage === 1 ? (d.items || []) : (prev) => prev.concat(d.items || []));
        setTotal(d.total || 0);
        setPage(nextPage);
      })
      .catch(() => {
        if (nextPage === 1) setItems([]);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(1); }, []);

  async function sendReport() {
    if (!reportFor) return;
    try {
      await api('/api/acao/' + reportFor.id + '/report', {
        method: 'POST',
        body: JSON.stringify({ reason, description: desc }),
      });
      setOk('Denúncia enviada.');
      setReportFor(null);
      setDesc('');
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <>
      <header className="acao-ig-top">
        <Link to="/" className="brand-link" aria-label="CATIRA Corinto">
          <BrandLogo size="sm" />
        </Link>
        <div className="acao-top-right">
          {user && (
            <Link to="/em-acao/publicar" className="acao-plus" aria-label="Publicar">
              <Ico name="plus" size={24} stroke={1.8} />
            </Link>
          )}
          <AccountButton />
        </div>
      </header>
      <div className="acao-page">
        {ok && <div className="okbox">{ok}</div>}
        {err && <div className="error">{err}</div>}
        {!items.length && !loading && (
          <Empty title="Nada por aqui ainda" text="Quando alguém publicar depois de uma negociação, aparece nesta aba." />
        )}
        <div className="acao-feed">
          {items.map((p) => (
            <ActionPostCard
              key={p.id}
              post={p}
              user={user}
              onChange={patchPost}
              onReport={user ? setReportFor : null}
              onOpenComments={setOpenPost}
            />
          ))}
        </div>
        {items.length < total && (
          <button className="btn btn-ghost" style={{ margin: 16 }} disabled={loading} onClick={() => load(page + 1)}>
            {loading ? 'Carregando...' : 'Ver mais'}
          </button>
        )}
      </div>
      {openPost && (
        <CommentsSheet
          subject={{ id: openPost.id, author: openPost.author, commentCount: openPost.commentCount }}
          user={user}
          base={'/api/acao/' + openPost.id}
          loginNext="/em-acao"
          onClose={() => setOpenPost(null)}
          onChange={patchPost}
        />
      )}
      {reportFor && (
        <div className="modal-bg" onClick={() => setReportFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Denunciar publicação</h3>
            <div className="field">
              <label>Motivo</label>
              <select value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="falso">Conteúdo falso</option>
                <option value="inadequado">Inadequado</option>
                <option value="enganoso">Enganoso</option>
                <option value="golpe">Suspeita de golpe</option>
                <option value="outro">Outro</option>
              </select>
            </div>
            <div className="field">
              <label>Detalhe (opcional)</label>
              <textarea value={desc} onChange={(e) => setDesc(e.target.value)} />
            </div>
            <button className="btn btn-primary" type="button" onClick={sendReport}>Enviar</button>
          </div>
        </div>
      )}
    </>
  );
}

export function ActionNotices() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (!user) return;
    api('/api/acao/notices').then((d) => setItems(d.items || [])).catch(() => {});
    api('/api/acao/notices/read', { method: 'POST' }).catch(() => {});
  }, [user]);
  if (!user) return <NeedAuth next="/em-acao/avisos" />;
  return (
    <>
      <Top back title="Avisos" />
      <div className="page">
        <h1>Avisos do Catira em Ação</h1>
        {!items.length && <Empty title="Nenhum aviso" text="Quando alguém curtir ou comentar sua publicação, aparece aqui." to="/em-acao" cta="Ver o feed" />}
        {items.map((n) => (
          <Link key={n.id} to="/em-acao" className={'list-item acao-notice' + (n.read ? '' : ' unread')}>
            <span className="avatar sm" style={{ background: n.actor && n.actor.avatarColor }}>{((n.actor && n.actor.name) || '?').slice(0, 1)}</span>
            <div>
              <strong>{n.text}</strong>
              <p className="hint">{n.timeAgo}</p>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}

export function ActionCreate() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const listingFromUrl = sp.get('listing') || '';
  const [eligible, setEligible] = useState([]);
  const [listingId, setListingId] = useState(listingFromUrl);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState([]);
  const photosRef = useRef([]);
  const [recording, setRecording] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const recRef = useRef(null);
  const textRef = useRef('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    api('/api/acao/eligible').then((d) => {
      const items = d.items || [];
      setEligible(items);
      if (!listingFromUrl && items.length === 1) setListingId(items[0].id);
    }).catch(() => {});
  }, [user]);

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(() => {
    textRef.current = text;
  }, [text]);
  useEffect(() => () => {
    revokePreviews(photosRef.current);
    const rec = recRef.current;
    if (!rec) return;
    rec.discard = true;
    if (rec.timer) clearInterval(rec.timer);
    if (rec.silenceTimer) clearTimeout(rec.silenceTimer);
    try { if (rec.speech) rec.speech.stop(); } catch {}
  }, []);

  if (!user) return <NeedAuth next="/em-acao/publicar" />;

  async function onFiles(e) {
    const room = 8 - photos.length;
    const next = await compressImages(e.target.files, room);
    setPhotos((prev) => prev.concat(next));
    e.target.value = '';
  }

  function finishSession(rec) {
    if (!rec || rec.discard) return;
    const live = String(rec.spoken || textRef.current || '').trim();
    const before = rec.captionBefore || '';
    if (live && live !== before) {
      textRef.current = live;
      setText(live);
      setErr('');
      return;
    }
    if (!live) setErr('Não deu para ouvir. Fale de novo ou escreva o que aconteceu.');
  }

  function clearRecTimers(rec) {
    if (!rec) return;
    if (rec.timer) {
      clearInterval(rec.timer);
      rec.timer = null;
    }
    if (rec.silenceTimer) {
      clearTimeout(rec.silenceTimer);
      rec.silenceTimer = null;
    }
  }

  function bumpSilence(rec) {
    if (!rec || rec.stopping || rec.discard) return;
    if (rec.silenceTimer) clearTimeout(rec.silenceTimer);
    rec.silenceTimer = setTimeout(() => {
      if (recRef.current === rec && !rec.stopping) stopRecorder();
    }, SILENCE_MS);
  }

  function stopRecorder() {
    const rec = recRef.current;
    if (!rec || rec.stopping) return;
    rec.stopping = true;
    setRecording(false);
    setRecSec(0);
    clearRecTimers(rec);
    if (rec.speech) {
      try { rec.speech.stop(); } catch {}
    }
    if (recRef.current === rec) recRef.current = null;
    finishSession(rec);
  }

  function startVoiceCaption(rec) {
    const SR = speechEngine();
    if (!SR || !rec) return null;
    const speech = new SR();
    speech.lang = 'pt-BR';
    speech.interimResults = true;
    speech.continuous = false;
    speech.maxAlternatives = 3;
    const baseText = rec.captionBefore || '';
    let committed = '';
    let lastText = '';
    speech.onresult = (e) => {
      rec.heard = true;
      bumpSilence(rec);
      const parts = [];
      let interim = '';
      for (let i = 0; i < e.results.length; i += 1) {
        const piece = String(e.results[i][0].transcript || '').replace(/\s+/g, ' ').trim();
        if (!piece) continue;
        if (e.results[i].isFinal) parts.push(piece);
        else interim = piece;
      }
      lastText = joinCaption(parts.join(' '), interim);
      rec.spoken = joinCaption(baseText, joinCaption(committed, lastText));
      textRef.current = rec.spoken;
      setText(rec.spoken);
    };
    speech.onerror = (e) => {
      const name = e && e.error;
      if (name === 'aborted') return;
      if (name === 'no-speech') {
        if (!rec.stopping) stopRecorder();
        return;
      }
      rec.speechBlocked = true;
      rec.stopping = true;
      clearRecTimers(rec);
      if (recRef.current === rec) recRef.current = null;
      setRecording(false);
      setRecSec(0);
      setErr(name === 'not-allowed' || name === 'service-not-allowed'
        ? 'Permita o acesso ao microfone para falar o que aconteceu.'
        : 'Não consegui ouvir. Tente novamente.');
    };
    speech.onend = () => {
      if (rec.speech !== speech) return;
      if (lastText) committed = joinCaption(committed, lastText);
      lastText = '';
      rec.spoken = joinCaption(baseText, committed);
      textRef.current = rec.spoken;
      setText(rec.spoken);
      if (rec.discard || rec.stopping || rec.speechBlocked) return;
      try {
        speech.start();
      } catch {
        stopRecorder();
      }
    };
    rec.speech = speech;
    try {
      speech.start();
      bumpSilence(rec);
      return speech;
    } catch {
      rec.speech = null;
      return null;
    }
  }

  function toggleRecord() {
    if (recording) {
      stopRecorder();
      return;
    }
    if (recRef.current) return;
    const SR = speechEngine();
    if (!SR) {
      setErr('Seu navegador não transcreve áudio. Escreva o que falou.');
      return;
    }
    setErr('');
    const rec = {
      timer: null,
      silenceTimer: null,
      speech: null,
      captionBefore: textRef.current.trim(),
      spoken: textRef.current.trim(),
      heard: false,
      speechBlocked: false,
      stopping: false,
      discard: false,
    };
    recRef.current = rec;
    if (!startVoiceCaption(rec)) {
      recRef.current = null;
      setErr('Não foi possível iniciar a transcrição.');
      return;
    }
    setRecording(true);
    setRecSec(0);
    rec.timer = setInterval(() => {
      setRecSec((n) => {
        if (n + 1 >= AUDIO_MAX_SEC) {
          stopRecorder();
          return AUDIO_MAX_SEC;
        }
        return n + 1;
      });
    }, 1000);
  }

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (!listingId) {
      setErr('Escolha o anúncio desta publicação.');
      return;
    }
    if (!photos.length) {
      setErr('Envie pelo menos uma foto.');
      return;
    }
    if (recording) {
      setErr('Pare a gravação antes de publicar.');
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('listingId', listingId);
      fd.append('text', text);
      photos.forEach((p) => fd.append('photos', p.file));
      await api('/api/acao', { method: 'POST', body: fd });
      revokePreviews(photos);
      nav('/em-acao');
    } catch (ex) {
      setErr(ex.message);
    }
    setBusy(false);
  }

  const needsEmail = user && !user.emailVerified && !isAdminRole(user.role);

  return (
    <>
      <Top back title="Publicar" />
      <div className="page">
        <h1>Publicar no Catira em Ação</h1>
        <p className="lead">Conte o que rolou, sem preço e sem dado de contato. Isso não altera sua reputação.</p>
        {needsEmail && (
          <div className="verify-banner">
            <div>
              <strong>Confirme seu e-mail</strong>
              <p>Sem confirmação você não consegue publicar.</p>
            </div>
            <Link to="/confirmar-email" className="btn btn-primary">Confirmar</Link>
          </div>
        )}
        {!eligible.length && !needsEmail && (
          <Empty
            title="Nada para publicar"
            text="Marque um anúncio como vendido, trocado ou negociado. Depois você escolhe se quer publicar."
            to="/meus-anuncios"
            cta="Meus anúncios"
          />
        )}
        {!!eligible.length && (
          <form onSubmit={submit}>
            {err && <div className="error">{err}</div>}
            <div className="field">
              <label>Anúncio</label>
              <select value={listingId} onChange={(e) => setListingId(e.target.value)} required>
                <option value="">Escolha</option>
                {eligible.map((l) => (
                  <option key={l.id} value={l.id}>{l.title} · {STATUS_LABEL[l.status] || l.status}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>O que aconteceu</label>
              <div className={'acao-caption' + (recording ? ' rec' : '')}>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={500}
                  placeholder={recording ? 'Ouvindo...' : 'Negociação feita em Corinto. Item igual ao combinado.'}
                  required
                />
                {recording ? (
                  <div className="acao-caption-rec">
                    <span>Ouvindo {recSec}s de {AUDIO_MAX_SEC}s</span>
                    <button
                      type="button"
                      className="acao-mic rec"
                      onClick={toggleRecord}
                      disabled={busy}
                      aria-pressed="true"
                      title="Parar"
                      aria-label="Parar"
                    >
                      <span className="acao-stop-icon" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="acao-mic"
                    onClick={toggleRecord}
                    disabled={busy}
                    aria-pressed="false"
                    title="Falar o que aconteceu"
                    aria-label="Falar o que aconteceu"
                  >
                    <Ico name="mic" size={18} />
                  </button>
                )}
              </div>
              <p className="hint">Toque no microfone, fale e toque no quadrado para parar. O texto entra na caixa. Sem preço e sem contato.</p>
            </div>
            <div className="field">
              <label>Fotos</label>
              <input type="file" accept="image/*" multiple onChange={onFiles} />
              <div className="acao-thumbs">
                {photos.map((p, i) => (
                  <img key={p.preview || i} src={p.preview} alt="" />
                ))}
              </div>
            </div>
            <button className="btn btn-primary" disabled={busy || needsEmail || recording}>{busy ? 'Enviando...' : 'Publicar'}</button>
          </form>
        )}
      </div>
    </>
  );
}
