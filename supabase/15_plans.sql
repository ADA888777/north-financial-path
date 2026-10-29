-- ============================================================
-- نورث للمسار المالي — الهجرة الخامسة عشرة
-- الباقات جدولٌ مُدار، وفصل التغيير الإداري عن تأكيد الدفع
--
-- المشكلة التي تعالجها:
-- `admin_plans()` في الهجرة 14 كانت تبني القائمة من باقات الأعضاء
-- الموجودين: `select distinct plan from profiles`. فإن لم يكن أحد على
-- «ماسية» لم تظهر «ماسية» خياراً، فيمكن التجديد على الباقة نفسها ولا
-- يمكن الترقية إليها. باقةٌ لا يملكها أحد لا تُولد من العدم.
--
-- تُشغَّل بعد 14. إضافية بالكامل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) جدول الباقات
--    رصيد الجلسات الخاصة هنا لا في الواجهة: صفحة الكلاسات تعرض
--    «٤/٤» من هذا الحقل، فإن كُتب في الواجهة افترق عن الحقيقة.
-- ------------------------------------------------------------
create table if not exists public.plans (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique check (length(btrim(name)) > 0),
  description       text not null default '',
  price_sar         numeric(10,2),
  duration_months   integer check (duration_months is null or duration_months between 1 and 60),
  private_quota     integer not null default 0 check (private_quota >= 0),
  checkout_url      text,
  sort_order        integer not null default 0,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.plans enable row level security;

drop policy if exists "read active plans" on public.plans;
create policy "read active plans" on public.plans
  for select to anon, authenticated using (active or public.is_admin());

drop policy if exists "admin writes plans" on public.plans;
create policy "admin writes plans" on public.plans
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select on public.plans to anon, authenticated;
grant insert, update, delete on public.plans to authenticated;

-- بذرة: الباقتان المعتمدتان في صفحة الموقع، وكل باقة يحملها عضو فعلاً.
-- لا سعر ولا رصيد مُختلَق: تملؤهما الإدارة. الحقل الفارغ يعني «غير محدد»
-- ويظهر كذلك، ورقمٌ من عندي يظهر كأنه معتمد.
insert into public.plans (name, sort_order)
select v.name, v.ord
from (values ('برونزية', 1), ('ماسية', 2)) as v(name, ord)
where not exists (select 1 from public.plans p where p.name = v.name);

insert into public.plans (name, sort_order)
select distinct pr.plan, 50
from public.profiles pr
where pr.plan is not null and btrim(pr.plan) <> ''
  and not exists (select 1 from public.plans p where p.name = pr.plan);

-- ------------------------------------------------------------
-- 2) الدفع ليس تغييرَ باقة
--    ترقية الأدمن قرار إداري. اعتبارها دفعاً يجعل سجلّ المدفوعات كذباً.
-- ------------------------------------------------------------
alter table public.subscription_events
  add column if not exists paid boolean not null default false;
alter table public.subscription_events
  add column if not exists payment_ref text;

alter table public.profiles
  add column if not exists last_payment_at timestamptz;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 3) قراءة الباقات
--    من الجدول لا من باقات الأعضاء.
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
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'description', p.description,
      'price_sar', p.price_sar, 'duration_months', p.duration_months,
      'private_quota', p.private_quota, 'checkout_url', p.checkout_url,
      'sort_order', p.sort_order, 'active', p.active,
      'members', (select count(*) from public.profiles pr where pr.plan = p.name))
      order by p.sort_order, p.name)
    from public.plans p), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_plans() from public;
grant execute on function public.admin_plans() to authenticated;

