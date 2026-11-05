export function productPath(item) {
  if (item && item.isOfficial && item.id) return '/produto/' + item.id;
  return '/anuncio/' + ((item && item.id) || '');
}
