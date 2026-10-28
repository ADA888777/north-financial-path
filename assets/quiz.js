/* صفحة الاختبار. الإجابات الصحيحة لا تصل إلى هنا إطلاقاً:
   get_quiz تُرجع نص الخيارات ومعرّفاتها فقط، والتصحيح في الخادم. */
(function () {
  'use strict';
  var L = window.northLearn;
  if (!L) return;
  var db = L.db, el = L.el, esc = L.esc, num = L.num;

  var id = L.qs('id');
  var quiz = null;

  L.guard().then(function (s) {
    if (!s) return;
    if (!id) { L.deny('اختبار غير محدد', 'افتح الاختبار من لوحتك.', false); return; }
    load();
  });

  function load() {
    db.rpc('get_quiz', { p_quiz: id }).then(function (r) {
      if (r.error) { L.deny('تعذّر فتح الاختبار', r.error.message, false); return; }
      var d = r.data || {};
      if (d.error) { L.deny('الاختبار غير متاح', d.error, false); return; }
      quiz = d;
      render(d);
    });
  }

  function render(d) {
    el('q-title').textContent = d.title || '';
    document.title = (d.title || 'اختبار') + ' — نورث للمسار المالي';

    var bits = ['النجاح من ' + num(d.pass_score) + '٪'];
    if (d.max_attempts) bits.push('المحاولات ' + num(d.attempts_used) + ' من ' + num(d.max_attempts));
    else if (d.attempts_used) bits.push('محاولاتك ' + num(d.attempts_used));
    el('q-sub').textContent = bits.join(' · ');

    var state = el('q-state');

    if (d.last) {
      state.innerHTML = resultCard(d.last.percent, d.last.passed, d.pass_score,
        'نتيجتك في آخر محاولة.');
    }

    if (!d.can_attempt) {
      state.innerHTML += '<div class="lbox"><div class="empty"><span class="ms">block</span>' +
        'استنفدت عدد المحاولات المسموح بها لهذا الاختبار.' +
        '<div style="margin-top:16px"><a class="btn btn-ghost" href="learn.html">العودة إلى لوحتي</a></div>' +
        '</div></div>';
      return;
    }

    var qs = d.questions || [];
    if (!qs.length) {
      state.innerHTML += '<div class="lbox"><div class="empty"><span class="ms">quiz</span>' +
        'لم تُضَف أسئلة لهذا الاختبار بعد.</div></div>';
      return;
    }

    el('q-list').innerHTML = qs.map(function (q, i) {
      return '<div class="q-card"><b>' + num(i + 1) + '. ' + esc(q.text) + '</b>' +
        (q.answers || []).map(function (a) {
          return '<label class="opt"><input type="radio" name="q-' + esc(q.id) + '" value="' + esc(a.id) + '">' +
            '<span>' + esc(a.text) + '</span></label>';
        }).join('') +
      '</div>';
    }).join('');
    el('q-form').hidden = false;
  }

  function resultCard(percent, passed, passScore, note) {
    return '<div class="result ' + (passed ? 'pass' : 'fail') + '">' +
      '<span class="ms">' + (passed ? 'task_alt' : 'replay') + '</span>' +
      '<b>' + num(percent) + '٪</b>' +
      '<p>' + (passed ? 'اجتزت الاختبار.' : 'لم تبلغ درجة النجاح ' + num(passScore) + '٪.') +
      (note ? ' ' + esc(note) : '') + '</p></div>';
  }

  var busy = false;
  el('q-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy || !quiz) return;

    var answers = {};
    var missing = 0;
    (quiz.questions || []).forEach(function (q) {
      var picked = document.querySelector('input[name="q-' + q.id + '"]:checked');
      if (picked) answers[q.id] = picked.value;
      else missing++;
    });

    if (missing && !window.confirm('تركت ' + num(missing) + ' سؤالاً بلا إجابة. هل ترسل؟')) return;

    busy = true;
    var btn = e.target.querySelector('[type=submit]');
    var label = btn.querySelector('[data-label]');
    btn.setAttribute('aria-busy', 'true'); btn.disabled = true;
    label.textContent = 'جارٍ التصحيح';

    db.rpc('submit_quiz', { p_quiz: id, p_answers: answers }).then(function (r) {
      busy = false;
      btn.removeAttribute('aria-busy'); btn.disabled = false;
      label.textContent = 'إرسال الإجابات';

      var d = (r && r.data) || {};
      if (r.error || d.error) {
        el('q-state').innerHTML = '<div class="lbox"><div class="empty">' +
          '<span class="ms">error</span>' + esc(d.error || r.error.message) + '</div></div>';
        return;
      }

      el('q-form').hidden = true;
      el('q-state').innerHTML = resultCard(d.percent, d.passed, d.pass_score,
        'أجبت ' + num(d.score) + ' من ' + num(d.max_score) + '.') +
        '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
          '<a class="btn btn-primary" href="learn.html">العودة إلى لوحتي</a>' +
          ((d.max_attempts == null || d.attempts_used < d.max_attempts)
            ? '<button class="btn btn-ghost" type="button" id="again">إعادة المحاولة</button>' : '') +
        '</div>';
      var again = el('again');
      if (again) again.addEventListener('click', function () { window.location.reload(); });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
})();
