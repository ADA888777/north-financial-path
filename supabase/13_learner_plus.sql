-- ============================================================
-- نورث للمسار المالي — الهجرة الثالثة عشرة
-- خارطة التقدم وقفل المراحل، التحدي اليومي، نوع الحصة،
-- موضع المتابعة في الدرس، ودليل المبتدئين.
--
-- تُشغَّل بعد 12. إضافية بالكامل: لا تحذف جدولاً ولا عموداً.
-- ============================================================

-- ------------------------------------------------------------
-- 1) حقول إضافية على جداول قائمة
-- ------------------------------------------------------------

-- نوع الحصة: مباشرة جماعية أم كلاس خاص. الافتراضي «خاص» حتى لا يتغيّر
-- تصنيف الحصص المُدخلة قبل هذه الهجرة من تلقاء نفسه.
alter table public.class_slots
  add column if not exists kind text not null default 'private';

do $$ begin
  alter table public.class_slots
    add constraint class_slots_kind_chk check (kind in ('live', 'private'));
exception when duplicate_object then null; end $$;

create index if not exists class_slots_kind_idx
  on public.class_slots (kind, published, starts_at);

-- دليل المبتدئين: المسارات التي تعلّمها الإدارة كمناسبة لمن يبدأ.
alter table public.tracks
  add column if not exists for_beginners boolean not null default false;

