/* تبويب الأعضاء: أرقام، إضافة عضو، قائمة وبحث.
   إنشاء الحساب يمر بدالة خادم لأن auth.admin يحتاج مفتاحاً سرياً
   لا يوضع في المتصفح إطلاقاً. */
(function () {
  'use strict';
  var A = window.northAdmin;
  if (!A) return;
  var db = A.db, el = A.el, esc = A.esc, no = A.no, who = A.who;

  var rows = [];
  var loaded = false;

  A.guard().then(function (session) {
    if (!session) return;
    probeFunction();
    loadPlans();
    subDates();
    load();
  });

  /* ---------- الباقات في النموذج: من القاعدة ----------
     اسمٌ مكتوب في الصفحة يفترق عن جدول الباقات بعد أول تعديل،
     والدالة ترفض باقةً لا تعرفها. ومع كل باقة مدّتاها لحساب
     تاريخ الانتهاء في النموذج قبل الإرسال. */
  var PLANS = [];
  function loadPlans() {
    var sel = el('m-plan');
    db.rpc('admin_plans').then(function (r) {
      PLANS = (r && !r.error && Array.isArray(r.data)) ? r.data : [];
      var act = PLANS.filter(function (p) { return p.active !== false; });
      sel.innerHTML = act.length
        ? act.map(function (p) {
            return '<option value="' + esc(p.name) + '">' + esc(p.name) + '</option>';
          }).join('')
        : '<option value="">لا باقات — أضيفيها من تبويب الباقات</option>';
      previewExpiry();
    }).catch(function () {
      sel.innerHTML = '<option value="">تعذّر تحميل الباقات</option>';
    });
  }

  /* ---------- تواريخ الاشتراك في النموذج ----------
     البداية اليوم افتراضاً، والنهاية = البداية + الفترة الأولى من
     الباقة (شهران). الحساب هنا للعرض فقط؛ الخادم يحسبها بنفسه، ولا
     نرسل النهاية إلا إن عدّلتها الإدارة بيدها. */
  var expDirty = false;

  function isoDay(d) {
    var y = d.getFullYear(), m = ('0' + (d.getMonth() + 1)).slice(-2), day = ('0' + d.getDate()).slice(-2);
    return y + '-' + m + '-' + day;
  }

  function firstDays() {
    var name = el('m-plan').value;
    var p = PLANS.filter(function (x) { return x.name === name; })[0];
    return p && p.duration_days ? Number(p.duration_days) : 60;
  }

  function previewExpiry() {
    var st = el('m-start'), ex = el('m-exp');
    if (!st || !ex) return;
    if (el('m-sub').value !== 'active') {
      el('m-subwrap').hidden = true; return;
    }
    el('m-subwrap').hidden = false;
    if (!st.value) st.value = isoDay(new Date());
    if (expDirty) return;
    var d = new Date(st.value + 'T00:00:00');
    if (isNaN(d.getTime())) return;
    var days = firstDays();
    d.setDate(d.getDate() + days);
    ex.value = isoDay(d);
    el('m-exp-why').textContent = '(تلقائي: ' + days + ' يوماً)';
  }

  function subDates() {
    el('m-start').addEventListener('change', previewExpiry);
    el('m-plan').addEventListener('change', previewExpiry);
    el('m-sub').addEventListener('change', previewExpiry);
    el('m-exp').addEventListener('input', function () {
      expDirty = true;
      el('m-exp-why').textContent = '(معدَّل يدوياً)';
    });
    previewExpiry();
  }

  /* ---------- الأرقام ---------- */
  function kpis() {
    var cells = document.querySelectorAll('#member-kpis .kpi b');
    var cut = new Date(Date.now() - 30 * 864e5).toISOString();

    function set(i, v) { cells[i].textContent = v; }
    function fail(i) {
      cells[i].parentNode.classList.add('err');
      cells[i].textContent = 'تعذّر';
    }

    Promise.all([
      db.from('profiles').select('*', { count: 'exact', head: true }),
      db.from('profiles').select('*', { count: 'exact', head: true })
        .eq('status', 'active').eq('subscription_status', 'active'),
      db.from('user_roles').select('*', { count: 'exact', head: true }).eq('role', 'admin'),
      db.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', cut)
    ]).then(function (res) {
      res.forEach(function (r, i) {
        if (r.error) fail(i);
        else set(i, new Intl.NumberFormat('ar-SA-u-nu-latn').format(r.count || 0));
      });
    }).catch(function () { [0, 1, 2, 3].forEach(fail); });
  }

  /* ---------- القائمة ---------- */
  function load() {
    var box = el('members-list');
    box.innerHTML = '<div class="state"><span class="ms">hourglass_top</span> جارٍ التحميل…</div>';
    kpis();

    Promise.all([
      // تصحيح من مضى تاريخه قبل القراءة: العمود المخزّن قد يقول «نافذ»
      // وقد انتهى، فتعرض اللوحة حالة والبوابة تعامله بأخرى.
      db.rpc('sync_expired_subscriptions').then(function () {
        return db.from('profiles').select('*')
                 .order('created_at', { ascending: false }).limit(500);
      }),
      db.from('user_roles').select('user_id, role')
    ]).then(function (r) {
      if (r[0].error) {
        box.innerHTML = '<div class="state"><span class="ms">error</span>' +
          'تعذّر تحميل الأعضاء.<br>' + esc(r[0].error.message) +
          '<br><br>إذا كانت الأعمدة ناقصة شغّل <code>supabase/03_members.sql</code>.</div>';
        return;
      }
      var roleOf = {};
      (r[1].data || []).forEach(function (x) { roleOf[x.user_id] = x.role; });
      rows = (r[0].data || []).map(function (p) { p._role = roleOf[p.id] || 'user'; return p; });
      loaded = true;
      draw();
    });
  }

  function subTag(p) {
    if (p.status !== 'active') return '<span class="tag tag-off">موقوف</span>';
    var expired = p.subscription_expires_at && new Date(p.subscription_expires_at) <= new Date();
    if (p.subscription_status === 'active' && !expired) return '<span class="tag tag-ok">نافذ</span>';
    var label = expired ? 'منتهٍ'
      : p.subscription_status === 'cancelled' ? 'ملغى'
      : p.subscription_status === 'expired' ? 'منتهٍ' : 'غير مفعّل';
    return '<span class="tag tag-off">' + label + '</span>';
  }

  function draw() {
    var box = el('members-list');
    /* البحث يقبل «46» و«#46» سواء: الرقم يُعرض بالشباك فتُكتب كما
       تُرى. و# تُحذف من الطرفين كي لا يبحث عن حرفٍ لا يُخزَّن. */
    var q = (el('m-search').value || '').trim().toLowerCase().replace(/^[#＃]\s*/, '');
    var view = !q ? rows : rows.filter(function (p) {
      return [p.full_name, p.email, p.membership_no, no(p.membership_no), p.phone]
        .some(function (v) { return v && String(v).toLowerCase().indexOf(q) !== -1; });
    });

    if (!view.length) {
      box.innerHTML = '<div class="state"><span class="ms">group</span>' +
        (q ? 'لا نتائج للبحث.' : 'لا يوجد أعضاء بعد.') + '</div>';
      return;
    }

    box.innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
      /* «اسم المستخدم» رُفع: لا حقل يضبطه في الإضافة ولا في
         التعديل، فعمودٌ لا يُملأ أبداً عرضٌ لفراغ. */
      '<th>الاسم</th><th>البريد</th>' +
      '<th>الباقة</th><th>الاشتراك</th><th>ينتهي</th><th>الدور</th><th></th>' +
      '</tr></thead><tbody>' +
      view.map(function (p) {
        return '<tr>' +
          /* «Albtol #46» — الرقم بجانب الاسم لا في عمود منفصل:
             العميلة تنادي العضو بالاثنين معاً. */
          '<td>' + esc(p.full_name || '—') +
            ' <span class="mno">' + esc(no(p.membership_no)) + '</span></td>' +
          '<td><span class="num muted">' + esc(p.email || '—') + '</span></td>' +
          '<td>' + esc(p.plan || '—') + '</td>' +
          '<td>' + subTag(p) + '</td>' +
          '<td class="muted">' + (p.subscription_expires_at ? esc(A.fmtDate(p.subscription_expires_at)) : '—') + '</td>' +
          '<td>' + (p._role === 'admin' ? '<span class="tag tag-admin">إدارة</span>' : '<span class="muted">مشترك</span>') + '</td>' +
          '<td class="row-acts">' +
            '<button class="bt bt-ghost bt-sm" type="button" data-acc="' + esc(p.id) +
              '">بيانات الحساب</button>' +
            '<button class="bt bt-ghost bt-sm" type="button" data-sub="' + esc(p.id) +
              '">الاشتراك</button>' +
          '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>';
  }

  el('m-search').addEventListener('input', function () { if (loaded) draw(); });

  /* تعديل الباقة والتجديد. التفويض على الحاوية لأن الصفوف تُعاد بناؤها
     بعد كل حفظ، فمستمع على كل زر يضيع مع صفّه. */
  el('members-list').addEventListener('click', function (e) {
    function refresh() { loaded = false; load(); kpis(); }

    var a = e.target.closest('[data-acc]');
    if (a && window.northAccount) {
      window.northAccount.open(a.getAttribute('data-acc'), refresh);
      return;
    }
    var b = e.target.closest('[data-sub]');
    if (b && window.northSub) {
      window.northSub.open(b.getAttribute('data-sub'), refresh);
    }
  });

  /* ---------- دالة الخادم ---------- */
  var fnReady = false;

  /* نسأل الدالة بطلب فارغ: إن كانت منشورة ترد بخطأ تحقق (400) فنعرف
     أنها حيّة، وإن لم تكن منشورة يرد البوابة 404. الطلب الفارغ لا ينشئ
     شيئاً لأن الدالة ترفضه قبل أي كتابة. */
  function probeFunction() {
    var note = el('fn-note');
    db.functions.invoke('create-member', { body: {} })
      .then(function (r) {
        var ctx = r && r.error && r.error.context;
        var status = ctx && ctx.status;
        fnReady = !r.error || (status && status !== 404);
        note.hidden = !!fnReady;
      })
      .catch(function () { note.hidden = false; });
  }

  /* ---------- إضافة عضو ---------- */
  function bad(name, msg) {
    var f = document.querySelector('[data-fld="' + name + '"]');
    if (!f) return;
    f.classList.toggle('bad', !!msg);
    if (msg) f.querySelector('.bad-msg').textContent = msg;
  }

  var EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
  var busy = false;

  el('member-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;

    ['name', 'email', 'password', 'membership'].forEach(function (n) { bad(n, ''); });

    var name = el('m-name').value.trim();
    var email = el('m-email').value.trim();
    var pass = el('m-pass').value.trim();
    var problems = 0;

    if (!name) { bad('name', 'اسم العميل مطلوب.'); problems++; }
    if (!email) { bad('email', 'البريد الإلكتروني مطلوب لإنشاء الحساب.'); problems++; }
    else if (!EMAIL.test(email)) { bad('email', 'صيغة البريد غير صحيحة.'); problems++; }

    /* كلمة المرور تكتبها الإدارة ولا تتولّد: من يسلّمها للعميلة
       يجب أن يعرفها، والمولَّدة تُعرض مرّة ثم تضيع. */
    if (!pass) { bad('password', 'اكتبي كلمة المرور — تسلّمينها للعميلة.'); problems++; }
    else if (pass.length < 8) { bad('password', 'كلمة المرور 8 خانات على الأقل.'); problems++; }

    if (problems) return;

    busy = true;
    var btn = e.target.querySelector('[type=submit]');
    var label = btn.querySelector('[data-label]');
    var original = label.textContent;
    btn.setAttribute('aria-busy', 'true'); btn.disabled = true;
    label.textContent = 'جارٍ الإضافة';

    function done(ok, msg) {
      busy = false;
      btn.removeAttribute('aria-busy'); btn.disabled = false;
      label.textContent = original;
      A.toast(msg, ok ? 'ok' : 'bad');
      if (ok) { e.target.reset(); expDirty = false; loadPlans(); previewExpiry(); load(); }
    }

    var active = el('m-sub').value === 'active';
    db.functions.invoke('create-member', {
      body: {
        full_name: name,
        email: email,
        plan: el('m-plan').value || null,
        membership_no: el('m-no').value.trim() || null,
        subscription_status: el('m-sub').value,
        /* البداية تُرسل دائماً، والنهاية فقط إن عدّلتها الإدارة:
           وإلا حسبها الخادم من مدّة الباقة المعتمدة. */
        subscription_started_at: active && el('m-start').value
          ? el('m-start').value + 'T00:00:00+03:00' : null,
        subscription_expires_at: active && expDirty && el('m-exp').value
          ? el('m-exp').value + 'T23:59:59+03:00' : null,
        payment_ref: el('m-ref').value.trim() || null,
        status: el('m-status').value,
        password: pass,
        site_url: window.location.origin + window.location.pathname.replace(/[^/]*$/, '')
      }
    }).then(function (r) {
      if (r.error) {
        var m = (r.error && r.error.message) || '';
        if (/not found|404|Failed to send/i.test(m)) {
          done(false, 'دالة create-member غير منشورة بعد. أضف العضو من Supabase مؤقتاً.');
        } else {
          done(false, 'تعذّرت الإضافة: ' + m);
        }
        return;
      }
      var d = r.data || {};
      if (d.error) { done(false, 'تعذّرت الإضافة: ' + d.error); return; }
      fnReady = true;
      el('fn-note').hidden = true;
      showCreated(d);
      done(true, 'أُنشئ حساب المشترك.');
    }).catch(function (err) {
      done(false, 'تعذّرت الإضافة: ' + (err && err.message ? err.message : 'خطأ غير معروف'));
    });
  });

  /* ---------- بيانات الدخول بعد الإنشاء ---------- */
  function showCreated(d) {
    el('c-email').textContent = d.email || '';
    el('c-no').textContent = no(d.membership_no) || '—';
    el('c-pass').textContent = d.password || '—';
    /* الفترة التي ضبطتها القاعدة فعلاً — لا ما كتبناه في النموذج */
    var sb = d.subscription;
    el('c-sub-row').hidden = !sb;
    if (sb) {
      el('c-sub').textContent = (sb.first ? 'اشتراك أول' : 'تجديد') + ' · ' +
        sb.days + ' يوماً · ينتهي ' + String(sb.expires_at || '').slice(0, 10);
    }
    if (d.warning) A.toast(d.warning, 'bad');
    el('created').hidden = false;

    var linkBtn = el('c-link');
    linkBtn.hidden = !d.set_password_link;

    function copy(text, okMsg) {
      try {
        navigator.clipboard.writeText(text)
          .then(function () { A.toast(okMsg); })
          .catch(function () { A.toast('تعذّر النسخ. حدّد النص وانسخه يدوياً.', 'bad'); });
      } catch (e) { A.toast('تعذّر النسخ. حدّد النص وانسخه يدوياً.', 'bad'); }
    }

    el('c-copy').onclick = function () {
      copy('منصة نورث للمسار المالي\n' +
           'رابط الدخول: ' + window.location.origin + '/login.html\n' +
           'البريد: ' + (d.email || '') + '\n' +
           'رقم العضوية: ' + (no(d.membership_no) || '') + '\n' +
           'كلمة المرور: ' + (d.password || '') + '\n' +
           'غيّر كلمة المرور بعد أول دخول.',
           'نُسخت بيانات الدخول.');
    };
    linkBtn.onclick = function () { copy(d.set_password_link, 'نُسخ رابط تعيين كلمة المرور.'); };
  }

  window.addEventListener('north:tab', function (ev) {
    if (ev.detail === 'members' && loaded) kpis();
  });
})();
