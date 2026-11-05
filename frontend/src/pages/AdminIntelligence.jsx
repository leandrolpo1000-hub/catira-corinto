import { useEffect, useState } from 'react';
import { api, money } from '../api';

function Bars({ data, valueKey, green }) {
  const max = Math.max(1, ...data.map((d) => d[valueKey] || 0));
  return (
    <div>
      <div className={'bars' + (green ? ' green' : '')}>
        {data.map((d, i) => (
          <div key={i} className="bar" style={{ height: ((d[valueKey] || 0) / max) * 100 + '%' }} />
        ))}
      </div>
      <div className="bar-lab">
        <span>{data[0] && (data[0].date || data[0].month || '')}</span>
        <span>{data.at(-1) && (data.at(-1).date || data.at(-1).month || '')}</span>
      </div>
    </div>
  );
}

const SUBS = [
  ['visao', 'Visão geral'],
  ['produtos', 'Produtos'],
  ['pesquisas', 'Pesquisas'],
  ['categorias', 'Categorias'],
  ['demanda', 'Demanda e oferta'],
  ['geo', 'Geografia'],
  ['precos', 'Preços'],
  ['tendencias', 'Tendências'],
  ['oportunidades', 'Oportunidades'],
  ['config', 'Configurações'],
];

const FLAG_ROWS = [
  ['intelligenceEnabled', 'Coleta de eventos'],
  ['internalAnalyticsEnabled', 'Indicadores internos'],
  ['commercialIntelligenceEnabled', 'Inteligência comercial'],
  ['merchantIntelligenceAccessEnabled', 'Acesso de comerciante'],
  ['intelligenceSubscriptionsEnabled', 'Assinaturas'],
  ['intelligenceApiEnabled', 'API comercial'],
];

