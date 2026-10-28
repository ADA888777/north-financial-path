-- ============================================================
-- نورث للمسار المالي — الهجرة السابعة
-- إكمال هيكل المحتوى فوق الجداول القائمة، ومسار آمن للمتعلم
--
-- تُشغَّل بعد 05_content_and_classes.sql و 05_roles_and_profile.sql.
-- إضافية بالكامل: لا تحذف جدولاً ولا عموداً قائماً.
-- ============================================================

-- ------------------------------------------------------------
-- 1) طبقتا المسار والدورة فوق levels/lessons الموجودتين
--    الأعمدة الجديدة تقبل الفراغ، فالمحتوى القائم يبقى صالحاً.
-- ------------------------------------------------------------
create table if not exists public.tracks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(btrim(title)) > 0),
  description text not null default '',
  level_label text,
  sort_order  integer not null default 0,
  published   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id)
);

alter table public.levels
  add column if not exists track_id uuid references public.tracks(id) on delete set null;

create table if not exists public.courses (
  id          uuid primary key default gen_random_uuid(),
  level_id    uuid references public.levels(id) on delete cascade,
  title       text not null check (length(btrim(title)) > 0),
  description text not null default '',
  sort_order  integer not null default 0,
  published   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id)
);

alter table public.lessons
  add column if not exists course_id uuid references public.courses(id) on delete set null;

-- المفردات
create table if not exists public.vocab (
  id         uuid primary key default gen_random_uuid(),
  lesson_id  uuid not null references public.lessons(id) on delete cascade,
  term       text not null check (length(btrim(term)) > 0),
  meaning    text not null default '',
  sort_order integer not null default 0
);

-- محاولات الاختبار وتقدّم الدروس
create table if not exists public.quiz_attempts (
  id           uuid primary key default gen_random_uuid(),
  quiz_id      uuid not null references public.quizzes(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  score        integer not null default 0,
  max_score    integer not null default 0,
  percent      integer not null default 0,
  passed       boolean not null default false,
  answers      jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now()
);

create table if not exists public.lesson_progress (
  user_id      uuid not null references auth.users(id) on delete cascade,
  lesson_id    uuid not null references public.lessons(id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

-- عدد المحاولات المسموح بها
alter table public.quizzes
  add column if not exists max_attempts integer;

create index if not exists levels_track_idx    on public.levels (track_id, sort_order);
create index if not exists courses_level_idx   on public.courses (level_id, sort_order);
create index if not exists lessons_course_idx  on public.lessons (course_id, sort_order);
create index if not exists vocab_lesson_idx    on public.vocab (lesson_id, sort_order);
create index if not exists attempts_user_idx   on public.quiz_attempts (user_id, quiz_id, submitted_at desc);

drop trigger if exists tracks_touch on public.tracks;
create trigger tracks_touch before update on public.tracks
  for each row execute function public.touch_updated_at();
drop trigger if exists courses_touch on public.courses;
create trigger courses_touch before update on public.courses
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- 2) سياسات الجداول الجديدة
-- ------------------------------------------------------------
alter table public.tracks         enable row level security;
alter table public.courses        enable row level security;
alter table public.vocab          enable row level security;
alter table public.quiz_attempts  enable row level security;
alter table public.lesson_progress enable row level security;

drop policy if exists "read published tracks" on public.tracks;
create policy "read published tracks" on public.tracks
  for select to authenticated using (published or public.is_admin());

drop policy if exists "admin writes tracks" on public.tracks;
create policy "admin writes tracks" on public.tracks
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "read published courses" on public.courses;
create policy "read published courses" on public.courses
  for select to authenticated using (published or public.is_admin());

drop policy if exists "admin writes courses" on public.courses;
create policy "admin writes courses" on public.courses
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "read vocab" on public.vocab;
create policy "read vocab" on public.vocab
  for select to authenticated using (
    public.is_admin() or exists (
      select 1 from public.lessons l where l.id = lesson_id and l.published));

drop policy if exists "admin writes vocab" on public.vocab;
create policy "admin writes vocab" on public.vocab
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- محاولات المتعلم: يقرأ محاولاته هو. الكتابة من submit_quiz وحدها.
drop policy if exists "own attempts" on public.quiz_attempts;
create policy "own attempts" on public.quiz_attempts
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "own progress" on public.lesson_progress;
create policy "own progress" on public.lesson_progress
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- ------------------------------------------------------------
-- 3) مسار المتعلم إلى الاختبار
--    جدولا questions و answers مقصوران على الإدارة، فالمتعلم لا يصل
--    إليهما إطلاقاً. هاتان الدالتان هما طريقه الوحيد، وهما لا تُرجعان
--    is_correct في أي حال.
-- ------------------------------------------------------------
create or replace function public.get_quiz(p_quiz uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare qz record; used integer;
begin
  select * into qz from public.quizzes
  where id = p_quiz and (published or public.is_admin());

  if not found then
    return jsonb_build_object('error', 'الاختبار غير متاح');
  end if;

  if not (public.is_admin() or public.has_active_subscription()) then
    return jsonb_build_object('error', 'يتطلب اشتراكاً نافذاً');
  end if;

  select count(*) into used from public.quiz_attempts
  where quiz_id = p_quiz and user_id = auth.uid();

  return jsonb_build_object(
    'id', qz.id,
    'title', qz.title,
    'description', qz.description,
    'pass_score', qz.pass_score,
    'max_attempts', qz.max_attempts,
    'attempts_used', used,
    'can_attempt', qz.max_attempts is null or used < qz.max_attempts,
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', q.id,
               'text', q.text,
               -- الخيارات بنصّها ومعرّفها فقط، بلا is_correct
               'answers', coalesce((
                 select jsonb_agg(jsonb_build_object('id', a.id, 'text', a.text)
                                  order by a.sort_order, a.id)
                 from public.answers a where a.question_id = q.id), '[]'::jsonb)
             ) order by q.sort_order, q.id)
      from public.questions q where q.quiz_id = qz.id), '[]'::jsonb),
    'last', (select jsonb_build_object('percent', t.percent, 'passed', t.passed,
                                       'submitted_at', t.submitted_at)
             from public.quiz_attempts t
             where t.quiz_id = p_quiz and t.user_id = auth.uid()
             order by t.submitted_at desc limit 1)
  );
