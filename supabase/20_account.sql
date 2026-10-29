-- ============================================================
-- نورث للمسار المالي — الهجرة العشرون
-- إدارة بيانات حساب العميلة
--
-- تمييز لازم:
--   full_name  الاسم الظاهر. هو ما تراه العميلة في لوحتها وفي شريط
--              الموقع وفي كل مكان تُذكر فيه. تعدّله هي أو الأدمن.
--   username   معرّف اختياري. المنصة **لا تستخدمه للدخول** — الدخول
--              بالبريد وحده (auth.signInWithPassword بالبريد). فهو
--              حقل تنظيمي للإدارة لا أكثر، ويبقى فارغاً بلا ضرر.
--   email      هوية الدخول، وتعيش في auth.users لا هنا. تغييرها يمرّ
--              بدالة الخادم update-member-email، وهذه الهجرة تمنع
--              تغييرها من SQL حتى لا ينشأ تناقض بين الجدول والمصادقة.
--
-- تُشغَّل بعد 19. إضافية بالكامل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) سجل تغييرات الحساب
--    من غيّر ماذا ومتى. تغيير بريد أو اسم ظاهر بلا أثر لا يُراجَع.
-- ------------------------------------------------------------
create table if not exists public.member_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  field      text not null,
  old_value  text,
  new_value  text,
  actor_id   uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists member_events_user_idx
  on public.member_events (user_id, created_at desc);

alter table public.member_events enable row level security;

drop policy if exists "admin reads member events" on public.member_events;
create policy "admin reads member events" on public.member_events
  for select to authenticated using (public.is_admin());

drop policy if exists "member reads own events" on public.member_events;
create policy "member reads own events" on public.member_events
  for select to authenticated using (user_id = auth.uid());

grant select on public.member_events to authenticated;
revoke insert, update, delete on public.member_events from authenticated, anon;

-- ------------------------------------------------------------
-- 2) تعديل بيانات العضو من الإدارة
--    الاسم الظاهر واسم المستخدم والجوال. البريد ليس هنا: مكانه
--    دالة الخادم، وإلا سبق الجدولُ المصادقةَ.
--
--    كل حقل اختياري بمعنى «اتركه كما هو»: إرسال اسم مستخدم فارغ
--    يمحوه، وعدم إرساله أصلاً لا يمسّه. هذا ما يمنع تعديل اسم
--    المستخدم من تغيير الاسم الظاهر دون قصد.
-- ------------------------------------------------------------
create or replace function public.admin_update_member(
  p_user          uuid,
  p_full_name     text default null,
  p_phone         text default null,
  p_username      text default null,
  p_set_username  boolean default false,
  p_set_phone     boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p       public.profiles;
  nm      text;
  un      text;
  ph      text;
  changed text[] := '{}';
begin
  p := public.admin_target(p_user);

  -- الاسم الظاهر
  nm := nullif(btrim(coalesce(p_full_name, '')), '');
  if p_full_name is not null and nm is null then
    return jsonb_build_object('error', 'الاسم الظاهر لا يصحّ فارغاً');
  end if;
  nm := coalesce(nm, p.full_name);

  -- اسم المستخدم: لا يُمسّ إلا إذا طُلب صراحةً
  if p_set_username then
    un := nullif(btrim(coalesce(p_username, '')), '');
    if un is not null then
      if un !~ '^[A-Za-z0-9._-]{3,32}$' then
        return jsonb_build_object('error',
          'اسم المستخدم: حروف لاتينية وأرقام ونقطة وشرطة، من ٣ إلى ٣٢ خانة.');
      end if;
      if exists (select 1 from public.profiles
                 where lower(username) = lower(un) and id <> p_user) then
        return jsonb_build_object('error', 'اسم المستخدم محجوز لعضو آخر');
      end if;
    end if;
  else
    un := p.username;
  end if;

  ph := case when p_set_phone
             then nullif(btrim(coalesce(p_phone, '')), '')
             else p.phone end;

  -- array_append لا الـ ||: مع مصفوفة نصية يحاول Postgres تفسير النص
  -- مصفوفةً ويفشل بـ malformed array literal.
  if nm is distinct from p.full_name then changed := array_append(changed, 'الاسم الظاهر'); end if;
  if un is distinct from p.username  then changed := array_append(changed, 'اسم المستخدم'); end if;
  if ph is distinct from p.phone     then changed := array_append(changed, 'الجوال'); end if;

  if array_length(changed, 1) is null then
    return jsonb_build_object('ok', true, 'unchanged', true,
                              'message', 'لا تغيير يُحفظ.');
  end if;

  update public.profiles
     set full_name = nm, username = un, phone = ph
   where id = p_user;

  if nm is distinct from p.full_name then
    insert into public.member_events (user_id, field, old_value, new_value, actor_id)
    values (p_user, 'full_name', p.full_name, nm, auth.uid());
  end if;
  if un is distinct from p.username then
    insert into public.member_events (user_id, field, old_value, new_value, actor_id)
    values (p_user, 'username', p.username, un, auth.uid());
  end if;
  if ph is distinct from p.phone then
    insert into public.member_events (user_id, field, old_value, new_value, actor_id)
    values (p_user, 'phone', p.phone, ph, auth.uid());
  end if;

  return jsonb_build_object('ok', true,
    'full_name', nm, 'username', un, 'phone', ph,
    'message', 'حُفظ: ' || array_to_string(changed, '، ') || '.');
end;
$$;

revoke all on function public.admin_update_member(uuid, text, text, text, boolean, boolean) from public;
grant execute on function public.admin_update_member(uuid, text, text, text, boolean, boolean) to authenticated;

-- النسخة ذات الأربعة وسائط من الهجرة 14 تُسقَط: بقاؤها مع الجديدة
-- يجعل نداءً بأربعة وسائط ملتبساً بينهما.
drop function if exists public.admin_update_member(uuid, text, text, text);

-- ------------------------------------------------------------
-- 3) البريد لا يُغيَّر من SQL
--    لو غُيّر هنا دخلت العميلة ببريدها القديم ورأت الجديد في حسابها.
--    المُحفِّز يمنع ذلك إلا من دالة الخادم التي تحدّث المصادقة معه.
-- ------------------------------------------------------------
create or replace function public.guard_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.email is distinct from old.email then
    -- service_role وحده يصل هنا، وهو دالة update-member-email.
    if auth.uid() is not null then
      raise exception
        'البريد يُغيَّر من «بيانات الحساب» في لوحة الإدارة، لأنه هوية الدخول في نظام المصادقة.';
    end if;

    insert into public.member_events (user_id, field, old_value, new_value, actor_id)
    values (new.id, 'email', old.email, new.email, null);
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_email on public.profiles;
create trigger profiles_guard_email
  before update of email on public.profiles
  for each row execute function public.guard_profile_email();

