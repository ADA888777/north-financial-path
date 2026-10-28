-- ============================================================
-- نورث للمسار المالي — الهجرة الثامنة
-- لوحة المتعلم: آخر درس، التقدّم، المهام اليومية، سلسلة الاستمرارية
--
-- تُشغَّل بعد 07_content_tree.sql. إضافية بالكامل.
-- لا تمس جداول اللوحة الإدارية.
-- ============================================================

-- التوقيت المعتمد للمشروع. اليوم النشط يُحسب به لا بـ UTC،
-- وإلا لاختلف "اليوم" عن يوم المستخدم فانكسرت السلسلة بلا سبب.
create or replace function public.north_today()
returns date
language sql
stable
as $$ select (now() at time zone 'Asia/Riyadh')::date $$;

grant execute on function public.north_today() to authenticated;

-- ------------------------------------------------------------
-- 1) حالة المتعلم
-- ------------------------------------------------------------
create table if not exists public.learner_state (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  last_lesson_id uuid references public.lessons(id) on delete set null,
  last_seen_at   timestamptz not null default now(),
  streak_days    integer not null default 0,
  longest_streak integer not null default 0,
  last_active_day date
);

create table if not exists public.activity_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null,
  primary key (user_id, day)
);

-- ------------------------------------------------------------
-- 2) المهام اليومية
--    المحتوى تضعه الإدارة. لا تُنشأ مهام افتراضية هنا.
-- ------------------------------------------------------------
create table if not exists public.daily_tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(btrim(title)) > 0),
  description text not null default '',
  link        text,
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.task_completions (
  user_id      uuid not null references auth.users(id) on delete cascade,
  task_id      uuid not null references public.daily_tasks(id) on delete cascade,
  day          date not null,
  completed_at timestamptz not null default now(),
  primary key (user_id, task_id, day)   -- يمنع احتساب المهمة مرتين في اليوم
);

create index if not exists activity_user_idx on public.activity_days (user_id, day desc);
create index if not exists taskc_user_idx    on public.task_completions (user_id, day desc);

-- ------------------------------------------------------------
-- 3) السياسات: كل متعلم صفّه هو فقط
-- ------------------------------------------------------------
alter table public.learner_state    enable row level security;
alter table public.activity_days    enable row level security;
alter table public.daily_tasks      enable row level security;
alter table public.task_completions enable row level security;

drop policy if exists "own state" on public.learner_state;
create policy "own state" on public.learner_state
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "own activity" on public.activity_days;
create policy "own activity" on public.activity_days
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "own completions" on public.task_completions;
create policy "own completions" on public.task_completions
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "read active tasks" on public.daily_tasks;
create policy "read active tasks" on public.daily_tasks
  for select to authenticated using (active or public.is_admin());

drop policy if exists "admin writes tasks" on public.daily_tasks;
create policy "admin writes tasks" on public.daily_tasks
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- الكتابة في حالة المتعلم ونشاطه تمر بالدوال وحدها، فلا سياسات insert/update.

-- ------------------------------------------------------------
-- 4) تسجيل يوم نشط وتحديث السلسلة
--    idempotent: استدعاؤها عشر مرات في اليوم لا يزيد السلسلة إلا مرة.
-- ------------------------------------------------------------
create or replace function public.touch_activity()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  t   date := public.north_today();
  st  record;
  new_streak integer;
begin
  if uid is null then
    return jsonb_build_object('error', 'غير مصرّح');
  end if;

  insert into public.activity_days (user_id, day)
  values (uid, t) on conflict do nothing;

  insert into public.learner_state (user_id, last_seen_at)
  values (uid, now())
  on conflict (user_id) do update set last_seen_at = now();

  select * into st from public.learner_state where user_id = uid;

  if st.last_active_day = t then
    new_streak := st.streak_days;                 -- اليوم محسوب مسبقاً
  elsif st.last_active_day = t - 1 then
    new_streak := st.streak_days + 1;             -- يوم متصل
  else
    new_streak := 1;                              -- انقطعت أو أول يوم
  end if;

  update public.learner_state
  set streak_days     = new_streak,
      longest_streak  = greatest(longest_streak, new_streak),
      last_active_day = t
  where user_id = uid;

  return jsonb_build_object('streak', new_streak, 'today', t);
