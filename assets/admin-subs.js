/* حالة الاشتراكات: من انتهى ومن قارب، وتوزّع الأعضاء على الباقات.
   الحالة محسوبة في الخادم من تاريخ الانتهاء لا من العمود المخزّن. */
(function () {
  'use strict';
  var A = window.northAdmin;
  if (!A) return;
  var db = A.db, el = A.el, esc = A.esc;

  var panel = document.querySelector('[data-panel="subs"]');
  if (!panel) return;

  var data = null;

  var BUCKET = {
    expired: { t: 'منتهٍ',        c: 'tag-off' },
    soon:    { t: 'ينتهي قريباً', c: 'tag-warn' },
    ok:      { t: 'نافذ',         c: 'tag-ok' },
    open:    { t: 'بلا نهاية',    c: 'tag-ok' }
  };
  var STATUS = { active: 'نافذ', expired: 'منتهٍ', cancelled: 'ملغى', inactive: 'غير مفعّل' };

  function kpis() {
    var c = panel.querySelectorAll('#sb-kpis .kpi b');
    if (c.length < 4 || !data) return;
    var counts = data.counts || {};
    var soon = (data.rows || []).filter(function (r) { return r.bucket === 'soon'; }).length;
    c[0].textContent = counts.active || 0;
    c[1].textContent = soon;
    c[2].textContent = counts.expired || 0;
    c[3].textContent = (counts.inactive || 0) + (counts.cancelled || 0);
  }

  function plans() {
    var rows = data.by_plan || [];
    el('sb-plans').innerHTML = rows.length
      ? '<div class="sb-plans">' + rows.map(function (p) {
          return '<div class="sb-plan"><b>' + esc(p.plan || 'بلا باقة') + '</b>' +
            '<span>' + esc(p.members) + ' عضواً' +
            (p.tier ? ' · الرتبة ' + esc(p.tier) : ' · غير معتمدة') + '</span></div>';
        }).join('') + '</div>'
      : '';
  }

  function list() {
    var rows = data.rows || [];
    var box = el('sb-list');
    if (!rows.length) {
      box.innerHTML = '<div class="state"><span class="ms">check_circle</span>' +
        'كل الاشتراكات نافذة ولا شيء يقترب من الانتهاء.</div>';
      kpis(); return;
    }

    var order = { expired: 0, soon: 1, open: 2, ok: 3 };
    rows = rows.slice().sort(function (a, b) {
      return (order[a.bucket] - order[b.bucket]) ||
             ((a.days_left == null ? 9999 : a.days_left) - (b.days_left == null ? 9999 : b.days_left));
    });

    box.innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
      '<th>العضو</th><th>رقم العضوية</th><th>الباقة</th><th>الحالة</th>' +
      '<th>ينتهي</th><th>المتبقي</th><th></th></tr></thead><tbody>' +
      rows.map(function (r) {
        var b = BUCKET[r.bucket] || BUCKET.ok;
        var left = r.days_left == null ? '—'
          : (r.days_left < 0 ? 'انتهى منذ ' + Math.abs(r.days_left) + ' يوماً'
                             : r.days_left + ' يوماً');
        return '<tr class="sb-' + esc(r.bucket) + '">' +
          '<td><b>' + esc(r.name || '—') + '</b>' +
            (r.account_status !== 'active' ? ' <span class="tag tag-off">موقوف</span>' : '') + '</td>' +
          '<td><span class="num">' + esc(r.membership_no || '—') + '</span></td>' +
          '<td>' + esc(r.plan || '—') + (r.tier ? '' : ' <span class="tag tag-off">غير معتمدة</span>') + '</td>' +
          '<td><span class="tag ' + b.c + '">' + esc(STATUS[r.status] || r.status) + '</span></td>' +
          '<td class="muted">' + (r.expires_at ? esc(A.fmtDate(r.expires_at)) : '—') + '</td>' +
          '<td class="num">' + esc(left) + '</td>' +
          '<td class="row-acts">' +
            '<button class="bt bt-ghost bt-sm" type="button" data-sb-sub="' + esc(r.id) + '">الاشتراك</button>' +
          '</td></tr>';
      }).join('') + '</tbody></table></div>';
    kpis();
  }

  function load() {
    el('sb-list').innerHTML =
      '<div class="state"><span class="ms">hourglass_top</span>جارٍ التحميل…</div>';
    return db.rpc('admin_subscription_report', {
      p_soon: parseInt(el('sb-days').value, 10) || 14
    }).then(function (r) {
      if (r.error) {
        el('sb-list').innerHTML = '<div class="state"><span class="ms">error</span>' +
          esc(r.error.message) + '</div>';
        return;
      }
      data = r.data || {};
      plans(); list();
    });
  }

  el('sb-days').addEventListener('change', load);
  el('sb-list').addEventListener('click', function (e) {
    var b = e.target.closest('[data-sb-sub]');
    if (b && window.northSub) window.northSub.open(b.getAttribute('data-sb-sub'), load);
  });

  A.guard().then(function (s) { if (s) load(); });
})();
