-- ============================================================
-- نورث للمسار المالي — الهجرة الخامسة
-- المستويات والدروس والاستراتيجيات والاختبارات والحصص والحجوزات
--
-- تُشغَّل بعد 01 و 02 و 03 و 04. آمنة لإعادة التشغيل.
--
-- مبدأ ثابت في كل ما تحت: المحتوى المدفوع يُقيَّد بـ
-- has_active_subscription() لا بمجرد تسجيل الدخول، والمسودة
-- لا تخرج من قاعدة البيانات أصلاً.
-- ============================================================

-- ------------------------------------------------------------
-- 1) المستويات
-- ------------------------------------------------------------
create table if not exists public.levels (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(btrim(title)) > 0),
  subtitle    text,
  description text not null default '',
  sort_order  integer not null default 0,
  published   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id)
);

create index if not exists levels_public_idx on public.levels (published, sort_order);

alter table public.levels enable row level security;

drop policy if exists "public reads published levels" on public.levels;
create policy "public reads published levels" on public.levels
  for select to anon, authenticated using (published = true);

drop policy if exists "admin manages levels" on public.levels;
create policy "admin manages levels" on public.levels
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop trigger if exists levels_touch on public.levels;
create trigger levels_touch before update on public.levels
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- 2) الدروس والاستراتيجيات
--    free_preview يفتح الدرس للزائر؛ وما عداه يحتاج اشتراكاً نافذاً.
-- ------------------------------------------------------------
create table if not exists public.lessons (
  id           uuid primary key default gen_random_uuid(),
  level_id     uuid references public.levels(id) on delete set null,
  title        text not null check (length(btrim(title)) > 0),
  kind         text not null default 'lesson' check (kind in ('lesson','strategy')),
  summary      text not null default '',
  content      text not null default '',
  video_url    text,
  duration_min integer,
  sort_order   integer not null default 0,
  published    boolean not null default false,
  free_preview boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id)
);

create index if not exists lessons_level_idx on public.lessons (level_id, sort_order);
create index if not exists lessons_public_idx on public.lessons (published, free_preview);

alter table public.lessons enable row level security;

-- الزائر لا يرى إلا الدرس المنشور المعلَّم بأنه عيّنة مجانية
drop policy if exists "public reads free lessons" on public.lessons;
create policy "public reads free lessons" on public.lessons
  for select to anon, authenticated
  using (published = true and free_preview = true);

-- المشترك النافذ يرى كل المنشور
drop policy if exists "subscriber reads lessons" on public.lessons;
create policy "subscriber reads lessons" on public.lessons
  for select to authenticated
  using (published = true and public.has_active_subscription());

drop policy if exists "admin manages lessons" on public.lessons;
create policy "admin manages lessons" on public.lessons
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop trigger if exists lessons_touch on public.lessons;
create trigger lessons_touch before update on public.lessons
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- 3) الاختبارات
--    الأسئلة والأجوبة لا تُقرأ من الـ API إطلاقاً إلا للإدارة.
--    المشترك يأخذ ورقة الاختبار من دالة لا تُرجع الإجابة الصحيحة،
--    والتصحيح يتم داخل القاعدة. فلا ينفع فتح أدوات المطور لرؤية الحل.
-- ------------------------------------------------------------
create table if not exists public.quizzes (
  id          uuid primary key default gen_random_uuid(),
  level_id    uuid references public.levels(id) on delete set null,
  title       text not null check (length(btrim(title)) > 0),
  description text not null default '',
  pass_score  integer not null default 60 check (pass_score between 0 and 100),
  sort_order  integer not null default 0,
  published   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id)
);