end;
$$;

revoke all on function public.get_quiz(uuid) from public;
grant execute on function public.get_quiz(uuid) to authenticated;

-- التصحيح كله على الخادم. المتصفح يرسل اختياراته ويستقبل النتيجة فقط.
create or replace function public.submit_quiz(p_quiz uuid, p_answers jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
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

  return jsonb_build_object(
    'score', earned, 'max_score', total, 'percent', pct,
    'passed', ok, 'pass_score', qz.pass_score,
    'attempts_used', used + 1, 'max_attempts', qz.max_attempts
  );
end;
$$;

revoke all on function public.submit_quiz(uuid, jsonb) from public;
grant execute on function public.submit_quiz(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------
-- 4) الدرس: نصّه وفيديوه لا يخرجان إلا باشتراك نافذ
-- ------------------------------------------------------------
create or replace function public.get_lesson(p_lesson uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare l record; allowed boolean; prev_id uuid; next_id uuid;
begin
  select * into l from public.lessons
  where id = p_lesson and (published or public.is_admin());

  if not found then
    return jsonb_build_object('error', 'الدرس غير متاح');
  end if;

  allowed := public.is_admin() or public.has_active_subscription() or l.free_preview;

  select id into prev_id from public.lessons
   where published and level_id is not distinct from l.level_id
     and (sort_order, id) < (l.sort_order, l.id)
   order by sort_order desc, id desc limit 1;

  select id into next_id from public.lessons
   where published and level_id is not distinct from l.level_id
     and (sort_order, id) > (l.sort_order, l.id)
   order by sort_order asc, id asc limit 1;

  return jsonb_build_object(
    'id', l.id, 'title', l.title, 'kind', l.kind,
    'level_id', l.level_id, 'course_id', l.course_id,
    'allowed', allowed, 'free_preview', l.free_preview,
    'duration_min', l.duration_min,
    'content',   case when allowed then l.content   else null end,
    'summary',   case when allowed then l.summary   else null end,
    'video_url', case when allowed then l.video_url else null end,
    'vocab', case when allowed then coalesce((
        select jsonb_agg(jsonb_build_object('term', v.term, 'meaning', v.meaning)
                         order by v.sort_order, v.term)
        from public.vocab v where v.lesson_id = l.id), '[]'::jsonb) else '[]'::jsonb end,
    'quiz_id', (select q.id from public.quizzes q
                where q.level_id = l.level_id and q.published
                order by q.sort_order limit 1),
    'completed', exists (select 1 from public.lesson_progress lp
                         where lp.lesson_id = l.id and lp.user_id = auth.uid()),
    'prev_id', prev_id, 'next_id', next_id
  );
end;
$$;

revoke all on function public.get_lesson(uuid) from public;
grant execute on function public.get_lesson(uuid) to authenticated;

-- ------------------------------------------------------------
-- 5) التقدّم
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
  else
    delete from public.lesson_progress
    where user_id = auth.uid() and lesson_id = p_lesson;
  end if;

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

revoke all on function public.set_lesson_done(uuid, boolean) from public;
grant execute on function public.set_lesson_done(uuid, boolean) to authenticated;

-- قائمة المستويات مع تقدّم المتعلم في كل مستوى
create or replace function public.my_levels()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(x order by x->>'sort_order'), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', lv.id, 'title', lv.title, 'subtitle', lv.subtitle,
      'description', lv.description, 'sort_order', lv.sort_order,
      'lessons', (select count(*) from public.lessons l
                  where l.level_id = lv.id and l.published),
      'done', (select count(*) from public.lesson_progress lp
               join public.lessons l2 on l2.id = lp.lesson_id
               where lp.user_id = auth.uid() and l2.level_id = lv.id and l2.published),
      'quiz_id', (select q.id from public.quizzes q
                  where q.level_id = lv.id and q.published
                  order by q.sort_order limit 1)
    ) as x
    from public.levels lv
    where lv.published
  ) s;
$$;

revoke all on function public.my_levels() from public;
grant execute on function public.my_levels() to authenticated;

notify pgrst, 'reload schema';

-- تحقق
select 'tracks' t, count(*) from public.tracks
union all select 'courses', count(*) from public.courses
union all select 'vocab', count(*) from public.vocab
union all select 'quiz_attempts', count(*) from public.quiz_attempts
union all select 'lesson_progress', count(*) from public.lesson_progress;
