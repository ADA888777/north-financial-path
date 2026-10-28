/* نورث للمسار المالي — منطق نماذج المصادقة.
   التحقق من المدخلات وحالات التحميل والأخطاء + الاتصال الفعلي بـ Supabase Auth.
   يعتمد على assets/supabase.js الذي ينشئ window.northDB. */
(function () {
  'use strict';

  /* ---------- المظهر الفاتح والداكن ---------- */
  var root = document.documentElement;
  var themeBtn = document.getElementById('theme-toggle');
  var themeIco = document.getElementById('theme-ico');

  function currentTheme() {
    var set = root.getAttribute('data-theme');
    if (set) return set;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  try {
    var saved = localStorage.getItem('north-theme');
    if (saved) root.setAttribute('data-theme', saved);
  } catch (e) {}
  if (themeBtn && themeIco) {
    themeIco.textContent = currentTheme() === 'dark' ? 'light_mode' : 'dark_mode';
    themeBtn.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('north-theme', next); } catch (e) {}
      themeIco.textContent = next === 'dark' ? 'light_mode' : 'dark_mode';
    });
  }

  /* ---------- إظهار وإخفاء كلمة المرور ---------- */
  document.querySelectorAll('[data-eye]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var input = document.getElementById(btn.getAttribute('data-eye'));
      if (!input) return;
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.querySelector('.ms').textContent = show ? 'visibility_off' : 'visibility';
      btn.setAttribute('aria-label', show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
      btn.setAttribute('aria-pressed', show ? 'true' : 'false');
      input.focus();
    });
  });

  /* ---------- أدوات التحقق ---------- */
  var EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

  function setError(id, message) {
    var field = document.querySelector('[data-field="' + id + '"]');
    var box = document.getElementById('err-' + id);
    if (!field) return;
    if (message) {
      field.classList.add('bad');
      if (box) box.querySelector('span:last-child').textContent = message;
      var input = field.querySelector('input');
      if (input) input.setAttribute('aria-invalid', 'true');
    } else {
      field.classList.remove('bad');
      var ok = field.querySelector('input');
      if (ok) ok.removeAttribute('aria-invalid');
    }
  }

  function clearAll(form) {
    form.querySelectorAll('[data-field]').forEach(function (f) {
      f.classList.remove('bad');
      var i = f.querySelector('input');
      if (i) i.removeAttribute('aria-invalid');
    });
    form.querySelectorAll('.banner').forEach(function (b) { b.classList.remove('on'); });
  }

  function showBanner(id, message) {
    var b = document.getElementById(id);
    if (!b) return;
    if (message) b.querySelector('span:last-child').textContent = message;
    b.classList.add('on');
  }

  function passwordScore(value) {
    var score = 0;
    if (value.length >= 8) score++;
    if (/[A-Za-z]/.test(value) && /[0-9]/.test(value)) score++;
    if (value.length >= 12 || /[^A-Za-z0-9]/.test(value)) score++;
    return score;
  }

  /* مقياس قوة كلمة المرور */
  var pw = document.getElementById('password');
  var meter = document.getElementById('meter');
  if (pw && meter) {
    pw.addEventListener('input', function () {
      meter.className = 'meter' + (pw.value ? ' s' + passwordScore(pw.value) : '');
    });
  }

  /* يختفي الخطأ بمجرد أن يصحح المستخدم الحقل */
  document.querySelectorAll('[data-field] input').forEach(function (input) {
    input.addEventListener('input', function () {
      var field = input.closest('[data-field]');
      if (field && field.classList.contains('bad')) {
        setError(field.getAttribute('data-field'), '');
      }
    });
  });

  /* ---------- الاتصال بـ Supabase ---------- */
  var db = window.northDB || null;
  /* مسار المجلد الذي تعيش فيه الصفحات، حتى تعمل الروابط محلياً وعلى الاستضافة */
  var SITE = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');

  /* ترجمة أخطاء Supabase إلى رسائل عربية يفهمها المستخدم */
  function authError(error) {
    var code = (error && error.code) || '';
    var text = ((error && error.message) || '').toLowerCase();

    if (code === 'invalid_credentials' || text.indexOf('invalid login credentials') !== -1) {
      return { ok: false, message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' };
    }
    if (code === 'email_not_confirmed' || text.indexOf('not confirmed') !== -1) {
      return { ok: false, message: 'لم يتم تأكيد بريدك بعد. افتح رابط التأكيد الذي وصلك على بريدك.' };
    }
    if (code === 'user_already_exists' || text.indexOf('already registered') !== -1) {
      return { ok: false, field: 'email', message: 'هذا البريد الإلكتروني مسجّل مسبقاً. سجّل الدخول بدلاً من ذلك.' };
    }
    if (code === 'weak_password' || text.indexOf('password should be') !== -1) {
      return { ok: false, field: 'password', message: 'كلمة المرور ضعيفة. استخدم 8 خانات على الأقل تجمع حروفاً وأرقاماً.' };
    }
    if (code === 'validation_failed' || text.indexOf('invalid email') !== -1) {
      return { ok: false, field: 'email', message: 'صيغة البريد الإلكتروني غير صحيحة.' };
    }
    if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' ||
        text.indexOf('rate limit') !== -1 || text.indexOf('too many') !== -1) {
      return { ok: false, message: 'عدد المحاولات كبير. انتظر دقيقة ثم أعد المحاولة.' };
    }
    if (code === 'signup_disabled' || text.indexOf('signups not allowed') !== -1) {
      return { ok: false, message: 'الحسابات تُنشأ من إدارة المنصة. تواصل معنا بعد إتمام اشتراكك.' };
    }
    return { ok: false, message: 'تعذّر إتمام الطلب الآن. تأكد من اتصالك بالإنترنت وحاول مرة أخرى.' };
  }

  /* الطلب الفعلي إلى Supabase Auth.
     يُرجع دائماً { ok } أو { ok:false, field?, message } كما تتوقع بقية الملف. */
  function submitToApi(payload) {
    if (!db) {
      return Promise.resolve({ ok: false, message: 'تعذّر الاتصال بالخادم. حدّث الصفحة وحاول مرة أخرى.' });
    }

    if (payload.kind === 'login') {
      return db.auth
        .signInWithPassword({ email: payload.email, password: payload.password })
        .then(function (res) { return res.error ? authError(res.error) : { ok: true }; })
        .catch(authError);
    }

    if (payload.kind === 'newpass') {
      return db.auth
        .updateUser({ password: payload.password })
        .then(function (res) { return res.error ? authError(res.error) : { ok: true }; })
        .catch(authError);
    }

    /* استعادة كلمة المرور: لا نكشف إن كان البريد مسجّلاً أم لا */
    return db.auth
      .resetPasswordForEmail(payload.email, { redirectTo: SITE + 'reset.html' })
      .then(function (res) {
        var err = res && res.error;
        if (err && (err.status === 429 || String(err.code || '').indexOf('rate_limit') !== -1)) {
          return authError(err);
        }
        return { ok: true };
      })
      .catch(function () { return { ok: true }; });
  }

  /* ---------- إرسال النموذج مع منع النقر المتكرر ---------- */
  function wireForm(formId, validate, buildPayload, onSuccess) {
    var form = document.getElementById(formId);
    if (!form) return;
    var button = form.querySelector('[type="submit"]');
    var label = button.querySelector('[data-label]');
    var busy = false;

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (busy) return;

      clearAll(form);
      var problems = validate();
      if (problems.length) {
        problems.forEach(function (p) { setError(p.field, p.message); });
        var first = form.querySelector('.bad input');
        if (first) first.focus();
        return;
      }

      busy = true;
      button.setAttribute('aria-busy', 'true');
      button.disabled = true;
      var original = label.textContent;
      label.textContent = 'جاري الإرسال';

      submitToApi(buildPayload()).then(function (result) {
        busy = false;
        button.removeAttribute('aria-busy');
        button.disabled = false;
        label.textContent = original;

        if (result.ok) { onSuccess(form); return; }
        if (result.field) setError(result.field, result.message);
        else showBanner(formId + '-banner', result.message);
      });
    });
  }

  /* ---------- تسجيل الدخول ---------- */
  wireForm('login-form', function () {
    var problems = [];
    var email = (document.getElementById('email').value || '').trim();
    var password = document.getElementById('password').value || '';
    if (!email) problems.push({ field: 'email', message: 'أدخل بريدك الإلكتروني.' });
    else if (!EMAIL.test(email)) problems.push({ field: 'email', message: 'صيغة البريد الإلكتروني غير صحيحة. مثال: name@example.com' });
    if (!password) problems.push({ field: 'password', message: 'أدخل كلمة المرور.' });
    return problems;
  }, function () {
    return {
      kind: 'login',
      email: document.getElementById('email').value.trim(),
      password: document.getElementById('password').value
    };
  }, function (form) {
    form.hidden = true;
    showBanner('login-done');
    var msg = document.querySelector('#login-done span:last-child');

    /* قائمة بيضاء: ?next= يأتي من العنوان فلا يُتبع إلا لصفحة معروفة داخل الموقع */
    var ALLOWED = ['admin.html', 'account.html', 'index.html'];
    var asked = null;
    try {
      var q = new URLSearchParams(window.location.search).get('next');
      if (q && ALLOWED.indexOf(q) !== -1) asked = q;
    } catch (e) {}

    function go(dest) {
      if (msg) {
        msg.textContent = dest.indexOf('admin') === 0
          ? 'تم تسجيل الدخول. ننقلك إلى لوحة الإدارة…'
          : 'تم تسجيل الدخول. ننقلك إلى حسابك…';
      }
      setTimeout(function () { window.location.href = dest; }, 1100);
    }

    if (asked) { go(asked); return; }

    /* الأدمن يذهب إلى لوحته، وغيره إلى الموقع */
    db.rpc('is_admin')
      .then(function (r) { go(!r.error && r.data === true ? 'admin.html' : 'account.html'); })
      .catch(function () { go('account.html'); });
  });

  /* ---------- استعادة كلمة المرور ---------- */
  wireForm('reset-form', function () {
    var problems = [];
    var email = (document.getElementById('email') || {}).value;
    email = (email || '').trim();
    if (!email) problems.push({ field: 'email', message: 'أدخل بريدك الإلكتروني.' });
    else if (!EMAIL.test(email)) problems.push({ field: 'email', message: 'صيغة البريد الإلكتروني غير صحيحة. مثال: name@example.com' });
    return problems;
  }, function () {
    return { kind: 'reset', email: document.getElementById('email').value.trim() };
  }, function (form) {
    form.hidden = true;
    showBanner('reset-done');
  });

  /* ---------- تعيين كلمة مرور جديدة بعد فتح رابط الاستعادة ---------- */
  var newForm = document.getElementById('newpass-form');
  if (db && newForm) {
    var resetForm = document.getElementById('reset-form');
    var opened = false;

    function openNewPassword() {
      if (opened) return;
      opened = true;
      if (resetForm) resetForm.hidden = true;
      var intro = document.getElementById('reset-intro');
      if (intro) intro.textContent = 'اختر كلمة مرور جديدة لحسابك.';
      newForm.hidden = false;
      var field = document.getElementById('password');
      if (field) field.focus();
    }

    var entry = window.northEntryURL || { hash: window.location.hash || '', search: window.location.search || '' };

    /* رابط منتهٍ أو مستخدَم مسبقاً */
    if (entry.hash.indexOf('error') !== -1 || entry.search.indexOf('error') !== -1) {
      showBanner('reset-link-bad');
      history.replaceState(null, '', window.location.pathname);
    }

    db.auth.onAuthStateChange(function (event) {
      if (event === 'PASSWORD_RECOVERY') openNewPassword();
    });

    /* احتياط: إذا اكتملت الجلسة قبل تسجيل المستمع أعلاه */
    var fromLink = entry.hash.indexOf('type=recovery') !== -1 ||
                   new URLSearchParams(entry.search).has('code');
    if (fromLink) {
      db.auth.getSession().then(function (res) {
        if (res && res.data && res.data.session) openNewPassword();
      });
    }

    wireForm('newpass-form', function () {
      var problems = [];
      var password = document.getElementById('password').value || '';
      var confirm = document.getElementById('confirm').value || '';

      if (!password) problems.push({ field: 'password', message: 'أدخل كلمة المرور الجديدة.' });
      else if (password.length < 8) problems.push({ field: 'password', message: 'كلمة المرور يجب أن تكون 8 خانات على الأقل.' });
      else if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) problems.push({ field: 'password', message: 'كلمة المرور يجب أن تجمع بين حروف وأرقام.' });

      if (!confirm) problems.push({ field: 'confirm', message: 'أعد كتابة كلمة المرور.' });
      else if (confirm !== password) problems.push({ field: 'confirm', message: 'كلمتا المرور غير متطابقتين.' });
      return problems;
    }, function () {
      return { kind: 'newpass', password: document.getElementById('password').value };
    }, function (form) {
      form.hidden = true;
      showBanner('newpass-done');
      setTimeout(function () { window.location.href = 'login.html'; }, 1800);
    });
  }
})();
