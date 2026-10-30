/* جرس التنبيهات. كل مستخدم تنبيهاته هو فقط بحكم RLS. */
(function () {
  'use strict';
  var db = window.northDB;
  if (!db) return;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function ago(iso) {
    try {
      var m = Math.round((Date.now() - new Date(iso)) / 60000);
      if (m < 1) return 'الآن';
      if (m < 60) return 'قبل ' + m + ' دقيقة';
      var h = Math.round(m / 60);
      if (h < 24) return 'قبل ' + h + ' ساعة';
      var d = Math.round(h / 24);
      if (d < 30) return 'قبل ' + d + ' يوم';
      return new Intl.DateTimeFormat('ar-SA-u-nu-latn', { dateStyle: 'medium' }).format(new Date(iso));
    } catch (e) { return ''; }
  }

  db.auth.getSession().then(function (r) {
    var s = r && r.data && r.data.session;
    if (!s) return;
    mount();
  }).catch(function () {});

  function mount() {
    var act = document.querySelector('.nav-act');
    if (!act || document.getElementById('bell')) return;

    var wrap = document.createElement('div');
    wrap.className = 'bell';
    wrap.id = 'bell';
    wrap.innerHTML =
      '<button class="bell-btn" id="bell-btn" type="button" aria-expanded="false" aria-label="التنبيهات">' +
        '<span class="ms sm">notifications</span>' +
      '</button>' +
      '<div class="bell-menu" id="bell-menu" hidden>' +
        '<div class="bell-h"><b>التنبيهات</b>' +
          '<button type="button" id="bell-read">تعليم الكل مقروءاً</button></div>' +
        '<div id="bell-list"></div>' +
      '</div>';

    var theme = act.querySelector('#theme-toggle');
    if (theme) act.insertBefore(wrap, theme.nextSibling);
    else act.insertBefore(wrap, act.firstChild);

    var btn = wrap.querySelector('#bell-btn');
    var menu = wrap.querySelector('#bell-menu');

    function close() { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = menu.hidden;
      menu.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) load();
    });
    document.addEventListener('click', function (e) {
      if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) close();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

    wrap.querySelector('#bell-read').addEventListener('click', function () {
      db.rpc('mark_notifications_read').then(function () { load(); });
    });

    load();
  }

  function load() {
    db.rpc('my_notifications', { p_limit: 30 }).then(function (r) {
      if (r.error) return;
      var rows = r.data || [];
      var unread = rows.filter(function (n) { return !n.read; }).length;

      var btn = document.getElementById('bell-btn');
      var dot = btn.querySelector('.bell-dot');
      if (unread) {
        if (!dot) {
          dot = document.createElement('span');
          dot.className = 'bell-dot';
          btn.appendChild(dot);
        }
        dot.textContent = unread > 9 ? '9+' : new Intl.NumberFormat('ar-SA-u-nu-latn').format(unread);
      } else if (dot) dot.remove();

      var list = document.getElementById('bell-list');
      if (!list) return;
      list.innerHTML = rows.length ? rows.map(function (n) {
        var inner = '<b>' + esc(n.title) + '</b>' +
          (n.body ? '<p>' + esc(n.body) + '</p>' : '') +
          '<time>' + esc(ago(n.created_at)) + '</time>';
        var cls = 'nrow' + (n.read ? '' : ' unread');
        return n.link
          ? '<a class="' + cls + '" href="' + esc(n.link) + '"' +
            (/^https?:/.test(n.link) ? ' target="_blank" rel="noopener noreferrer"' : '') +
            ' data-id="' + esc(n.id) + '">' + inner + '</a>'
          : '<div class="' + cls + '" data-id="' + esc(n.id) + '">' + inner + '</div>';
      }).join('')
        : '<div class="chat-empty"><span class="ms">notifications_off</span>لا توجد تنبيهات.</div>';

      list.querySelectorAll('[data-id]').forEach(function (row) {
        row.addEventListener('click', function () {
          db.rpc('mark_notifications_read', { p_ids: [row.getAttribute('data-id')] })
            .then(function () { load(); });
        });
      });
    });
  }
})();
