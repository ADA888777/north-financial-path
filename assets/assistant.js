/* واجهة المساعد. كل الأجوبة من دالة الخادم، ولا رد ثابت يُعرض كأنه ذكاء اصطناعي. */
(function () {
  'use strict';
  var L = window.northLearn;
  if (!L) return;
  var db = L.db, el = L.el, esc = L.esc;

  var busy = false;
  var log = el('log');

  L.guard().then(function (s) {
    if (!s) return;
    history();
    quota();
  });

  function bubble(role, text, opts) {
    opts = opts || {};
    var d = document.createElement('div');
    d.className = 'msg ' + (role === 'user' ? 'me' : (opts.error ? 'err' : 'bot')) +
      (opts.grounded === false && !opts.error ? ' ungrounded' : '');
    d.textContent = text;
    if (opts.sources && opts.sources.length) {
      var s = document.createElement('span');
      s.className = 'msg-src';
      s.innerHTML = 'من الدروس: ' + opts.sources.map(function (x) {
        return '<a href="lesson.html?id=' + esc(x.id) + '">' + esc(x.title) + '</a>';
      }).join(' · ');
      d.appendChild(s);
    }
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }

  function emptyState() {
    log.innerHTML = '<div class="chat-empty"><span class="ms">forum</span>' +
      'اسألني عن أي مفهوم ورد في دروسك.<br>مثال: ما الفرق بين أمر السوق والأمر المحدد؟</div>';
  }

  function history() {
    db.rpc('my_assistant_history', { p_limit: 40 }).then(function (r) {
      var rows = (!r.error && r.data) || [];
      if (!rows.length) { emptyState(); return; }
      log.innerHTML = '';
      rows.forEach(function (m) {
        bubble(m.role === 'user' ? 'user' : 'bot', m.content, {
          grounded: m.grounded, sources: m.sources || []
        });
      });
    });
  }

  function quota() {
    db.rpc('assistant_quota_left', { p_max: 40 }).then(function (r) {
      if (r.error || typeof r.data !== 'number') return;
      el('note').textContent = 'يتبقى لك ' +
        new Intl.NumberFormat('ar-SA').format(r.data) + ' سؤالاً اليوم.';
    });
  }

  el('chat-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;

    var input = el('q');
    var q = input.value.trim();
    if (!q) return;

    if (log.querySelector('.chat-empty')) log.innerHTML = '';

    bubble('user', q);
    input.value = '';

    busy = true;
    var btn = el('send');
    btn.setAttribute('aria-busy', 'true'); btn.disabled = true;

    var dots = document.createElement('div');
    dots.className = 'typing';
    dots.innerHTML = '<i></i><i></i><i></i>';
    log.appendChild(dots);
    log.scrollTop = log.scrollHeight;

    db.functions.invoke('assistant', { body: { question: q } }).then(function (r) {
      busy = false;
      btn.removeAttribute('aria-busy'); btn.disabled = false;
      dots.remove();

      var d = (r && r.data) || {};
      if (r.error || d.error) {
        var m = d.error || (r.error && r.error.message) || '';
        bubble('bot',
          /not found|404|Failed to send/i.test(m)
            ? 'المساعد غير مهيّأ بعد. لم تُنشر دالة الخادم.'
            : m || 'تعذّر الوصول إلى المساعد. حاول بعد قليل.',
          { error: true });
        return;
      }

      bubble('bot', d.answer, { grounded: d.grounded, sources: d.sources || [] });
      if (typeof d.quota_left === 'number') {
        el('note').textContent = 'يتبقى لك ' +
          new Intl.NumberFormat('ar-SA').format(d.quota_left) + ' سؤالاً اليوم.';
      }
    }).catch(function (err) {
      busy = false;
      btn.removeAttribute('aria-busy'); btn.disabled = false;
      dots.remove();
      bubble('bot', 'تعذّر الوصول إلى المساعد: ' + (err && err.message ? err.message : ''), { error: true });
    });
  });
})();
