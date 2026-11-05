const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const UPLOADS = path.join(__dirname, '..', 'uploads');
const THUMBS = path.join(UPLOADS, 'thumbs');

async function ensureThumb(absOriginalPath, urlPath) {
  if (typeof urlPath === 'string' && /^https?:\/\//i.test(urlPath)) return urlPath;
  try {
    if (!absOriginalPath || !fs.existsSync(absOriginalPath)) return null;
    if (!fs.existsSync(THUMBS)) fs.mkdirSync(THUMBS, { recursive: true });
    const base = path.basename(absOriginalPath, path.extname(absOriginalPath));
    const dest = path.join(THUMBS, base + '.jpg');
    if (!fs.existsSync(dest)) {
      await sharp(absOriginalPath)
        .rotate()
        .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 72 })
        .toFile(dest);
    }
    if (!fs.existsSync(dest)) return null;
    return '/uploads/thumbs/' + base + '.jpg';
  } catch {
    return null;
  }
}

function thumbUrlIfExists(absOriginalPath, urlPath) {
  if (typeof urlPath === 'string' && /^https?:\/\//i.test(urlPath)) return urlPath;
  if (!absOriginalPath) return null;
  const base = path.basename(absOriginalPath, path.extname(absOriginalPath));
  const dest = path.join(THUMBS, base + '.jpg');
  if (fs.existsSync(dest)) return '/uploads/thumbs/' + base + '.jpg';
  return null;
}

function ensureThumbLater(absOriginalPath, urlPath, onDone) {
  ensureThumb(absOriginalPath, urlPath)
    .then((url) => {
      if (onDone && url) onDone(url);
    })
    .catch(() => {});
}

module.exports = { ensureThumb, ensureThumbLater, thumbUrlIfExists, UPLOADS, THUMBS };
