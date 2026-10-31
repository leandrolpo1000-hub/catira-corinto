import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, money, formatBRLInput, parseBRL, formatCountdown, auctionTimerTone, auctionStatusLabel, lotLabel, winnerStatusLabel } from '../api';
import { useAuth, isAdminRole } from '../auth';
import { Empty, NeedAuth, Top } from '../components';
import { useConfig } from '../config';
import { useCity } from '../city';
import { AuctionSoundBtn, useAuctionAudio } from '../auctionAudio';
import { compressImages, revokePreviews } from '../compressImage';

function AuctionOff() {
  return (
    <>
      <Top back title="CATIRA LEILÃO" />
      <div className="page">
        <Empty title="Leilões desativados" text="Esta área está desligada no momento." to="/" cta="Voltar ao início" />
      </div>
    </>
  );
}

function useNow(ms) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms || 1000);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function AuctionCard({ item, compact, onScreen, now }) {
  const t = now || Date.now();
  const left = new Date(item.endAt).getTime() - t;
  const untilStart = new Date(item.startAt).getTime() - t;
  const tone = item.lotStatus === 'last_seconds' || item.status === 'live' ? auctionTimerTone(left) : 'ok';
  const img = item.images && item.images[0] && item.images[0].url;
  const st = item.lotStatus || item.status;
  return (
    <Link to={'/leilao/' + item.id} className={'auc-card' + (tone === 'hot' || tone === 'critical' ? ' is-hot' : '') + (item.finalLot ? ' is-final' : '') + (item.featured ? ' is-feat' : '') + (onScreen ? ' is-screen' : '')}>
      <div className="auc-thumb">
        {img && <img src={img} alt={item.title} loading="lazy" />}
        <span className={'auc-status ' + st}>{onScreen ? 'Na tela' : lotLabel(item)}</span>
        {item.finalLot && !onScreen && <span className="auc-seal final">Lote final</span>}
        {item.featured && !item.finalLot && !onScreen && <span className="auc-seal">Destaque</span>}
      </div>
      <div className="auc-body">
        <h3>{item.title}</h3>
        {!compact && item.description && <p className="auc-desc">{item.description}</p>}
        <div className="auc-bid">{item.status === 'live' || item.lotStatus === 'last_seconds' ? money(item.currentBid) : money(item.startingBid)}</div>
        <div className="meta">
          {item.category && item.category.name ? item.category.name + ' · ' : ''}
          {item.bidCount} {item.bidCount === 1 ? 'lance' : 'lances'}
          {item.status === 'scheduled' || item.lotStatus === 'soon' ? ' · ' + new Date(item.startAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}
        </div>
        {(item.status === 'live' || item.lotStatus === 'last_seconds') && (
          <div className={'auc-clock ' + tone}>{item.lotStatus === 'last_seconds' || tone === 'critical' ? 'ÚLTIMOS SEGUNDOS' : tone === 'hot' ? 'ÚLTIMO MINUTO' : formatCountdown(left)}</div>
        )}
        {(item.status === 'scheduled' || item.lotStatus === 'soon') && <div className="hint">Começa em {formatCountdown(untilStart)}</div>}
      </div>
    </Link>
  );
}

function NextSundayLot({ currentId, sunday, now }) {
  const [next, setNext] = useState(null);
  useEffect(() => {
    if (!sunday) return;
    api('/api/auctions/sunday?compact=1').then((d) => {
      const items = d.items || [];
      const i = items.findIndex((x) => x.id === currentId);
      const after = i >= 0 ? items.slice(i + 1).find((x) => x.lotStatus === 'live' || x.lotStatus === 'soon' || x.lotStatus === 'scheduled' || x.lotStatus === 'last_seconds') : (d.liveLot || d.nextLot);
      setNext(after || d.liveLot || d.nextLot || null);
    }).catch(() => {});
  }, [currentId, sunday]);
  if (!next) return null;
  return (
    <div style={{ margin: '16px 0' }}>
      <p className="sun-kicker">Próximo lote</p>
      <AuctionCard item={next} compact now={now} />
    </div>
  );
}

function SundayEvent({ user, flags, settings }) {
  const nav = useNavigate();
  const [prog, setProg] = useState(null);
  const [tvBusy, setTvBusy] = useState(false);
  const [tvErr, setTvErr] = useState('');
  const [tvFlash, setTvFlash] = useState('');
  const now = useNow(1000);
  const liveLot = prog && prog.liveLot;
  useAuctionAudio({
    enabled: !!(flags.auction_audio_enabled && prog && prog.enabled),
    lotId: liveLot && liveLot.id,
    lotStatus: liveLot && liveLot.lotStatus,
    status: liveLot && liveLot.status,
    phase: prog && prog.phase,
    featured: !!(liveLot && liveLot.featured),
    finalLot: !!(liveLot && liveLot.finalLot) || (prog && prog.phase === 'final'),
    leftMs: liveLot ? new Date(liveLot.endAt).getTime() - now : 0,
    untilStartMs: liveLot ? new Date(liveLot.startAt).getTime() - now : 0,
    settings: settings || {},
  });

  function load() {
    api('/api/auctions/sunday?compact=1').then(setProg).catch(() => {});
  }

  useEffect(() => {
    load();
    const t = setInterval(load, flags.real_time_bids ? 2000 : 8000);
    return () => clearInterval(t);
  }, [flags.real_time_bids]);

  if (!prog || !prog.enabled) return null;

  const copy = prog.copy || {};
  const clock = prog.clock || {};
  const edition = prog.edition;
  const nextEdition = prog.nextEdition;
  const mainLeft = new Date(prog.mainStartsAt).getTime() - now;
  const finalLeft = prog.finalStartsAt ? new Date(prog.finalStartsAt).getTime() - now : 0;
  const live = prog.liveLot;
  const next = prog.nextLot;
  const phase = prog.phase;
  const showWarmup = flags.auction_warmup_enabled && (phase === 'interval' || phase === 'warmup' || phase === 'countdown');
  const showLive = flags.auction_live_mode_enabled && !!(liveLot) && (phase === 'first_round' || phase === 'main' || phase === 'final' || liveLot.lotStatus === 'live' || liveLot.lotStatus === 'last_seconds');
  const showCountdown = flags.auction_countdown_enabled !== false;
  const featured = (prog.featured || []).filter((x) => x.lotStatus === 'scheduled' || x.lotStatus === 'soon' || x.round === 'main' || x.finalLot);
  const ended = phase === 'closed' && !nextEdition;
  const countTarget = (next && next.startAt) || (edition && edition.startAt) || prog.mainStartsAt || (nextEdition && nextEdition.startAt) || null;
  const countLeft = countTarget ? new Date(countTarget).getTime() - now : mainLeft;
  const showHeroCount = showCountdown && !ended && countLeft > 0 && !(showLive && live);
  const openClock = countTarget ? new Date(countTarget) : null;
  const openClockOk = openClock && !Number.isNaN(openClock.getTime());
  const openTimeLabel = openClockOk ? openClock.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : (clock.mainStart || '');
  const openDateLabel = openClockOk ? openClock.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
  const waitingBids = showHeroCount && !live;

  async function watchLot(id, watching) {
    if (!user) return;
    await api('/api/auctions/' + id + '/watch', { method: 'POST' });
    load();
  }

  async function bidLive() {
    if (!live) return;
    if (!user) return nav('/entrar?next=/leiloes');
    setTvBusy(true);
    setTvErr('');
    setTvFlash('');
    try {
      const d = await api('/api/auctions/' + live.id + '/bids', { method: 'POST', body: JSON.stringify({ amount: live.nextBid }) });
      setTvFlash(d.extended ? 'Lance aceito. Tempo estendido.' : 'Lance aceito.');
      load();
    } catch (ex) {
      setTvErr(ex.message);
      load();
    }
    setTvBusy(false);
  }

  const liveImg = live && live.images && live.images[0] && live.images[0].url;
  const liveLeft = live ? new Date(live.endAt).getTime() - now : 0;
  const liveTone = live ? auctionTimerTone(liveLeft) : 'ok';

  return (
    <div className={'sun-wrap' + (showLive && live ? ' has-tv' : '')}>
      {!(showLive && live) && (
        <div className={'sun-hero' + (ended ? ' done' : '')}>
          <p className="sun-kicker">{ended ? 'Em breve' : (edition ? ('Edição #' + edition.number) : copy.kicker)}</p>
          <h2>{ended ? (edition ? (edition.title + ' encerrada') : 'Leilão encerrado') : (edition && edition.title) || copy.title}</h2>
          <p>{ended ? 'Estamos preparando nosso próximo evento e divulgaremos em breve.' : copy.text}</p>
          {ended && <p className="hint" style={{ marginTop: 8, opacity: 0.75 }}>Os arremates ficam em Meus arremates.</p>}
          {waitingBids && (
            <div className="sun-count">
              <span>Abertura dos lances{openDateLabel ? ' · ' + openDateLabel : ''}{openTimeLabel ? ' · ' + openTimeLabel : ''}</span>
              <strong>Começa em {formatCountdown(countLeft)}</strong>
            </div>
          )}
        </div>
      )}

      {showLive && live && (
        <div className={'auc-tv' + (live.lotStatus === 'last_seconds' || liveTone === 'critical' ? ' hot' : '') + (live.finalLot ? ' final' : '')}>
          <div className="auc-tv-screen">
            {liveImg && <img src={liveImg} alt={live.title} />}
            <span className="sun-live">AO VIVO</span>
            {live.finalLot && <span className="auc-seal final">Grande final</span>}
            {edition && <span className="auc-tv-ed">#{edition.number}</span>}
          </div>
          <div className="auc-tv-panel">
            <h3>{live.title}</h3>
            <div className="auc-tv-row">
              <div>
                <span>Lance atual</span>
                <strong>{money(live.currentBid)}</strong>
              </div>
              <div className={'auc-clock ' + liveTone}>
                {live.lotStatus === 'last_seconds' || liveTone === 'critical' ? 'ÚLTIMOS SEGUNDOS' : liveTone === 'hot' ? 'ÚLTIMO MINUTO' : formatCountdown(liveLeft)}
                {(live.lotStatus === 'last_seconds' || liveTone === 'critical' || liveTone === 'hot') ? <small>{formatCountdown(liveLeft)}</small> : null}
              </div>
            </div>
            <div className="meta">{live.bidCount} {live.bidCount === 1 ? 'lance' : 'lances'} · {live.participantCount} {live.participantCount === 1 ? 'participante' : 'participantes'} · {prog.remainingLots} restantes</div>
            {tvFlash && <div className="auc-flash">{tvFlash}</div>}
            {tvErr && <div className="error">{tvErr}</div>}
            {live.isLeader && <p className="okbox">Você está na frente.</p>}
            {live.canParticipate && !live.canParticipate.ok && <div className="error">{live.canParticipate.reason}</div>}
            {!live.isSeller && (
              <button className="btn btn-primary auc-tv-bid" disabled={tvBusy || !!(user && live.canParticipate && !live.canParticipate.ok)} onClick={bidLive}>
                {tvBusy ? 'Enviando...' : 'DAR LANCE — ' + money(live.nextBid)}
              </button>
            )}
            {next && <div className="hint">Próximo: {next.title}</div>}
          </div>
        </div>
      )}

      {showWarmup && (
        <div className="sun-warm">
          <p className="sun-kicker">Hoje à noite</p>
          <h3>Os melhores lotes entram em disputa a partir das {(clock.mainStart || '20:00').replace(':', 'h')}.</h3>
          {showCountdown && countLeft > 0 && (
            <div className="sun-count">
              <span>{next ? 'Próximo lote' : 'Próxima rodada'} {clock.mainStart}</span>
              <strong>Começa em {formatCountdown(countLeft)}</strong>
            </div>
          )}
          <p className="lead" style={{ marginTop: 12 }}>Olha o que vem por aí...</p>
        </div>
      )}

      {flags.auction_final_lot_enabled && prog.finalLot && (phase === 'main' || phase === 'countdown' || phase === 'warmup') && prog.finalLot.lotStatus !== 'live' && prog.finalLot.lotStatus !== 'last_seconds' && (
        <div className="sun-final-soon">
          <p className="sun-kicker">Grande lote final</p>
          <h3>O último e maior lote da noite começa em...</h3>
          {showCountdown && finalLeft > 0 && <div className="sun-count"><strong>{formatCountdown(finalLeft)}</strong></div>}
          <AuctionCard item={prog.finalLot} compact now={now} />
        </div>
      )}

      {!ended && <h3 style={{ fontSize: 15, margin: '16px 0 8px' }}>{showLive && live ? 'Próximos lotes' : (waitingBids ? 'Lotes da próxima rodada' : (phase === 'discovery' || phase === 'pre' || phase === 'upcoming' ? 'Lotes de hoje' : 'Programação'))}</h3>}
      <div className="auc-list">
        {(prog.items || []).map((it) => (
          <div key={it.id}>
            <AuctionCard item={it} onScreen={!!(live && it.id === live.id)} compact={showLive && live && it.id !== live.id} now={now} />
            {flags.auction_watchers_enabled && (it.lotStatus === 'scheduled' || it.lotStatus === 'soon') && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ marginTop: 6 }}
                onClick={() => user ? watchLot(it.id) : (window.location.href = '/entrar?next=/leiloes')}
              >
                {it.watching ? 'Aviso ativado' : 'Avisar quando começar'}
              </button>
            )}
          </div>
        ))}
      </div>
      {!!featured.length && flags.auction_featured_lots_enabled && (phase === 'warmup' || phase === 'countdown' || phase === 'interval') && (
        <p className="hint" style={{ marginTop: 8 }}>Os lotes da noite ainda não aceitam lance.</p>
      )}
    </div>
  );
}

