-- ============================================================
-- 25: الخارطة — تدرّج ١٠٠٪، وقفل المستويات بالباقة، وألوان تُدار
--
-- ثلاثة أشياء:
--   أ) نسبة النجاح ١٠٠٪ للمحاولات الجديدة، والنجاح القديم محفوظ.
--   ب) المستوى يُقفل بالباقة كما يُقفل الدرس. كان level_unlocked يقيس
--      التقدّم وحده، فمستوىً ماسيٌّ يظهر «مفتوحاً» لبرونزية أنهت ما
--      قبله بينما كل دروسه مقفلة — تناقض تراه المشتركة ولا تفهمه.
--   ج) لون كل مستوى من القاعدة لا من الكود، ونصوص الحالات في مكان واحد.
-- ============================================================

-- ------------------------------------------------------------
-- أ) نسبة النجاح
--
--    quiz_attempts.passed عمود مخزَّن يُحسب لحظة التسليم، لا يُعاد
--    حسابه. فرفع pass_score يحكم المحاولات القادمة وحدها، ومن اجتازت
--    بالقاعدة القديمة يبقى درسها التالي مفتوحاً ولا يتراجع تقدّمها.
--    هذا ما يجعل «١٠٠٪ للجديد والقديم محفوظ» صحيحاً بالبناء لا بالنيّة.
-- ------------------------------------------------------------
alter table public.quizzes alter column pass_score set default 100;

update public.quizzes set pass_score = 100 where pass_score <> 100;

comment on column public.quizzes.pass_score is
  'نسبة النجاح المطلوبة. ١٠٠ باعتماد العميلة. تُدار من لوحة الإدارة، '
  'ولا تُخفَّض دون موافقتها. تغييرها يحكم المحاولات الجديدة فقط لأن '
  'quiz_attempts.passed مخزَّن لحظة التسليم.';

-- ------------------------------------------------------------
-- ب) لون المستوى — من القاعدة، ومن قائمة مغلقة
--
--    القائمة مغلقة عمداً: لون حرّ لكل مستوى يفكّك هوية المنصة خلال
--    شهر. الإدارة تختار من هذه الأسماء، وملف التصميم يترجمها.
-- ------------------------------------------------------------
alter table public.levels add column if not exists color text;

do $$ begin
  alter table public.levels add constraint levels_color_chk
    check (color is null or color in
      ('green','blue','violet','amber','rose','teal','slate'));
exception when duplicate_object then null; end $$;

-- بذرة بترتيب المستوى لا باسمه: الأسماء تخصّ العميلة وقد تتغيّر،
-- والترتيب هو ما يحدّد مكان المستوى في الخارطة.
with ordered as (
  select id, row_number() over (order by sort_order, title) as n
  from public.levels where published
)
update public.levels lv
set color = (array['green','blue','violet','amber','rose','teal','slate'])
            [((o.n - 1) % 7) + 1]
from ordered o
where o.id = lv.id and lv.color is null;

