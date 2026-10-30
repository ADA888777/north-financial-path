/* صفحة الإشعارات. القراءة تُسجَّل في القاعدة، والعمود read_at وحده
   مسموح للمتعلم بتعديله. */
(function () {
  'use strict';
  var L = window.northLearn, db = L.db, el = L.el, esc = L.esc, num = L.num;

  var ICO = {
    booking_created: 'event_available', booking_changed: 'edit_calendar',
    booking_cancelled: 'event_busy', subscription_expiring: 'hourglass_bottom',
    subscription_expired: 'lock_clock', general: 'campaign'
  };

  function when(iso) {
    try {
      return new Intl.DateTimeFormat('ar-SA-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' })
        .format(new Date(iso));
    } catch (e) { return String(iso).slice(0, 16); }
  }

  function render(rows) {
    var unread = rows.filter(function (n) { return !n.read_at; }).length;
    el('n-sub').textContent = rows.length
      ? (unread ? num(unread) + ' غير مقروء من ' + num(rows.length) : 'كلها مقروءة')
      : '';
    el('read-all').hidden = unread === 0;

    if (!rows.length) {
      el('notes').innerHTML = '<section class="lbox"><p class="empty">لا توجد إشعارات بعد</p></section>';
      return;
    }

    el('notes').innerHTML = '<section class="lbox"><div class="nlist">' + rows.map(function (n) {
      var body =
        '<span class="ms n-i">' + (ICO[n.kind] || 'notifications') + '</span>' +
        '<div><b>' + esc(n.title) + '</b>' +
        (n.body ? '<p>' + esc(n.body) + '</p>' : '') +
        '<span class="when">' + esc(when(n.created_at)) + '</span></div>' +
        (n.read_at ? '' : '<i class="n-dot" aria-label="غير مقروء"></i>');
      return '<div class="nf-row' + (n.read_at ? '' : ' new') + '" data-id="' + esc(n.id) + '">' +
        (n.link ? '<a href="' + esc(n.link) + '">' + body + '</a>' : '<div>' + body + '</div>') +
        '</div>';
    }).join('') + '</div></section>';

    el('notes').querySelectorAll('.nf-row.new').forEach(function (row) {
      row.addEventListener('click', function () {
        db.rpc('mark_notifications_read', { p_ids: [row.getAttribute('data-id')] })
          .then(function () {
            row.classList.remove('new');
            var d = row.querySelector('.n-dot'); if (d) d.remove();
          }).catch(function () {});
      });
    });
  }

  function load() {
    return db.rpc('my_notifications', { p_limit: 60 }).then(function (r) {
      if (r.error) {
        el('notes').innerHTML = '<section class="lbox"><p class="empty">' +
          esc(r.error.message) + '</p></section>';
        return;
      }
      render(r.data || []);
    });
  }

  el('read-all').addEventListener('click', function () {
    el('read-all').disabled = true;
    db.rpc('mark_notifications_read').then(function () {
      el('read-all').disabled = false; load();
    }).catch(function () { el('read-all').disabled = false; });
  });

  L.guard().then(function (s) { if (s) return load(); })
   .catch(function (e) { L.deny('تعذّر تحميل الإشعارات', (e && e.message) || '', false); });
})();
