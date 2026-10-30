/* الصفحة الرئيسية: أرقامها من المحتوى المنشور، لا من HTML.

   كانت مكتوبة في الصفحة («١٤ درساً · ٣ ساعات · ٤ اختبارات») تحتها
   سطر «أرقام تجريبية لعرض التصميم». حذف السطر وحده يحوّلها إلى
   ادّعاء، فصارت تُقرأ من public_stats() — وما لا تسنده القاعدة
   لا يُعرض: البطاقة تُخفى، ولا تبقى شرطة ولا صفر.

   والكلمة تتبع الرقم لا تسبقه: «٣ مستويات» و«١٥ مستوى» ليستا
   بصيغة واحدة في العربية، فلو ثُبّتت الكلمة في HTML لصار النص
   غلطاً نحوياً عند أول مستوى تضيفه الإدارة. */
(function () {
  'use strict';
  var db = window.northDB;
  var figs = document.getElementById('figs');
  if (!db || !figs) return;

  var AR = (function () {
    try { return new Intl.NumberFormat('ar-SA-u-nu-latn'); } catch (e) { return null; }
  })();
  function n(v) { return AR ? AR.format(v) : String(v); }

  /* [مفرد، مثنى، جمع ٣-١٠، مفرد منصوب ١١+] */
  var WORDS = {
    levels: ['مستوى تعليمي متدرّج', 'مستويان تعليميان متدرّجان',
             'مستويات تعليمية متدرّجة', 'مستوى تعليمي متدرّج'],
    lessons: ['درس مسجّل', 'درسان مسجّلان', 'دروس مسجّلة', 'درساً مسجّلاً'],
    quizzes: ['اختبار قصير', 'اختباران قصيران', 'اختبارات قصيرة', 'اختباراً قصيراً']
  };
  function word(key, v) {
    var w = WORDS[key];
    if (!w) return null;
    return v === 1 ? w[0] : v === 2 ? w[1] : v <= 10 ? w[2] : w[3];
  }

  db.rpc('public_stats').then(function (r) {
    var d = (r && r.data) || {};
    if (r.error || !d || d.error) { figs.hidden = true; return; }

    var any = false;
    figs.querySelectorAll('[data-fig]').forEach(function (el) {
      var key = el.getAttribute('data-fig');
      var v = d[key];
      var card = el.closest('[data-fig-card]');
      if (!v) { if (card) card.hidden = true; return; }   // صفرٌ ليس إنجازاً يُعلن
      el.textContent = n(v);
      var lbl = card && card.querySelector('[data-fig-word="' + key + '"]');
      var w = word(key, v);
      if (lbl && w) lbl.textContent = w;
      any = true;
    });
    if (!any) figs.hidden = true;
  }).catch(function () { figs.hidden = true; });
})();