-- ------------------------------------------------------------
-- 2) موضع المتابعة داخل الدرس
--    «تابع التعلم» يرجع إلى حيث وقف المتعلم لا إلى أول الدرس.
--    الموضع نسبة مئوية من طول الدرس: رقم واحد يكفي ولا يكشف شيئاً.
-- ------------------------------------------------------------
create table if not exists public.lesson_spots (
  user_id    uuid not null references auth.users(id) on delete cascade,
  lesson_id  uuid not null references public.lessons(id) on delete cascade,
  pos        integer not null default 0 check (pos between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

alter table public.lesson_spots enable row level security;

drop policy if exists "own spots" on public.lesson_spots;
create policy "own spots" on public.lesson_spots
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ------------------------------------------------------------
-- 3) قاعدة فتح المراحل
--    المرحلة تُفتح بإنهاء دروس المرحلة التي قبلها واجتياز اختبارها.
--    هذه الدالة هي المرجع: كل ما يعرض محتوى أو يسجّل تقدماً يستشيرها.
-- ------------------------------------------------------------
create or replace function public.level_unlocked(p_level uuid, p_uid uuid default auth.uid())
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
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

  -- المرحلة السابقة داخل المسار نفسه. أول مرحلة لا سابق لها فهي مفتوحة.
  select l.id, l.sort_order into prev
  from public.levels l
  where l.published
    and l.track_id is not distinct from lv.track_id
    and (l.sort_order, l.id) < (lv.sort_order, lv.id)
  order by l.sort_order desc, l.id desc
  limit 1;

  if not found then return true; end if;

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

  select q.id into prev_quiz
  from public.quizzes q
  where q.level_id = prev.id and q.published
  order by q.sort_order limit 1;

  -- مرحلة بلا اختبار منشور: إنهاء دروسها يكفي.
  if prev_quiz is null then return true; end if;

  return exists (
    select 1 from public.quiz_attempts a
    where a.quiz_id = prev_quiz and a.user_id = p_uid and a.passed
  );
end;
$$;

revoke all on function public.level_unlocked(uuid, uuid) from public;
grant execute on function public.level_unlocked(uuid, uuid) to authenticated;

-- إنجاز المرحلة: كل دروسها المنشورة مكتملة، واختبارها مُجتاز إن وُجد.
-- تعريف واحد تستعمله الخارطة واللوحة وقاعدة الفتح، فلا تفترق الأرقام.
create or replace function public.level_cleared(p_level uuid, p_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with tot as (
    select count(*)::int n from public.lessons
    where level_id = p_level and published),
  dn as (
    select count(*)::int n from public.lessons l
    join public.lesson_progress lp on lp.lesson_id = l.id and lp.user_id = p_uid
    where l.level_id = p_level and l.published),
  qz as (
    select q.id from public.quizzes q
    where q.level_id = p_level and q.published
    order by q.sort_order limit 1)
  select tot.n > 0 and dn.n >= tot.n
         and (not exists (select 1 from qz)
              or exists (select 1 from public.quiz_attempts a, qz
                         where a.quiz_id = qz.id and a.user_id = p_uid and a.passed))
  from tot, dn;
$$;

revoke all on function public.level_cleared(uuid, uuid) from public;
grant execute on function public.level_cleared(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- 4) فرض القفل حيث يُقرأ المحتوى ويُسجّل التقدم
--    إخفاء الزر ليس قفلاً. هذه الدوال هي الحد الفعلي.
-- ------------------------------------------------------------
create or replace function public.get_lesson(p_lesson uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare l record; allowed boolean; unlocked boolean; prev_id uuid; next_id uuid;
begin
  select * into l from public.lessons
  where id = p_lesson and (published or public.is_admin());

  if not found then
    return jsonb_build_object('error', 'الدرس غير متاح');
  end if;

  unlocked := l.level_id is null or public.level_unlocked(l.level_id);

  -- الدرس التعريفي يبقى مفتوحاً للزائر كما كان، والاشتراك وحده لا يكفي
  -- لدخول مرحلة لم تُفتح بعد.
  allowed := public.is_admin()
             or l.free_preview
             or (public.has_active_subscription() and unlocked);

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
    'unlocked', unlocked,
    'locked_reason', case when not unlocked
      then 'أكمل دروس المرحلة السابقة واجتز اختبارها لفتح هذه المرحلة.'
      else null end,
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
    'spot', coalesce((select s.pos from public.lesson_spots s
                      where s.lesson_id = l.id and s.user_id = auth.uid()), 0),
    'prev_id', prev_id, 'next_id', next_id
  );
end;
$$;

revoke all on function public.get_lesson(uuid) from public;
grant execute on function public.get_lesson(uuid) to anon, authenticated;

-- تسجيل إنهاء درس في مرحلة مقفلة يفتح ما بعدها. يُمنع من الخادم.
create or replace function public.set_lesson_done(p_lesson uuid, p_done boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); l record;
begin
  if uid is null then
    return jsonb_build_object('error', 'غير مصرّح');
  end if;

  select id, level_id, published, free_preview into l
  from public.lessons where id = p_lesson;

  if not found or not l.published then
    return jsonb_build_object('error', 'الدرس غير متاح');
  end if;

  if not (public.is_admin() or public.has_active_subscription()) then
    return jsonb_build_object('error', 'الاشتراك غير نشط');
  end if;

  if l.level_id is not null and not public.level_unlocked(l.level_id, uid) then
    return jsonb_build_object('error', 'المرحلة لم تُفتح بعد');
  end if;

  if p_done then
    insert into public.lesson_progress (user_id, lesson_id)
    values (uid, p_lesson)
    on conflict (user_id, lesson_id) do nothing;
  else
    delete from public.lesson_progress
    where user_id = uid and lesson_id = p_lesson;
  end if;

  perform public.touch_activity();
  return jsonb_build_object('ok', true, 'done', p_done);
end;
$$;

revoke all on function public.set_lesson_done(uuid, boolean) from public;
grant execute on function public.set_lesson_done(uuid, boolean) to authenticated;

-- حفظ موضع القراءة
create or replace function public.save_lesson_spot(p_lesson uuid, p_pos integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;
  if p_pos is null or p_pos < 0 then p_pos := 0; end if;
  if p_pos > 100 then p_pos := 100; end if;

  if not exists (select 1 from public.lessons where id = p_lesson and published) then
    return jsonb_build_object('error', 'الدرس غير متاح');
  end if;

  insert into public.lesson_spots (user_id, lesson_id, pos, updated_at)
  values (uid, p_lesson, p_pos, now())
  on conflict (user_id, lesson_id)
  do update set pos = excluded.pos, updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.save_lesson_spot(uuid, integer) from public;
grant execute on function public.save_lesson_spot(uuid, integer) to authenticated;

-- ------------------------------------------------------------
-- 5) خارطة التقدم
--    لكل مرحلة حالة واحدة: مكتملة، أو حالية، أو مفتوحة، أو مقفلة.
--    الحالة محسوبة من تقدم المتعلم لا من حقل يُكتب يدوياً.
-- ------------------------------------------------------------
create or replace function public.my_map()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); res jsonb; cur uuid;
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;

  -- المرحلة الحالية: أول مرحلة مفتوحة لم تُنجَز بعد. وإنجازها إنهاء
  -- دروسها واجتياز اختبارها إن وُجد — لا الدروس وحدها، وإلا ظهرت
  -- مرحلةٌ بانتظار اختبارها كأنها انتهت.
  select lv.id into cur
  from public.levels lv
  where lv.published
    and public.level_unlocked(lv.id, uid)
    and not public.level_cleared(lv.id, uid)
  order by lv.sort_order, lv.title
  limit 1;

  select coalesce(jsonb_agg(t order by t_sort, t_title), '[]'::jsonb) into res
  from (
    select
      coalesce(tr.sort_order, 9999) as t_sort,
      coalesce(tr.title, 'بلا مسار') as t_title,
      jsonb_build_object(
        'track_id', tr.id,
        'track', coalesce(tr.title, 'بلا مسار'),
        'for_beginners', coalesce(tr.for_beginners, false),
        'levels', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', lv.id,
            'title', lv.title,
            'subtitle', lv.subtitle,
            'total', tot.n,
            'done', dn.n,
            'percent', case when tot.n > 0
                            then round(dn.n * 100.0 / tot.n)::int else 0 end,
            'quiz_id', qz.id,
            'quiz_passed', qz.id is not null and exists (
              select 1 from public.quiz_attempts a
              where a.quiz_id = qz.id and a.user_id = uid and a.passed),
            'unlocked', public.level_unlocked(lv.id, uid),
            'state', case
              when not public.level_unlocked(lv.id, uid) then 'locked'
              when public.level_cleared(lv.id, uid) then 'done'
              when lv.id = cur then 'current'
              else 'open' end,
            'first_lesson', (select l.id from public.lessons l
                             where l.level_id = lv.id and l.published
                             order by l.sort_order, l.title limit 1),
            'next_lesson', (select l.id from public.lessons l
                            where l.level_id = lv.id and l.published
                              and not exists (select 1 from public.lesson_progress lp
                                              where lp.lesson_id = l.id and lp.user_id = uid)
                            order by l.sort_order, l.title limit 1)
          ) order by lv.sort_order, lv.title)
          from public.levels lv
          cross join lateral (
            select count(*)::int n from public.lessons l
            where l.level_id = lv.id and l.published) tot
          cross join lateral (
            select count(*)::int n from public.lessons l
            join public.lesson_progress lp on lp.lesson_id = l.id and lp.user_id = uid
            where l.level_id = lv.id and l.published) dn
          left join lateral (
            select q.id from public.quizzes q
            where q.level_id = lv.id and q.published
            order by q.sort_order limit 1) qz on true
          where lv.published and lv.track_id is not distinct from tr.id
        ), '[]'::jsonb)
      ) as t
    from public.tracks tr
    where tr.published
    union all
    select 9999, 'بلا مسار',
      jsonb_build_object('track_id', null, 'track', 'دروس عامة', 'for_beginners', false,
        'levels', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', lv.id, 'title', lv.title, 'subtitle', lv.subtitle,
            'total', (select count(*) from public.lessons l where l.level_id = lv.id and l.published),
            'done', (select count(*) from public.lessons l
                     join public.lesson_progress lp on lp.lesson_id = l.id and lp.user_id = uid
                     where l.level_id = lv.id and l.published),
            'percent', 0, 'quiz_id', null, 'quiz_passed', false,
            'unlocked', public.level_unlocked(lv.id, uid),
            'state', case when public.level_unlocked(lv.id, uid) then 'open' else 'locked' end,
            'first_lesson', (select l.id from public.lessons l
                             where l.level_id = lv.id and l.published
                             order by l.sort_order limit 1),
            'next_lesson', (select l.id from public.lessons l
                            where l.level_id = lv.id and l.published
                              and not exists (select 1 from public.lesson_progress lp
                                              where lp.lesson_id = l.id and lp.user_id = uid)
                            order by l.sort_order limit 1)
          ) order by lv.sort_order, lv.title)
          from public.levels lv where lv.published and lv.track_id is null
        ), '[]'::jsonb))
    where exists (select 1 from public.levels where published and track_id is null)
  ) q;

  return jsonb_build_object('current_level', cur, 'tracks', res);
