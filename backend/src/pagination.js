function pageParams(query, defaults) {
  const max = (defaults && defaults.max) || 50;
  const fallback = (defaults && defaults.limit) || 20;
  const page = Math.max(1, parseInt((query && query.page) || '1', 10) || 1);
  const limit = Math.min(max, Math.max(1, parseInt((query && query.limit) || String(fallback), 10) || fallback));
  return { page, limit, start: (page - 1) * limit };
}

function pageSlice(list, query, defaults) {
  const { page, limit, start } = pageParams(query, defaults);
  const total = list.length;
  return { items: list.slice(start, start + limit), total, page, limit };
}

module.exports = { pageParams, pageSlice };
