/* صفحة الدرس. المحتوى يأتي من get_lesson، وبلا اشتراك لا يصل أصلاً. */
(function () {
  'use strict';
  var L = window.northLearn;
  if (!L) return;
  var db = L.db, el = L.el, esc = L.esc, num = L.num;

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

  /* ---------- الفيديو ----------
     الرابط لا يُمرَّر كما هو إلى إطار: يُستخرج منه المعرّف بنمطٍ
     صارم ثم يُبنى عنوان المشغّل. إطارٌ على عنوانٍ يكتبه أحدٌ في
     لوحة الإدارة بلا تحقّق ثغرةٌ لا ميزة — وما لا يُعرف نوعه
     يبقى رابطاً يُفتح في تبويب، فلا يضيع على المتعلمة درس. */
  function player(url) {
    var u = String(url == null ? '' : url).trim();
    if (!/^https:\/\//i.test(u)) return null;
    var m;

    m = u.match(/(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    if (m) return { frame: 'https://www.youtube-nocookie.com/embed/' + m[1] + '?rel=0' };

    m = u.match(/vimeo\.com\/(?:video\/)?(\d{6,12})/);
    if (m) return { frame: 'https://player.vimeo.com/video/' + m[1] };

    m = u.match(/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{10,80})/);
    if (m) return { frame: 'https://drive.google.com/file/d/' + m[1] + '/preview' };

    if (/\.(mp4|webm|ogv|ogg|m4v)(\?|#|$)/i.test(u)) return { file: u };
    return null;
  }

  function shell(inner) {
    return '<div class="vid-h"><h2><span class="ms">play_circle</span> شاهد وتعلّم</h2>' +
      (curDur ? '<span class="vid-t"><span class="ms">schedule</span>' +
        num(curDur) + ' دقيقة</span>' : '') + '</div>' + inner;
  }

  var curDur = 0;

  /* الملف المرفوع يُقدَّم على الرابط: هو محتوى المنصة نفسه،
     والدلو خاصّ — العنوان يُوقَّع لساعتين ولا يُمنح التوقيع إلا
     لمن تفتح لها القاعدة هذا الدرس. */
  function uploaded(d, box) {
    box.innerHTML = shell('<div class="video-wrap vid-load">' +
      '<span class="ms">hourglass_top</span><span>جارٍ تجهيز الفيديو…</span></div>');

    db.storage.from('lesson-videos').createSignedUrl(d.video_path, 7200)
      .then(function (r) {
        var u = r && r.data && r.data.signedUrl;
        if (r.error || !u) {
          box.innerHTML = shell('<div class="video-wrap vid-load">' +
            '<span class="ms">error</span><span>تعذّر تحميل الفيديو. حدّثي الصفحة.</span></div>');
          return;
        }
        box.innerHTML = shell('<div class="video-wrap"><video src="' + esc(u) +
          '" controls preload="metadata" playsinline controlsList="nodownload"></video></div>');
      })
      .catch(function () {
        box.innerHTML = shell('<div class="video-wrap vid-load">' +
          '<span class="ms">error</span><span>تعذّر تحميل الفيديو. حدّثي الصفحة.</span></div>');
      });
  }

  function video(d) {
    var box = el('l-video');
    if (!box) return;
    curDur = d.duration_min || 0;

    if (d.video_path) { uploaded(d, box); return; }
    if (!d.video_url) { box.innerHTML = ''; return; }

    var p = player(d.video_url);
    var body;
    if (p && p.frame) {
      body = '<div class="video-wrap"><iframe src="' + esc(p.frame) + '" title="فيديو الدرس" ' +
        'loading="lazy" referrerpolicy="strict-origin-when-cross-origin" ' +
        'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" ' +
        'allowfullscreen></iframe></div>';
    } else if (p && p.file) {
      body = '<div class="video-wrap"><video src="' + esc(p.file) + '" controls preload="metadata" ' +
        'playsinline></video></div>';
    } else {
      /* مصدرٌ لا نعرف كيف نضمّنه: الرابط كما هو، ويُقال ذلك */
      body = '<div class="video-wrap vid-out">' +
        '<a href="' + esc(d.video_url) + '" target="_blank" rel="noopener noreferrer">' +
        '<span class="ms">play_circle</span><span>افتح فيديو الدرس</span>' +
        '<i>يُفتح في تبويب جديد</i></a></div>';
    }
    box.innerHTML = shell(body);
  }

  /* ---------- التبويبات ----------
     تُبنى ممّا في الدرس فعلاً: درسٌ بلا مفردات لا يُفتح له تبويب
     فارغ، وتبويب واحد لا يُعرض شريطاً أصلاً. */
  var PANES = ['video', 'vocab', 'summary', 'quiz'];

  function show(name) {
    PANES.forEach(function (n) {
      var p = el('pane-' + n);
      if (p) p.hidden = (n !== name);
    });
    var bar = el('l-tabs');
    if (!bar) return;
    bar.querySelectorAll('[data-pane]').forEach(function (b) {
      var on = b.getAttribute('data-pane') === name;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function tabs(d) {
    var bar = el('l-tabs');
    var hasVideo = !!(d.video_url || d.video_path);
    var hasText  = !!(d.content && d.content.trim());
    var items = [];

    if (hasVideo) items.push({ id: 'video', ico: 'play_circle', label: 'الفيديو' });
    if ((d.vocab || []).length) items.push({ id: 'vocab', ico: 'menu_book', label: 'المفردات' });
    /* «الملخص» نصّ الدرس المكتوب (content) لا وصفه القصير (summary):
       الوصف في الرأس فوق، وتكراره هنا سطرٌ يُقرأ مرّتين. */
    if (hasText) items.push({ id: 'summary', ico: 'description', label: 'الملخص' });
    if (d.quiz_id) items.push({ id: 'quiz', ico: 'psychology', label: 'الاختبار' });

    if (!items.length) { bar.hidden = true; return; }

    if (items.length === 1) { bar.hidden = true; show(items[0].id); return; }

    bar.hidden = false;
    bar.innerHTML = items.map(function (it) {
      return '<button class="ltab" type="button" role="tab" aria-selected="false" ' +
        'data-pane="' + it.id + '"><span class="ms">' + it.ico + '</span>' +
        '<span>' + it.label + '</span></button>';
    }).join('');
    bar.querySelectorAll('[data-pane]').forEach(function (b) {
      b.addEventListener('click', function () { show(b.getAttribute('data-pane')); });
    });
    show(items[0].id);
  }

  function render(d) {
    el('l-title').textContent = d.title || '';
    document.title = (d.title || 'الدرس') + ' — نورث للمسار المالي';

    /* الشارات: المستوى ثم ترتيب الدرس فيه — كلاهما من القاعدة */
    var chips = [];
    /* الرمز يُسبق العنوان إلا إن كان العنوان يبدأ به أصلاً — وإلا
       صار «A1 · A1 - المبتدئ» لأن الإدارة كتبت الرمز داخل الاسم.
       نفس قاعدة lvName في الخارطة، فلا تفترق الصفحتان. */
    if (d.level_title) {
      var t = String(d.level_title), c = String(d.level_code || '');
      chips.push('<span class="lchip lchip-a">' +
        esc(!c || t.indexOf(c) === 0 ? t : c + ' · ' + t) + '</span>');
    }
    if (d.lesson_no) {
      chips.push('<span class="lchip">' +
        (d.kind === 'strategy' ? 'استراتيجية ' : 'الدرس ') + num(d.lesson_no) + '</span>');
    }
    el('l-chips').innerHTML = chips.join('');

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
    el('l-cards').hidden = false;

    if (d.summary && d.summary.trim()) {
      el('l-desc').hidden = false;
      el('l-desc').textContent = d.summary.trim();
    }

    if (d.duration_min) {
      el('l-time').hidden = false;
      el('l-time-v').textContent = num(d.duration_min) + ' دقيقة';
    }

    video(d);

    if (d.content && d.content.trim()) {
      el('l-content').innerHTML = L.paras(d.content);
    }

    var v = d.vocab || [];
    if (v.length) {
      el('l-vocab').innerHTML = v.map(function (x) {
        return '<div class="vterm"><b>' + esc(x.term) + '</b>' +
          (x.meaning ? '<span>' + esc(x.meaning) + '</span>' : '') + '</div>';
      }).join('');
      el('l-vocab').insertAdjacentHTML('afterend',
        '<a class="btn btn-ghost btn-sm btn-wide" style="margin-top:12px" ' +
        'href="cards.html?lesson=' + encodeURIComponent(id) + '">راجعها كبطاقات</a>');
    }

    if (d.quiz_id) el('l-quiz').href = 'quiz.html?id=' + encodeURIComponent(d.quiz_id);

    tabs(d);

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
    label.textContent = done ? 'تمت المشاهدة' : 'تحديد كمشاهد';
    b.className = done ? 'btn btn-done' : 'btn btn-primary';
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
    /* thenable لا Promise: لا catch عليه، والخطأ يُلتقط كوسيط ثانٍ لـ then. */
    db.rpc('save_lesson_spot', { p_lesson: id, p_pos: p })
      .then(function () {}, function () {});
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
