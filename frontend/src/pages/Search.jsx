import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, formatBRLInput, parseBRL, listingTypes } from '../api';
import { AccountButton, BrandLogo, CityChip, Empty, HomeAdBanner, ListingCard, ListingFeedCard, NeedAuth, SearchBox, Top, VoiceFab } from '../components';
import { useCity } from '../city';
import { useAuth } from '../auth';
import { Ico } from '../icons';
import { CommentsSheet } from '../CommentsSheet';

const PAGE_SIZE = 24;
const VIEW_KEY = 'catira.searchView';

function readView() {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'feed' ? 'feed' : 'grid';
  } catch {
    return 'grid';
  }
}

export default function Search() {
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') || '');
  const [cats, setCats] = useState([]);
  const [cities, setCities] = useState([]);
  const [items, setItems] = useState([]);
  const [sellers, setSellers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(readView);
  const [openItem, setOpenItem] = useState(null);
  const [reportFor, setReportFor] = useState(null);
  const [reason, setReason] = useState('golpe');
  const [desc, setDesc] = useState('');
  const { city, setCity } = useCity();
  const { user } = useAuth();

  const filters = {
    q: sp.get('q') || '',
    category: sp.get('category') || '',
    city: sp.get('city') || city || '',
    minPrice: sp.get('minPrice') || '',
    maxPrice: sp.get('maxPrice') || '',
    condition: sp.get('condition') || '',
    acceptsTrade: sp.get('acceptsTrade') || '',
    type: sp.get('type') || '',
    sort: sp.get('sort') || '',
  };

  function queryString(nextPage) {
    const qs = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (!v) return;
      if (k === 'minPrice' || k === 'maxPrice') {
        const n = parseBRL(v);
        if (n > 0) qs.set(k, String(n));
        return;
      }
      qs.set(k, v);
    });
    qs.set('page', String(nextPage));
    qs.set('limit', String(PAGE_SIZE));
    return qs.toString();
  }

  function setViewMode(next) {
    setView(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch {}
  }

  function patchItem(next) {
    setItems((prev) => prev.map((it) => (it.id === next.id ? { ...it, ...next } : it)));
    setOpenItem((cur) => (cur && cur.id === next.id ? { ...cur, ...next } : cur));
  }

  useEffect(() => {
    api('/api/categories').then(setCats).catch(() => {});
    api('/api/auth/cities').then(setCities).catch(() => {});
  }, []);

  useEffect(() => {
    setQ(filters.q);
    setPage(1);
    setLoading(true);
    api('/api/listings?' + queryString(1))
      .then((d) => {
        setItems(d.items || []);
        setSellers(d.sellers || []);
        setTotal(d.total || 0);
      })
      .catch(() => {
        setItems([]);
        setSellers([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [sp.toString()]);

  async function loadMore() {
    const next = page + 1;
    setLoading(true);
    try {
      const d = await api('/api/listings?' + queryString(next));
      setItems((prev) => prev.concat(d.items || []));
      setTotal(d.total || 0);
      setPage(next);
    } catch {
      /* keep current list */
    }
    setLoading(false);
  }

  function apply(patch) {
    const next = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => {
      if (v) next.set(k, v);
      else next.delete(k);
    });
    setSp(next);
  }

  async function sendReport() {
    if (!reportFor) return;
    try {
      await api('/api/reports', {
        method: 'POST',
        body: JSON.stringify({ listingId: reportFor.id, reason, description: desc }),
      });
      setReportFor(null);
      setDesc('');
    } catch {}
  }

  return (
    <div className="search-screen">
      <div className="search-body">
        <header className="search-top">
          <Link to="/" className="brand-link" aria-label="Início">
            <BrandLogo size="sm" />
          </Link>
          <div className="search-top-actions">
            <CityChip />
            <AccountButton />
          </div>
        </header>
        <div className="search-view-switch" role="tablist" aria-label="Modo de visualização">
          <button type="button" role="tab" className={view === 'grid' ? 'on' : ''} aria-selected={view === 'grid'} onClick={() => setViewMode('grid')}>
            <Ico name="grid" size={18} />
            Mosaico
          </button>
          <button type="button" role="tab" className={view === 'feed' ? 'on' : ''} aria-selected={view === 'feed'} onClick={() => setViewMode('feed')}>
            <Ico name="rows" size={18} />
            Feed
          </button>
        </div>
        <div className="search-head-tools">
          <SearchBox value={q} onChange={setQ} onSubmit={(term) => apply({ q: term })} />
          <div className="chips">
            <button className="chip" onClick={() => setOpen(!open)}>Filtros</button>
            {listingTypes.map((t) => (
              <button
                key={t.id}
                className={'chip' + (filters.type === t.id ? ' on' : '')}
                onClick={() => apply({ type: filters.type === t.id ? '' : t.id, sort: '' })}
              >
                {t.label}
              </button>
            ))}
            <button className={'chip' + (filters.sort === 'recent' ? ' on' : '')} onClick={() => apply({ sort: filters.sort === 'recent' ? '' : 'recent', type: '' })}>Mais recentes</button>
            <button className={'chip' + (filters.sort === 'views' ? ' on' : '')} onClick={() => apply({ sort: filters.sort === 'views' ? '' : 'views', type: '' })}>Mais vistos</button>
            <button className={'chip' + (filters.sort === 'price_asc' ? ' on' : '')} onClick={() => apply({ sort: filters.sort === 'price_asc' ? '' : 'price_asc', type: '' })}>Menor preço</button>
            <button className={'chip' + (filters.sort === 'price_desc' ? ' on' : '')} onClick={() => apply({ sort: filters.sort === 'price_desc' ? '' : 'price_desc', type: '' })}>Maior preço</button>
          </div>
        </div>
        {open && (
          <div className="filters">
            <div className="field">
              <label>Categoria</label>
              <select value={filters.category} onChange={(e) => apply({ category: e.target.value })}>
                <option value="">Todas</option>
                {cats.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Cidade</label>
              <select value={filters.city} onChange={(e) => { setCity(e.target.value); apply({ city: e.target.value }); }}>
                <option value="">Todas</option>
                {cities.map((c) => <option key={c.id || c.name} value={c.name}>{c.name}{c.state ? '/' + c.state : ''}</option>)}
              </select>
            </div>
            <div className="grid2">
              <div className="field"><label>Preço mín.</label><input value={filters.minPrice} onChange={(e) => apply({ minPrice: formatBRLInput(e.target.value) })} inputMode="numeric" placeholder="0,00" /></div>
              <div className="field"><label>Preço máx.</label><input value={filters.maxPrice} onChange={(e) => apply({ maxPrice: formatBRLInput(e.target.value) })} inputMode="numeric" placeholder="0,00" /></div>
            </div>
            <div className="field">
              <label>Tipo</label>
              <select value={filters.type} onChange={(e) => apply({ type: e.target.value, sort: '' })}>
                <option value="">Todos</option>
                {listingTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Condição</label>
              <select value={filters.condition} onChange={(e) => apply({ condition: e.target.value })}>
                <option value="">Qualquer</option>
                <option value="novo">Novo</option>
                <option value="seminovo">Seminovo</option>
                <option value="usado">Usado</option>
              </select>
            </div>
          </div>
        )}
        <HomeAdBanner />
        {!items.length && !loading && <Empty title="Nada por aqui" text="Tente outra busca ou categoria." />}
        {view === 'grid' ? (
          <div className="grid">
            {items.map((it) => <ListingCard key={it.id} item={it} />)}
          </div>
        ) : (
          <div className="search-feed">
            {items.map((it) => (
              <ListingFeedCard
                key={it.id}
                item={it}
                user={user}
                onChange={patchItem}
                onOpenComments={setOpenItem}
                onReport={user ? setReportFor : null}
              />
            ))}
          </div>
        )}
        {items.length < total && (
          <button className="btn btn-ghost" style={{ marginTop: 16 }} disabled={loading} onClick={loadMore}>
            {loading ? 'Carregando...' : 'Ver mais anúncios'}
          </button>
        )}
        {!!sellers.length && (
          <section className="search-sellers">
            <h2>Anunciantes</h2>
            <div className="search-sellers-list">
              {sellers.map((s) => (
                <Link key={s.id} to={'/usuario/' + s.id} className="search-seller">
                  <span className="avatar sm" style={{ background: s.avatarColor }}>{s.name.slice(0, 1)}</span>
                  <span className="search-seller-info">
                    <strong>{s.name}</strong>
                    <span className="hint">
                      {s.listingsCount} {s.listingsCount === 1 ? 'anúncio' : 'anúncios'}{s.city ? ' · ' + s.city : ''}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
      {openItem && (
        <CommentsSheet
          subject={{ id: openItem.id, author: openItem.seller, commentCount: openItem.commentCount }}
          user={user}
          base={'/api/listings/' + openItem.id}
          loginNext="/buscar"
          onClose={() => setOpenItem(null)}
          onChange={patchItem}
        />
      )}
      <VoiceFab onChange={setQ} onSubmit={(term) => apply({ q: term })} />
      {reportFor && (
        <div className="modal-bg" onClick={() => setReportFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Denunciar anúncio</h3>
            <div className="field">
              <label>Motivo</label>
              <select value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="golpe">Suspeita de golpe</option>
                <option value="falso">Conteúdo falso</option>
                <option value="inadequado">Inadequado</option>
                <option value="enganoso">Enganoso</option>
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
    </div>
  );
}

export function SearchNotices() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (!user) return;
    api('/api/listings/notices').then((d) => setItems(d.items || [])).catch(() => {});
    api('/api/listings/notices/read', { method: 'POST' }).catch(() => {});
  }, [user]);
  if (!user) return <NeedAuth next="/buscar/avisos" />;
  return (
    <>
      <Top back title="Avisos" />
      <div className="page">
        <h1>Avisos dos anúncios</h1>
        {!items.length && <Empty title="Nenhum aviso" text="Quando alguém curtir ou comentar seu anúncio, aparece aqui." to="/buscar" cta="Ver busca" />}
        {items.map((n) => (
          <Link key={n.id} to="/buscar" className={'list-item acao-notice' + (n.read ? '' : ' unread')}>
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
