/* أدوات مشتركة لنماذج لوحة الإدارة: أخطاء الحقول، حالة الإرسال،
   تنسيق الأرقام والتواريخ. لا منطق عمل هنا. */
(function () {
  'use strict';
  var A = window.northAdmin;
  if (!A) return;

  var AR = new Intl.NumberFormat('ar-SA');

  function num(n) { return AR.format(Number(n || 0)); }

  function int(value, fallback) {
    var n = parseInt(String(value == null ? '' : value).replace(/[^\d-]/g, ''), 10);
    return isNaN(n) ? fallback : n;
  }

  function fieldErr(name, message) {
    var f = document.querySelector('[data-fld="' + name + '"]');
    if (!f) return;
    f.classList.toggle('bad', !!message);
    var box = f.querySelector('.bad-msg');
    if (box && message) box.textContent = message;
  }

  function clearErrs(form) {
    if (!form) return;
    form.querySelectorAll('[data-fld]').forEach(function (f) { f.classList.remove('bad'); });
  }

  /* يمنع النقر المتكرر ويظهر دوّارة الزر */
  function busy(form, on, label) {
    var btn = form.querySelector('[type=submit]');
    if (!btn) return null;
    var span = btn.querySelector('[data-label]');
    if (on) {
      btn.setAttribute('aria-busy', 'true');
      btn.disabled = true;
      if (span) { btn._old = span.textContent; span.textContent = 'جارٍ الحفظ'; }
    } else {
      btn.removeAttribute('aria-busy');
      btn.disabled = false;
      if (span) span.textContent = label || btn._old || span.textContent;
    }
    return btn;
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    try {
      return new Intl.DateTimeFormat('ar-SA', {
        dateStyle: 'medium', timeStyle: 'short'
      }).format(new Date(iso));
    } catch (e) { return String(iso).slice(0, 16).replace('T', ' '); }
  }

  /* <input type="datetime-local"> يعطي وقتاً محلياً بلا منطقة زمنية */
  function localToIso(value) {
    if (!value) return null;
    var d = new Date(value);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  function isoToLocal(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
           'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function loading(box, text) {
    box.innerHTML = '<div class="state"><span class="ms">hourglass_top</span> ' +
      (text || 'جارٍ التحميل…') + '</div>';
  }

  function failed(box, message, hint) {
    box.innerHTML = '<div class="state"><span class="ms">error</span>' +
      A.esc(message) + (hint ? '<br><br>' + hint : '') + '</div>';
  }

  function empty(box, icon, text) {
    box.innerHTML = '<div class="state"><span class="ms">' + icon + '</span>' + text + '</div>';
  }

  /* رسالة واحدة مفهومة بدل نص بوستجريس الخام حين يكون معروفاً */
  function why(error) {
    var m = (error && error.message) || '';
    if (/relation .* does not exist/i.test(m) || /schema cache/i.test(m)) {
      return 'الجداول غير موجودة بعد. شغّل supabase/05_content_and_classes.sql من SQL Editor.';
    }
    if (/row-level security/i.test(m)) return 'الصلاحية مرفوضة من قاعدة البيانات.';
    return m || 'خطأ غير معروف.';
  }

  A.form = {
    num: num, int: int, fieldErr: fieldErr, clearErrs: clearErrs, busy: busy,
    fmtDateTime: fmtDateTime, localToIso: localToIso, isoToLocal: isoToLocal,
    loading: loading, failed: failed, empty: empty, why: why
  };
})();