function RankTable({ rows, columns }) {
  if (!rows || !rows.length) return <p className="hint">Ainda sem dados neste período.</p>;
  return (
    <table className="table">
      <thead>
        <tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.listingId || r.query || r.categoryId || r.city || r.id || i}>
            {columns.map((c) => <td key={c.key}>{c.render ? c.render(r) : r[c.key]}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function AdminIntelligence({ dash, dashFilter, setDashFilter, dashCities, cats }) {
  const [sub, setSub] = useState('visao');
  const [settings, setSettings] = useState(null);
  const [saveMsg, setSaveMsg] = useState('');
  const [saveErr, setSaveErr] = useState('');

  useEffect(() => {
    api('/api/admin/intelligence/settings').then(setSettings).catch(() => {});
  }, []);

  const s = (dash && dash.stats) || {};
  const intel = (dash && dash.intelligence) || {};
  const is = intel.stats || {};
  const rankings = intel.rankings || {};
  const charts = (dash && dash.charts) || {};

  async function saveFlags(patch) {
    setSaveErr('');
    setSaveMsg('');
    const next = { ...(settings || {}), ...patch };
    setSettings(next);
    try {
      const d = await api('/api/admin/intelligence/settings', { method: 'PUT', body: JSON.stringify(patch) });
      setSettings(d);
      setSaveMsg('Configurações salvas.');
    } catch (e) {
      setSaveErr(e.message || 'Não foi possível salvar.');
    }
  }

  return (
    <>
      <div className="dash-filters">
        <div className="field">
          <label>Período</label>
          <select value={dashFilter.period} onChange={(e) => setDashFilter({ ...dashFilter, period: e.target.value })}>
            <option value="7d">7 dias</option>
            <option value="30d">30 dias</option>
            <option value="month">Este mês</option>
            <option value="year">Este ano</option>
            <option value="all">Tudo</option>
          </select>
        </div>
        <div className="field">
          <label>Cidade</label>
          <select value={dashFilter.city} onChange={(e) => setDashFilter({ ...dashFilter, city: e.target.value })}>
            <option value="">Todas</option>
            {(dashCities || []).map((c) => (
              <option key={c.id || c.name} value={c.name}>{c.name}{c.state ? '/' + c.state : ''}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Status</label>
          <select value={dashFilter.status} onChange={(e) => setDashFilter({ ...dashFilter, status: e.target.value })}>
            <option value="">Todos</option>
            <option value="published">Publicados</option>
            <option value="awaiting_payment">Aguardando pagamento</option>
            <option value="awaiting_confirmation">Aguardando confirmação</option>
            <option value="sold">Vendidos</option>
            <option value="traded">Trocados</option>
            <option value="negotiated">Negociados</option>
            <option value="paused">Pausados</option>
            <option value="expired">Expirados</option>
            <option value="cancelled">Encerrados</option>
          </select>
        </div>
        <div className="field">
          <label>Categoria</label>
          <select value={dashFilter.category || ''} onChange={(e) => setDashFilter({ ...dashFilter, category: e.target.value })}>
            <option value="">Todas</option>
            {(cats || []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="chips">
        {SUBS.map(([k, l]) => (
          <button key={k} className={'chip' + (sub === k ? ' on' : '')} onClick={() => setSub(k)}>{l}</button>
        ))}
      </div>

      {sub === 'visao' && (
        <>
          <div className="admin-grid">
            <div className="stat"><b>{s.usersTotal || s.users || 0}</b><span>Usuários cadastrados</span></div>
            <div className="stat"><b>{s.listingsTotal || s.listingsPublished || 0}</b><span>Total de anúncios</span></div>
            <div className="stat"><b>{s.listingsPublished || 0}</b><span>Anúncios ativos</span></div>
            <div className="stat"><b>{s.sold || s.deals || 0}</b><span>Marcados vendidos</span></div>
            <div className="stat"><b>{s.vipListings || 0}</b><span>Anúncios em destaque</span></div>
            <div className="stat"><b>{money(s.revenue)}</b><span>Receita</span></div>
            <div className="stat"><b>{s.reportsOpen || 0}</b><span>Denúncias pendentes</span></div>
            <div className="stat"><b>{s.views || 0}</b><span>Visualizações</span></div>
          </div>
          <div className="admin-grid">
            <div className="stat"><b>{is.searches || 0}</b><span>Buscas</span></div>
            <div className="stat"><b>{is.emptySearches || 0}</b><span>Buscas vazias</span></div>
            <div className="stat"><b>{is.views || 0}</b><span>Views</span></div>
            <div className="stat"><b>{is.uniqueViewers || 0}</b><span>Visitantes únicos</span></div>
            <div className="stat"><b>{is.favorites || 0}</b><span>Favoritos</span></div>
            <div className="stat"><b>{is.shares || 0}</b><span>Compartilhamentos</span></div>
            <div className="stat"><b>{is.contacts || 0}</b><span>Contatos</span></div>
            <div className="stat"><b>{is.proposals || 0}</b><span>Propostas</span></div>
            <div className="stat"><b>{is.checkouts || 0}</b><span>Checkouts</span></div>
            <div className="stat"><b>{is.ordersCreated || 0}</b><span>Pedidos criados</span></div>
            <div className="stat"><b>{is.paymentsConfirmed || 0}</b><span>Pagamentos confirmados</span></div>
            <div className="stat"><b>{is.salesCompleted || 0}</b><span>Vendas concluídas</span></div>
          </div>
          <div className="chart">
            <strong>Receita diária (7 dias)</strong>
            <Bars data={charts.dailyRevenue || []} valueKey="revenue" />
          </div>
          <div className="chart">
            <strong>Receita mensal</strong>
            <Bars data={charts.monthlyRevenue || []} valueKey="revenue" />
          </div>
          <div className="chart">
            <strong>Novos usuários</strong>
            <Bars data={charts.newUsers || []} valueKey="count" green />
          </div>
          <div className="chart">
            <strong>Quantidade de anúncios</strong>
            <Bars data={charts.listings || []} valueKey="count" green />
          </div>
          <div className="chart">
            <strong>Categorias mais usadas</strong>
            {(charts.topCategories || []).length ? (charts.topCategories || []).map((c) => (
              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                <span>{c.name}</span><b>{c.count}</b>
              </div>
            )) : <p className="hint">Ainda sem dados neste período.</p>}
          </div>
        </>
      )}

      {sub === 'produtos' && (
        <>
          <h2 style={{ fontSize: 18, margin: '8px 0 12px' }}>Produtos</h2>
          <p className="lead">Mais vistos</p>
          <RankTable rows={rankings.viewed} columns={[{ key: 'title', label: 'Anúncio' }, { key: 'count', label: 'Views' }]} />
          <p className="lead">Mais favoritados</p>
          <RankTable rows={rankings.favorited} columns={[{ key: 'title', label: 'Anúncio' }, { key: 'count', label: 'Favoritos' }]} />
          <p className="lead">Mais compartilhados</p>
          <RankTable rows={rankings.shared} columns={[{ key: 'title', label: 'Anúncio' }, { key: 'count', label: 'Shares' }]} />
          <p className="lead">Mais contatados</p>
          <RankTable rows={rankings.contacted} columns={[{ key: 'title', label: 'Anúncio' }, { key: 'count', label: 'Contatos' }]} />
          <p className="lead">Pagamentos confirmados</p>
          <RankTable rows={rankings.soldPaid} columns={[{ key: 'title', label: 'Anúncio' }, { key: 'count', label: 'Pedidos' }]} />
        </>
      )}

      {sub === 'pesquisas' && (
        <>
          <h2 style={{ fontSize: 18, margin: '8px 0 12px' }}>Pesquisas</h2>
          <p className="lead">Termos mais buscados</p>
          <RankTable rows={rankings.queries} columns={[{ key: 'query', label: 'Busca' }, { key: 'count', label: 'Vezes' }]} />
          <p className="lead">Buscas sem resultado</p>
          <RankTable rows={rankings.emptyQueries} columns={[{ key: 'query', label: 'Busca' }, { key: 'count', label: 'Vezes' }]} />
        </>
      )}

      {sub === 'categorias' && (
        <>
          <h2 style={{ fontSize: 18, margin: '8px 0 12px' }}>Categorias</h2>
          <RankTable rows={rankings.categories} columns={[{ key: 'name', label: 'Categoria' }, { key: 'count', label: 'Eventos' }]} />
        </>
      )}

      {sub === 'demanda' && (
        <>
          <h2 style={{ fontSize: 18, margin: '8px 0 12px' }}>Demanda e oferta</h2>
          <RankTable
            rows={intel.offerDemand}
            columns={[
              { key: 'name', label: 'Categoria' },
              { key: 'demand', label: 'Demanda' },
              { key: 'supply', label: 'Oferta' },
            ]}
          />
        </>
      )}

      {sub === 'geo' && (
        <>
          <h2 style={{ fontSize: 18, margin: '8px 0 12px' }}>Geografia</h2>
          <RankTable rows={rankings.cities} columns={[{ key: 'city', label: 'Cidade' }, { key: 'count', label: 'Eventos' }]} />
        </>
      )}

      {sub === 'precos' && (
        <>
          <h2 style={{ fontSize: 18, margin: '8px 0 12px' }}>Preços</h2>
          <RankTable
            rows={intel.priceBuckets}
            columns={[
              { key: 'id', label: 'Faixa' },
              { key: 'count', label: 'Pedidos pagos' },
            ]}
          />
        </>
      )}

      {sub === 'tendencias' && (
        <>
          <h2 style={{ fontSize: 18, margin: '8px 0 12px' }}>Tendências</h2>
          {(intel.series || []).length ? (
            <>
              <div className="chart">
                <strong>Buscas</strong>
                <Bars data={intel.series || []} valueKey="searches" green />
              </div>
              <div className="chart">
                <strong>Views</strong>
                <Bars data={intel.series || []} valueKey="views" green />
              </div>
              <div className="chart">
                <strong>Pedidos</strong>
                <Bars data={intel.series || []} valueKey="orders" />
              </div>
              <div className="chart">
                <strong>Pagamentos</strong>
                <Bars data={intel.series || []} valueKey="paid" />
              </div>
            </>
          ) : (
            <p className="hint">Ainda sem dados neste período.</p>
          )}
        </>
      )}

      {sub === 'oportunidades' && (
        <>
          <h2 style={{ fontSize: 18, margin: '8px 0 12px' }}>Oportunidades</h2>
          <RankTable
            rows={intel.opportunities}
            columns={[
              { key: 'kind', label: 'Tipo' },
              { key: 'label', label: 'Detalhe' },
              { key: 'metric', label: 'Sinal', render: (r) => r.demand || r.count || r.views || 0 },
            ]}
          />
        </>
      )}

      {sub === 'config' && (
        <>
          <h2 style={{ fontSize: 18, margin: '8px 0 12px' }}>Configurações</h2>
          {saveErr && <div className="error">{saveErr}</div>}
          {saveMsg && <div className="okbox">{saveMsg}</div>}
          <div className="fee-toggles">
            {FLAG_ROWS.map(([key, name]) => (
              <label key={key} className={'fee-toggle' + ((settings && settings[key]) ? ' on' : '')}>
                <span className="fee-toggle-info">
                  <strong>{name}</strong>
                </span>
                <input
                  type="checkbox"
                  checked={!!(settings && settings[key])}
                  onChange={(e) => saveFlags({ [key]: e.target.checked })}
                />
              </label>
            ))}
          </div>
          <p className="hint">Desligar a inteligência comercial não apaga o histórico nem para a coleta interna.</p>
          <p className="hint">Planos Start, Pro, Business e Enterprise — em breve. Sem cobrança nesta fase.</p>
        </>
      )}
    </>
  );
}