export default function Auctions() {
  const { auctionEnabled, auction } = useConfig();
  const { city, cityQuery } = useCity();
  const { user } = useAuth();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const section = sp.get('section') || 'live';
  const sort = sp.get('sort') || (section === 'ending' ? 'ending' : 'recent');
  const [items, setItems] = useState([]);
  const [q, setQ] = useState(sp.get('q') || '');
  const flags = (auction && auction.flags) || {};
  const settings = (auction && auction.settings) || {};
  const nowList = useNow(1000);
  const sundayOn = !!flags.auction_sunday_schedule_enabled;
  const liveItem = items.find((it) => it.lotStatus === 'live' || it.lotStatus === 'last_seconds' || it.status === 'live');
  useAuctionAudio({
    enabled: !!(flags.auction_audio_enabled && auctionEnabled && !sundayOn && liveItem),
    lotId: liveItem && liveItem.id,
    lotStatus: liveItem && liveItem.lotStatus,
    status: liveItem && liveItem.status,
    phase: '',
    featured: !!(liveItem && liveItem.featured),
    finalLot: !!(liveItem && liveItem.finalLot),
    leftMs: liveItem ? new Date(liveItem.endAt).getTime() - nowList : 0,
    untilStartMs: liveItem ? new Date(liveItem.startAt).getTime() - nowList : 0,
    settings,
  });

  useEffect(() => {
    if (!auctionEnabled) return;
    const qs = new URLSearchParams();
    qs.set('section', section);
    qs.set('sort', sort);
    if (q) qs.set('q', q);
    const cityQ = cityQuery();
    if (cityQ) cityQ.split('&').forEach((p) => { const [k, v] = p.split('='); if (k && v) qs.set(k, decodeURIComponent(v)); });
    api('/api/auctions?' + qs.toString()).then((d) => setItems(d.items || [])).catch(() => setItems([]));
  }, [auctionEnabled, section, sort, city, q]);

  if (!auctionEnabled) return <AuctionOff />;

  function go(patch) {
    const next = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => { if (v) next.set(k, v); else next.delete(k); });
    setSp(next);
  }

  return (
    <>
      <Top title="CATIRA LEILÃO" />
      <div className="page">
        {!sundayOn && (
          <>
            <h1>CATIRA LEILÃO</h1>
            <p className="lead">Disputa ao vivo. Lance, acompanhe e arremate com transparência.</p>
          </>
        )}
        {flags.auction_audio_enabled && <div className="auc-sound-dock"><AuctionSoundBtn /></div>}
        {sundayOn && <SundayEvent user={user} flags={flags} settings={(auction && auction.settings) || {}} />}
        {user && isAdminRole(user.role) && <Link className="btn btn-primary" style={{ margin: '12px 0' }} to="/criar-leilao">Criar lote</Link>}
        {!sundayOn && (
          <>
            <div className="chips">
              {[['live', 'Ao vivo'], ['ending', 'Terminando'], ['scheduled', 'Novos']].map(([k, l]) => (
                <button key={k} className={'chip' + (section === k ? ' on' : '')} onClick={() => go({ section: k, sort: k === 'ending' ? 'ending' : 'recent' })}>{l}</button>
              ))}
              {user && <Link className="chip" to="/meus-leiloes">Meus leilões</Link>}
              {user && flags.auction_watchers_enabled && <Link className="chip" to="/estou-de-olho">Estou de olho</Link>}
              {user && <Link className="chip" to="/meus-arremates">Meus arremates</Link>}
              {flags.auction_ranking_enabled && <Link className="chip" to="/ranking-leilao">Ranking</Link>}
            </div>
            <form className="hero-search" onSubmit={(e) => { e.preventDefault(); go({ q }); }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar leilão" />
            </form>
            <div className="chips" style={{ marginTop: 8 }}>
              {[['ending', 'Mais próximos'], ['bids', 'Mais disputados'], ['price_asc', 'Menor lance'], ['price_desc', 'Maior lance']].map(([k, l]) => (
                <button key={k} className={'chip' + (sort === k ? ' on' : '')} onClick={() => go({ sort: k })}>{l}</button>
              ))}
            </div>
            {!items.length && <Empty title="Nenhum leilão agora" text="Quando um leilão abrir, ele aparece aqui." to="/" cta="Voltar ao início" />}
            <div className="auc-list">
              {items.map((it) => <AuctionCard key={it.id} item={it} now={nowList} />)}
            </div>
          </>
        )}
      </div>
    </>
  );
}

