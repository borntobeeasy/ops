const PROXY_PREFIX = 'https://r.jina.ai/http://';

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function humanizeSlug(slug) {
  return (slug || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function normalizePlayerUrl(rawUrl) {
  const value = (rawUrl || '').trim();
  if (!value) return null;

  let candidate = value;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    if (!/(\.|^)futbin\.com$/i.test(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildFallbackImport(pageUrl) {
  let fallbackName = '';
  try {
    const parsed = new URL(pageUrl);
    const parts = parsed.pathname.split('/').filter(Boolean);
    fallbackName = humanizeSlug(parts.find((part) => /-/.test(part)) || '');
  } catch {}

  return {
    name: fallbackName,
    imageUrl: '',
    cardType: '',
    price: null,
    priceRange: '',
    priceRaw: '',
    pageUrl,
    timestamp: Date.now()
  };
}

function parseFutbinProxyText(text, pageUrl) {
  const lines = (text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const headingLine = lines.find((line) => line.startsWith('# ')) || '';
  const headingMatch = headingLine.match(/^#\s+(.*?)\s+-\s+(.*?)\s+EA FC\s+\d+\s+Prices/i);
  const nameFromHeading = headingMatch ? headingMatch[1].trim() : '';
  const cardType = headingMatch ? headingMatch[2].trim() : '';

  const trendIndex = lines.findIndex((line) => /^Trend:/i.test(line));
  const nearby = trendIndex >= 0 ? lines.slice(trendIndex, trendIndex + 20) : [];
  const priceLine = nearby.find((line) => /^\d[\d,.]*$/.test(line.replace(/\s/g, ''))) || '';
  const price = priceLine ? Number(priceLine.replace(/[^0-9]/g, '')) : null;
  const priceRangeLabelIndex = nearby.findIndex((line) => /PRICE RANGE:/i.test(line));
  const priceRange = priceRangeLabelIndex >= 0 && nearby[priceRangeLabelIndex + 1]
    ? nearby[priceRangeLabelIndex + 1].replace(/\s+/g, ' ').trim()
    : '';

  const fallback = buildFallbackImport(pageUrl);

  return {
    ...fallback,
    name: nameFromHeading || fallback.name,
    cardType,
    price: Number.isFinite(price) ? price : null,
    priceRange,
    priceRaw: priceLine || ''
  };
}

function extractFutbinCardImageUrl(html) {
  const source = html || '';
  const matches = [...source.matchAll(/https:\/\/cdn\.futbin\.com\/content\/fifa26\/img\/players\/[^\s"'`)>]+?\.(?:png|webp)/ig)]
    .map((match) => match[0]);
  return [...new Set(matches)][0] || '';
}

async function fetchProxyText(targetUrl) {
  const proxyUrl = `${PROXY_PREFIX}${targetUrl.replace(/^https?:\/\//i, '')}`;
  const response = await fetch(proxyUrl);
  if (!response.ok) {
    throw new Error(`Upstream request failed with ${response.status}`);
  }
  return response.text();
}

async function importPlayer(url) {
  const pageUrl = url.toString();
  const fallback = buildFallbackImport(pageUrl);

  let parsed = { ...fallback };
  try {
    const text = await fetchProxyText(pageUrl);
    parsed = { ...parsed, ...parseFutbinProxyText(text, pageUrl) };
    const imageUrl = extractFutbinCardImageUrl(text);
    if (imageUrl) parsed.imageUrl = imageUrl;
  } catch (error) {
    console.warn('Player import warning:', error.message);
  }

  return parsed;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;

  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const payload = await readJsonBody(req);
    const parsedUrl = normalizePlayerUrl(payload.url);

    if (!parsedUrl) {
      sendJson(res, 400, { error: 'Please provide a valid FUTBIN player link.' });
      return;
    }

    const imported = await importPlayer(parsedUrl);
    if (!imported.name) {
      sendJson(res, 422, { error: 'Player data could not be extracted from the link.' });
      return;
    }

    sendJson(res, 200, imported);
  } catch (error) {
    console.error('Import endpoint failed:', error);
    sendJson(res, 500, { error: 'Import failed.' });
  }
};
