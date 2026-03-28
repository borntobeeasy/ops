/* ═══════════════════════════════════════════
   STORAGE & STATE
═══════════════════════════════════════════ */
const STORAGE_KEY = "uev_trading_tracker_v2";
let trades = { offene: [], abgeschlossen: [] };
let currentTradeId = null;
let currentSellTradeId = null;
let filterMode = 'all';
let sortMode = 'date';
let openSort = { key: 'buyDate', dir: 'desc' };
let leaderboardRange = 'all';
let pendingImport = null;
let futggPopup = null;
const FUTGG_ORIGIN = 'https://www.futbin.com';
const FUTGG_MESSAGE_TYPE = 'ops-futbin-import';
const FUTGG_PROXY_PREFIX = 'https://r.jina.ai/http://';

function isMobileLayout() {
  return window.matchMedia('(max-width: 768px)').matches;
}

function isTouchDevice() {
  return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

function nowLocalISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0,16);
}
function saveData() { localStorage.setItem(STORAGE_KEY, JSON.stringify(trades)); }
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (p && Array.isArray(p.offene) && Array.isArray(p.abgeschlossen)) trades = p;
  } catch(e) { console.warn("Load failed", e); }
}
function resetAll() {
  if (!confirm("Delete ALL trades?")) return;
  trades = { offene: [], abgeschlossen: [] };
  saveData(); renderAll();
}

