export function compressImage(file) {
  return new Promise((resolve, reject) => {
    if (file && file.type === 'image/jpeg' && file.size < 300 * 1024) {
      resolve(file);
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1280;
      let w = img.width;
      let h = img.height;
      if (w > max || h > max) {
        if (w > h) {
          h = Math.round((h * max) / w);
          w = max;
        } else {
          w = Math.round((w * max) / h);
          h = max;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          if (!blob) return reject(new Error('Falha ao compactar a foto.'));
          const name = (file.name || 'foto').replace(/\.\w+$/, '') + '.jpg';
          resolve(new File([blob], name, { type: 'image/jpeg' }));
        },
        'image/jpeg',
        0.72
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Arquivo de imagem inválido.'));
    };
    img.src = url;
  });
}

export async function compressImages(files, room) {
  const sliced = [...files].filter((f) => f && f.type && f.type.startsWith('image/')).slice(0, Math.max(0, room));
  const compact = await Promise.all(sliced.map((f) => compressImage(f)));
  return compact.map((file) => ({ file, preview: URL.createObjectURL(file) }));
}

export function revokePreviews(photos) {
  (photos || []).forEach((p) => {
    if (p && p.file && p.preview) URL.revokeObjectURL(p.preview);
  });
}