end;
$$;

revoke all on function public.touch_activity() from public;
grant execute on function public.touch_activity() to authenticated;

-- ------------------------------------------------------------
-- 5) إكمال مهمة اليوم
-- ------------------------------------------------------------
create or replace function public.complete_task(p_task uuid, p_done boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare t date := public.north_today();
begin
  if auth.uid() is null then
    return jsonb_build_object('error', 'غير مصرّح');
  end if;
  if not exists (select 1 from public.daily_tasks where id = p_task and active) then
    return jsonb_build_object('error', 'المهمة غير متاحة');
  end if;

  if p_done then
    insert into public.task_completions (user_id, task_id, day)
    values (auth.uid(), p_task, t) on conflict do nothing;
    perform public.touch_activity();
  else
    delete from public.task_completions
    where user_id = auth.uid() and task_id = p_task and day = t;
  end if;

  return jsonb_build_object('task', p_task, 'completed', p_done, 'day', t);
end;
$$;

revoke all on function public.complete_task(uuid, boolean) from public;
grant execute on function public.complete_task(uuid, boolean) to authenticated;

-- ------------------------------------------------------------
-- 6) set_lesson_done تسجّل اليوم النشط وآخر درس كذلك
-- ------------------------------------------------------------
create or replace function public.set_lesson_done(p_lesson uuid, p_done boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare lid uuid; total integer; done integer;
begin
  if not public.has_active_subscription() then
    return jsonb_build_object('error', 'يتطلب اشتراكاً نافذاً');
  end if;

  select level_id into lid from public.lessons where id = p_lesson and published;
  if not found then
    return jsonb_build_object('error', 'الدرس غير متاح');
  end if;

  if p_done then
    insert into public.lesson_progress (user_id, lesson_id)
    values (auth.uid(), p_lesson) on conflict do nothing;
    perform public.touch_activity();
  else
    delete from public.lesson_progress
    where user_id = auth.uid() and lesson_id = p_lesson;
  end if;

  insert into public.learner_state (user_id, last_lesson_id)
  values (auth.uid(), p_lesson)
  on conflict (user_id) do update set last_lesson_id = p_lesson, last_seen_at = now();

  select count(*) into total from public.lessons
   where published and level_id is not distinct from lid;
  select count(*) into done from public.lesson_progress lp
    join public.lessons l on l.id = lp.lesson_id
   where lp.user_id = auth.uid() and l.published
     and l.level_id is not distinct from lid;

  return jsonb_build_object(
    'completed', p_done, 'done', done, 'total', total,
    'percent', case when total > 0 then round((done::numeric / total) * 100) else 0 end
  );
end;
$$;

-- يسجَّل الدرس كآخر نقطة بمجرد فتحه، لا بإكماله
create or replace function public.mark_lesson_opened(p_lesson uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then return; end if;
  if not exists (select 1 from public.lessons where id = p_lesson and published) then
    return;
  end if;
  insert into public.learner_state (user_id, last_lesson_id)
  values (auth.uid(), p_lesson)
  on conflict (user_id) do update set last_lesson_id = p_lesson, last_seen_at = now();
  perform public.touch_activity();
end;
$$;

revoke all on function public.mark_lesson_opened(uuid) from public;
grant execute on function public.mark_lesson_opened(uuid) to authenticated;

-- ------------------------------------------------------------
-- 7) لوحة المتعلم في نداء واحد
--    كل الأرقام محسوبة من الدروس المنشورة فعلاً، لا قيم ثابتة.
--    auth.uid() هو المرجع الوحيد، فلا يرى أحد تقدّم غيره.
-- ------------------------------------------------------------
create or replace function public.my_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  t   date := public.north_today();
  p   record;
  st  record;
  allowed boolean;
  total_lessons integer;
  done_lessons  integer;
begin
  if uid is null then
    return jsonb_build_object('error', 'غير مصرّح');
  end if;

  select * into p from public.profiles where id = uid;
  select * into st from public.learner_state where user_id = uid;

  allowed := public.has_active_subscription();

  select count(*) into total_lessons from public.lessons where published;
  select count(*) into done_lessons
    from public.lesson_progress lp
    join public.lessons l on l.id = lp.lesson_id
   where lp.user_id = uid and l.published;

  return jsonb_build_object(
    'name', p.full_name,
    'membership_no', p.membership_no,
    'plan', p.plan,
    'account_status', p.status,
    'subscription_status', p.subscription_status,
    'subscription_expires_at', p.subscription_expires_at,
    'allowed', allowed,
    'today', t,

    'streak', coalesce(st.streak_days, 0),
    'longest_streak', coalesce(st.longest_streak, 0),
    'active_today', exists (
      select 1 from public.activity_days where user_id = uid and day = t),

    -- آخر 14 يوماً لخريطة النشاط
    'activity', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day', d::date,
               'active', exists (select 1 from public.activity_days a
                                 where a.user_id = uid and a.day = d::date))
             order by d)
      from generate_series(t - 13, t, interval '1 day') d), '[]'::jsonb),

    'lessons_total', total_lessons,
    'lessons_done',  done_lessons,
    'percent', case when total_lessons > 0
                    then round((done_lessons::numeric / total_lessons) * 100) else 0 end,

    -- آخر درس: نقطة زر «متابعة التعلم»
    'last_lesson', (
      select jsonb_build_object(
        'id', l.id, 'title', l.title, 'level_id', l.level_id,
        'completed', exists (select 1 from public.lesson_progress lp
                             where lp.user_id = uid and lp.lesson_id = l.id))
      from public.lessons l
      where l.id = st.last_lesson_id and l.published),

    -- أول درس غير مكتمل: البديل حين لا توجد نقطة سابقة
    'next_lesson', (
      select jsonb_build_object('id', l.id, 'title', l.title)
      from public.lessons l
      where l.published
        and not exists (select 1 from public.lesson_progress lp
                        where lp.user_id = uid and lp.lesson_id = l.id)
      order by l.sort_order, l.id limit 1),

    -- المستويات التي بدأها، بتقدّم كل مستوى
    'levels', coalesce((
      select jsonb_agg(x order by (x->>'sort_order')::int) from (
        select jsonb_build_object(
          'id', lv.id, 'title', lv.title, 'subtitle', lv.subtitle,
          'sort_order', lv.sort_order,
          'total', (select count(*) from public.lessons l
                    where l.level_id = lv.id and l.published),
          'done', (select count(*) from public.lesson_progress lp
                   join public.lessons l2 on l2.id = lp.lesson_id
                   where lp.user_id = uid and l2.level_id = lv.id and l2.published),
          'quiz_id', (select q.id from public.quizzes q
                      where q.level_id = lv.id and q.published
                      order by q.sort_order limit 1)
        ) as x
        from public.levels lv where lv.published
      ) s), '[]'::jsonb),

    -- الاختبارات المتاحة وحالتها
    'quizzes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'title', q.title, 'level_id', q.level_id,
        'pass_score', q.pass_score,
        'best', (select max(a.percent) from public.quiz_attempts a
                 where a.quiz_id = q.id and a.user_id = uid),
        'passed', exists (select 1 from public.quiz_attempts a
                          where a.quiz_id = q.id and a.user_id = uid and a.passed),
        'attempts', (select count(*) from public.quiz_attempts a
                     where a.quiz_id = q.id and a.user_id = uid)
      ) order by q.sort_order, q.title)
      from public.quizzes q where q.published), '[]'::jsonb),

    -- مهام اليوم وحالتها
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', dt.id, 'title', dt.title, 'description', dt.description, 'link', dt.link,
        'done', exists (select 1 from public.task_completions tc
                        where tc.user_id = uid and tc.task_id = dt.id and tc.day = t)
      ) order by dt.sort_order, dt.title)
      from public.daily_tasks dt where dt.active), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.my_dashboard() from public;
grant execute on function public.my_dashboard() to authenticated;

notify pgrst, 'reload schema';

-- تحقق
select 'daily_tasks' t, count(*) from public.daily_tasks
union all select 'activity_days', count(*) from public.activity_days
union all select 'learner_state', count(*) from public.learner_state;
