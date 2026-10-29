-- ============================================================
-- نورث للمسار المالي — الهجرة الحادية والعشرون
-- تعطيل الحسابات وتفعيلها وحذفها، وحماية الأدمن، وملفه الشخصي
--
-- ثلاث حقائق تحكم التصميم هنا:
--
-- ١) كل جداول المتعلم مرتبطة بـ auth.users بـ on delete cascade. حذف
--    الحساب يمحو معه الاشتراكات والحجوزات والتقدّم والنتائج وسجلّ
--    التعديلات. فالسجل الإداري يجب أن يعيش في جدول **بلا مفتاح أجنبي**
--    وإلا مُحي أثر الحذف مع المحذوف.
--
-- ٢) إيقاف الحساب في الجدول لا يُبطل جلسةً قائمة: رمز الدخول صالح
--    نحو ساعة. فالإيقاف يُكمَّل بحظر في نظام المصادقة (ban) من دالة
--    الخادم، ويُفحص هنا في كل مدخل تقرأ منه الواجهة.
--
-- ٣) أدمن يعطّل نفسه أو يحذف آخر أدمن يقفل الباب وبداخله المفتاح.
--
-- تُشغَّل بعد 20. إضافية بالكامل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) أدمن محميّ لا يُعطَّل ولا يُحذف
--    يُعلَّم أول أدمن تلقائياً، ويمكن تعليم غيره يدوياً.
-- ------------------------------------------------------------
alter table public.user_roles
  add column if not exists protected boolean not null default false;

update public.user_roles r
   set protected = true
 where r.role = 'admin'
   and not exists (select 1 from public.user_roles x
                   where x.role = 'admin' and x.protected)
   and r.granted_at = (select min(granted_at) from public.user_roles
                       where role = 'admin');

-- ------------------------------------------------------------
-- 2) السجل الإداري
--    user_id هنا uuid عادي لا مفتاح أجنبي: أثر الحذف يجب أن يبقى
--    بعد ذهاب الصفّ المحذوف.
-- ------------------------------------------------------------
create table if not exists public.admin_audit (
  id          uuid primary key default gen_random_uuid(),
  action      text not null,
  user_id     uuid,
  user_label  text,
  detail      text,
  payload     jsonb not null default '{}'::jsonb,
  actor_id    uuid,
  actor_label text,
  created_at  timestamptz not null default now()
);

create index if not exists admin_audit_idx on public.admin_audit (created_at desc);
create index if not exists admin_audit_user_idx on public.admin_audit (user_id, created_at desc);

alter table public.admin_audit enable row level security;

drop policy if exists "admin reads audit" on public.admin_audit;
create policy "admin reads audit" on public.admin_audit
  for select to authenticated using (public.is_admin());

grant select on public.admin_audit to authenticated;
revoke insert, update, delete on public.admin_audit from authenticated, anon;

create or replace function public.log_admin(
  p_action text, p_user uuid, p_label text,
  p_detail text default null, p_payload jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.admin_audit
    (action, user_id, user_label, detail, payload, actor_id, actor_label)
  values (p_action, p_user, p_label, p_detail, coalesce(p_payload, '{}'::jsonb),
          auth.uid(),
          (select full_name from public.profiles where id = auth.uid()));
end;
$$;

revoke all on function public.log_admin(text, uuid, text, text, jsonb) from public;

-- ------------------------------------------------------------
-- 3) هل يجوز التصرّف في هذا الحساب؟
--    مرجع واحد يستعمله SQL ودالة الخادم معاً، فلا تفترق القاعدتان.
-- ------------------------------------------------------------
create or replace function public.admin_may_act(p_user uuid, p_action text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare p public.profiles; is_prot boolean; is_adm boolean; n_adm integer;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'غير مصرّح');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'هذه العملية للإدارة وحدها');
  end if;

  select * into p from public.profiles where id = p_user;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'العضو غير موجود');
  end if;

  if p_user = auth.uid() then
    return jsonb_build_object('ok', false,
      'error', 'لا يمكنك تعطيل حسابك أو حذفه من هنا. اطلب ذلك من أدمن آخر.');
  end if;

  select coalesce(bool_or(protected), false), coalesce(bool_or(role = 'admin'), false)
    into is_prot, is_adm
  from public.user_roles where user_id = p_user;

  if is_prot then
    return jsonb_build_object('ok', false,
      'error', 'هذا حساب الإدارة الأساسي، وهو محميّ من التعطيل والحذف.');
  end if;

  if is_adm then
    select count(*) into n_adm from public.user_roles where role = 'admin';
    if n_adm <= 1 then
      return jsonb_build_object('ok', false,
        'error', 'هذا آخر حساب إدارة. لا يُعطَّل ولا يُحذف وإلا أُغلقت اللوحة على الجميع.');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'is_admin', is_adm,
                            'name', p.full_name, 'email', p.email,
                            'membership_no', p.membership_no);
