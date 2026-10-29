/* التحدي: المتعلم يكتب تعريف المصطلح.
   التعريف المعتمد لا يصل المتصفح قبل أن يجيب، والحكم يصدر من الخادم
   بمقارنة كلمات جوابه بكلمات التعريف — قاعدة معلنة لا ذكاء اصطناعي. */
(function () {
  'use strict';
  var L = window.northLearn, db = L.db, el = L.el, esc = L.esc, num = L.num;

  var items = [], i = 0, stat = { total: 0, answered: 0, correct: 0 }, busy = false;

  var VERDICT = {
    correct: { t: 'إجابة صحيحة', c: 'ok',   ico: 'check_circle' },
    close:   { t: 'قريبة',        c: 'mid',  ico: 'adjust' },
    wrong:   { t: 'غير صحيحة',    c: 'no',   ico: 'cancel' }
  };

  function head() {
    el('ch-head').innerHTML =
      '<div class="ch-head">' +
        '<div class="chh-n"><b>' + num(stat.correct) + '<i>/' + num(stat.total) + '</i></b>' +
          '<span>إجابات صحيحة</span></div>' +
        '<div class="chh-n"><b>' + num(stat.answered) + '</b><span>مفردة أجبتها</span></div>' +
        '<div class="chh-n"><b>' +
          (stat.answered ? num(Math.round(stat.correct * 100 / stat.answered)) + '<i>%</i>' : '—') +
          '</b><span>نسبة الإتقان</span></div>' +
      '</div>';
  }

  function done() {
    el('ch-body').innerHTML =
      '<section class="lbox ch-done">' +
        '<span class="ms">military_tech</span>' +
        '<h2>أنهيت كل المفردات المتاحة</h2>' +
        '<p>' + num(stat.correct) + ' صحيحة من ' + num(stat.total) + '. ' +
          'تُضاف مفردات جديدة كلما فتحت مرحلة جديدة.</p>' +
        '<div class="ch-acts">' +
          '<a class="btn btn-primary" href="map.html">خارطة التقدم</a>' +
          '<a class="btn btn-ghost" href="learn.html">لوحتي</a>' +
          '<button class="btn btn-ghost" type="button" id="again">راجع من البداية</button>' +
        '</div>' +
      '</section>';
    el('again').addEventListener('click', function () { i = 0; card(); });
  }

  function card() {
    if (!items.length) {
      el('ch-body').innerHTML = '<section class="lbox"><p class="empty">' +
        'لا توجد مفردات متاحة بعد. تظهر هنا مفردات الدروس في المراحل التي فتحتها.' +
        '</p><a class="btn btn-ghost btn-sm btn-wide" href="map.html">خارطة التقدم</a></section>';
      return;
    }
    if (i >= items.length) { done(); return; }

    var v = items[i];
    el('ch-body').innerHTML =
      '<section class="lbox vq">' +
        '<div class="vq-h">' +
          '<span class="vq-n">المفردة ' + num(i + 1) + ' من ' + num(items.length) + '</span>' +
          '<a class="vq-lesson" href="lesson.html?id=' + encodeURIComponent(v.lesson_id) + '">' +
            '<span class="ms">menu_book</span>' + esc(v.lesson) + '</a>' +
        '</div>' +
        '<p class="vq-lbl">اكتب تعريف هذا المصطلح</p>' +
        '<h2 class="vq-term">' + esc(v.term) + '</h2>' +
        '<div class="fld vq-f">' +
          '<label for="ans" class="sr">اكتب التعريف</label>' +
          '<textarea id="ans" rows="3" maxlength="400" placeholder="اكتب التعريف بأسلوبك"></textarea>' +
        '</div>' +
        '<div class="vq-acts">' +
          '<button class="btn btn-primary" type="button" id="check">تحقق من الإجابة</button>' +
          '<a class="btn btn-ghost" href="lesson.html?id=' + encodeURIComponent(v.lesson_id) + '">مراجعة الدروس</a>' +
        '</div>' +
        '<p class="vq-rule">التحقق يقارن كلمات جوابك بكلمات التعريف المعتمد. ' +
          'إن كتبت صياغة صحيحة بكلمات أخرى ورفضها، أرسلها لمراجعة المعلّم.</p>' +
        '<div id="vq-res"></div>' +
      '</section>';

    var ta = el('ans');
    ta.focus();
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) check();
    });
    el('check').addEventListener('click', check);

    // مفردة أُجيبت سابقاً: يُعرض ما كان دون إعادة احتساب
    if (v.answered) {
      ta.value = v.my_answer || '';
      result({ verdict: v.verdict, meaning: v.meaning, repeat: true, counted: false },
             v.id, true);
    }
  }

  function result(d, vocabId, silent) {
    var vd = VERDICT[d.verdict] || VERDICT.wrong;
    el('vq-res').innerHTML =
      '<div class="vq-res ' + vd.c + '">' +
        '<div class="vr-h"><span class="ms">' + vd.ico + '</span><b>' + vd.t + '</b>' +
          (d.overlap != null ? '<span class="vr-p">تطابق ' + num(d.overlap) + '%</span>' : '') +
        '</div>' +
        '<p><span class="vr-l">التعريف المعتمد</span>' + esc(d.meaning || '') + '</p>' +
        (d.repeat && !silent
          ? '<p class="vr-n">أجبت هذه المفردة من قبل، فلم تُحتسب مرة ثانية.</p>' : '') +
        '<div class="vr-f">' +
          (i + 1 < items.length
            ? '<button class="btn btn-primary" type="button" id="next">المفردة التالية</button>'
            : '<button class="btn btn-primary" type="button" id="next">عرض النتيجة</button>') +
          (d.verdict !== 'correct'
            ? '<button class="btn btn-ghost" type="button" id="dispute">جوابي صحيح، أرسله للمراجعة</button>'
            : '') +
        '</div>' +
      '</div>';

    el('next').addEventListener('click', function () { i++; card(); });
    var dz = el('dispute');
    if (dz) {
      dz.addEventListener('click', function () {
        dz.disabled = true;
        db.rpc('dispute_vocab', { p_vocab: vocabId }).then(function (r) {
          var x = (r && r.data) || {};
          dz.outerHTML = '<span class="vr-sent">' +
            esc(x.error || x.message || 'أُرسلت للمراجعة') + '</span>';
        }).catch(function () { dz.disabled = false; });
      });
    }
  }

  function check() {
    if (busy) return;
    var v = items[i];
    var ans = (el('ans').value || '').trim();
    if (!ans) { el('ans').focus(); return; }

    busy = true;
    var b = el('check');
    b.disabled = true; b.textContent = 'جارٍ التحقق…';

    db.rpc('check_vocab', { p_vocab: v.id, p_answer: ans }).then(function (r) {
      busy = false; b.disabled = false; b.textContent = 'تحقق من الإجابة';
      var d = (r && r.data) || {};
      if (r.error || d.error) {
        el('vq-res').innerHTML = '<p class="vq-err">' +
          esc(d.error || r.error.message) + '</p>';
        return;
      }
      // الاحتساب من الخادم: الضغط مرتين لا يزيد النتيجة
      if (d.counted) {
        stat.answered += 1;
        if (d.verdict === 'correct' || d.verdict === 'close') stat.correct += 1;
      }
      v.answered = true; v.verdict = d.verdict; v.meaning = d.meaning; v.my_answer = ans;
      head();
      result(d, v.id, false);
    }).catch(function (e) {
      busy = false; b.disabled = false; b.textContent = 'تحقق من الإجابة';
      el('vq-res').innerHTML = '<p class="vq-err">' +
        esc((e && e.message) || 'تعذّر التحقق') + '</p>';
    });
  }

  L.guard().then(function (s) {
    if (!s) return;
    return db.rpc('my_vocab_challenge', { p_limit: 100 }).then(function (r) {
      var d = (r && r.data) || {};
      if (r.error || d.error) {
        el('ch-body').innerHTML = '<section class="lbox"><p class="empty">' +
          esc(d.error || r.error.message || 'تعذّر التحميل') + '</p></section>';
        return;
      }
      items = d.items || [];
      stat = { total: d.total || 0, answered: d.answered || 0, correct: d.correct || 0 };
      // يبدأ من أول مفردة لم تُجب، لا من أولها دائماً
      var k = items.findIndex(function (x) { return !x.answered; });
      i = k === -1 ? 0 : k;
      head();
      card();
    });
  }).catch(function (e) {
    L.deny('تعذّر تحميل التحدي', (e && e.message) || '', false);
  });
})();
