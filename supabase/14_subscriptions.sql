-- ============================================================
-- نورث للمسار المالي — الهجرة الرابعة عشرة
-- إدارة الباقات والتجديد من لوحة الأدمن
--
-- المشكلة التي تعالجها:
-- الهجرتان 04 و 05 سحبتا صلاحية التعديل من authenticated وأعادتا
-- عمودين فقط: full_name و phone. هذا هو ما يمنع المشترك من ترقية
-- باقته بنفسه — وهو صحيح ويجب أن يبقى. لكن الأدمن يدخل بالدور نفسه
-- (authenticated)، فالمنع يشمله، ويفشل التعديل بـ
--   permission denied for table profiles
-- قبل أن تُفحص سياسة RLS أو يعمل المُحفِّز أصلاً.
--
-- الحل ليس توسيع الصلاحية — ذلك يفتحها للمشتركين جميعاً — بل مسار
-- محدود: دوال security definer تتحقق من is_admin() أولاً، وتكتب
-- الأعمدة المحميّة، وتسجّل كل عملية.
--
-- تُشغَّل بعد 13. إضافية بالكامل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) تاريخ بداية الفترة الحالية
--    التاريخ الموجود هو تاريخ الانتهاء وحده، فلا يُعرف متى بدأت.
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists subscription_started_at timestamptz;

-- ------------------------------------------------------------
-- 2) سجل عمليات الاشتراك
--    تغيير الباقة لا يمحو ما قبله: كل عملية صفٌّ جديد يحمل ما كان
--    وما صار ومن نفّذها ومتى.
-- ------------------------------------------------------------
create table if not exists public.subscription_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null check (kind in
                  ('renew','plan_change','status_change','created')),
  plan_before   text,
  plan_after    text,
  status_before text,
  status_after  text,
  starts_at     timestamptz,
  expires_at    timestamptz,
  months        integer,
  note          text,
  actor_id      uuid references auth.users(id),
  created_at    timestamptz not null default now()
);

create index if not exists sub_events_user_idx
  on public.subscription_events (user_id, created_at desc);

alter table public.subscription_events enable row level security;

drop policy if exists "admin reads events" on public.subscription_events;
create policy "admin reads events" on public.subscription_events
  for select to authenticated using (public.is_admin());

drop policy if exists "member reads own events" on public.subscription_events;
create policy "member reads own events" on public.subscription_events
  for select to authenticated using (user_id = auth.uid());

-- لا سياسة إدراج ولا تعديل ولا حذف لأحد: السجل يُكتب من الدوال أدناه
-- وحدها. سجلٌّ يستطيع صاحب الشأن تعديله ليس سجلاً.
-- والقراءة تُمنح صراحةً: الجدول جديد، والاتكال على الصلاحيات
-- الافتراضية يجعل السجل محجوباً عن الأدمن نفسه.
grant select on public.subscription_events to authenticated;
revoke insert, update, delete on public.subscription_events from authenticated, anon;

-- ------------------------------------------------------------
-- 3) الحالة الفعلية
--    العمود المخزّن قد يقول «نافذ» وقد مضى تاريخ الانتهاء. الحساب
--    من التاريخ هو المرجع، والعمود يُصحَّح بعده.
-- ------------------------------------------------------------
create or replace function public.effective_sub_status(
  p_status text, p_expires timestamptz)
returns text
language sql
immutable
as $$
  select case
    when p_status is distinct from 'active' then coalesce(p_status, 'inactive')
    when p_expires is null then 'active'            -- اشتراك بلا نهاية محددة
    when p_expires > now() then 'active'
    else 'expired'
  end;
$$;

grant execute on function public.effective_sub_status(text, timestamptz) to authenticated;

-- تصحيح العمود المخزّن لمن مضى تاريخه. تُنادى عند فتح قائمة الأعضاء
-- فلا تحتاج مهمة مجدولة.
create or replace function public.sync_expired_subscriptions()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n integer;
begin
  if not public.is_admin() then return 0; end if;

  update public.profiles
     set subscription_status = 'expired'
   where subscription_status = 'active'
     and subscription_expires_at is not null
     and subscription_expires_at <= now();

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.sync_expired_subscriptions() from public;
grant execute on function public.sync_expired_subscriptions() to authenticated;

-- ------------------------------------------------------------
-- 3.1) صياغة المدة
--      «٣ شهراً» ركيك. العربية تميّز المفرد والمثنّى وجمع القلّة.
-- ------------------------------------------------------------
create or replace function public.ar_months(n integer)
returns text
language sql
immutable
as $$
  select case
    when n = 1 then 'شهراً واحداً'
    when n = 2 then 'شهرين'
    when n between 3 and 10 then n || ' أشهر'
    else n || ' شهراً' end;
$$;

grant execute on function public.ar_months(integer) to authenticated;