export function CreateAuction() {
  const { user } = useAuth();
  const { auctionEnabled, auction } = useConfig();
  const nav = useNavigate();
  const fileRef = useRef(null);
  const [photos, setPhotos] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const settings = (auction && auction.settings) || {};
  const defInc = Number(settings.minIncrement) || 5;
  const defHours = Number(settings.minDurationHours) || 1;
  const [form, setForm] = useState({
    title: '',
    startingBid: '',
    durationHours: String(defHours),
    startAt: '',
  });
  const photosRef = useRef(photos);
  photosRef.current = photos;
  useEffect(() => () => revokePreviews(photosRef.current), []);

  if (!auctionEnabled) return <AuctionOff />;
  if (!user) return <NeedAuth next="/criar-leilao" />;
  if (!isAdminRole(user.role)) return <Navigate to="/" replace />;

  function set(k, v) { setForm({ ...form, [k]: v }); }

  async function onPhotos(e) {
    const incoming = [...(e.target.files || [])];
    e.target.value = '';
    if (!incoming.length) return;
    try {
      const compressed = await compressImages(incoming, 8 - photos.length);
      setPhotos((prev) => [...prev, ...compressed].slice(0, 8));
    } catch (ex) {
      setErr(ex.message);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (!form.title.trim()) return setErr('Informe o produto.');
    if (photos.length < 1) return setErr('Adicione pelo menos uma foto.');
    const start = parseBRL(form.startingBid);
    if (!start || start <= 0) return setErr('Informe o lance inicial.');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('title', form.title);
      fd.append('description', form.title);
      fd.append('city', user.city || 'Corinto');
      if (user.cityId) fd.append('cityId', user.cityId);
      fd.append('startingBid', String(start.toFixed(2)));
      fd.append('minIncrement', String(Number(defInc).toFixed(2)));
      fd.append('durationHours', String(form.durationHours || defHours));
      if (form.startAt) fd.append('startAt', new Date(form.startAt).toISOString());
      fd.append('deliveryMethod', 'retirada');
      fd.append('pickupInfo', 'Retirada em Corinto, combinamos o horário.');
      photos.forEach((p) => fd.append('photos', p.file));
      const d = await api('/api/auctions', { method: 'POST', body: fd });
      nav('/leilao/' + d.id);
    } catch (ex) {
      setErr(ex.message);
    }
    setBusy(false);
  }

  return (
    <>
      <Top back title="Criar leilão" />
      <div className="page">
        <h1>Novo lote</h1>
        <p className="lead">Foto, produto, lance e horário. Incremento e retirada saem do padrão do leilão.</p>
        {err && <div className="error">{err}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label>Foto</label>
            <input ref={fileRef} type="file" accept="image/*" multiple onChange={onPhotos} />
            <div className="hint">Pelo menos 1 foto. Até 8. {photos.length}/8</div>
            {photos.length > 0 && (
              <div className="photo-grid">
                {photos.map((p, i) => (
                  <div key={p.preview} className={'photo-item' + (i === 0 ? ' is-main' : '')}>
                    <img src={p.preview} alt="" />
                    <button type="button" className="photo-remove" onClick={() => setPhotos((prev) => prev.filter((_, x) => x !== i))}>Remover</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="field"><label>Produto</label><input value={form.title} onChange={(e) => set('title', e.target.value)} required placeholder="Ex.: Ventilador de mesa" /></div>
          <div className="field">
            <label>Lance inicial (R$)</label>
            <input value={form.startingBid} onChange={(e) => set('startingBid', formatBRLInput(e.target.value))} inputMode="numeric" required placeholder="0,00" />
            <div className="hint">Mínimo {money(settings.startingBidMin || 1)}.</div>
          </div>
          <div className="field">
            <label>Início</label>
            <input type="datetime-local" value={form.startAt} onChange={(e) => set('startAt', e.target.value)} />
            <div className="hint">Vazio = começa agora.</div>
          </div>
          <div className="field">
            <label>Duração (horas)</label>
            <input type="number" min={settings.minDurationHours || 1} max={settings.maxDurationHours || 720} value={form.durationHours} onChange={(e) => set('durationHours', e.target.value)} required />
          </div>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Publicando...' : 'Publicar lote'}</button>
        </form>
      </div>
    </>
  );
}

export function AuctionDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { auctionEnabled, auction } = useConfig();
  const nav = useNavigate();
  const [item, setItem] = useState(null);
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState('');
  const [busy, setBusy] = useState(false);
  const now = useNow(1000);
  const flags = (auction && auction.flags) || {};
  const settings = (auction && auction.settings) || {};
  const prevBid = useRef(null);
  const leftMs = item ? new Date(item.endAt).getTime() - now : 0;
  const untilStartMs = item ? new Date(item.startAt).getTime() - now : 0;
  useAuctionAudio({
    enabled: !!(flags.auction_audio_enabled && auctionEnabled && item),
    lotId: item && item.id,
    lotStatus: item && item.lotStatus,
    status: item && item.status,
    phase: '',
    featured: !!(item && item.featured),
    finalLot: !!(item && item.finalLot),
    leftMs,
    untilStartMs,
    settings,
  });

  async function load() {
    const d = await api('/api/auctions/' + id);
    if (prevBid.current != null && d.currentBid > prevBid.current) {
      if (d.isLeader) setFlash('');
      else if (item && item.isLeader) setFlash('VOCÊ FOI ULTRAPASSADO!');
      else setFlash('NOVO LANCE!');
    }
    prevBid.current = d.currentBid;
    setItem(d);
    return d;
  }

  useEffect(() => {
    if (!auctionEnabled) return;
    load().catch((e) => setErr(e.message));
  }, [id, auctionEnabled]);

  useEffect(() => {
    if (!auctionEnabled || !flags.real_time_bids) return;
    const t = setInterval(() => { load().catch(() => {}); }, 2000);
    return () => clearInterval(t);
  }, [id, flags.real_time_bids, auctionEnabled]);

  if (!auctionEnabled) return <AuctionOff />;

  if (err && !item) return <><Top back title="Leilão" /><div className="page"><div className="error">{err}</div></div></>;
  if (!item) return <><Top back title="Leilão" /><div className="page">Carregando...</div></>;

  const left = leftMs;
  const untilStart = untilStartMs;
  const tone = item.status === 'live' || item.lotStatus === 'last_seconds' ? auctionTimerTone(left) : item.status;
  const img = item.images && item.images[0] && item.images[0].url;
  const isLive = item.status === 'live' || item.lotStatus === 'last_seconds';
  const isSoon = item.lotStatus === 'soon' || item.status === 'scheduled';

  async function bid() {
    if (!user) return nav('/entrar?next=/leilao/' + id);
    setBusy(true);
    setErr('');
    try {
      const d = await api('/api/auctions/' + id + '/bids', { method: 'POST', body: JSON.stringify({ amount: item.nextBid }) });
      setItem(d.auction);
      prevBid.current = d.auction.currentBid;
      setFlash(d.extended ? 'Lance aceito. Tempo estendido.' : 'Lance aceito.');
    } catch (ex) {
      setErr(ex.message);
      load().catch(() => {});
    }
    setBusy(false);
  }

  async function watch() {
    if (!user) return nav('/entrar?next=/leilao/' + id);
    const d = await api('/api/auctions/' + id + '/watch', { method: 'POST' });
    setItem({ ...item, watching: d.watching, watcherCount: d.watcherCount });
  }

  if (item.status === 'ended' && item.isWinner) {
    return (
      <>
        <Top back title="Arremate" />
        <div className="page auc-win">
          {flags.auction_audio_enabled && <div className="auc-sound-dock"><AuctionSoundBtn /></div>}
          <p className="auc-win-kicker">Você arrematou</p>
          <h1>VOCÊ ARREMATOU!</h1>
          {img && <img src={img} alt="" />}
          <strong>{item.title}</strong>
          <div className="auc-bid">{money(item.winnerAmount || item.currentBid)}</div>
          <p>Você venceu outros {Math.max(0, item.participantCount - 1)} participantes.</p>
          <p className="hint">Finalize o pagamento para concluir o arremate.</p>
          <Link className="btn btn-primary" to={'/pagar-leilao/' + item.id}>GARANTIR MEU ARREMATE</Link>
          {item.sundayEvent && item.finalLot && <p className="sun-kicker" style={{ marginTop: 16 }}>Leilão encerrado</p>}
          <NextSundayLot currentId={item.id} sunday={item.sundayEvent} now={now} />
        </div>
      </>
    );
  }

  if (item.status === 'ended' && item.participated && !item.isWinner) {
    return (
      <>
        <Top back title="Leilão" />
        <div className="page">
          {flags.auction_audio_enabled && <div className="auc-sound-dock"><AuctionSoundBtn /></div>}
          <p className="sun-kicker">Lote encerrado</p>
          <h1>Você não levou dessa vez.</h1>
          <p className="lead">O arremate terminou em {money(item.winnerAmount || item.currentBid)}.</p>
          {item.sundayEvent && item.finalLot && <h2>Leilão encerrado</h2>}
          <p>Continue acompanhando outros leilões.</p>
          <NextSundayLot currentId={item.id} sunday={item.sundayEvent} now={now} />
          <Link className="btn btn-primary" to="/leiloes">VER OUTROS LEILÕES</Link>
        </div>
      </>
    );
  }

  return (
    <>
      <Top back title="Leilão" />
      <div className="page auc-page">
        {img && <img className="auc-hero" src={img} alt={item.title} />}
        {item.finalLot && <p className="sun-kicker">Grande lote final</p>}
        {isLive && flags.auction_live_mode_enabled && <span className="sun-live">AO VIVO</span>}
        {flags.auction_audio_enabled && <div className="auc-sound-dock"><AuctionSoundBtn /></div>}
        <h1>{item.title}</h1>
        <div className="meta">{item.city}/MG · {item.category && item.category.name} · {item.participantCount} {item.participantCount === 1 ? 'participante' : 'participantes'} · {item.watcherCount} de olho</div>
        {flash && <div className={'auc-flash' + (flash.includes('ULTRAPASSADO') ? ' warn' : '')}>{flash}</div>}
        {err && <div className="error">{err}</div>}
        {isSoon && (
          <div className="sun-count" style={{ margin: '12px 0' }}>
            <span>{lotLabel(item)}</span>
            <strong>Começa em {formatCountdown(untilStart)}</strong>
          </div>
        )}
        <div className={'auc-board ' + tone + (item.finalLot ? ' final' : '')}>
          <div>
            <span>{isLive ? 'Lance atual' : 'Lance inicial'}</span>
            <strong>{money(isLive ? item.currentBid : item.startingBid)}</strong>
          </div>
          <div>
            <span>Próximo lance</span>
            <strong>{money(item.nextBid)}</strong>
          </div>
          <div className={'auc-clock ' + tone}>
            {isLive
              ? (item.lotStatus === 'last_seconds' || tone === 'critical' ? 'ÚLTIMOS SEGUNDOS' : tone === 'hot' ? 'ÚLTIMO MINUTO' : formatCountdown(left))
              : (lotLabel(item))}
            {isLive && (item.lotStatus === 'last_seconds' || tone === 'critical' || tone === 'hot') ? <small>{formatCountdown(left)}</small> : null}
          </div>
        </div>
        {item.watching && flags.auction_watchers_enabled && <p className="hint">Você está acompanhando este leilão.</p>}
        {item.isLeader && isLive && <p className="okbox">Você está na frente.</p>}
        {isLive && !item.isSeller && (
          <button className="btn btn-primary auc-bid-btn" disabled={busy || (item.canParticipate && !item.canParticipate.ok)} onClick={bid}>
            {busy ? 'Enviando...' : 'DAR LANCE — ' + money(item.nextBid)}
          </button>
        )}
        {item.canParticipate && !item.canParticipate.ok && <div className="error">{item.canParticipate.reason}</div>}
        {flags.auction_watchers_enabled && !item.isSeller && (isLive || isSoon) && (
          <button className="btn btn-ghost" onClick={watch}>{item.watching ? 'Parar de acompanhar' : (isSoon ? 'AVISAR QUANDO COMEÇAR' : 'ESTOU DE OLHO')}</button>
        )}
        <p style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{item.description}</p>
        {item.pickupInfo && <p className="hint">Retirada: {item.pickupInfo}</p>}
        {item.sellerRules && <p className="hint">Regras: {item.sellerRules}</p>}
        {item.status === 'ended' && item.sundayEvent && (
          <>
            <p className="sun-kicker">Lote encerrado</p>
            {item.finalLot && <h2>Leilão encerrado</h2>}
            <NextSundayLot currentId={item.id} sunday now={now} />
          </>
        )}
        <h2 style={{ fontSize: 16, margin: '16px 0 8px' }}>Histórico de lances</h2>
        {!(item.history || []).length && <p className="hint">Ainda sem lances. Seja o primeiro.</p>}
        {(item.history || []).map((b, i) => (
          <div key={b.id} className={'auc-hist' + (b.mine ? ' mine' : '')}>
            <span>{i === 0 ? '1' : i === 1 ? '2' : i === 2 ? '3' : (i + 1)}</span>
            <strong>{b.bidder}</strong>
            <em>{money(b.amount)}</em>
          </div>
        ))}
      </div>
    </>
  );
}

export function MyAuctions() {
  const { user } = useAuth();
  const { auctionEnabled } = useConfig();
  const [items, setItems] = useState([]);
  const now = useNow(1000);
  useEffect(() => { if (user) api('/api/auctions/mine').then((d) => setItems(d.items || [])).catch(() => {}); }, [user]);
  if (!auctionEnabled) return <AuctionOff />;
  if (!user) return <NeedAuth next="/meus-leiloes" />;
  return (
    <>
      <Top back title="Meus leilões" />
      <div className="page">
        <h1>Meus leilões</h1>
        {!items.length && <Empty title="Nenhum leilão" text={isAdminRole(user.role) ? 'Publique o primeiro.' : 'Quando você participar, aparece aqui.'} to={isAdminRole(user.role) ? '/criar-leilao' : '/leiloes'} cta={isAdminRole(user.role) ? 'Criar leilão' : 'Ver leilões'} />}
        <div className="auc-list">{items.map((it) => <AuctionCard key={it.id} item={it} now={now} />)}</div>
      </div>
    </>
  );
}

export function Watching() {
  const { user } = useAuth();
  const { auctionEnabled } = useConfig();
  const [items, setItems] = useState([]);
  const now = useNow(1000);
  useEffect(() => { if (user) api('/api/auctions/watching').then((d) => setItems(d.items || [])).catch(() => {}); }, [user]);
  if (!auctionEnabled) return <AuctionOff />;
  if (!user) return <NeedAuth next="/estou-de-olho" />;
  return (
    <>
      <Top back title="Estou de olho" />
      <div className="page">
        <h1>Estou de olho</h1>
        {!items.length && <Empty title="Nada aqui" text="Toque em Estou de olho em um leilão." to="/leiloes" cta="Ver leilões" />}
        <div className="auc-list">{items.map((it) => <AuctionCard key={it.id} item={it} now={now} />)}</div>
      </div>
    </>
  );
}

export function MyWins() {
  const { user } = useAuth();
  const { auctionEnabled } = useConfig();
  const nav = useNavigate();
  const [items, setItems] = useState([]);
  const now = useNow(1000);
  useEffect(() => { if (user) api('/api/auctions/won').then((d) => setItems(d.items || [])).catch(() => {}); }, [user]);
  if (!auctionEnabled) return <AuctionOff />;
  if (!user) return <NeedAuth next="/meus-arremates" />;
  return (
    <>
      <Top back title="Meus arremates" />
      <div className="page">
        <h1>Meus arremates</h1>
        {!items.length && <Empty title="Nenhum arremate" text="Quando você vencer, aparece aqui." to="/leiloes" cta="Ver leilões" />}
        {items.map((it) => (
          <div key={it.id} className="list-item" style={{ flexDirection: 'column' }}>
            <AuctionCard item={it} now={now} />
            {it.win && <span className={'status ' + it.win.status}>{winnerStatusLabel[it.win.status] || it.win.status} · {money(it.win.amount)}</span>}
            {it.win && it.win.status === 'PENDING_PAYMENT' && <button className="btn btn-primary" onClick={() => nav('/pagar-leilao/' + it.id)}>Pagar arremate</button>}
          </div>
        ))}
      </div>
    </>
  );
}

export function AuctionPay() {
  const { id } = useParams();
  const { user } = useAuth();
  const { auctionEnabled } = useConfig();
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { if (auctionEnabled) api('/api/auctions/' + id + '/payment').then(setData).catch((e) => setErr(e.message)); }, [id, auctionEnabled]);
  if (!auctionEnabled) return <AuctionOff />;
  if (!user) return <NeedAuth next={'/pagar-leilao/' + id} />;
  if (err) return <><Top back /><div className="page"><div className="error">{err}</div></div></>;
  if (!data) return <><Top back /><div className="page">Carregando...</div></>;
  const w = data.winner;
  const p = data.payment;
  return (
    <>
      <Top back title="Pagar arremate" />
      <div className="page">
        <h1>Garantir meu arremate</h1>
        <p className="lead">Valor: {money(w.amount)}. Status: {winnerStatusLabel[w.status] || w.status}.</p>
        {w.paymentDeadline && w.status === 'PENDING_PAYMENT' && <p className="hint">Pague até {new Date(w.paymentDeadline).toLocaleString('pt-BR')}.</p>}
        {msg && <div className="okbox">{msg}</div>}
        {p && p.qrDataUrl && <img src={p.qrDataUrl} alt="QR Code PIX" style={{ width: 220, height: 220, display: 'block', margin: '12px auto' }} />}
        {p && p.pixCode && <pre className="pix-code">{p.pixCode}</pre>}
        {p && p.pixKey && <p className="hint">Chave PIX: {p.pixKey}</p>}
        {w.status === 'PENDING_PAYMENT' && (
          <button className="btn btn-primary" onClick={async () => {
            try {
              const d = await api('/api/auctions/' + id + '/pay', { method: 'POST' });
              setMsg(d.message);
            } catch (ex) { setErr(ex.message); }
          }}>JÁ PAGUEI O PIX</button>
        )}
      </div>
    </>
  );
}

export function AuctionRanking() {
  const { auctionEnabled, auction } = useConfig();
  const [data, setData] = useState({ items: [] });
  useEffect(() => { if (auctionEnabled) api('/api/auctions/ranking').then(setData).catch(() => {}); }, [auctionEnabled]);
  if (!auctionEnabled) return <AuctionOff />;
  if (!(auction && auction.flags && auction.flags.auction_ranking_enabled)) {
    return <><Top back title="Ranking" /><div className="page"><Empty title="Ranking desativado" text="O administrador ainda não ligou esta função." to="/leiloes" cta="Ver leilões" /></div></>;
  }
  return (
    <>
      <Top back title="Ranking de leilões" />
      <div className="page">
        <h1>Ranking de arrematadores</h1>
        {!(data.items || []).length && <Empty title="Ainda vazio" text="Conclua um arremate para entrar." to="/leiloes" cta="Ver leilões" />}
        {(data.items || []).map((u, i) => (
          <div key={u.userId} className="rank-row">
            <span className={'rank-pos' + (i < 3 ? ' top' : '')}>{i + 1}</span>
            <div className="rank-info">
              <strong>{u.name}</strong>
              <div className="hint">{u.totalPaid} concluídos · {u.completionRate}% · {u.points} pts</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export function AuctionNotices() {
  const { user } = useAuth();
  const { auctionEnabled } = useConfig();
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (!user || !auctionEnabled) return;
    api('/api/auctions/notifications').then((d) => setItems(d.items || [])).catch(() => {});
    api('/api/auctions/notifications/read', { method: 'POST' }).catch(() => {});
  }, [user, auctionEnabled]);
  if (!auctionEnabled) return <AuctionOff />;
  if (!user) return <NeedAuth next="/avisos-leilao" />;
  return (
    <>
      <Top back title="Avisos de leilão" />
      <div className="page">
        <h1>Avisos de leilão</h1>
        {!items.length && <Empty title="Nenhum aviso" text="Quando um lance passar o seu, aparece aqui." to="/leiloes" cta="Ver leilões" />}
        {items.map((n) => (
          <Link key={n.id} to={n.auctionId ? '/leilao/' + n.auctionId : '/leiloes'} className="list-item" style={{ flexDirection: 'column' }}>
            <strong>{n.title}</strong>
            <p className="hint">{n.text}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
