/**
 * sync-status.js — Live sync heartbeat indicator
 * Drop <script src="sync-status.js"></script> into any FleetPro page.
 * Requires window.sbClient (Supabase client) to be initialised first.
 * Injects a small pill into .sb-footer or a fixed badge if no sidebar.
 */
(function () {
  const SYNCS = [
    { key: 'rsa-ticket-sync',          label: 'RSA',        stale: 5  },
    { key: 'bike-location-sync',        label: 'Bikes',      stale: 5  },
    { key: 'fw-map-rider-sync',         label: 'FW Map',     stale: 35 },
    { key: 'fw-sheet-sync',             label: 'FW Sheet',   stale: 35 },
    { key: 'refresh-deployment-cache',  label: 'Deploy',     stale: 35 },
    { key: 'jc-history-sync',           label: 'JC',         stale: 65 },
    { key: 'metabase-sync',             label: 'Metabase',   stale: 65 },
  ];

  function minsAgo(ts) {
    return Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  }

  function fmtAge(m) {
    if (m < 60)  return m + 'm';
    if (m < 120) return '1h ' + (m % 60) + 'm';
    return Math.floor(m / 60) + 'h';
  }

  function buildUI(rows) {
    // Build latest-per-function map
    const latest = {};
    for (const row of rows) {
      if (!latest[row.function_name]) latest[row.function_name] = row;
    }

    const parts = SYNCS.map(s => {
      const row = latest[s.key];
      if (!row) return `<span class="ss-chip ss-stale" title="${s.key}: no data">⚠ ${s.label}</span>`;
      const m = minsAgo(row.synced_at);
      const stale = m > s.stale || row.status === 'error';
      const cls = stale ? 'ss-chip ss-stale' : 'ss-chip ss-ok';
      const tip = `${s.key}: ${row.status}, ${m}m ago`;
      return `<span class="${cls}" title="${tip}">${s.label} ${fmtAge(m)}</span>`;
    });

    return `<div id="ss-bar" style="
      display:flex;flex-wrap:wrap;gap:4px;padding:8px 12px 10px;
      border-top:1px solid rgba(255,255,255,.06);
    ">
      <style>
        .ss-chip{font-size:.6rem;font-weight:600;padding:2px 6px;border-radius:4px;white-space:nowrap;cursor:default}
        .ss-ok{background:rgba(20,184,166,.15);color:#2dd4bf}
        .ss-stale{background:rgba(239,68,68,.18);color:#f87171}
      </style>
      ${parts.join('')}
    </div>`;
  }

  async function load() {
    // Wait for sbClient to be ready (up to 3s)
    let waited = 0;
    while (!window.sbClient && waited < 3000) {
      await new Promise(r => setTimeout(r, 100));
      waited += 100;
    }
    if (!window.sbClient) return;

    try {
      const { data, error } = await window.sbClient
        .from('sync_heartbeats')
        .select('function_name, status, synced_at')
        .order('synced_at', { ascending: false })
        .limit(50);

      if (error || !data) return;

      const html = buildUI(data);

      // Inject into sidebar footer if present, else a fixed bottom-left badge
      const footer = document.querySelector('.sb-footer');
      if (footer) {
        footer.insertAdjacentHTML('afterbegin', html);
      } else {
        const wrap = document.createElement('div');
        wrap.style.cssText = `
          position:fixed;bottom:12px;left:12px;z-index:999;
          background:#1A1A2E;border:1px solid rgba(255,255,255,.1);
          border-radius:10px;max-width:260px;box-shadow:0 4px 16px rgba(0,0,0,.4);
        `;
        wrap.innerHTML = html;
        document.body.appendChild(wrap);
      }
    } catch (_) {}
  }

  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
