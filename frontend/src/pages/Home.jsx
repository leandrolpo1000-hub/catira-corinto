import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, money } from '../api';
import { CatIcon, Gavel, ShoppingBag, Tag, Repeat2, Search } from '../icons';
import { HomeAdBanner, ListingCard, SearchBox, Top } from '../components';
import { useConfig } from '../config';
import { useCity } from '../city';
import { useAuth, isAdminRole } from '../auth';
import { productPath } from '../productPath';

const WEEKDAY_LABELS = ['DOMINGO', 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO'];

// Estado real do leilão para a etiqueta (nunca por horário presumido).
function auctionBadge(prog, settings) {
  if (!prog || !prog.enabled) return null;
  const live = !!(prog.liveLot && (prog.liveLot.lotStatus === 'live' || prog.liveLot.lotStatus === 'last_seconds'));
  if (live) return { label: 'AO VIVO', live: true };
  if (prog.phase === 'closed') return { label: 'EM BREVE', live: false };
  const weekday = Number(settings && settings.sundayEventWeekday);
  const wd = Number.isFinite(weekday) ? weekday : 0;
  const ed = prog.edition || prog.nextEdition;
  if (ed && ed.date) {
    const d = new Date(ed.date + 'T12:00:00');
    const day = d.getDay();
    if (day !== wd) return { label: 'EM BREVE', live: false };
    return { label: WEEKDAY_LABELS[day] || 'DOMINGO', live: false };
  }
  if (prog.phase === 'upcoming') return { label: 'EM BREVE', live: false };
  return { label: WEEKDAY_LABELS[wd] || 'DOMINGO', live: false };
}

// Carrossel horizontal com arraste, encaixe, setas e indicadores.
// No celular o próximo card fica parcialmente visível para deixar claro que dá para arrastar.
function ListingCarousel({ items }) {
  const trackRef = useRef(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [active, setActive] = useState(0);

  function measure() {
    const el = trackRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setAtStart(el.scrollLeft <= 4);
    setAtEnd(el.scrollLeft >= max - 4);
    const first = el.firstElementChild;
    if (first) {
      const step = first.getBoundingClientRect().width + 12;
      setActive(Math.max(0, Math.min(items.length - 1, Math.round(el.scrollLeft / step))));
    }
  }

  useEffect(() => {
    measure();
    const el = trackRef.current;
    if (!el) return undefined;
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [items.length]);

  function goTo(index) {
    const el = trackRef.current;
    if (!el) return;
    const first = el.firstElementChild;
    if (!first) return;
    const step = first.getBoundingClientRect().width + 12;
    el.scrollTo({ left: step * index, behavior: 'smooth' });
  }

  function scrollByPage(dir) {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.9, 220), behavior: 'smooth' });
  }

  if (!items.length) return null;

  return (
    <div className={'carousel' + (atStart ? ' at-start' : '') + (atEnd ? ' at-end' : '')}>
      <div className="carousel-viewport">
        <div className="carousel-track" ref={trackRef} role="list">
          {items.map((it) => (
            <div key={it.id} className="carousel-item" role="listitem">
              <ListingCard item={it} />
            </div>
          ))}
        </div>
        <button
          type="button"
          className="carousel-nav prev"
          aria-label="Anúncios anteriores"
          disabled={atStart}
          onClick={() => scrollByPage(-1)}
        >
          <span aria-hidden="true">&#8249;</span>
        </button>
        <button
          type="button"
          className="carousel-nav next"
          aria-label="Próximos anúncios"
          disabled={atEnd}
          onClick={() => scrollByPage(1)}
        >
          <span aria-hidden="true">&#8250;</span>
        </button>
      </div>

      <div className="carousel-dots">
        {items.map((it, i) => (
          <button
            key={it.id}
            type="button"
            className={'carousel-dot' + (i === active ? ' on' : '')}
            aria-label={'Ir para o anúncio ' + (i + 1)}
            aria-current={i === active ? 'true' : undefined}
            onClick={() => goTo(i)}
          />
        ))}
      </div>
      <p className="carousel-hint" aria-hidden="true">Arraste para o lado para ver mais</p>
    </div>
  );
}

