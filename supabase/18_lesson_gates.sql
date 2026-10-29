-- ============================================================
-- نورث للمسار المالي — الهجرة الثامنة عشرة
-- رمز المستوى، والأسابيع، وقفل على مستوى الدرس لا المرحلة وحدها
--
-- القاعدة المعتمدة: الدرس يُفتح بإنهاء الدرس الذي قبله واجتياز
-- اختباره إن كان له اختبار. والمرحلة تبقى محكومة بقاعدتها في
-- الهجرة 13. القاعدتان مفروضتان في الخادم: فتح الرابط يدوياً أو
-- نداء الدالة مباشرة لا يتجاوزهما.
--
-- تُشغَّل بعد 17. إضافية بالكامل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) حقول جديدة
-- ------------------------------------------------------------

-- رمز المستوى: A1 و A2 و B1 … تملؤه الإدارة ولا يُختلق هنا.
alter table public.levels add column if not exists code text;

-- الأسبوع داخل المستوى. صفر يعني «بلا أسبوع» فتُعرض الدروس متسلسلة.
alter table public.lessons add column if not exists week_no integer not null default 0;

do $$ begin
  alter table public.lessons add constraint lessons_week_chk
    check (week_no >= 0 and week_no <= 60);
exception when duplicate_object then null; end $$;

create index if not exists lessons_week_idx on public.lessons (level_id, week_no, sort_order);

-- تجاوز يدوي لقاعدة الفتح: auto تتبع القاعدة، open مفتوح دائماً،
-- locked مقفل دائماً. الإدارة تحتاج استثناءً أحياناً دون تعطيل القاعدة.
alter table public.lessons add column if not exists access text not null default 'auto';

do $$ begin
  alter table public.lessons add constraint lessons_access_chk
    check (access in ('auto', 'open', 'locked'));
exception when duplicate_object then null; end $$;

-- اختبار يخصّ درساً بعينه. الاختبارات الحالية مربوطة بالمرحلة،
-- وتبقى كما هي: lesson_id فارغ يعني اختبار مرحلة.
alter table public.quizzes add column if not exists lesson_id uuid
  references public.lessons(id) on delete cascade;

create index if not exists quizzes_lesson_idx on public.quizzes (lesson_id, sort_order);

-- ------------------------------------------------------------
-- 2) قاعدة فتح الدرس
-- ------------------------------------------------------------
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
  if l.access = 'open'   then return true; end if;
  if l.access = 'locked' then return false; end if;

  -- المرحلة أولاً: درسٌ في مرحلة مقفلة مقفل مهما كان ترتيبه.
  if l.level_id is not null and not public.level_unlocked(l.level_id, p_uid) then
    return false;
  end if;

  -- الدرس السابق داخل المرحلة نفسها
  select ls.id, ls.sort_order into prev
  from public.lessons ls
  where ls.published
    and ls.level_id is not distinct from l.level_id
    and (ls.week_no, ls.sort_order, ls.id) < (l.week_no, l.sort_order, l.id)
  order by ls.week_no desc, ls.sort_order desc, ls.id desc
  limit 1;

  -- أول درس في المرحلة: لا سابق له
  if not found then return true; end if;

  if not exists (select 1 from public.lesson_progress lp
                 where lp.user_id = p_uid and lp.lesson_id = prev.id) then
    return false;
  end if;

  select q.id into qz from public.quizzes q
  where q.lesson_id = prev.id and q.published
  order by q.sort_order limit 1;

  if qz is null then return true; end if;

  return exists (select 1 from public.quiz_attempts a
                 where a.quiz_id = qz and a.user_id = p_uid and a.passed);
end;
$$;

revoke all on function public.lesson_unlocked(uuid, uuid) from public;
grant execute on function public.lesson_unlocked(uuid, uuid) to authenticated;

-- سبب القفل بعبارة يفهمها المتعلم
create or replace function public.lesson_lock_reason(p_lesson uuid, p_uid uuid default auth.uid())
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare l record; prev record; qz record;
begin
  if public.lesson_unlocked(p_lesson, p_uid) then return null; end if;

  select id, level_id, sort_order, week_no, access into l
  from public.lessons where id = p_lesson;

  if l.access = 'locked' then return 'هذا الدرس مغلق حالياً من الإدارة.'; end if;

  if l.level_id is not null and not public.level_unlocked(l.level_id, p_uid) then
    return 'أكمل دروس المرحلة السابقة واجتز اختبارها لفتح هذه المرحلة.';
  end if;

  select ls.id, ls.title into prev
  from public.lessons ls
  where ls.published and ls.level_id is not distinct from l.level_id
    and (ls.week_no, ls.sort_order, ls.id) < (l.week_no, l.sort_order, l.id)
  order by ls.week_no desc, ls.sort_order desc, ls.id desc
  limit 1;

  if not found then return 'هذا الدرس غير متاح لك الآن.'; end if;

  if not exists (select 1 from public.lesson_progress lp
                 where lp.user_id = p_uid and lp.lesson_id = prev.id) then
    return 'أكمل درس «' || prev.title || '» لفتحه.';
  end if;

  select q.id, q.title, q.pass_score into qz from public.quizzes q
  where q.lesson_id = prev.id and q.published order by q.sort_order limit 1;

  if qz.id is not null then
    return 'اجتز اختبار درس «' || prev.title || '» بنسبة ' ||
           coalesce(qz.pass_score, 60) || '% لفتحه.';
  end if;

  return 'هذا الدرس غير متاح لك الآن.';
