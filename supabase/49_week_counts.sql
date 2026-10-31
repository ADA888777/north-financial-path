-- ============================================================
-- ٤٩) أرقام الأسبوع الحالي في ملخّص الخارطة
--
-- «١٢ درساً ويكتمل هذا المستوى» رقمٌ بعيد: المستوى المبتدئ
-- مقسَّمٌ أسابيع، والمتعلّمة تعيش أسبوعها لا مستواها كلّه. فإن
-- قيل لها اثنا عشر وهي في أسبوعٍ فيه تسعة، صار الرقم عبئاً لا
-- هدفاً. الملخّص اليوم يقيس أسبوعها: كم بقي فيه، وكم فُتح منه
-- الآن. و«مكتمل» وحده يبقى على المستوى كلّه لأنه حصيلةٌ تكبر
-- ولا ترجع — فلا تُصفَّر عند انتقالها إلى الأسبوع التالي.
--
-- أسبوعها = أدنى أسبوعٍ في مستواها الحالي فيه درسٌ تفتحه باقتها
-- ولم تُنهه. ومستوى بلا تقسيم (week_no فارغ أو واحد) أسبوعُه
-- واحد، فتبقى الأرقام أرقام المستوى بلا حالةٍ خاصّة في الواجهة.
--
-- و level_remaining صار يحترم الباقة كبقيّة أرقام الخارطة: درسٌ
-- خلف ترقيةٍ ليس «باقياً عليها».
--
-- الهجرة idempotent.
-- ============================================================

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
  ),
  -- دروس المستوى الحالي التي تفتحها باقتها، وحالُ كلٍّ منها
  cl as (
    select coalesce(l.week_no, 1) as week_of,
           public.lesson_unlocked(l.id, p_uid) as unlocked,
           exists (select 1 from public.lesson_progress lp
                   where lp.lesson_id = l.id and lp.user_id = p_uid) as done
    from public.lessons l
    where l.published
      and l.level_id = (select id from cur)
      and public.lesson_tier_ok(l.id, p_uid)
  ),
  now_week as (select min(week_of)::int as w from cl where not done),
  this_week as (select * from cl where week_of = (select w from now_week))
  select jsonb_build_object(
    'level_remaining', (select count(*) from cl where not done),
    'level_done',      (select count(*) from cl where done),
    'level_total',     (select count(*) from cl),
    'week_no',         (select w from now_week),
    'week_count',      (select count(distinct week_of) from cl),
    'week_total',      (select count(*) from this_week),
    'week_done',       (select count(*) from this_week where done),
    'week_remaining',  (select count(*) from this_week where not done),
    'week_open',       (select count(*) from this_week where unlocked and not done),
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