export default function Home() {
  const nav = useNavigate();
  const { fee, commonFeeEnabled, auctionEnabled, auction } = useConfig();
  const { city, cityQuery } = useCity();
  const { user } = useAuth();
  const [prog, setProg] = useState(null);
  const [q, setQ] = useState('');
  const [cats, setCats] = useState([]);
  const [recent, setRecent] = useState([]);
  const [featured, setFeatured] = useState([]);
  const [trades, setTrades] = useState([]);
  const [wants, setWants] = useState([]);
  const [ranking, setRanking] = useState([]);
  const [moreCats, setMoreCats] = useState(false);
  const CAT_ROW = 4;
  const visibleCats = moreCats ? cats : cats.slice(0, CAT_ROW * 2);

  useEffect(() => {
    const extra = cityQuery() ? '&' + cityQuery() : '';
    api('/api/categories').then(setCats).catch(() => {});
    api('/api/listings?home=1&limit=8&boost=0' + extra).then((d) => setRecent(d.items || [])).catch(() => {});
    api('/api/listings?home=1&section=destaque&limit=6' + extra).then((d) => setFeatured(d.items || [])).catch(() => {});
    api('/api/listings?home=1&trade=true&limit=6' + extra).then((d) => setTrades(d.items || [])).catch(() => {});
    api('/api/listings?home=1&type=procuro&limit=6' + extra).then((d) => setWants(d.items || [])).catch(() => {});
    api('/api/ranking?limit=5').then((d) => setRanking(d.items || [])).catch(() => {});
  }, [city]);

  useEffect(() => {
    if (!auctionEnabled) return;
    let alive = true;
    const load = () => api('/api/auctions/sunday?compact=1').then((d) => { if (alive) setProg(d); }).catch(() => {});
    load();
    const t = setInterval(load, 20000);
    return () => { alive = false; clearInterval(t); };
  }, [auctionEnabled]);

  const badge = auctionEnabled ? auctionBadge(prog, auction && auction.settings) : null;

  function goSearch(patch, qOverride) {
    const term = qOverride !== undefined ? qOverride : q;
    const qs = new URLSearchParams();
    if (term) qs.set('q', term);
    Object.entries(patch || {}).forEach(([k, v]) => { if (v) qs.set(k, v); });
    nav('/buscar' + (qs.toString() ? '?' + qs.toString() : ''));
  }

  return (
    <>
      <Top />
      {user && !user.emailVerified && !isAdminRole(user.role) && (
        <div className="verify-banner">
          <div>
            <strong>Confirme seu e-mail</strong>
            <p>Você precisa confirmar o e-mail para publicar anúncios.</p>
          </div>
          <Link to="/confirmar-email" className="btn btn-primary">Confirmar</Link>
        </div>
      )}
      <section className="hero">
        <h1>Encontre o que você procura</h1>
        <p>Você precisa. A gente resolve.</p>
        <div className="hero-search">
          <SearchBox value={q} onChange={setQ} onSubmit={(term) => goSearch({}, term)} placeholder="O que você está procurando?" />
        </div>
        <div className="home-shortcuts">
          {auctionEnabled && (
            <Link to="/leiloes" className="shortcut is-auction">
              {badge && (
                <span className={'shortcut-badge' + (badge.live ? ' live' : '')}>
                  {badge.live && <span className="shortcut-dot" aria-hidden="true" />}
                  {badge.label}
                </span>
              )}
              <Gavel className="shortcut-ico" size={18} strokeWidth={2} />
              <span className="shortcut-label">Leilão</span>
            </Link>
          )}
          <button type="button" className="shortcut" onClick={() => goSearch()}>
            <ShoppingBag className="shortcut-ico" size={18} strokeWidth={2} />
            <span className="shortcut-label">Comprar</span>
          </button>
          <Link to={user ? '/anunciar' : '/entrar?next=/anunciar'} className="shortcut">
            <Tag className="shortcut-ico" size={18} strokeWidth={2} />
            <span className="shortcut-label">Vender</span>
          </Link>
          <Link to="/catiras" className="shortcut">
            <Repeat2 className="shortcut-ico" size={18} strokeWidth={2} />
            <span className="shortcut-label">Trocar</span>
          </Link>
          <button type="button" className="shortcut" onClick={() => goSearch({ type: 'procuro' })}>
            <Search className="shortcut-ico" size={18} strokeWidth={2} />
            <span className="shortcut-label">Procurar</span>
          </button>
        </div>
      </section>

      {commonFeeEnabled && (
        <section className="promo-plaque">
          <strong>Anuncie por apenas {money(fee).replace(/\s/g, ' ')}</strong>
          <p>esse valor até atingir o limite da cota preestabelecida</p>
        </section>
      )}

      <HomeAdBanner className="section" />

      <section className="section">
        <div className="section-head"><h2>Categorias</h2></div>
        <div className="cats">
          {visibleCats.map((c) => (
            <Link key={c.id} className="cat" to={'/buscar?category=' + c.slug}>
              <span className="ico"><CatIcon name={c.icon} /></span>
              <span>{c.name}</span>
            </Link>
          ))}
        </div>
        {cats.length > CAT_ROW * 2 && (
          <button type="button" className="cats-more" onClick={() => setMoreCats(!moreCats)}>
            {moreCats ? 'Mostrar menos' : 'Mostrar mais'}
          </button>
        )}
      </section>

      {featured.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Anúncios em destaque</h2>
            <Link to="/buscar?sort=recent">Ver todos</Link>
          </div>
          <div className="grid">
            {featured.map((it) => <ListingCard key={it.id} item={it} />)}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>Anúncios recentes</h2>
          <Link to="/buscar">Ver todos</Link>
        </div>
        {!recent.length ? (
          <div className="grid">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="card skeleton" aria-hidden="true">
                <div className="thumb" />
              </div>
            ))}
          </div>
        ) : (
          <ListingCarousel items={recent} />
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Catiras que estão rolando</h2>
          <Link to="/catiras">Ver catiras</Link>
        </div>
        <div className="grid">
          {trades.map((it) => <ListingCard key={it.id} item={it} />)}
        </div>
      </section>

      {wants.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Alguém procura</h2>
            <Link to="/buscar?type=procuro">Ver procura</Link>
          </div>
          <div className="want-list">
            {wants.map((it) => (
              <Link key={it.id} to={productPath(it)} className="want-card">
                <span className="badge-want">PROCURO</span>
                <strong>{it.title}</strong>
                <div>Até {money(it.price)}</div>
                <div className="meta">{it.city}/MG</div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {ranking.length > 0 && (
        <section className="section" style={{ paddingBottom: 24 }}>
          <div className="section-head">
            <h2>Maiores anunciantes</h2>
            <Link to="/ranking">Ver ranking</Link>
          </div>
          {ranking.map((u) => (
            <Link key={u.id} to={'/usuario/' + u.id} className="rank-row">
              <span className={'rank-pos' + (u.rank <= 3 ? ' top' : '')}>{u.rank}</span>
              <div className="avatar" style={{ background: u.avatarColor }}>{u.name.slice(0, 1)}</div>
              <div className="rank-info">
                <strong>{u.name}</strong>
                <div className="hint">{u.published} anúncios · {u.score} pts</div>
              </div>
            </Link>
          ))}
        </section>
      )}
    </>
  );
}