-- ------------------------------------------------------------
-- 4) العميلة تعدّل اسمها الظاهر وجوالها
--    صلاحية العمودين ممنوحة منذ الهجرة 04، وهذه الدالة تضيف التحقق
--    والتسجيل، وتُستعمل من صفحة الملف الشخصي.
-- ------------------------------------------------------------
create or replace function public.update_my_profile(
  p_full_name text, p_phone text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); p public.profiles; nm text; ph text;
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;

  select * into p from public.profiles where id = uid;
  if not found then return jsonb_build_object('error', 'الحساب غير موجود'); end if;

  nm := nullif(btrim(coalesce(p_full_name, '')), '');
  if nm is null then
    return jsonb_build_object('error', 'الاسم الظاهر مطلوب');
  end if;
  if length(nm) > 80 then
    return jsonb_build_object('error', 'الاسم أطول من ٨٠ خانة');
  end if;

  ph := nullif(btrim(coalesce(p_phone, '')), '');
  if ph is not null and ph !~ '^[0-9+\s()-]{7,20}$' then
    return jsonb_build_object('error', 'صيغة الجوال غير صحيحة');
  end if;

  if nm is not distinct from p.full_name and ph is not distinct from p.phone then
    return jsonb_build_object('ok', true, 'unchanged', true,
                              'message', 'لا تغيير يُحفظ.');
  end if;

  update public.profiles set full_name = nm, phone = ph where id = uid;

  if nm is distinct from p.full_name then
    insert into public.member_events (user_id, field, old_value, new_value, actor_id)
    values (uid, 'full_name', p.full_name, nm, uid);
  end if;

  return jsonb_build_object('ok', true, 'full_name', nm, 'phone', ph,
                            'message', 'حُفظت بياناتك.');
end;
$$;

revoke all on function public.update_my_profile(text, text) from public;
grant execute on function public.update_my_profile(text, text) to authenticated;

-- ------------------------------------------------------------
-- 5) بيانات حسابي للعرض
-- ------------------------------------------------------------
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

revoke all on function public.my_account() from public;
grant execute on function public.my_account() to authenticated;

-- سجل تغييرات حساب العضو للوحة الإدارة
create or replace function public.admin_member_events(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'هذه العملية للإدارة وحدها' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'field', e.field,
      'old_value', e.old_value, 'new_value', e.new_value,
      'at', e.created_at,
      'actor', (select a.full_name from public.profiles a where a.id = e.actor_id))
      order by e.created_at desc)
    from public.member_events e where e.user_id = p_user), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_member_events(uuid) from public;
grant execute on function public.admin_member_events(uuid) to authenticated;

notify pgrst, 'reload schema';
