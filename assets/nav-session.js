/* يُظهر رابط لوحة الإدارة في التنقل لمن يملك الصلاحية فقط.
   إخفاء الرابط ليس حماية: سياسات RLS هي ما يمنع غير الأدمن فعلياً. */
(function () {
  'use strict';
  var db = window.northDB;
  if (!db) return;

  db.auth.getSession().then(function (r) {
    var session = r && r.data && r.data.session;
    if (!session) return;
    return db.rpc('is_admin').then(function (res) {
      if (res.error || res.data !== true) return;

      var act = document.querySelector('.nav-act');
      if (!act || document.getElementById('admin-link')) return;

      var a = document.createElement('a');
      a.id = 'admin-link';
      a.className = 'btn btn-ghost btn-sm';
      a.href = 'admin.html';
      a.textContent = 'لوحة الإدارة';

      var login = act.querySelector('a[href="login.html"]');
      if (login) act.replaceChild(a, login);
      else act.insertBefore(a, act.firstChild);
    });
  }).catch(function () {});
})();
