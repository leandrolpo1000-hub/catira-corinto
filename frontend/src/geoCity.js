import { nearestCity } from './cityCentroids.js';
import { REGION_CITY_NAMES } from './deliveryEta.js';

const KEY = 'catira_geo_city';

function isPersistableCity(city) {
  return city === 'fora' || REGION_CITY_NAMES.includes(city);
}

function readStored(storage) {
  try {
    const v = storage && storage.getItem(KEY);
    if (v && isPersistableCity(v)) return v;
  } catch {}
  return '';
}

function writeStored(storage, city) {
  try {
    if (storage && city && isPersistableCity(city)) storage.setItem(KEY, city);
  } catch {}
}

function gpsOnce(geolocation) {
  if (!geolocation || typeof geolocation.getCurrentPosition !== 'function') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const t = setTimeout(() => finish(null), 6000);
    try {
      geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(t);
          const lat = pos && pos.coords && pos.coords.latitude;
          const lng = pos && pos.coords && pos.coords.longitude;
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return finish(null);
          const hit = nearestCity(lat, lng, 80);
          finish(hit && hit.name ? hit.name : 'fora');
        },
        () => {
          clearTimeout(t);
          finish(null);
        },
        { timeout: 6000, maximumAge: 30 * 60 * 1000, enableHighAccuracy: false }
      );
    } catch {
      clearTimeout(t);
      finish(null);
    }
  });
}

export async function resolveGeoCity({ geolocation, storage, fallbackCity } = {}) {
  const stored = readStored(storage);
  if (stored) return stored;
  const fromGps = await gpsOnce(geolocation);
  if (fromGps === 'fora') {
    writeStored(storage, 'fora');
    return 'fora';
  }
  if (fromGps) {
    writeStored(storage, fromGps);
    return fromGps;
  }
  const chip = String(fallbackCity || '').trim();
  if (chip) return chip;
  return 'Corinto';
}
