const FUTDB_API_BASE = 'https://api.futdatabase.com/api';
const DEFAULT_PLATFORM = 'playstation';

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function getApiToken() {
  return process.env.FUTDB_API_TOKEN || process.env.FUTDB_API_KEY || '';
}

function buildHeaders() {
  const token = getApiToken();
  if (!token) {
    const error = new Error('FUTDB_API_TOKEN is missing.');
    error.statusCode = 500;
    throw error;
  }

  return {
    'X-AUTH-TOKEN': token,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
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

function normalizeInputUrl(rawUrl) {
  const value = (rawUrl || '').trim();
  if (!value) return null;

  let candidate = value;
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;

  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

function humanizeSlug(slug) {
  return (slug || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function extractLookupData(parsedUrl) {
  const host = parsedUrl.hostname.toLowerCase();
  const path = parsedUrl.pathname.split('/').filter(Boolean);

  if (host.endsWith('futbin.com')) {
    const slug = path[path.length - 1] || '';
    const futBinId = Number(path[path.length - 2]);
    return {
      sourceUrl: parsedUrl.toString(),
      sourceLabel: 'futbin',
      nameQuery: humanizeSlug(slug),
      futBinId: Number.isFinite(futBinId) ? futBinId : null
    };
  }

  if (host.endsWith('futdatabase.com')) {
    const slug = path[path.length - 1] || '';
    return {
      sourceUrl: parsedUrl.toString(),
      sourceLabel: 'futdb',
      nameQuery: humanizeSlug(slug),
      futBinId: null
    };
  }

  return {
    sourceUrl: parsedUrl.toString(),
    sourceLabel: host,
    nameQuery: humanizeSlug(path[path.length - 1] || ''),
    futBinId: null
  };
}

async function futdbFetch(path, options = {}) {
  const response = await fetch(`${FUTDB_API_BASE}${path}`, {
    ...options,
    headers: {
      ...buildHeaders(),
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const error = new Error(text || `FutDB request failed with ${response.status}`);
    error.statusCode = response.status;
    throw error;
  }

  return response.json();
}

function buildSearchBody(lookup) {
  return {
    name: lookup.nameQuery || null
  };
}

function scorePlayerCandidate(player, lookup) {
  if (!player) return -1;

  const candidateName = (player.name || player.commonName || '').toLowerCase().trim();
  const wantedName = (lookup.nameQuery || '').toLowerCase().trim();
  let score = 0;

  if (lookup.futBinId && Number(player.futBinId) === Number(lookup.futBinId)) score += 100;
  if (candidateName === wantedName) score += 40;
  if (candidateName.includes(wantedName) || wantedName.includes(candidateName)) score += 20;
  if (player.rating) score += Number(player.rating) / 100;

  return score;
}

async function findBestPlayer(lookup) {
  const searchResponse = await futdbFetch('/players/search?page=1', {
    method: 'POST',
    body: JSON.stringify(buildSearchBody(lookup))
  });

  const items = Array.isArray(searchResponse.items) ? searchResponse.items : [];
  if (!items.length) return null;

  return items
    .map((player) => ({ player, score: scorePlayerCandidate(player, lookup) }))
    .sort((left, right) => right.score - left.score)[0]
    ?.player || null;
}

async function fetchPlayerPrice(playerId) {
  try {
    const response = await futdbFetch(`/players/${playerId}/price`);
    return response?.[DEFAULT_PLATFORM] || null;
  } catch (error) {
    if (error.statusCode === 401 || error.statusCode === 402 || error.statusCode === 403) {
      return null;
    }
    throw error;
  }
}

function formatPriceRange(priceInfo) {
  if (!priceInfo) return '';
  const min = Number(priceInfo.minPrice);
  const max = Number(priceInfo.maxPrice);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return '';
  return `${min.toLocaleString('en-US')} - ${max.toLocaleString('en-US')}`;
}

function formatCardType(player) {
  const parts = [];
  if (player.rating) parts.push(`${player.rating}`);
  if (player.position) parts.push(player.position);
  if (player.version) parts.push(player.version.toUpperCase());
  return parts.join(' ').trim();
}

function buildPlayerImageUrl(playerId) {
  return `/api/player-image?playerId=${encodeURIComponent(playerId)}`;
}

async function importPlayer(rawUrl) {
  const parsedUrl = normalizeInputUrl(rawUrl);
  if (!parsedUrl) {
    const error = new Error('Please provide a valid player link.');
    error.statusCode = 400;
    throw error;
  }

  const lookup = extractLookupData(parsedUrl);
  if (!lookup.nameQuery) {
    const error = new Error('The player name could not be derived from the link.');
    error.statusCode = 422;
    throw error;
  }

  const player = await findBestPlayer(lookup);
  if (!player || !player.id) {
    const error = new Error('No FutDB player matched this link.');
    error.statusCode = 404;
    throw error;
  }

  const priceInfo = await fetchPlayerPrice(player.id);

  return {
    name: player.name || player.commonName || lookup.nameQuery,
    imageUrl: buildPlayerImageUrl(player.id),
    cardType: formatCardType(player),
    price: Number.isFinite(Number(priceInfo?.price)) ? Number(priceInfo.price) : null,
    priceRange: formatPriceRange(priceInfo),
    priceRaw: Number.isFinite(Number(priceInfo?.price)) ? String(priceInfo.price) : '',
    pageUrl: lookup.sourceUrl,
    playerId: Number(player.id),
    source: 'futdb',
    platform: DEFAULT_PLATFORM,
    lastPriceSync: priceInfo?.priceUpdate || '',
    timestamp: Date.now()
  };
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
    const imported = await importPlayer(payload.url);
    sendJson(res, 200, imported);
  } catch (error) {
    console.error('Import endpoint failed:', error);
    sendJson(res, error.statusCode || 500, {
      error: error.message || 'Import failed.'
    });
  }
};
