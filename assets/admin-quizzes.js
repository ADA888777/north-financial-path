/* تبويب الاختبارات: الاختبار وأسئلته وخياراته.
   الإجابة الصحيحة لا تصل متصفّح المشترك إطلاقاً — سياسات القاعدة
   تمنع قراءة answers لغير الإدارة، والتصحيح يتم في دالة grade_quiz. */
(function () {
  'use strict';
  var A = window.northAdmin;
  if (!A || !A.form) return;

  var db = A.db, el = A.el, esc = A.esc, F = A.form;
  var form = el('qz-form');
  if (!form) return;

  var list = el('qz-list');
  var resetBtn = el('qz-reset');
  var titleBox = el('qz-form-title');
  var levelSel = el('qz-level');

  var qnBox = el('qn-box');
  var qnForm = el('qn-form');
  var qnList = el('qn-list');
  var qnAnswers = el('qn-answers');
  var qnQuiz = el('qn-quiz');

  var rows = [];
  var counts = {};
  var levels = [];
  var editing = null;
  var openQuiz = null;
  var busy = false;
  var qnBusy = false;
  var loaded = false;
  var ANSWERS = 4;

  A.guard().then(function (session) { if (session) { fillLevels(); load(); } });

  window.addEventListener('north:tab', function (e) {
    if (e.detail === 'quizzes' && loaded) { fillLevels(); load(); }
  });
  window.addEventListener('north:levels', function (e) { paintLevels(e.detail || []); });

  function fillLevels() {
    db.from('levels').select('id, title').order('sort_order').then(function (r) {
      if (!r.error) paintLevels(r.data || []);
    });
  }

  function paintLevels(data) {
    levels = data;
    var keep = levelSel.value;
    levelSel.innerHTML = '<option value="">بلا مستوى</option>' + levels.map(function (lv) {
      return '<option value="' + esc(lv.id) + '">' + esc(lv.title) + '</option>';
    }).join('');
    if (keep) levelSel.value = keep;
  }

  function levelName(id) {
    var hit = levels.filter(function (lv) { return lv.id === id; })[0];
    return hit ? hit.title : '';
  }

  function kpis() {
    var c = document.querySelectorAll('#qz-kpis .kpi b');
    if (!c.length) return;
    var pub = rows.filter(function (r) { return r.published; }).length;
    var total = 0;
    Object.keys(counts).forEach(function (k) { total += counts[k]; });
    c[0].textContent = F.num(pub);
    c[1].textContent = F.num(rows.length - pub);
    c[2].textContent = F.num(total);
  }

  /* ---------- قائمة الاختبارات ---------- */
  function load() {
    F.loading(list);
    db.from('quizzes').select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
      .then(function (r) {
        loaded = true;
        if (r.error) { F.failed(list, F.why(r.error)); return; }
        rows = r.data || [];
        return db.from('questions').select('quiz_id').then(function (q) {
          counts = {};
          (q.data || []).forEach(function (x) {
            counts[x.quiz_id] = (counts[x.quiz_id] || 0) + 1;
          });
          kpis();
          render();
        });
      });
  }

  function render() {
    if (!rows.length) {
      F.empty(list, 'quiz', 'لا توجد اختبارات بعد.<br>أضيفي أول اختبار من النموذج أعلاه.');
      return;
    }
    list.innerHTML = rows.map(function (q) {
      var lv = levelName(q.level_id);
      var n = counts[q.id] || 0;
      return '<div class="srow" data-id="' + esc(q.id) + '">' +
        '<div class="sthumb"><span class="ms">quiz</span></div>' +
        '<div class="smeta">' +
          '<h3>' + esc(q.title) + '</h3>' +
          '<div class="line">' +
            '<span class="tag ' + (q.published ? 'tag-ok">منشور' : 'tag-off">مسودة') + '</span>' +
            '<span>' + F.num(n) + ' سؤال</span>' +
            '<span>النجاح ' + F.num(q.pass_score) + '٪</span>' +
            (lv ? '<span>' + esc(lv) + '</span>' : '<span>بلا مستوى</span>') +
          '</div>' +
          (q.published && n === 0
            ? '<div class="line" style="color:var(--a-warn);margin-top:6px">منشور بلا أسئلة — أضيفي أسئلته قبل أن يراه المشتركون.</div>'
            : '') +
        '</div>' +
        '<div class="sacts">' +
          '<button class="ib" data-act="questions" title="الأسئلة"><span class="ms">format_list_numbered</span></button>' +
          '<button class="ib" data-act="toggle" title="' + (q.published ? 'إلغاء النشر' : 'نشر') + '">' +
            '<span class="ms">' + (q.published ? 'visibility_off' : 'visibility') + '</span></button>' +
          '<button class="ib" data-act="edit" title="تعديل"><span class="ms">edit</span></button>' +
          '<button class="ib danger" data-act="del" title="حذف"><span class="ms">delete</span></button>' +
        '</div>' +
      '</div>';
    }).join('');

    list.querySelectorAll('.srow').forEach(function (row) {
      var q = rows.filter(function (x) { return String(x.id) === row.getAttribute('data-id'); })[0];
      row.querySelector('[data-act=questions]').addEventListener('click', function () { openQuestions(q); });
      row.querySelector('[data-act=toggle]').addEventListener('click', function () { toggle(q); });
      row.querySelector('[data-act=edit]').addEventListener('click', function () { edit(q); });
      row.querySelector('[data-act=del]').addEventListener('click', function () { remove(q); });
    });
  }

  function toggle(q) {
    db.from('quizzes').update({ published: !q.published }).eq('id', q.id).then(function (r) {
      if (r.error) { A.toast('تعذّر التغيير: ' + F.why(r.error), 'bad'); return; }
      A.toast(q.published ? 'أُلغي نشر الاختبار.' : 'نُشر الاختبار.');
      load();
    });
  }

  function remove(q) {
    if (!window.confirm('حذف «' + q.title + '» وكل أسئلته نهائياً؟ لا يمكن التراجع.')) return;
    db.from('quizzes').delete().eq('id', q.id).then(function (r) {
      if (r.error) { A.toast('تعذّر الحذف: ' + F.why(r.error), 'bad'); return; }
      A.toast('حُذف الاختبار.');
      if (editing && editing.id === q.id) reset();
      if (openQuiz && openQuiz.id === q.id) closeQuestions();
      load();
    });
  }

  /* ---------- نموذج الاختبار ---------- */
  function edit(q) {
    editing = q;
    titleBox.textContent = 'تعديل الاختبار';
    el('qz-title').value = q.title || '';
    levelSel.value = q.level_id || '';
    el('qz-desc').value = q.description || '';
    el('qz-pass').value = q.pass_score;
    el('qz-order').value = q.sort_order;
    el('qz-pub').checked = !!q.published;
    resetBtn.hidden = false;
    F.clearErrs(form);
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function reset() {
    editing = null;
    titleBox.textContent = 'إضافة اختبار';
    form.reset();
    el('qz-pass').value = '60';
    el('qz-order').value = '0';
    levelSel.value = '';
    resetBtn.hidden = true;
    F.clearErrs(form);
  }

  resetBtn.addEventListener('click', reset);

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    F.clearErrs(form);

    var title = el('qz-title').value.trim();
    if (!title) {
      F.fieldErr('qz-title', 'عنوان الاختبار مطلوب.');
      el('qz-title').focus();
      return;
    }
    var pass = F.int(el('qz-pass').value, -1);
    if (pass < 0 || pass > 100) {
      F.fieldErr('qz-pass', 'درجة النجاح رقم بين 0 و 100.');
      el('qz-pass').focus();
      return;
    }

    var payload = {
      title: title,
      level_id: levelSel.value || null,
      description: el('qz-desc').value.trim(),
      pass_score: pass,
      sort_order: F.int(el('qz-order').value, 0),
      published: el('qz-pub').checked
    };

    busy = true;
    F.busy(form, true);

    var q = editing
      ? db.from('quizzes').update(payload).eq('id', editing.id)
      : db.from('quizzes').insert(payload);

    q.then(function (r) {
      busy = false;
      F.busy(form, false, 'حفظ الاختبار');
      if (r.error) { A.toast('تعذّر الحفظ: ' + F.why(r.error), 'bad'); return; }
      A.toast(editing ? 'حُفظت التعديلات.' : 'أُضيف الاختبار.');
      reset();
      load();
    });
  });

  /* ---------- الأسئلة ---------- */
  function blankAnswers() {
    var html = '';
    for (var i = 0; i < ANSWERS; i++) {
      html +=
        '<label class="chk" style="gap:10px">' +
          '<input type="radio" name="qn-correct" value="' + i + '"' + (i === 0 ? ' checked' : '') + '>' +
          '<input type="text" class="qn-a" data-i="' + i + '" placeholder="الخيار ' + (i + 1) + '">' +
        '</label>';
    }
    qnAnswers.innerHTML = html;
  }

  function openQuestions(q) {
    openQuiz = q;
    qnQuiz.textContent = q.title;
    qnBox.hidden = false;
    blankAnswers();
    qnForm.reset();
    blankAnswers();
    loadQuestions();
    qnBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeQuestions() {
    openQuiz = null;
    qnBox.hidden = true;
  }

  el('qn-close').addEventListener('click', closeQuestions);

  function loadQuestions() {
    if (!openQuiz) return;
    F.loading(qnList);
    db.from('questions').select('*').eq('quiz_id', openQuiz.id)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
      .then(function (r) {
        if (r.error) { F.failed(qnList, F.why(r.error)); return; }
        var qs = r.data || [];
        if (!qs.length) {
          F.empty(qnList, 'help', 'لا أسئلة في هذا الاختبار بعد.');
          return;
        }
        var ids = qs.map(function (x) { return x.id; });
        db.from('answers').select('*').in('question_id', ids)
          .order('sort_order', { ascending: true })
          .then(function (ar) {
            var byQ = {};
            (ar.data || []).forEach(function (a) {
              (byQ[a.question_id] = byQ[a.question_id] || []).push(a);
            });
            renderQuestions(qs, byQ);
          });
      });
  }

  function renderQuestions(qs, byQ) {
    qnList.innerHTML = qs.map(function (q, i) {
      var as = byQ[q.id] || [];
      return '<div class="srow" data-id="' + esc(q.id) + '" style="grid-template-columns:1fr auto">' +
        '<div class="smeta">' +
          '<h3>' + F.num(i + 1) + '. ' + esc(q.text) + '</h3>' +
          '<div class="line" style="flex-direction:column;align-items:flex-start;gap:4px">' +
            as.map(function (a) {
              return '<span style="' + (a.is_correct ? 'color:var(--a-ok);font-weight:600' : '') + '">' +
                (a.is_correct ? '✔ ' : '— ') + esc(a.text) + '</span>';
            }).join('') +
            (as.length ? '' : '<span style="color:var(--a-warn)">بلا خيارات</span>') +
          '</div>' +
        '</div>' +
        '<div class="sacts">' +
          '<button class="ib danger" data-act="del" title="حذف السؤال"><span class="ms">delete</span></button>' +
        '</div>' +
      '</div>';
    }).join('');

    qnList.querySelectorAll('.srow').forEach(function (row) {
      var id = row.getAttribute('data-id');
      row.querySelector('[data-act=del]').addEventListener('click', function () {
        if (!window.confirm('حذف هذا السؤال وخياراته؟')) return;
        db.from('questions').delete().eq('id', id).then(function (r) {
          if (r.error) { A.toast('تعذّر الحذف: ' + F.why(r.error), 'bad'); return; }
          A.toast('حُذف السؤال.');
          loadQuestions();
          load();
        });
      });
    });
  }

  qnForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (qnBusy || !openQuiz) return;
    F.clearErrs(qnForm);

    var text = el('qn-text').value.trim();
    if (!text) {
      F.fieldErr('qn-text', 'نص السؤال مطلوب.');
      el('qn-text').focus();
      return;
    }

    var picked = qnForm.querySelector('input[name=qn-correct]:checked');
    var correct = picked ? parseInt(picked.value, 10) : -1;
    var texts = [];
    qnAnswers.querySelectorAll('.qn-a').forEach(function (inp) {
      texts.push({ i: parseInt(inp.getAttribute('data-i'), 10), text: inp.value.trim() });
    });
    var filled = texts.filter(function (t) { return t.text; });

    if (filled.length < 2) {
      F.fieldErr('qn-answers', 'اكتبي خيارين على الأقل.');
      return;
    }
    if (correct < 0 || !texts.filter(function (t) { return t.i === correct && t.text; }).length) {
      F.fieldErr('qn-answers', 'الخيار المحدّد صحيحاً فارغ. اختاري خياراً مكتوباً.');
      return;
    }

    qnBusy = true;
    F.busy(qnForm, true);

    var order = (qnList.querySelectorAll('.srow').length || 0) + 1;

    db.from('questions').insert({ quiz_id: openQuiz.id, text: text, sort_order: order })
      .select('id').single()
      .then(function (r) {
        if (r.error) throw r.error;
        var payload = filled.map(function (t, idx) {
          return {
            question_id: r.data.id,
            text: t.text,
            is_correct: t.i === correct,
            sort_order: idx
          };
        });
        return db.from('answers').insert(payload).then(function (ar) {
          if (ar.error) {
            /* لا نترك سؤالاً بلا خيارات */
            return db.from('questions').delete().eq('id', r.data.id).then(function () { throw ar.error; });
          }
        });
      })
      .then(function () {
        qnBusy = false;
        F.busy(qnForm, false, 'إضافة السؤال');
        A.toast('أُضيف السؤال.');
        qnForm.reset();
        blankAnswers();
        el('qn-text').focus();
        loadQuestions();
        load();
      })
      .catch(function (err) {
        qnBusy = false;
        F.busy(qnForm, false, 'إضافة السؤال');
        A.toast('تعذّر حفظ السؤال: ' + F.why(err), 'bad');
      });
  });

  blankAnswers();
})();
