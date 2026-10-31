import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Empty, NeedAuth, PhotoGallery, Top } from '../components';
import { useAuth, isAdminRole } from '../auth';
import { compressImages, revokePreviews } from '../compressImage';
import { Ico } from '../icons';

const AUDIO_MAX_SEC = 60;

function pickRecorderMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

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

export function ActionPostCard({ post, onReport }) {
  if (!post) return null;
  const author = post.author;
  return (
    <article className="acao-card">
      {post.images && post.images.length > 0 && (
        <PhotoGallery images={post.images} alt="" size="card" />
      )}
      <p className="acao-text">{post.text}</p>
      <ActionAudio url={post.audioUrl} transcript={post.audioTranscript} />
      <div className="acao-meta">
        {author ? (
          <Link to={'/usuario/' + author.id} className="acao-author">
            <span className="avatar sm" style={{ background: author.avatarColor }}>{(author.name || '?').slice(0, 1)}</span>
            <span>{author.name}</span>
          </Link>
        ) : <span>Anunciante</span>}
        <span>{post.timeAgo}</span>
      </div>
      {onReport && (
        <button type="button" className="btn btn-ghost acao-report" onClick={() => onReport(post)}>Denunciar</button>
      )}
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
      <Top title="Em Ação" />
      <div className="page">
        <h1>Catira em Ação</h1>
        <p className="lead">Fotos, relatos e um áudio opcional de quem já negociou no CATIRA. Sem preço, sem chat e sem proposta por aqui.</p>
        {user && (
          <Link className="btn btn-primary" to="/em-acao/publicar" style={{ marginBottom: 16 }}>Publicar</Link>
        )}
        {ok && <div className="okbox">{ok}</div>}
        {err && <div className="error">{err}</div>}
        {!items.length && !loading && (
          <Empty title="Nada por aqui ainda" text="Quando alguém publicar depois de uma negociação, aparece nesta aba." />
        )}
        <div className="acao-feed">
          {items.map((p) => (
            <ActionPostCard key={p.id} post={p} onReport={user ? setReportFor : null} />
          ))}
        </div>
        {items.length < total && (
          <button className="btn btn-ghost" style={{ marginTop: 16 }} disabled={loading} onClick={() => load(page + 1)}>
            {loading ? 'Carregando...' : 'Ver mais'}
          </button>
        )}
      </div>
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
  const [audio, setAudio] = useState(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [recording, setRecording] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const recRef = useRef(null);
  const audioUrlRef = useRef('');
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
    audioUrlRef.current = audioUrl;
  }, [audioUrl]);
  useEffect(() => {
    textRef.current = text;
  }, [text]);
  useEffect(() => () => {
    revokePreviews(photosRef.current);
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    const rec = recRef.current;
    if (!rec) return;
    rec.discard = true;
    if (rec.timer) clearInterval(rec.timer);
    try { if (rec.speech) rec.speech.stop(); } catch {}
    try { if (rec.media && rec.media.state !== 'inactive') rec.media.stop(); } catch {}
    if (rec.stream) rec.stream.getTracks().forEach((t) => t.stop());
  }, []);

  if (!user) return <NeedAuth next="/em-acao/publicar" />;

  async function onFiles(e) {
    const room = 8 - photos.length;
    const next = await compressImages(e.target.files, room);
    setPhotos((prev) => prev.concat(next));
    e.target.value = '';
  }

  function clearAudio() {
    setAudio(null);
    setAudioUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return '';
    });
  }

  function keepRecording(blob, mime) {
    if (!blob || blob.size < 200) return;
    const ext = /mp4/i.test(mime) ? 'm4a' : /ogg/i.test(mime) ? 'ogg' : 'webm';
    const file = new File([blob], 'acao-audio.' + ext, { type: mime || blob.type || 'audio/webm' });
    if (file.size > 8 * 1024 * 1024) {
      setErr('O áudio pode ter no máximo 8 MB. Grave um pouco mais curto.');
      return;
    }
    setAudioUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setAudio(file);
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
    if (!live) setErr('Não deu para passar o áudio para o texto. Escreva o que falou.');
  }

  function stopRecorder() {
    const rec = recRef.current;
    if (!rec || rec.stopping) return;
    rec.stopping = true;
    setRecording(false);
    if (rec.timer) {
      clearInterval(rec.timer);
      rec.timer = null;
    }
    if (rec.speech) {
      try { rec.speech.stop(); } catch {}
    }
    if (rec.media && rec.media.state !== 'inactive') {
      try { rec.media.stop(); } catch {}
      return;
    }
    if (rec.stream) rec.stream.getTracks().forEach((t) => t.stop());
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
    let finalText = '';
    let lastText = '';
    speech.onresult = (e) => {
      rec.heard = true;
      let piece = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        piece += e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      }
      lastText = piece.trim();
      const spoken = (finalText || lastText).trim();
      rec.spoken = joinCaption(baseText, spoken);
      textRef.current = rec.spoken;
      setText(rec.spoken);
    };
    speech.onerror = (e) => {
      const name = e && e.error;
      if (name === 'not-allowed' || name === 'service-not-allowed') {
        rec.speechBlocked = true;
        setErr('Permita o acesso ao microfone para gravar o áudio.');
      }
    };
    speech.onend = () => {
      if (rec.speech !== speech) return;
      const spoken = (finalText || lastText).trim();
      if (spoken) rec.spoken = joinCaption(baseText, spoken);
      if (rec.discard || rec.stopping || rec.speechBlocked) return;
      try { speech.start(); } catch {}
    };
    rec.speech = speech;
    rec.started = new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      speech.onstart = finish;
      setTimeout(finish, 400);
    });
    try {
      speech.start();
      return speech;
    } catch {
      rec.speech = null;
      return null;
    }
  }

  async function toggleRecord() {
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
      media: null,
      stream: null,
      chunks: [],
      timer: null,
      mime: '',
      speech: null,
      captionBefore: textRef.current.trim(),
      spoken: textRef.current.trim(),
      heard: false,
      speechBlocked: false,
      stopping: false,
      discard: false,
    };
    recRef.current = rec;
    clearAudio();
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
    if (rec.started) {
      try { await rec.started; } catch {}
    }
    if (rec.stopping || rec.discard || recRef.current !== rec) return;
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return;
    }
    if (rec.stopping || rec.discard || recRef.current !== rec) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    rec.stream = stream;
    const mime = pickRecorderMime();
    let media;
    try {
      media = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      rec.stream = null;
      return;
    }
    rec.media = media;
    rec.mime = media.mimeType || mime;
    media.ondataavailable = (e) => {
      if (e.data && e.data.size) rec.chunks.push(e.data);
    };
    media.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (rec.timer) {
        clearInterval(rec.timer);
        rec.timer = null;
      }
      try { if (rec.speech) rec.speech.stop(); } catch {}
      setRecording(false);
      setRecSec(0);
      if (recRef.current === rec) recRef.current = null;
      if (rec.discard) return;
      keepRecording(new Blob(rec.chunks, { type: rec.mime || 'audio/webm' }), rec.mime);
      finishSession(rec);
    };
    media.start(250);
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
      if (audio) fd.append('audio', audio);
      await api('/api/acao', { method: 'POST', body: fd });
      revokePreviews(photos);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
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
              <div className={'acao-caption' + (recording ? ' rec' : '') + (audio && !recording ? ' has-audio' : '')}>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={500}
                  placeholder={recording ? 'Ouvindo...' : 'Negociação feita em Corinto. Item igual ao combinado.'}
                  required
                />
                {recording && (
                  <div className="acao-caption-rec">Ouvindo {recSec}s de {AUDIO_MAX_SEC}s · toque para parar</div>
                )}
                {audio && !recording && (
                  <div className="acao-caption-audio">
                    <audio controls preload="metadata" src={audioUrl}>Seu navegador não toca este áudio.</audio>
                    <button type="button" className="acao-audio-clear" onClick={clearAudio} aria-label="Tirar áudio">
                      <Ico name="close" size={16} />
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  className={'acao-mic' + (recording ? ' rec' : '')}
                  onClick={toggleRecord}
                  disabled={busy}
                  aria-pressed={recording}
                  title={recording ? 'Parar gravação' : 'Gravar áudio'}
                  aria-label={recording ? 'Parar gravação' : 'Gravar áudio'}
                >
                  {recording ? <span className="acao-stop-icon" /> : <Ico name="mic" size={18} />}
                </button>
              </div>
              <p className="hint">Toque no microfone para gravar e no quadrado para parar. O texto entra na caixa. Sem preço e sem contato.</p>
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
