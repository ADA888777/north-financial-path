-- ============================================================
-- ٥٥) التدرّج بلا استثناء: مرحلةٌ تُنهى ثم تُفتح التي بعدها
--
-- الخارطة كانت تعرض لحساب الإدارة كل الدروس «اضغط لفتح الدرس»:
-- lesson_unlocked وlevel_unlocked تبدآن بـ«الأدمن؟ فمفتوح». وتلك
-- الدالتان ليستا باب المحتوى وحده — هما قاعدة التدرّج التي تقرؤها
-- الخارطة وصفحة الدروس والرئيسية. فمن تفحص المنصّة بحسابها ترى
-- طريقاً مفتوحاً كلّه لا يشبه ما تراه العميلة.
--
-- صار الفصل واضحاً:
--   • lesson_unlocked / level_unlocked = القاعدة وحدها، للجميع:
--     الدرس يُفتح بإنهاء ما قبله (واجتياز اختباره ١٠٠٪ إن كان له
--     اختبار)، والمستوى يُفتح بإنهاء ما قبله. ولا شيء غير ذلك.
--   • أبواب المحتوى (get_lesson، get_quiz، set_lesson_done، وسياسة
--     الفيديو، وsubmit_quiz) تقول «الإدارة أو مفتوحٌ بالقاعدة» —
--     فالإدارة تراجع أي درسٍ من رابطه، دون أن تتغيّر الخارطة.
--
-- لا يُمسّ تقدّمٌ مسجَّل ولا اختبار.
-- الهجرة idempotent.
-- ============================================================

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
  -- لا استثناء للإدارة هنا: هذه قاعدة التدرّج نفسها، والخارطة
  -- وصفحة الدروس تقرآنها. الإدارة تفتح أي درسٍ من أبواب المحتوى
  -- (get_lesson وأخواتها) لا من هنا — فترى الطريق كما تراه العميلة.

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
  -- لا استثناء للإدارة: الاستثناء في أبواب المحتوى وحدها.

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

  -- الإدارة تفتح أي درسٍ للمراجعة؛ والقفل نفسه يبقى قاعدةً للعميلة
  ok := public.is_admin() or public.lesson_unlocked(p_lesson, uid);

  return jsonb_build_object(
    'id', l.id, 'title', l.title, 'kind', l.kind,
    'level_id', l.level_id, 'week_no', l.week_no,

    -- رأس الصفحة: اسم المستوى ورمزه، وترتيب الدرس فيه وعددها.
    -- يُحسب هنا لا في الواجهة: الترتيب نفسه الذي تمشي عليه الخارطة
    -- (الأسبوع ثم الترتيب ثم المعرّف)، فنسختان منه تفترقان.
    'level_title', (select lv.title from public.levels lv where lv.id = l.level_id),
    'level_code',  (select lv.code  from public.levels lv where lv.id = l.level_id),
    'lesson_no', (select count(*) from public.lessons ls
                  where ls.published
                    and ls.level_id is not distinct from l.level_id
                    and (ls.week_no, ls.sort_order, ls.id)
                        <= (l.week_no, l.sort_order, l.id)),
    'level_lessons', (select count(*) from public.lessons ls
                      where ls.published
                        and ls.level_id is not distinct from l.level_id),
    'duration_min', l.duration_min, 'free_preview', l.free_preview,
    'allowed', ok, 'unlocked', ok,
    'tier_ok', public.lesson_tier_ok(p_lesson, uid),
    'required_plan', public.lesson_required_plan(p_lesson),
    'locked_reason', public.lesson_lock_reason(p_lesson, uid),

    -- المحتوى لا يخرج من القاعدة أصلاً لمن لا يملكه
    'content',  case when ok then l.content  else null end,
    'summary',  case when ok then l.summary  else null end,
    'video_url',case when ok then l.video_url else null end,
    'video_path',case when ok then l.video_path else null end,
    'course_id',case when ok then l.course_id else null end,

    'completed', exists (select 1 from public.lesson_progress lp
                         where lp.lesson_id = l.id and lp.user_id = uid),
    -- خلل من الهجرة ٢٥: كانت تقرأ lesson_spots.seconds، وهو عمود
    -- لا وجود له — الجدول فيه pos. فكانت get_lesson ترفع خطأ عند
    -- كل فتح درس، وتموت الصفحة كلها. العمود الصحيح، والصفر بدل
    -- الفراغ كما في الهجرة ٢٢.
    'spot', coalesce((select s.pos from public.lesson_spots s
                      where s.lesson_id = l.id and s.user_id = uid), 0),
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

create or replace function public.get_quiz(p_quiz uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare q record; tries integer;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'غير مصرّح'); end if;

  select * into q from public.quizzes where id = p_quiz and (published or public.is_admin());
  if not found then return jsonb_build_object('error', 'الاختبار غير متاح'); end if;

  if not (public.is_admin() or public.has_active_subscription()) then
    return jsonb_build_object('error', 'الاشتراك غير نشط');
  end if;

  if not public.is_admin() and q.lesson_id is not null
     and not public.lesson_unlocked(q.lesson_id) then
    return jsonb_build_object('error',
      coalesce(public.lesson_lock_reason(q.lesson_id), 'الدرس لم يُفتح بعد'));
  end if;

  if not public.is_admin() and q.lesson_id is null and q.level_id is not null
     and not public.level_unlocked(q.level_id) then
    return jsonb_build_object('error', 'المرحلة لم تُفتح بعد');
  end if;

  select count(*) into tries from public.quiz_attempts
   where quiz_id = p_quiz and user_id = auth.uid();

  if q.max_attempts is not null and tries >= q.max_attempts then
    return jsonb_build_object('error',
      'استنفدت محاولاتك في هذا الاختبار (' || q.max_attempts || ').');
  end if;

  return jsonb_build_object(
    'id', q.id, 'title', q.title, 'description', q.description,
    'pass_score', q.pass_score, 'lesson_id', q.lesson_id, 'level_id', q.level_id,
    'max_attempts', q.max_attempts, 'attempts', tries,
    -- is_correct لا يخرج من هنا إطلاقاً
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', qq.id, 'text', qq.text,
        'answers', coalesce((
          select jsonb_agg(jsonb_build_object('id', a.id, 'text', a.text)
                           order by a.sort_order, a.id)
          from public.answers a where a.question_id = qq.id), '[]'::jsonb))
        order by qq.sort_order, qq.id)
      from public.questions qq where qq.quiz_id = q.id), '[]'::jsonb));
