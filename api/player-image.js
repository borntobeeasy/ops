const FUTDB_API_BASE = 'https://api.futdatabase.com/api';

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
    'Accept': 'image/*'
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.end('Method not allowed');
    return;
  }

  try {
    const playerId = Number(req.query?.playerId);
    if (!Number.isFinite(playerId) || playerId <= 0) {
      res.statusCode = 400;
      res.end('Invalid playerId');
      return;
    }

    const response = await fetch(`${FUTDB_API_BASE}/players/${playerId}/image`, {
      headers: buildHeaders()
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      res.statusCode = response.status;
      res.end(text || 'Image request failed');
      return;
    }

    const arrayBuffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/png';
    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    res.end(Buffer.from(arrayBuffer));
  } catch (error) {
    console.error('Player image endpoint failed:', error);
    res.statusCode = error.statusCode || 500;
    res.end(error.message || 'Image request failed');
  }
};
