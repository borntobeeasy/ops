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

async function futdbFetch(path) {
  const response = await fetch(`${FUTDB_API_BASE}${path}`, {
    headers: buildHeaders()
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const error = new Error(text || `FutDB request failed with ${response.status}`);
    error.statusCode = response.status;
    throw error;
  }

  return response.json();
}

function formatPriceRange(priceInfo) {
  const min = Number(priceInfo?.minPrice);
  const max = Number(priceInfo?.maxPrice);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return '';
  return `${min.toLocaleString('en-US')} - ${max.toLocaleString('en-US')}`;
}

async function fetchTradeUpdate(trade) {
  const playerId = Number(trade?.playerId);
  if (!Number.isFinite(playerId) || playerId <= 0) return null;

  const response = await futdbFetch(`/players/${playerId}/price`);
  const priceInfo = response?.[DEFAULT_PLATFORM];
  if (!priceInfo) return null;

  return {
    id: trade.id,
    playerId,
    livePrice: Number.isFinite(Number(priceInfo.price)) ? Number(priceInfo.price) : null,
    priceRange: formatPriceRange(priceInfo),
    lastPriceSync: priceInfo.priceUpdate || '',
    platform: DEFAULT_PLATFORM
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
    const trades = Array.isArray(payload.trades) ? payload.trades : [];
    const updates = [];

    for (const trade of trades) {
      try {
        const update = await fetchTradeUpdate(trade);
        if (update) updates.push(update);
      } catch (error) {
        console.warn(`Price refresh skipped for trade ${trade?.id || 'unknown'}:`, error.message);
      }
    }

    sendJson(res, 200, { updates });
  } catch (error) {
    console.error('Refresh endpoint failed:', error);
    sendJson(res, error.statusCode || 500, {
      error: error.message || 'Price refresh failed.'
    });
  }
};
