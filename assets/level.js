/* صفحة المستوى: دروسه وحالتها وتقدّم المتعلم فيه. */
(function () {
  'use strict';
  var L = window.northLearn;
  if (!L) return;
  var db = L.db, el = L.el, esc = L.esc, num = L.num;

  var id = L.qs('id');

  L.guard().then(function (s) {
    if (!s) return;
    if (!id) { L.deny('مستوى غير محدد', 'افتح المستوى من لوحتك.', false); return; }
    load();
  });

  function load() {
    Promise.all([
      db.from('levels').select('id, title, subtitle, description').eq('id', id).maybeSingle(),
      db.from('lessons').select('id, title, kind, duration_min, sort_order, free_preview')
        .eq('level_id', id).eq('published', true)
        .order('sort_order', { ascending: true }),
      db.from('lesson_progress').select('lesson_id'),
      db.from('quizzes').select('id, title').eq('level_id', id).eq('published', true)
        .order('sort_order', { ascending: true }).limit(1)
    ]).then(function (r) {
      if (r[0].error || !r[0].data) {
        L.deny('المستوى غير متاح', (r[0].error && r[0].error.message) || 'قد يكون غير منشور.', false);
        return;
      }
      var lv = r[0].data;
      var lessons = r[1].data || [];
      var doneIds = {};
      (r[2].data || []).forEach(function (x) { doneIds[x.lesson_id] = true; });
      var quiz = (r[3].data || [])[0];
      render(lv, lessons, doneIds, quiz);
    });
  }

  function render(lv, lessons, doneIds, quiz) {
    el('lv-title').textContent = lv.title || '';
    document.title = (lv.title || 'المستوى') + ' — نورث للمسار المالي';
    el('lv-sub').textContent = lv.subtitle || lv.description || '';

    var done = lessons.filter(function (l) { return doneIds[l.id]; }).length;
    var p = L.pct(done, lessons.length);

    if (lessons.length) {
      el('prog-box').hidden = false;
      el('lv-count').textContent = num(done) + ' من ' + num(lessons.length) + ' · ' + num(p) + '٪';
      el('lv-bar').innerHTML = L.bar(p);
    }

    /* الدرس التالي: أول غير مكتمل */
    var nextIdx = lessons.findIndex(function (l) { return !doneIds[l.id]; });

    el('lv-lessons').innerHTML = lessons.length ? lessons.map(function (l, i) {
      var isDone = !!doneIds[l.id];
      var isNext = !isDone && i === nextIdx;
      var state = isDone
        ? '<span class="done-tag">مكتمل</span>'
        : isNext
          ? '<span class="done-tag" style="color:var(--accent);background:var(--accent-wash)">قيد التقدّم</span>'
          : '<span style="font-size:11.5px;color:var(--fg-3)">لم يبدأ</span>';
      return '<div class="qz">' +
        '<div style="min-width:0"><b>' + num(i + 1) + '. ' + esc(l.title) + '</b>' +
          '<div class="meta">' +
            (l.kind === 'strategy' ? 'استراتيجية' : 'درس') +
            (l.duration_min ? ' · ' + num(l.duration_min) + ' دقيقة' : '') +
            (l.free_preview ? ' · معاينة مجانية' : '') +
          '</div></div>' +
        '<div style="display:flex;align-items:center;gap:12px">' + state +
          '<a class="btn btn-ghost btn-sm" href="lesson.html?id=' + encodeURIComponent(l.id) + '">' +
            (isDone ? 'مراجعة' : 'فتح') + '</a>' +
        '</div></div>';
    }).join('')
      : '<div class="empty"><span class="ms">menu_book</span>لا توجد دروس منشورة في هذا المستوى بعد.</div>';

    if (quiz) {
      el('lv-quiz-box').hidden = false;
      el('lv-quiz').href = 'quiz.html?id=' + encodeURIComponent(quiz.id);
    }
  }
})();
