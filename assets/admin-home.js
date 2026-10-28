/* لوحة الإدارة — الأرقام */
(function () {
  'use strict';
  var A = window.northAdmin;
  if (!A) return;

  A.guard().then(function (session) {
    if (!session) return;
    var db = A.db;
    var cells = document.querySelectorAll('#kpis .kpi');

    function put(i, value) {
      cells[i].querySelector('b').textContent = value;
    }
    function fail(i) {
      cells[i].classList.add('err');
      cells[i].querySelector('b').textContent = 'تعذّر القراءة';
    }

    /* head: true يجلب العدد فقط بلا صفوف */
    function count(table, build) {
      var q = db.from(table).select('*', { count: 'exact', head: true });
      return build ? build(q) : q;
    }

    Promise.all([
      count('profiles'),
      count('success_stories', function (q) { return q.eq('published', true); }),
      count('success_stories', function (q) { return q.eq('published', false); }),
      count('user_roles', function (q) { return q.eq('role', 'admin'); })
    ]).then(function (res) {
      res.forEach(function (r, i) {
        if (r.error) { fail(i); return; }
        put(i, new Intl.NumberFormat('ar-SA').format(r.count || 0));
      });
      var anyErr = res.filter(function (r) { return r.error; });
      if (anyErr.length) {
        A.toast('تعذّرت قراءة بعض الأرقام. تأكد أن سكربت قاعدة البيانات شُغِّل.', 'bad');
      }
    }).catch(function (e) {
      cells.forEach(function (_, i) { fail(i); });
      A.toast('خطأ في الاتصال: ' + (e && e.message ? e.message : ''), 'bad');
    });
  });
})();
