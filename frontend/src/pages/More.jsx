import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, money, statusLabel } from '../api';
import { useAuth, isAdminRole } from '../auth';
import { Empty, ListingRow, NeedAuth, Top } from '../components';
import { Ico } from '../icons';
import { useConfig } from '../config';
import { compressImage } from '../compressImage';
import { PAGE } from '../pageSize';

export function Favorites() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const pageSize = PAGE.favorites;

  function listUrl(nextPage) {
    return '/api/favorites?page=' + nextPage + '&limit=' + pageSize;
  }

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    api(listUrl(1))
      .then((d) => {
        setItems(d.items || []);
        setTotal(d.total || 0);
        setPage(1);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  async function loadMore() {
    const next = page + 1;
    setLoading(true);
    try {
      const d = await api(listUrl(next));
      setItems((prev) => prev.concat(d.items || []));
      setTotal(d.total || 0);
      setPage(next);
    } catch {
      /* keep current list */
    }
    setLoading(false);
  }

  if (!user) return <NeedAuth next="/favoritos" />;
  return (
    <>
      <Top back title="Favoritos" />
      <div className="page">
        <h1>Meus favoritos</h1>
        {!items.length && <Empty title="Nenhum favorito" text="Toque em favoritar nos anúncios." to="/" cta="Explorar" />}
        {items.map((it) => (
          <div key={it.id}>
            <ListingRow item={it} extra={<span className={'status ' + it.status}>{statusLabel[it.status] || it.status}</span>} />
            <button className="btn btn-ghost" style={{ marginBottom: 10 }} onClick={async () => {
              await api('/api/favorites/' + it.id, { method: 'POST' });
              setLoading(true);
              try {
                const d = await api(listUrl(1));
                setItems(d.items || []);
                setTotal(d.total || 0);
                setPage(1);
              } catch {
                /* keep current list */
              }
              setLoading(false);
            }}>Remover dos favoritos</button>
          </div>
        ))}
        {items.length < total && (
          <button className="btn btn-ghost" style={{ marginTop: 16 }} disabled={loading} onClick={loadMore}>
            {loading ? 'Carregando...' : 'Ver mais'}
          </button>
        )}
      </div>
    </>
  );
}

export function Mine() {
  const { user } = useAuth();
  const { fee, vipListingFee, feeEnabled } = useConfig();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('all');
  const [invite, setInvite] = useState(null);
  const nav = useNavigate();
  const pageSize = PAGE.favorites;

  function mineUrl(nextPage, nextTab) {
    const qs = new URLSearchParams();
    qs.set('page', String(nextPage));
    qs.set('limit', String(pageSize));
    const status = nextTab === 'all' ? '' : nextTab;
    if (status) qs.set('status', status);
    return '/api/listings/mine?' + qs.toString();
  }

  async function load(nextPage, nextTab, append) {
    const d = await api(mineUrl(nextPage, nextTab));
    setItems((prev) => (append ? prev.concat(d.items || []) : d.items || []));
    setTotal(d.total || 0);
    setPage(nextPage);
  }

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    load(1, tab, false).catch(() => {}).finally(() => setLoading(false));
  }, [user, tab]);
  if (!user) return <NeedAuth next="/meus-anuncios" />;

  async function act(id, action) {
    if (action === 'pay') return nav('/pagar/' + id);
    const d = await api('/api/listings/' + id + '/status', { method: 'POST', body: JSON.stringify({ action }) });
    await load(1, tab, false);
    if (d && d.actionInvite) setInvite({ id, title: d.title || '', action });
  }

  return (
    <>
      <Top back title="Meus anúncios" />
      <div className="page">
        <div className="chips">
          {[['all', 'Todos'], ['published', 'Ativos'], ['awaiting_payment', 'Pagamento'], ['awaiting_confirmation', 'Confirmação'], ['payment_expired', 'Pag. expirado'], ['changes_requested', 'Correção'], ['awaiting_review', 'Revisão'], ['paused', 'Pausados'], ['sold', 'Vendidos'], ['traded', 'Trocados'], ['negotiated', 'Negociados'], ['expired', 'Expirados'], ['cancelled', 'Encerrados']].map(([k, l]) => (
            <button key={k} className={'chip' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
        {!items.length && <Empty title="Nada aqui" text={feeEnabled ? 'Publique por ' + money(fee) + '.' : 'Publicar é grátis.'} to="/anunciar" cta="+ Anunciar" />}
        {items.map((it) => (
          <div key={it.id} className="list-item" style={{ flexDirection: 'column' }}>
            <ListingRow item={it} />
            {it.adminNote && (it.status === 'changes_requested' || it.status === 'cancelled') && (
              <p className="admin-note">{it.status === 'cancelled' ? 'Motivo: ' : 'Correção pedida: '}{it.adminNote}</p>
            )}
            <div className="row-btns" style={{ marginTop: 8 }}>
               {(it.status === 'awaiting_payment' || (['published', 'paused'].includes(it.status) && it.paymentStatus === 'pending')) && it.paymentStatus !== 'awaiting_confirmation' && <button className="btn btn-primary" onClick={() => act(it.id, 'pay')}>Pagar</button>}
              {(it.status === 'awaiting_confirmation' || it.paymentStatus === 'awaiting_confirmation') && it.status !== 'payment_expired' && <button className="btn btn-primary" disabled>Pagar</button>}
              {it.status === 'payment_expired' && <button className="btn btn-primary" onClick={() => nav('/suporte')}>Falar com o suporte</button>}
              {it.status === 'changes_requested' && <button className="btn btn-primary" onClick={() => nav('/anunciar?edit=' + it.id)}>Corrigir anúncio</button>}
              {['published', 'paused', 'awaiting_review'].includes(it.status) && <button className="btn btn-ghost" onClick={() => nav('/anunciar?edit=' + it.id)}>Editar</button>}
              {it.status === 'changes_requested' && <button className="btn btn-ghost" onClick={() => act(it.id, 'cancel')}>Cancelar publicação</button>}
              {it.status === 'published' && <button className="btn btn-ghost" onClick={() => act(it.id, 'pause')}>Pausar</button>}
              {it.status === 'paused' && <button className="btn btn-ghost" onClick={() => act(it.id, 'resume')}>Ativar</button>}
              {['published', 'paused'].includes(it.status) && <button className="btn btn-ghost" onClick={() => act(it.id, 'sold')}>Vendido</button>}
              {['published', 'paused'].includes(it.status) && <button className="btn btn-ghost" onClick={() => act(it.id, 'traded')}>Trocado</button>}
              {['published', 'paused'].includes(it.status) && <button className="btn btn-ghost" onClick={() => act(it.id, 'negotiated')}>Negociado</button>}
              {['sold', 'traded', 'negotiated'].includes(it.status) && <button className="btn btn-ghost" onClick={() => nav('/em-acao/publicar?listing=' + it.id)}>Catira em Ação</button>}
              {['expired', 'paused', 'published'].includes(it.status) && <button className="btn btn-ghost" onClick={() => act(it.id, 'renew')}>Renovar</button>}
              {['published', 'paused'].includes(it.status) && !it.premium && it.paymentStatus !== 'pending' && it.paymentStatus !== 'awaiting_confirmation' && <button className="btn btn-ghost" onClick={() => nav('/turbinar/' + it.id)}>Turbinar</button>}
              {(it.status === 'awaiting_confirmation' || it.paymentStatus === 'awaiting_confirmation') && it.status !== 'payment_expired' && <button className="btn btn-ghost" disabled>Encerrar</button>}
              {it.status === 'awaiting_payment' && it.paymentStatus !== 'awaiting_confirmation' && <button className="btn btn-ghost" onClick={() => act(it.id, 'cancel')}>Encerrar</button>}
              {!['cancelled', 'changes_requested', 'awaiting_payment', 'awaiting_confirmation', 'payment_expired'].includes(it.status) && <button className="btn btn-ghost" onClick={() => act(it.id, 'cancel')}>Encerrar</button>}
            </div>
          </div>
        ))}
        {items.length < total && (
          <button className="btn btn-ghost" style={{ marginTop: 16 }} disabled={loading} onClick={async () => {
            setLoading(true);
            try { await load(page + 1, tab, true); } catch { /* keep current list */ }
            setLoading(false);
          }}>
            {loading ? 'Carregando...' : 'Ver mais'}
          </button>
        )}
      </div>
      {invite && (
        <div className="modal-bg" onClick={() => setInvite(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Publicar no Catira em Ação?</h3>
            <p className="lead">O anúncio foi marcado. Você pode contar o que rolou, sem preço e sem contato. É opcional e não muda sua reputação.</p>
            <button className="btn btn-primary" type="button" onClick={() => nav('/em-acao/publicar?listing=' + invite.id)}>Publicar</button>
            <button className="btn btn-ghost" type="button" style={{ marginTop: 8 }} onClick={() => setInvite(null)}>Agora não</button>
          </div>
        </div>
      )}
    </>
  );
}

export function Support() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!user) return;
    api('/api/support')
      .then((d) => nav('/chat/' + d.conversationId, { replace: true }))
      .catch((e) => setErr(e.message));
  }, [user]);

  if (!user) return <NeedAuth next="/suporte" />;
  return (
    <>
      <Top back title="Suporte" />
      <div className="page">
        <h1>Falar com o suporte</h1>
        {err ? <div className="error">{err}</div> : <p className="lead">Abrindo conversa com o suporte do CATIRA...</p>}
      </div>
    </>
  );
}

function clockOf(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function dayKey(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (dayKey(d) === dayKey(new Date())) return 'Hoje';
  if (dayKey(d) === dayKey(new Date(Date.now() - 86400000))) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function listTime(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return dayKey(d) === dayKey(new Date())
    ? clockOf(iso)
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function Conversations() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [closed, setClosed] = useState(false);
  const [q, setQ] = useState('');
  const isAdmin = user && isAdminRole(user.role);
  const pageSize = PAGE.favorites;

  function convUrl(nextPage, showClosed) {
    const qs = new URLSearchParams();
    qs.set('page', String(nextPage));
    qs.set('limit', String(pageSize));
    if (showClosed) qs.set('status', 'closed');
    return '/api/conversations?' + qs.toString();
  }

  async function load(showClosed, nextPage, append) {
    const d = await api(convUrl(nextPage, showClosed));
    setItems((prev) => (append ? prev.concat(d.items || []) : d.items || []));
    setTotal(d.total || 0);
    setPage(nextPage);
  }
  useEffect(() => {
    if (!user) return;
    setLoading(true);
    load(closed, 1, false).catch(() => {}).finally(() => setLoading(false));
  }, [user, closed]);

  if (!user) return <NeedAuth next="/conversas" />;

  const term = q.trim().toLowerCase();
  const shown = term
    ? items.filter((c) => [c.other?.name, c.listing?.title, c.lastMessage].some((t) => String(t || '').toLowerCase().includes(term)))
    : items;
  const totalUnread = items.reduce((a, c) => a + (c.unread || 0), 0);

  return (
    <>
      <Top back title="Conversas" />
      <div className="page chat-list-page">
        <div className="chat-search">
          <Ico name="search" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar conversas" />
          {!!q && (
            <button type="button" className="chat-search-clear" onClick={() => setQ('')} aria-label="Limpar pesquisa">
              <Ico name="close" size={16} />
            </button>
          )}
        </div>
        {isAdmin && (
          <div className="chips">
            <button className={'chip' + (!closed ? ' on' : '')} onClick={() => setClosed(false)}>Ativas</button>
            <button className={'chip' + (closed ? ' on' : '')} onClick={() => setClosed(true)}>Suporte finalizado</button>
          </div>
        )}
        {!closed && !!totalUnread && <div className="chat-unread-sum">Você tem {totalUnread} mensagem{totalUnread > 1 ? 's' : ''} não lida{totalUnread > 1 ? 's' : ''}.</div>}
        {!shown.length && (
          <Empty
            title={term ? 'Nada encontrado' : closed ? 'Nenhum atendimento finalizado' : 'Nenhuma conversa'}
            text={term ? 'Tente outro nome ou anúncio.' : closed ? 'Atendimentos encerrados ficam guardados aqui.' : 'Toque em Tenho interesse em um anúncio.'}
          />
        )}
        <div className="chat-list">
          {shown.map((c) => (
            <Link key={c.id} to={'/chat/' + c.id} className={'chat-list-item' + (c.unread ? ' unread' : '')}>
              {c.isSupport ? (
                <span className="avatar chat-list-avatar support">C</span>
              ) : (
                <span className="avatar chat-list-avatar" style={{ background: c.other?.avatarColor || 'var(--brand)' }}>
                  {(c.other?.name || '?').slice(0, 1)}
                </span>
              )}
              <div className="chat-list-body">
                <div className="chat-list-top">
                  <strong>{c.isSupport ? 'Suporte CATIRA' : c.other?.name || 'Conversa'}</strong>
                  <em className={c.unread ? 'on' : ''}>{listTime(c.lastAt)}</em>
                </div>
                <div className="chat-list-sub">
                  <span>{c.lastMessage || (c.listing ? c.listing.title : 'Sem mensagens')}</span>
                  {!!c.unread && <b className="chat-badge">{c.unread > 99 ? '99+' : c.unread}</b>}
                </div>
                <div className="chat-list-meta">
                  {c.isSupport ? 'Atendimento do CATIRA' : c.listing?.title}
                  {c.status === 'closed' && <span className="chat-list-closed">Finalizado</span>}
                </div>
              </div>
            </Link>
          ))}
        </div>
        {!term && items.length < total && (
          <button className="btn btn-ghost" style={{ marginTop: 16 }} disabled={loading} onClick={async () => {
            setLoading(true);
            try { await load(closed, page + 1, true); } catch { /* keep current list */ }
            setLoading(false);
          }}>
            {loading ? 'Carregando...' : 'Ver mais'}
          </button>
        )}
      </div>
    </>
  );
}

const CHAT_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const EMOJI_PANEL = [
  '😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎',
  '🤔', '😅', '😢', '😭', '😡', '🥳', '😴', '🤝',
  '👍', '👎', '👏', '🙏', '💪', '✌️', '👋', '🫶',
  '❤️', '🔥', '⭐', '💰', '🎉', '📦', '🚗', '🏠',
];
const REC_MAX_SEC = 120;

function fmtClock(sec) {
  const total = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function previewOf(m) {
  if (!m) return '';
  if (m.kind === 'image') return '[Foto]' + (m.text ? ' ' + m.text : '');
  if (m.kind === 'audio') return '[Áudio]' + (m.text ? ' ' + m.text : '');
  return m.text || '';
}

function AudioBubble({ url, duration }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [total, setTotal] = useState(Number(duration) || 0);

  function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  }

  const pct = total > 0 ? Math.min(100, (pos / total) * 100) : 0;
  return (
    <div className="chat-audio" onPointerDown={(e) => e.stopPropagation()}>
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setPos(0); }}
        onTimeUpdate={(e) => setPos(e.currentTarget.currentTime || 0)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0 && !duration) setTotal(d);
        }}
      />
      <button type="button" className="chat-audio-play" onClick={toggle} aria-label={playing ? 'Pausar áudio' : 'Tocar áudio'}>
        <Ico name={playing ? 'pause' : 'play'} size={15} fill="currentColor" />
      </button>
      <span className="chat-audio-bar"><i style={{ width: pct + '%' }} /></span>
      <span className="chat-audio-time">{fmtClock(total > 0 ? Math.max(0, total - pos) : pos)}</span>
    </div>
  );
}

