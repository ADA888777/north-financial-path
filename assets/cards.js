/* البطاقات التعليمية: مفردات الدرس وجهاً وظهراً.
   المفردات من get_lesson، فالقفل والاشتراك مطبّقان عليها كما على الدرس. */
(function () {
  'use strict';
  var L = window.northLearn, db = L.db, el = L.el, esc = L.esc, num = L.num;
  var id = L.qs('lesson');

  function deck(title, vocab) {
    el('c-title').textContent = 'بطاقات: ' + title;
    el('c-sub').textContent = num(vocab.length) +
      (vocab.length === 1 ? ' بطاقة. اضغط البطاقة لقلبها.' : ' بطاقة. اضغط البطاقة لقلبها.');

    el('cards').innerHTML =
      '<div class="cd-grid">' + vocab.map(function (v, i) {
        return '<button type="button" class="cd" aria-pressed="false">' +
          '<span class="cd-i">' + num(i + 1) + '</span>' +
          '<span class="cd-f"><b>' + esc(v.term) + '</b><i>اضغط للمعنى</i></span>' +
          '<span class="cd-bk">' + esc(v.meaning) + '</span>' +
          '</button>';
      }).join('') + '</div>' +
      '<div class="cd-act">' +
        '<button class="btn btn-ghost btn-sm" id="flip-all" type="button">اقلب الكل</button>' +
        '<a class="btn btn-ghost btn-sm" href="lesson.html?id=' + encodeURIComponent(id) + '">العودة إلى الدرس</a>' +
      '</div>';

    el('cards').querySelectorAll('.cd').forEach(function (c) {
      c.addEventListener('click', function () {
        var on = c.classList.toggle('on');
        c.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    });
    el('flip-all').addEventListener('click', function () {
      var cards = el('cards').querySelectorAll('.cd');
      var anyOff = Array.prototype.some.call(cards, function (c) { return !c.classList.contains('on'); });
      cards.forEach(function (c) {
        c.classList.toggle('on', anyOff);
        c.setAttribute('aria-pressed', anyOff ? 'true' : 'false');
      });
    });
  }

  L.guard().then(function (s) {
    if (!s) return;
    if (!id) {
      el('cards').innerHTML = '<section class="lbox"><p class="empty">' +
        'لم يُحدَّد درس. افتح البطاقات من صفحة الدرس أو من مهام اليوم.</p></section>';
      return;
    }
    return db.rpc('get_lesson', { p_lesson: id }).then(function (r) {
      var d = (r && r.data) || {};
      if (r.error || d.error) {
        el('cards').innerHTML = '<section class="lbox"><p class="empty">' +
          esc(d.error || r.error.message) + '</p></section>';
        return;
      }
      if (!d.allowed) {
        el('cards').innerHTML = '<section class="lbox"><p class="empty">' +
          esc(d.locked_reason || 'هذا الدرس غير متاح لك الآن.') + '</p></section>';
        return;
      }
      var v = d.vocab || [];
      if (!v.length) {
        el('c-title').textContent = 'بطاقات: ' + d.title;
        el('cards').innerHTML = '<section class="lbox"><p class="empty">' +
          'لا توجد مفردات في هذا الدرس.</p></section>';
        return;
      }
      deck(d.title, v);
    });
  }).catch(function (e) {
    L.deny('تعذّر تحميل البطاقات', (e && e.message) || '', false);
  });
})();
