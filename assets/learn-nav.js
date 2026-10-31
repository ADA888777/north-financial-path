/* ترويسة المتعلم وقائمته.

   كان لكل صفحة شريطان: ترويسة الموقع وتحتها تسعة تبويبات تمرّ
   أفقياً — وعلى الجوال يُقصّ آخرها عند الحافة فيبدو الشريط
   مبتوراً. صارت ترويسة واحدة: تحية باسم المشتركة ورقم عضويتها،
   وجرس، وزرّ قائمة تفتح الأقسام بصفوف كاملة.

   مكتوبة هنا مرة واحدة وتُحقن في كل صفحات المتعلم: تسعة روابط
   في ثلاث عشرة صفحة تُكتب يدوياً تفترق عند أول تعديل. */
(function () {
  'use strict';

  var ITEMS = [
    { href: 'learn.html',         ico: 'home',               label: 'الرئيسية' },
    { href: 'map.html',           ico: 'map',                label: 'الخارطة' },
    { href: 'challenge.html',     ico: 'bolt',               label: 'التحدي' },
    { href: 'assistant.html',     ico: 'auto_stories',       label: 'المعلم الذكي' },
    { href: 'live.html',          ico: 'live_tv',            label: 'الحصص المباشرة' },
    /* الماسة لا اليد المرفوعة: الميزة حصرية لباقة، ورمزها في
       القائمة هو نفسه الذي يتصدّر صفحتها. */
    { href: 'classes.html',       ico: 'diamond',            label: 'الكلاسات الخاصة' },
    { href: 'notifications.html', ico: 'notifications',      label: 'الإشعارات' },
    { href: 'stories.html',       ico: 'military_tech',      label: 'قصص النجاح' },
    { href: 'account.html',       ico: 'account_circle',     label: 'الملف الشخصي' }
  ];

  /* صفحات فرعية تنتمي إلى قسم: الدرس والمستوى والاختبار تحت الخارطة،
     والبطاقات تحت التحدي — كي لا تفتح القائمة بلا قسمٍ معلَّم. */
  var UNDER = {
    /* «الدروس» ليست في القائمة: تُفتح من زرّ «متابعة التعلم» في
       الخارطة وحده. فالرجوع من درسٍ إلى الخارطة لا إليها —
       لا يُعاد المستعمل إلى صفحة لا يجد لها باباً. */
    'lesson.html': 'map.html', 'level.html': 'map.html',
    'quiz.html': 'map.html',   'cards.html': 'challenge.html'
  };

  var db = window.northDB;
  var no = window.northNo || function (v) { return v ? String(v) : ''; };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var here = (window.location.pathname.split('/').pop() || 'learn.html').toLowerCase();
  var section = UNDER[here] || here;

  /* المظهر المحفوظ يُطبَّق قبل أي رسم: هذا الملف هو الوحيد الموجود
     في كل صفحات المتعلم، فمكان التطبيق هنا لا في سكربت كل صفحة. */
  try {
    var saved = localStorage.getItem('north-theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);
  } catch (e) {}

  var head = document.getElementById('lhead');
  var host = document.getElementById('lnav');
  if (!head || !host) return;

  /* ---------- الترويسة ---------- */
  head.innerHTML =
    '<div class="rail lhead-in">' +
      '<button class="lmenu-btn" id="lmenu-btn" type="button" ' +
        'aria-expanded="false" aria-controls="lnav">' +
        '<span class="ms">menu</span><span>القائمة</span>' +
      '</button>' +
      '<div class="lhead-id">' +
        '<span class="lhead-hi">مرحباً بك</span>' +
        '<b class="lhead-who" id="lhead-who">—</b>' +
      '</div>' +
      '<div class="nav-act"></div>' +   /* يركّب الجرس نفسه هنا */
    '</div>';

  /* ---------- اللوحة ---------- */
  var rows = ITEMS.map(function (it) {
    var on = it.href === section;
    return '<a class="lmenu-row' + (on ? ' on' : '') + '" href="' + it.href + '"' +
      (on ? ' aria-current="page"' : '') + '>' +
      '<span class="ms">' + it.ico + '</span><span>' + it.label + '</span>' +
      (it.href === 'notifications.html'
        ? '<i class="lmenu-dot" id="lmenu-unread" hidden></i>' : '') +
      '</a>';
  }).join('');

  host.className = 'lmenu';
  host.hidden = true;
  host.innerHTML =
    '<div class="lmenu-sheet" role="dialog" aria-modal="true" aria-label="أقسام حسابك">' +
      '<div class="lmenu-card">' +
        '<div class="lmenu-brand">' +
          '<img class="logo-light" src="assets/north-mark.png" alt="">' +
          '<img class="logo-dark" src="assets/north-mark-white.png" alt="">' +
          '<div><b>نورث للمسار المالي</b><span>أقسام حسابك</span></div>' +
        '</div>' +
        '<nav class="lmenu-rows" aria-label="أقسام المتعلم">' + rows + '</nav>' +
        '<button class="lmenu-row lmenu-out" type="button" id="lmenu-out">' +
          '<span class="ms">logout</span><span>تسجيل الخروج</span></button>' +
      '</div>' +
      '<div class="lmenu-theme" role="group" aria-label="المظهر">' +
        '<button type="button" data-th="light" aria-label="فاتح"><span class="ms">light_mode</span></button>' +
        '<button type="button" data-th="dark"  aria-label="داكن"><span class="ms">dark_mode</span></button>' +
        '<button type="button" data-th="auto"  aria-label="حسب الجهاز"><span class="ms">desktop_windows</span></button>' +
      '</div>' +
    '</div>';

  /* ارتفاع الترويسة يُقاس لا يُقدَّر: اللوحة تبدأ تحتها مهما طالت */
  function measure() {
    document.documentElement.style.setProperty(
      '--lhead-h', head.getBoundingClientRect().height + 'px');
  }
  measure();
  window.addEventListener('resize', measure);

  /* ---------- فتح وإغلاق ---------- */
  var btn = document.getElementById('lmenu-btn');
  var ico = btn.querySelector('.ms');

  function open(yes) {
    host.hidden = !yes;
    btn.setAttribute('aria-expanded', yes ? 'true' : 'false');
    ico.textContent = yes ? 'close' : 'menu';
    document.body.style.overflow = yes ? 'hidden' : '';
    if (yes) measure();
  }
  btn.addEventListener('click', function () { open(host.hidden); });
  host.addEventListener('click', function (e) {
    if (e.target === host) open(false);           // الضغط خارج اللوحة يغلقها
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !host.hidden) { open(false); btn.focus(); }
  });

  /* ---------- المظهر ----------
     «تلقائي» يُخزَّن بحذف المفتاح لا بكتابة كلمة: بقية الصفحات
     تقرأ القيمة وتضعها في data-theme كما هي، فكلمةٌ غريبة هناك
     تعني سمةً لا وجود لها. */
  var root = document.documentElement;
  function current() {
    try { return localStorage.getItem('north-theme') || 'auto'; } catch (e) { return 'auto'; }
  }
  function paint() {
    var c = current();
    host.querySelectorAll('[data-th]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-th') === c ? 'true' : 'false');
    });
  }
  host.querySelectorAll('[data-th]').forEach(function (b) {
    b.addEventListener('click', function () {
      var v = b.getAttribute('data-th');
      try {
        if (v === 'auto') { localStorage.removeItem('north-theme'); root.removeAttribute('data-theme'); }
        else { localStorage.setItem('north-theme', v); root.setAttribute('data-theme', v); }
      } catch (e) {}
      paint();
    });
  });
  paint();

  /* ---------- الخروج ---------- */
  document.getElementById('lmenu-out').addEventListener('click', function () {
    if (!db) { window.location.replace('index.html'); return; }
    /* global: يُبطل رموز الجلسة على الخادم لا في هذا المتصفح فقط */
    db.auth.signOut({ scope: 'global' })
      .catch(function () {})
      .then(function () {
        try { localStorage.removeItem('north-auth'); } catch (e) {}
        window.location.replace('index.html');
      });
  });

  /* ---------- الاسم والرقم ونقطة غير المقروء ---------- */
  if (!db) return;

  db.auth.getSession().then(function (r) {
    var s = r && r.data && r.data.session;
    if (!s) return;

    db.from('profiles').select('full_name, membership_no').eq('id', s.user.id)
      .maybeSingle().then(function (q) {
        var p = (q && q.data) || {};
        var name = p.full_name || s.user.email || '';
        var n = no(p.membership_no);
        document.getElementById('lhead-who').innerHTML =
          esc(name) + (n ? ' <span class="num">' + esc(n) + '</span>' : '');
      }).catch(function () {});

    /* النقطة من القاعدة لا من رقم ثابت */
    db.rpc('my_learn_extra').then(function (q) {
      var n = q && q.data && q.data.unread_count;
      var dot = document.getElementById('lmenu-unread');
      if (dot && n > 0) { dot.hidden = false; dot.title = 'لديك ' + n + ' غير مقروء'; }
    }).catch(function () {});
  }).catch(function () {});
})();
