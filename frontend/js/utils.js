/* ==========================================================
   Recountix – Utilities
========================================================== */

function formatCurrency(amount) {
    return "₹" + Number(amount || 0).toLocaleString("en-IN");
}

function formatDate(date) {
    if (!date) return "-";
    try {
        return window.rxFormatDate ? window.rxFormatDate(date) : new Date(date).toLocaleDateString("en-IN");
    } catch (e) {
        return String(date);
    }
}

function todayISO() {
    return new Date().toISOString().split("T")[0];
}

function daysLeft(endDate) {
    if (!endDate) return null;
    const end = new Date(endDate);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    return Math.ceil((end - now) / (1000 * 60 * 60 * 24));
}

function computeSubStatus(endDate) {
    const d = daysLeft(endDate);
    if (d === null) return "unknown";
    if (d < 0) return "expired";
    if (d <= 15) return "expiring";
    return "active";
}

function statusBadge(status) {
    const map = {
        active: '<span class="badge badge-success">Active</span>',
        expiring: '<span class="badge badge-warning">Expiring</span>',
        expired: '<span class="badge badge-danger">Expired</span>',
        inactive: '<span class="badge badge-danger">Inactive</span>',
        unknown: '<span class="badge">—</span>'
    };
    return map[status] || map.unknown;
}

function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function showToast(msg, type) {
    type = type || "info";
    let el = document.getElementById("bkToast");
    if (!el) {
        el = document.createElement("div");
        el.id = "bkToast";
        el.className = "bk-toast";
        document.body.appendChild(el);
    }
    el.className = "bk-toast bk-toast-" + type + " show";
    el.textContent = msg;
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), 3200);
}

window.formatCurrency = formatCurrency;
window.formatDate = formatDate;
window.todayISO = todayISO;
window.daysLeft = daysLeft;
window.computeSubStatus = computeSubStatus;
window.statusBadge = statusBadge;
window.escapeHtml = escapeHtml;
window.showToast = showToast;


/* ========== Sidebar drawer V8: desktop sidebar + mobile drawer ========== */
(function () {
  function initDrawerV6() {
    var btn = document.getElementById('menuToggle');
    var sb = document.querySelector('.sidebar');
    var ov = document.getElementById('sidebarOverlay');
    var desktopMq = window.matchMedia ? window.matchMedia('(min-width: 641px), (hover: hover) and (pointer: fine)') : null;
    if (!btn || !sb) return;

    function isDesktop() {
      return desktopMq ? desktopMq.matches : window.innerWidth >= 641;
    }

    function setOpen(open) {
      var desktop = isDesktop();
      var active = desktop || !!open;

      sb.classList.toggle('open', active);
      sb.inert = !active;
      sb.setAttribute('aria-hidden', active ? 'false' : 'true');

      if (ov) ov.classList.toggle('show', !desktop && !!open);
      document.documentElement.classList.toggle('sidebar-open', !desktop && !!open);
      document.body.classList.toggle('sidebar-open', !desktop && !!open);
      document.body.style.overflow = (!desktop && open) ? 'hidden' : '';

      btn.setAttribute('aria-expanded', (!desktop && open) ? 'true' : 'false');
      btn.setAttribute('aria-label', (!desktop && open) ? 'Close menu' : 'Open menu');
    }

    window.closeRecountixDrawer = function () { setOpen(false); };

    // Desktop must keep side options active; mobile starts closed.
    setOpen(false);

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (isDesktop()) {
        var expanded = document.body.classList.toggle('rx-sidebar-expanded');
        btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        btn.setAttribute('aria-label', expanded ? 'Collapse sidebar' : 'Expand sidebar');
        return;
      }
      setOpen(!sb.classList.contains('open'));
    }, false);

    // The visual overlay never owns pointer input. Close only the mobile drawer
    // on outside pointer before the underlying page can react.
    document.addEventListener('pointerdown', function (e) {
      if (isDesktop() || !sb.classList.contains('open')) return;
      if (sb.contains(e.target) || btn.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }, true);

    // Do not intercept or manually rewrite sidebar URLs. Let the browser's
    // native anchor navigation resolve each href from the current page. The
    // previous forced-navigation handler could send taps to the wrong route
    // when pages are hosted under a nested path or a base URL is present.
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('.sidebar a[href]') : null;
      if (!a || !sb.contains(a)) return;
      var rawHref = (a.getAttribute('href') || '').trim();

      // Logout and placeholder links keep their existing click handlers.
      if (!rawHref || rawHref === '#' || /^javascript:/i.test(rawHref)) {
        window.setTimeout(function () { setOpen(false); }, 0);
        return;
      }

      // Only close the mobile drawer; do not preventDefault, rewrite href,
      // or stop the page's other legitimate link handlers.
      setOpen(false);
    }, true);

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (isDesktop()) {
        document.body.classList.remove('rx-sidebar-expanded');
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-label', 'Expand sidebar');
      } else {
        setOpen(false);
      }
    });

    if (desktopMq) {
      if (desktopMq.addEventListener) desktopMq.addEventListener('change', function () { setOpen(false); });
      else if (desktopMq.addListener) desktopMq.addListener(function () { setOpen(false); });
    }
    window.addEventListener('pageshow', function () { setOpen(false); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initDrawerV6, {once:true});
  else initDrawerV6();
})();

