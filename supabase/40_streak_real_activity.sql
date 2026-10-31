-- ============================================================
-- ٤٠) السلسلة من فعلٍ حقيقي، والتصفير يشملها
--
-- ١) كانت لوحة المتعلّم تنادي touch_activity() عند كل فتحٍ للصفحة،
--    فمن دخلت ولم تفتح درساً ولم تسلّم اختباراً عُدّ يومها نشطاً
--    واتّقدت السلسلة. النار بلا عمل تُفرغ الرقم من معناه: صار
--    عدّاد زيارات لا عدّاد تعلّم. حُذف النداء من الواجهة، فلم يبقَ
--    إلا ما تناديه القاعدة بعد فعلٍ مسجَّل:
--      mark_lesson_opened · set_lesson_done · check_vocab ·
--      answer_challenge · complete_task
--
-- ٢) submit_quiz كانت الثغرة في هذه القائمة: تُسجَّل المحاولة في
--    quiz_attempts ولا يُحتسب اليوم. فمن قضت يومها في الاختبارات
--    وحدها انكسرت سلسلتها. تُعاد هنا بالنداء مضافاً بعد التسجيل.
--
-- ٣) وتصفير التقدّم كان يترك السلسلة قائمة: حسابٌ صُفِّر تقدّمه
--    يظهر «٣ أيام متتالية» دون درسٍ واحد وراءها. أُلحق بالحذف
--    أيامُ النشاط وعدّادا السلسلة.
--
-- الهجرة idempotent: إعادة تشغيلها لا تغيّر شيئاً.
-- ============================================================

-- ------------------------------------------------------------
-- ١) تسليم الاختبار يوم نشط
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

-- ------------------------------------------------------------
-- ٢) التصفير يشمل أيام النشاط والسلسلة
-- ------------------------------------------------------------
create or replace function public.admin_reset_member_progress(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  p        public.profiles;
  n_les    integer;
  n_spot   integer;
  n_quiz   integer;
  n_day    integer;
begin
  p := public.admin_target(p_user);

  select count(*) into n_les  from public.lesson_progress where user_id = p_user;
  select count(*) into n_spot from public.lesson_spots    where user_id = p_user;
  select count(*) into n_quiz from public.quiz_attempts   where user_id = p_user;
  select count(*) into n_day  from public.activity_days   where user_id = p_user;

  if n_les + n_spot + n_quiz + n_day = 0 then
    return jsonb_build_object('ok', true, 'unchanged', true,
      'message', 'لا تقدّم مسجّل لهذه العضوة أصلاً.');
  end if;

  delete from public.lesson_progress where user_id = p_user;
  delete from public.lesson_spots    where user_id = p_user;
  delete from public.quiz_attempts   where user_id = p_user;
  delete from public.activity_days   where user_id = p_user;

  -- السلسلة محسوبة من هذه الأيام، فتركُ عدّادها يُبقي رقماً بلا
  -- أيامٍ تسنده. والصف نفسه يبقى: فيه آخر درس وتفضيلات لا تُصفَّر.
  update public.learner_state
  set streak_days     = 0,
      longest_streak  = 0,
      last_active_day = null
  where user_id = p_user;

  perform public.log_admin(
    'progress_reset', p_user,
    coalesce(p.full_name, p.email, p.membership_no),
    'حُذف ' || n_les || ' درساً منجزاً و' || n_quiz || ' محاولة اختبار و' ||
    n_day || ' يوم نشاط. تعود الدروس مقفلةً من أولها والسلسلة إلى صفر.',
    jsonb_build_object('lessons', n_les, 'spots', n_spot,
                       'quizzes', n_quiz, 'days', n_day));

  return jsonb_build_object('ok', true,
    'lessons', n_les, 'spots', n_spot, 'quizzes', n_quiz, 'days', n_day,
    'message', 'صُفِّر التقدّم: ' || n_les || ' درساً و' || n_quiz ||
               ' محاولة اختبار و' || n_day || ' يوم نشاط.');
end;
$fn$;

revoke all on function public.admin_reset_member_progress(uuid) from public;
grant execute on function public.admin_reset_member_progress(uuid) to authenticated;

notify pgrst, 'reload schema';