end;
$$;

revoke all on function public.lesson_lock_reason(uuid, uuid) from public;
grant execute on function public.lesson_lock_reason(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- 3) فرض القاعدة حيث يُقرأ الدرس ويُسجَّل إنهاؤه
-- ------------------------------------------------------------
create or replace function public.get_lesson(p_lesson uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare l record; allowed boolean; unlocked boolean; reason text;
        prev_id uuid; next_id uuid; qz uuid;
begin
  select * into l from public.lessons
  where id = p_lesson and (published or public.is_admin());

  if not found then
    return jsonb_build_object('error', 'الدرس غير متاح');
  end if;

  unlocked := public.lesson_unlocked(p_lesson);
  reason   := public.lesson_lock_reason(p_lesson);

  allowed := public.is_admin()
             or l.free_preview
             or (public.has_active_subscription() and unlocked);

  select id into prev_id from public.lessons
   where published and level_id is not distinct from l.level_id
     and (week_no, sort_order, id) < (l.week_no, l.sort_order, l.id)
   order by week_no desc, sort_order desc, id desc limit 1;

  select id into next_id from public.lessons
   where published and level_id is not distinct from l.level_id
     and (week_no, sort_order, id) > (l.week_no, l.sort_order, l.id)
   order by week_no asc, sort_order asc, id asc limit 1;

  -- اختبار الدرس أولاً، فإن لم يكن له فاختبار مرحلته
  select q.id into qz from public.quizzes q
   where q.lesson_id = l.id and q.published order by q.sort_order limit 1;
  if qz is null then
    select q.id into qz from public.quizzes q
     where q.lesson_id is null and q.level_id = l.level_id and q.published
     order by q.sort_order limit 1;
  end if;

  return jsonb_build_object(
    'id', l.id, 'title', l.title, 'kind', l.kind,
    'level_id', l.level_id, 'course_id', l.course_id, 'week_no', l.week_no,
    'allowed', allowed, 'free_preview', l.free_preview,
    'unlocked', unlocked, 'locked_reason', reason,
    'duration_min', l.duration_min,
    'content',   case when allowed then l.content   else null end,
    'summary',   case when allowed then l.summary   else null end,
    'video_url', case when allowed then l.video_url else null end,
    'vocab', case when allowed then coalesce((
        select jsonb_agg(jsonb_build_object('term', v.term, 'meaning', v.meaning)
                         order by v.sort_order, v.term)
        from public.vocab v where v.lesson_id = l.id), '[]'::jsonb) else '[]'::jsonb end,
    'quiz_id', qz,
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
  if p_done and not public.lesson_unlocked(p_lesson, uid) then
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

-- اختبار درس مقفل لا يُفتح: وإلا اجتازه المتعلم وفتح ما بعده دون قراءته.
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

  if q.lesson_id is not null and not public.lesson_unlocked(q.lesson_id) then
    return jsonb_build_object('error',
      coalesce(public.lesson_lock_reason(q.lesson_id), 'الدرس لم يُفتح بعد'));
  end if;

  if q.lesson_id is null and q.level_id is not null
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

-- ------------------------------------------------------------
-- 4) الخارطة بالأسابيع والدروس
--    كل رقم محسوب من القاعدة: لا «٥ مستويات» ولا «٣٩ درساً» مكتوبة.
-- ------------------------------------------------------------
create or replace function public.my_map()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  cur uuid;
  nxt uuid;
  res jsonb;
  n_total integer; n_done integer; n_open integer; n_locked integer;
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;

  select lv.id into cur
  from public.levels lv
  where lv.published and public.level_unlocked(lv.id, uid)
    and not public.level_cleared(lv.id, uid)
  order by lv.sort_order, lv.title
  limit 1;

  -- أول درس مفتوح لم يُنجز: وجهة زر «متابعة التعلم»
  select l.id into nxt
  from public.lessons l
  left join public.levels lv on lv.id = l.level_id
  where l.published
    and public.lesson_unlocked(l.id, uid)
    and not exists (select 1 from public.lesson_progress lp
                    where lp.lesson_id = l.id and lp.user_id = uid)
  order by coalesce(lv.sort_order, 9999), l.week_no, l.sort_order, l.title
  limit 1;

  select count(*),
         count(*) filter (where exists (select 1 from public.lesson_progress lp
                                        where lp.lesson_id = l.id and lp.user_id = uid)),
         count(*) filter (where public.lesson_unlocked(l.id, uid)
                            and not exists (select 1 from public.lesson_progress lp
                                            where lp.lesson_id = l.id and lp.user_id = uid)),
         count(*) filter (where not public.lesson_unlocked(l.id, uid))
    into n_total, n_done, n_open, n_locked
  from public.lessons l where l.published;

  select coalesce(jsonb_agg(t order by t_sort, t_title), '[]'::jsonb) into res
  from (
    select coalesce(tr.sort_order, 9999) as t_sort,
           coalesce(tr.title, 'بلا مسار') as t_title,
           jsonb_build_object(
             'track_id', tr.id,
             'track', coalesce(tr.title, 'بلا مسار'),
             'for_beginners', coalesce(tr.for_beginners, false),
             'levels', coalesce((
               select jsonb_agg(jsonb_build_object(
                 'id', lv.id, 'code', lv.code, 'title', lv.title,
                 'subtitle', lv.subtitle, 'description', lv.description,
                 'total', tot.n, 'done', dn.n,
                 'percent', case when tot.n > 0 then round(dn.n * 100.0 / tot.n)::int else 0 end,
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
                 'weeks', coalesce((
                   select jsonb_agg(w order by (w->>'week')::int)
                   from (
                     select jsonb_build_object(
                       'week', l.week_no,
                       'lessons', jsonb_agg(jsonb_build_object(
                         'id', l.id, 'title', l.title, 'duration_min', l.duration_min,
                         'free_preview', l.free_preview,
                         'done', exists (select 1 from public.lesson_progress lp
                                         where lp.lesson_id = l.id and lp.user_id = uid),
                         'unlocked', public.lesson_unlocked(l.id, uid),
                         'reason', public.lesson_lock_reason(l.id, uid),
                         'quiz_id', (select q2.id from public.quizzes q2
                                     where q2.lesson_id = l.id and q2.published
                                     order by q2.sort_order limit 1),
                         'state', case
                           when exists (select 1 from public.lesson_progress lp
                                        where lp.lesson_id = l.id and lp.user_id = uid) then 'done'
                           when public.lesson_unlocked(l.id, uid) then 'open'
                           else 'locked' end)
                         order by l.sort_order, l.title)) w
                     from public.lessons l
                     where l.published and l.level_id = lv.id
                     group by l.week_no
                   ) z), '[]'::jsonb)
               ) order by lv.sort_order, lv.title)
               from public.levels lv
               cross join lateral (select count(*)::int n from public.lessons l
                                   where l.level_id = lv.id and l.published) tot
               cross join lateral (select count(*)::int n from public.lessons l
                                   join public.lesson_progress lp
                                     on lp.lesson_id = l.id and lp.user_id = uid
                                   where l.level_id = lv.id and l.published) dn
               left join lateral (select q.id from public.quizzes q
                                  where q.level_id = lv.id and q.lesson_id is null and q.published
                                  order by q.sort_order limit 1) qz on true
               where lv.published and lv.track_id is not distinct from tr.id
             ), '[]'::jsonb)) as t
    from public.tracks tr
    where tr.published
    union all
    select 9999, 'دروس عامة',
      jsonb_build_object('track_id', null, 'track', 'دروس عامة', 'for_beginners', false,
        'levels', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', lv.id, 'code', lv.code, 'title', lv.title, 'subtitle', lv.subtitle,
            'description', lv.description,
            'total', (select count(*) from public.lessons l where l.level_id = lv.id and l.published),
            'done', (select count(*) from public.lessons l
                     join public.lesson_progress lp on lp.lesson_id = l.id and lp.user_id = uid
                     where l.level_id = lv.id and l.published),
            'percent', 0, 'quiz_id', null, 'quiz_passed', false,
            'unlocked', public.level_unlocked(lv.id, uid),
            'state', case when public.level_unlocked(lv.id, uid) then 'open' else 'locked' end,
            'weeks', '[]'::jsonb) order by lv.sort_order, lv.title)
          from public.levels lv where lv.published and lv.track_id is null), '[]'::jsonb))
    where exists (select 1 from public.levels where published and track_id is null)
  ) q;

  return jsonb_build_object(
    'current_level', cur,
    'next_lesson', nxt,
    'levels_total', (select count(*) from public.levels where published),
    'lessons_total', n_total,
    'lessons_done', n_done,
    'lessons_open', n_open,
    'lessons_locked', n_locked,
    'percent', case when n_total > 0 then round(n_done * 100.0 / n_total)::int else 0 end,
    'tracks', res);
end;
$$;

revoke all on function public.my_map() from public;
grant execute on function public.my_map() to authenticated;

notify pgrst, 'reload schema';