create or replace function public.admin_save_plan(
  p_id uuid, p_name text, p_description text default '',
  p_price numeric default null, p_duration integer default null,
  p_quota integer default 0, p_checkout text default null,
  p_sort integer default 0, p_active boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare nm text; old_name text; rid uuid;
begin
  if not public.is_admin() then
    raise exception 'هذه العملية للإدارة وحدها' using errcode = '42501';
  end if;

  nm := nullif(btrim(coalesce(p_name, '')), '');
  if nm is null then return jsonb_build_object('error', 'اسم الباقة مطلوب'); end if;

  if exists (select 1 from public.plans
             where name = nm and (p_id is null or id <> p_id)) then
    return jsonb_build_object('error', 'توجد باقة بهذا الاسم');
  end if;

  if p_id is null then
    insert into public.plans
      (name, description, price_sar, duration_months, private_quota,
       checkout_url, sort_order, active)
    values (nm, coalesce(p_description, ''), p_price, p_duration,
            coalesce(p_quota, 0), nullif(btrim(coalesce(p_checkout, '')), ''),
            coalesce(p_sort, 0), coalesce(p_active, true))
    returning id into rid;
    return jsonb_build_object('ok', true, 'id', rid, 'message', 'أُضيفت الباقة.');
  end if;

  select name into old_name from public.plans where id = p_id;
  if not found then return jsonb_build_object('error', 'الباقة غير موجودة'); end if;

  update public.plans
     set name = nm, description = coalesce(p_description, ''),
         price_sar = p_price, duration_months = p_duration,
         private_quota = coalesce(p_quota, 0),
         checkout_url = nullif(btrim(coalesce(p_checkout, '')), ''),
         sort_order = coalesce(p_sort, 0), active = coalesce(p_active, true),
         updated_at = now()
   where id = p_id;

  -- اسم الباقة مخزّن نصاً في profiles. تغييره هنا دون هناك يترك أعضاءً
  -- على باقة لم تعد موجودة.
  if old_name is distinct from nm then
    update public.profiles set plan = nm where plan = old_name;
  end if;

  return jsonb_build_object('ok', true, 'id', p_id, 'message', 'حُفظت الباقة.');
end;
$$;

revoke all on function public.admin_save_plan(uuid, text, text, numeric, integer, integer, text, integer, boolean) from public;
grant execute on function public.admin_save_plan(uuid, text, text, numeric, integer, integer, text, integer, boolean) to authenticated;

create or replace function public.admin_delete_plan(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare nm text; n integer;
begin
  if not public.is_admin() then
    raise exception 'هذه العملية للإدارة وحدها' using errcode = '42501';
  end if;

  select name into nm from public.plans where id = p_id;
  if not found then return jsonb_build_object('error', 'الباقة غير موجودة'); end if;

  select count(*) into n from public.profiles where plan = nm;
  if n > 0 then
    -- الحذف يترك أعضاءً على باقة معدومة. التعطيل يخفيها عن الجديد
    -- ويُبقي القديم مفهوماً.
    update public.plans set active = false, updated_at = now() where id = p_id;
    return jsonb_build_object('ok', true, 'deactivated', true,
      'message', 'عليها ' || n || ' عضواً، فعُطِّلت بدل حذفها.');
  end if;

  delete from public.plans where id = p_id;
  return jsonb_build_object('ok', true, 'message', 'حُذفت الباقة.');
end;
$$;

revoke all on function public.admin_delete_plan(uuid) from public;
grant execute on function public.admin_delete_plan(uuid) to authenticated;

-- ------------------------------------------------------------
-- 4) تغيير الباقة — قرار إداري لا دفع
--    تُعيد كتابة دالة الهجرة 14 لتقرأ الباقات من الجدول، وتسجّل
--    paid = false دائماً: الترقية اليدوية ليست دفعاً.
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
  if not exists (select 1 from public.plans where name = new_plan) then
    return jsonb_build_object('error', 'باقة غير معتمدة. أضفها من إدارة الباقات أولاً.');
  end if;
  if new_plan is not distinct from p.plan then
    return jsonb_build_object('ok', true, 'unchanged', true,
                              'message', 'الباقة كما هي، لم يُغيَّر شيء.');
  end if;

  update public.profiles set plan = new_plan where id = p_user;

  insert into public.subscription_events
    (user_id, kind, plan_before, plan_after, status_before, status_after,
     expires_at, note, actor_id, paid)
  values
    (p_user, 'plan_change', p.plan, new_plan, p.subscription_status,
     p.subscription_status, p.subscription_expires_at, p_note, auth.uid(), false);

  return jsonb_build_object('ok', true, 'plan', new_plan, 'paid', false,
    'message', 'تغيّرت الباقة من «' || coalesce(p.plan, '—') ||
               '» إلى «' || new_plan || '». تغيير إداري، لم يُسجَّل دفع.');
end;
$$;

revoke all on function public.admin_set_plan(uuid, text, text) from public;
grant execute on function public.admin_set_plan(uuid, text, text) to authenticated;

-- ------------------------------------------------------------
-- 5) التجديد — بتأكيد الدفع أو بدونه
--    p_paid يميّز «وصلني المبلغ» عن «أفتح له مؤقتاً». كلاهما يفتح
--    المحتوى، والفرق يبقى في السجل ولا يضيع.
-- ------------------------------------------------------------
create or replace function public.admin_renew_subscription(
  p_user       uuid,
  p_months     integer default 1,
  p_plan       text default null,
  p_note       text default null,
  p_paid       boolean default false,
  p_payment_ref text default null)
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

  if new_plan is not null
     and not exists (select 1 from public.plans where name = new_plan) then
    return jsonb_build_object('error', 'باقة غير معتمدة. أضفها من إدارة الباقات أولاً.');
  end if;

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
         last_payment_at         = case when p_paid then now() else last_payment_at end,
         status                  = case when status = 'active' then status else 'active' end
   where id = p_user;

  insert into public.subscription_events
    (user_id, kind, plan_before, plan_after, status_before, status_after,
     starts_at, expires_at, months, note, actor_id, paid, payment_ref)
  values
    (p_user, 'renew', p.plan, new_plan, p.subscription_status, 'active',
     starts, ends, p_months, p_note, auth.uid(), coalesce(p_paid, false),
     nullif(btrim(coalesce(p_payment_ref, '')), ''));

  return jsonb_build_object(
    'ok', true, 'plan', new_plan, 'starts_at', starts, 'expires_at', ends,
    'extended', was_active, 'paid', coalesce(p_paid, false),
    'message', (case when was_active
      then 'أُضيف ' || public.ar_months(p_months) || ' إلى الاشتراك النافذ.'
      else 'جُدِّد الاشتراك ' || public.ar_months(p_months) || ' ابتداءً من اليوم.' end)
      || (case when coalesce(p_paid, false)
               then ' وسُجِّل الدفع.' else ' بلا تسجيل دفع.' end));
end;
$$;

revoke all on function public.admin_renew_subscription(uuid, integer, text, text, boolean, text) from public;
grant execute on function public.admin_renew_subscription(uuid, integer, text, text, boolean, text) to authenticated;

-- نسخة الهجرة 14 ذات الأربعة وسائط تُسقَط صراحةً. بقاؤها مع نسخة
-- الستة ذات القيم الافتراضية يجعل نداءً بأربعة وسائط ملتبساً بينهما،
-- فيردّ Postgres: function is not unique. والنداءات القديمة تقع على
-- النسخة الجديدة لأن وسيطيها الأخيرين لهما قيمتان افتراضيتان.
drop function if exists public.admin_renew_subscription(uuid, integer, text, text);
