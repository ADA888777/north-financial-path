-- ============================================================
-- ٤٧) صفحة «الدروس»: المنهج كلّه في قائمة واحدة
--
-- الخارطة تعرض تقدّمها: مستواها الحالي ودروسه، وما أنهته للمراجعة.
-- وهذه صفحة أخرى: المنهج كاملاً بطاقةً بطاقة، مقسَّماً بالمستوى،
-- لتعرف أين هي منه وما ينتظرها.
--
-- my_map() تصلح للخارطة لا لهذه: حمولتها شجرة (مسار ← مستوى ←
-- أسبوع ← درس) والصفحة تريد قائمةً مسطّحة ترشَّح برقائق المستويات.
-- تسطيحها في الواجهة يعني منطق ترتيبٍ ثانياً يفترق عن الأول.
--
-- الحالة والسبب من الدوال نفسها التي تحرس الوصول — lesson_unlocked
-- و lesson_lock_reason — فما تقوله البطاقة هو ما تفعله القاعدة.
-- والنصّ القصير من lessons.summary: هو ما كُتب للعرض أصلاً.
-- ============================================================

create or replace function public.my_lessons()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  uid uuid := auth.uid();
  lv  jsonb;
  ls  jsonb;
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;

  -- رقائق المستويات: اسمها وعدد دروسها وحالتها
  select coalesce(jsonb_agg(x order by x_sort), '[]'::jsonb) into lv
  from (
    select l.sort_order as x_sort,
           jsonb_build_object(
             'id', l.id,
             'code', l.code,
             'title', l.title,
             'total', (select count(*) from public.lessons s
                       where s.level_id = l.id and s.published),
             'tier_ok', public.level_tier_ok(l.id, uid),
             'required_plan', public.level_required_plan(l.id),
             'state', case
               when not public.level_tier_ok(l.id, uid) then 'tier_locked'
               when not public.level_unlocked(l.id, uid) then 'locked'
               when public.level_cleared(l.id, uid) then 'done'
               else 'open' end) as x
    from public.levels l
    where l.published
  ) q;

  -- الدروس بترتيب المنهج: المستوى ثم الأسبوع ثم ترتيب الدرس
  select coalesce(jsonb_agg(y order by y_lv, y_wk, y_so, y_id), '[]'::jsonb) into ls
  from (
    select coalesce(lev.sort_order, 9999) y_lv,
           coalesce(s.week_no, 0) y_wk,
           coalesce(s.sort_order, 0) y_so,
           s.id y_id,
           jsonb_build_object(
             'id', s.id,
             'title', s.title,
             'summary', nullif(btrim(coalesce(s.summary, '')), ''),
             'duration_min', s.duration_min,
             'kind', s.kind,
             'level_id', s.level_id,
             'level_code', lev.code,
             'level_title', lev.title,
             'done', exists (select 1 from public.lesson_progress lp
                             where lp.lesson_id = s.id and lp.user_id = uid),
             'unlocked', public.lesson_unlocked(s.id, uid),
             'reason', public.lesson_lock_reason(s.id, uid),
             'required_plan', public.lesson_required_plan(s.id),
             'state', case
               when exists (select 1 from public.lesson_progress lp
                            where lp.lesson_id = s.id and lp.user_id = uid) then 'done'
               when public.lesson_unlocked(s.id, uid) then 'open'
               when not public.lesson_tier_ok(s.id, uid) then 'tier_locked'
               else 'locked' end) as y
    from public.lessons s
    left join public.levels lev on lev.id = s.level_id
    where s.published
  ) q2;

  return jsonb_build_object('levels', lv, 'lessons', ls);
end;
$fn$;

revoke all on function public.my_lessons() from public;
grant execute on function public.my_lessons() to authenticated;

notify pgrst, 'reload schema';