end;
$$;

revoke all on function public.my_map() from public;
grant execute on function public.my_map() to authenticated;

-- ------------------------------------------------------------
-- 6) دليل المبتدئين
--    خطوات من محتوى المنصة نفسه: المسارات المعلّمة للمبتدئين،
--    وأول مرحلة ودرس في كل منها. لا نص مكتوب في الواجهة.
-- ------------------------------------------------------------
create or replace function public.beginner_guide()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'track_id', tr.id,
      'title', tr.title,
      'description', tr.description,
      'level_label', tr.level_label,
      'lessons', (select count(*) from public.lessons l
                  join public.levels lv on lv.id = l.level_id
                  where lv.track_id = tr.id and l.published and lv.published),
      'first_level', (select lv.id from public.levels lv
                      where lv.track_id = tr.id and lv.published
                      order by lv.sort_order, lv.title limit 1),
      'first_lesson', (select l.id from public.lessons l
                       join public.levels lv on lv.id = l.level_id
                       where lv.track_id = tr.id and lv.published and l.published
                       order by lv.sort_order, l.sort_order limit 1)
    ) order by tr.sort_order, tr.title), '[]'::jsonb)
  from public.tracks tr
  where tr.published and tr.for_beginners;
$$;

revoke all on function public.beginner_guide() from public;
grant execute on function public.beginner_guide() to anon, authenticated;

