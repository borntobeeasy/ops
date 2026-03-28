// OPS Tracker – Popup Script

function formatCoins(v) {
  if (!v || isNaN(v)) return '—';
  return Math.round(v).toLocaleString('en-US') + ' Coins';
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `vor ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `vor ${m}min`;
  const h = Math.floor(m / 60);
  return `vor ${h}h`;
}

function renderData(data) {
  const el = document.getElementById('dataContent');

  if (!data) {
    el.innerHTML = `
      <div class="empty">
        <span>🔍</span>
        Noch keine Daten importiert.<br>Gehe zu fut.gg und klick den grünen Button.
      </div>`;
    return;
  }

  const imgHtml = data.imageUrl
    ? `<img class="card-img" src="${data.imageUrl}" alt="Karte" onerror="this.style.display='none'">`
    : '';

  el.innerHTML = `
    ${imgHtml}
    <div class="data-row">
      <span class="data-label">Spieler</span>
      <span class="data-value">${data.name || '—'}</span>
    </div>
    <div class="data-row">
      <span class="data-label">Kartentyp</span>
      <span class="data-value">${data.cardType || '—'}</span>
    </div>
    <div class="data-row">
      <span class="data-label">Preis</span>
      <span class="data-value price">${formatCoins(data.price)}</span>
    </div>
    <div class="age">${data.timestamp ? timeAgo(data.timestamp) : ''}</div>
  `;
}

// Daten laden
chrome.storage.local.get(['ops_import_data'], (result) => {
  renderData(result.ops_import_data || null);
});

// Löschen
document.getElementById('clearBtn').addEventListener('click', () => {
  chrome.storage.local.remove('ops_import_data', () => {
    renderData(null);
  });
});
