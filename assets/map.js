/* خارطة التقدم. كل رقم من my_map(): لا عدد مستويات ولا دروس مكتوب هنا.
   القفل مفروض في القاعدة؛ ما تعرضه الصفحة انعكاسٌ له لا بديلٌ عنه. */
(function () {
  'use strict';
  var L = window.northLearn, db = L.db, el = L.el, esc = L.esc, num = L.num;

  var LVL = {
    done:    { t: 'مكتملة',          ico: 'check_circle' },
    current: { t: 'المرحلة الحالية', ico: 'play_circle' },
    open:    { t: 'متاحة',           ico: 'lock_open' },
    locked:  { t: 'مقفلة',           ico: 'lock' }
  };
  var LSN = {
    done:   { t: 'مكتمل', ico: 'check_circle' },
    open:   { t: 'متاح',  ico: 'play_arrow' },
    locked: { t: 'مقفل',  ico: 'lock' }
  };

  function stats(m) {
    function card(ico, label, value, note) {
      return '<div class="s-card"><span class="ms">' + ico + '</span>' +
        '<span class="s-l">' + esc(label) + '</span>' +
        '<b class="s-v">' + value + '</b>' +
        (note ? '<span class="s-n">' + esc(note) + '</span>' : '') + '</div>';
    }
    el('m-stats').innerHTML =
      card('stairs', 'المستويات', num(m.levels_total || 0), '') +
      card('menu_book', 'الدروس', num(m.lessons_total || 0), '') +
      card('trending_up', 'تقدمك', num(m.percent || 0) + '<i>%</i>',
           num(m.lessons_done || 0) + ' مكتمل') +
      card('lock_open', 'متاحة الآن', num(m.lessons_open || 0), '') +
      card('lock', 'مقفلة', num(m.lessons_locked || 0), '');
  }

  function lesson(ls) {
    var s = LSN[ls.state] || LSN.locked;
    var body =
      '<span class="ms ln-i ' + ls.state + '">' + s.ico + '</span>' +
      '<div class="ln-b"><b>' + esc(ls.title) + '</b>' +
        (ls.state === 'locked' && ls.reason
          ? '<span class="ln-r">' + esc(ls.reason) + '</span>'
          : '<span class="ln-m">' + s.t +
            (ls.duration_min ? ' · ' + num(ls.duration_min) + ' دقيقة' : '') +
            (ls.free_preview ? ' · درس تعريفي' : '') + '</span>') +
      '</div>' +
      (ls.quiz_id && ls.state !== 'locked'
        ? '<a class="ln-q" href="quiz.html?id=' + encodeURIComponent(ls.quiz_id) +
          '" title="اختبار الدرس"><span class="ms">quiz</span></a>' : '');

    return '<li class="ln ' + ls.state + '">' +
      (ls.state === 'locked'
        ? '<div>' + body + '</div>'
        : '<a href="lesson.html?id=' + encodeURIComponent(ls.id) + '">' + body + '</a>') +
      '</li>';
  }

  function weeks(ws) {
    if (!ws || !ws.length) return '';
    return ws.map(function (w) {
      return '<div class="wk">' +
        (Number(w.week) > 0
          ? '<h4 class="wk-h">الأسبوع ' + num(w.week) + '</h4>' : '') +
        '<ul class="ln-list">' + (w.lessons || []).map(lesson).join('') + '</ul>' +
      '</div>';
    }).join('');
  }

  function level(l) {
    var st = l.state, s = LVL[st] || LVL.locked;
    return '<section class="lv ' + st + '">' +
      '<div class="lv-h">' +
        '<span class="ms lv-i ' + st + '">' + s.ico + '</span>' +
        '<div class="lv-t">' +
          (l.code ? '<span class="lv-c">' + esc(l.code) + '</span>' : '') +
          '<b>' + esc(l.title) + '</b>' +
          (l.subtitle ? '<p>' + esc(l.subtitle) + '</p>' : '') +
        '</div>' +
        '<span class="mp-tag ' + st + '">' + s.t + '</span>' +
      '</div>' +
      (l.description ? '<p class="lv-d">' + esc(l.description) + '</p>' : '') +
      (st === 'locked'
        ? '<p class="mp-lock">أكمل دروس المرحلة السابقة واجتز اختبارها لفتح هذه المرحلة.</p>'
        : L.bar(l.percent) +
          '<div class="mp-f"><span dir="ltr">' + num(l.done) + '/' + num(l.total) + ' درساً</span>' +
          (l.quiz_id
            ? '<a href="quiz.html?id=' + encodeURIComponent(l.quiz_id) + '" class="' +
              (l.quiz_passed ? 'ok' : '') + '">' +
              (l.quiz_passed ? 'اختبار المرحلة مُجتاز' : 'اختبار المرحلة') + '</a>'
            : '<span>بلا اختبار مرحلة</span>') + '</div>' +
          weeks(l.weeks)) +
    '</section>';
  }

  L.guard().then(function (s) {
    if (!s) return;
    return db.rpc('my_map').then(function (r) {
      var m = (r && r.data) || {};
      if (r.error || m.error) {
        el('map').innerHTML = '<p class="empty">' +
          esc(m.error || r.error.message || 'تعذّر تحميل الخارطة.') + '</p>';
        return;
      }

      stats(m);

      var tracks = (m.tracks || []).filter(function (t) { return (t.levels || []).length; });
      var curName = '';
      tracks.forEach(function (t) {
        (t.levels || []).forEach(function (l) {
          if (l.id === m.current_level) curName = (l.code ? l.code + ' — ' : '') + l.title;
        });
      });
      el('m-sub').textContent = curName
        ? 'مرحلتك الحالية: ' + curName
        : (m.lessons_total ? 'أنهيت كل المراحل المتاحة.' : 'لم تُنشر مراحل بعد.');

      if (m.next_lesson) {
        var go = el('m-go');
        go.hidden = false;
        go.href = 'lesson.html?id=' + encodeURIComponent(m.next_lesson);
      }

      if (!tracks.length) {
        el('map').innerHTML = '<p class="empty">لم تُنشر مراحل بعد.</p>';
        return;
      }

      el('map').innerHTML = tracks.map(function (t) {
        return '<div class="mp-track-h"><h2><span class="ms">route</span> ' + esc(t.track) +
          (t.for_beginners ? ' <span class="beg">للمبتدئين</span>' : '') + '</h2></div>' +
          t.levels.map(level).join('');
      }).join('');
    });
  }).catch(function (e) {
    L.deny('تعذّر تحميل الخارطة', (e && e.message) || '', false);
  });
})();
