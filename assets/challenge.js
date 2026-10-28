/* التحدي اليومي. الأسئلة والتصحيح من الخادم: الإجابة الصحيحة لا تصل
   المتصفح قبل أن يجيب المتعلم، والنتيجة تُكتب في القاعدة لا هنا. */
(function () {
  'use strict';
  var L = window.northLearn, db = L.db, el = L.el, esc = L.esc, num = L.num;
  var busy = false;

  function head(d) {
    var done = d.answered || 0, tot = d.total || 0;
    el('ch-head').innerHTML =
      '<div class="ch-head">' +
        '<div class="chh-n"><b>' + num(done) + '<i>/' + num(tot) + '</i></b>' +
          '<span>أُجيب اليوم</span></div>' +
        '<div class="chh-n"><b>' + num(d.correct || 0) + '</b><span>صحيحة</span></div>' +
        '<div class="chh-n"><b>' + num(d.streak || 0) + '</b><span>يوم متتالٍ</span></div>' +
      '</div>' +
      ((d.history && d.history.length)
        ? '<div class="ch-hist">' + d.history.slice(-14).map(function (h) {
            var r = h.total ? h.correct / h.total : 0;
            var cls = r === 1 ? 'full' : (r > 0 ? 'part' : 'none');
            return '<i class="' + cls + '" title="' + esc(h.day) + ': ' +
                   h.correct + ' من ' + h.total + '"></i>';
          }).join('') + '<span>آخر أيامك</span></div>'
        : '');
  }

  function render(d) {
    head(d);
    var qs = d.questions || [];
    if (!qs.length) {
      el('ch-body').innerHTML =
        '<section class="lbox"><p class="empty">لا توجد أسئلة متاحة في مراحلك المفتوحة بعد. ' +
        'أكمل درساً أو افتح مرحلة جديدة ليبدأ التحدي.</p></section>';
      return;
    }

    el('ch-body').innerHTML = qs.map(function (q, i) {
      var ans = (q.answers || []).map(function (a) {
        var cls = '';
        if (q.answered) {
          if (a.id === q.correct_id) cls = ' right';
          else if (a.id === q.chosen) cls = ' wrong';
        }
        return '<button type="button" class="qa' + cls + '"' +
          (q.answered ? ' disabled' : '') +
          ' data-q="' + esc(q.id) + '" data-a="' + esc(a.id) + '">' +
          esc(a.text) +
          (q.answered && a.id === q.correct_id ? '<span class="ms">check</span>' : '') +
          (q.answered && a.id === q.chosen && a.id !== q.correct_id ? '<span class="ms">close</span>' : '') +
          '</button>';
      }).join('');

      return '<section class="lbox chq" id="q-' + esc(q.id) + '">' +
        '<div class="chq-h"><i>' + num(i + 1) + '</i>' +
          '<div><b>' + esc(q.text) + '</b>' +
          (q.quiz ? '<span class="chq-src">من ' + esc(q.quiz) + '</span>' : '') + '</div>' +
          (q.answered
            ? '<span class="chq-r ' + (q.correct ? 'ok' : 'no') + '">' +
              (q.correct ? 'صحيحة' : 'غير صحيحة') + '</span>'
            : '') +
        '</div><div class="qa-list">' + ans + '</div></section>';
    }).join('');

    el('ch-body').querySelectorAll('.qa:not([disabled])').forEach(function (b) {
      b.addEventListener('click', function () { answer(b); });
    });
  }

  function answer(btn) {
    if (busy) return;
    busy = true;
    var q = btn.getAttribute('data-q'), a = btn.getAttribute('data-a');
    btn.closest('.qa-list').querySelectorAll('.qa').forEach(function (x) { x.disabled = true; });

    db.rpc('answer_challenge', { p_question: q, p_answer: a }).then(function (r) {
      busy = false;
      var d = (r && r.data) || {};
      if (r.error || d.error) {
        btn.closest('.chq').insertAdjacentHTML('beforeend',
          '<p class="chq-err">' + esc(d.error || r.error.message) + '</p>');
        return;
      }
      load();
    }).catch(function (e) {
      busy = false;
      btn.closest('.chq').insertAdjacentHTML('beforeend',
        '<p class="chq-err">' + esc((e && e.message) || 'تعذّر الإرسال') + '</p>');
    });
  }

  function load() {
    return db.rpc('my_challenge').then(function (r) {
      var d = (r && r.data) || {};
      if (r.error || d.error) {
        el('ch-body').innerHTML = '<section class="lbox"><p class="empty">' +
          esc(d.error || r.error.message || 'تعذّر التحميل.') + '</p></section>';
        return;
      }
      render(d);
    });
  }

  L.guard().then(function (s) { if (s) return load(); })
   .catch(function (e) { L.deny('تعذّر تحميل التحدي', (e && e.message) || '', false); });
})();