-- ------------------------------------------------------------
-- 7) التحدي اليومي
--    ثلاثة أسئلة كل يوم من بنك أسئلة الاختبارات المنشورة، ضمن
--    المراحل المفتوحة للمتعلم وحدها. لا محتوى جديد يُطلب من الإدارة.
--
--    الاختيار ثابت لكل (متعلم، يوم): ترتيب بالبصمة لا بالعشوائية،
--    وإلا تبدّلت الأسئلة كلما أُعيد تحميل الصفحة.
-- ------------------------------------------------------------
create table if not exists public.challenge_answers (
  user_id     uuid not null references auth.users(id) on delete cascade,
  day         date not null,
  question_id uuid not null references public.questions(id) on delete cascade,
  answer_id   uuid references public.answers(id) on delete set null,
  correct     boolean not null default false,
  answered_at timestamptz not null default now(),
  primary key (user_id, day, question_id)
);

create index if not exists challenge_user_day_idx
  on public.challenge_answers (user_id, day);

alter table public.challenge_answers enable row level security;

drop policy if exists "own challenge" on public.challenge_answers;
create policy "own challenge" on public.challenge_answers
  for select to authenticated using (user_id = auth.uid());

-- لا سياسة إدراج: الإدراج يمرّ بدالة التصحيح وحدها، وإلا كتب المتعلم
-- correct = true بنفسه.

create or replace function public.challenge_pick(p_uid uuid, p_day date, p_n integer default 3)
returns table (question_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select q.id
  from public.questions q
  join public.quizzes z on z.id = q.quiz_id and z.published
  where z.level_id is null or public.level_unlocked(z.level_id, p_uid)
  order by md5(q.id::text || p_uid::text || p_day::text)
  limit greatest(1, p_n);
$$;

revoke all on function public.challenge_pick(uuid, date, integer) from public;

create or replace function public.my_challenge()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); t date := public.north_today(); qs jsonb; n_done int; n_ok int;
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;
  if not (public.is_admin() or public.has_active_subscription()) then
    return jsonb_build_object('error', 'الاشتراك غير نشط');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', q.id,
      'text', q.text,
      'quiz', z.title,
      -- الإجابة المحفوظة تُعرض بعد الإجابة فقط، والصواب لا يُرسل قبلها.
      'answered', ca.question_id is not null,
      'chosen', ca.answer_id,
      'correct', case when ca.question_id is not null then ca.correct else null end,
      'correct_id', case when ca.question_id is not null then
          (select a2.id from public.answers a2 where a2.question_id = q.id and a2.is_correct limit 1)
        else null end,
      'answers', coalesce((
        select jsonb_agg(jsonb_build_object('id', a.id, 'text', a.text)
                         order by a.sort_order, a.id)
        from public.answers a where a.question_id = q.id), '[]'::jsonb)
    ) order by q.id), '[]'::jsonb) into qs
  from public.challenge_pick(uid, t, 3) p
  join public.questions q on q.id = p.question_id
  join public.quizzes z on z.id = q.quiz_id
  left join public.challenge_answers ca
    on ca.user_id = uid and ca.day = t and ca.question_id = q.id;

  select count(*), count(*) filter (where correct) into n_done, n_ok
  from public.challenge_answers
  where user_id = uid and day = t;

  return jsonb_build_object(
    'day', t,
    'questions', qs,
    'answered', n_done,
    'correct', n_ok,
    'total', jsonb_array_length(qs),
    'streak', coalesce((select streak_days from public.learner_state where user_id = uid), 0),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'correct', d.ok, 'total', d.n)
                       order by d.day)
      from (select day, count(*) n, count(*) filter (where correct) ok
            from public.challenge_answers
            where user_id = uid and day > t - 30
            group by day) d), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.my_challenge() from public;
