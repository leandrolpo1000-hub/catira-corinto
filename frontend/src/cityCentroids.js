export const CITY_CENTROIDS = [
  { name: 'Corinto', id: 'corinto', lat: -18.378, lng: -44.456 },
  { name: 'Curvelo', id: 'curvelo', lat: -18.757, lng: -44.431 },
  { name: 'Três Marias', id: 'tres-marias', lat: -18.206, lng: -45.233 },
  { name: 'Felixlândia', id: 'felixlandia', lat: -18.758, lng: -44.9 },
  { name: 'Abaeté', id: 'abaete', lat: -19.16, lng: -45.452 },
  { name: 'Martinho Campos', id: 'martinho-campos', lat: -19.332, lng: -45.243 },
  { name: 'Morro da Garça', id: 'morro-da-garca', lat: -18.548, lng: -44.603 },
  { name: 'Santo Hipólito', id: 'santo-hipolito', lat: -18.305, lng: -44.211 },
  { name: 'Monjolos', id: 'monjolos', lat: -18.325, lng: -44.119 },
  { name: 'Augusto de Lima', id: 'augusto-de-lima', lat: -18.107, lng: -44.265 },
  { name: 'Inimutaba', id: 'inimutaba', lat: -18.73, lng: -44.358 },
  { name: 'Presidente Juscelino', id: 'presidente-juscelino', lat: -18.637, lng: -44.078 },
  { name: 'Lassance', id: 'lassance', lat: -17.887, lng: -44.574 },
  { name: 'Buenópolis', id: 'buenopolis', lat: -17.874, lng: -44.18 },
  { name: 'Joaquim Felício', id: 'joaquim-felicio', lat: -17.758, lng: -44.173 },
  { name: 'Gouveia', id: 'gouveia', lat: -18.454, lng: -43.741 },
  { name: 'Várzea da Palma', id: 'varzea-da-palma', lat: -17.598, lng: -44.731 },
  { name: 'Diamantina', id: 'diamantina', lat: -18.244, lng: -43.6 },
  { name: 'Paraopeba', id: 'paraopeba', lat: -19.275, lng: -44.404 },
  { name: 'Santana de Pirapama', id: 'santana-de-pirapama', lat: -19.006, lng: -44.042 },
  { name: 'Morada Nova de Minas', id: 'morada-nova-de-minas', lat: -18.601, lng: -45.357 },
  { name: 'Pompéu', id: 'pompeu', lat: -19.225, lng: -45.01 },
  { name: 'Cordisburgo', id: 'cordisburgo', lat: -19.125, lng: -44.322 },
  { name: 'Jequitaí', id: 'jequitai', lat: -17.236, lng: -44.446 },
  { name: 'Datas', id: 'datas', lat: -18.446, lng: -43.656 },
  { name: 'Presidente Kubitschek', id: 'presidente-kubitschek', lat: -18.614, lng: -43.562 },
  { name: 'São Gonçalo do Abaeté', id: 'sao-goncalo-do-abaete', lat: -18.344, lng: -45.832 },
  { name: 'Paineiras', id: 'paineiras', lat: -18.904, lng: -45.532 },
  { name: 'Biquinhas', id: 'biquinhas', lat: -18.775, lng: -45.502 },
  { name: 'Dores do Indaiá', id: 'dores-do-indaia', lat: -19.463, lng: -45.602 },
  { name: 'Luz', id: 'luz', lat: -19.801, lng: -45.686 },
  { name: 'Bom Despacho', id: 'bom-despacho', lat: -19.736, lng: -45.252 },
  { name: 'Quartel Geral', id: 'quartel-geral', lat: -19.27, lng: -45.557 },
  { name: 'Cedro do Abaeté', id: 'cedro-do-abaete', lat: -19.145, lng: -45.712 },
];

function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function nearestCity(lat, lng, maxKm = 80) {
  let best = null;
  let bestKm = Infinity;
  CITY_CENTROIDS.forEach((c) => {
    const km = haversineKm(lat, lng, c.lat, c.lng);
    if (km < bestKm) {
      bestKm = km;
      best = c;
    }
  });
  if (!best || bestKm > maxKm) return { name: null, id: null, km: bestKm, zone: 'fora' };
  return { name: best.name, id: best.id, km: bestKm };
}
