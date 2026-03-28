// OPS Trading Tracker – fut.gg Content Script
// Läuft auf: https://www.fut.gg/players/*/

(function () {
  // Verhindere Doppel-Initialisierung
  if (window.__opsTrackerInjected) return;
  window.__opsTrackerInjected = true;

  // ─── Hilfsfunktionen ────────────────────────────────────────────────────────

  function tryText(selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) return el.textContent.trim();
      } catch {}
    }
    return null;
  }

  function tryAttr(selectors, attr) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.getAttribute(attr)) return el.getAttribute(attr);
      } catch {}
    }
    return null;
  }

  function cleanPrice(str) {
    if (!str) return null;
    // Entfernt alles außer Ziffern
    const num = str.replace(/[^0-9]/g, "");
    return num ? parseInt(num, 10) : null;
  }

  // ─── Daten scrapen ──────────────────────────────────────────────────────────

  function scrapePlayerData() {
    // Spielername
    const name = tryText([
      'h1[class*="player-name"]',
      'h1[class*="PlayerName"]',
      '.player-header h1',
      '[class*="playerName"]',
      '[class*="player_name"]',
      'h1'
    ]);

    // Kartenbild
    const imageUrl = tryAttr([
      'img[class*="player-item__img"]',
      'img[class*="PlayerItemImg"]',
      'img[class*="player-card"]',
      'img[class*="playerCard"]',
      '.player-item img',
      '[class*="cardImage"] img',
      '[class*="card-image"] img',
      'img[src*="/players/"][src*=".png"]',
      'img[src*="futgg"][src*="player"]',
      'img[alt*="player"]'
    ], 'src');

    // Kartentyp (z.B. TOTY, IF, Gold)
    const cardType = tryText([
      '[class*="card-type"]',
      '[class*="cardType"]',
      '[class*="card_type"]',
      '[class*="rarity"]',
      '[class*="Rarity"]',
      '[class*="badge"]',
      '[class*="version"]',
      '.player-header [class*="type"]'
    ]);

    // Preis – versuche mehrere Stellen
    const priceRaw = tryText([
      '[class*="price"]:not([class*="range"])',
      '[class*="Price"]:not([class*="Range"])',
      '[class*="market-price"]',
      '[class*="MarketPrice"]',
      '[class*="lowest-price"]',
      '[class*="LowestPrice"]',
      '[class*="buy-now"]',
      '[class*="BuyNow"]',
      'span[class*="price"]',
      'div[class*="price"]'
    ]);

    const price = cleanPrice(priceRaw);

    // URL für spätere Referenz
    const pageUrl = window.location.href;

    return { name, imageUrl, cardType, price, priceRaw, pageUrl };
  }

  // ─── Button einfügen ────────────────────────────────────────────────────────

  function injectButton() {
    if (document.getElementById('ops-tracker-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'ops-tracker-btn';
    btn.innerHTML = `
      <span style="font-size:16px">⚡</span>
      <span>In OPS Tracker importieren</span>
    `;
    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      zIndex: '999999',
      background: 'linear-gradient(135deg, #A3FF12, #7ACC00)',
      color: '#000',
      border: 'none',
      borderRadius: '16px',
      padding: '12px 20px',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontWeight: '800',
      fontSize: '14px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      boxShadow: '0 4px 20px rgba(163,255,18,0.4)',
      transition: 'all 0.2s'
    });

    btn.onmouseenter = () => {
      btn.style.transform = 'translateY(-2px)';
      btn.style.boxShadow = '0 6px 28px rgba(163,255,18,0.6)';
    };
    btn.onmouseleave = () => {
      btn.style.transform = 'translateY(0)';
      btn.style.boxShadow = '0 4px 20px rgba(163,255,18,0.4)';
    };

    btn.onclick = () => {
      const data = scrapePlayerData();
      sendToTracker(data);
    };

    document.body.appendChild(btn);
  }

  // ─── Daten ans Tracker Tool senden ──────────────────────────────────────────

  function sendToTracker(data) {
    const payload = { ...data, timestamp: Date.now() };

    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(
          { type: 'ops-futgg-import', payload },
          'https://borntobeeasy.github.io'
        );
      }
    } catch {}

    // Speichere in chrome.storage.local – das Tool liest daraus
    chrome.storage.local.set(
      { ops_import_data: payload },
      () => {
        showToast(data);
        if (window.opener && !window.opener.closed) {
          setTimeout(() => window.close(), 900);
        }
      }
    );
  }

  function showToast(data) {
    // Alten Toast entfernen
    const old = document.getElementById('ops-toast');
    if (old) old.remove();

    const toast = document.createElement('div');
    toast.id = 'ops-toast';

    const priceText = data.price
      ? data.price.toLocaleString('en-US') + ' Coins'
      : (data.priceRaw || 'Nicht gefunden');

    toast.innerHTML = `
      <div style="font-weight:900;font-size:15px;color:#A3FF12;margin-bottom:6px">
        ✅ Daten importiert!
      </div>
      <div style="font-size:12px;color:#ccc;line-height:1.6">
        <b style="color:#fff">${data.name || '?'}</b><br>
        Typ: ${data.cardType || '?'}<br>
        Preis: ${priceText}<br>
        <span style="color:#666;font-size:11px">Öffne jetzt dein Tracker-Tool</span>
      </div>
    `;

    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '88px',
      right: '24px',
      zIndex: '999999',
      background: '#151C2C',
      border: '1px solid rgba(163,255,18,0.4)',
      borderRadius: '14px',
      padding: '14px 16px',
      fontFamily: 'Inter, system-ui, sans-serif',
      boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      minWidth: '220px',
      animation: 'ops-fadein 0.3s ease'
    });

    // CSS Animation
    if (!document.getElementById('ops-style')) {
      const style = document.createElement('style');
      style.id = 'ops-style';
      style.textContent = `
        @keyframes ops-fadein {
          from { opacity:0; transform: translateY(10px); }
          to   { opacity:1; transform: translateY(0); }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(toast);

    // Auto-hide nach 5s
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.4s';
      setTimeout(() => toast.remove(), 400);
    }, 5000);
  }

  // ─── Warte bis Seite geladen (React-App!) ───────────────────────────────────

  function waitAndInject(attempts = 0) {
    const ready = document.body;

    if (ready || attempts > 30) {
      injectButton();
    } else {
      setTimeout(() => waitAndInject(attempts + 1), 300);
    }
  }

  waitAndInject();

  // Reagiere auf URL-Änderungen (SPA-Navigation)
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      window.__opsTrackerInjected = false;
      setTimeout(() => {
        window.__opsTrackerInjected = true;
        waitAndInject();
      }, 800);
    }
  }).observe(document.body, { subtree: true, childList: true });

})();
