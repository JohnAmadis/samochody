const fs = require('fs/promises');
const path = require('path');
const axios = require('axios');

function getImageDir() {
  return process.env.IMAGE_DIR || path.join(process.cwd(), 'data/images');
}

function extensionFromUrl(url) {
  const clean = url.split('?')[0].toLowerCase();
  if (clean.endsWith('.png')) return 'png';
  if (clean.endsWith('.webp')) return 'webp';
  if (clean.endsWith('.jpeg')) return 'jpeg';
  return 'jpg';
}

async function downloadImage(url, destinationPath) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 20000,
    maxRedirects: 5
  });

  await fs.writeFile(destinationPath, response.data);
}

async function saveImagesLocally(listingId, imageUrls = []) {
  if (!imageUrls.length) return [];

  const baseDir = getImageDir();
  const listingDir = path.join(baseDir, String(listingId));
  await fs.mkdir(listingDir, { recursive: true });

  const results = [];

  for (let index = 0; index < imageUrls.length; index += 1) {
    const imageUrl = imageUrls[index];
    const ext = extensionFromUrl(imageUrl);
    const filename = `${index + 1}.${ext}`;
    const localAbsolute = path.join(listingDir, filename);
    const localRelative = `/images/${listingId}/${filename}`;

    try {
      await downloadImage(imageUrl, localAbsolute);
      results.push({
        originalUrl: imageUrl,
        localPath: localRelative,
        sortOrder: index
      });
    } catch {
      results.push({
        originalUrl: imageUrl,
        localPath: null,
        sortOrder: index
      });
    }
  }

  return results;
}

module.exports = {
  saveImagesLocally
};
