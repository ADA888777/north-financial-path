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
    wireEdit();
    wireTelegram(p);

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

  /* ---------- الحساب للعرض فقط ----------
     لا تعديل من واجهة المشتركة: الحقول تُعدَّل من لوحة الإدارة.
     المنع الحقيقي في القاعدة — صلاحية UPDATE على profiles مسحوبة من
     دور authenticated، وحارس على الجدول يرفض تغيير حقول الهوية ولو
     جاء الطلب مباشرة إلى الـAPI. ما هنا عرضٌ صادق لذلك المنع. */
  function wireEdit() { /* لا أزرار تعديل لبيانات الحساب في الصفحة */ }

  /* ---------- معرّف تيليجرام ----------
     الاستثناء الوحيد من قاعدة «العرض فقط»: هذا معرّف تواصلها هي،
     لا بيانات حساب. الحفظ يمرّ بدالة set_my_telegram التي تتحقّق من
     الصيغة وتوحّدها — وحارس القاعدة يمنع ما عدا هذا العمود. */
  function wireTelegram(p) {
    var inp = el('tg-in'), btn = el('tg-save'), msg = el('tg-msg');
    if (!inp || !btn) return;

    inp.value = p.telegram ? '@' + String(p.telegram).replace(/^@+/, '') : '';

    function say(text, bad) {
      msg.hidden = false;
      msg.textContent = text;
      msg.classList.toggle('bad', !!bad);
      clearTimeout(msg._t);
      msg._t = setTimeout(function () { msg.hidden = true; }, 7000);
    }

    btn.addEventListener('click', function () {
      if (btn.disabled) return;
      btn.disabled = true;
      var was = btn.textContent;
      btn.textContent = 'جارٍ الحفظ…';

      db.rpc('set_my_telegram', { p_handle: inp.value })
        .then(function (r) {
          btn.disabled = false; btn.textContent = was;
          var d = (r && r.data) || {};
          if (r.error) { say('تعذّر الحفظ: ' + r.error.message, true); return; }
          if (d.error) { say(d.error, true); return; }
          p.telegram = d.telegram ? String(d.telegram).replace(/^@+/, '') : null;
          inp.value = d.telegram || '';
          say(d.message || 'حُفظ.');
        })
        .catch(function (e) {
          btn.disabled = false; btn.textContent = was;
          say((e && e.message) || 'تعذّر الحفظ', true);
        });
    });

    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); btn.click(); }
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
