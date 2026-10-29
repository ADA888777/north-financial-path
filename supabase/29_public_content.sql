-- ============================================================
-- 29: أرقام الصفحة الرئيسية ومساراتها من المحتوى المنشور
--
--    الصفحة كانت تعلن «١٤ درساً · ٣ ساعات · ٤ اختبارات» لكل مسار،
--    أرقاماً مكتوبة في HTML. إعلانٌ عن محتوى لا يُعرف أنه موجود.
--    صارت تُحسب، ولا يُعرض رقمٌ لا يسنده صفٌّ في القاعدة.
--
--    الدالة علنية (anon) لأنها على صفحة الزوّار، ولا تخرج منها إلا
--    أعدادٌ وعناوين منشورة: لا أسماء أعضاء ولا محتوى درس.
-- ============================================================
create or replace function public.public_stats()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'tracks',  (select count(*) from public.tracks  where published),
    'levels',  (select count(*) from public.levels  where published),
    'lessons', (select count(*) from public.lessons where published),
    'quizzes', (select count(*) from public.quizzes where published),
    'strategies', (select count(*) from public.lessons
                   where published and kind = 'strategy'),
    'live_upcoming', (select count(*) from public.class_slots
                      where published and kind = 'live' and status = 'scheduled'
                        and starts_at > now()),

    -- المسارات بأعدادها الحقيقية. المدّة تُجمع من duration_min، فإن
    -- لم تُسجَّل لأي درس عادت null ولا تُعرض ساعاتٌ مخترعة.
    'track_rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'title', t.title,
        'description', t.description,
        'level_label', t.level_label,
        'lessons', c.lessons,
        'quizzes', c.quizzes,
        'minutes', c.minutes)
        order by t.sort_order, t.title)
      from public.tracks t
      cross join lateral (
        select
          count(l.*)::int as lessons,
          (select count(*)::int from public.quizzes q
           join public.levels lv2 on lv2.id = q.level_id
           where lv2.track_id = t.id and q.published)
          + (select count(*)::int from public.quizzes q
             join public.lessons l2 on l2.id = q.lesson_id
             join public.levels lv3 on lv3.id = l2.level_id
             where lv3.track_id = t.id and q.published) as quizzes,
          nullif(sum(coalesce(l.duration_min, 0))::int, 0) as minutes
        from public.lessons l
        join public.levels lv on lv.id = l.level_id
        where lv.track_id = t.id and lv.published and l.published
      ) c
      where t.published), '[]'::jsonb),

    -- احتياطي: منهجٌ بمسار واحد تُعرض مستوياته بدل مسارٍ وحيد
    'level_rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', lv.id,
        'title', lv.title,
        'description', coalesce(nullif(lv.subtitle, ''), lv.description),
        'level_label', lv.code,
        'lessons', c.lessons,
        'quizzes', c.quizzes,
        'minutes', c.minutes)
        order by lv.sort_order, lv.title)
      from public.levels lv
      cross join lateral (
        select
          count(l.*)::int as lessons,
          (select count(*)::int from public.quizzes q
           where q.published and (q.level_id = lv.id
             or q.lesson_id in (select id from public.lessons
                                where level_id = lv.id and published))) as quizzes,
          nullif(sum(coalesce(l.duration_min, 0))::int, 0) as minutes
        from public.lessons l
        where l.level_id = lv.id and l.published
      ) c
      where lv.published), '[]'::jsonb));
$$;

revoke all on function public.public_stats() from public;
grant execute on function public.public_stats() to anon, authenticated;

notify pgrst, 'reload schema';