-- ------------------------------------------------------------
-- 4) حارس مشترك: كل دالة أدمن تبدأ به
-- ------------------------------------------------------------
create or replace function public.admin_target(p_user uuid)
returns public.profiles
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare p public.profiles;
begin
  if auth.uid() is null then
    raise exception 'غير مصرّح' using errcode = '42501';
  end if;
  if not public.is_admin() then
    raise exception 'هذه العملية للإدارة وحدها' using errcode = '42501';
  end if;

  select * into p from public.profiles where id = p_user;
  if not found then
    raise exception 'العضو غير موجود' using errcode = 'P0002';
  end if;
  return p;
end;
$$;

revoke all on function public.admin_target(uuid) from public;
grant execute on function public.admin_target(uuid) to authenticated;

-- ------------------------------------------------------------
-- 5) تغيير الباقة
--    الباقة وحدها. لا يمسّ التواريخ ولا الحالة ولا رقم العضوية،
--    وتعمل والاشتراك منتهٍ.
-- ------------------------------------------------------------
create or replace function public.admin_set_plan(
  p_user uuid, p_plan text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare p public.profiles; new_plan text;
begin
  p := public.admin_target(p_user);
  new_plan := nullif(btrim(coalesce(p_plan, '')), '');

  if new_plan is null then
    return jsonb_build_object('error', 'اختر باقة');
  end if;
  if new_plan is not distinct from p.plan then
    return jsonb_build_object('ok', true, 'unchanged', true,
                              'message', 'الباقة كما هي، لم يُغيَّر شيء.');
  end if;

  update public.profiles set plan = new_plan where id = p_user;

  insert into public.subscription_events
    (user_id, kind, plan_before, plan_after, status_before, status_after,
     expires_at, note, actor_id)
  values
    (p_user, 'plan_change', p.plan, new_plan, p.subscription_status,
     p.subscription_status, p.subscription_expires_at, p_note, auth.uid());

  return jsonb_build_object('ok', true, 'plan', new_plan,
    'message', 'تغيّرت الباقة من «' || coalesce(p.plan, '—') ||
               '» إلى «' || new_plan || '».');
end;
$$;

revoke all on function public.admin_set_plan(uuid, text, text) from public;
grant execute on function public.admin_set_plan(uuid, text, text) to authenticated;

-- ------------------------------------------------------------
-- 6) تجديد الاشتراك
--    العضو نفسه: لا حساب جديد ولا رقم عضوية جديد.
--
--    بداية الفترة: إن كان الاشتراك ما زال نافذاً تبدأ الفترة الجديدة
--    من تاريخ انتهاء الحالية، فلا تضيع الأيام المتبقية. وإن كان
--    منتهياً تبدأ من اليوم، فلا يُحتسب تجديدٌ لأيام مضت.
-- ------------------------------------------------------------
create or replace function public.admin_renew_subscription(
  p_user   uuid,
  p_months integer default 1,
  p_plan   text default null,
  p_note   text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p          public.profiles;
  new_plan   text;
  starts     timestamptz;
  ends       timestamptz;
  was_active boolean;
begin
  p := public.admin_target(p_user);

  if p_months is null or p_months < 1 or p_months > 60 then
    return jsonb_build_object('error', 'مدة التجديد بين شهر و٦٠ شهراً');
  end if;

  new_plan := coalesce(nullif(btrim(coalesce(p_plan, '')), ''), p.plan);

  was_active := public.effective_sub_status(
                  p.subscription_status, p.subscription_expires_at) = 'active'
                and p.subscription_expires_at is not null;

  starts := case when was_active then p.subscription_expires_at else now() end;
  ends   := starts + make_interval(months => p_months);

  update public.profiles
     set plan                    = new_plan,
         subscription_status     = 'active',
         subscription_started_at = starts,
         subscription_expires_at = ends,
         -- حساب موقوف لا يستفيد من تجديد، فيُعاد تفعيله معه
         status                  = case when status = 'active' then status else 'active' end
   where id = p_user;

  insert into public.subscription_events
    (user_id, kind, plan_before, plan_after, status_before, status_after,
     starts_at, expires_at, months, note, actor_id)
  values
    (p_user, 'renew', p.plan, new_plan, p.subscription_status, 'active',
     starts, ends, p_months, p_note, auth.uid());

  return jsonb_build_object(
    'ok', true,
    'plan', new_plan,
    'starts_at', starts,
    'expires_at', ends,
    'extended', was_active,
    'message', case when was_active
      then 'أُضيف ' || public.ar_months(p_months) || ' إلى الاشتراك النافذ.'
      else 'جُدِّد الاشتراك ' || public.ar_months(p_months) || ' ابتداءً من اليوم.' end);
end;
$$;

revoke all on function public.admin_renew_subscription(uuid, integer, text, text) from public;
grant execute on function public.admin_renew_subscription(uuid, integer, text, text) to authenticated;

-- ------------------------------------------------------------
-- 7) ضبط الحالة يدوياً
--    للحالات الاستثنائية: إلغاء، إيقاف، أو تصحيح تاريخ.
-- ------------------------------------------------------------
create or replace function public.admin_set_subscription_status(
  p_user    uuid,
  p_status  text,
  p_expires timestamptz default null,
  p_note    text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare p public.profiles; eff text;
begin
  p := public.admin_target(p_user);

  if p_status not in ('active', 'inactive', 'expired', 'cancelled') then
    return jsonb_build_object('error', 'حالة غير معروفة');
  end if;

  -- «نافذ» بتاريخ ماضٍ تناقض: الحالة تُحسب من التاريخ، فيعود منتهياً
  -- فوراً ويظن الأدمن أن الحفظ لم ينجح.
  if p_status = 'active' and p_expires is not null and p_expires <= now() then
    return jsonb_build_object('error',
      'تاريخ الانتهاء في الماضي. استخدم التجديد، أو اختر تاريخاً قادماً.');
  end if;

  update public.profiles
     set subscription_status     = p_status,
         subscription_expires_at = case when p_expires is null
                                        then subscription_expires_at
                                        else p_expires end
   where id = p_user;

  select public.effective_sub_status(subscription_status, subscription_expires_at)
    into eff from public.profiles where id = p_user;

  insert into public.subscription_events
    (user_id, kind, plan_before, plan_after, status_before, status_after,
     expires_at, note, actor_id)
  values
    (p_user, 'status_change', p.plan, p.plan, p.subscription_status, p_status,
     coalesce(p_expires, p.subscription_expires_at), p_note, auth.uid());

  return jsonb_build_object('ok', true, 'status', eff,
                            'message', 'حُدِّثت حالة الاشتراك.');
end;
$$;

revoke all on function public.admin_set_subscription_status(uuid, text, timestamptz, text) from public;
grant execute on function public.admin_set_subscription_status(uuid, text, timestamptz, text) to authenticated;

-- ------------------------------------------------------------
-- 8) تعديل بيانات العضو غير المالية
--    الاسم والجوال واسم المستخدم. لا تمسّ رقم العضوية ولا البريد:
--    رقم العضوية مرجع ثابت، والبريد هو هوية الدخول.
-- ------------------------------------------------------------
create or replace function public.admin_update_member(
  p_user uuid, p_full_name text, p_phone text default null,
  p_username text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare p public.profiles; nm text; un text;
begin
  p := public.admin_target(p_user);

  nm := nullif(btrim(coalesce(p_full_name, '')), '');
  if nm is null then return jsonb_build_object('error', 'الاسم مطلوب'); end if;

  un := nullif(btrim(coalesce(p_username, '')), '');
  if un is not null and exists (
       select 1 from public.profiles
       where lower(username) = lower(un) and id <> p_user) then
    return jsonb_build_object('error', 'اسم المستخدم محجوز لعضو آخر');
  end if;

  update public.profiles
     set full_name = nm,
         phone     = nullif(btrim(coalesce(p_phone, '')), ''),
         username  = un
   where id = p_user;

  return jsonb_build_object('ok', true, 'message', 'حُفِظت بيانات العضو.');
end;
$$;

revoke all on function public.admin_update_member(uuid, text, text, text) from public;
grant execute on function public.admin_update_member(uuid, text, text, text) to authenticated;

-- ------------------------------------------------------------
-- 9) قراءة عضو واحد مع سجله
--    الحالة المعروضة محسوبة في الخادم، فلا تحسبها الواجهة مرة أخرى
--    بقاعدة قد تفترق عن قاعدة القاعدة.
-- ------------------------------------------------------------
create or replace function public.admin_member(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare p public.profiles;
begin
  p := public.admin_target(p_user);

  return jsonb_build_object(
    'id', p.id,
    'full_name', p.full_name,
    'email', p.email,
    'phone', p.phone,
    'username', p.username,
    'membership_no', p.membership_no,
    'plan', p.plan,
    'account_status', p.status,
    'subscription_status', p.subscription_status,
    'effective_status', public.effective_sub_status(
                          p.subscription_status, p.subscription_expires_at),
    'subscription_started_at', p.subscription_started_at,
    'subscription_expires_at', p.subscription_expires_at,
    'days_left', case when p.subscription_expires_at is null then null
                      else greatest(0, (p.subscription_expires_at::date - current_date)) end,
    'created_at', p.created_at,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'kind', e.kind,
        'plan_before', e.plan_before, 'plan_after', e.plan_after,
        'status_before', e.status_before, 'status_after', e.status_after,
        'starts_at', e.starts_at, 'expires_at', e.expires_at,
        'months', e.months, 'note', e.note, 'created_at', e.created_at,
        'actor', (select a.full_name from public.profiles a where a.id = e.actor_id))
        order by e.created_at desc)
      from public.subscription_events e where e.user_id = p_user), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_member(uuid) from public;
grant execute on function public.admin_member(uuid) to authenticated;

-- ------------------------------------------------------------
-- 10) الباقات المتاحة
--     تُقرأ من باقات الأعضاء القائمة حتى لا تُكتب قائمة ثابتة في
--     الواجهة تفترق عمّا في القاعدة.
-- ------------------------------------------------------------
create or replace function public.admin_plans()
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
    select jsonb_agg(distinct plan)
    from public.profiles
    where plan is not null and btrim(plan) <> ''), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_plans() from public;
grant execute on function public.admin_plans() to authenticated;

notify pgrst, 'reload schema';