grant execute on function public.my_challenge() to authenticated;

-- التصحيح في الخادم. الواجهة لا ترى is_correct قبل الإجابة، ولا تكتب
-- النتيجة بنفسها، ولا تُعيد الإجابة على سؤال أُجيب اليوم.
create or replace function public.answer_challenge(p_question uuid, p_answer uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); t date := public.north_today();
        ok boolean; right_id uuid;
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;
  if not (public.is_admin() or public.has_active_subscription()) then
    return jsonb_build_object('error', 'الاشتراك غير نشط');
  end if;

  -- السؤال يجب أن يكون من أسئلة اليوم لهذا المتعلم بالذات.
  if not exists (select 1 from public.challenge_pick(uid, t, 3) p
                 where p.question_id = p_question) then
    return jsonb_build_object('error', 'السؤال ليس ضمن تحدي اليوم');
  end if;

  if exists (select 1 from public.challenge_answers
             where user_id = uid and day = t and question_id = p_question) then
    return jsonb_build_object('error', 'أُجيب هذا السؤال اليوم');
  end if;

  if p_answer is not null
     and not exists (select 1 from public.answers
                     where id = p_answer and question_id = p_question) then
    return jsonb_build_object('error', 'إجابة غير صالحة');
  end if;

  select a.is_correct into ok from public.answers a where a.id = p_answer;
  ok := coalesce(ok, false);

  select a.id into right_id from public.answers a
  where a.question_id = p_question and a.is_correct limit 1;

  insert into public.challenge_answers (user_id, day, question_id, answer_id, correct)
  values (uid, t, p_question, p_answer, ok);

  perform public.touch_activity();

  return jsonb_build_object('ok', true, 'correct', ok, 'correct_id', right_id);
end;
$$;