function useChatRecorder(onDone) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const ref = useRef(null);

  useEffect(() => () => {
    const r = ref.current;
    if (!r) return;
    r.discard = true;
    clearInterval(r.timer);
    try { r.recorder.stop(); } catch {}
    r.stream.getTracks().forEach((t) => t.stop());
  }, []);

  async function start() {
    if (ref.current) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError('Seu navegador não grava áudio.');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('Não foi possível usar o microfone. Verifique a permissão.');
      return;
    }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
      .find((t) => window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(t)) || '';
    let recorder;
    try {
      recorder = new window.MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch {
      try { recorder = new window.MediaRecorder(stream); } catch {
        stream.getTracks().forEach((t) => t.stop());
        setError('Seu navegador não grava áudio.');
        return;
      }
    }
    const chunks = [];
    const ctx = { stream, recorder, chunks, timer: null, startedAt: Date.now(), discard: false };
    ref.current = ctx;
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      clearInterval(ctx.timer);
      stream.getTracks().forEach((t) => t.stop());
      if (ref.current === ctx) ref.current = null;
      const secs = Math.max(1, Math.round((Date.now() - ctx.startedAt) / 1000));
      setRecording(false);
      setSeconds(0);
      if (ctx.discard || !chunks.length) return;
      const type = recorder.mimeType || mime || 'audio/webm';
      const ext = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm';
      onDone(new File(chunks, 'audio.' + ext, { type }), secs);
    };
    recorder.start();
    ctx.timer = setInterval(() => {
      const secs = Math.round((Date.now() - ctx.startedAt) / 1000);
      setSeconds(secs);
      if (secs >= REC_MAX_SEC) stop();
    }, 250);
    setError('');
    setSeconds(0);
    setRecording(true);
  }

  function stop() {
    const r = ref.current;
    if (!r) return;
    try { r.recorder.stop(); } catch {}
  }

  function cancel() {
    const r = ref.current;
    if (!r) return;
    r.discard = true;
    clearInterval(r.timer);
    try { r.recorder.stop(); } catch {}
    r.stream.getTracks().forEach((t) => t.stop());
    ref.current = null;
    setRecording(false);
    setSeconds(0);
  }

  return { recording, seconds, error, start, stop, cancel };
}

