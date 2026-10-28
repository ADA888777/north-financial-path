/* صفحة الدرس. المحتوى يأتي من get_lesson، وبلا اشتراك لا يصل أصلاً. */
(function () {
  'use strict';
  var L = window.northLearn;
  if (!L) return;
  var db = L.db, el = L.el, esc = L.esc;

  var id = L.qs('id');
  var lesson = null;

  L.guard().then(function (s) {
    if (!s) return;
    if (!id) { L.deny('درس غير محدد', 'افتح الدرس من لوحتك.', false); return; }
    load();
  });

  function load() {
    db.rpc('get_lesson', { p_lesson: id }).then(function (r) {
      if (r.error) { L.deny('تعذّر فتح الدرس', r.error.message, false); return; }
      var d = r.data || {};
      if (d.error) { L.deny('الدرس غير متاح', d.error, false); return; }
      lesson = d;
      render(d);
      db.rpc('mark_lesson_opened', { p_lesson: id }).then(function () {});
    });
  }

  function render(d) {
    el('l-title').textContent = d.title || '';
    document.title = (d.title || 'الدرس') + ' — نورث للمسار المالي';
    el('crumb-lvl').textContent = d.kind === 'strategy' ? 'استراتيجية' : 'درس';

    if (!d.allowed) {
      el('l-locked').hidden = false;
      el('l-locked').innerHTML =
        '<div class="lbox"><div class="empty"><span class="ms">lock</span>' +
        'هذا الدرس يتطلب اشتراكاً نافذاً.<br>إذا اشتركت عبر سلة ولم يُفعَّل حسابك، راسل الإدارة.' +
        '<div style="margin-top:18px"><a class="btn btn-primary" href="account.html">حسابي</a></div>' +
        '</div></div>';
      return;
    }

    el('l-body').hidden = false;

    /* الفيديو: رابط خارجي لا إطار مضمّن */
    if (d.video_url) {
      el('l-video').innerHTML =
        '<div class="video-wrap"><a href="' + esc(d.video_url) + '" target="_blank" rel="noopener noreferrer">' +
        '<span class="ms">play_circle</span><span>افتح فيديو الدرس</span></a></div>';
    }

    el('l-content').innerHTML = L.paras(d.content);

    if (d.summary && d.summary.trim()) {
      el('box-summary').hidden = false;
      el('l-summary').innerHTML = L.paras(d.summary);
    }

    var v = d.vocab || [];
    if (v.length) {
      el('box-vocab').hidden = false;
      el('l-vocab').innerHTML = v.map(function (x) {
        return '<div class="vterm"><b>' + esc(x.term) + '</b>' +
          (x.meaning ? '<span>' + esc(x.meaning) + '</span>' : '') + '</div>';
      }).join('');
      el('l-vocab').insertAdjacentHTML('afterend',
        '<a class="btn btn-ghost btn-sm btn-wide" style="margin-top:12px" ' +
        'href="cards.html?lesson=' + encodeURIComponent(id) + '">راجعها كبطاقات</a>');
    }

    if (d.quiz_id) {
      el('box-quiz').hidden = false;
      el('l-quiz').href = 'quiz.html?id=' + encodeURIComponent(d.quiz_id);
    }

    var prev = el('l-prev'), next = el('l-next');
    if (d.prev_id) prev.href = 'lesson.html?id=' + encodeURIComponent(d.prev_id);
    else { prev.setAttribute('aria-disabled', 'true'); prev.style.visibility = 'hidden'; }
    if (d.next_id) next.href = 'lesson.html?id=' + encodeURIComponent(d.next_id);
    else { next.setAttribute('aria-disabled', 'true'); next.style.visibility = 'hidden'; }

    paintDone(d.completed);
    if (window.northLessonResume) window.northLessonResume(d);
  }

  function paintDone(done) {
    var b = el('l-done');
    var label = b.querySelector('[data-label]');
    label.textContent = done ? 'مكتمل — إلغاء' : 'تحديد كمكتمل';
    b.className = done ? 'btn btn-ghost' : 'btn btn-primary';
  }

  var busy = false;
  el('l-done').addEventListener('click', function () {
    if (busy || !lesson) return;
    busy = true;
    var b = el('l-done');
    b.setAttribute('aria-busy', 'true'); b.disabled = true;

    db.rpc('set_lesson_done', { p_lesson: id, p_done: !lesson.completed })
      .then(function (r) {
        busy = false;
        b.removeAttribute('aria-busy'); b.disabled = false;
        if (r.error || (r.data && r.data.error)) return;
        lesson.completed = !lesson.completed;
        paintDone(lesson.completed);
        /* بعد الإكمال ينتقل تلقائياً إلى التالي إن وُجد */
        if (lesson.completed && lesson.next_id) {
          setTimeout(function () {
            window.location.href = 'lesson.html?id=' + encodeURIComponent(lesson.next_id);
          }, 700);
        }
      });
  });

  /* ---------- موضع القراءة ----------
     يُحفظ كنسبة من طول الصفحة لا كإزاحة بالبكسل: البكسل يتغيّر مع حجم
     الشاشة والخط، فيعود المتعلم إلى موضع غير الذي ترك. */
  function scrollPct() {
    var h = document.documentElement.scrollHeight - window.innerHeight;
    if (h <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((window.scrollY / h) * 100)));
  }

  var lastSent = -1, timer = null;

  function remember() {
    if (!lesson || !lesson.allowed) return;
    var p = scrollPct();
    if (Math.abs(p - lastSent) < 5) return;
    lastSent = p;
    db.rpc('save_lesson_spot', { p_lesson: id, p_pos: p }).catch(function () {});
  }

  window.addEventListener('scroll', function () {
    if (timer) return;
    timer = setTimeout(function () { timer = null; remember(); }, 1500);
  }, { passive: true });

  window.addEventListener('pagehide', remember);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') remember();
  });

  /* الرجوع إلى حيث وقف: ?at= من اللوحة، وإلا الموضع المحفوظ في القاعدة */
  window.northLessonResume = function (d) {
    var at = parseInt(L.qs('at'), 10);
    var pos = isNaN(at) ? (d.spot || 0) : at;
    if (!pos || pos < 5 || !d.allowed) return;
    requestAnimationFrame(function () {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      if (h > 0) window.scrollTo({ top: (pos / 100) * h, behavior: 'smooth' });
      lastSent = pos;
    });
  };
})();
