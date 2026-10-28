/* خارطة المسار. الحالات من my_map()، والقفل مفروض في القاعدة:
   فتح الرابط يدوياً لمرحلة مقفلة لا يعرض محتواها. */
(function () {
  'use strict';
  var L = window.northLearn, db = L.db, el = L.el, esc = L.esc, num = L.num;

  var ICO = { done: 'check_circle', current: 'play_circle', open: 'lock_open', locked: 'lock' };
  var TXT = { done: 'مكتملة', current: 'المرحلة الحالية', open: 'متاحة', locked: 'مقفلة' };

  function level(l) {
    var st = l.state;
    var to = st === 'locked' ? null
      : (l.next_lesson ? 'lesson.html?id=' + encodeURIComponent(l.next_lesson)
                       : 'level.html?id=' + encodeURIComponent(l.id));

    var body =
      '<div class="mp-top">' +
        '<span class="ms mp-i ' + st + '">' + ICO[st] + '</span>' +
        '<div class="mp-h"><b>' + esc(l.title) + '</b>' +
          (l.subtitle ? '<p>' + esc(l.subtitle) + '</p>' : '') + '</div>' +
        '<span class="mp-tag ' + st + '">' + TXT[st] + '</span>' +
      '</div>' +
      (st === 'locked'
        ? '<p class="mp-lock">أكمل دروس المرحلة السابقة واجتز اختبارها لفتح هذه المرحلة.</p>'
        : L.bar(l.percent) +
          '<div class="mp-f"><span dir="ltr">' + num(l.done) + '/' + num(l.total) + ' درساً</span>' +
          (l.quiz_id
            ? '<span class="' + (l.quiz_passed ? 'ok' : '') + '">' +
              (l.quiz_passed ? 'الاختبار مُجتاز' : 'الاختبار لم يُجتز') + '</span>'
            : '<span>بلا اختبار</span>') +
          '</div>');

    return '<li class="mp ' + st + '">' +
      (to ? '<a href="' + to + '">' + body + '</a>' : '<div>' + body + '</div>') +
      '</li>';
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
      var tracks = (m.tracks || []).filter(function (t) { return (t.levels || []).length; });
      if (!tracks.length) {
        el('map').innerHTML = '<p class="empty">لم تُنشر مراحل بعد.</p>';
        return;
      }
      el('map').innerHTML = tracks.map(function (t) {
        return '<section class="lbox mp-track">' +
          '<h2><span class="ms">route</span> ' + esc(t.track) +
          (t.for_beginners ? ' <span class="beg">للمبتدئين</span>' : '') + '</h2>' +
          '<ol class="mp-list">' + t.levels.map(level).join('') + '</ol></section>';
      }).join('');
    });
  }).catch(function (e) {
    L.deny('تعذّر تحميل الخارطة', (e && e.message) || '', false);
  });
})();
