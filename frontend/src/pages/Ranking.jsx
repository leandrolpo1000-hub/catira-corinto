import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Empty, Top } from '../components';

export default function Ranking() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    api('/api/ranking?limit=50').then((d) => setItems(d.items || [])).catch(() => setItems([]));
  }, []);

  return (
    <>
      <Top back title="Ranking" />
      <div className="page">
        <h1>Maiores anunciantes</h1>
        <p className="lead">Pontos por anúncios ativos, vendas, avaliações, favoritos e visualizações.</p>
        {!items.length && <Empty title="Ranking vazio" text="Publique um anúncio para entrar na lista." to="/anunciar" cta="Anunciar" />}
        {items.map((u) => (
          <Link key={u.id} to={'/usuario/' + u.id} className="rank-row">
            <span className={'rank-pos' + (u.rank <= 3 ? ' top' : '')}>{u.rank}</span>
            <div className="avatar" style={{ background: u.avatarColor }}>{u.name.slice(0, 1)}</div>
            <div className="rank-info">
              <strong>{u.name}</strong>
              <div className="hint">{u.city} · {u.published} anúncios{u.sold ? ' · ' + u.sold + ' vendidos' : ''}</div>
            </div>
            <span className="rank-pts">{u.score} pts</span>
          </Link>
        ))}
      </div>
    </>
  );
}
