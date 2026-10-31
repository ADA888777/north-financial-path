-- ============================================================
-- ٤٥) صورة الكوتش
--
-- active_coaches() ترجع photo_path، وصفحة الكلاسات تقرأ photo_url
-- — اسمان لشيء واحد، فلا صورة تظهر أبداً مهما رُفعت. ولم يكن ثمّة
-- ما يُرفع أصلاً: لا دلو للصور ولا حقل في لوحة الإدارة، فالعمود
-- فارغ في كل صفّ.
--
-- هنا: دلوٌ عام للصور (الكوتشات يراهنّ كل مشترك، فلا سرّ)، ترفع
-- فيه الإدارةُ وحدها، والصفحة تقرأ photo_path نفسه الذي ترسله
-- القاعدة — لا اسماً ثانياً له.
--
-- الهجرة idempotent.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('coach-photos', 'coach-photos', true, 3145728,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = 3145728,
      allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "public reads coach photos" on storage.objects;
create policy "public reads coach photos" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'coach-photos');

drop policy if exists "admin writes coach photos" on storage.objects;
create policy "admin writes coach photos" on storage.objects
  for all to authenticated
  using (bucket_id = 'coach-photos' and public.is_admin())
  with check (bucket_id = 'coach-photos' and public.is_admin());

-- المسار يبقى كما هو في active_coaches()؛ الرابط العام تبنيه
-- الواجهة بـ storage.from('coach-photos').getPublicUrl(path) من
-- عنوان المشروع الذي تعرفه مكتبة supabase-js — فلا عنوان مكتوب
-- في القاعدة ولا في الصفحة.

notify pgrst, 'reload schema';