end;
$$;

revoke all on function public.admin_may_act(uuid, text) from public;
grant execute on function public.admin_may_act(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 4) تعطيل الحساب وتفعيله
--    هذه نصف العملية: النصف الآخر حظر الحساب في نظام المصادقة من
--    دالة الخادم، وإلا بقيت جلسة قائمة تعمل نحو ساعة.
-- ------------------------------------------------------------
create or replace function public.admin_set_member_status(
  p_user uuid, p_status text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare g jsonb; old_status text;
begin
  if p_status not in ('active', 'suspended') then
    return jsonb_build_object('error', 'حالة غير معروفة');
  end if;

  -- التفعيل لا يضرّ أحداً، فحارسه أخفّ: يكفي أن يكون المنادي أدمن.
  if p_status = 'suspended' then
    g := public.admin_may_act(p_user, 'suspend');
    if not (g->>'ok')::boolean then
      return jsonb_build_object('error', g->>'error');
    end if;
  else
    if not public.is_admin() then
      return jsonb_build_object('error', 'هذه العملية للإدارة وحدها');
    end if;
  end if;

  select status into old_status from public.profiles where id = p_user;
  if old_status is null then
    return jsonb_build_object('error', 'العضو غير موجود');
  end if;
  if old_status = p_status then
    return jsonb_build_object('ok', true, 'unchanged', true, 'status', p_status,
                              'message', 'الحساب بهذه الحالة أصلاً.');
  end if;

  update public.profiles set status = p_status where id = p_user;

  perform public.log_admin(
    case when p_status = 'suspended' then 'suspend' else 'activate' end,
    p_user,
    (select coalesce(full_name, email, membership_no) from public.profiles where id = p_user),
    p_reason,
    jsonb_build_object('from', old_status, 'to', p_status));

  return jsonb_build_object('ok', true, 'status', p_status,
    'message', case when p_status = 'suspended'
      then 'عُطِّل الحساب. بياناته وسجلّه محفوظة، ولا يستطيع الدخول.'
      else 'أُعيد تفعيل الحساب.' end);
end;
$$;

revoke all on function public.admin_set_member_status(uuid, text, text) from public;
grant execute on function public.admin_set_member_status(uuid, text, text) to authenticated;

-- ------------------------------------------------------------
-- 5) ماذا يضيع إن حُذف هذا الحساب؟
--    الحذف يشلّح السجلات المرتبطة كلها. عرضها قبل التأكيد يجعل القرار
--    مبنيّاً على ما سيحدث فعلاً لا على تقدير.
-- ------------------------------------------------------------
create or replace function public.admin_delete_preview(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare g jsonb;
begin
  g := public.admin_may_act(p_user, 'delete');
  if not (g->>'ok')::boolean then
    return jsonb_build_object('error', g->>'error');
  end if;

  return jsonb_build_object(
    'ok', true,
    'name', g->>'name', 'email', g->>'email', 'membership_no', g->>'membership_no',
    'counts', jsonb_build_object(
      'اشتراكات', (select count(*) from public.subscription_events where user_id = p_user),
      'حجوزات',   (select count(*) from public.bookings where user_id = p_user),
      'دروس مكتملة', (select count(*) from public.lesson_progress where user_id = p_user),
      'محاولات اختبار', (select count(*) from public.quiz_attempts where user_id = p_user),
      'إجابات مفردات', (select count(*) from public.vocab_attempts where user_id = p_user),
      'إشعارات', (select count(*) from public.notifications where user_id = p_user),
      'رسائل المساعد', (select count(*) from public.assistant_messages where user_id = p_user)));
end;
$$;

revoke all on function public.admin_delete_preview(uuid) from public;
grant execute on function public.admin_delete_preview(uuid) to authenticated;

-- يُنادى من دالة الخادم قبل الحذف وبعده: الحارس نفسه، والأثر يبقى.
create or replace function public.admin_log_delete(
  p_user uuid, p_label text, p_email text, p_counts jsonb, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'هذه العملية للإدارة وحدها');
  end if;

  perform public.log_admin('delete', p_user, p_label, p_reason,
    jsonb_build_object('email', p_email, 'deleted', coalesce(p_counts, '{}'::jsonb)));

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_log_delete(uuid, text, text, jsonb, text) from public;
grant execute on function public.admin_log_delete(uuid, text, text, jsonb, text) to authenticated;

-- ------------------------------------------------------------
-- 6) حالة حسابي — يسأل عنها المتصفح عند كل فتح صفحة
--    جلسةٌ صدرت قبل التعطيل تبقى صالحة حتى تنتهي. هذه الدالة تجعل
--    الواجهة تكتشف التعطيل فوراً وتُخرج صاحبها.
-- ------------------------------------------------------------
create or replace function public.account_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); p public.profiles;
begin
  if uid is null then
    return jsonb_build_object('signed_in', false);
  end if;

  select * into p from public.profiles where id = uid;
  if not found then
    return jsonb_build_object('signed_in', true, 'active', false,
                              'reason', 'لم يعد لهذا الحساب ملف في المنصة.');
  end if;

  return jsonb_build_object(
    'signed_in', true,
    'active', p.status = 'active',
    'status', p.status,
    'is_admin', public.is_admin(),
    'reason', case when p.status = 'active' then null
                   else 'حسابك معطَّل حالياً. تواصل مع إدارة المنصة.' end);
