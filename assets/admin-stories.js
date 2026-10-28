/* إدارة قصص النجاح: عرض، إضافة، تعديل، نشر، حذف، رفع صور. */
(function () {
  'use strict';
  var A = window.northAdmin;
  if (!A) return;

  var db = A.db, el = A.el, esc = A.esc;
  var BUCKET = 'story-images';
  var MAX_BYTES = 3 * 1024 * 1024;
  var TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  var list = el('list'), sheet = el('sheet'), form = el('form');
var storyRows = [];
  var fileIn = el('file'), drop = el('drop');
  var editingId = null;      /* null = إضافة */
  var editingPath = null;    /* مسار الصورة الحالية */
  var pickedFile = null;     /* ملف جديد لم يُرفع بعد */
  var removeOld = false;
  var busy = false;

  A.guard().then(function (session) { if (session) load(); });

  function kpis(rows) {
    var c = document.querySelectorAll('#story-kpis .kpi b');
    if (!c.length) return;
    var pub = rows.filter(function (s) { return s.published; }).length;
    c[0].textContent = new Intl.NumberFormat('ar-SA').format(pub);
    c[1].textContent = new Intl.NumberFormat('ar-SA').format(rows.length - pub);
  }

  /* ---------------- القائمة ---------------- */
  function skeleton() {
    list.innerHTML = '<div class="state"><span class="ms">hourglass_top</span> جارٍ التحميل…</div>';
  }

  function load() {
    skeleton();
    db.from('success_stories')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })
      .then(function (r) {
        if (r.error) {
          list.innerHTML = '<div class="state"><span class="ms">error</span>' +
            'تعذّر تحميل القصص.<br>' + esc(r.error.message) +
            '<br><br>إذا كان الجدول غير موجود، شغّل <code>supabase/01_stories_and_admin.sql</code>.</div>';
          return;
        }
        storyRows = r.data || [];
        kpis(storyRows);
        render(storyRows);
      });
  }

  function render(rows) {
    if (!rows.length) {
      list.innerHTML = '<div class="state"><span class="ms">auto_stories</span>' +
        'لا توجد قصص بعد.<br>اضغط «إضافة قصة» للبدء.</div>';
      return;
    }
    list.innerHTML = rows.map(function (s) {
      var url = s.image_path ? A.imageUrl(s.image_path) : '';
      return '<div class="srow" data-id="' + esc(s.id) + '">' +
        '<div class="sthumb">' +
          (url ? '<img src="' + esc(url) + '" alt="" loading="lazy">' : '<span class="ms">image</span>') +
        '</div>' +
        '<div class="smeta">' +
          '<h3>' + esc(s.title) + '</h3>' +
          '<div class="line">' +
            '<span class="tag ' + (s.published ? 'tag-ok">منشورة' : 'tag-off">مسودة') + '</span>' +
            '<span>ترتيب ' + esc(s.sort_order) + '</span>' +
            (s.amount ? '<span class="tag tag-off">' + esc(s.amount) + '</span>' : '') +
            '<span>آخر تعديل ' + esc(A.fmtDate(s.updated_at)) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="sacts">' +
          '<button class="ib" data-act="toggle" title="' + (s.published ? 'إلغاء النشر' : 'نشر') + '">' +
            '<span class="ms">' + (s.published ? 'visibility_off' : 'visibility') + '</span></button>' +
          '<button class="ib" data-act="edit" title="تعديل"><span class="ms">edit</span></button>' +
          '<button class="ib danger" data-act="del" title="حذف"><span class="ms">delete</span></button>' +
        '</div>' +
      '</div>';
    }).join('');

    list.querySelectorAll('.srow').forEach(function (row) {
      var s = rows.filter(function (x) { return String(x.id) === row.getAttribute('data-id'); })[0];
      row.querySelector('[data-act=toggle]').addEventListener('click', function () { toggle(s); });
      row.querySelector('[data-act=edit]').addEventListener('click', function () { open(s); });
      row.querySelector('[data-act=del]').addEventListener('click', function () { remove(s); });
    });
  }

  /* ---------------- نشر وإلغاء نشر ---------------- */
  function toggle(s) {
    db.from('success_stories').update({ published: !s.published }).eq('id', s.id)
      .then(function (r) {
        if (r.error) { A.toast('تعذّر التغيير: ' + r.error.message, 'bad'); return; }
        A.toast(s.published ? 'أُلغي نشر القصة.' : 'نُشرت القصة.');
        load();
      });
  }

  /* ---------------- حذف ---------------- */
  function remove(s) {
    if (!window.confirm('حذف «' + s.title + '» نهائياً؟ لا يمكن التراجع.')) return;
    db.from('success_stories').delete().eq('id', s.id).then(function (r) {
      if (r.error) { A.toast('تعذّر الحذف: ' + r.error.message, 'bad'); return; }
      if (s.image_path) db.storage.from(BUCKET).remove([s.image_path]);
      A.toast('حُذفت القصة.');
      load();
    });
  }

  /* ---------------- النموذج ---------------- */
  function setPreview(url) {
    drop.innerHTML = url
      ? '<img src="' + esc(url) + '" alt="معاينة الصورة">' +
        '<p>اضغط لاختيار صورة أخرى</p>'
      : '<span class="ms">add_photo_alternate</span>' +
        '<p>اختر صورة — JPG أو PNG أو WebP، بحد أقصى 3 ميغابايت</p>';
    drop.appendChild(fileIn);
  }

  function fieldError(id, msg) {
    if (id === 'file') {
      var fb = el('err-file');
      fb.textContent = msg || '';
      fb.style.display = msg ? 'block' : 'none';
      return;
    }
    var f = document.querySelector('[data-fld="' + id + '"]');
    if (!f) return;
    f.classList.toggle('bad', !!msg);
    if (msg) f.querySelector('.bad-msg').textContent = msg;
  }

  function open(s) {
    editingId = s ? s.id : null;
    editingPath = s ? s.image_path : null;
    pickedFile = null; removeOld = false;
    fieldError('title', ''); fieldError('file', '');

    el('sheet-title').textContent = s ? 'تعديل القصة' : 'إضافة قصة نجاح';
    el('title').value = s ? (s.title || '') : '';
    el('body').value = s ? (s.body || '') : '';
    el('trainee').value = s ? (s.trainee_name || '') : '';
    el('order').value = s ? String(s.sort_order) : '0';
    el('amount').value = s ? (s.amount || '') : '';
    el('showname').checked = s ? !!s.show_name : false;
    el('published').checked = s ? !!s.published : false;
    setPreview(s && s.image_path ? A.imageUrl(s.image_path) : '');

    sheet.classList.add('on');
    document.body.style.overflow = 'hidden';
    el('title').focus();
  }

  function close() {
    sheet.classList.remove('on');
    document.body.style.overflow = '';
    if (pickedFile && drop.querySelector('img')) {
      URL.revokeObjectURL(drop.querySelector('img').src);
    }
  }

  el('add').addEventListener('click', function () { open(null); });
  el('close').addEventListener('click', close);
  el('cancel').addEventListener('click', close);
  sheet.addEventListener('click', function (e) { if (e.target === sheet) close(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && sheet.classList.contains('on')) close();
  });

  fileIn.addEventListener('change', function () {
    var f = fileIn.files && fileIn.files[0];
    if (!f) return;
    if (TYPES.indexOf(f.type) === -1) {
      fieldError('file', 'نوع الملف غير مسموح. اختر JPG أو PNG أو WebP.');
      fileIn.value = ''; return;
    }
    if (f.size > MAX_BYTES) {
      fieldError('file', 'حجم الصورة ' + (f.size / 1048576).toFixed(1) + ' ميغابايت، والحد 3.');
      fileIn.value = ''; return;
    }
    fieldError('file', '');
    pickedFile = f;
    removeOld = !!editingPath;
    setPreview(URL.createObjectURL(f));
  });

  /* ---------------- الحفظ ---------------- */
  function upload(file) {
    var ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    var name = Date.now() + '-' + Math.random().toString(36).slice(2, 9) + '.' + ext;
    return db.storage.from(BUCKET)
      .upload(name, file, { cacheControl: '3600', contentType: file.type })
      .then(function (r) {
        if (r.error) throw r.error;
        return r.data.path;
      });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;

    var title = el('title').value.trim();
    if (!title) { fieldError('title', 'العنوان مطلوب.'); el('title').focus(); return; }
    fieldError('title', '');

    var order = parseInt(el('order').value, 10);
    if (isNaN(order)) order = 0;

    busy = true;
    var btn = form.querySelector('[type=submit]');
    var label = btn.querySelector('[data-label]');
    var original = label.textContent;
    btn.setAttribute('aria-busy', 'true'); btn.disabled = true;
    label.textContent = 'جارٍ الحفظ';

    function done(ok, msg) {
      busy = false;
      btn.removeAttribute('aria-busy'); btn.disabled = false;
      label.textContent = original;
      A.toast(msg, ok ? 'ok' : 'bad');
      if (ok) { close(); load(); }
    }

    var step = pickedFile ? upload(pickedFile) : Promise.resolve(editingPath);

    step.then(function (path) {
      var row = {
        title: title,
        body: el('body').value.trim(),
        trainee_name: el('trainee').value.trim() || null,
        amount: el('amount').value.trim() || null,
        show_name: el('showname').checked,
        published: el('published').checked,
        sort_order: order,
        image_path: path || null
      };

      var q = editingId
        ? db.from('success_stories').update(row).eq('id', editingId)
        : db.from('success_stories').insert(row);

      return q.then(function (r) {
        if (r.error) throw r.error;
        /* الصورة القديمة تُحذف بعد نجاح الحفظ فقط */
        if (removeOld && editingPath && editingPath !== path) {
          db.storage.from(BUCKET).remove([editingPath]);
        }
        done(true, editingId ? 'حُفظت التعديلات.' : 'أُضيفت القصة.');
      });
    }).catch(function (err) {
      done(false, 'تعذّر الحفظ: ' + (err && err.message ? err.message : 'خطأ غير معروف'));
    });
  });
})();