end;
$$;


revoke all on function public.get_quiz(uuid) from public;
grant execute on function public.get_quiz(uuid) to authenticated;

create or replace function public.set_lesson_done(p_lesson uuid, p_done boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); l record;
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;

  select id, level_id, published, free_preview into l
  from public.lessons where id = p_lesson;

  if not found or not l.published then
    return jsonb_build_object('error', 'الدرس غير متاح');
  end if;

  if not (public.is_admin() or public.has_active_subscription()) then
    return jsonb_build_object('error', 'الاشتراك غير نشط');
  end if;

  -- إلغاء الإنهاء مسموح دائماً؛ التسجيل وحده يفتح ما بعده.
  if p_done and not public.is_admin() and not public.lesson_unlocked(p_lesson, uid) then
    return jsonb_build_object('error',
      coalesce(public.lesson_lock_reason(p_lesson, uid), 'الدرس لم يُفتح بعد'));
  end if;

  if p_done then
    insert into public.lesson_progress (user_id, lesson_id)
    values (uid, p_lesson) on conflict (user_id, lesson_id) do nothing;
  else
    delete from public.lesson_progress where user_id = uid and lesson_id = p_lesson;
  end if;

  perform public.touch_activity();
  return jsonb_build_object('ok', true, 'done', p_done);
end;
$$;


revoke all on function public.set_lesson_done(uuid, boolean) from public;
grant execute on function public.set_lesson_done(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
