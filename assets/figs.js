/* الصفحة الرئيسية: الأرقام وصفوف المسارات من المحتوى المنشور.

   كانت الأرقام مكتوبة في HTML («١٤ درساً · ٣ ساعات · ٤ اختبارات»
   لكل مسار) تحتها سطر «أرقام تجريبية لعرض التصميم». حذف السطر وحده
   يحوّلها إلى ادّعاء، فصارت تُحسب — وما لا تسنده القاعدة لا يُعرض. */
(function () {
  'use strict';
  var db = window.northDB;
  var figs = document.getElementById('figs');
  var rows = document.getElementById('tr-rows');
  if (!db || (!figs && !rows)) return;

  var AR = (function () {
    try { return new Intl.NumberFormat('ar-SA'); } catch (e) { return null; }
  })();
  function n(v) { return AR ? AR.format(v) : String(v); }
  function esc(x) {
    return String(x == null ? '' : x)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* الساعات لا تُعرض إلا إن سُجّلت مدّة لدرسٍ فعلاً */
  function duration(min) {
    if (!min) return '';
    if (min < 90) return '<span class="tag"><span class="ms">schedule</span> <b class="num">' +
      n(min) + '</b> دقيقة</span>';
    var h = Math.round(min / 60);
    return '<span class="tag"><span class="ms">schedule</span> <b class="num">' +
      n(h) + '</b> ' + (h === 1 ? 'ساعة' : (h === 2 ? 'ساعتان' : 'ساعات')) + '</span>';
  }

  function drawFigs(d) {
    if (!figs) return;
    var any = false;
    figs.querySelectorAll('[data-fig]').forEach(function (el) {
      var v = d[el.getAttribute('data-fig')];
      var card = el.closest('[data-fig-card]');
      if (!v) { if (card) card.hidden = true; return; }   // صفرٌ ليس إنجازاً يُعلن
      el.textContent = n(v);
      any = true;
    });
    if (!any) figs.hidden = true;
  }

  function drawTracks(d) {
    if (!rows) return;

    /* المسارات أولاً. منهجٌ بمسار واحد تُعرض مستوياته بدل صفٍّ وحيد
       يقول «مسار» — المتعلم يريد أن يرى الطريق لا اسم الحاوية. */
    var list = (d.track_rows || []);
    if (list.length < 2 && (d.level_rows || []).length > 1) list = d.level_rows;

    if (!list.length) {
      var sec = rows.closest('section');
      if (sec) sec.hidden = true;     // لا محتوى منشوراً: لا قسم
      return;
    }

    var h2 = document.getElementById('tr-h2');
    if (h2) {
      h2.textContent = list.length === 3
        ? 'ثلاثة مستويات، كل مستوى يبني على الذي قبله.'
        : n(list.length) + ' مستويات، كل مستوى يبني على الذي قبله.';
    }

    rows.innerHTML = list.map(function (t, i) {
      var meta =
        (t.lessons
          ? '<span class="tag"><span class="ms">play_lesson</span> <b class="num">' +
            n(t.lessons) + '</b> ' + (t.lessons === 1 ? 'درس' : 'درساً') + '</span>'
          : '') +
        duration(t.minutes) +
        (t.quizzes
          ? '<span class="tag"><span class="ms">quiz</span> <b class="num">' +
            n(t.quizzes) + '</b> ' + (t.quizzes === 1 ? 'اختبار' : 'اختبارات') + '</span>'
          : '');

      return '<article class="row">' +
        '<span class="row-n">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<div class="row-main"><h3>' + esc(t.title) + '</h3>' +
          (t.level_label ? '<span class="chip">' + esc(t.level_label) + '</span>' : '') +
        '</div>' +
        '<div class="row-side">' +
          (t.description ? '<p>' + esc(t.description) + '</p>' : '') +
          (meta ? '<div class="row-meta">' + meta + '</div>' : '') +
        '</div>' +
      '</article>';
    }).join('');
  }

  db.rpc('public_stats').then(function (r) {
    var d = (r && r.data) || {};
    if (r.error || !d || d.error) {
      if (figs) figs.hidden = true;
      var sec = rows && rows.closest('section');
      if (sec) sec.hidden = true;
      return;
    }
    drawFigs(d);
    drawTracks(d);
  }).catch(function () {
    if (figs) figs.hidden = true;
  });
})();
