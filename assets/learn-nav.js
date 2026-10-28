/* شريط تنقّل المتعلم.
   مكتوب مرة واحدة ويُحقن في كل صفحات المتعلم: تسعة روابط في تسع صفحات
   تُكتب يدوياً تفترق عند أول تعديل، فيبقى رابط في صفحة ويختفي في أخرى. */
(function () {
  'use strict';

  var ITEMS = [
    { href: 'learn.html',         ico: 'home',              label: 'الرئيسية' },
    { href: 'map.html',           ico: 'map',               label: 'الخارطة' },
    { href: 'challenge.html',     ico: 'bolt',              label: 'التحدي' },
    { href: 'assistant.html',     ico: 'auto_stories',      label: 'المعلم الذكي' },
    { href: 'live.html',          ico: 'live_tv',           label: 'الحصص المباشرة' },
    { href: 'classes.html',       ico: 'person_raised_hand', label: 'الكلاسات الخاصة' },
    { href: 'notifications.html', ico: 'notifications',     label: 'الإشعارات' },
    { href: 'stories.html',       ico: 'military_tech',     label: 'قصص النجاح' },
    { href: 'account.html',       ico: 'account_circle',    label: 'الملف الشخصي' }
  ];

  var here = (window.location.pathname.split('/').pop() || 'learn.html').toLowerCase();

  function build() {
    var host = document.getElementById('lnav');
    if (!host) return;

    var html = '<div class="rail lnav-in"><div class="lnav-scroll" role="list">';
    for (var i = 0; i < ITEMS.length; i++) {
      var it = ITEMS[i];
      var on = it.href.toLowerCase() === here;
      html += '<a role="listitem" class="lnav-item' + (on ? ' on' : '') + '"' +
              (on ? ' aria-current="page"' : '') +
              ' href="' + it.href + '">' +
              '<span class="ms">' + it.ico + '</span>' +
              '<span class="lnav-t">' + it.label + '</span>' +
              (it.href === 'notifications.html'
                ? '<i class="lnav-dot" id="lnav-unread" hidden></i>' : '') +
              '</a>';
    }
    host.innerHTML = html + '</div></div>';

    // الرابط الحالي يُجلب إلى منتصف الشريط على الجوال، وإلا بقي خارج الرؤية
    var on = host.querySelector('.lnav-item.on');
    if (on && on.scrollIntoView) {
      try { on.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) {}
    }
  }

  /* نقطة غير المقروء تُملأ من القاعدة، لا من رقم ثابت. */
  function unread() {
    var db = window.northDB, dot = document.getElementById('lnav-unread');
    if (!db || !dot) return;
    db.rpc('my_learn_extra').then(function (r) {
      var n = r && r.data && r.data.unread_count;
      if (n > 0) { dot.hidden = false; dot.title = 'لديك ' + n + ' غير مقروء'; }
    }).catch(function () {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { build(); unread(); });
  } else { build(); unread(); }
})();
