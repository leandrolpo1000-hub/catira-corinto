import { useEffect, useState } from 'react';
import { api, money } from '../api';
import { PhotoGallery, Top } from '../components';

export default function OwnResale() {
  const [items, setItems] = useState([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    api('/api/lance/own-resale').then((d) => setItems(d.items || [])).catch((e) => setErr(e.message));
  }, []);

  return (
    <>
      <Top back title="Oportunidades próprias" />
      <div className="page">
        <h1>Catira — Oportunidades Próprias</h1>
        <p className="lead">Só aparece item que a Catira já comprou de verdade. Compra própria está desligada até a regularização.</p>
        {err && <div className="error">{err}</div>}
        {!items.length && <p className="empty">Nenhum produto próprio à venda agora.</p>}
        {items.map((it) => (
          <article key={it.id} className="opp-card">
            <PhotoGallery images={it.images} alt={it.title} />
            <span className="status published">Vendido pela Catira</span>
            <h3>{it.title}</h3>
            <div className="price">{money(it.resalePrice)}</div>
            <p className="hint">{it.city} · {it.condition}</p>
            <p className="hint">{it.sellerLabel}</p>
          </article>
        ))}
      </div>
    </>
  );
}
