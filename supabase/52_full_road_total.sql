-- ============================================================
-- ٥٢) المقام هو الطريق كلّه، لا ما تفتحه الباقة
--
-- الهجرة ٤١ قصرت «تقدمك الكلي» على ما تفتحه الباقة، حتى تبلغ
-- البرونزية المئة. والنتيجة أنّ من أنهت البرونزية ترى طريقاً
-- منتهياً: «٢٩ من ٢٩ · ١٠٠٪». وهي لم تنتهِ — بقيت عشرة دروس
-- وراء الترقية، ولو رأتها في المقام لعرفت أنّ ثمّة ما يُطلب.
--
-- فالمقام اليوم كل درسٍ منشور، والبسط كل ما أنجزته. «٢٩ من ٣٩ ·
-- ٧٤٪» تقول الحقيقة كاملة: ما قطعَتْه وما بقي. والمقفل بالتسلسل
-- والمقفل بالباقة كلاهما «ينتظر»، أحدهما تقدّمها والآخر ترقيتها
-- — وبطاقة «محتوى إضافي في الباقة الأعلى» تفصل بينهما بالاسم.
--
-- «متاح الآن» لم يتغيّر: يبقى على ما تفتحه باقتها فعلاً، فلا
-- يَعِد بدرسٍ لا ينفتح عند الضغط.
--
-- الهجرة idempotent.
-- ============================================================