-- ------------------------------------------------------------
-- ج) هل تفتح باقتها هذا المستوى؟
-- ------------------------------------------------------------
create or replace function public.level_tier_ok(p_level uuid, p_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_admin(p_uid) or exists (
    select 1
    from public.levels lv
    left join public.tracks tr on tr.id = lv.track_id
    where lv.id = p_level
      and public.my_tier(p_uid) >= greatest(
            coalesce(lv.min_tier, 1), coalesce(tr.min_tier, 1)));
$$;

revoke all on function public.level_tier_ok(uuid, uuid) from public;
grant execute on function public.level_tier_ok(uuid, uuid) to authenticated;

create or replace function public.level_required_plan(p_level uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select pl.name
  from public.levels lv
  left join public.tracks tr on tr.id = lv.track_id
  join public.plans pl on pl.active and pl.tier >= greatest(
         coalesce(lv.min_tier, 1), coalesce(tr.min_tier, 1))
  where lv.id = p_level
  order by pl.tier
  limit 1;
$$;

revoke all on function public.level_required_plan(uuid) from public;
grant execute on function public.level_required_plan(uuid) to anon, authenticated;

-- ------------------------------------------------------------
-- level_unlocked: الباقة أولاً ثم التقدّم
-- ------------------------------------------------------------
create or replace function public.level_unlocked(p_level uuid, p_uid uuid default auth.uid())
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  lv        record;
  prev      record;
  prev_tot  integer;
  prev_done integer;
  prev_quiz uuid;
begin
  if p_uid is null then return false; end if;
  if public.is_admin() then return true; end if;

  select id, track_id, sort_order into lv
  from public.levels where id = p_level and published;
  if not found then return false; end if;

  -- باقتها لا تفتح هذا المستوى: مقفل مهما بلغ تقدّمها
  if not public.level_tier_ok(p_level, p_uid) then return false; end if;

  select l.id, l.sort_order into prev
  from public.levels l
  where l.published
    and l.track_id is not distinct from lv.track_id
    and (l.sort_order, l.id) < (lv.sort_order, lv.id)
  order by l.sort_order desc, l.id desc
  limit 1;

  -- أول مستوى في المسار لا سابق له
  if not found then return true; end if;

  -- مستوى سابق لا تفتحه باقتها لا يجوز أن يسدّ عليها ما بعده إن كانت
  -- باقتها تفتحه: تُتخطّى المستويات المحجوبة بالباقة في حساب التدرّج.
  if not public.level_tier_ok(prev.id, p_uid) then return true; end if;

  select count(*) into prev_tot
  from public.lessons where level_id = prev.id and published;

  select count(*) into prev_done
  from public.lessons l
  join public.lesson_progress lp
    on lp.lesson_id = l.id and lp.user_id = p_uid
  where l.level_id = prev.id and l.published;

  if prev_tot = 0 or prev_done < prev_tot then
    return false;
  end if;

  select q.id into prev_quiz
  from public.quizzes q
  where q.level_id = prev.id and q.published
  order by q.sort_order limit 1;

  if prev_quiz is null then return true; end if;

  return exists (
    select 1 from public.quiz_attempts a
    where a.quiz_id = prev_quiz and a.user_id = p_uid and a.passed
  );
end;
$$;

revoke all on function public.level_unlocked(uuid, uuid) from public;
grant execute on function public.level_unlocked(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- سبب قفل المستوى — جملة واحدة تقولها القاعدة، لا الواجهة
-- ------------------------------------------------------------
create or replace function public.level_lock_reason(p_level uuid, p_uid uuid default auth.uid())
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare prev record;
begin
  if public.level_unlocked(p_level, p_uid) then return null; end if;

  if not public.level_tier_ok(p_level, p_uid) then
    if public.my_tier(p_uid) = 0 then
      return 'انتهى اشتراكك. جدّديه لمتابعة المستويات.';
    end if;
    return 'رقّي اشتراكك إلى «' ||
           coalesce(public.level_required_plan(p_level), 'الباقة الأعلى') ||
           '» لفتح المستوى.';
  end if;

  select l.title into prev
  from public.levels l
  join public.levels cur on cur.id = p_level
  where l.published and l.track_id is not distinct from cur.track_id
    and (l.sort_order, l.id) < (cur.sort_order, cur.id)
  order by l.sort_order desc, l.id desc
  limit 1;

  if found then
    return 'أكملي دروس «' || prev.title || '» واجتازي اختبارها لفتح المستوى.';
  end if;
  return 'هذا المستوى غير متاح لك الآن.';
end;
$$;

revoke all on function public.level_lock_reason(uuid, uuid) from public;
grant execute on function public.level_lock_reason(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- سبب قفل الدرس — بنصّ المرجع حرفياً، والنسبة من الاختبار نفسه
-- ------------------------------------------------------------
create or replace function public.lesson_lock_reason(p_lesson uuid, p_uid uuid default auth.uid())
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare l record; prev record; qz record;
begin
  if public.lesson_unlocked(p_lesson, p_uid) then return null; end if;

  select id, level_id, sort_order, week_no, access into l
  from public.lessons where id = p_lesson;

  if l.access = 'locked' then return 'هذا الدرس مغلق حالياً من الإدارة.'; end if;

  if not public.lesson_tier_ok(p_lesson, p_uid) then
    if public.my_tier(p_uid) = 0 then
      return 'انتهى اشتراكك. جدّديه لمتابعة الدروس.';
    end if;
    return 'حصري لـ«' ||
           coalesce(public.lesson_required_plan(p_lesson), 'الباقة الأعلى') || '»';
  end if;

  if l.level_id is not null and not public.level_unlocked(l.level_id, p_uid) then
    return public.level_lock_reason(l.level_id, p_uid);
  end if;

  select ls.id, ls.title into prev
  from public.lessons ls
  where ls.published and ls.level_id is not distinct from l.level_id
    and (ls.week_no, ls.sort_order, ls.id) < (l.week_no, l.sort_order, l.id)
  order by ls.week_no desc, ls.sort_order desc, ls.id desc
  limit 1;

  if not found then return 'هذا الدرس غير متاح لك الآن.'; end if;

  select q.id, q.pass_score into qz from public.quizzes q
  where q.lesson_id = prev.id and q.published order by q.sort_order limit 1;

  if qz.id is not null then
    -- نصّ المرجع. النسبة من الاختبار نفسه فتبقى صادقة لو عدّلتها الإدارة.
    return 'اجتز اختبار السابق ' || coalesce(qz.pass_score, 100) || '٪ لفتحه';
  end if;

  return 'أكمل درس «' || prev.title || '» لفتحه.';
end;
$$;

revoke all on function public.lesson_lock_reason(uuid, uuid) from public;
grant execute on function public.lesson_lock_reason(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- د) get_lesson يستعمل مرجع الأسباب نفسه
--    جملتان لنفس الحالة في مكانين تفترقان بعد أول تعديل.
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
    'duration_min', l.duration_min, 'free_preview', l.free_preview,
    'allowed', ok, 'unlocked', ok,
    'tier_ok', public.lesson_tier_ok(p_lesson, uid),
    'required_plan', public.lesson_required_plan(p_lesson),
    'locked_reason', public.lesson_lock_reason(p_lesson, uid),

    -- المحتوى لا يخرج من القاعدة أصلاً لمن لا يملكه
    'content',  case when ok then l.content  else null end,
    'summary',  case when ok then l.summary  else null end,
    'video_url',case when ok then l.video_url else null end,
    'course_id',case when ok then l.course_id else null end,

    'completed', exists (select 1 from public.lesson_progress lp
                         where lp.lesson_id = l.id and lp.user_id = uid),
    'spot', (select lsp.seconds from public.lesson_spots lsp
             where lsp.lesson_id = l.id and lsp.user_id = uid),
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

-- ------------------------------------------------------------
-- هـ) my_map: ما تحتاجه الخارطة لترسم حالة كل مستوى ودرس
--
--     تُضاف هنا: لون المستوى، ورتبته، وهل تفتحه باقتها، والباقة
--     المطلوبة، وسبب القفل، وعدد دروسه المحصورة بباقة أعلى، ونوع
--     الدرس (درس أم استراتيجية)، ونصّ الدعوة تحت الدرس المفتوح.
--     كلها من القاعدة: الواجهة ترسم ولا تقرّر.
-- ------------------------------------------------------------
create or replace function public.my_map()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
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

  select count(*),
         count(*) filter (where exists (select 1 from public.lesson_progress lp
                                        where lp.lesson_id = l.id and lp.user_id = uid)),
         count(*) filter (where public.lesson_unlocked(l.id, uid)
                            and not exists (select 1 from public.lesson_progress lp
                                            where lp.lesson_id = l.id and lp.user_id = uid)),
         count(*) filter (where not public.lesson_unlocked(l.id, uid))
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
                 -- tier_locked حالة قائمة بذاتها: شارة ترقية لا رسالة تقدّم
                 'state', case
                   when not public.level_tier_ok(lv.id, uid) then 'tier_locked'
                   when not public.level_unlocked(lv.id, uid) then 'locked'
                   when public.level_cleared(lv.id, uid) then 'done'
                   when lv.id = cur then 'current'
                   else 'open' end,
                 'weeks', coalesce((
                   select jsonb_agg(w order by (w->>'week')::int)
                   from (
                     select jsonb_build_object(
                       'week', l.week_no,
                       'lessons', jsonb_agg(jsonb_build_object(
                         'id', l.id, 'title', l.title, 'kind', l.kind,
                         'duration_min', l.duration_min,
                         'free_preview', l.free_preview,
                         'min_tier', l.min_tier,
                         'tier_ok', public.lesson_tier_ok(l.id, uid),
                         'required_plan', public.lesson_required_plan(l.id),
                         'done', exists (select 1 from public.lesson_progress lp
                                         where lp.lesson_id = l.id and lp.user_id = uid),
                         'unlocked', public.lesson_unlocked(l.id, uid),
                         'reason', public.lesson_lock_reason(l.id, uid),
                         'cta', case when public.lesson_unlocked(l.id, uid)
                                     then 'اضغط لفتح الدرس' else null end,
                         'quiz_id', (select q2.id from public.quizzes q2
                                     where q2.lesson_id = l.id and q2.published
                                     order by q2.sort_order limit 1),
                         'state', case
                           when exists (select 1 from public.lesson_progress lp
                                        where lp.lesson_id = l.id and lp.user_id = uid) then 'done'
                           when public.lesson_unlocked(l.id, uid) then 'open'
                           when not public.lesson_tier_ok(l.id, uid) then 'tier_locked'
                           else 'locked' end)
                         order by l.sort_order, l.title)) w
                     from public.lessons l
                     where l.published and l.level_id = lv.id
                     group by l.week_no
                   ) z), '[]'::jsonb)
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
            'weeks', '[]'::jsonb) order by lv.sort_order, lv.title)
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
$$;

revoke all on function public.my_map() from public;
grant execute on function public.my_map() to authenticated;

notify pgrst, 'reload schema';