create table if not exists public.questions (
  id         uuid primary key default gen_random_uuid(),
  quiz_id    uuid not null references public.quizzes(id) on delete cascade,
  text       text not null check (length(btrim(text)) > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.answers (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  text        text not null check (length(btrim(text)) > 0),
  is_correct  boolean not null default false,
  sort_order  integer not null default 0
);

create index if not exists questions_quiz_idx on public.questions (quiz_id, sort_order);
create index if not exists answers_question_idx on public.answers (question_id, sort_order);

alter table public.quizzes  enable row level security;
alter table public.questions enable row level security;
alter table public.answers   enable row level security;

-- عنوان الاختبار ووصفه للمشترك النافذ فقط
drop policy if exists "subscriber reads quizzes" on public.quizzes;
create policy "subscriber reads quizzes" on public.quizzes
  for select to authenticated
  using (published = true and public.has_active_subscription());

drop policy if exists "admin manages quizzes" on public.quizzes;
create policy "admin manages quizzes" on public.quizzes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- الأسئلة والأجوبة: للإدارة فقط عبر الـ API
drop policy if exists "admin manages questions" on public.questions;
create policy "admin manages questions" on public.questions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manages answers" on public.answers;
create policy "admin manages answers" on public.answers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop trigger if exists quizzes_touch on public.quizzes;
create trigger quizzes_touch before update on public.quizzes
  for each row execute function public.touch_updated_at();

-- ورقة الاختبار بلا إجابات صحيحة
create or replace function public.quiz_paper(quiz uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if not exists (
    select 1 from public.quizzes q
    where q.id = quiz and (q.published = true or public.is_admin())
  ) then
    raise exception 'الاختبار غير موجود';
  end if;

  if not (public.has_active_subscription() or public.is_admin()) then
    raise exception 'هذا الاختبار للمشتركين النافذ اشتراكهم';
  end if;

  select jsonb_build_object(
    'quiz_id', q.id,
    'title', q.title,
    'description', q.description,
    'pass_score', q.pass_score,
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', qq.id,
        'text', qq.text,
        'answers', coalesce((
          select jsonb_agg(jsonb_build_object('id', a.id, 'text', a.text)
                           order by a.sort_order, a.id)
          from public.answers a where a.question_id = qq.id
        ), '[]'::jsonb)
      ) order by qq.sort_order, qq.created_at)
      from public.questions qq where qq.quiz_id = q.id
    ), '[]'::jsonb)
  ) into result
  from public.quizzes q where q.id = quiz;

  return result;
end;
$$;

revoke all on function public.quiz_paper(uuid) from public;
grant execute on function public.quiz_paper(uuid) to authenticated;

-- التصحيح داخل القاعدة: المتصفح يرسل الإجابات المختارة ويستقبل النتيجة فقط
create or replace function public.grade_quiz(quiz uuid, picks uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  total   integer;
  correct integer;
  pass    integer;
begin
  if not exists (
    select 1 from public.quizzes q
    where q.id = quiz and (q.published = true or public.is_admin())
  ) then
    raise exception 'الاختبار غير موجود';
  end if;

  if not (public.has_active_subscription() or public.is_admin()) then
    raise exception 'هذا الاختبار للمشتركين النافذ اشتراكهم';
  end if;

  select count(*) into total from public.questions where quiz_id = quiz;
  select pass_score into pass from public.quizzes where id = quiz;

  select count(*) into correct
  from public.answers a
  join public.questions qq on qq.id = a.question_id
  where qq.quiz_id = quiz and a.is_correct = true and a.id = any(picks);

  return jsonb_build_object(
    'total', total,
    'correct', correct,
    'score', case when total = 0 then 0 else round(correct * 100.0 / total) end,
    'pass_score', pass,
    'passed', case when total = 0 then false
                   else round(correct * 100.0 / total) >= pass end
  );
end;
$$;

revoke all on function public.grade_quiz(uuid, uuid[]) from public;
grant execute on function public.grade_quiz(uuid, uuid[]) to authenticated;

-- ------------------------------------------------------------
-- 4) الحصص والحجوزات
-- ------------------------------------------------------------
create table if not exists public.class_slots (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (length(btrim(title)) > 0),
  description  text not null default '',
  starts_at    timestamptz not null,
  duration_min integer not null default 60 check (duration_min > 0),
  capacity     integer not null default 1 check (capacity > 0),
  meeting_url  text,
  status       text not null default 'scheduled'
               check (status in ('scheduled','cancelled','done')),
  published    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id)
);

