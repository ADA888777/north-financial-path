/* واجهة المساعد. كل جواب يأتي من ask_assistant() في القاعدة، مبنيّ على نص الدرس
   نفسه ومعه اسم مصدره. وإن لم يوجد، يُعرض الامتناع كما هو ولا يُسمّى ذكاءً اصطناعياً. */
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

    db.rpc('ask_assistant', { p_question: q }).then(function (r) {
      busy = false;
      btn.removeAttribute('aria-busy'); btn.disabled = false;
      dots.remove();

      var d = (r && r.data) || {};
      if (r.error || d.error) {
        var m = d.error || (r.error && r.error.message) || '';
        bubble('bot',
          /function .* does not exist|schema cache/i.test(m)
            ? 'المساعد غير مهيّأ بعد. لم تُشغَّل هجرة قاعدة البيانات.'
            : m || 'تعذّر الوصول إلى المساعد. حاول بعد قليل.',
          { error: true });
        return;
      }

      bubble('bot', d.answer, { grounded: d.grounded, sources: d.sources || [] });
    }).catch(function (err) {
      busy = false;
      btn.removeAttribute('aria-busy'); btn.disabled = false;
      dots.remove();
      bubble('bot', 'تعذّر الوصول إلى المساعد: ' + (err && err.message ? err.message : ''), { error: true });
    });
  });
})();