end;
$$;

revoke all on function public.account_state() from public;
grant execute on function public.account_state() to authenticated;

-- ------------------------------------------------------------
-- 7) الملف الشخصي للأدمن
--    الاسم والجوال فقط. الصلاحية ليست حقلاً هنا: أدمن يرقّي نفسه أو
--    يُسقط صلاحيته من صفحته الشخصية بابٌ لا داعي له.
-- ------------------------------------------------------------
create or replace function public.my_admin_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); p public.profiles; prot boolean;
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;
  if not public.is_admin() then
    return jsonb_build_object('error', 'هذه الصفحة للإدارة وحدها');
  end if;

  select * into p from public.profiles where id = uid;
  select coalesce(bool_or(protected), false) into prot
  from public.user_roles where user_id = uid;

  return jsonb_build_object(
    'id', p.id, 'full_name', p.full_name, 'email', p.email, 'phone', p.phone,
    'username', p.username, 'membership_no', p.membership_no,
    'created_at', p.created_at,
    'protected', prot,
    'admins', (select count(*) from public.user_roles where role = 'admin'),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'action', a.action, 'user_label', a.user_label,
        'detail', a.detail, 'at', a.created_at, 'actor', a.actor_label)
        order by a.created_at desc)
      from (select * from public.admin_audit order by created_at desc limit 12) a), '[]'::jsonb));
end;
$$;

revoke all on function public.my_admin_profile() from public;
grant execute on function public.my_admin_profile() to authenticated;

