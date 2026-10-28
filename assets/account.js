/* صفحة حساب المشترك.
   يقرأ المشترك صفّه فقط: سياسة RLS على profiles تمنعه من رؤية غيره
   حتى لو نادى الـ API مباشرة. */
(function () {
  'use strict';
  var db = window.northDB;
  var el = function (id) { return document.getElementById(id); };

  /* ---------- المظهر ---------- */
  var root = document.documentElement;
  var tb = el('theme-toggle'), ti = el('theme-ico');
  function theme() {
    return root.getAttribute('data-theme') ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
  try { var sv = localStorage.getItem('north-theme'); if (sv) root.setAttribute('data-theme', sv); } catch (e) {}
  if (tb && ti) {
    ti.textContent = theme() === 'dark' ? 'light_mode' : 'dark_mode';
    tb.addEventListener('click', function () {
      var n = theme() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', n);
      try { localStorage.setItem('north-theme', n); } catch (e) {}
      ti.textContent = n === 'dark' ? 'light_mode' : 'dark_mode';
    });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmt(iso) {
    if (!iso) return '—';
    try { return new Intl.DateTimeFormat('ar-SA', { dateStyle: 'long' }).format(new Date(iso)); }
    catch (e) { return String(iso).slice(0, 10); }
  }
  function put(id, v) { var n = el(id); if (n) n.textContent = (v == null || v === '') ? '—' : v; }

  function deny(title, note, login) {
    el('shell').hidden = true;
    var g = el('gate');
    g.hidden = false;
    g.innerHTML = '<div class="gate-card"><span class="ms gate-ico">lock</span>' +
      '<h1>' + esc(title) + '</h1><p>' + esc(note) + '</p>' +
      (login ? '<a class="btn btn-primary" href="login.html?next=account.html">تسجيل الدخول</a>'
             : '<a class="btn btn-ghost" href="index.html">العودة إلى الموقع</a>') + '</div>';
  }

  if (!db) { deny('تعذّر الاتصال', 'حدّث الصفحة وحاول مرة أخرى.', false); return; }

  db.auth.getSession().then(function (r) {
    var session = r && r.data && r.data.session;
    if (!session) { deny('تحتاج تسجيل الدخول', 'هذه الصفحة لحسابك الخاص.', true); return; }
    return db.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
      .then(function (res) {
        if (res.error) { deny('تعذّر تحميل الحساب', res.error.message, false); return; }
        render(res.data || { id: session.user.id, email: session.user.email }, session);
      });
  }).catch(function (e) {
    deny('تعذّر التحقق', (e && e.message) || '', false);
  });

  function render(p, session) {
    el('shell').hidden = false;
    el('gate').hidden = true;
    el('acct').hidden = false;

    var name = p.full_name || session.user.email;
    var initial = (name || '؟').trim().charAt(0);

    put('hdr-name', p.full_name || 'حسابي');
    put('hdr-no', p.membership_no);
    put('ava', initial);
    put('menu-name', p.full_name || '—');
    put('menu-email', p.email || session.user.email);
    put('menu-no', p.membership_no);
    put('menu-user', p.username);
    put('menu-plan', p.plan);

    put('hero-name', 'أهلاً، ' + (p.full_name || ''));
    put('hero-sub', p.plan ? ('أنت مشترك في ' + p.plan + '.') : 'مرحباً بك في منصة نورث.');
    put('hero-no', p.membership_no);

    put('d-name', p.full_name);
    put('d-email', p.email || session.user.email);
    put('d-user', p.username);
    put('d-no', p.membership_no);
    put('d-phone', p.phone);
    var on = p.status === 'active';
    var pill = '<span class="st-pill ' + (on ? 'st-on">فعّال' : 'st-off">موقوف') + '</span>';
    el('d-status').innerHTML = pill;
    el('menu-status').innerHTML = pill;
    put('d-joined', fmt(p.created_at));
    put('d-plan', p.plan);
    put('d-expires', p.subscription_expires_at ? fmt(p.subscription_expires_at) : 'بلا تاريخ انتهاء');

    if (p.must_change_password) el('pw-note').hidden = false;

    /* ---------- حالة الاشتراك ---------- */
    var expired = p.subscription_expires_at && new Date(p.subscription_expires_at) <= new Date();
    var live = p.status === 'active' && p.subscription_status === 'active' && !expired;

    var box = el('sub-state');
    if (live) {
      box.className = 'sub-state ok';
      el('sub-ico').textContent = 'verified';
      put('sub-title', 'اشتراكك نافذ');
      put('sub-note', p.subscription_expires_at
        ? ('ينتهي في ' + fmt(p.subscription_expires_at) + '.')
        : 'بلا تاريخ انتهاء محدد.');
      put('menu-sub', 'نافذ');
    } else {
      box.className = 'sub-state off';
      el('sub-ico').textContent = 'lock';
      var why = p.status !== 'active' ? 'الحساب موقوف. تواصل مع الإدارة.'
              : expired ? 'انتهت مدة اشتراكك.'
              : p.subscription_status === 'cancelled' ? 'الاشتراك ملغى.'
              : 'لا يوجد اشتراك نافذ على حسابك.';
      put('sub-title', 'الاشتراك غير نافذ');
      put('sub-note', why);
      put('menu-sub', 'غير نافذ');
      if (p.status === 'active') el('renew').hidden = false;
    }

    /* ---------- المحتوى: البوابة من قاعدة البيانات لا من الواجهة ---------- */
    wireEdit(p);

    db.rpc('has_active_subscription').then(function (r) {
      var ok = !r.error && r.data === true;
      el('content-state').innerHTML = ok
        ? '<div class="locked"><span class="ms">school</span>' +
          'اشتراكك نافذ. المسارات والدروس تُضاف هنا في المرحلة القادمة.</div>'
        : '<div class="locked"><span class="ms">lock</span>' +
          'المحتوى المدفوع مقفل حتى يصبح اشتراكك نافذاً.<br>' +
          'إذا اشتركت عبر سلة ولم يُفعَّل حسابك، راسل الإدارة.</div>';
    });
  }

  /* ---------- تعديل الحقول المسموحة ---------- */
  function wireEdit(p) {
    var open = el('edit-open'), form = el('edit-form'), rows = el('view-rows');
    if (!open || !form) return;

    function fieldErr(id, msg) {
      var f = document.querySelector('[data-field="' + id + '"]');
      if (!f) return;
      f.classList.toggle('bad', !!msg);
      if (msg) f.querySelector('.err span:last-child').textContent = msg;
    }

    function show(editing) {
      form.hidden = !editing;
      open.hidden = editing;
      rows.style.opacity = editing ? '.45' : '';
      if (editing) {
        el('f-name').value = p.full_name || '';
        el('f-phone').value = p.phone || '';
        el('f-name').focus();
      }
      fieldErr('fname', ''); fieldErr('fphone', '');
    }

    open.addEventListener('click', function () { show(true); });
    el('edit-cancel').addEventListener('click', function () { show(false); });

    var busy = false;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy) return;

      var name = el('f-name').value.trim();
      var phone = el('f-phone').value.trim();
      fieldErr('fname', ''); fieldErr('fphone', '');

      if (!name) { fieldErr('fname', 'الاسم مطلوب.'); el('f-name').focus(); return; }
      if (name.length < 3) { fieldErr('fname', 'الاسم قصير جداً.'); el('f-name').focus(); return; }
      if (phone && !/^[0-9+\s-]{7,20}$/.test(phone)) {
        fieldErr('fphone', 'رقم جوال غير صالح.'); el('f-phone').focus(); return;
      }

      busy = true;
      var btn = form.querySelector('[type=submit]');
      var label = btn.querySelector('[data-label]');
      btn.setAttribute('aria-busy', 'true'); btn.disabled = true;
      label.textContent = 'جارٍ الحفظ';

      /* الأعمدة المسموحة فقط. أي حقل آخر ترفضه قاعدة البيانات. */
      db.from('profiles')
        .update({ full_name: name, phone: phone || null })
        .eq('id', p.id)
        .then(function (r) {
          busy = false;
          btn.removeAttribute('aria-busy'); btn.disabled = false;
          label.textContent = 'حفظ';

          if (r.error) { fieldErr('fname', 'تعذّر الحفظ: ' + r.error.message); return; }

          p.full_name = name; p.phone = phone || null;
          put('d-name', name); put('d-phone', phone);
          put('hdr-name', name); put('menu-name', name);
          put('hero-name', 'أهلاً، ' + name);
          put('ava', (name || '؟').trim().charAt(0));
          show(false);
        });
    });
  }

  /* ---------- القائمة الشخصية ---------- */
  var btn = el('acct-btn'), menu = el('acct-menu');
  function closeMenu() { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    var open = menu.hidden;
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  document.addEventListener('click', function (e) {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) closeMenu();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });

  el('logout').addEventListener('click', function () {
    /* global: يُبطل رموز الجلسة على الخادم لا في هذا المتصفح فقط */
    db.auth.signOut({ scope: 'global' })
      .catch(function () {})
      .then(function () {
        try { localStorage.removeItem('north-auth'); } catch (e) {}
        window.location.replace('index.html');
      });
  });
})();
