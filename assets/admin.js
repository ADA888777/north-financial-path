/* نورث للمسار المالي — المشترك بين صفحات لوحة الإدارة.

   الحارس هنا لتحسين التجربة فقط. الحماية الفعلية في سياسات RLS داخل قاعدة
   البيانات: حتى لو فتح أحدهم هذه الصفحات أو نادى الـ API مباشرة بالمفتاح
   العلني، ترفض القاعدة أي قراءة أو كتابة ليست له. */
(function () {
  'use strict';

  var db = window.northDB;

  /* ---------- المظهر ---------- */
  var root = document.documentElement;
  var tb = document.getElementById('theme-toggle');
  var ti = document.getElementById('theme-ico');
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

  /* ---------- أدوات ---------- */
  function el(id) { return document.getElementById(id); }

  function toast(message, kind) {
    var box = el('toast');
    if (!box) return;
    box.className = 'toast ' + (kind || 'ok') + ' on';
    box.querySelector('.ms').textContent = kind === 'bad' ? 'error' : 'check_circle';
    box.querySelector('span:last-child').textContent = message;
    clearTimeout(box._t);
    box._t = setTimeout(function () { box.classList.remove('on'); }, 4200);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      return new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium' }).format(new Date(iso));
    } catch (e) { return String(iso).slice(0, 10); }
  }

  function imageUrl(path) {
    if (!path) return '';
    try { return db.storage.from('story-images').getPublicUrl(path).data.publicUrl; }
    catch (e) { return ''; }
  }

  /* ---------- الحارس ---------- */
  function guard() {
    var gate = el('gate');
    var shell = el('shell');

    function here() {
      var f = window.location.pathname.split('/').pop();
      return f || 'admin.html';
    }

    function deny(title, note, showLogin) {
      if (shell) shell.hidden = true;
      if (!gate) return;
      gate.hidden = false;
      gate.innerHTML =
        '<div class="gate-card">' +
          '<span class="ms gate-ico">lock</span>' +
          '<h1>' + esc(title) + '</h1>' +
          '<p>' + esc(note) + '</p>' +
          (showLogin
            ? '<a class="bt bt-main" href="login.html?next=' + encodeURIComponent(here()) + '">تسجيل الدخول</a>'
            : '<a class="bt bt-soft" href="index.html">العودة إلى الموقع</a>') +
        '</div>';
    }

    if (!db) {
      deny('تعذّر الاتصال', 'لم يُحمَّل عميل قاعدة البيانات. حدّث الصفحة وحاول مرة أخرى.', false);
      return Promise.resolve(null);
    }

    return db.auth.getSession().then(function (r) {
      var session = r && r.data && r.data.session;
      if (!session) {
        deny('تحتاج تسجيل الدخول', 'هذه الصفحة للإدارة فقط.', true);
        return null;
      }
      return db.rpc('is_admin').then(function (res) {
        if (res.error || res.data !== true) {
          deny('ليس لديك صلاحية', 'هذا الحساب ليس حساب إدارة. إذا كان هذا خطأ تواصل مع مسؤول المنصة.', false);
          return null;
        }
        if (shell) shell.hidden = false;
        if (gate) gate.hidden = true;
        wireTabs();
        var who = el('who');
        if (who) who.textContent = session.user.email;
        var out = el('logout');
        if (out) {
          out.addEventListener('click', function () {
            db.auth.signOut().then(function () { window.location.href = 'login.html'; });
          });
        }
        return session;
      });
    }).catch(function (e) {
      deny('تعذّر التحقق', 'حدث خطأ أثناء التحقق من الصلاحية: ' + (e && e.message ? e.message : ''), false);
      return null;
    });
  }


  /* ---------- التبويبات ---------- */
  function wireTabs() {
    var tabs = document.querySelectorAll('#tabs .tab');
    var panels = document.querySelectorAll('[data-panel]');
    if (!tabs.length) return;

    function show(name, push) {
      var found = false;
      panels.forEach(function (p) {
        var on = p.getAttribute('data-panel') === name;
        p.hidden = !on;
        if (on) found = true;
      });
      if (!found) return show('members', push);
      tabs.forEach(function (t) { t.classList.toggle('on', t.getAttribute('data-tab') === name); });
      if (push) {
        try { history.replaceState(null, '', '#' + name); } catch (e) {}
      }
      window.dispatchEvent(new CustomEvent('north:tab', { detail: name }));
    }

    tabs.forEach(function (t) {
      t.addEventListener('click', function () { show(t.getAttribute('data-tab'), true); });
    });

    var initial = (window.location.hash || '').replace('#', '');
    show(initial || 'members', false);
  }

  window.northAdmin = {
    db: db, guard: guard, toast: toast, esc: esc,
    fmtDate: fmtDate, imageUrl: imageUrl, el: el
  };
})();