create or replace function public.update_my_admin_profile(
  p_full_name text, p_phone text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); r jsonb;
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;
  if not public.is_admin() then
    return jsonb_build_object('error', 'هذه الصفحة للإدارة وحدها');
  end if;

  -- التحقق والتسجيل في دالة واحدة لا اثنتين تفترقان
  r := public.update_my_profile(p_full_name, p_phone);
  if r ? 'error' then return r; end if;

  if not coalesce((r->>'unchanged')::boolean, false) then
    perform public.log_admin('self_profile', uid, r->>'full_name', null,
                             jsonb_build_object('full_name', r->>'full_name'));
  end if;
  return r;
end;
$$;

revoke all on function public.update_my_admin_profile(text, text) from public;
grant execute on function public.update_my_admin_profile(text, text) to authenticated;

-- ------------------------------------------------------------
-- 8) سدّ المداخل أمام الحساب المعطَّل
--    has_active_subscription ترفضه أصلاً فلا يرى المحتوى المدفوع،
--    لكن اللوحة ولوحة المتعلم كانتا تُفتحان له. تُسدّان هنا.
-- ------------------------------------------------------------
create or replace function public.my_role()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); st text; rl text;
begin
  if uid is null then return 'guest'; end if;
  select status into st from public.profiles where id = uid;
  if st is distinct from 'active' then return 'suspended'; end if;
  select role into rl from public.user_roles where user_id = uid;
  return coalesce(rl, 'user');
end;
$$;

revoke all on function public.my_role() from public;
grant execute on function public.my_role() to authenticated;

-- الأدمن المعطَّل ليس أدمن. الدالة هي الحارس الذي تستعمله كل اللوحة.
create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.user_roles r
    join public.profiles p on p.id = r.user_id
    where r.user_id = uid and r.role = 'admin' and p.status = 'active'
  );
$$;

-- ------------------------------------------------------------
-- 9) المداخل التي كانت تُفتح لحساب معطَّل
--    has_active_subscription تمنعه من المحتوى المدفوع، لكن اللوحة
--    وصفحة الحساب كانتا تعرضان له اسمه وتقدّمه. أُعيد تعريفها بالحارس
--    نفسه، فلا تبقى جلسةٌ قديمة تفتح شيئاً.
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

  -- حساب معطَّل لا يفتح شيئاً، حتى بجلسة صدرت قبل التعطيل.
  if (select status from public.profiles where id = uid) is distinct from 'active' then
    return jsonb_build_object('error', 'حسابك معطَّل حالياً. تواصل مع إدارة المنصة.');
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

  -- حساب معطَّل لا يفتح شيئاً، حتى بجلسة صدرت قبل التعطيل.
  if (select status from public.profiles where id = uid) is distinct from 'active' then
    return jsonb_build_object('error', 'حسابك معطَّل حالياً. تواصل مع إدارة المنصة.');
  end if;

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

create or replace function public.my_account()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); p public.profiles;
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;
  -- حساب معطَّل لا يفتح شيئاً، حتى بجلسة صدرت قبل التعطيل.
  if (select status from public.profiles where id = uid) is distinct from 'active' then
    return jsonb_build_object('error', 'حسابك معطَّل حالياً. تواصل مع إدارة المنصة.');
  end if;

  select * into p from public.profiles where id = uid;
  if not found then return jsonb_build_object('error', 'الحساب غير موجود'); end if;

  return jsonb_build_object(
    'id', p.id,
    'full_name', p.full_name,
    'username', p.username,
    'email', p.email,
    'phone', p.phone,
    'telegram', p.telegram,
    'membership_no', p.membership_no,
    'plan', p.plan,
    'account_status', p.status,
    'subscription_status', p.subscription_status,
    'effective_status', public.effective_sub_status(
                          p.subscription_status, p.subscription_expires_at),
    'subscription_expires_at', p.subscription_expires_at,
    'created_at', p.created_at,
    'must_change_password', p.must_change_password);
end;
$$;

notify pgrst, 'reload schema';
