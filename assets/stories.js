/* قسم قصص النجاح في الصفحة العامة.
   سياسة RLS تمنع وصول المسودات أصلاً، فالمعروض هنا هو المنشور فقط. */
(function () {
  'use strict';
  var wrap = document.querySelector('#stories .stories');
  var note = document.querySelector('#stories .stories-empty');
  var pending = document.querySelector('#stories .pending');
  if (!wrap) return;

  var db = window.northDB;
  if (!db) return;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function url(path) {
    try { return db.storage.from('story-images').getPublicUrl(path).data.publicUrl; }
    catch (e) { return ''; }
  }

  db.from('success_stories')
    .select('title, body, trainee_name, show_name, image_path')
    .eq('published', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(12)
    .then(function (r) {
      /* عند أي خطأ نُبقي البطاقات النموذجية بدل كسر القسم */
      if (r.error) return;

      var rows = r.data || [];
      if (!rows.length) return;

      if (note) note.hidden = true;
      if (pending) pending.hidden = true;

      wrap.innerHTML = rows.map(function (s) {
        var img = s.image_path ? url(s.image_path) : '';
        var who = (s.show_name && s.trainee_name) ? esc(s.trainee_name) : '';
        return '<article class="story">' +
          '<div class="story-img">' +
            (img
              ? '<img src="' + esc(img) + '" alt="' + esc(s.title) + '" loading="lazy">'
              : '<span class="ms">image</span>') +
          '</div>' +
          '<div class="story-body">' +
            '<h3>' + esc(s.title) + '</h3>' +
            (s.body ? '<p>' + esc(s.body) + '</p>' : '') +
          '</div>' +
          (who ? '<div class="story-foot"><span class="story-who">' + who + '</span></div>' : '') +
        '</article>';
      }).join('');
    });
})();
