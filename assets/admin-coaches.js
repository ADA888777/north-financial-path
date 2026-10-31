/* الكوتشات وجداول توفّرهم.
   التوفّر أسبوعي متكرّر، ومنه تُولَّد مواعيد الحجز في الخادم. */
(function () {
  'use strict';
  var A = window.northAdmin;
  if (!A) return;
  var db = A.db, el = A.el, esc = A.esc, no = A.no, who = A.who;

  var panel = document.querySelector('[data-panel="coaches"]');
  if (!panel) return;

  var DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  var rows = [], avail = [], sessions = 0, busy = false, sheet = null, editing = null;
  var photoPath = null, dropPhoto = false;
  /* النافذة المعتمدة وتقييمات الكوتشات — كلاهما من القاعدة.
     المتوسط محسوب من التقييمات المحفوظة، فلا يملك أحد كتابته. */
  var policy = { open_from: '18:00', open_to: '23:00' };
  var openDays = [0, 1, 2, 3, 4];
  var ratings = {};

  /* 1 / 0.5 / 0 → كلمةٌ تُقرأ بدل كسرٍ يُفسَّر */
  function starWord(v) {
    var n = Number(v);
    return n >= 1 ? 'نجمة كاملة' : n > 0 ? 'نصف نجمة' : 'بدون نجمة';
  }

  function rateLine(id) {
    var r = ratings[id];
    if (!r || !r.count) {
      return '<span class="co-meta">لا توجد تقييمات بعد</span>';
    }
    /* الرصيد مجموعُ ما كُسب: كل جلسة نجمة أو نصف أو لا شيء.
       والمتوسط بجانبه ليُقرأ المجموع في سياق عدد الجلسات. */
    return '<span class="co-meta co-rt"><span class="ms">star</span>' +
      esc(r.total) + ' نجمة من ' + esc(r.count) + ' جلسة · المتوسط ' +
      esc(r.avg) + '</span>';
  }

  function showRatings(id, host) {
    var r = ratings[id] || {};
    var list = r.ratings || [];
    if (host._open) { host.innerHTML = ''; host._open = false; return; }
    host._open = true;

    if (!list.length) {
      host.innerHTML = '<p class="muted" style="padding:10px 0">' +
        'لا توجد تقييمات لهذا الكوتش بعد.</p>';
      return;
    }
    host.innerHTML =
      '<p class="sub" style="margin:10px 0">الرصيد ' + esc(r.total) + ' نجمة من ' +
        esc(r.count) + ' جلسة حضرها أصحابها (المتوسط ' + esc(r.avg) + ') — محسوب ' +
        'من التقييمات ولا يُعدَّل يدوياً. سبب أيّ تقييم دون النجمة الكاملة ' +
        'يظهر هنا وللكوتش فقط، ولا يراه بقية الأعضاء.</p>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        '<th>العضو</th><th>التقييم</th><th>الملاحظة</th><th>التاريخ</th>' +
      '</tr></thead><tbody>' +
      list.map(function (x) {
        return '<tr><td>' + esc(x.member || '—') +
            ' <span class="mno">' + esc(no(x.membership_no)) + '</span></td>' +
          '<td><span class="num">' + esc(starWord(x.stars)) + '</span></td>' +
          '<td>' + esc(x.comment || '—') + '</td>' +
          '<td class="muted">' + esc(A.fmtDate(x.at)) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function kpis() {
    var c = panel.querySelectorAll('#co-kpis .kpi b');
    if (c.length < 3) return;
    c[0].textContent = rows.filter(function (x) { return x.active; }).length;
    c[1].textContent = avail.filter(function (x) { return x.active; }).length;
    c[2].textContent = sessions;
  }

  function hhmm(t) { return String(t || '').slice(0, 5); }

  function draw() {
    if (!rows.length) {
      el('co-list').innerHTML = '<div class="state"><span class="ms">person_add</span>' +
        'لا يوجد كوتشات. أضف كوتشاً ليظهر للمشتركات في صفحة الكلاسات الخاصة.</div>';
      kpis(); return;
    }
    el('co-list').innerHTML = rows.map(function (c) {
      var av = avail.filter(function (a) { return a.coach_id === c.id; })
        .sort(function (a, b) { return a.weekday - b.weekday || a.start_time.localeCompare(b.start_time); });
      return '<div class="co-card">' +
        '<div class="co-h">' +
          '<div><b>' + esc(c.name) + '</b>' +
            (c.title ? '<span class="muted"> · ' + esc(c.title) + '</span>' : '') +
            '<span class="co-meta">' + esc(c.slot_min) + ' دقيقة للجلسة' +
              (c.telegram ? ' · ' + esc(c.telegram) : '') + '</span>' +
            rateLine(c.id) + '</div>' +
          (c.active ? '<span class="tag tag-ok">مفعّل</span>' : '<span class="tag tag-off">معطّل</span>') +
          '<div class="co-btns">' +
            '<button class="bt bt-ghost bt-sm" type="button" data-co="' + esc(c.id) + '">تعديل</button>' +
            '<button class="bt bt-ghost bt-sm" type="button" data-co-del="' + esc(c.id) + '">حذف</button>' +
            '<button class="bt bt-ghost bt-sm" type="button" data-co-rt="' + esc(c.id) + '">التقييمات</button>' +
          '</div>' +
        '</div>' +
        '<div class="av">' +
          (av.length
            ? av.map(function (a) {
                return '<span class="av-i' + (a.active ? '' : ' off') + '">' +
                  esc(DAYS[a.weekday]) + ' ' + esc(hhmm(a.start_time)) + '–' + esc(hhmm(a.end_time)) +
                  '<button type="button" data-av-del="' + esc(a.id) + '" aria-label="حذف">&times;</button>' +
                  '</span>';
              }).join('')
            : '<span class="muted">بلا أوقات توفّر — لن تظهر له مواعيد للحجز.</span>') +
        '</div>' +
        '<div class="co-rt-box" data-rt-host="' + esc(c.id) + '"></div>' +
        '<form class="av-add" data-coach="' + esc(c.id) + '">' +
          '<select name="d">' + DAYS.map(function (d, i) {
            // الأيام المغلقة لا تُعرض أصلاً: القاعدة ترفضها على كل حال
            return (openDays.indexOf(i) === -1)
              ? ''
              : '<option value="' + i + '">' + d + '</option>'; }).join('') + '</select>' +
          '<input name="s" type="time" value="' + esc(policy.open_from || '18:00') +
            '" min="' + esc(policy.open_from || '18:00') + '" max="' + esc(policy.open_to || '23:00') + '" step="900">' +
          '<input name="e" type="time" value="' + esc(policy.open_to || '23:00') +
            '" min="' + esc(policy.open_from || '18:00') + '" max="' + esc(policy.open_to || '23:00') + '" step="900">' +
          '<button class="bt bt-soft bt-sm" type="submit">أضف وقتاً</button>' +
        '</form>' +
      '</div>';
    }).join('');

    el('co-list').querySelectorAll('[data-co-rt]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-co-rt');
        showRatings(id, el('co-list').querySelector('[data-rt-host="' + id + '"]'));
      });
    });

    el('co-list').querySelectorAll('.av-add').forEach(function (f) {
      f.addEventListener('submit', function (e) { e.preventDefault(); addAvail(f); });
    });
    kpis();
  }

  function load() {
    el('co-list').innerHTML = '<div class="state"><span class="ms">hourglass_top</span>جارٍ التحميل…</div>';
    return Promise.all([
      db.from('coaches').select('*').order('sort_order'),
      db.from('coach_availability').select('*'),
      db.from('class_slots').select('id', { count: 'exact', head: true })
        .eq('kind', 'private').eq('status', 'scheduled'),
      db.rpc('admin_coach_ratings'),
      db.from('booking_policy').select('*').maybeSingle()
    ]).then(function (r) {
      if (r[0].error) {
        el('co-list').innerHTML = '<div class="state"><span class="ms">error</span>' +
          esc(r[0].error.message) + '</div>';
        return;
      }
      rows = r[0].data || [];
      avail = (!r[1].error && r[1].data) || [];
      sessions = (!r[2].error && r[2].count) || 0;

      ratings = {};
      var rt = (r[3] && !r[3].error && r[3].data) || [];
      if (Array.isArray(rt)) {
        rt.forEach(function (x) { ratings[x.coach_id] = x; });
      }

      var pol = (r[4] && !r[4].error && r[4].data) || null;
      if (pol) {
        policy = { open_from: String(pol.open_from || '18:00').slice(0, 5),
                   open_to:   String(pol.open_to   || '23:00').slice(0, 5) };
        openDays = Array.isArray(pol.open_weekdays) ? pol.open_weekdays : openDays;
      }

      draw();
    });
  }

  function addAvail(form) {
    var d = form.querySelector('[name=d]').value;
    var s = form.querySelector('[name=s]').value;
    var e = form.querySelector('[name=e]').value;
    if (!s || !e || e <= s) { A.toast('وقت النهاية يجب أن يكون بعد البداية', 'bad'); return; }
    db.from('coach_availability').insert({
      coach_id: form.getAttribute('data-coach'),
      weekday: parseInt(d, 10), start_time: s, end_time: e, active: true
    }).then(function (r) {
      if (r.error) { A.toast(r.error.message, 'bad'); return; }
      A.toast('أُضيف وقت التوفّر', 'ok');
      load();
    });
  }

  /* ---------- نموذج الكوتش ---------- */
  function shell() {
    if (sheet) return sheet;
    sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.id = 'co-sheet';
    sheet.innerHTML = '<div class="sheet-in" role="dialog" aria-modal="true">' +
      '<div class="sheet-h"><h2 id="co-title">كوتش</h2>' +
      '<button class="bt bt-ghost bt-sm" type="button" id="co-x">إغلاق</button></div>' +
      '<div class="grid2">' +
        '<div class="fld"><label for="co-name">الاسم <span class="req">*</span></label>' +
          '<input id="co-name" type="text" maxlength="80"></div>' +
        '<div class="fld"><label for="co-job">الصفة</label>' +
          '<input id="co-job" type="text" maxlength="80" placeholder="محلل فني"></div>' +
        '<div class="fld"><label for="co-min">مدة الجلسة بالدقائق</label>' +
          '<input id="co-min" type="number" min="15" max="180" step="15" value="60"></div>' +
        '<div class="fld"><label for="co-tg">تيليجرام</label>' +
          '<input id="co-tg" type="text" dir="ltr" maxlength="60" placeholder="@username"></div>' +
      '</div>' +
      '<div class="fld"><label for="co-bio">نبذة</label>' +
        '<textarea id="co-bio" maxlength="300"></textarea></div>' +
      '<div class="fld"><label for="co-photo">الصورة</label>' +
        '<div class="co-ph"><span class="co-ph-v" id="co-ph-v"></span>' +
          '<div class="co-ph-a">' +
            '<input id="co-photo" type="file" accept="image/jpeg,image/png,image/webp">' +
            '<button class="bt bt-ghost bt-sm" type="button" id="co-ph-x" hidden>' +
              'احذفي الصورة</button>' +
          '</div></div>' +
        '<p class="hint">JPG أو PNG أو WebP، حتى ٣ ميجابايت. ' +
          'تظهر للمشتركات في بطاقة الكوتش.</p></div>' +
      '<div class="grid2">' +
        '<div class="fld"><label for="co-sort">الترتيب</label>' +
          '<input id="co-sort" type="number" value="0"></div>' +
        '<div class="fld" style="justify-content:flex-end">' +
          '<label class="chk" for="co-act"><input type="checkbox" id="co-act" checked>' +
          '<span>مفعّل ويظهر للمشتركات</span></label></div>' +
      '</div>' +
      '<p class="bad-msg" id="co-err" style="display:none"></p>' +
      '<div class="sheet-f">' +
        '<button class="bt bt-main" type="button" id="co-save">حفظ</button>' +
        '<button class="bt bt-ghost" type="button" id="co-cancel">إلغاء</button>' +
      '</div></div>';
    document.body.appendChild(sheet);
    sheet.addEventListener('click', function (e) { if (e.target === sheet) close(); });
    el('co-x').addEventListener('click', close);
    el('co-cancel').addEventListener('click', close);
    el('co-save').addEventListener('click', save);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sheet.classList.contains('on')) close();
    });
    return sheet;
  }

  function close() { if (sheet) sheet.classList.remove('on'); editing = null; }

  function open(c) {
    shell().classList.add('on');
    editing = c || null;
    el('co-title').textContent = c ? 'تعديل: ' + c.name : 'إضافة كوتش';
    el('co-err').style.display = 'none';
    el('co-name').value = c ? c.name : '';
    el('co-job').value = c ? (c.title || '') : '';
    el('co-min').value = c ? c.slot_min : 60;
    el('co-tg').value = c ? (c.telegram || '') : '';
    el('co-bio').value = c ? (c.bio || '') : '';
    el('co-sort').value = c ? (c.sort_order || 0) : rows.length + 1;
    el('co-act').checked = c ? !!c.active : true;

    photoPath = c ? (c.photo_path || null) : null;
    dropPhoto = false;
    el('co-photo').value = '';
    paintPhoto();
    el('co-ph-x').onclick = function () {
      photoPath = null; dropPhoto = true; el('co-photo').value = ''; paintPhoto();
    };
    el('co-photo').onchange = paintPhoto;

    el('co-name').focus();
  }

  /* معاينة الصورة: ما تراه الإدارة هنا هو ما تراه المشتركة هناك،
     والحرف الأول بديلٌ ظاهر حين لا صورة — لا مربّع فارغ. */
  function photoUrl(path) {
    if (!path) return '';
    try {
      var r = db.storage.from('coach-photos').getPublicUrl(path);
      return (r && r.data && r.data.publicUrl) || '';
    } catch (e) { return ''; }
  }

  function paintPhoto() {
    var f = el('co-photo').files && el('co-photo').files[0];
    var box = el('co-ph-v');
    var url = f ? URL.createObjectURL(f) : photoUrl(photoPath);
    box.innerHTML = url
      ? '<img src="' + esc(url) + '" alt="">'
      : esc(((el('co-name').value || '؟').trim().charAt(0)) || '؟');
    el('co-ph-x').hidden = !(photoPath || f);
  }

  function save() {
    if (busy) return;
    var name = (el('co-name').value || '').trim();
    if (!name) {
      el('co-err').textContent = 'الاسم مطلوب';
      el('co-err').style.display = 'block';
      return;
    }
    busy = true;
    var b = el('co-save'); b.disabled = true; b.textContent = 'جارٍ الحفظ…';

    uploadPhoto(b).then(function (path) {
      savePayload(name, path, b);
    }, function (err) {
      busy = false; b.disabled = false; b.textContent = 'حفظ';
      el('co-err').textContent = (err && err.message) || 'تعذّر رفع الصورة';
      el('co-err').style.display = 'block';
    });
  }

  /* الملف يُرفع قبل الصفّ: لو فشل الرفع لم يُكتب مسارٌ لا ملف له.
     والاسم عشوائي لا باسم الملف — اسمٌ عربي أو مكرّر يكسر المسار. */
  function uploadPhoto(b) {
    var f = el('co-photo').files && el('co-photo').files[0];
    if (!f) return Promise.resolve(dropPhoto ? null : photoPath);

    if (f.size > 3 * 1024 * 1024) {
      return Promise.reject(new Error('الصورة أكبر من ٣ ميجابايت. اختاري صورة أصغر.'));
    }
    b.textContent = 'جارٍ رفع الصورة…';

    var ext = (f.name.match(/\.(jpe?g|png|webp)$/i) || ['.jpg'])[0].toLowerCase();
    var key = 'c-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext;

    return db.storage.from('coach-photos')
      .upload(key, f, { contentType: f.type, upsert: false })
      .then(function (r) {
        if (r.error) throw new Error(upWhy(r.error));
        return key;
      });
  }

  function upWhy(e) {
    var m = String((e && e.message) || '');
    if (/exceeded the maximum|too large|413/i.test(m)) {
      return 'الصورة أكبر من الحدّ المسموح في التخزين (٣ ميجابايت).';
    }
    if (/not found|bucket/i.test(m)) {
      return 'دلو coach-photos غير موجود. شغّلي الهجرة ٤٥ أولاً.';
    }
    if (/mime|content type/i.test(m)) {
      return 'نوع الملف غير مقبول. استعملي JPG أو PNG أو WebP.';
    }
    if (/policy|permission|403/i.test(m)) {
      return 'الرفع مرفوض: هذا الحساب ليس أدمن في القاعدة.';
    }
    return m || 'تعذّر رفع الصورة';
  }

  function savePayload(name, path, b) {
    var payload = {
      photo_path: path,
      name: name,
      title: el('co-job').value.trim(),
      bio: el('co-bio').value.trim(),
      telegram: el('co-tg').value.trim().replace(/^@/, '') || null,
      slot_min: parseInt(el('co-min').value, 10) || 60,
      sort_order: parseInt(el('co-sort').value, 10) || 0,
      active: el('co-act').checked,
      updated_at: new Date().toISOString()
    };
    var q = editing
      ? db.from('coaches').update(payload).eq('id', editing.id)
      : db.from('coaches').insert(payload);

    q.then(function (r) {
      busy = false; b.disabled = false; b.textContent = 'حفظ';
      if (r.error) {
        el('co-err').textContent = r.error.message;
        el('co-err').style.display = 'block';
        return;
      }
      A.toast(editing ? 'حُفظ الكوتش' : 'أُضيف الكوتش', 'ok');
      close(); load();
    });
  }

  el('co-add').addEventListener('click', function () { open(null); });
  el('co-list').addEventListener('click', function (e) {
    var ed = e.target.closest('[data-co]');
    if (ed) { open(rows.filter(function (x) { return x.id === ed.getAttribute('data-co'); })[0]); return; }

    var dl = e.target.closest('[data-co-del]');
    if (dl) {
      var c = rows.filter(function (x) { return x.id === dl.getAttribute('data-co-del'); })[0];
      if (!c) return;
      if (!window.confirm('حذف «' + c.name + '»؟ ستُحذف أوقات توفّره، ' +
                          'وتبقى الجلسات المحجوزة بلا كوتش.')) return;
      db.from('coaches').delete().eq('id', c.id).then(function (r) {
        if (r.error) { A.toast(r.error.message, 'bad'); return; }
        A.toast('حُذف الكوتش', 'ok'); load();
      });
      return;
    }

    var av = e.target.closest('[data-av-del]');
    if (av) {
      db.from('coach_availability').delete().eq('id', av.getAttribute('data-av-del'))
        .then(function (r) {
          if (r.error) { A.toast(r.error.message, 'bad'); return; }
          load();
        });
    }
  });

  A.guard().then(function (s) { if (s) load(); });
})();
