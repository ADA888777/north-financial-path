/* ما تشمله باقة المشتركة، ومقارنة الباقات — قسمان منفصلان عمداً.

   الأول يقول «باقتك» ويأتي من اشتراكها المسجّل في القاعدة.
   الثاني يستعرض كل الباقات للمقارنة ويُعلّم باقتها بينها، كي لا
   يختلط استعراضُ باقة بامتلاكها.

   كل شيء من my_entitlements() و public_plans(): رابط الميزة لا يصل
   المتصفح أصلاً إن لم يكن الاشتراك نافذاً، فإخفاؤه هنا ليس هو الحماية. */
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

  /* ---------- القسم الأول: باقتك أنت ---------- */
  function mine(d) {
    var feats = d.features || [];

    /* اسم باقتها لا صفّ له في جدول الباقات: إعداد ناقص في اللوحة.
       عرضها كأدنى الباقات بصمت هو ما كان يخلط الأمر على المشتركة. */
    var unknown = d.plan && d.plan_known === false;

    var head =
      '<div class="ent-mine">' +
        '<div class="ent-cur">' +
          '<span class="ent-cur-l">باقتك الحالية</span>' +
          '<b class="ent-cur-v">' + esc(d.plan || 'بلا باقة') + '</b>' +
          (d.plan_badge ? '<span class="nchip blue">' + esc(d.plan_badge) + '</span>' : '') +
        '</div>' +
        '<div class="ent-meta">' +
          '<div><span>الحالة</span><b>' +
            (d.active ? '<span class="st-pill st-on">نافذ</span>'
                      : '<span class="st-pill st-off">غير نافذ</span>') + '</b></div>' +
          (d.days_left != null && d.active
            ? '<div><span>المتبقي</span><b>' + num(d.days_left) + ' يوماً</b></div>' : '') +
        '</div>' +
      '</div>';

    var warn = unknown
      ? '<p class="ent-warn"><span class="ms">report</span>' +
        'باقتك مسجّلة باسم «' + esc(d.plan) + '» ولا يطابقه أي صفّ في جدول الباقات، ' +
        'فلم تُحتسب صلاحياتها. أبلغي إدارة المنصة لتصحيح الإعداد.</p>'
      : '';

    var counts =
      '<div class="ent-nums">' +
        '<div><b>' + num(d.lessons_open || 0) + '<i>/' + num(d.lessons_total || 0) + '</i></b>' +
          '<span>درساً متاحاً</span></div>' +
        '<div><b>' + num(d.strategies_open || 0) + '<i>/' + num(d.strategies_total || 0) + '</i></b>' +
          '<span>استراتيجية</span></div>' +
        '<div><b>' + num(d.private_quota || 0) + '</b><span>جلسة خاصة شهرياً</span></div>' +
      '</div>';

    var list = feats.length
      ? '<div class="ent-list">' + feats.map(row).join('') + '</div>'
      : '<p class="ent-empty">لم تُسجَّل مميزات هذه الباقة بعد.</p>';

    return head + warn + counts + list;
  }

  /* ---------- القسم الثاني: مقارنة الباقات ----------
     استعراض لكل الباقات، باقتها معلَّمة بينها. منفصل عن الأعلى
     بعنوان صريح حتى لا تُقرأ باقةٌ معروضة على أنها باقتها. */
  function compare(plans, d) {
    if (!plans.length) return '';

    var myTier = d.plan_tier == null ? -1 : Number(d.plan_tier);

    var cards = plans.map(function (p) {
      var isMine = d.plan_id ? (p.id === d.plan_id) : (p.name === d.plan);
      var higher = Number(p.tier) > myTier;

      /* دلالة العلامة: ✓ ما تملكه، 🔒 ما في باقة أعلى لا تشمله باقتها،
         ونقطة محايدة لباقة أدنى — تلك قائمة تلك الباقة، لا حكمٌ على وصولها. */
      var mark = isMine ? 'check_circle' : (higher ? 'lock' : 'circle');
      var items = (p.features || []).map(function (f) {
        return '<li><span class="ms' + (mark === 'circle' ? ' dot' : '') + '">' + mark + '</span>' +
          esc(f.label) + (f.detail ? ' <i>' + esc(f.detail) + '</i>' : '') + '</li>';
      }).join('');

      return '<div class="cmp' + (isMine ? ' is-mine' : '') + '">' +
        '<div class="cmp-h">' +
          '<b>' + esc(p.name) + '</b>' +
          (isMine ? '<span class="nchip ok">باقتك</span>' : '') +
        '</div>' +
        (p.price_sar != null
          ? '<p class="cmp-p">' + num(p.price_sar) + ' <i>ر.س</i>' +
            (p.duration_days ? ' <span>لكل ' + num(p.duration_days) + ' يوماً</span>' : '') + '</p>'
          : '') +
        (p.description ? '<p class="cmp-d">' + esc(p.description) + '</p>' : '') +
        (items ? '<ul class="cmp-f">' + items + '</ul>'
               : '<p class="ent-empty">لم تُسجَّل مميزات هذه الباقة بعد.</p>') +
        (!isMine && higher
          ? (p.checkout_url
              ? '<a class="nbtn nbtn-p nbtn-sm" href="' + esc(p.checkout_url) +
                '" target="_blank" rel="noopener">اشتركي في ' + esc(p.name) + '</a>'
              : '<p class="ent-empty">للترقية تواصلي مع إدارة المنصة.</p>')
          : '') +
      '</div>';
    }).join('');

    return '<div class="ent-sep"><h3>مقارنة الباقات</h3>' +
      '<p>استعراض لما تشمله كل باقة. باقتك معلَّمة بينها.</p></div>' +
      '<div class="cmp-grid">' + cards + '</div>';
  }

  function render(d, plans) {
    var wrap = document.getElementById('ent-box');
    if (wrap) wrap.hidden = false;
    box.innerHTML = mine(d) + compare(plans, d);
  }

  Promise.all([db.rpc('my_entitlements'), db.rpc('public_plans')])
    .then(function (r) {
      var d = (r[0] && r[0].data) || {};
      if (r[0].error || d.error) return;
      var plans = (r[1] && r[1].data) || [];
      render(d, Array.isArray(plans) ? plans : []);
    }).catch(function () {});
})();
