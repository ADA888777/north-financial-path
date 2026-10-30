-- ============================================================
-- ٣٨) رفع فيديو الدرس من الجهاز لا بلصق رابط
--
-- دلوٌ خاصّ لا علني. ملف الدرس المدفوع لا يُترك على عنوانٍ
-- يفتحه كلّ من وصل إليه: المسار يُقرأ بتوقيع مؤقّت، والتوقيع لا
-- يُمنح إلا لمن تفتح لها القاعدة ذلك الدرس — السياسة نفسها التي
-- تحكم نصّه ومفرداته.
--
-- التسمية: <lesson_id>/<اسم الملف>. المجلّد هو معرّف الدرس،
-- فتعرف السياسة أيّ درسٍ يملك الملف بلا جدول وسيط.
-- ============================================================

alter table public.lessons
  add column if not exists video_path text;

comment on column public.lessons.video_path is
  'مسار الملف في دلو lesson-videos. يُفضَّل على video_url عند وجودهما.';

-- ------------------------------------------------------------
-- الدلو: خاصّ، وبأنواع الفيديو وحدها
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lesson-videos', 'lesson-videos', false, 524288000,
        array['video/mp4','video/webm','video/ogg','video/quicktime'])
on conflict (id) do update
  set public = false,
      file_size_limit = 524288000,
      allowed_mime_types = array['video/mp4','video/webm','video/ogg','video/quicktime'];

-- ------------------------------------------------------------
-- من يقرأ الملف
--
-- المجلّد الأول من الاسم هو معرّف الدرس. يُفحص شكله قبل التحويل:
-- اسمٌ لا يصلح معرّفاً يرفع خطأً في الـcast، وخطأٌ داخل سياسة أمن
-- يعطّل القراءة كلها لا الصفّ وحده.
-- ------------------------------------------------------------
create or replace function public.lesson_video_readable(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare seg text;
begin
  seg := split_part(coalesce(p_name, ''), '/', 1);
  if seg !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then return false;
  end if;
  return public.lesson_unlocked(seg::uuid, auth.uid());
end;
$fn$;

revoke all on function public.lesson_video_readable(text) from public;
grant execute on function public.lesson_video_readable(text) to authenticated;

drop policy if exists "learner reads unlocked lesson video" on storage.objects;
create policy "learner reads unlocked lesson video" on storage.objects
  for select to authenticated
  using (bucket_id = 'lesson-videos'
         and (public.is_admin() or public.lesson_video_readable(name)));

drop policy if exists "admin uploads lesson video" on storage.objects;
create policy "admin uploads lesson video" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'lesson-videos' and public.is_admin());

drop policy if exists "admin updates lesson video" on storage.objects;
create policy "admin updates lesson video" on storage.objects
  for update to authenticated
  using (bucket_id = 'lesson-videos' and public.is_admin());

drop policy if exists "admin deletes lesson video" on storage.objects;
create policy "admin deletes lesson video" on storage.objects
  for delete to authenticated
  using (bucket_id = 'lesson-videos' and public.is_admin());

-- ------------------------------------------------------------
-- المسار يخرج مع الدرس، ولمن تملكه وحدها
-- ------------------------------------------------------------
create or replace function public.get_lesson(p_lesson uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  l   record;
  ok  boolean;
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;

  select * into l from public.lessons where id = p_lesson and published;
  if not found then return jsonb_build_object('error', 'الدرس غير موجود'); end if;

  ok := public.lesson_unlocked(p_lesson, uid);

  return jsonb_build_object(
    'id', l.id, 'title', l.title, 'kind', l.kind,
    'level_id', l.level_id, 'week_no', l.week_no,

    -- رأس الصفحة: اسم المستوى ورمزه، وترتيب الدرس فيه وعددها.
    -- يُحسب هنا لا في الواجهة: الترتيب نفسه الذي تمشي عليه الخارطة
    -- (الأسبوع ثم الترتيب ثم المعرّف)، فنسختان منه تفترقان.
    'level_title', (select lv.title from public.levels lv where lv.id = l.level_id),
    'level_code',  (select lv.code  from public.levels lv where lv.id = l.level_id),
    'lesson_no', (select count(*) from public.lessons ls
                  where ls.published
                    and ls.level_id is not distinct from l.level_id
                    and (ls.week_no, ls.sort_order, ls.id)
                        <= (l.week_no, l.sort_order, l.id)),
    'level_lessons', (select count(*) from public.lessons ls
                      where ls.published
                        and ls.level_id is not distinct from l.level_id),
    'duration_min', l.duration_min, 'free_preview', l.free_preview,
    'allowed', ok, 'unlocked', ok,
    'tier_ok', public.lesson_tier_ok(p_lesson, uid),
    'required_plan', public.lesson_required_plan(p_lesson),
    'locked_reason', public.lesson_lock_reason(p_lesson, uid),

    -- المحتوى لا يخرج من القاعدة أصلاً لمن لا يملكه
    'content',  case when ok then l.content  else null end,
    'summary',  case when ok then l.summary  else null end,
    'video_url',case when ok then l.video_url else null end,
    'video_path',case when ok then l.video_path else null end,
    'course_id',case when ok then l.course_id else null end,

    'completed', exists (select 1 from public.lesson_progress lp
                         where lp.lesson_id = l.id and lp.user_id = uid),
    -- خلل من الهجرة ٢٥: كانت تقرأ lesson_spots.seconds، وهو عمود
    -- لا وجود له — الجدول فيه pos. فكانت get_lesson ترفع خطأ عند
    -- كل فتح درس، وتموت الصفحة كلها. العمود الصحيح، والصفر بدل
    -- الفراغ كما في الهجرة ٢٢.
    'spot', coalesce((select s.pos from public.lesson_spots s
                      where s.lesson_id = l.id and s.user_id = uid), 0),
    'quiz_id', case when ok then (
      select q.id from public.quizzes q
      where q.lesson_id = l.id and q.published order by q.sort_order limit 1) end,
    'vocab', case when ok then coalesce((
      select jsonb_agg(jsonb_build_object('term', v.term, 'meaning', v.meaning)
                       order by v.sort_order, v.term)
      from public.vocab v where v.lesson_id = l.id), '[]'::jsonb) else '[]'::jsonb end,
    'prev_id', (select ls.id from public.lessons ls
                where ls.published and ls.level_id is not distinct from l.level_id
                  and (ls.week_no, ls.sort_order, ls.id) < (l.week_no, l.sort_order, l.id)
                order by ls.week_no desc, ls.sort_order desc, ls.id desc limit 1),
    'next_id', (select ls.id from public.lessons ls
                where ls.published and ls.level_id is not distinct from l.level_id
                  and (ls.week_no, ls.sort_order, ls.id) > (l.week_no, l.sort_order, l.id)
                order by ls.week_no, ls.sort_order, ls.id limit 1));
end;
$$;

revoke all on function public.get_lesson(uuid) from public;
grant execute on function public.get_lesson(uuid) to authenticated;

notify pgrst, 'reload schema';
