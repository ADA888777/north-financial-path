/* الصفحة الرئيسية: أرقامها من المحتوى المنشور، لا من HTML.

   كانت مكتوبة في الصفحة («١٤ درساً · ٣ ساعات · ٤ اختبارات») تحتها
   سطر «أرقام تجريبية لعرض التصميم». حذف السطر وحده يحوّلها إلى
   ادّعاء، فصارت تُقرأ من public_stats() — وما لا تسنده القاعدة
   لا يُعرض: البطاقة تُخفى، ولا تبقى شرطة ولا صفر.

   والكلمة تتبع الرقم لا تسبقه: «٣ اختبارات» و«١٥ اختباراً» ليستا
   بصيغة واحدة في العربية، فلو ثُبّتت الكلمة في HTML لصار النص
   غلطاً نحوياً عند أول اختبارٍ تضيفه الإدارة.

   أمّا بطاقة المستويات فرقمها ثابتٌ في الصفحة بطلب العميلة: العرض
   التسويقي ثلاثة مستويات وإن كان المنشور أكثر. فلا تمرّ من هنا. */
(function () {
  'use strict';
  var db = window.northDB;
  var figs = document.getElementById('figs');
  if (!db || !figs) return;

  var AR = (function () {
    try { return new Intl.NumberFormat('ar-SA-u-nu-latn'); } catch (e) { return null; }
  })();
  function n(v) { return AR ? AR.format(v) : String(v); }

  /* [مفرد، مثنى، جمع ٣-١٠، مفرد منصوب ١١+]
     «اختبارات وتطبيقات» اسم فئة لا معدوداً، فلا تصريف له. */
  var WORDS = {};
  function word(key, v) {
    var w = WORDS[key];
    if (!w) return null;
    return v === 1 ? w[0] : v === 2 ? w[1] : v <= 10 ? w[2] : w[3];
  }

  db.rpc('public_stats').then(function (r) {
    var d = (r && r.data) || {};
    if (r.error || !d || d.error) {
      figs.querySelectorAll('[data-fig-card]').forEach(function (c) { c.hidden = true; });
      return;
    }

    /* «اختبارات وتطبيقات»: الاختبارات المنشورة ودروس الاستراتيجيات
       معاً. رقمٌ محسوب من المنشور لا تقريبٌ مكتوب في الصفحة —
       ينمو وحده كلما نشرت الإدارة اختباراً أو استراتيجية. */
    d.practice = (Number(d.quizzes) || 0) + (Number(d.strategies) || 0);

    /* البطاقة الفارغة وحدها تُخفى، لا الصفّ كلّه: فيه بطاقتان
       ثابتتان لا تعتمدان على القاعدة، وإخفاء الصفّ يُذهبهما معاً. */
    figs.querySelectorAll('[data-fig]').forEach(function (el) {
      var key = el.getAttribute('data-fig');
      var v = d[key];
      var card = el.closest('[data-fig-card]');
      if (!v) { if (card) card.hidden = true; return; }   // صفرٌ ليس إنجازاً يُعلن
      el.textContent = n(v);
      var lbl = card && card.querySelector('[data-fig-word="' + key + '"]');
      var w = word(key, v);
      if (lbl && w) lbl.textContent = w;
    });
  }).catch(function () {
    figs.querySelectorAll('[data-fig-card]').forEach(function (c) { c.hidden = true; });
  });
})();
