/* قصص النجاح المنشورة. الاسم لا يظهر إلا إن أذِن صاحبه (show_name). */
(function () {
  'use strict';
  var L = window.northLearn, db = L.db, el = L.el, esc = L.esc;

  function img(path) {
    if (!path) return '';
    try {
      var u = db.storage.from('stories').getPublicUrl(path);
      var url = u && u.data && u.data.publicUrl;
      return url ? '<div class="st-img"><img src="' + esc(url) + '" alt="" loading="lazy"></div>' : '';
    } catch (e) { return ''; }
  }

  L.guard().then(function (s) {
    if (!s) return;
    return db.rpc('published_stories').then(function (r) {
      var rows = (r && r.data) || [];
      if (r.error) {
        el('stories').innerHTML = '<p class="empty">' + esc(r.error.message) + '</p>';
        return;
      }
      if (!rows.length) {
        el('stories').innerHTML = '<section class="lbox"><p class="empty">' +
          'لم تُنشر قصص بعد.</p></section>';
        return;
      }
      el('stories').innerHTML = '<div class="st-grid">' + rows.map(function (st) {
        return '<article class="st-card">' + img(st.image_path) +
          '<div class="st-b">' +
            (st.amount ? '<span class="st-amt" dir="ltr">' + esc(st.amount) + '</span>' : '') +
            '<h3>' + esc(st.title) + '</h3>' +
            (st.body ? '<p>' + esc(st.body) + '</p>' : '') +
            (st.name ? '<span class="st-n">' + esc(st.name) + '</span>' : '') +
          '</div></article>';
      }).join('') + '</div>';
    });
  }).catch(function (e) {
    L.deny('تعذّر تحميل القصص', (e && e.message) || '', false);
  });
})();
