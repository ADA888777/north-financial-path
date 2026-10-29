/* أرقام الصفحة الرئيسية من المحتوى المنشور في القاعدة.
   كانت مكتوبة في الصفحة تحتها سطر «أرقام تجريبية لعرض التصميم»؛
   حذف السطر وحده يحوّلها إلى ادّعاء، فصارت تُحسب. */
(function () {
  'use strict';
  var db = window.northDB;
  var box = document.getElementById('figs');
  if (!db || !box) return;

  var AR = (function () {
    try { return new Intl.NumberFormat('ar-SA'); } catch (e) { return null; }
  })();

  db.rpc('public_stats').then(function (r) {
    var d = (r && r.data) || {};
    if (r.error || !d || d.error) { box.hidden = true; return; }

    var any = false;
    box.querySelectorAll('[data-fig]').forEach(function (n) {
      var v = d[n.getAttribute('data-fig')];
      if (v == null) return;
      n.textContent = AR ? AR.format(v) : String(v);
      if (v > 0) any = true;
    });
    // لا محتوى منشوراً بعد: لا تُعرض أصفار على أنها إنجاز
    if (!any) box.hidden = true;
  }).catch(function () { box.hidden = true; });
})();
