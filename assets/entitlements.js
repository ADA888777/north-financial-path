/* ما تشمله باقة المشتركة: مميزاتها وروابطها وما تفوته.
   كل شيء من my_entitlements(): الرابط لا يصل المتصفح إن لم يكن
   الاشتراك نافذاً، فإخفاؤه هنا ليس هو الحماية. */
(function () {
  'use strict';
  var db = window.northDB;
  if (!db) return;

  var box = document.getElementById('ent');
  if (!box) return;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function num(n) {
    try { return new Intl.NumberFormat('ar-SA').format(n); } catch (e) { return String(n); }
  }

  var ICO = { feature: 'check_circle', channel: 'campaign', group: 'groups',
              training: 'videocam', note: 'info' };

  function row(f) {
    var ico = f.icon || ICO[f.kind] || 'check_circle';
    var body =
      '<span class="ms ent-i">' + esc(ico) + '</span>' +
      '<div class="ent-b"><b>' + esc(f.label) + '</b>' +
        (f.detail ? '<span>' + esc(f.detail) + '</span>' : '') + '</div>';

    if (f.url) {
      return '<a class="ent-r" href="' + esc(f.url) + '" target="_blank" rel="noopener">' +
        body + '<span class="ms go">open_in_new</span></a>';
    }
    if (f.locked) {
      return '<div class="ent-r off">' + body +
        '<span class="ent-lock">يظهر الرابط باشتراك نافذ</span></div>';
    }
    return '<div class="ent-r">' + body + '</div>';
  }

  function render(d) {
    var wrap = document.getElementById('ent-box');
    if (wrap) wrap.hidden = false;

    var feats = d.features || [];
    var up = d.upgrade || [];

    var head =
      '<div class="ent-head">' +
        '<div><span>باقتك</span><b>' + esc(d.plan || 'بلا باقة') + '</b></div>' +
        '<div><span>الحالة</span><b>' +
          (d.active ? '<span class="st-pill st-on">نافذ</span>'
                    : '<span class="st-pill st-off">غير نافذ</span>') + '</b></div>' +
        (d.days_left != null && d.active
          ? '<div><span>المتبقي</span><b>' + num(d.days_left) + ' يوماً</b></div>' : '') +
      '</div>';

    var counts =
      '<div class="ent-nums">' +
        '<div><b>' + num(d.lessons_open || 0) + '<i>/' + num(d.lessons_total || 0) + '</i></b>' +
          '<span>درساً متاحاً</span></div>' +
        '<div><b>' + num(d.strategies_open || 0) + '<i>/' + num(d.strategies_total || 0) + '</i></b>' +
          '<span>استراتيجية</span></div>' +
        '<div><b>' + num(d.private_quota || 0) + '</b><span>جلسة خاصة شهرياً</span></div>' +
      '</div>';

    var mine = feats.length
      ? '<div class="ent-list">' + feats.map(row).join('') + '</div>'
      : '<p class="ent-empty">لم تُسجَّل مميزات هذه الباقة بعد.</p>';

    var more = '';
    if (up.length) {
      more = up.map(function (u) {
        var items = (u.features || []).map(function (f) {
          return '<li><span class="ms">lock</span>' + esc(f.label) +
            (f.detail ? ' <i>' + esc(f.detail) + '</i>' : '') + '</li>';
        }).join('');
        return '<div class="ent-up"><h3>في باقة ' + esc(u.plan) + '</h3>' +
          (items ? '<ul>' + items + '</ul>' : '') +
          (u.checkout_url
            ? '<a class="btn btn-primary btn-sm" href="' + esc(u.checkout_url) +
              '" target="_blank" rel="noopener">رقِّ باقتك</a>'
            : '<p class="ent-empty">للترقية تواصلي مع إدارة المنصة.</p>') +
          '</div>';
      }).join('');
    }

    box.innerHTML = head + counts + mine + more;
  }

  db.rpc('my_entitlements').then(function (r) {
    var d = (r && r.data) || {};
    if (r.error || d.error) return;
    render(d);
  }).catch(function () {});
})();
