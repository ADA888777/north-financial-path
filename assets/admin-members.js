/* تبويب الأعضاء: أرقام، إضافة عضو، قائمة وبحث.
   إنشاء الحساب يمر بدالة خادم لأن auth.admin يحتاج مفتاحاً سرياً
   لا يوضع في المتصفح إطلاقاً. */
(function () {
  'use strict';
  var A = window.northAdmin;
  if (!A) return;
  var db = A.db, el = A.el, esc = A.esc;

  var rows = [];
  var loaded = false;

  A.guard().then(function (session) {
    if (!session) return;
    probeFunction();
    load();
  });

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
      db.from('profiles').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      db.from('user_roles').select('*', { count: 'exact', head: true }).eq('role', 'admin'),
      db.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', cut)
    ]).then(function (res) {
      res.forEach(function (r, i) {
        if (r.error) fail(i);
        else set(i, new Intl.NumberFormat('ar-SA').format(r.count || 0));
      });
    }).catch(function () { [0, 1, 2, 3].forEach(fail); });
  }

  /* ---------- القائمة ---------- */
  function load() {
    var box = el('members-list');
    box.innerHTML = '<div class="state"><span class="ms">hourglass_top</span> جارٍ التحميل…</div>';
    kpis();

    Promise.all([
      db.from('profiles').select('*').order('created_at', { ascending: false }).limit(500),
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

  function draw() {
    var box = el('members-list');
    var q = (el('m-search').value || '').trim().toLowerCase();
    var view = !q ? rows : rows.filter(function (p) {
      return [p.full_name, p.email, p.membership_no, p.phone]
        .some(function (v) { return v && String(v).toLowerCase().indexOf(q) !== -1; });
    });

    if (!view.length) {
      box.innerHTML = '<div class="state"><span class="ms">group</span>' +
        (q ? 'لا نتائج للبحث.' : 'لا يوجد أعضاء بعد.') + '</div>';
      return;
    }

    box.innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
      '<th>الاسم</th><th>البريد</th><th>رقم العضوية</th><th>الجوال</th>' +
      '<th>الباقة</th><th>الحالة</th><th>الدور</th><th>انضم</th>' +
      '</tr></thead><tbody>' +
      view.map(function (p) {
        return '<tr>' +
          '<td>' + esc(p.full_name || '—') + '</td>' +
          '<td><span class="num muted">' + esc(p.email || '—') + '</span></td>' +
          '<td><span class="num">' + esc(p.membership_no || '—') + '</span></td>' +
          '<td><span class="num muted">' + esc(p.phone || '—') + '</span></td>' +
          '<td>' + esc(p.plan || '—') + '</td>' +
          '<td><span class="tag ' + (p.status === 'active' ? 'tag-ok">فعّال' : 'tag-off">موقوف') + '</span></td>' +
          '<td>' + (p._role === 'admin' ? '<span class="tag tag-admin">إدارة</span>' : '<span class="muted">عضو</span>') + '</td>' +
          '<td class="muted">' + esc(A.fmtDate(p.created_at)) + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>';
  }

  el('m-search').addEventListener('input', function () { if (loaded) draw(); });

  /* ---------- دالة الخادم ---------- */
  var fnReady = false;
  function probeFunction() {
    /* نكتفي بإظهار التنبيه حتى تثبت الدالة بأول استدعاء ناجح */
    el('fn-note').hidden = false;
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

    ['name', 'email', 'password', 'phone'].forEach(function (n) { bad(n, ''); });

    var name = el('m-name').value.trim();
    var email = el('m-email').value.trim();
    var pass = el('m-pass').value.trim();
    var problems = 0;

    if (!name) { bad('name', 'اسم العميل مطلوب.'); problems++; }
    if (!email) { bad('email', 'البريد الإلكتروني مطلوب لإنشاء الحساب.'); problems++; }
    else if (!EMAIL.test(email)) { bad('email', 'صيغة البريد غير صحيحة.'); problems++; }
    if (pass && pass.length < 8) { bad('password', 'كلمة المرور 8 خانات على الأقل، أو اتركها فارغة.'); problems++; }
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
      if (ok) { e.target.reset(); load(); }
    }

    db.functions.invoke('create-member', {
      body: {
        full_name: name,
        email: email,
        phone: el('m-phone').value.trim() || null,
        plan: el('m-plan').value,
        membership_no: el('m-no').value.trim() || null,
        password: pass || null
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
      done(true, 'أُضيف العضو' + (d.password ? ' — كلمة المرور: ' + d.password : '') + '.');
    }).catch(function (err) {
      done(false, 'تعذّرت الإضافة: ' + (err && err.message ? err.message : 'خطأ غير معروف'));
    });
  });

  window.addEventListener('north:tab', function (ev) {
    if (ev.detail === 'members' && loaded) kpis();
  });
})();