revoke all on function public.answer_challenge(uuid, uuid) from public;
grant execute on function public.answer_challenge(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- 8) ما تحتاجه اللوحة زيادةً على my_dashboard
--    دالة مستقلة لا نسخة ثانية من my_dashboard: نسختان من منطق واحد
--    تفترقان مع أول تعديل، فتعرض اللوحة رقماً والخارطة رقماً آخر.
-- ------------------------------------------------------------
create or replace function public.my_learn_extra()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  t   date := public.north_today();
  wk_start date;
  cur record;
  sp  record;
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;

  -- الأسبوع يبدأ السبت. extract(dow) يجعل الأحد صفراً، فالسبت هو 6.
  wk_start := t - ((extract(dow from t)::int + 1) % 7);

  -- المرحلة الحالية: أول مرحلة مفتوحة لم تُنجَز بعد (نفس تعريف الخارطة).
  select lv.id, lv.title, lv.subtitle, tr.title as track, tr.level_label
  into cur
  from public.levels lv
  left join public.tracks tr on tr.id = lv.track_id
  where lv.published
    and public.level_unlocked(lv.id, uid)
    and not public.level_cleared(lv.id, uid)
  order by lv.sort_order, lv.title
  limit 1;

  -- موضع المتابعة: آخر درس تُرك فيه أثر، مكتملاً كان أو لا.
  select l.id, l.title, l.level_id, s.pos
  into sp
  from public.lesson_spots s
  join public.lessons l on l.id = s.lesson_id and l.published
  where s.user_id = uid
  order by s.updated_at desc
  limit 1;

  return jsonb_build_object(
    'today', t,
    'week_start', wk_start,

    'current_level', case when cur.id is null then null else jsonb_build_object(
        'id', cur.id, 'title', cur.title, 'subtitle', cur.subtitle,
        'track', cur.track, 'label', cur.level_label) end,

    -- آخر اختبار بالترتيب الزمني، لا الأعلى درجة.
    'last_quiz', (
      select jsonb_build_object(
        'quiz_id', a.quiz_id, 'title', z.title, 'percent', a.percent,
        'passed', a.passed, 'at', a.submitted_at)
      from public.quiz_attempts a
      join public.quizzes z on z.id = a.quiz_id
      where a.user_id = uid
      order by a.submitted_at desc limit 1),

    'next_class', (
      select jsonb_build_object(
        'id', cs.id, 'title', cs.title, 'kind', cs.kind,
        'starts_at', cs.starts_at, 'duration_min', cs.duration_min,
        'meeting_url', cs.meeting_url)
      from public.bookings b
      join public.class_slots cs on cs.id = b.slot_id
      where b.user_id = uid and b.status = 'booked'
        and cs.status = 'scheduled' and cs.starts_at > now()
      order by cs.starts_at limit 1),

    'resume', case when sp.id is null then null else jsonb_build_object(
        'lesson_id', sp.id, 'title', sp.title, 'level_id', sp.level_id,
        'pos', sp.pos) end,

    'latest_notification', (
      select jsonb_build_object(
        'id', n.id, 'title', n.title, 'body', n.body, 'link', n.link,
        'created_at', n.created_at, 'read', n.read_at is not null)
      from public.notifications n
      where n.user_id = uid
      order by n.created_at desc limit 1),

    'unread_count', (select count(*) from public.notifications
                     where user_id = uid and read_at is null),

    -- أيام الأسبوع الجاري من السبت إلى الجمعة
    'week', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', d::date,
        'today', d::date = t,
        'future', d::date > t,
        'active', exists (select 1 from public.activity_days a
                          where a.user_id = uid and a.day = d::date))
        order by d)
      from generate_series(wk_start, wk_start + 6, interval '1 day') d), '[]'::jsonb),

    -- سجل النشاط لثلاثة أشهر: عدد ما أُنجز في كل يوم، لا مجرد «نشط».
    'activity_log', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', d.day, 'lessons', d.lessons, 'quizzes', d.quizzes,
        'challenge', d.challenge, 'total', d.lessons + d.quizzes + d.challenge)
        order by d.day)
      from (
        select g::date as day,
          (select count(*) from public.lesson_progress lp
            where lp.user_id = uid
              and (lp.completed_at at time zone 'Asia/Riyadh')::date = g::date)::int as lessons,
          (select count(*) from public.quiz_attempts qa
            where qa.user_id = uid
              and (qa.submitted_at at time zone 'Asia/Riyadh')::date = g::date)::int as quizzes,
          (select count(*) from public.challenge_answers ca
            where ca.user_id = uid and ca.day = g::date)::int as challenge
        from generate_series(t - 89, t, interval '1 day') g
      ) d), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.my_learn_extra() from public;
grant execute on function public.my_learn_extra() to authenticated;

-- ------------------------------------------------------------
-- 9) الحصص حسب النوع
--    available_slots() القائمة ترجع الحصص كلها. هذه تفصلها بالنوع
--    وتحسب المقاعد في الخادم: المتعلم لا يرى حجوزات غيره فلا يستطيع عدّها.
-- ------------------------------------------------------------
create or replace function public.slots_by_kind(p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;
  if p_kind not in ('live', 'private') then
    return jsonb_build_object('error', 'نوع غير معروف');
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', cs.id, 'title', cs.title, 'description', cs.description,
      'starts_at', cs.starts_at, 'duration_min', cs.duration_min,
      'capacity', cs.capacity,
      'seats_left', greatest(0, cs.capacity -
        (select count(*) from public.bookings b
         where b.slot_id = cs.id and b.status <> 'no_show')),
      'mine', exists (select 1 from public.bookings b
                      where b.slot_id = cs.id and b.user_id = uid),
      'meeting_url', case when exists (
          select 1 from public.bookings b
          where b.slot_id = cs.id and b.user_id = uid and b.status = 'booked')
        then cs.meeting_url else null end)
      order by cs.starts_at)
    from public.class_slots cs
    where cs.published and cs.kind = p_kind
      and cs.status = 'scheduled' and cs.starts_at > now()
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.slots_by_kind(text) from public;
grant execute on function public.slots_by_kind(text) to authenticated;

-- ------------------------------------------------------------
-- 10) قصص النجاح المنشورة لصفحة المتعلم
-- ------------------------------------------------------------
create or replace function public.published_stories()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'title', s.title, 'body', s.body,
      'name', case when s.show_name then s.trainee_name else null end,
      'image_path', s.image_path, 'amount', s.amount
    ) order by s.sort_order, s.created_at desc), '[]'::jsonb)
  from public.success_stories s where s.published;
$$;

revoke all on function public.published_stories() from public;
grant execute on function public.published_stories() to anon, authenticated;

notify pgrst, 'reload schema';
