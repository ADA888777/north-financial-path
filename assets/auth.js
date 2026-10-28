/* نورث للمسار المالي — منطق نماذج المصادقة (واجهة فقط).
   المرحلة الأولى: تحقق من المدخلات وحالات التحميل والأخطاء.
   المرحلة الثانية: يُستبدل submitToApi بطلب فعلي إلى نظام المصادقة. */
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

  /* ---------- حساب تجريبي واحد لتجربة الواجهة قبل ربط الخادم ---------- */
  var DEMO_EMAIL = 'demo@north-sa.com';
  var DEMO_PASSWORD = 'North1234';

  function registeredEmails() {
    try { return JSON.parse(localStorage.getItem('north-demo-accounts') || '[]'); }
    catch (e) { return []; }
  }
  function rememberEmail(email) {
    try {
      var list = registeredEmails();
      if (list.indexOf(email) === -1) list.push(email);
      localStorage.setItem('north-demo-accounts', JSON.stringify(list));
    } catch (e) {}
  }

  /* نداء وهمي يحاكي زمن استجابة الخادم. يُستبدل في المرحلة الثانية. */
  function submitToApi(payload) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        if (payload.kind === 'reset') return resolve({ ok: true });
        if (payload.kind === 'login') {
          var known = payload.email === DEMO_EMAIL || registeredEmails().indexOf(payload.email) !== -1;
          if (!known) return resolve({ ok: false, message: 'لا يوجد حساب مسجّل بهذا البريد الإلكتروني.' });
          if (payload.email === DEMO_EMAIL && payload.password !== DEMO_PASSWORD) {
            return resolve({ ok: false, message: 'كلمة المرور غير صحيحة. تأكد منها وحاول مرة أخرى.' });
          }
          return resolve({ ok: true });
        }
        if (registeredEmails().indexOf(payload.email) !== -1 || payload.email === DEMO_EMAIL) {
          return resolve({ ok: false, field: 'email', message: 'هذا البريد الإلكتروني مسجّل مسبقاً. سجّل الدخول بدلاً من ذلك.' });
        }
        rememberEmail(payload.email);
        resolve({ ok: true });
      }, 900);
    });
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

  /* ---------- إنشاء حساب ---------- */
  wireForm('signup-form', function () {
    var problems = [];
    var name = (document.getElementById('name').value || '').trim();
    var email = (document.getElementById('email').value || '').trim();
    var password = document.getElementById('password').value || '';
    var confirm = document.getElementById('confirm').value || '';
    var terms = document.getElementById('terms').checked;

    if (!name) problems.push({ field: 'name', message: 'أدخل اسمك.' });
    else if (name.length < 3) problems.push({ field: 'name', message: 'الاسم قصير جداً. اكتب اسمك كاملاً.' });

    if (!email) problems.push({ field: 'email', message: 'أدخل بريدك الإلكتروني.' });
    else if (!EMAIL.test(email)) problems.push({ field: 'email', message: 'صيغة البريد الإلكتروني غير صحيحة. مثال: name@example.com' });

    if (!password) problems.push({ field: 'password', message: 'أدخل كلمة المرور.' });
    else if (password.length < 8) problems.push({ field: 'password', message: 'كلمة المرور يجب أن تكون 8 خانات على الأقل.' });
    else if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) problems.push({ field: 'password', message: 'كلمة المرور يجب أن تجمع بين حروف وأرقام.' });

    if (!confirm) problems.push({ field: 'confirm', message: 'أعد كتابة كلمة المرور.' });
    else if (confirm !== password) problems.push({ field: 'confirm', message: 'كلمتا المرور غير متطابقتين.' });

    if (!terms) problems.push({ field: 'terms', message: 'يلزم الموافقة على الشروط وسياسة الخصوصية للمتابعة.' });
    return problems;
  }, function () {
    return {
      kind: 'signup',
      name: document.getElementById('name').value.trim(),
      email: document.getElementById('email').value.trim(),
      password: document.getElementById('password').value
    };
  }, function (form) {
    document.getElementById('signup-email-out').textContent = document.getElementById('email').value.trim();
    form.hidden = true;
    showBanner('signup-done');
  });
})();
