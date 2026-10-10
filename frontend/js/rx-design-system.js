/* Recountix design system helpers: icon-first expand buttons + collapsible sidebar rail.
   Purely presentational — no existing IDs, handlers or data logic are touched. */
(function () {
  'use strict';
  var KEY = 'rx_sidebar_collapsed';

  // 1) Icon-first buttons: wrap the visible text in .rx-label so CSS can slide it out on hover.
  function expandify(root) {
    (root || document).querySelectorAll('.topbar .add-btn, .summary-bar .add-btn, [data-rx-expand]').forEach(function (btn) {
      if (btn.classList.contains('rx-expand') || btn.tagName === 'LABEL') return;
      var icon = btn.querySelector('i, svg');
      if (!icon) return;                                   // text-only buttons stay as they are
      var text = '';
      Array.prototype.slice.call(btn.childNodes).forEach(function (n) {
        if (n.nodeType === 3 && n.textContent.trim()) { text += n.textContent.trim() + ' '; n.parentNode.removeChild(n); }
      });
      text = text.trim();
      if (!text) return;
      var label = document.createElement('span');
      label.className = 'rx-label';
      label.textContent = text;
      btn.appendChild(label);
      btn.classList.add('rx-expand');
      if (!btn.getAttribute('aria-label')) btn.setAttribute('aria-label', text);
      if (!btn.title) btn.title = text;
    });
  }

  // 2) Sidebar rail (desktop): add a collapse control, remember the choice, add tooltips for icon-only mode.
  function sidebar() {
    var menu = document.querySelector('.sidebar .menu');
    if (!menu || menu.querySelector('.rx-collapse-btn')) return;
    menu.querySelectorAll('a').forEach(function (a) {
      var s = a.querySelector('.rx-sidebar-label, span');
      if (!s) {
        // Wrap plain link text so collapsed mode can hide labels without hiding icons.
        Array.prototype.slice.call(a.childNodes).forEach(function (n) {
          if (n.nodeType === 3 && n.textContent.trim()) {
            var label = document.createElement('span');
            label.className = 'rx-sidebar-label';
            label.textContent = n.textContent.replace(/\\s+/g, ' ').trim();
            a.replaceChild(label, n);
          }
        });
        s = a.querySelector('.rx-sidebar-label, span');
      }
      if (s && !a.title) a.title = s.textContent.trim();
    });
    var li = document.createElement('li');
    li.className = 'rx-collapse-btn';
    li.innerHTML = '<button type="button" aria-label="Collapse sidebar" title="Collapse sidebar"><i class="fa-solid fa-angles-left"></i><span>Collapse</span></button>';
    menu.appendChild(li);
    var btn = li.firstChild;
    function apply(on) {
      document.body.classList.toggle('rx-collapsed', on);
      btn.setAttribute('aria-label', on ? 'Expand sidebar' : 'Collapse sidebar');
      btn.title = on ? 'Expand sidebar' : 'Collapse sidebar';
    }
    var saved = false;
    try { saved = localStorage.getItem(KEY) === '1'; } catch (e) {}
    apply(saved);
    btn.addEventListener('click', function () {
      var on = !document.body.classList.contains('rx-collapsed');
      apply(on);
      try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
    });
  }

  function init() { sidebar(); expandify(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
