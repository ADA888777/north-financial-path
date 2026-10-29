/* مشترك بين صفحات المتعلم: الحارس والمظهر وأدوات العرض. */
(function () {
  'use strict';
  var db = window.northDB;

  function el(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* نص المحتوى يُعرض كفقرات، ولا يُحقن كـ HTML */
  function paras(text) {
    return String(text || '').split(/\n{2,}/)
      .filter(function (p) { return p.trim(); })
      .map(function (p) { return '<p>' + esc(p.trim()).replace(/\n/g, '<br>') + '</p>'; })
      .join('') || '<p style="color:var(--fg-2)">لا يوجد محتوى بعد.</p>';
  }

  function fmt(iso) {
    if (!iso) return '—';
    try { return new Intl.DateTimeFormat('ar-SA', { dateStyle: 'long' }).format(new Date(iso)); }
    catch (e) { return String(iso).slice(0, 10); }
  }

  function num(n) {
    try { return new Intl.NumberFormat('ar-SA').format(n); } catch (e) { return String(n); }
  }

  function qs(key) {
    try { return new URLSearchParams(window.location.search).get(key); } catch (e) { return null; }
  }

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

  /* ---------- الحارس ---------- */
  function deny(title, note, login) {
    var sh = el('shell'); if (sh) sh.hidden = true;
    var g = el('gate'); if (!g) return;
    g.hidden = false;
    var here = window.location.pathname.split('/').pop() || 'learn.html';
    g.innerHTML = '<div class="gate-card"><span class="ms gate-ico">lock</span>' +
      '<h1>' + esc(title) + '</h1><p>' + esc(note) + '</p>' +
      (login
        ? '<a class="btn btn-primary" href="login.html?next=' + encodeURIComponent(here) + '">تسجيل الدخول</a>'
        : '<a class="btn btn-ghost" href="index.html">العودة إلى الموقع</a>') + '</div>';
  }

  /* مهلة قصوى لأي طلب في بوابة الدخول.
     لو توقّف مشروع القاعدة، فطلب supabase-js قد لا يرجع أبداً: لا then
     ولا catch، فتبقى #shell مخفيّة و#gate مخفيّة والصفحة بيضاء بلا
     أي تفسير. نحسم الانتظار ونعرض سبباً مكتوباً. */
  function within(promise, ms, onLate) {
    var done = false;
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () {
        if (done) return;
        done = true;
        resolve(onLate());
      }, ms || 12000);
      promise.then(function (v) {
        if (done) return;
        done = true; clearTimeout(t); resolve(v);
      }, function (e) {
        if (done) return;
        done = true; clearTimeout(t); reject(e);
      });
    });
  }

  var LATE = {};   // علامة «لم يردّ الخادم»

  function guard() {
    if (!db) {
      deny('تعذّر الاتصال', 'حدّث الصفحة وحاول مرة أخرى.', false);
      return Promise.resolve(null);
    }
    return within(db.auth.getSession(), 12000, function () { return LATE; })
    .then(function (r) {
      if (r === LATE) {
        deny('خادم المنصة لا يستجيب',
             'لم يردّ الخادم خلال ١٢ ثانية. تحقّق من اتصالك وحدّث الصفحة، ' +
             'وإن تكرّر فأبلغ إدارة المنصة. [GATE-TIMEOUT]', false);
        return null;
      }
      var s = r && r.data && r.data.session;
      if (!s) { deny('تحتاج تسجيل الدخول', 'هذه الصفحة لحسابك الخاص.', true); return null; }
      /* جلسة صدرت قبل التعطيل تبقى صالحة حتى تنتهي. نسأل القاعدة عن
         حالة الحساب عند كل فتح صفحة، فلا يبقى معطَّل يتصفّح بجلسته. */
      /* تأخّر هذا السؤال لا يُخرج أحداً: الدوال نفسها ترفض المعطَّل،
         فالمحتوى محميّ في القاعدة على كل حال. */
      return within(db.rpc('account_state'), 10000, function () { return LATE; })
      .then(function (r) {
        if (r === LATE) {
          var shl = el('shell'); if (shl) shl.hidden = false;
          var gl = el('gate'); if (gl) gl.hidden = true;
          return s;
        }
        var st = (r && r.data) || {};
        if (st.signed_in && st.active === false) {
          deny('حسابك معطَّل', st.reason || 'تواصل مع إدارة المنصة.', false);
          db.auth.signOut().catch(function () {});
          return null;
        }
        var sh = el('shell'); if (sh) sh.hidden = false;
        var g = el('gate'); if (g) g.hidden = true;
        return s;
      }).catch(function () {
        /* تعذّر السؤال: لا نُخرج أحداً بسبب عطب شبكة عابر. الدوال
           نفسها ترفض المعطَّل، فالمحتوى محميّ على كل حال. */
        var sh = el('shell'); if (sh) sh.hidden = false;
        var g = el('gate'); if (g) g.hidden = true;
        return s;
      });
    }).catch(function (e) {
      deny('تعذّر التحقق', (e && e.message) || '', false);
      return null;
    });
  }

  function pct(done, total) {
    return total > 0 ? Math.round((done / total) * 100) : 0;
  }

  function bar(p) {
    return '<div class="bar"><i style="width:' + Math.max(0, Math.min(100, p)) + '%"></i></div>';
  }

  window.northLearn = {
    db: db, el: el, esc: esc, paras: paras, fmt: fmt, num: num,
    qs: qs, guard: guard, deny: deny, pct: pct, bar: bar
  };
})();