create or replace function public.my_map()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  uid uuid := auth.uid();
  cur uuid;
  nxt uuid;
  res jsonb;
  n_total integer; n_done integer; n_open integer; n_locked integer;
  s_total integer; s_open integer;
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;

  select lv.id into cur
  from public.levels lv
  where lv.published and public.level_unlocked(lv.id, uid)
    and not public.level_cleared(lv.id, uid)
  order by lv.sort_order, lv.title
  limit 1;

  select l.id into nxt
  from public.lessons l
  left join public.levels lv on lv.id = l.level_id
  where l.published
    and public.lesson_unlocked(l.id, uid)
    and not exists (select 1 from public.lesson_progress lp
                    where lp.lesson_id = l.id and lp.user_id = uid)
  order by coalesce(lv.sort_order, 9999), l.week_no, l.sort_order, l.title
  limit 1;

  -- الطريق كلّه في المقام، لا ما تفتحه باقتها وحده: من أنهت كل ما
  -- في البرونزية ترى «٢٩ من ٣٩» لا «٢٩ من ٢٩» — فتعرف أنّ بعدها
  -- طريقاً، وأنّ ما بقي يأتي بالترقية. مقامٌ يساوي البسط دائماً
  -- يقول لها «انتهيتِ» وهي لم تبلغ آخر المنصّة.
  -- و«متاح الآن» وحده يبقى على ما تفتحه فعلاً: وعدٌ بدرسٍ لا يُفتح
  -- خُلْفٌ، أمّا رقمٌ في المقام فدعوةٌ معلنة.
  select count(*),
         count(*) filter (where exists (select 1 from public.lesson_progress lp
                                        where lp.lesson_id = l.id and lp.user_id = uid)),
         count(*) filter (where public.lesson_unlocked(l.id, uid)
                            and not exists (select 1 from public.lesson_progress lp
                                            where lp.lesson_id = l.id and lp.user_id = uid)),
         count(*) filter (where not public.lesson_unlocked(l.id, uid)
                            and not exists (select 1 from public.lesson_progress lp
                                            where lp.lesson_id = l.id and lp.user_id = uid))
    into n_total, n_done, n_open, n_locked
  from public.lessons l where l.published;

  select count(*), count(*) filter (where public.lesson_tier_ok(l.id, uid))
    into s_total, s_open
  from public.lessons l where l.published and l.kind = 'strategy';

  select coalesce(jsonb_agg(t order by t_sort, t_title), '[]'::jsonb) into res
  from (
    select coalesce(tr.sort_order, 9999) as t_sort,
           coalesce(tr.title, 'بلا مسار') as t_title,
           jsonb_build_object(
             'track_id', tr.id,
             'track', coalesce(tr.title, 'بلا مسار'),
             'for_beginners', coalesce(tr.for_beginners, false),
             'levels', coalesce((
               select jsonb_agg(jsonb_build_object(
                 'id', lv.id, 'code', lv.code, 'title', lv.title,
                 'subtitle', lv.subtitle, 'description', lv.description,
                 'color', coalesce(lv.color, 'slate'),
                 'min_tier', lv.min_tier,
                 'tier_ok', public.level_tier_ok(lv.id, uid),
                 'required_plan', public.level_required_plan(lv.id),
                 'lock_reason', public.level_lock_reason(lv.id, uid),
                 'total', tot.n, 'done', dn.n,
                 'percent', case when tot.n > 0 then round(dn.n * 100.0 / tot.n)::int else 0 end,
                 'quiz_id', qz.id,
                 'quiz_passed', qz.id is not null and exists (
                   select 1 from public.quiz_attempts a
                   where a.quiz_id = qz.id and a.user_id = uid and a.passed),
                 'unlocked', public.level_unlocked(lv.id, uid),
                 'state', case
                   when not public.level_tier_ok(lv.id, uid) then 'tier_locked'
                   when not public.level_unlocked(lv.id, uid) then 'locked'
                   when public.level_cleared(lv.id, uid) then 'done'
                   when lv.id = cur then 'current'
                   else 'open' end,
                 'weeks', public.level_weeks(lv.id, uid)
               ) order by lv.sort_order, lv.title)
               from public.levels lv
               cross join lateral (select count(*)::int n from public.lessons l
                                   where l.level_id = lv.id and l.published) tot
               cross join lateral (select count(*)::int n from public.lessons l
                                   join public.lesson_progress lp
                                     on lp.lesson_id = l.id and lp.user_id = uid
                                   where l.level_id = lv.id and l.published) dn
               left join lateral (select q.id from public.quizzes q
                                  where q.level_id = lv.id and q.lesson_id is null and q.published
                                  order by q.sort_order limit 1) qz on true
               where lv.published and lv.track_id is not distinct from tr.id
             ), '[]'::jsonb)) as t
    from public.tracks tr
    where tr.published
    union all
    select 9999, 'دروس عامة',
      jsonb_build_object('track_id', null, 'track', 'دروس عامة', 'for_beginners', false,
        'levels', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', lv.id, 'code', lv.code, 'title', lv.title, 'subtitle', lv.subtitle,
            'description', lv.description, 'color', coalesce(lv.color, 'slate'),
            'min_tier', lv.min_tier,
            'tier_ok', public.level_tier_ok(lv.id, uid),
            'required_plan', public.level_required_plan(lv.id),
            'lock_reason', public.level_lock_reason(lv.id, uid),
            'total', (select count(*) from public.lessons l where l.level_id = lv.id and l.published),
            'done', (select count(*) from public.lessons l
                     join public.lesson_progress lp on lp.lesson_id = l.id and lp.user_id = uid
                     where l.level_id = lv.id and l.published),
            'percent', 0, 'quiz_id', null, 'quiz_passed', false,
            'unlocked', public.level_unlocked(lv.id, uid),
            'state', case
              when not public.level_tier_ok(lv.id, uid) then 'tier_locked'
              when public.level_unlocked(lv.id, uid) then 'open' else 'locked' end,
            -- كانت '[]' هنا، فمستوى بلا مسار لا تُفتح دروسه في الخارطة
            'weeks', public.level_weeks(lv.id, uid)) order by lv.sort_order, lv.title)
          from public.levels lv where lv.published and lv.track_id is null), '[]'::jsonb))
    where exists (select 1 from public.levels where published and track_id is null)
  ) q;

  return jsonb_build_object(
    'current_level', cur,
    'next_lesson', nxt,
    'levels_total', (select count(*) from public.levels where published),
    'lessons_total', n_total,
    'lessons_done', n_done,
    'lessons_open', n_open,
    'lessons_locked', n_locked,
    'strategies_total', s_total,
    'strategies_open', s_open,
    'my_tier', public.my_tier(uid),
    'my_plan', (select plan from public.profiles where id = uid),
    'percent', case when n_total > 0 then round(n_done * 100.0 / n_total)::int else 0 end,
    'tracks', res);
end;
$fn$;

revoke all on function public.my_map() from public;
grant execute on function public.my_map() to authenticated;

notify pgrst, 'reload schema';
