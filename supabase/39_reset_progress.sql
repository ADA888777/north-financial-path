-- ============================================================
-- ٣٩) تصفير تقدّم عضوة من لوحة الإدارة
--
-- نسبة التقدّم تُحسب من الدروس المنجزة ولا تُكتب يدوياً: ١ من ١٥
-- تعني ٧٪ ولا سبيل لجعلها صفراً إلا بحذف ما أُنجز. وبعد التجارب
-- يبقى على حساب الإدارة تقدّمٌ لم يصنعه متعلّم.
--
-- يُحذف: الدروس المنجزة، ومواضع التوقف، ومحاولات الاختبارات.
-- وبحذفها تعود الدروس مقفلةً كما كانت — فالقفل محسوب من هذه
-- الصفوف لا مخزَّن في عمود.
--
-- لا يُحذف: الاشتراك، والباقة، والحجوزات، والتقييمات، والإشعارات.
-- «تصفير التقدّم» غير «حذف الحساب»، والخلط بينهما يفقد ما لا
-- يُسترجع.
-- ============================================================

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
begin
  p := public.admin_target(p_user);

  select count(*) into n_les  from public.lesson_progress where user_id = p_user;
  select count(*) into n_spot from public.lesson_spots    where user_id = p_user;
  select count(*) into n_quiz from public.quiz_attempts   where user_id = p_user;

  if n_les + n_spot + n_quiz = 0 then
    return jsonb_build_object('ok', true, 'unchanged', true,
      'message', 'لا تقدّم مسجّل لهذه العضوة أصلاً.');
  end if;

  delete from public.lesson_progress where user_id = p_user;
  delete from public.lesson_spots    where user_id = p_user;
  delete from public.quiz_attempts   where user_id = p_user;

  perform public.log_admin(
    'progress_reset', p_user,
    coalesce(p.full_name, p.email, p.membership_no),
    'حُذف ' || n_les || ' درساً منجزاً و' || n_quiz || ' محاولة اختبار. ' ||
    'تعود الدروس مقفلةً من أولها.',
    jsonb_build_object('lessons', n_les, 'spots', n_spot, 'quizzes', n_quiz));

  return jsonb_build_object('ok', true,
    'lessons', n_les, 'spots', n_spot, 'quizzes', n_quiz,
    'message', 'صُفِّر التقدّم: ' || n_les || ' درساً و' || n_quiz || ' محاولة اختبار.');
end;
$fn$;

revoke all on function public.admin_reset_member_progress(uuid) from public;
grant execute on function public.admin_reset_member_progress(uuid) to authenticated;

notify pgrst, 'reload schema';
