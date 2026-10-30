/* تبويب الدروس والاستراتيجيات: إضافة وتعديل ونشر وحذف وبحث.
   «عيّنة مجانية» هي الفرق الوحيد بين ما يراه الزائر وما يراه المشترك. */
(function () {
  'use strict';
  var A = window.northAdmin;
  if (!A || !A.form) return;

  var db = A.db, el = A.el, esc = A.esc, F = A.form;
  var form = el('ls-form');
  if (!form) return;

  var list = el('ls-list');
  var resetBtn = el('ls-reset');
  var titleBox = el('ls-form-title');
  var search = el('ls-search');
  var levelSel = el('ls-level');

  var rows = [];
  var levels = [];
  var editing = null;
  var busy = false;
  var loaded = false;

  var KIND = { lesson: 'درس', strategy: 'استراتيجية' };

  A.guard().then(function (session) { if (session) { fillLevels(); load(); } });

  window.addEventListener('north:tab', function (e) {
    if (e.detail === 'lessons' && loaded) { fillLevels(); load(); }
  });
  window.addEventListener('north:levels', function (e) { paintLevels(e.detail || []); });

  /* ---------- قائمة المستويات ---------- */
  function fillLevels() {
    db.from('levels').select('id, title').order('sort_order').then(function (r) {
      if (r.error) return;
      paintLevels(r.data || []);
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
    if (!id) return '';
    var hit = levels.filter(function (lv) { return lv.id === id; })[0];
    return hit ? hit.title : '';
  }

  /* ---------- الأرقام ---------- */
  function kpis() {
    var c = document.querySelectorAll('#ls-kpis .kpi b');
    if (!c.length) return;
    var pub = rows.filter(function (r) { return r.published; }).length;
    c[0].textContent = F.num(pub);
    c[1].textContent = F.num(rows.length - pub);
    c[2].textContent = F.num(rows.filter(function (r) { return r.kind === 'strategy'; }).length);
    c[3].textContent = F.num(rows.filter(function (r) { return r.free_preview; }).length);
  }

  /* ---------- القائمة ---------- */
  function load() {
    F.loading(list);
    db.from('lessons').select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })
      .then(function (r) {
        loaded = true;
        if (r.error) { F.failed(list, F.why(r.error)); return; }
        rows = r.data || [];
        kpis();
        render();

        /* الدرس المفتوح للتعديل يُحدَّث بصفّه الجديد: بعد رفع
           ملفٍ أو حذفه تُعاد القائمة، ولو بقي النموذج على نسخةٍ
           قديمة لعرض ملفاً حُذف أو أخفى ملفاً رُفع. */
        if (editing) {
          var fresh = rows.filter(function (x) { return x.id === editing.id; })[0];
          if (fresh) { editing = fresh; upPaint(fresh); }
        }
      });
  }

  function visible() {
    var q = (search.value || '').trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(function (l) {
      return (l.title || '').toLowerCase().indexOf(q) !== -1 ||
             (l.summary || '').toLowerCase().indexOf(q) !== -1;
    });
  }

  function render() {
    var data = visible();
    if (!data.length) {
      F.empty(list, 'menu_book', rows.length
        ? 'لا نتائج لهذا البحث.'
        : 'لا توجد دروس بعد.<br>أضيفي أول درس من النموذج أعلاه.');
      return;
    }
    list.innerHTML = data.map(function (l) {
      var lv = levelName(l.level_id);
      return '<div class="srow" data-id="' + esc(l.id) + '">' +
        '<div class="sthumb"><span class="ms">' +
          (l.kind === 'strategy' ? 'insights' : 'menu_book') + '</span></div>' +
        '<div class="smeta">' +
          '<h3>' + esc(l.title) + '</h3>' +
          '<div class="line">' +
            '<span class="tag ' + (l.published ? 'tag-ok">منشور' : 'tag-off">مسودة') + '</span>' +
            '<span class="tag tag-off">' + esc(KIND[l.kind] || l.kind) + '</span>' +
            (l.free_preview ? '<span class="tag tag-admin">عيّنة مجانية</span>' : '') +
            (lv ? '<span>' + esc(lv) + '</span>' : '<span>بلا مستوى</span>') +
            (l.duration_min ? '<span>' + F.num(l.duration_min) + ' دقيقة</span>' : '') +
            '<span>ترتيب ' + esc(l.sort_order) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="sacts">' +
          '<button class="ib" data-act="toggle" title="' + (l.published ? 'إلغاء النشر' : 'نشر') + '">' +
            '<span class="ms">' + (l.published ? 'visibility_off' : 'visibility') + '</span></button>' +
          '<button class="ib" data-act="edit" title="تعديل"><span class="ms">edit</span></button>' +
          '<button class="ib danger" data-act="del" title="حذف"><span class="ms">delete</span></button>' +
        '</div>' +
      '</div>';
    }).join('');

    list.querySelectorAll('.srow').forEach(function (row) {
      var l = rows.filter(function (x) { return String(x.id) === row.getAttribute('data-id'); })[0];
      row.querySelector('[data-act=toggle]').addEventListener('click', function () { toggle(l); });
      row.querySelector('[data-act=edit]').addEventListener('click', function () { edit(l); });
      row.querySelector('[data-act=del]').addEventListener('click', function () { remove(l); });
    });
  }

  search.addEventListener('input', render);

  function toggle(l) {
    db.from('lessons').update({ published: !l.published }).eq('id', l.id).then(function (r) {
      if (r.error) { A.toast('تعذّر التغيير: ' + F.why(r.error), 'bad'); return; }
      A.toast(l.published ? 'أُلغي نشر الدرس.' : 'نُشر الدرس.');
      load();
    });
  }

  function remove(l) {
    if (!window.confirm('حذف «' + l.title + '» نهائياً؟ لا يمكن التراجع.')) return;
    db.from('lessons').delete().eq('id', l.id).then(function (r) {
      if (r.error) { A.toast('تعذّر الحذف: ' + F.why(r.error), 'bad'); return; }
      A.toast('حُذف الدرس.');
      if (editing && editing.id === l.id) reset();
      load();
    });
  }

  /* ---------- رفع ملف الفيديو ----------
     الرفع يحتاج معرّف الدرس — المجلّد هو المعرّف، وعليه تبني
     سياسةُ التخزين حكمها — فلا يُفتح إلا لدرس محفوظ.

     ولا يمرّ عبر supabase-js: دالته لا تعطي تقدّماً، وملفٌ بمئات
     الميجابايت بلا شريط تقدّم يبدو معلّقاً فتُغلق الصفحة في
     منتصفه. XHR على نفس نقطة التخزين، بنفس رمز الجلسة. */
  var upFor = null;          // الدرس المفتوح للتعديل
  var upBusy = false;

  function upErr(msg) {
    var n = el('ls-up-err');
    if (!n) return;
    n.textContent = msg || '';
    n.style.display = msg ? 'block' : 'none';
  }

  function upBar(pct) {
    var b = el('ls-up-bar');
    if (!b) return;
    b.hidden = pct == null;
    if (pct == null) return;
    b.querySelector('i').style.width = pct + '%';
    b.querySelector('span').textContent = pct + '%';
  }

  function upPaint(l) {
    var box = el('ls-up'), note = el('ls-up-note');
    if (!box) return;
    upFor = l;
    box.hidden = !l;
    if (note) note.hidden = !!l;
    upErr(''); upBar(null);
    var now = el('ls-up-now'), del = el('ls-up-del');
    var has = !!(l && l.video_path);
    if (now) {
      now.hidden = !has;
      now.textContent = has
        ? 'الملف الحالي: ' + String(l.video_path).split('/').slice(1).join('/')
        : '';
    }
    if (del) del.hidden = !has;
    if (el('ls-file')) el('ls-file').value = '';
    var pick = el('ls-up-pick'); if (pick) { pick.hidden = true; pick.textContent = ''; }
    var go = el('ls-up-go');
    if (go) { go.disabled = true; go.textContent = 'اختاري ملفاً أولاً'; }
  }

  /* اسم الملف يُعاد بناؤه: ما يكتبه النظام في اسم الملف لا يصلح
     مفتاحاً في التخزين، والامتداد وحده ما نحتاجه منه. */
  function safeName(name) {
    var m = String(name || '').match(/\.([A-Za-z0-9]{2,5})$/);
    return Date.now() + '.' + (m ? m[1].toLowerCase() : 'mp4');
  }

  function upload() {
    if (upBusy || !upFor) return;
    var f = el('ls-file').files[0];
    if (!f) { upErr('اختاري ملفاً أولاً.'); return; }
    if (f.size > 524288000) {
      upErr('الملف ' + Math.round(f.size / 1048576) + ' ميجابايت، والحدّ 500.');
      return;
    }

    var lesson = upFor, old = lesson.video_path || null;
    var path = lesson.id + '/' + safeName(f.name);

    upBusy = true; upErr(''); upBar(0);
    var go = el('ls-up-go'); go.disabled = true; go.textContent = 'جارٍ الرفع…';

    function done(msg, bad) {
      upBusy = false;
      go.textContent = 'اختاري ملفاً أولاً'; go.disabled = true;
      upBar(null);
      if (bad) { upErr(msg); return; }
      A.toast(msg, 'ok');
      load();
    }

    db.auth.getSession().then(function (r) {
      var token = r && r.data && r.data.session && r.data.session.access_token;
      if (!token) { done('انتهت جلستك. حدّثي الصفحة.', true); return; }

      var x = new XMLHttpRequest();
      x.open('POST', window.northConfig.url +
        '/storage/v1/object/lesson-videos/' + encodeURI(path), true);
      x.setRequestHeader('Authorization', 'Bearer ' + token);
      x.setRequestHeader('apikey', window.northConfig.key);
      x.setRequestHeader('x-upsert', 'true');
      if (f.type) x.setRequestHeader('Content-Type', f.type);

      x.upload.onprogress = function (e) {
        if (e.lengthComputable) upBar(Math.round((e.loaded / e.total) * 100));
      };
      x.onerror = function () { done('انقطع الاتصال أثناء الرفع.', true); };
      x.onload = function () {
        if (x.status < 200 || x.status >= 300) {
          var m = '';
          try { m = (JSON.parse(x.responseText) || {}).message || ''; } catch (e) {}
          done('تعذّر الرفع (' + x.status + ')' + (m ? ': ' + m : ''), true);
          return;
        }
        /* الصفّ يُحدَّث بعد نجاح الرفع لا قبله: لو عُكس الترتيب
           لأشار الدرس إلى ملفٍ قد لا يصل. */
        db.from('lessons').update({ video_path: path }).eq('id', lesson.id)
          .then(function (q) {
            if (q.error) { done('رُفع الملف ولم يُحفظ مساره: ' + F.why(q.error), true); return; }
            if (old && old !== path) db.storage.from('lesson-videos').remove([old]);
            done('رُفع الفيديو.');
          });
      };
      x.send(f);
    });
  }

  function dropVideo() {
    if (upBusy || !upFor || !upFor.video_path) return;
    if (!window.confirm('حذف ملف الفيديو من هذا الدرس؟')) return;
    var lesson = upFor, path = lesson.video_path;
    upBusy = true;
    db.from('lessons').update({ video_path: null }).eq('id', lesson.id).then(function (q) {
      upBusy = false;
      if (q.error) { upErr(F.why(q.error)); return; }
      db.storage.from('lesson-videos').remove([path]);
      A.toast('حُذف الملف.', 'ok');
      load();
    });
  }

  /* اختيار الملف خطوة، ورفعه خطوة. ومن لا يرى أن اختياره وقع
     يظنّ الزرّ لا يعمل — فالاسم والحجم يظهران فور الاختيار،
     ويتبدّل نصّ الزرّ إليهما. */
  function picked() {
    var f = el('ls-file').files[0];
    var pick = el('ls-up-pick'), go = el('ls-up-go');
    upErr('');

    if (!f) {
      pick.hidden = true; pick.textContent = '';
      go.disabled = true; go.textContent = 'اختاري ملفاً أولاً';
      return;
    }

    var mb = Math.round(f.size / 1048576);
    pick.hidden = false;
    pick.textContent = 'اخترتِ: ' + f.name + ' — ' + mb + ' ميجابايت';
    go.disabled = false;
    go.textContent = 'ارفعي الفيديو الآن';

    if (f.size > 524288000) {
      upErr('الملف ' + mb + ' ميجابايت والحدّ 500. صغّري الملف أو ارفعيه على يوتيوب والصقي رابطه.');
      go.disabled = true;
      return;
    }
    /* mov يُقبل رفعاً ولا يُشغَّل في كروم وفايرفوكس غالباً */
    if (/\.mov$/i.test(f.name) || f.type === 'video/quicktime') {
      upErr('تنبيه: صيغة mov لا تعمل في كروم وفايرفوكس. حوّليها إلى mp4 قبل الرفع ' +
            '(على الماك: QuickTime ← File ← Export As ← 720p).');
    }
  }

  if (el('ls-file')) el('ls-file').addEventListener('change', picked);
  if (el('ls-up-go')) el('ls-up-go').addEventListener('click', upload);
  if (el('ls-up-del')) el('ls-up-del').addEventListener('click', dropVideo);

  /* ---------- النموذج ---------- */
  function edit(l) {
    editing = l;
    titleBox.textContent = 'تعديل الدرس';
    el('ls-title').value = l.title || '';
    el('ls-kind').value = l.kind || 'lesson';
    levelSel.value = l.level_id || '';
    el('ls-video').value = l.video_url || '';
    el('ls-summary').value = l.summary || '';
    el('ls-content').value = l.content || '';
    el('ls-dur').value = l.duration_min == null ? '' : l.duration_min;
    el('ls-order').value = l.sort_order;
    if (el('ls-week')) el('ls-week').value = l.week_no == null ? '0' : l.week_no;
    if (el('ls-access')) el('ls-access').value = l.access || 'auto';
    if (el('ls-tier')) el('ls-tier').value = l.min_tier == null ? '1' : String(l.min_tier);
    el('ls-pub').checked = !!l.published;
    el('ls-free').checked = !!l.free_preview;
    upPaint(l);
    resetBtn.hidden = false;
    F.clearErrs(form);
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function reset() {
    editing = null;
    titleBox.textContent = 'إضافة درس';
    form.reset();
    el('ls-order').value = '0';
    if (el('ls-week')) el('ls-week').value = '0';
    if (el('ls-access')) el('ls-access').value = 'auto';
    if (el('ls-tier')) el('ls-tier').value = '1';
    levelSel.value = '';
    upPaint(null);
    resetBtn.hidden = true;
    F.clearErrs(form);
  }

  resetBtn.addEventListener('click', reset);

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    F.clearErrs(form);

    var title = el('ls-title').value.trim();
    if (!title) {
      F.fieldErr('ls-title', 'عنوان الدرس مطلوب.');
      el('ls-title').focus();
      return;
    }

    var dur = el('ls-dur').value.trim();
    var payload = {
      title: title,
      kind: el('ls-kind').value,
      level_id: levelSel.value || null,
      video_url: el('ls-video').value.trim() || null,
      summary: el('ls-summary').value.trim(),
      content: el('ls-content').value.trim(),
      duration_min: dur ? F.int(dur, null) : null,
      week_no: el('ls-week') ? F.int(el('ls-week').value, 0) : 0,
      access: el('ls-access') ? el('ls-access').value : 'auto',
      min_tier: el('ls-tier') ? (parseInt(el('ls-tier').value, 10) || 1) : 1,
      sort_order: F.int(el('ls-order').value, 0),
      published: el('ls-pub').checked,
      free_preview: el('ls-free').checked
    };

    busy = true;
    F.busy(form, true);

    var q = editing
      ? db.from('lessons').update(payload).eq('id', editing.id)
      : db.from('lessons').insert(payload);

    q.then(function (r) {
      busy = false;
      F.busy(form, false, 'حفظ الدرس');
      if (r.error) { A.toast('تعذّر الحفظ: ' + F.why(r.error), 'bad'); return; }
      A.toast(editing ? 'حُفظت التعديلات.' : 'أُضيف الدرس.');
      reset();
      load();
    });
  });
})();