create index if not exists class_slots_public_idx on public.class_slots (published, starts_at);

create table if not exists public.bookings (
  id         uuid primary key default gen_random_uuid(),
  slot_id    uuid not null references public.class_slots(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  status     text not null default 'booked' check (status in ('booked','attended','no_show')),
  note       text,
  created_at timestamptz not null default now(),
  unique (slot_id, user_id)
);

create index if not exists bookings_slot_idx on public.bookings (slot_id);
create index if not exists bookings_user_idx on public.bookings (user_id, created_at desc);

alter table public.class_slots enable row level security;
alter table public.bookings    enable row level security;

-- جدول الحصص المنشور معلن؛ رابط الاجتماع يظهر للمحجوز فقط (انظر دالة أدناه)
drop policy if exists "public reads published slots" on public.class_slots;
create policy "public reads published slots" on public.class_slots
  for select to anon, authenticated using (published = true);

drop policy if exists "admin manages slots" on public.class_slots;
create policy "admin manages slots" on public.class_slots
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop trigger if exists class_slots_touch on public.class_slots;
create trigger class_slots_touch before update on public.class_slots
  for each row execute function public.touch_updated_at();

-- المشترك يرى حجوزاته هو فقط
drop policy if exists "read own bookings" on public.bookings;
create policy "read own bookings" on public.bookings
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- الحجز: لنفسه فقط، باشتراك نافذ، على حصة منشورة لم تبدأ ولم تُلغَ
drop policy if exists "book own seat" on public.bookings;
create policy "book own seat" on public.bookings
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.has_active_subscription()
    and exists (
      select 1 from public.class_slots s
      where s.id = slot_id
        and s.published = true
        and s.status = 'scheduled'
        and s.starts_at > now()
    )
  );

-- الإلغاء حذف لصفه هو
drop policy if exists "cancel own booking" on public.bookings;
create policy "cancel own booking" on public.bookings
  for delete to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "admin updates bookings" on public.bookings;
create policy "admin updates bookings" on public.bookings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin inserts bookings" on public.bookings;
create policy "admin inserts bookings" on public.bookings
  for insert to authenticated with check (public.is_admin());

-- سعة الحصة تُفرض في القاعدة لا في الواجهة
create or replace function public.enforce_slot_capacity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cap   integer;
  taken integer;
begin
  select capacity into cap from public.class_slots where id = new.slot_id for update;
  if cap is null then
    raise exception 'الحصة غير موجودة';
  end if;

  select count(*) into taken from public.bookings where slot_id = new.slot_id;
  if taken >= cap then
    raise exception 'اكتمل عدد المقاعد في هذه الحصة';
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_capacity on public.bookings;
create trigger bookings_capacity before insert on public.bookings
  for each row execute function public.enforce_slot_capacity();

-- عدد المقاعد المحجوزة بلا كشف هوية الحاجزين
create or replace function public.slot_seats(slot uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::integer from public.bookings where slot_id = slot;
$$;

revoke all on function public.slot_seats(uuid) from public;
grant execute on function public.slot_seats(uuid) to anon, authenticated;

-- ------------------------------------------------------------
-- 5) تحديث ذاكرة PostgREST
-- ------------------------------------------------------------
notify pgrst, 'reload schema';

-- تحقق
select
  (select count(*) from public.levels)      as المستويات,
  (select count(*) from public.lessons)     as الدروس,
  (select count(*) from public.quizzes)     as الاختبارات,
  (select count(*) from public.class_slots) as الحصص,
  (select count(*) from public.bookings)    as الحجوزات;