function sanitizeHtml(value) {
  return (value || '').toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ═══════════════════════════════════════════
   EXTENSION BRIDGE
   Liest chrome.storage.local falls Extension installiert ist
═══════════════════════════════════════════ */
function checkExtensionData() {
  if (typeof chrome === 'undefined' || !chrome.storage) return;

  chrome.storage.local.get(['ops_import_data'], (result) => {
    const data = result.ops_import_data;
    if (!data || !data.name) return;

    // Nur anzeigen wenn < 5 Minuten alt
    const age = Date.now() - (data.timestamp || 0);
    if (age > 5 * 60 * 1000) return;

    pendingImport = data;
    showImportBanner(data);
  });
}

function showImportBanner(data) {
  const banner = document.getElementById('importBanner');
  if (!banner) return;
  const img = document.getElementById('bannerImg');
  const nameEl = document.getElementById('bannerName');
  const typeEl = document.getElementById('bannerType');
  const priceEl = document.getElementById('bannerPrice');
  const ageEl = document.getElementById('bannerAge');

  img.src = data.imageUrl || '';
  img.style.display = data.imageUrl ? 'block' : 'none';
  nameEl.textContent = data.name || '—';
  typeEl.textContent = data.cardType || '—';
  priceEl.textContent = data.price
    ? `${formatCoins(data.price)} Coins${data.priceRange ? ` • PR ${data.priceRange}` : ''}`
    : (data.priceRange ? `PR ${data.priceRange}` : '—');

  const mins = Math.floor((Date.now() - data.timestamp) / 60000);
  ageEl.textContent = mins < 1 ? 'Gerade importiert' : `vor ${mins} Min importiert`;

  banner.classList.remove('visible');
}

function dismissBanner() {
  const banner = document.getElementById('importBanner');
  if (banner) banner.classList.remove('visible');
  pendingImport = null;
}

function useBannerData() {
  if (!pendingImport) return;
  showTradeModal(pendingImport);
  dismissBanner();
}

function normalizeImportData(data) {
  if (!data || typeof data !== 'object') return null;
  const price = Number(data.price);
  return {
    name: (data.name || '').toString().trim(),
    imageUrl: (data.imageUrl || '').toString().trim(),
    cardType: (data.cardType || '').toString().trim(),
    price: Number.isFinite(price) ? price : null,
    priceRange: (data.priceRange || '').toString().trim(),
    priceRaw: data.priceRaw || '',
    pageUrl: data.pageUrl || '',
    timestamp: data.timestamp || Date.now()
  };
}

function setFutggStatus(message, tone='info') {
  const el = document.getElementById('futggStatus');
  if (!el) return;
  el.textContent = message;
  el.className = `futgg-status${tone !== 'info' ? ` ${tone}` : ''}`;
}

function setBuyDatePreview(value) {
  const preview = document.getElementById('buyDatePreview');
  const hiddenInput = document.getElementById('buyDate');
  const effectiveValue = value || nowLocalISO();

  if (hiddenInput) hiddenInput.value = effectiveValue;
  if (!preview) return;

  try {
    preview.textContent = new Date(effectiveValue).toLocaleString();
  } catch {
    preview.textContent = effectiveValue;
  }
}

function normalizeFutggUrl(rawUrl) {
  const value = (rawUrl || '').trim();
  if (!value) return null;

  let candidate = value;
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;

  try {
    const url = new URL(candidate);
    if (!/(\.|^)futbin\.com$/i.test(url.hostname)) return null;
    return url;
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

function parseFutggProxyText(text, pageUrl) {
  const lines = (text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const headingLine = lines.find((line) => line.startsWith('# ')) || '';
  const headingMatch = headingLine.match(/^#\s+(.*?)\s+(\d+)\s+OVR\s+-\s+EA FC\s+\d+/i);
  const nameFromHeading = headingMatch ? headingMatch[1].trim() : '';
  const ratingFromHeading = headingMatch ? headingMatch[2].trim() : '';

  let cardType = '';
  if (headingMatch) {
    const headingIndex = lines.indexOf(headingLine);
    for (let i = headingIndex + 1; i < Math.min(lines.length, headingIndex + 8); i += 1) {
      const line = lines[i];
      if (!line || /^\d+\s+OVR/i.test(line) || /^Loading/i.test(line) || line.startsWith('*') || line.startsWith('[')) continue;
      cardType = line.replace(/\s+/g, ' ').trim();
      break;
    }
  }

  const priceLine = lines.find((line) => /(?:price|coins)/i.test(line) && /\d/.test(line));
  const priceDigits = priceLine ? priceLine.replace(/[^0-9]/g, '') : '';
  const parsedPrice = priceDigits ? Number(priceDigits) : null;

  let fallbackName = '';
  try {
    const url = new URL(pageUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    fallbackName = humanizeSlug(parts.find((part) => /-/.test(part)) || '');
  } catch {}

  const parsed = {
    name: nameFromHeading || fallbackName,
    imageUrl: '',
    cardType: [cardType, ratingFromHeading ? `${ratingFromHeading} OVR` : ''].filter(Boolean).join(' • '),
    price: Number.isFinite(parsedPrice) ? parsedPrice : null,
    priceRaw: priceLine || '',
    pageUrl,
    timestamp: Date.now()
  };

  if (!parsed.cardType && ratingFromHeading) {
    parsed.cardType = `${ratingFromHeading} OVR`;
  }

  return parsed;
}

function buildImportFromUrl(pageUrl) {
  let fallbackName = '';
  try {
    const url = new URL(pageUrl);
    const parts = url.pathname.split('/').filter(Boolean);
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
  const priceDigits = priceLine ? priceLine.replace(/[^0-9]/g, '') : '';
  const parsedPrice = priceDigits ? Number(priceDigits) : null;
  const priceRangeLabelIndex = nearby.findIndex((line) => /PRICE RANGE:/i.test(line));
  const priceRange = priceRangeLabelIndex >= 0 && nearby[priceRangeLabelIndex + 1]
    ? nearby[priceRangeLabelIndex + 1].replace(/\s+/g, ' ').trim()
    : '';

  const fallback = buildImportFromUrl(pageUrl);
  return {
    ...fallback,
    name: nameFromHeading || fallback.name,
    cardType,
    price: Number.isFinite(parsedPrice) ? parsedPrice : null,
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

async function importFutbinCardImage(pageUrl) {
  const proxyUrl = `${FUTGG_PROXY_PREFIX}${pageUrl.replace(/^https?:\/\//i, '')}`;
  const response = await fetch(proxyUrl);
  if (!response.ok) throw new Error(`Image page HTTP ${response.status}`);
  const text = await response.text();
  return extractFutbinCardImageUrl(text);
}

function buildFutggAssetsUrl(pageUrl) {
  const cleanUrl = pageUrl.replace(/\/+$/, '');
  if (cleanUrl.endsWith('/assets')) return `${cleanUrl}/`;
  return `${cleanUrl}/assets/`;
}

function extractSimpleCardImageUrl(html) {
  const source = html || '';
  const allAssetMatches = [...source.matchAll(/https:\/\/game-assets\.fut\.gg\/[^\s"'`)>]+?\.(?:png|webp)/ig)]
    .map((match) => match[0]);
  const uniqueAssetMatches = [...new Set(allAssetMatches)];

  const preferredSmallAssets = uniqueAssetMatches.filter((url) => /simple-card|player-item-simple-card/i.test(url));
  if (preferredSmallAssets[2]) return preferredSmallAssets[2];
  if (preferredSmallAssets[0]) return preferredSmallAssets[0];

  return uniqueAssetMatches[2] || uniqueAssetMatches[0] || '';
}

async function importSimpleCardImage(pageUrl) {
  const assetsUrl = buildFutggAssetsUrl(pageUrl);
  const proxyUrl = `${FUTGG_PROXY_PREFIX}${assetsUrl.replace(/^https?:\/\//i, '')}`;
  const response = await fetch(proxyUrl);
  if (!response.ok) throw new Error(`Asset page HTTP ${response.status}`);
  const text = await response.text();
  return extractSimpleCardImageUrl(text);
}

async function importFromFutggUrl() {
  const input = document.getElementById('futggUrl');
  let rawUrl = input?.value || '';
  if (!rawUrl.trim()) {
    rawUrl = window.prompt('Paste the FUTBIN player link:', '') || '';
  }

  const parsedUrl = normalizeFutggUrl(rawUrl);

  if (!parsedUrl) {
    setFutggStatus('Paste a valid FUTBIN player link first.', 'error');
    return;
  }

  const pageUrl = parsedUrl.toString();
  if (input) input.value = pageUrl;
  setFutggStatus('Importing card data from the FUTBIN link...', 'info');

  try {
    const response = await fetch('/api/import-player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: pageUrl })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }

    handleImportedData(payload);
    setFutggStatus(
      payload.price || payload.priceRange
        ? 'Card imported from FUTBIN. Price and PR were applied when available.'
        : 'The link was only partially read. Check and complete the fields if needed.',
      payload.price || payload.priceRange ? 'success' : 'info'
    );
  } catch (error) {
    console.warn('backend import failed', error);
    setFutggStatus('Import failed. Check that the deployed API is reachable and try again.', 'error');
  }
}

function toggleImportedFieldVisibility(hasImportedData) {
  const playerGroup = document.getElementById('manualPlayerNameGroup');
  const manualFields = document.getElementById('manualImportFields');
  const previewWrap = document.getElementById('imgPreviewWrap');

  if (playerGroup) playerGroup.classList.toggle('is-hidden', !!hasImportedData);
  if (manualFields) manualFields.classList.toggle('is-hidden', !!hasImportedData);
  if (previewWrap) previewWrap.classList.toggle('is-hidden', !!hasImportedData);
}

function updateImportedCardPreview(data) {
  const preview = document.getElementById('importedCardPreview');
  if (!preview) return;

  if (!data || !data.name) {
    preview.style.display = 'none';
    return;
  }

  document.getElementById('modalImportImg').src = data.imageUrl || '';
  document.getElementById('modalImportImg').style.display = data.imageUrl ? 'block' : 'none';
  document.getElementById('modalImportName').textContent = data.name || '—';
  document.getElementById('modalImportType').textContent = data.cardType || '—';
  document.getElementById('modalImportPrice').textContent = data.price ? formatCoins(data.price) + ' Coins' : (data.priceRaw || 'Not available');
  document.getElementById('modalImportPriceRange').textContent = data.priceRange || '—';
  preview.style.display = 'flex';
}

function applyImportToTradeForm(data, options={}) {
  const imported = normalizeImportData(data);
  if (!imported) return;

  const preserveUserFields = options.preserveUserFields !== false;
  const playerName = document.getElementById('playerName');
  const cardImageUrl = document.getElementById('cardImageUrl');
  const cardType = document.getElementById('cardType');
  const livePrice = document.getElementById('livePrice');
  const priceRange = document.getElementById('priceRange');
  const note = document.getElementById('note');

  playerName.value = imported.name || playerName.value;
  cardImageUrl.value = imported.imageUrl || cardImageUrl.value;
  cardType.value = imported.cardType || cardType.value;
  if (imported.price) livePrice.value = imported.price;
  if (imported.priceRange) priceRange.value = imported.priceRange;

  updateImportedCardPreview(imported);
  updateImgPreview();
  setFutggStatus(
    imported.price
      ? 'Card imported from FUTBIN. Image, type, price and PR were applied.'
      : 'Card imported from FUTBIN. Name and type were applied.',
    imported.price || imported.priceRange ? 'success' : 'info'
  );
}

function getTradeFormPlayerName() {
  const manualValue = document.getElementById('playerName')?.value.trim() || '';
  if (manualValue) return manualValue;

  const importedValue = document.getElementById('modalImportName')?.textContent.trim() || '';
  if (importedValue && importedValue !== '—') return importedValue;

  return pendingImport?.name || '';
}

function handleImportedData(data) {
  const imported = normalizeImportData(data);
  if (!imported || !imported.name) return;

  pendingImport = imported;
  const futggUrlInput = document.getElementById('futggUrl');
  if (futggUrlInput && imported.pageUrl) futggUrlInput.value = imported.pageUrl;
  showImportBanner(imported);

  if (document.getElementById('overlay').style.display === 'flex') {
    applyImportToTradeForm(imported, { preserveUserFields: true });
  }
}

function handleFutggMessage(event) {
  if (event.origin !== FUTGG_ORIGIN) return;
  const payload = event.data;
  if (!payload || payload.type !== FUTGG_MESSAGE_TYPE) return;
  handleImportedData(payload.payload);
}

/* ═══════════════════════════════════════════
   FUT.GG
═══════════════════════════════════════════ */
function openFutGG() {
  const name = getTradeFormPlayerName();
  const q = encodeURIComponent(name || '');
  const url = `https://www.futbin.com/players?page=1&search=${q}`;

  if (isMobileLayout() || isTouchDevice()) {
    futggPopup = window.open(url, '_blank');
    if (!futggPopup) {
      window.location.href = url;
      return;
    }
    setFutggStatus('FUTBIN opened in a new tab. Copy the player link there, then switch back and import it here.', 'info');
    return;
  }

  const width = Math.min(window.screen.availWidth - 40, 1280);
  const height = Math.min(window.screen.availHeight - 80, 900);
  const left = Math.max(0, Math.round((window.screen.availWidth - width) / 2));
  const top = Math.max(0, Math.round((window.screen.availHeight - height) / 2));
  const features = `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`;

  futggPopup = window.open(url, 'opsFutggSearch', features);

  if (!futggPopup) {
    setFutggStatus('The popup was blocked by your browser. Allow popups for this page and try again.', 'error');
    return;
  }

  setFutggStatus('FUTBIN opened. Copy the player link there, then paste it here to import.', 'info');
  futggPopup.focus();
}

function updateImgPreview() {
  const input = document.getElementById('cardImageUrl');
  const url = input ? input.value.trim() : '';
  const img = document.getElementById('imgPreview');
  const txt = document.getElementById('imgPreviewText');
  if (!img || !txt) return;

  if (url) {
    img.src = url;
    txt.textContent = 'Imported card preview';
  } else {
    img.style.display = 'none';
    txt.textContent = 'After import, the card preview appears here automatically.';
  }
}

/* ═══════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════ */
function uid() { return crypto.randomUUID ? crypto.randomUUID() : Date.now()+"-"+Math.random(); }
function formatCoins(v) { const n=Number(v); return isFinite(n) ? Math.round(n).toLocaleString("en-US") : "0"; }
function formatDateTime(v) { if(!v) return ""; try { return new Date(v).toLocaleString(); } catch { return v; } }
function normalize(s) { return (s||"").toString().toLowerCase().trim(); }
function includesAny(t, q) {
  const qq = normalize(q); if(!qq) return true;
  return normalize(t.spieler).includes(qq) || normalize(t.notiz).includes(qq);
}
function isSameDay(a,b) { return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate(); }
function startOfWeek(d) { const x=new Date(d); const day=x.getDay(); x.setDate(x.getDate()+(day===0?-6:1-day)); x.setHours(0,0,0,0); return x; }
function startOfMonth(d) { const x=new Date(d); x.setDate(1); x.setHours(0,0,0,0); return x; }
function daysBetween(a,b) { return Math.abs(b-a)/(1000*60*60*24); }
function durationMs(t) { const b=new Date(t.kaufDatum),s=new Date(t.sellDate); if(isNaN(b)||isNaN(s)||s<b) return null; return s-b; }
function inRangeBySellDate(t, r) {
  const now=new Date(); const d=new Date(t.sellDate); if(isNaN(d.getTime())) return false;
  if(r==='all') return true;
  if(r==='today') return isSameDay(d,now);
  if(r==='7days') { const s=new Date(now); s.setDate(s.getDate()-7); return d>=s&&d<=now; }
  if(r==='30days') { const s=new Date(now); s.setDate(s.getDate()-30); return d>=s&&d<=now; }
  return true;
}

/* ═══════════════════════════════════════════
   PLAYER ICON
═══════════════════════════════════════════ */
function renderPlayerIcon(url) {
  if (url) return `<img class="player-icon" src="${sanitizeHtml(url)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex'"><span class="player-icon-placeholder" style="display:none">👤</span>`;
  return `<span class="player-icon-placeholder">👤</span>`;
}

/* ═══════════════════════════════════════════
   KPI
═══════════════════════════════════════════ */
function computeMostSoldPlayer(list) {
  const m={}; list.forEach(t=>{const n=t.spieler||"?"; m[n]=(m[n]||0)+1;});
  let best=null; Object.keys(m).forEach(n=>{if(!best||m[n]>best.count) best={name:n,count:m[n]};});
  return best;
}
function computeOldestOpenTrade(list) {
  if(!list.length) return null;
  return list.reduce((a,b)=>new Date(a.kaufDatum)<new Date(b.kaufDatum)?a:b);
}
function computeTodayProfit() { const now=new Date(); return trades.abgeschlossen.filter(t=>isSameDay(new Date(t.sellDate),now)).reduce((s,t)=>s+(Number(t.nettoProfit)||0),0); }
function computeThisWeekProfit() { const now=new Date(),s=startOfWeek(now); return trades.abgeschlossen.filter(t=>{const d=new Date(t.sellDate);return d>=s&&d<=now;}).reduce((s,t)=>s+(Number(t.nettoProfit)||0),0); }
function computeDailyAvg() {
  const m={}; trades.abgeschlossen.forEach(t=>{const d=new Date(t.sellDate);if(isNaN(d.getTime()))return;const k=d.getFullYear()+"-"+d.getMonth()+"-"+d.getDate();m[k]=(m[k]||0)+(Number(t.nettoProfit)||0);});
  const keys=Object.keys(m); if(!keys.length) return 0; return keys.reduce((s,k)=>s+m[k],0)/keys.length;
}
function computeWeeklyAvg() {
  const m={}; trades.abgeschlossen.forEach(t=>{const d=new Date(t.sellDate);if(isNaN(d.getTime()))return;const ws=startOfWeek(d);const k=ws.getFullYear()+"-"+ws.getMonth()+"-"+ws.getDate();m[k]=(m[k]||0)+(Number(t.nettoProfit)||0);});
  const keys=Object.keys(m); if(!keys.length) return 0; return keys.reduce((s,k)=>s+m[k],0)/keys.length;
}
function formatHoldTime(ms) {
  const h=Math.floor(ms/(1000*60*60)); const d=Math.floor(h/24); const rh=h%24;
  if(d<=0) return `${h}h`; if(rh<=0) return `${d}d`; return `${d}d ${rh}h`;
}
function computeAvgHoldMs() {
  const durations=trades.abgeschlossen.map(t=>durationMs(t)).filter(ms=>ms!==null&&ms>=0);
  if(!durations.length) return null; return durations.reduce((a,b)=>a+b,0)/durations.length;
}
function computeAvgSalesDay() {
  const m={}; trades.abgeschlossen.forEach(t=>{const d=new Date(t.sellDate);if(isNaN(d.getTime()))return;const k=d.getFullYear()+"-"+d.getMonth()+"-"+d.getDate();m[k]=(m[k]||0)+1;});
  const days=Object.keys(m).length; if(!days) return 0; return Object.values(m).reduce((s,n)=>s+n,0)/days;
}
function computeBestROI(list) {
  const m={}; list.forEach(t=>{const b=Number(t.kaufpreis)||0;if(b<=0)return;const roi=(Number(t.nettoProfit)||0)/b;const n=t.spieler||"?";if(!m[n])m[n]={total:0,n:0};m[n].total+=roi;m[n].n++;});
  let best=null; Object.keys(m).forEach(n=>{const avg=m[n].total/m[n].n;if(!best||avg>best.avg)best={name:n,avg,n:m[n].n};});
  return best;
}

function renderStats() {
  const off=trades.offene, ab=trades.abgeschlossen;
  const bound=off.reduce((s,t)=>s+(Number(t.kaufpreis)||0),0);
  const totalP=ab.reduce((s,t)=>s+(Number(t.nettoProfit)||0),0);
  const avgP=ab.length?totalP/ab.length:0;
  const todayP=computeTodayProfit(), weekP=computeThisWeekProfit();
  const dailyAvg=computeDailyAvg(), weeklyAvg=computeWeeklyAvg();
  const mostSold=computeMostSoldPlayer(ab), oldest=computeOldestOpenTrade(off);
  const bestROI=computeBestROI(ab);
  const avgHoldMs=computeAvgHoldMs();
  const avgSalesDay=computeAvgSalesDay();

  document.getElementById('statsContainer').innerHTML = `
    <div class="kpi-card"><div class="kpi-number">${off.length}</div><div class="kpi-label">Open trades</div><div class="kpi-sub">Bound: <b>${formatCoins(bound)}</b></div></div>
    <div class="kpi-card"><div class="kpi-number">${ab.length}</div><div class="kpi-label">Closed trades</div><div class="kpi-sub">Avg/trade: <b>${formatCoins(avgP)}</b></div></div>
    <div class="kpi-card"><div class="kpi-number ${totalP>=0?'profit-pos':'profit-neg'}">${formatCoins(totalP)}</div><div class="kpi-label">Total net profit</div><div class="kpi-sub">Daily avg: <b>${formatCoins(dailyAvg)}</b></div></div>
    <div class="kpi-card"><div class="kpi-number ${todayP>=0?'profit-pos':'profit-neg'}">${formatCoins(todayP)}</div><div class="kpi-label">Profit today</div><div class="kpi-sub">Daily avg: <b>${formatCoins(dailyAvg)}</b></div></div>
    <div class="kpi-card"><div class="kpi-number ${weekP>=0?'profit-pos':'profit-neg'}">${formatCoins(weekP)}</div><div class="kpi-label">Profit this week</div><div class="kpi-sub">Weekly avg: <b>${formatCoins(weeklyAvg)}</b></div></div>
    <div class="kpi-card"><div class="kpi-number">${mostSold?mostSold.count:"—"}</div><div class="kpi-label">Most sold player</div><div class="kpi-sub">${mostSold?`<b>${mostSold.name}</b>`:"No data"}</div></div>
    <div class="kpi-card"><div class="kpi-number">${oldest?Math.floor(daysBetween(new Date(oldest.kaufDatum),new Date()))+"d":"—"}</div><div class="kpi-label">Oldest open trade</div><div class="kpi-sub">${oldest?`<b>${oldest.spieler}</b>`:"None"}</div></div>
    <div class="kpi-card"><div class="kpi-number">${bestROI?(bestROI.avg*100).toFixed(2)+"%":"—"}</div><div class="kpi-label">Best avg ROI</div><div class="kpi-sub">${bestROI?`<b>${bestROI.name}</b> (${bestROI.n})`:"No data"}</div></div>
    <div class="kpi-card"><div class="kpi-number">${avgHoldMs?formatHoldTime(avgHoldMs):"—"}</div><div class="kpi-label">Avg hold time</div><div class="kpi-sub">Sell Date – Buy Date</div></div>
    <div class="kpi-card"><div class="kpi-number">${avgSalesDay.toFixed(2)}</div><div class="kpi-label">Avg sales / day</div><div class="kpi-sub">Avg/week: <b>${(avgSalesDay*7).toFixed(2)}</b></div></div>
  `;
}

/* ═══════════════════════════════════════════
   OPEN TRADES
═══════════════════════════════════════════ */
function setOpenSort(key) {
  if(openSort.key===key) openSort.dir=openSort.dir==='asc'?'desc':'asc';
  else { openSort.key=key; openSort.dir='asc'; }
  renderOpenTrades();
}
function sortOpen(list) {
  const dir=openSort.dir==='asc'?1:-1;
  return [...list].sort((a,b)=>{
    if(openSort.key==='player') return normalize(a.spieler).localeCompare(normalize(b.spieler))*dir;
    if(openSort.key==='buyPrice') return ((Number(a.kaufpreis)||0)-(Number(b.kaufpreis)||0))*dir;
    return (new Date(a.kaufDatum)-new Date(b.kaufDatum))*dir;
  });
}
function renderOpenTrades() {
  const tbody = document.querySelector('#openTradesTable tbody');
  const q = document.getElementById("searchOpen").value;
  let list = sortOpen(trades.offene.filter(t=>includesAny(t,q)));
  tbody.innerHTML = '';
  if(!list.length) { tbody.innerHTML=`<tr><td colspan="8" class="muted">No open trades found.</td></tr>`; return; }
  list.forEach(t => {
    const livePriceHtml = t.livePrice ? `<br><span style="font-size:0.78em;color:#A3FF12">Price: ${formatCoins(t.livePrice)}</span>` : '';
    const priceRangeHtml = t.priceRange ? `<br><span style="font-size:0.78em;color:#c9dcff">PR: ${sanitizeHtml(t.priceRange)}</span>` : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="icon-cell">${renderPlayerIcon(t.cardImageUrl)}</td>
      <td data-label="Player"><b>${sanitizeHtml(t.spieler)}</b>${t.cardType?`<span class="card-badge">${sanitizeHtml(t.cardType)}</span>`:''}${livePriceHtml}${priceRangeHtml}</td>
      <td data-label="Buy Price">${formatCoins(t.kaufpreis)}</td>
      <td data-label="Buy Date">${formatDateTime(t.kaufDatum)}</td>
      <td data-label="Type">${sanitizeHtml(t.cardType||'—')}</td>
      <td data-label="PR">${sanitizeHtml(t.priceRange||'—')}</td>
      <td data-label="Note">${sanitizeHtml(t.notiz||'')}</td>
      <td class="actions-cell" data-label="Actions">
        <button class="secondary small" onclick="showSellModal('${t.id}')">Sell</button>
        <button class="secondary small" onclick="editTrade('${t.id}')">Edit</button>
        <button class="danger small" onclick="deleteTrade('${t.id}')">Delete</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

/* ═══════════════════════════════════════════
   HISTORY
═══════════════════════════════════════════ */
function getFilteredHistory() {
  const q=document.getElementById("searchHistory").value;
  const now=new Date();
  let list=trades.abgeschlossen.filter(t=>includesAny(t,q)).filter(t=>{
    const d=new Date(t.sellDate); if(isNaN(d.getTime())) return false;
    if(filterMode==='all') return true;
    if(filterMode==='today') return isSameDay(d,now);
    if(filterMode==='7days'){const s=new Date(now);s.setDate(s.getDate()-7);return d>=s&&d<=now;}
    if(filterMode==='30days'){const s=new Date(now);s.setDate(s.getDate()-30);return d>=s&&d<=now;}
    if(filterMode==='thisWeek'){return d>=startOfWeek(now)&&d<=now;}
    if(filterMode==='thisMonth'){return d>=startOfMonth(now)&&d<=now;}
    return true;
  });
  if(sortMode==='profit') list.sort((a,b)=>(Number(b.nettoProfit)||0)-(Number(a.nettoProfit)||0));
  else list.sort((a,b)=>new Date(b.sellDate)-new Date(a.sellDate));
  return list;
}
function renderHistory() {
  const tbody=document.querySelector('#historyTable tbody');
  const list=getFilteredHistory();
  tbody.innerHTML='';
  if(!list.length){tbody.innerHTML=`<tr><td colspan="10" class="muted">No trades found.</td></tr>`;return;}
  list.forEach(t=>{
    const p=Number(t.nettoProfit)||0;
    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td class="icon-cell">${renderPlayerIcon(t.cardImageUrl)}</td>
      <td data-label="Player"><b>${sanitizeHtml(t.spieler)}</b>${t.cardType?`<span class="card-badge">${sanitizeHtml(t.cardType)}</span>`:''}</td>
      <td data-label="Buy Price">${formatCoins(t.kaufpreis)}</td>
      <td data-label="Buy Date">${formatDateTime(t.kaufDatum)}</td>
      <td data-label="Sell Price">${formatCoins(t.sellPrice)}</td>
      <td data-label="Sell Date">${formatDateTime(t.sellDate)}</td>
      <td data-label="Net Profit" class="${p>=0?'profit-pos':'profit-neg'}">${formatCoins(p)}</td>
      <td data-label="PR">${sanitizeHtml(t.priceRange||'—')}</td>
      <td data-label="Note">${sanitizeHtml(t.notiz||'')}</td>
      <td class="actions-cell" data-label="Actions"><button class="secondary small" onclick="reopenTrade('${t.id}')">Reopen</button></td>`;
    tbody.appendChild(tr);
  });
}
function filterHistory(m){filterMode=m;renderHistory();renderStats();renderLeaderboard();}
function sortHistory(m){sortMode=m;renderHistory();}

/* ═══════════════════════════════════════════
   LEADERBOARD
═══════════════════════════════════════════ */
function setLeaderboardRange(r){leaderboardRange=r;renderLeaderboard();}
function groupByPlayer(list){const m={};list.forEach(t=>{const n=t.spieler||"?";if(!m[n])m[n]=[];m[n].push(t);});return m;}
function renderLeaderboard(){
  const list=trades.abgeschlossen.filter(t=>inRangeBySellDate(t,leaderboardRange));
  const byP=groupByPlayer(list);
  const durArr=Object.keys(byP).map(n=>{const dur=byP[n].map(t=>durationMs(t)).filter(ms=>ms!==null&&ms>=0);if(!dur.length)return null;return{name:n,avgMs:dur.reduce((a,b)=>a+b,0)/dur.length,n:dur.length};}).filter(Boolean).sort((a,b)=>a.avgMs-b.avgMs).slice(0,10);
  const soldArr=Object.keys(byP).map(n=>({name:n,count:byP[n].length})).sort((a,b)=>b.count-a.count).slice(0,10);
  const profArr=Object.keys(byP).map(n=>({name:n,profit:byP[n].reduce((s,t)=>s+(Number(t.nettoProfit)||0),0)})).sort((a,b)=>b.profit-a.profit).slice(0,10);
  document.getElementById('lbDuration').innerHTML=durArr.length?durArr.map((x,i)=>`<div class="lb-row"><span>#${i+1} <b>${x.name}</b></span><span>${Math.round(x.avgMs/(1000*60*60))}h avg (${x.n})</span></div>`).join(''):`<div class="muted">No data.</div>`;
  document.getElementById('lbMostSold').innerHTML=soldArr.length?soldArr.map((x,i)=>`<div class="lb-row"><span>#${i+1} <b>${x.name}</b></span><span>${x.count} sales</span></div>`).join(''):`<div class="muted">No data.</div>`;
  document.getElementById('lbMostProfit').innerHTML=profArr.length?profArr.map((x,i)=>`<div class="lb-row"><span>#${i+1} <b>${x.name}</b></span><span class="${x.profit>=0?'profit-pos':'profit-neg'}">${formatCoins(x.profit)}</span></div>`).join(''):`<div class="muted">No data.</div>`;
}

/* ═══════════════════════════════════════════
   BUY MODAL
═══════════════════════════════════════════ */
function showTradeModal(prefill) {
  document.getElementById('tradeFormTitle').textContent = 'Add Trade';
  document.getElementById('playerName').value = prefill?.name || '';
  document.getElementById('futggUrl').value = prefill?.pageUrl || '';
  document.getElementById('buyPrice').value = '';
  setBuyDatePreview(nowLocalISO());
  document.getElementById('note').value = '';
  document.getElementById('cardImageUrl').value = prefill?.imageUrl || '';
  document.getElementById('cardType').value = prefill?.cardType || '';
  document.getElementById('livePrice').value = prefill?.price || '';
  document.getElementById('priceRange').value = prefill?.priceRange || '';
  document.getElementById('imgPreview').style.display = 'none';
  document.getElementById('imgPreviewText').textContent = 'After import, the card preview appears here automatically.';
  setFutggStatus('Open FUTBIN, copy the player link, paste it here, then import the card.', 'info');
  updateImportedCardPreview(prefill);

  if (prefill?.imageUrl) updateImgPreview();

  currentTradeId = null;
  document.getElementById('overlay').style.display = 'flex';
}

function closeTradeModal() { document.getElementById('overlay').style.display='none'; }

function saveTrade() {
  const player = getTradeFormPlayerName();
  const buyPrice = parseFloat(document.getElementById('buyPrice').value);
  const existingBuyDate = document.getElementById('buyDate').value;
  const buyDatum = currentTradeId ? (existingBuyDate || nowLocalISO()) : nowLocalISO();
  const notiz = document.getElementById('note').value;
  const sourceUrl = document.getElementById('futggUrl').value.trim();
  const cardImageUrl = document.getElementById('cardImageUrl').value.trim();
  const cardType = document.getElementById('cardType').value.trim();
  const livePrice = parseFloat(document.getElementById('livePrice').value) || null;
  const priceRange = document.getElementById('priceRange').value.trim();

  if(!player||isNaN(buyPrice)){alert('Please import a player from FUTBIN and enter your buy price.');return;}

  const tradeData = { spieler:player, kaufpreis:buyPrice, kaufDatum:buyDatum, notiz, sourceUrl, cardImageUrl, cardType, livePrice, priceRange };

  if(currentTradeId) {
    const idx=trades.offene.findIndex(t=>t.id===currentTradeId);
    if(idx>=0) trades.offene[idx]={...trades.offene[idx],...tradeData};
  } else {
    trades.offene.push({id:uid(),...tradeData});
  }

  saveData(); closeTradeModal(); renderAll();
}

function editTrade(id) {
  const t=trades.offene.find(tr=>tr.id===id); if(!t) return;
  document.getElementById('tradeFormTitle').textContent='Edit Trade';
  document.getElementById('playerName').value=t.spieler;
  document.getElementById('futggUrl').value=t.sourceUrl || '';
  document.getElementById('buyPrice').value=t.kaufpreis;
  setBuyDatePreview(t.kaufDatum);
  document.getElementById('note').value=t.notiz||'';
  document.getElementById('cardImageUrl').value=t.cardImageUrl||'';
  document.getElementById('cardType').value=t.cardType||'';
  document.getElementById('livePrice').value=t.livePrice||'';
  document.getElementById('priceRange').value=t.priceRange||'';
  updateImportedCardPreview(null);
  setFutggStatus('Paste another FUTBIN link if you want to refresh this card data.', 'info');
  currentTradeId=t.id;
  updateImgPreview();
  document.getElementById('overlay').style.display='flex';
}

function deleteTrade(id){if(!confirm('Delete this trade?'))return;trades.offene=trades.offene.filter(t=>t.id!==id);saveData();renderAll();}

/* ═══════════════════════════════════════════
   SELL MODAL
═══════════════════════════════════════════ */
function showSellModal(id){currentSellTradeId=id;document.getElementById('sellPrice').value='';document.getElementById('sellDate').value=nowLocalISO();document.getElementById('sellOverlay').style.display='flex';updateSellCalc();}
function closeSellModal(){document.getElementById('sellOverlay').style.display='none';currentSellTradeId=null;}
function updateSellCalc(){
  const t=trades.offene.find(x=>x.id===currentSellTradeId);
  const sp=parseFloat(document.getElementById('sellPrice').value);
  if(!t||isNaN(sp)){['bruttoProfit','eaTax','nettoProfit'].forEach(id=>document.getElementById(id).textContent=formatCoins(0));document.getElementById('nettoProfit').className='profit-pos';return;}
  const buy=Number(t.kaufpreis)||0,brutto=sp-buy,tax=sp*0.05,netto=brutto-tax;
  document.getElementById('bruttoProfit').textContent=formatCoins(brutto);
  document.getElementById('eaTax').textContent=formatCoins(tax);
  const el=document.getElementById('nettoProfit');el.textContent=formatCoins(netto);el.className=netto>=0?'profit-pos':'profit-neg';
}
function confirmSell(){
  const t=trades.offene.find(x=>x.id===currentSellTradeId);
  const sp=parseFloat(document.getElementById('sellPrice').value);
  const sd=document.getElementById('sellDate').value;
  if(!t||isNaN(sp)||!sd){alert('Please fill sell price and sell date.');return;}
  const buy=Number(t.kaufpreis)||0,brutto=sp-buy,tax=sp*0.05,netto=brutto-tax;
  trades.offene=trades.offene.filter(x=>x.id!==t.id);
  trades.abgeschlossen.push({...t,sellPrice:sp,sellDate:sd,bruttoProfit:brutto,eaTax:tax,nettoProfit:netto});
  saveData();closeSellModal();renderAll();
}

/* ═══════════════════════════════════════════
   REOPEN
═══════════════════════════════════════════ */
function reopenTrade(id){
  const t=trades.abgeschlossen.find(x=>x.id===id);if(!t)return;if(!confirm("Reopen?"))return;
  trades.abgeschlossen=trades.abgeschlossen.filter(x=>x.id!==id);
  const o={...t};delete o.sellPrice;delete o.sellDate;delete o.bruttoProfit;delete o.eaTax;delete o.nettoProfit;
  trades.offene.push(o);saveData();renderAll();
}

/* ═══════════════════════════════════════════
   IMPORT / EXPORT
═══════════════════════════════════════════ */
function exportData(){const blob=new Blob([JSON.stringify(trades,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='ops_trades_backup.json';a.click();URL.revokeObjectURL(url);}
function importData(e){const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{const d=JSON.parse(r.result);if(!d||!Array.isArray(d.offene)||!Array.isArray(d.abgeschlossen)){alert('Invalid format.');return;}trades=d;saveData();renderAll();alert("Backup imported!");}catch{alert('Import failed.');}};r.readAsText(f);}

/* ═══════════════════════════════════════════
   TABS
═══════════════════════════════════════════ */
document.querySelectorAll('.tab').forEach(tab=>{
  tab.onclick=()=>{
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
    if(tab.id==='tabPortfolio') document.getElementById('sectionPortfolio').classList.add('active');
    else if(tab.id==='tabHistory') document.getElementById('sectionHistory').classList.add('active');
    else document.getElementById('sectionLeaderboard').classList.add('active');
  };
});

/* ═══════════════════════════════════════════
   INIT
═══════════════════════════════════════════ */
function renderAll(){renderStats();renderOpenTrades();renderHistory();renderLeaderboard();}

window.onload=()=>{
  loadData();
  renderAll();
};

document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeTradeModal();closeSellModal();}});

