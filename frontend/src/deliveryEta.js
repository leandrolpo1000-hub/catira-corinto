import { CITY_CENTROIDS } from './cityCentroids.js';

export const REGION_CITY_NAMES = CITY_CENTROIDS.map((c) => c.name);

export function deliveryZone(cityName) {
  const n = String(cityName || '').trim();
  if (!n) return 'fora';
  return REGION_CITY_NAMES.includes(n) ? 'regiao' : 'fora';
}

export function deliveryEta(cityName) {
  const zone = deliveryZone(cityName);
  if (zone === 'regiao') {
    const city = String(cityName).trim();
    return {
      zone,
      city,
      daysLabel: '2 a 5 dias úteis',
      label: 'Chega em 2 a 5 dias úteis em ' + city,
    };
  }
  return {
    zone: 'fora',
    city: String(cityName || '').trim(),
    daysLabel: '5 a 12 dias úteis',
    label: 'Chega em 5 a 12 dias úteis',
  };
}
