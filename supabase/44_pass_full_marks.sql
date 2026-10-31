-- ============================================================
-- ٤٤) الدرس التالي لا يُفتح إلا بمئة بالمئة
--
-- التدرّج موجود: الدرس الأول مفتوح، وما بعده يتطلّب اجتياز اختبار
-- سابقه، والمستوى التالي يتطلّب إنهاء السابق واجتياز اختباره.
-- لكن «الاجتياز» كان يعني percent >= quizzes.pass_score — ودرجة
-- النجاح حقلٌ تضبطه الإدارة. فستّون بالمئة كانت تفتح الدرس التالي.
--
-- العميلة تريد المئة بالضبط: «نتيجة 99% لا تفتح الدرس التالي».
-- الشرط هنا على النسبة نفسها لا على عمودٍ قد يُخفَّض سهواً من
-- اللوحة، فالقاعدة تحرس القاعدة.
--
-- و pass_score يُرفع إلى ١٠٠ ليوافق ما تراه المتعلّمة: لو بقي ٦٠
-- لقالت شاشة النتيجة «ناجحة» ثم وجدت الدرس التالي مقفلاً.
-- يُرفع لما بقي على القيمة الأولى وحده، فلا يُمسّ ما ضبطته الإدارة
-- عمداً فوق ذلك.
--
-- أثرٌ يجب أن يُعرف: محاولةٌ سابقة نجحت بأقلّ من ١٠٠ لم تعد تفتح
-- ما بعدها. من كانت في منتصف المنهج تعيد ذلك الاختبار. السجلّ
-- كامل لا يُحذف منه شيء: المحاولات ونتائجها والدروس المنجزة كما هي.
--
-- الهجرة idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- ١) معيار واحد للاجتياز، تناديه الدوال الثلاث
-- ------------------------------------------------------------
create or replace function public.quiz_aced(p_quiz uuid, p_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_quiz is not null and p_uid is not null and exists (
    select 1 from public.quiz_attempts a
    where a.quiz_id = p_quiz and a.user_id = p_uid
      and a.percent >= 100);
$$;

-- اختبار منشور بلا أسئلة: نسبته صفر دائماً، فلو عُدّ بوابةً لسدّ
-- المنهج إلى الأبد ولا سبيل لفتحه. مثل هذا الاختبار لا وجود له
-- في حساب التدرّج، وتبقى بوابة الدرس إنهاؤه.
create or replace function public.gating_quiz(p_lesson uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select q.id from public.quizzes q
  where q.lesson_id = p_lesson and q.published
    and exists (select 1 from public.questions qs where qs.quiz_id = q.id)
  order by q.sort_order limit 1;
$$;

create or replace function public.gating_level_quiz(p_level uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select q.id from public.quizzes q
  where q.level_id = p_level and q.lesson_id is null and q.published
    and exists (select 1 from public.questions qs where qs.quiz_id = q.id)
  order by q.sort_order limit 1;
$$;

revoke all on function public.gating_quiz(uuid) from public;
revoke all on function public.gating_level_quiz(uuid) from public;
grant execute on function public.gating_quiz(uuid) to authenticated;
grant execute on function public.gating_level_quiz(uuid) to authenticated;

revoke all on function public.quiz_aced(uuid, uuid) from public;
grant execute on function public.quiz_aced(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- ٢) درجة النجاح المعروضة توافق البوابة
-- ------------------------------------------------------------
alter table public.quizzes alter column pass_score set default 100;
update public.quizzes set pass_score = 100 where pass_score < 100;

-- ------------------------------------------------------------
-- ٣) فتح الدرس
-- ------------------------------------------------------------
create or replace function public.lesson_unlocked(p_lesson uuid, p_uid uuid default auth.uid())
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  l    record;
  prev record;
  qz   uuid;
begin
  if p_uid is null then return false; end if;
  if public.is_admin() then return true; end if;

  select id, level_id, sort_order, week_no, published, free_preview, access
    into l
  from public.lessons where id = p_lesson;

  if not found or not l.published then return false; end if;
  if l.free_preview then return true; end if;

  if not public.lesson_tier_ok(p_lesson, p_uid) then return false; end if;
  if l.access = 'open'   then return true; end if;
  if l.access = 'locked' then return false; end if;

  if l.level_id is not null and not public.level_unlocked(l.level_id, p_uid) then
    return false;
  end if;

  select ls.id, ls.sort_order into prev
  from public.lessons ls
  where ls.published
    and ls.level_id is not distinct from l.level_id
    and (ls.week_no, ls.sort_order, ls.id) < (l.week_no, l.sort_order, l.id)
  order by ls.week_no desc, ls.sort_order desc, ls.id desc
  limit 1;

  -- أول درس في المستوى: مفتوح
  if not found then return true; end if;

  qz := public.gating_quiz(prev.id);

  -- للسابق اختبار: المئة شرطُ الفتح، لا أقلّ
  if qz is not null then
    return public.quiz_aced(qz, p_uid);
  end if;

  -- لا اختبار للسابق: إنهاؤه هو الشرط
  return exists (select 1 from public.lesson_progress lp
                 where lp.user_id = p_uid and lp.lesson_id = prev.id);
end;
$fn$;

revoke all on function public.lesson_unlocked(uuid, uuid) from public;
grant execute on function public.lesson_unlocked(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- ٤) فتح المستوى
-- ------------------------------------------------------------
create or replace function public.level_unlocked(p_level uuid, p_uid uuid default auth.uid())
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
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

  if not public.level_tier_ok(p_level, p_uid) then return false; end if;

  select l.id, l.sort_order into prev
  from public.levels l
  where l.published
    and l.track_id is not distinct from lv.track_id
    and (l.sort_order, l.id) < (lv.sort_order, lv.id)
  order by l.sort_order desc, l.id desc
  limit 1;

  if not found then return true; end if;
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

  -- واختبارات دروس المستوى السابق كلها بالمئة، لا آخرها وحده:
  -- من أنهت الدرس العاشر دون اختباره لا يُفتح لها المستوى التالي.
  if exists (
    select 1 from public.lessons l
    where l.level_id = prev.id and l.published
      and public.gating_quiz(l.id) is not null
      and not public.quiz_aced(public.gating_quiz(l.id), p_uid))
  then
    return false;
  end if;

  prev_quiz := public.gating_level_quiz(prev.id);

  if prev_quiz is null then return true; end if;
  return public.quiz_aced(prev_quiz, p_uid);
end;
$fn$;

revoke all on function public.level_unlocked(uuid, uuid) from public;
grant execute on function public.level_unlocked(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- ٥) اكتمال المستوى — بالمعيار نفسه
-- ------------------------------------------------------------
create or replace function public.level_cleared(p_level uuid, p_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  with tot as (
    select count(*)::int n from public.lessons
    where level_id = p_level and published),
  dn as (
    select count(*)::int n from public.lessons l
    join public.lesson_progress lp on lp.lesson_id = l.id and lp.user_id = p_uid
    where l.level_id = p_level and l.published),
  pending as (
    select 1 from public.lessons l
    where l.level_id = p_level and l.published
      and public.gating_quiz(l.id) is not null
      and not public.quiz_aced(public.gating_quiz(l.id), p_uid)),
  qz as (select public.gating_level_quiz(p_level) id)
  select tot.n > 0 and dn.n >= tot.n
         and not exists (select 1 from pending)
         and ((select id from qz) is null
              or public.quiz_aced((select id from qz), p_uid))
  from tot, dn;
$fn$;

revoke all on function public.level_cleared(uuid, uuid) from public;
grant execute on function public.level_cleared(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- ٦) سبب القفل يقول المئة صراحةً
-- ------------------------------------------------------------
create or replace function public.lesson_lock_reason(p_lesson uuid, p_uid uuid default auth.uid())
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  l    record;
  prev record;
  qz   record;
  best integer;
begin
  if p_uid is null then return 'سجّلي الدخول لعرض الدرس'; end if;
  if public.lesson_unlocked(p_lesson, p_uid) then return null; end if;

  select id, level_id, sort_order, week_no, published, free_preview, access, title
    into l
  from public.lessons where id = p_lesson;

  if not found or not l.published then return 'الدرس غير متاح'; end if;
  if l.access = 'locked' then return 'هذا الدرس مغلق من الإدارة'; end if;

  if not public.lesson_tier_ok(p_lesson, p_uid) then
    return coalesce('يتطلب باقة ' || public.lesson_required_plan(p_lesson),
                    'يتطلب باقة أعلى');
  end if;

  if l.level_id is not null and not public.level_unlocked(l.level_id, p_uid) then
    return 'أكملي المستوى السابق أولاً';
  end if;

  select ls.id, ls.title into prev
  from public.lessons ls
  where ls.published
    and ls.level_id is not distinct from l.level_id
    and (ls.week_no, ls.sort_order, ls.id) < (l.week_no, l.sort_order, l.id)
  order by ls.week_no desc, ls.sort_order desc, ls.id desc
  limit 1;

  if not found then return 'غير متاح الآن'; end if;

  select q.id, q.title into qz from public.quizzes q
  where q.id = public.gating_quiz(prev.id);

  if qz.id is null then
    return 'أنهي «' || prev.title || '» أولاً';
  end if;

  select max(a.percent) into best
  from public.quiz_attempts a
  where a.quiz_id = qz.id and a.user_id = p_uid;

  if best is null then
    return 'اجتازي اختبار «' || prev.title || '» بنسبة 100% لفتحه';
  end if;

  -- أفضل محاولة معروضة: الفرق بين «لم أختبر» و«اقتربتُ» يغيّر الخطوة
  return 'أفضل نتيجة لك في اختبار «' || prev.title || '» هي ' || best ||
         '% — المطلوب 100% لفتح هذا الدرس';
end;
$fn$;

revoke all on function public.lesson_lock_reason(uuid, uuid) from public;
grant execute on function public.lesson_lock_reason(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- ٧) لا يُسلَّم اختبارُ درسٍ لم يُفتح
--
--    get_quiz() كانت محروسة، و submit_quiz() لا. فمن عرف معرّف
--    اختبار درسٍ بعيد استطاع ناداءه مباشرةً وتسجيل مئةٍ فيه —
--    فينفتح الدرس الذي بعده. البوابة هنا تُغلق الطريق نفسه الذي
--    تغلقه get_quiz، فلا يُفتح بتغيير معرّف في الرابط.
-- ------------------------------------------------------------
create or replace function public.submit_quiz(p_quiz uuid, p_answers jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  qz record; used integer;
  total integer := 0; earned integer := 0; pct integer := 0;
  ok boolean; q record; chosen uuid;
begin
  select * into qz from public.quizzes where id = p_quiz and published;
  if not found then
    return jsonb_build_object('error', 'الاختبار غير متاح');
  end if;

  if not public.has_active_subscription() then
    return jsonb_build_object('error', 'يتطلب اشتراكاً نافذاً');
  end if;

  if not public.is_admin() then
    if qz.lesson_id is not null and not public.lesson_unlocked(qz.lesson_id) then
      return jsonb_build_object('error',
        coalesce(public.lesson_lock_reason(qz.lesson_id), 'هذا الدرس لم يُفتح بعد'));
    end if;
    if qz.lesson_id is null and qz.level_id is not null
       and not public.level_unlocked(qz.level_id) then
      return jsonb_build_object('error', 'هذا المستوى لم يُفتح بعد');
    end if;
  end if;

  if not exists (select 1 from public.questions where quiz_id = p_quiz) then
    return jsonb_build_object('error',
      'هذا الاختبار بلا أسئلة بعد. أبلغي الإدارة.');
  end if;

  select count(*) into used from public.quiz_attempts
  where quiz_id = p_quiz and user_id = auth.uid();

  if qz.max_attempts is not null and used >= qz.max_attempts then
    return jsonb_build_object('error', 'استنفدت عدد المحاولات المسموح بها');
  end if;

  for q in select id from public.questions where quiz_id = p_quiz loop
    total := total + 1;
    begin
      chosen := (p_answers ->> q.id::text)::uuid;
    exception when others then
      chosen := null;
    end;

    if chosen is not null and exists (
      select 1 from public.answers a
      where a.id = chosen and a.question_id = q.id and a.is_correct
    ) then
      earned := earned + 1;
    end if;
  end loop;

  if total > 0 then
    pct := round((earned::numeric / total) * 100);
  end if;
  ok := pct >= qz.pass_score;

  insert into public.quiz_attempts (quiz_id, user_id, score, max_score, percent, passed, answers)
  values (p_quiz, auth.uid(), earned, total, pct, ok, coalesce(p_answers, '{}'::jsonb));

  -- المحاولة فعلٌ مسجَّل، فيومها نشط — سواء نجحت أم لم تنجح.
  perform public.touch_activity();

  return jsonb_build_object(
    'score', earned, 'max_score', total, 'percent', pct,
    'passed', ok, 'pass_score', qz.pass_score,
    'attempts_used', used + 1, 'max_attempts', qz.max_attempts
  );
end;
$fn$;

revoke all on function public.submit_quiz(uuid, jsonb) from public;
grant execute on function public.submit_quiz(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
