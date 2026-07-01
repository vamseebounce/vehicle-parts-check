/* ── FleetPro shared sidebar ─────────────────────────────────────────────
 * ONE source of truth for the sidebar across all v8 pages.
 * Usage on a page:
 *   <div id="ov"></div>
 *   <nav id="sb"></nav>
 *   ... topbar with <button id="hbg" onclick="toggleSidebar()">
 *   <script src="./sidebar.js"></script>   (place near end of <body>, runs synchronously)
 *
 * Injects the canonical markup, auto-marks the active item from the URL, and
 * defines toggleSidebar/togglePin/closeSidebar globally so the static #hbg works
 * on every page (including ones that had no pin logic). data-feature gating is
 * unchanged — each page's permission code still runs querySelectorAll('[data-feature]')
 * AFTER this synchronous injection, so injected items get gated normally.
 * Settings button calls window.openSettings() if the page defines it, else hides.
 * ──────────────────────────────────────────────────────────────────────── */
(function(){
  var page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  if (!page || page === '') page = 'index.html';

  // Canonical sidebar sections. Each item: href, icon, label, and optional feature (data-feature gate).
  var SECTIONS = [
    { label:'Fleet Tools', items:[
      { href:'./index.html', icon:'🏠', label:'Home' },
    ]},
    { label:'Service Operations', items:[
      { href:'./maintenance.html', icon:'🔧', label:'Preventive Maintenance', feature:'maintenance' },
      { href:'./queue.html',       icon:'📋', label:'OOS Queue',              feature:'oos-queue' },
    ]},
    { label:'Hub Operations', items:[
      { href:'./deployment.html',  icon:'🚲', label:'Deployment Queue',       feature:'deployment' },
    ]},
    { label:'RSA Operations', items:[
      { href:'./fw-map.html',      icon:'🗺️', label:'FW Pending Map',         feature:'fw-map' },
      { href:'./rsa.html',         icon:'🦺', label:'RSA Warroom',            feature:'rsa-warroom' },
    ]},
    { label:'Recovery Operations', feature:'trace-ho', items:[
      { href:'./trace-ho.html',    icon:'🎯', label:'Trace',                  feature:'trace-ho' },
      { href:'./trace-hunter.html',icon:'📱', label:'Hunter',                 feature:'trace-hunter' },
    ]},
    { label:'Incentives', feature:'incentive-tech', items:[
      { href:'./incentive.html',   icon:'🏆', label:'Technician Incentives',  feature:'incentive-tech' },
    ]},
    { label:'Admin', feature:'admin-panel', mt:8, items:[
      { href:'./admin-techs.html',       icon:'👤', label:'Manage Technicians', feature:'admin-panel' },
      { href:'./admin-permissions.html', icon:'🔐', label:'Permissions',        feature:'admin-panel' },
      { href:'./jc-approval.html',       icon:'🔧', label:'JC Approval Check',  feature:'admin-panel' },
      { href:'./admin-analytics.html',   icon:'📊', label:'Analytics',          feature:'admin-panel' },
    ]},
    { label:'Coming Soon', mt:8, items:[
      { disabled:true, icon:'📈', label:'Fleet Analytics' },
      { disabled:true, icon:'🔔', label:'Alert Centre' },
    ]},
  ];

  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function itemHtml(it){
    var feat = it.feature ? ' data-feature="'+esc(it.feature)+'"' : '';
    var icon = '<span class="si">'+it.icon+'</span><span>'+esc(it.label)+'</span>';
    if (it.disabled) return '<div class="sb-item" style="opacity:.4;cursor:default"'+feat+'>'+icon+'</div>';
    var active = (it.href.replace('./','').toLowerCase() === page) ? ' active' : '';
    return '<a href="'+esc(it.href)+'" class="sb-item'+active+'"'+feat+'>'+icon+'</a>';
  }

  function sectionHtml(sec, i){
    var feat = sec.feature ? ' data-feature="'+esc(sec.feature)+'"' : '';
    var mt = (i>0) ? (' style="margin-top:'+(sec.mt||4)+'px"') : '';
    return '<div class="sb-section"'+mt+feat+'>'
      + '<div class="sb-label">'+esc(sec.label)+'</div>'
      + sec.items.map(itemHtml).join('')
      + '</div>';
  }

  var html = ''
    + '<div class="sb-header">'
    +   '<a href="./index.html" class="sb-brand">'
    +     '<img src="logo.jpg" width="44" height="44" style="border-radius:10px;object-fit:cover;flex-shrink:0"/>'
    +     '<div class="sb-brand-text"><div class="t1">Bounce Daily</div><div class="t2">FleetPro</div></div>'
    +   '</a>'
    +   '<button class="pin-btn" id="pinBtn" onclick="togglePin()" title="Pin sidebar">'
    +     '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2v10M8 6l4-4 4 4M8 18l4 4 4-4M12 12v10"/></svg> Pin'
    +   '</button>'
    + '</div>'
    + SECTIONS.map(sectionHtml).join('')
    + '<div class="sb-spacer"></div>'
    + '<div class="sb-section" style="margin-top:0;padding-top:4px" id="sb-settings-wrap">'
    +   '<button class="sb-item" onclick="(window.openSettings||function(){})()" style="width:100%;background:none;border:none;cursor:pointer;text-align:left"><span class="si">⚙️</span><span>Settings</span></button>'
    + '</div>'
    + '<div class="sb-footer"><div class="sb-ver">FleetPro v8 · Data synced hourly</div></div>';

  // Canonical dark theme — overrides each page's own sidebar COLORS so the sidebar
  // looks identical everywhere (fixes the dark-vs-white drift). Colour-only and scoped
  // to "#sb ..." (id+class specificity beats page rules); layout (position/width/z-index/
  // overlays) stays owned by each page's CSS, so page layering is never touched.
  var THEME = ''
    + '#sb{background:#1A1A2E}'
    + '#sb .sb-header{border-bottom:1px solid rgba(255,255,255,.06)}'
    + '#sb .sb-brand-text .t1{color:rgba(255,255,255,.5)}'
    + '#sb .sb-brand-text .t2{color:#fff}'
    + '#sb .pin-btn{color:rgba(255,255,255,.35)}'
    + '#sb .pin-btn:hover{color:#fff;background:rgba(255,255,255,.08)}'
    + '#sb .pin-btn.pinned{color:#E8191C}'
    + '#sb .sb-label{color:rgba(255,255,255,.25)}'
    + '#sb .sb-item{color:rgba(255,255,255,.7)}'
    + '#sb .sb-item:hover{background:rgba(255,255,255,.08);color:#fff}'
    + '#sb .sb-item.active{background:rgba(232,25,28,.18);color:#fff}'
    + '#sb .sb-item.active .si{color:#E8191C}'
    + '#sb .sb-footer{border-top:1px solid rgba(255,255,255,.06)}'
    + '#sb .sb-ver{color:rgba(255,255,255,.25)}';

  function injectStyle(){
    if (document.getElementById('sb-shared-theme')) return;
    var st = document.createElement('style');
    st.id = 'sb-shared-theme';
    st.textContent = THEME;
    document.head.appendChild(st);  // last in <head> → wins equal-specificity #sb{...}
  }

  function inject(){
    var sb = document.getElementById('sb');
    if (!sb) return;
    injectStyle();
    sb.innerHTML = html;
    // Hide Settings if the page doesn't implement it
    if (typeof window.openSettings !== 'function') {
      var w = document.getElementById('sb-settings-wrap'); if (w) w.style.display='none';
    }
  }

  // ── Sidebar open/pin behavior (self-contained; overrides any per-page copies) ──
  var sbOpen = false;
  var pinned = localStorage.getItem('sb_pinned') === '1';
  function $(id){ return document.getElementById(id); }
  function applyPin(){
    var sb=$('sb'), pb=$('pinBtn'), ov=$('ov');
    if(!sb) return;
    if(pinned){ document.body.classList.add('pinned'); if(pb){pb.classList.add('pinned');pb.title='Unpin sidebar';} if(ov)ov.classList.remove('show'); sb.classList.add('open'); sbOpen=true; }
    else { document.body.classList.remove('pinned'); if(pb){pb.classList.remove('pinned');pb.title='Pin sidebar';} }
  }
  window.toggleSidebar = function(){ if(pinned){window.togglePin();return;} sbOpen=!sbOpen; var sb=$('sb'),ov=$('ov'); if(sb)sb.classList.toggle('open',sbOpen); if(ov)ov.classList.toggle('show',sbOpen); };
  window.closeSidebar  = function(){ if(pinned)return; sbOpen=false; var sb=$('sb'),ov=$('ov'); if(sb)sb.classList.remove('open'); if(ov)ov.classList.remove('show'); };
  window.togglePin     = function(){ pinned=!pinned; localStorage.setItem('sb_pinned',pinned?'1':'0'); applyPin(); if(!pinned){sbOpen=false; var sb=$('sb'); if(sb)sb.classList.remove('open');} };

  inject();
  var ov=$('ov'); if(ov) ov.addEventListener('click', window.closeSidebar);
  applyPin();
})();
