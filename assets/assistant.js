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
    // الاسم للترحيب فقط؛ إن تعذّر فالترحيب بلا اسم
    db.rpc('my_dashboard').then(function (r) {
      var d = (r && r.data) || {};
      window.northLearnName = d.name || '';
    }).catch(function () {}).then(function () { history(); });
  });

  /* اقتراحات جاهزة: تملأ الحقل ثم تُرسل */
  var chips = el('as-chips');
  if (chips) {
    chips.addEventListener('click', function (e) {
      var b = e.target.closest('[data-q]');
      if (!b || busy) return;
      el('q').value = b.getAttribute('data-q');
      el('chat-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
  }

  function bubble(role, text, opts) {
    opts = opts || {};
    var me = role === 'user';

    var d = document.createElement('div');
    // التحية ليست جواباً فاشلاً: grounded = null، فلا تُوسَم بوسم الامتناع.
    d.className = 'msg ' + (me ? 'me' : (opts.error ? 'err' : 'bot')) +
      (opts.grounded === false && !opts.error ? ' ungrounded' : '') +
      (opts.kind === 'loose' ? ' loose' : '');

    if (!me) {
      var av = document.createElement('span');
      av.className = 'msg-av';
      av.innerHTML = '<span class="ms">smart_toy</span>';
      d.appendChild(av);
    }

    var tx = document.createElement('span');
    tx.className = 'msg-tx';
    tx.textContent = text;
    d.appendChild(tx);

    if (opts.kind === 'loose') {
      var w = document.createElement('span');
      w.className = 'msg-note';
      w.textContent = 'تطابق تقريبي — راجع الدرس للتأكد.';
      tx.appendChild(w);
    }
    if (opts.suggestions && opts.suggestions.length) {
      var g = document.createElement('span');
      g.className = 'msg-src';
      g.innerHTML = 'دروس قد تفيد: ' + opts.suggestions.map(function (x) {
        return '<a href="lesson.html?id=' + esc(x.id) + '">' + esc(x.title) + '</a>';
      }).join(' · ');
      tx.appendChild(g);
    }
    if (opts.sources && opts.sources.length) {
      var sc = document.createElement('span');
      sc.className = 'msg-src';
      sc.innerHTML = 'من الدروس: ' + opts.sources.map(function (x) {
        return '<a href="lesson.html?id=' + esc(x.id) + '">' + esc(x.title) + '</a>';
      }).join(' · ');
      tx.appendChild(sc);
    }

    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }

  function emptyState() {
    /* فقاعة ترحيب باسم المتعلمة، كما في المرجع. ليست جواباً ولا تُحسب
       محادثةً: تُستبدل بأول سؤال. */
    var name = (window.northLearnName || '').trim();
    log.innerHTML =
      '<div class="msg bot greet">' +
        '<span class="msg-av"><span class="ms">smart_toy</span></span>' +
        '<span class="msg-tx">أهلاً' + (name ? '، ' + esc(name) : '') +
          '، كيف أساعدك في المذاكرة اليوم؟</span>' +
      '</div>';
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

    if (log.querySelector('.greet')) log.innerHTML = '';

    bubble('user', q);
    input.value = '';

    busy = true;
    var btn = el('send');
    btn.setAttribute('aria-busy', 'true'); btn.disabled = true;
    if (el('as-chips')) el('as-chips').hidden = true;

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

      bubble('bot', d.answer, {
        grounded: d.grounded,
        kind: d.kind,
        sources: d.sources || [],
        suggestions: d.suggestions || []
      });
    }).catch(function (err) {
      busy = false;
      btn.removeAttribute('aria-busy'); btn.disabled = false;
      dots.remove();
      bubble('bot', 'تعذّر الوصول إلى المساعد: ' + (err && err.message ? err.message : ''), { error: true });
    });
  });
})();
