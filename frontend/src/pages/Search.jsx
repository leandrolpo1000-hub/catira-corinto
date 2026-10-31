import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, formatBRLInput, parseBRL, listingTypes } from '../api';
import { Empty, HomeAdBanner, ListingCard, SearchBox, Top } from '../components';
import { useCity } from '../city';

const PAGE_SIZE = 24;

export default function Search() {
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') || '');
  const [cats, setCats] = useState([]);
  const [cities, setCities] = useState([]);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const { city, setCity } = useCity();

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
        setTotal(d.total || 0);
      })
      .catch(() => {
        setItems([]);
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

  return (
    <>
      <Top title="Buscar" back />
      <div className="page" style={{ paddingTop: 8 }}>
        <SearchBox value={q} onChange={setQ} onSubmit={(term) => apply({ q: term })} />
        <HomeAdBanner />
        <div className="chips" style={{ marginTop: 12 }}>
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
        {!items.length && !loading && <Empty title="Nada por aqui" text="Tente outra busca ou categoria." />}
        <div className="grid">
          {items.map((it) => <ListingCard key={it.id} item={it} />)}
        </div>
        {items.length < total && (
          <button className="btn btn-ghost" style={{ marginTop: 16 }} disabled={loading} onClick={loadMore}>
            {loading ? 'Carregando...' : 'Ver mais anúncios'}
          </button>
        )}
      </div>
    </>
  );
}
