-- ============================================================
-- 28: الاختبار هو البوّابة، وأرقام الخارطة بصياغة تَدفع لا تُثبّط
--
--   أ) كان فتح الدرس يشترط شيئين: إنهاء السابق **و** اجتياز اختباره.
--      فمن اجتازت الاختبار ١٠٠٪ دون أن يُسجَّل إنهاؤها للدرس يبقى
--      التالي مقفلاً أمامها بلا سبب تفهمه. صار الاختبار — متى وُجد —
--      هو البوّابة وحده، وإنهاءُ الدرس يحكم حين لا اختبار.
--   ب) أرقام تُحسب من المنشور: ما بقي في مستواها، وما ينتظرها في
--      باقتها، وما يتطلّب باقة أعلى — ثلاثة أرقام لا رقم واحد مبهم.
-- ============================================================

create or replace function public.lesson_unlocked(p_lesson uuid, p_uid uuid default auth.uid())
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
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

  -- الباقة قبل الترتيب: درسٌ لا تفتحه باقته ليس «مفتوحاً» وإن أنهت ما قبله.
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

  -- أول درس في المرحلة: لا سابق له
  if not found then return true; end if;

  select q.id into qz from public.quizzes q
  where q.lesson_id = prev.id and q.published
  order by q.sort_order limit 1;

  -- للسابق اختبار: اجتيازه وحده هو الشرط. من اجتازته فقد درسته.
  if qz is not null then
    return exists (select 1 from public.quiz_attempts a
                   where a.quiz_id = qz and a.user_id = p_uid and a.passed);
  end if;

  -- لا اختبار للسابق: إنهاؤه هو الشرط
  return exists (select 1 from public.lesson_progress lp
                 where lp.user_id = p_uid and lp.lesson_id = prev.id);
end;
$$;

revoke all on function public.lesson_unlocked(uuid, uuid) from public;
grant execute on function public.lesson_unlocked(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- تعديل اختبار بعد أن اجتازته متعلمات: قرار صريح لا صمت
--
--   الفتح يُحسب لحظةَ السؤال من المحاولات، فحذف المحاولات يُرجع
--   القفل فوراً. ولا يُفعل ذلك تلقائياً عند كل تعديل: تصحيح خطأ
--   مطبعيّ في سؤال لا يجوز أن يُلغي اجتياز عشرين متعلمة. الإدارة
--   تقرّر، ويُسجَّل القرار.
-- ------------------------------------------------------------
create or replace function public.admin_reset_quiz_progress(
  p_quiz uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n integer; t text;
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'غير مصرّح');
  end if;

  select title into t from public.quizzes where id = p_quiz;
  if not found then return jsonb_build_object('error', 'الاختبار غير موجود'); end if;

  select count(*) into n from public.quiz_attempts where quiz_id = p_quiz;

  delete from public.quiz_attempts where quiz_id = p_quiz;

  perform public.log_admin('quiz_reset', null, 'اختبار «' || t || '»',
    'حُذفت ' || n || ' محاولة. الدروس التي فُتحت باجتيازه تعود مقفلة.',
    jsonb_build_object('quiz', p_quiz, 'attempts', n));

  return jsonb_build_object('ok', true, 'removed', n,
    'message', 'حُذفت ' || n || ' محاولة. من اجتازته سابقاً تعيد الاختبار.');
end;
$$;

revoke all on function public.admin_reset_quiz_progress(uuid, text) from public;
grant execute on function public.admin_reset_quiz_progress(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- ب) أرقام الخارطة
--
--    ثلاثة أعداد مفصولة، كلها من المنشور:
--      level_remaining      ما بقي في مستواها الحالي ولم تُكمله
--      upcoming_in_plan     دروسٌ باقتها تفتحها، تنتظر تقدّمها
--      upcoming_higher_plan دروسٌ تتطلّب باقة أعلى
--
--    الفصل مقصود: عرض الثاني والثالث رقماً واحداً يَعِد المشتركة
--    بمحتوى لا تفتحه باقتها، وهذا وعدٌ كاذب.
-- ------------------------------------------------------------
create or replace function public.my_map_counts(p_uid uuid default auth.uid())
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
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
        and not public.lesson_unlocked(l.id, p_uid)),
    'upcoming_higher_plan', (
      select count(*) from public.lessons l
      where l.published
        and not public.lesson_tier_ok(l.id, p_uid))
  );
$$;

revoke all on function public.my_map_counts(uuid) from public;
grant execute on function public.my_map_counts(uuid) to authenticated;

notify pgrst, 'reload schema';

-- الأعداد تُطلب بنداء مستقل بجانب my_map: دالة لكل غرض أوضح من
-- حشو الحمولة الكبيرة، والنداءان يمضيان معاً في الواجهة.

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- ج) دليل المبتدئين بنصّ العميلة
--
--    الهجرة ٢٦ بذرت نصّاً مقترحاً. هذه تستبدله بالنصّ المعتمد،
--    **وفقط** إن كانت البطاقات ما تزال بعناوين المقترح حرفياً —
--    فإن عدّلت الإدارة شيئاً منها لم يُمَسّ.
-- ------------------------------------------------------------
do $$
declare untouched boolean;
begin
  select count(*) = 5 into untouched
  from public.guide_steps
  where title in ('ابدئي بدرس واحد كل يوم', 'التطبيق قبل الحفظ', 'تدرّبي على حساب تجريبي أولاً', 'اختبري نفسك بعد كل درس', 'هدفك أن تستغني عن التلقين');

  if untouched then
    delete from public.guide_steps
    where title in ('ابدئي بدرس واحد كل يوم', 'التطبيق قبل الحفظ', 'تدرّبي على حساب تجريبي أولاً', 'اختبري نفسك بعد كل درس', 'هدفك أن تستغني عن التلقين');
  end if;
end $$;

insert into public.guide_steps (title, body, icon, accent, is_goal, sort_order, published)
select * from (values
  ('كل يوم درس جديد', 'ستدرس يومياً درساً جديداً متكاملاً يحتوي على فيديو، نص، وتطبيق عملي لتضمن التطور التدريجي والمستمر.', 'menu_book', 'blue', false, 10, true),
  ('التركيز على التطبيق أولاً', 'التداول مهارة عملية؛ لذا ركز على التطبيق المباشر على الشارت أكثر من الحفظ والتعليم النظري.', 'target', 'green', false, 20, true),
  ('تعلّم بأمان على حساب تجريبي', 'الأخطاء واردة جداً في البداية. استخدم الحساب التجريبي لتتدرب براحتك دون المخاطرة بمالك الحقيقي.', 'shield', 'violet', false, 30, true),
  ('طبّق وشارك تحليلك يومياً', 'التدريب اليومي ضرورة. شارك تحليلاتك لنراجع تقدمك ونصحح أخطاءك أولاً بأول.', 'trending_up', 'amber', false, 40, true),
  ('هدفك: الاستقلالية التامة', 'مع الاستمرار والتصحيح ستصل لمرحلة تعتمد فيها على تحليلك الشخصي وتصنع قراراتك دون توصيات.', 'emoji_events', 'teal', true, 50, true)
) v(title, body, icon, accent, is_goal, sort_order, published)
where not exists (select 1 from public.guide_steps);

notify pgrst, 'reload schema';
