-- ============================================================
-- ٤١) أرقام الخارطة من باقة العضوة، وكل مستوى يفتح دروسه
--
-- ١) «تقدمك الكلي» كان مقامه كل الدروس المنشورة مهما كانت الباقة.
--    فالبرونزية التي تنهي كل ما تملكه تقف عند ٦٣٪ ولا تبلغ المئة
--    أبداً، لأن المقام يحوي دروساً لا يفتحها اشتراكها. والرقم
--    المعروض «٥ مستويات · ٤١ درساً» يَعِدها بما ليس لها.
--
--    المقام اليوم: ما تفتحه باقتها. ودرسٌ يتطلب باقة أعلى يُعدّ
--    في «باقي لك محتوى أكثر» لا في مقام تقدّمها. أما المقفل
--    بالتسلسل فيبقى محسوباً: هو لها، ينتظر تقدّمها لا ترقيتها.
--    و«ينتظر تقدّمك» لا يشمل درساً أنجزته: المنجز ليس منتظَراً.
--
--    وعدد المستويات يبقى الكلّ: تراها كلها ليعرف أين ينتهي
--    الطريق، وإن كان أحدها خلف ترقية.
--
--    حالة خاصة: من نزلت من الماسية إلى البرونزية قد تملك دروساً
--    منجزة خارج باقتها الآن. تُستثنى من البسط كما استُثنيت من
--    المقام، وإلا تجاوزت النسبة المئة.
--
-- ٢) المستويات غير المسنَدة إلى مسار كانت ترجع weeks فارغة، فلا
--    يظهر لها زرّ «دروس هذا المستوى» في الخارطة بينما يظهر
--    لأخواتها. بناء الأسابيع كان مكتوباً مرّتين، فاستُخرج إلى
--    level_weeks() وتنادي من الفرعين — نسخة واحدة لا تفترق.
--
-- الهجرة idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- ١) أسابيع المستوى ودروسه — تعريف واحد للفرعين
-- ------------------------------------------------------------
create or replace function public.level_weeks(p_level uuid, p_uid uuid default auth.uid())
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select jsonb_agg(w order by (w->>'week')::int)
    from (
      select jsonb_build_object(
        'week', l.week_no,
        'lessons', jsonb_agg(jsonb_build_object(
          'id', l.id, 'title', l.title, 'kind', l.kind,
          'duration_min', l.duration_min,
          'free_preview', l.free_preview,
          'min_tier', l.min_tier,
          'tier_ok', public.lesson_tier_ok(l.id, p_uid),
          'required_plan', public.lesson_required_plan(l.id),
          'done', exists (select 1 from public.lesson_progress lp
                          where lp.lesson_id = l.id and lp.user_id = p_uid),
          'unlocked', public.lesson_unlocked(l.id, p_uid),
          'reason', public.lesson_lock_reason(l.id, p_uid),
          'cta', case when public.lesson_unlocked(l.id, p_uid)
                      then 'اضغط لفتح الدرس' else null end,
          'quiz_id', (select q2.id from public.quizzes q2
                      where q2.lesson_id = l.id and q2.published
                      order by q2.sort_order limit 1),
          'state', case
            when exists (select 1 from public.lesson_progress lp
                         where lp.lesson_id = l.id and lp.user_id = p_uid) then 'done'
            when public.lesson_unlocked(l.id, p_uid) then 'open'
            when not public.lesson_tier_ok(l.id, p_uid) then 'tier_locked'
            else 'locked' end)
          order by l.sort_order, l.title)) w
      from public.lessons l
      where l.published and l.level_id = p_level
      group by l.week_no
    ) z), '[]'::jsonb);
$$;

revoke all on function public.level_weeks(uuid, uuid) from public;
grant execute on function public.level_weeks(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- ٢) الخارطة
-- ------------------------------------------------------------
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

  -- الأعداد كلها داخل الباقة: المقام والبسط والمقفل بالتسلسل
  select count(*) filter (where public.lesson_tier_ok(l.id, uid)),
         count(*) filter (where public.lesson_tier_ok(l.id, uid)
                            and exists (select 1 from public.lesson_progress lp
                                        where lp.lesson_id = l.id and lp.user_id = uid)),
         count(*) filter (where public.lesson_unlocked(l.id, uid)
                            and not exists (select 1 from public.lesson_progress lp
                                            where lp.lesson_id = l.id and lp.user_id = uid)),
         count(*) filter (where public.lesson_tier_ok(l.id, uid)
                            and not public.lesson_unlocked(l.id, uid)
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

-- ------------------------------------------------------------
-- ٣) «يظهر لك مع تقدّمك» لا يشمل ما أنجزته
--    نفس العلّة في my_map_counts: درسٌ أنجزته ولم يفتحه التسلسل
--    بعدُ كان يُعدّ ضمن ما ينتظرها، فيعدها بما عندها.
-- ------------------------------------------------------------
create or replace function public.my_map_counts(p_uid uuid default auth.uid())
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  with cur as (
    select lv.id
    from public.levels lv
    where lv.published and public.level_unlocked(lv.id, p_uid)
      and not public.level_cleared(lv.id, p_uid)
    order by lv.sort_order, lv.title
    limit 1
  )
  select jsonb_build_object(
    'level_remaining', (
      select count(*) from public.lessons l
      where l.published
        and l.level_id = (select id from cur)
        and not exists (select 1 from public.lesson_progress lp
                        where lp.lesson_id = l.id and lp.user_id = p_uid)),
    'upcoming_in_plan', (
      select count(*) from public.lessons l
      where l.published
        and public.lesson_tier_ok(l.id, p_uid)
        and not public.lesson_unlocked(l.id, p_uid)
        and not exists (select 1 from public.lesson_progress lp
                        where lp.lesson_id = l.id and lp.user_id = p_uid)),
    'upcoming_higher_plan', (
      select count(*) from public.lessons l
      where l.published
        and not public.lesson_tier_ok(l.id, p_uid))
  );
$fn$;

revoke all on function public.my_map_counts(uuid) from public;
grant execute on function public.my_map_counts(uuid) to authenticated;

notify pgrst, 'reload schema';