/* Premium ambient cursor effect — desktop pointer devices only. */
(function () {
  function initCursorFx() {
    if (!window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (document.querySelector('.cursor-ambient-glow')) return;

    var glow = document.createElement('div');
    glow.className = 'cursor-ambient-glow';
    glow.setAttribute('aria-hidden', 'true');
    document.body.appendChild(glow);

    var raf = 0, x = -500, y = -500;
    function paint() {
      raf = 0;
      glow.style.left = x + 'px';
      glow.style.top = y + 'px';
    }
    document.addEventListener('mousemove', function (e) {
      x = e.clientX; y = e.clientY;
      document.body.classList.add('cursor-fx-active');
      if (!raf) raf = requestAnimationFrame(paint);
    }, { passive: true });
    document.addEventListener('mouseleave', function () {
      document.body.classList.remove('cursor-fx-active');
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initCursorFx);
  else initCursorFx();
})();

/* One accessible viewport-bound modal for customer, business and renewal forms. */
(function () {
  let active=null, returnFocus=null;
  const closers={customerModal:'closeModal',shopModal:'closeShopModal',renewModal:'closeRenewModal'};
  function updateViewport() {
    const view=window.visualViewport;
    document.documentElement.style.setProperty('--rx-modal-height',(view?view.height:window.innerHeight)+'px');
    document.documentElement.style.setProperty('--rx-modal-top',(view?view.offsetTop:0)+'px');
  }
  function syncPage(open) {
    document.body.classList.toggle('rx-modal-active',open);
    const wrapper=document.querySelector('.wrapper');if(wrapper)wrapper.inert=open;
    const toggle=document.getElementById('menuToggle');if(toggle)toggle.inert=open;
  }
  function open(id) {
    const modal=document.getElementById(id);if(!modal)return;
    if(active && active!==modal)close(active.id);
    returnFocus=document.activeElement;
    if(window.closeRecountixDrawer)window.closeRecountixDrawer();
    // A transformed or clipped page ancestor must never position a fixed dialog.
    if(modal.parentElement!==document.body)document.body.append(modal);
    active=modal;updateViewport();
    modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');
    modal.setAttribute('aria-hidden','false');modal.classList.add('rx-modal-open');
    modal.style.setProperty('display','flex','important');syncPage(true);
    modal.querySelector('.modal-content')?.scrollTo(0,0);
    requestAnimationFrame(()=>{
      if(active!==modal)return;
      const field=modal.querySelector('input:not([type="hidden"]):not([disabled]),select:not([disabled]),textarea:not([disabled]),button');
      field?.focus({preventScroll:true});
    });
  }
  function close(id) {
    const modal=document.getElementById(id);if(!modal)return;
    modal.classList.remove('rx-modal-open');modal.style.setProperty('display','none','important');modal.setAttribute('aria-hidden','true');
    if(active===modal){active=null;syncPage(false);if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});returnFocus=null;}
  }
  function dismiss() {if(active){const fn=window[closers[active.id]];if(typeof fn==='function')fn();else close(active.id);}}
  function init() {
    Object.keys(closers).forEach(id=>{
      const modal=document.getElementById(id);if(!modal)return;
      const heading=modal.querySelector('h2');if(heading){if(!heading.id)heading.id=id+'Heading';modal.setAttribute('aria-labelledby',heading.id);}
      if(!modal.querySelector('.close,.rx-modal-close')){
        const button=document.createElement('button');button.type='button';button.className='rx-modal-close';button.textContent='×';button.setAttribute('aria-label','Close dialog');button.onclick=dismiss;
        modal.querySelector('.modal-content')?.prepend(button);
      }
      modal.setAttribute('aria-hidden','true');
    });
    // Associate existing labels with their next field without changing saved data.
    document.querySelectorAll('label:not([for])').forEach(label=>{
      const next=label.nextElementSibling;
      if(next?.matches('input,select,textarea') && next.id)label.htmlFor=next.id;
    });
    // Enter must not navigate away and discard the filled-in customer/recovery form.
    [['customerForm','saveCustomer'],['recoveryForm','saveRecovery']].forEach(([id,save])=>{
      document.getElementById(id)?.addEventListener('submit',event=>{event.preventDefault();window[save]?.();});
    });
    document.addEventListener('keydown',event=>{
      if(!active)return;
      if(event.key==='Escape'){event.preventDefault();dismiss();return;}
      if(event.key!=='Tab')return;
      const fields=[...active.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')].filter(el=>!el.disabled && el.tabIndex>=0 && el.getClientRects().length);
      const first=fields[0],last=fields[fields.length-1];
      if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
    });
    window.visualViewport?.addEventListener('resize',updateViewport);
    window.visualViewport?.addEventListener('scroll',updateViewport);
    window.addEventListener('resize',updateViewport);updateViewport();
  }
  window.RecountixModal={open,close};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();


/* Mobile drawer handler: capture the menu tap before older handlers can cancel/toggle it twice. */
(function () {
  if (window.__rxMobileNavFixV2) return;
  window.__rxMobileNavFixV2 = true;
  function mobile() { return window.matchMedia ? window.matchMedia('(max-width: 767px)').matches : window.innerWidth < 768; }
  function drawer(open) {
    var side = document.querySelector('.sidebar');
    var overlay = document.getElementById('sidebarOverlay');
    var btn = document.getElementById('menuToggle');
    if (!side) return;
    var show = mobile() && !!open;
    side.classList.toggle('open', show);
    side.setAttribute('aria-hidden', mobile() && !show ? 'true' : 'false');
    if ('inert' in side) side.inert = mobile() && !show;
    if (overlay) overlay.classList.toggle('show', show);
    document.documentElement.classList.toggle('sidebar-open', show);
    document.body.classList.toggle('sidebar-open', show);
    document.body.style.overflow = show ? 'hidden' : '';
    if (btn) {
      btn.setAttribute('aria-expanded', show ? 'true' : 'false');
      btn.setAttribute('aria-label', show ? 'Close menu' : 'Open menu');
      btn.textContent = show ? '✕' : '☰';
    }
  }
  function init() {
    if (!document.getElementById('menuToggle') || !document.querySelector('.sidebar')) return;
    drawer(false);
    /* Capture phase + stopImmediatePropagation prevents a legacy listener toggling twice. */
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('#menuToggle') : null;
      if (btn) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!mobile()) {
          var expanded = document.body.classList.toggle('rx-sidebar-expanded');
          btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
          btn.setAttribute('aria-label', expanded ? 'Collapse sidebar' : 'Expand sidebar');
          btn.textContent = expanded ? '✕' : '☰';
          return;
        }
        drawer(!document.querySelector('.sidebar').classList.contains('open'));
        return;
      }
      if (e.target && e.target.closest && e.target.closest('#sidebarOverlay')) {
        drawer(false);
        return;
      }
      var link = e.target && e.target.closest ? e.target.closest('.sidebar a[href]') : null;
      if (link) drawer(false);
    }, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') drawer(false); });
    window.addEventListener('resize', function () { if (!mobile()) drawer(false); });
    window.addEventListener('pageshow', function () { drawer(false); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();
})();


/* Inline menu-button compatibility for mobile pages using onclick="rxForceToggleMenu(event)". */
window.rxForceToggleMenu = function (event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
  }
  var side = document.querySelector('.sidebar');
  var overlay = document.getElementById('sidebarOverlay');
  var btn = document.getElementById('menuToggle');
  if (!side) return;

  // Pages with the legacy inline handler stop the shared document listener.
  // Handle desktop expansion here too, otherwise the hamburger only works on mobile.
  if (window.matchMedia && window.matchMedia('(min-width: 768px)').matches) {
    var expanded = document.body.classList.toggle('rx-sidebar-expanded');
    if (btn) {
      btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      btn.setAttribute('aria-label', expanded ? 'Collapse sidebar' : 'Expand sidebar');
      btn.textContent = expanded ? '✕' : '☰';
    }
    return;
  }

  var opening = !side.classList.contains('rx-force-open');
  side.classList.toggle('rx-force-open', opening);
  side.classList.toggle('open', opening);
  side.setAttribute('aria-hidden', opening ? 'false' : 'true');
  if ('inert' in side) side.inert = !opening;
  if (overlay) {
    overlay.classList.toggle('rx-force-show', opening);
    overlay.classList.toggle('show', opening);
  }
  document.documentElement.classList.toggle('sidebar-open', opening);
  document.body.classList.toggle('sidebar-open', opening);
  document.body.style.overflow = opening ? 'hidden' : '';
  if (btn) {
    btn.setAttribute('aria-expanded', opening ? 'true' : 'false');
    btn.setAttribute('aria-label', opening ? 'Close menu' : 'Open menu');
    btn.textContent = opening ? '✕' : '☰';
  }
};


/* Recountix — Desktop sidebar hit-target + WhatsApp route guard (2026-10-15). */
(function () {
  'use strict';
  if (window.__rxDesktopSidebarWhatsAppFix20261015) return;
  window.__rxDesktopSidebarWhatsAppFix20261015 = true;

  function installStyles() {
    if (document.getElementById('rxSidebarHitTargetFix20261015')) return;
    var style = document.createElement('style');
    style.id = 'rxSidebarHitTargetFix20261015';
    style.textContent = [
      '.sidebar .menu { display:block!important; position:relative!important; isolation:isolate!important; }',
      '.sidebar .menu > li { display:block!important; position:relative!important; float:none!important; clear:both!important; width:100%!important; min-width:0!important; min-height:44px!important; margin:2px 0!important; padding:0!important; isolation:isolate!important; }',
      '.sidebar .menu > li > a { position:relative!important; display:flex!important; width:100%!important; min-width:0!important; min-height:44px!important; box-sizing:border-box!important; z-index:1!important; pointer-events:auto!important; touch-action:manipulation!important; }',
      '.sidebar .menu > li > a > i, .sidebar .menu > li > a > span { pointer-events:none!important; }',
      '.sidebar .menu > li + li { margin-top:3px!important; }',
      '@media (min-width:768px) { .sidebar { pointer-events:auto!important; } .sidebar .menu > li > a { cursor:pointer!important; } }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
  }

  function routeWhatsApp(event) {
    var target = event.target;
    if (!target || !target.closest) return;
    var link = target.closest('.sidebar .menu a[href]');
    if (!link) return;
    var href = (link.getAttribute('href') || '').trim();
    var label = (link.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    var destination;
    try { destination = new URL(href, document.baseURI); } catch (_) { return; }
    var isWhatsAppLabel = label === 'whatsapp integration' || label === 'whatsapp api';
    var isWhatsAppPath = destination.pathname.replace(/\/+$/, '').split('/').pop().toLowerCase() === 'whatsapp.html';
    if (!isWhatsAppLabel && !isWhatsAppPath) return;

    /*
     * The label is the authoritative intent for the WhatsApp menu item.
     * Older pages have had a WhatsApp-labelled anchor accidentally pointing
     * at field-tracking.html. Do not faithfully navigate to that wrong href:
     * resolve the intended page beside the current frontend page instead.
     */
    if (isWhatsAppLabel && !isWhatsAppPath) {
      try { destination = new URL('whatsapp.html', window.location.href); } catch (_) { return; }
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    window.location.assign(destination.href);
  }

  function boot() {
    installStyles();
    document.addEventListener('click', routeWhatsApp, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