function useKeyboardViewport(pageRef, scrollRef) {
  useEffect(() => {
    const vv = window.visualViewport;
    const el = pageRef.current;
    if (!el) return undefined;
    function apply() {
      const height = vv ? vv.height : window.innerHeight;
      const top = vv ? vv.offsetTop : 0;
      el.style.setProperty('--chat-h', Math.round(height) + 'px');
      el.style.setProperty('--chat-top', Math.round(top) + 'px');
      const shrunk = top + height < window.innerHeight - 80;
      if (shrunk) el.dataset.keyboard = 'open';
      else delete el.dataset.keyboard;
    }
    apply();
    function onResize() {
      apply();
      const body = scrollRef.current;
      if (body) body.scrollTop = body.scrollHeight;
    }
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    if (vv) {
      vv.addEventListener('resize', onResize);
      vv.addEventListener('scroll', apply);
    }
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      if (vv) {
        vv.removeEventListener('resize', onResize);
        vv.removeEventListener('scroll', apply);
      }
    };
  }, [pageRef, scrollRef]);
}

export function Chat() {
  const { id } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [selected, setSelected] = useState(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [pendingFile, setPendingFile] = useState(null);
  const [pendingCaption, setPendingCaption] = useState('');
  const [lightbox, setLightbox] = useState('');
  const pageRef = useRef(null);
  const scrollRef = useRef(null);
  const pressTimer = useRef(null);
  const fileRef = useRef(null);
  const cameraRef = useRef(null);
  const inputRef = useRef(null);
  const nav = useNavigate();

  const recorder = useChatRecorder((file, secs) => uploadFile(file, secs, ''));
  const hasSent = (data?.messages || []).some((m) => m.mine);
  useKeyboardViewport(pageRef, scrollRef);

  // O painel de emojis fecha em qualquer ação que não seja escolher um emoji.
  useEffect(() => {
    if (!emojiOpen) return undefined;
    function onPointerDown(e) {
      if (e.target.closest && e.target.closest('.chat-emoji-panel, .chat-emoji-toggle')) return;
      setEmojiOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [emojiOpen]);

  async function load() {
    const d = await api('/api/conversations/' + id);
    setData(d);
  }
  useEffect(() => { if (user) load().catch(() => {}); }, [id, user]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [data]);

  useEffect(() => () => clearTimeout(pressTimer.current), []);

  useEffect(() => {
    if (!preview) return undefined;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  if (!user) return <NeedAuth next={'/chat/' + id} />;

  async function uploadFile(file, duration, caption) {
    if (!file) return false;
    setEmojiOpen(false);
    setUploading(true);
    setErr('');
    try {
      const form = new FormData();
      form.append('file', file);
      if (duration) form.append('duration', String(duration));
      if (caption) form.append('text', caption);
      if (replyTo?.id) form.append('replyToId', replyTo.id);
      await api('/api/conversations/' + id + '/messages', { method: 'POST', body: form });
      setReplyTo(null);
      await load();
      return true;
    } catch (e2) {
      setErr(e2.message);
      return false;
    } finally {
      setUploading(false);
    }
  }

  async function pickFile(list) {
    const file = list && list[0];
    if (!file) return;
    if (String(file.type || '').startsWith('image/')) {
      let ready = file;
      try {
        ready = await compressImage(file);
      } catch {
        ready = file;
      }
      setPendingFile(ready);
      setPreview(URL.createObjectURL(ready));
      return;
    }
    uploadFile(file, 0, '');
  }

  function closePreview() {
    setPendingFile(null);
    setPendingCaption('');
    setPreview(null);
  }

  async function sendPreview() {
    if (!pendingFile) return;
    const ok = await uploadFile(pendingFile, 0, pendingCaption.trim());
    if (ok) closePreview();
  }

  async function send(e) {
    e.preventDefault();
    setEmojiOpen(false);
    const body = text.trim();
    if (!body) return;
    try {
      await api('/api/conversations/' + id + '/messages', {
        method: 'POST',
        body: JSON.stringify({ text: body, replyToId: replyTo?.id || undefined }),
      });
      setText('');
      setReplyTo(null);
      await load();
    } catch (e2) {
      setErr(e2.message);
    }
  }

  const conv = data?.conversation;
  const messages = data?.messages || [];
  const isSupport = !!conv?.isSupport;
  const isAdmin = isAdminRole(user.role);
  const closed = isSupport && conv?.status === 'closed';
  const otherName = isSupport ? 'Suporte CATIRA' : conv?.other?.name || 'Chat';

  async function closeSupport() {
    try {
      await api('/api/conversations/' + id + '/close', { method: 'POST' });
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function react(emoji) {
    if (!selected) return;
    try {
      await api('/api/conversations/' + id + '/messages/' + selected.id + '/reaction', {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      });
      setSelected(null);
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function toggleStar() {
    if (!selected) return;
    try {
      await api('/api/conversations/' + id + '/messages/' + selected.id + '/star', { method: 'POST' });
      setSelected(null);
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function remove(forAll) {
    if (!selected) return;
    try {
      await api(
        '/api/conversations/' + id + '/messages/' + selected.id + '?forAll=' + (forAll ? '1' : '0'),
        { method: 'DELETE' }
      );
      setSelected(null);
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  function pressStart(m) {
    clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => {
      setEmojiOpen(false);
      setSelected(m);
    }, 420);
  }

  function pressEnd() {
    clearTimeout(pressTimer.current);
  }

  function startReply(m) {
    if (m.deleted) return;
    setEmojiOpen(false);
    setReplyTo({ id: m.id, senderId: m.senderId, text: m.text });
    setSelected(null);
  }

  return (
    <div className="chat-page" ref={pageRef}>
      <header className="chat-top">
        <button type="button" className="chat-back" onClick={() => nav(-1)} aria-label="Voltar">
          <Ico name="back" size={20} />
        </button>
        <span
          className="avatar chat-top-avatar"
          style={{ background: isSupport ? 'var(--catira)' : conv?.other?.avatarColor || 'var(--brand)' }}
        >
          {otherName.slice(0, 1)}
        </span>
        <div className="chat-top-body">
          <strong>{otherName}</strong>
          <em>{isSupport ? (closed ? 'Atendimento encerrado' : 'Atendimento do CATIRA') : conv?.other?.city || 'No CATIRA'}</em>
        </div>
        {isSupport && isAdmin && !closed && (
          <button type="button" className="chat-top-action" onClick={closeSupport}>Encerrar</button>
        )}
      </header>

      {conv?.listing && (
        <Link to={'/anuncio/' + conv.listing.id} className="chat-listing">
          {conv.listing.images?.[0] && <img src={conv.listing.images[0].url} alt="" />}
          <div>
            <strong>{conv.listing.title}</strong>
            <span>{money(conv.listing.price)}{conv.listing.city ? ' · ' + conv.listing.city + (String(conv.listing.city).includes('/') ? '' : '/MG') : ''}</span>
          </div>
        </Link>
      )}

      <div className="chat-body" ref={scrollRef}>
        {!messages.length && <div className="chat-empty">Diga olá para começar a conversa.</div>}
        {messages.map((m, idx) => {
          const prev = messages[idx - 1];
          const showDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
          const mine = m.mine;
          return (
            <div key={m.id}>
              {showDay && <div className="chat-day"><span>{dayLabel(m.createdAt)}</span></div>}
              <div className={'chat-row' + (mine ? ' mine' : '')}>
                <div
                  className={'chat-bubble' + (mine ? ' mine' : '') + (m.deleted ? ' deleted' : '') + (m.starred ? ' starred' : '')}
                  onContextMenu={(e) => { e.preventDefault(); setSelected(m); }}
                  onPointerDown={() => pressStart(m)}
                  onPointerUp={pressEnd}
                  onPointerLeave={pressEnd}
                  onPointerCancel={pressEnd}
                >
                  {m.replyTo && (
                    <div className="chat-quote">
                      <strong>{m.replyTo.senderId === user.id ? 'Você' : otherName}</strong>
                      <span>{previewOf(m.replyTo) || m.replyTo.text}</span>
                    </div>
                  )}
                  {!!m.starred && <span className="chat-star"><Ico name="star" size={13} fill="currentColor" /></span>}
                  {m.kind === 'image' && m.fileUrl && (
                    <button
                      type="button"
                      className="chat-image-btn"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => setLightbox(m.fileUrl)}
                      aria-label="Ampliar foto"
                    >
                      <img className="chat-image" src={m.fileUrl} alt={m.text || 'Foto enviada'} loading="lazy" />
                    </button>
                  )}
                  {m.kind === 'audio' && m.fileUrl && (
                    <AudioBubble url={m.fileUrl} duration={m.duration} />
                  )}
                  {!!m.text && <p>{m.text}</p>}
                  <div className="chat-meta">
                    <span>{clockOf(m.createdAt)}</span>
                    {mine && !m.deleted && (
                      <span className={'chat-checks' + (m.read ? ' read' : '')} aria-label={m.read ? 'Lida' : 'Enviada'}>
                        {m.read ? '✓✓' : '✓'}
                      </span>
                    )}
                  </div>
                  {!!(m.reactions || []).length && (
                    <div className="chat-reactions">
                      {Array.from(new Set(m.reactions)).map((emo) => (
                        <span key={emo}>{emo}<b>{m.reactions.filter((x) => x === emo).length}</b></span>
                      ))}
                    </div>
                  )}
                  {!m.deleted && (
                    <button
                      type="button"
                      className="chat-react-btn"
                      aria-label="Reagir"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => setSelected(m)}
                    >
                      <Ico name="smile" size={13} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {closed ? (
        <div className="chat-closed">
          {isAdmin
            ? 'Atendimento encerrado.'
            : <>Atendimento encerrado. Se precisar, abra um novo em <Link to="/suporte">Falar com o suporte</Link>.</>}
        </div>
      ) : (
        <div className="chat-compose">
          {replyTo && (
            <div className="chat-reply-bar">
              <div>
                <strong>{replyTo.senderId === user.id ? 'Você' : otherName}</strong>
                <span>{previewOf(replyTo) || replyTo.text}</span>
              </div>
              <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancelar resposta">
                <Ico name="close" size={16} />
              </button>
            </div>
          )}
          {!!data && !conv?.isSupport && !hasSent && !recorder.recording && (
            <div className="chat-quick">
              {['Ainda está disponível?', 'Aceita troca?', 'Qual o menor valor?', 'Tenho interesse!'].map((t) => (
                <button
                  key={t}
                  type="button"
                  className="chip"
                  onClick={() => {
                    setEmojiOpen(false);
                    setText(t);
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
          {emojiOpen && !recorder.recording && (
            <div className="chat-emoji-panel">
              {EMOJI_PANEL.map((emo) => (
                <button
                  key={emo}
                  type="button"
                  onClick={() => setText((t) => t + emo)}
                >
                  {emo}
                </button>
              ))}
            </div>
          )}
          {recorder.recording ? (
            <div className="chat-rec">
              <button type="button" className="chat-rec-cancel" onClick={recorder.cancel} aria-label="Cancelar gravação">
                <Ico name="trash" size={18} />
              </button>
              <span className="chat-rec-dot" />
              <span className="chat-rec-time">{fmtClock(recorder.seconds)}</span>
              <span className="chat-rec-hint">Gravando áudio...</span>
              <button type="button" className="chat-send chat-send-rec" onClick={recorder.stop} aria-label="Enviar áudio">
                <Ico name="send" size={18} fill="currentColor" />
              </button>
            </div>
          ) : (
            <form className="chat-compose-bar" onSubmit={send}>
              <button
                type="button"
                className="chat-icon-btn chat-emoji-toggle"
                aria-label={emojiOpen ? 'Fechar emojis' : 'Emojis'}
                aria-expanded={emojiOpen}
                onClick={() => setEmojiOpen((v) => !v)}
              >
                <Ico name="smile" size={21} />
              </button>
              <input
                ref={inputRef}
                value={text}
                onChange={(e) => {
                  setEmojiOpen(false);
                  setText(e.target.value);
                }}
                onFocus={() => setEmojiOpen(false)}
                placeholder={uploading ? 'Enviando...' : replyTo ? 'Respondendo...' : 'Mensagem'}
                disabled={uploading}
              />
              <button
                type="button"
                className="chat-icon-btn"
                aria-label="Anexar arquivo"
                onClick={() => {
                  setEmojiOpen(false);
                  fileRef.current?.click();
                }}
                disabled={uploading}
              >
                <Ico name="clip" size={20} />
              </button>
              <button
                type="button"
                className="chat-icon-btn"
                aria-label="Tirar foto"
                onClick={() => {
                  setEmojiOpen(false);
                  cameraRef.current?.click();
                }}
                disabled={uploading}
              >
                <Ico name="camera" size={20} />
              </button>
              {text.trim() ? (
                <button type="submit" className="chat-send" disabled={uploading} aria-label="Enviar">
                  <Ico name="send" size={20} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="button"
                  className="chat-send chat-send-mic"
                  onClick={() => {
                    setEmojiOpen(false);
                    recorder.start();
                  }}
                  disabled={uploading}
                  aria-label="Gravar áudio"
                >
                  <Ico name="mic" size={20} />
                </button>
              )}
            </form>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*,audio/*"
            hidden
            onChange={(e) => {
              pickFile(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              pickFile(e.target.files);
              e.target.value = '';
            }}
          />
          {(recorder.error || err) && <div className="error chat-error">{recorder.error || err}</div>}
        </div>
      )}

      {lightbox && (
        <div className="chat-preview-bg" onClick={() => setLightbox('')}>
          <img className="chat-lightbox-img" src={lightbox} alt="Foto ampliada" />
        </div>
      )}

      {preview && (
        <div className="chat-preview-bg" onClick={closePreview}>
          <div className="chat-preview" onClick={(e) => e.stopPropagation()}>
            <img src={preview} alt="Prévia da foto" />
            <div className="chat-preview-bar">
              <button type="button" className="chat-icon-btn" onClick={closePreview} aria-label="Cancelar foto">
                <Ico name="close" size={20} />
              </button>
              <input
                value={pendingCaption}
                onChange={(e) => setPendingCaption(e.target.value)}
                placeholder="Legenda (opcional)"
              />
              <button
                type="button"
                className="chat-send"
                onClick={sendPreview}
                disabled={uploading}
                aria-label="Enviar foto"
              >
                <Ico name="send" size={18} fill="currentColor" />
              </button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div className="modal-bg chat-sheet-bg" onClick={() => setSelected(null)}>
          <div className="chat-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="chat-sheet-bar" />
            <div className="chat-sheet-emos">
              {CHAT_EMOJIS.map((emo) => (
                <button key={emo} type="button" onClick={() => react(emo)}>{emo}</button>
              ))}
            </div>
            <div className="chat-sheet-actions">
              <button type="button" onClick={() => startReply(selected)}>
                <Ico name="reply" size={18} /> Responder
              </button>
              <button type="button" onClick={toggleStar}>
                <Ico name="star" size={18} fill={selected.starred ? 'currentColor' : 'none'} />
                {selected.starred ? 'Remover dos favoritos' : 'Favoritar'}
              </button>
              <button type="button" onClick={() => remove(false)}>
                <Ico name="close" size={18} /> Apagar para mim
              </button>
              {selected.senderId === user.id && !selected.deleted && (
                <button type="button" className="danger" onClick={() => remove(true)}>
                  <Ico name="close" size={18} /> Apagar para todos
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function Trades() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [reviewFor, setReviewFor] = useState(null);
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState('');

  async function load() {
    const d = await api('/api/trades');
    setItems(d.items || []);
  }
  useEffect(() => { if (user) load().catch(() => {}); }, [user]);
  if (!user) return <NeedAuth next="/propostas" />;

  async function act(id, action) {
    await api('/api/trades/' + id + '/status', { method: 'POST', body: JSON.stringify({ action }) });
    load();
  }

  async function sendReview() {
    await api('/api/reviews', {
      method: 'POST',
      body: JSON.stringify({
        listingId: reviewFor.listingId,
        reviewedUserId: reviewFor.proposerId === user.id ? reviewFor.ownerId : reviewFor.proposerId,
        rating: stars,
        comment,
      }),
    });
    setReviewFor(null);
    setComment('');
  }

  return (
    <>
      <Top back title="Propostas" />
      <div className="page">
        <h1>Minhas propostas</h1>
        {!items.length && <Empty title="Nenhuma proposta" text="Proponha troca nos anúncios com o selo ACEITA TROCA." to="/catiras" cta="Ver catiras" />}
        {items.map((t) => (
          <div key={t.id} className="list-item" style={{ flexDirection: 'column' }}>
            <p className="hint">{t.mine ? 'Você quer' : 'Quer o seu'}</p>
            {t.listing ? (
              <Link to={'/anuncio/' + t.listing.id} className="trade-mini">
                {t.listing.images && t.listing.images[0] && <img src={t.listing.images[0].url} alt="" />}
                <span>
                  <strong>{t.listing.title}</strong>
                  {t.listing.unavailable ? <em>Anúncio indisponível</em> : <em>{money(t.listing.price)}</em>}
                </span>
              </Link>
            ) : (
              <p className="hint">Anúncio indisponível</p>
            )}
            <p className="hint">{t.mine ? 'Você oferece' : (t.proposer?.name || 'Quem propôs') + ' oferece'}</p>
            {t.offeredListing ? (
              t.offeredListing.unavailable ? (
                <div className="trade-mini">
                  {t.offeredListing.images && t.offeredListing.images[0] && <img src={t.offeredListing.images[0].url} alt="" />}
                  <span>
                    <strong>{t.offeredListing.title}</strong>
                    <em>Anúncio indisponível</em>
                  </span>
                </div>
              ) : (
                <Link to={'/anuncio/' + t.offeredListing.id} className="trade-mini">
                  {t.offeredListing.images && t.offeredListing.images[0] && <img src={t.offeredListing.images[0].url} alt="" />}
                  <span>
                    <strong>{t.offeredListing.title}</strong>
                    <em>{money(t.offeredListing.price)}</em>
                  </span>
                </Link>
              )
            ) : t.offerListingId ? (
              <p className="hint">Anúncio indisponível</p>
            ) : null}
            {t.description ? <p className="hint">{t.description}</p> : null}
            {t.extraValue ? (
              <p className="hint">
                {t.extraDirection === 'ask'
                  ? (t.mine ? 'Você pede ' : 'Pede ') + money(t.extraValue) + ' a mais'
                  : (t.mine ? 'Você oferece ' : 'Oferece ') + money(t.extraValue) + ' a mais'}
              </p>
            ) : null}
            <span className={'status ' + t.status}>{statusLabel[t.status] || t.status}</span>
            <div className="row-btns" style={{ marginTop: 8 }}>
              {!t.mine && ['sent', 'negotiating'].includes(t.status) && (
                <>
                  <button className="btn btn-green" onClick={() => act(t.id, 'accept')}>Aceitar</button>
                  <button className="btn btn-ghost" onClick={() => act(t.id, 'reject')}>Recusar</button>
                  {t.status === 'sent' && <button className="btn btn-ghost" onClick={() => act(t.id, 'negotiate')}>Negociar</button>}
                </>
              )}
              {t.status === 'accepted' && <button className="btn btn-primary" onClick={() => act(t.id, 'finish')}>Finalizar</button>}
              {t.status === 'finished' && <button className="btn btn-ghost" onClick={() => setReviewFor(t)}>Avaliar</button>}
            </div>
          </div>
        ))}
      </div>
      {reviewFor && (
        <div className="modal-bg" onClick={() => setReviewFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Avaliar negociação</h3>
            <div className="stars">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} className={n <= stars ? 'on' : ''} onClick={() => setStars(n)}>★</button>
              ))}
            </div>
            <div className="field" style={{ marginTop: 12 }}>
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Negociação tranquila." />
            </div>
            <button className="btn btn-primary" onClick={sendReview}>Enviar avaliação</button>
          </div>
        </div>
      )}
    </>
  );
}

export function Alerts() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState('');
  const [err, setErr] = useState('');

  async function load() {
    const d = await api('/api/alerts');
    setItems(d.items || []);
  }
  useEffect(() => { if (user) load().catch(() => {}); }, [user]);
  if (!user) return <NeedAuth next="/alertas" />;

  async function add(e) {
    e.preventDefault();
    setErr('');
    try {
      await api('/api/alerts', { method: 'POST', body: JSON.stringify({ query }) });
      setQuery('');
      load();
    } catch (ex) {
      setErr(ex.message);
    }
  }

  return (
    <>
      <Top back title="Alertas" />
      <div className="page">
        <h1>Meus alertas</h1>
        <p className="lead">Acompanhe um produto. Quando sair um anúncio parecido, ele aparece aqui.</p>
        {err && <div className="error">{err}</div>}
        <form onSubmit={add}>
          <div className="field">
            <label>Quero receber alertas de</label>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ex.: iPhone" required />
          </div>
          <button className="btn btn-primary">Criar alerta</button>
        </form>
        {!items.length && <Empty title="Nenhum alerta" text="Digite o que você procura, como iPhone ou bicicleta." />}
        {items.map((a) => (
          <div key={a.id} className="list-item" style={{ flexDirection: 'column' }}>
            <strong>{a.query || 'Alerta'}</strong>
            {(a.hits || []).slice(0, 3).map((h) => (
              <Link key={h.listingId} to={'/anuncio/' + h.listingId} className="hint">
                Novo anúncio que pode interessar você: {h.title} — {money(h.price)}
              </Link>
            ))}
            {!(a.hits || []).length && <p className="hint">Ainda sem novidades.</p>}
            <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={async () => {
              await api('/api/alerts/' + a.id, { method: 'DELETE' });
              load();
            }}>Remover</button>
          </div>
        ))}
      </div>
    </>
  );
}

export function PublicUser() {
  const { id } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [posts, setPosts] = useState([]);
  const [listings, setListings] = useState([]);
  const [listingsTotal, setListingsTotal] = useState(0);
  const [listingsPage, setListingsPage] = useState(1);
  const [listingsLoading, setListingsLoading] = useState(false);
  const pageSize = PAGE.favorites;
  useEffect(() => {
    api('/api/users/' + id + '?page=1&limit=' + pageSize).then((d) => {
      setData(d);
      const page = d.listings && Array.isArray(d.listings.items) ? d.listings : { items: d.listings || [], total: (d.listings || []).length };
      setListings(page.items || []);
      setListingsTotal(page.total || 0);
      setListingsPage(1);
    }).catch(() => {});
    api('/api/acao?userId=' + id + '&limit=12').then((d) => setPosts(d.items || [])).catch(() => setPosts([]));
  }, [id]);
  if (!data) return <><Top back /><div className="page">Carregando...</div></>;
  const u = data.user;
  return (
    <>
      <Top back />
      <div className="page">
        <div className="seller">
          <div className="avatar" style={{ background: u.avatarColor }}>{u.name.slice(0, 1)}</div>
          <div>
            <strong>{u.name}</strong>
            <div className="verified">{(u.phoneVerified || u.emailVerified) ? 'Usuário verificado' : u.city}</div>
            <div className="hint">No CATIRA desde {u.createdAt ? new Date(u.createdAt).getFullYear() : ''}</div>
            <div className="hint">{u.ratingCount ? `${u.ratingAvg} (${u.ratingCount} avaliações)` : 'Ainda sem avaliações'}{u.rank ? ' · #' + u.rank : ''}</div>
            <div className="hint">{u.listingsCount || u.published || 0} anúncios{u.deals ? ' · ' + u.deals + ' negociações concluídas' : ''}</div>
          </div>
        </div>
        {user && user.id !== u.id && (
          <>
            <button className="btn btn-ghost" onClick={() => api('/api/block/' + u.id, { method: 'POST' })}>Bloquear usuário</button>
            <p className="pay-alert">Não faça pagamentos antecipados. Prefira negociar pessoalmente em local seguro.</p>
          </>
        )}
        {!!posts.length && (
          <>
            <h2 style={{ margin: '16px 0 10px', fontSize: 17 }}>Catira em Ação</h2>
            {posts.map((p) => (
              <div key={p.id} className="acao-card compact">
                {p.images && p.images[0] && <img src={p.images[0].url} alt="" />}
                <p className="acao-text">{p.text}</p>
                {p.audioUrl && (
                  <div className="acao-audio compact">
                    <audio controls preload="none" src={p.audioUrl}>Seu navegador não toca este áudio.</audio>
                    {p.audioTranscript ? <p className="acao-transcript">{p.audioTranscript}</p> : null}
                  </div>
                )}
                <div className="hint">{p.timeAgo}</div>
              </div>
            ))}
            <Link className="btn btn-ghost" to="/em-acao" style={{ marginBottom: 8 }}>Ver o feed</Link>
          </>
        )}
        <h2 style={{ margin: '16px 0 10px', fontSize: 17 }}>Anúncios</h2>
        {listings.map((it) => <ListingRow key={it.id} item={it} />)}
        {listings.length < listingsTotal && (
          <button className="btn btn-ghost" style={{ marginTop: 8 }} disabled={listingsLoading} onClick={async () => {
            setListingsLoading(true);
            try {
              const next = listingsPage + 1;
              const d = await api('/api/users/' + id + '?page=' + next + '&limit=' + pageSize);
              const page = d.listings && Array.isArray(d.listings.items) ? d.listings : { items: d.listings || [] };
              setListings((prev) => prev.concat(page.items || []));
              setListingsTotal(page.total || 0);
              setListingsPage(next);
            } catch { /* keep current list */ }
            setListingsLoading(false);
          }}>
            {listingsLoading ? 'Carregando...' : 'Ver mais'}
          </button>
        )}
        <h2 style={{ margin: '16px 0 10px', fontSize: 17 }}>Avaliações</h2>
        {(data.reviews || []).map((r) => (
          <div key={r.id} className="list-item">
            <div>
              <strong>{r.reviewer?.name}</strong>
              <div>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</div>
              <p className="hint">{r.comment}</p>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
