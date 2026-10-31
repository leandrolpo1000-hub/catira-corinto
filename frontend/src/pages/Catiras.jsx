import { useEffect, useState } from 'react';
import { api } from '../api';
import { Empty, ListingCard, Top } from '../components';
import { useCity } from '../city';

const PAGE_SIZE = 24;

export default function Catiras() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const { city, cityQuery } = useCity();

  function listUrl(nextPage) {
    return '/api/listings?trade=true&limit=' + PAGE_SIZE + '&page=' + nextPage + (cityQuery() ? '&' + cityQuery() : '');
  }

  useEffect(() => {
    setLoading(true);
    setPage(1);
    api(listUrl(1))
      .then((d) => {
        setItems(d.items || []);
        setTotal(d.total || 0);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [city]);

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

  return (
    <>
      <Top title="Catiras" back />
      <div className="page">
        <h1>Catiras rolando</h1>
        <p className="lead">Só anúncios que aceitam troca. O diferencial da cidade.</p>
        {!items.length && !loading && <Empty title="Nenhuma catira agora" text="Publique um anúncio aceitando troca." to="/anunciar" cta="Anunciar" />}
        <div className="grid">{items.map((it) => <ListingCard key={it.id} item={it} />)}</div>
        {items.length < total && (
          <button className="btn btn-ghost" style={{ marginTop: 16 }} disabled={loading} onClick={loadMore}>
            {loading ? 'Carregando...' : 'Ver mais catiras'}
          </button>
        )}
      </div>
    </>
  );
}
