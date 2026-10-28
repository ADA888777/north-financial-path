-- ============================================================
-- نورث للمسار المالي — الهجرة الرابعة
-- عضوية مغلقة: الحسابات تُنشأ من لوحة الإدارة فقط
--
-- تُشغَّل بعد 01 و 02 و 03. آمنة لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) أعمدة الاشتراك واسم المستخدم
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists username                text,
  add column if not exists subscription_status     text not null default 'inactive',
  add column if not exists subscription_expires_at timestamptz,
  add column if not exists must_change_password    boolean not null default true;

do $$
begin
  alter table public.profiles
    add constraint profiles_sub_status_chk
    check (subscription_status in ('active','expired','inactive','cancelled'));
exception when duplicate_object then null;
end $$;

-- اسم المستخدم فريد بصرف النظر عن حالة الأحرف
create unique index if not exists profiles_username_key
  on public.profiles (lower(username)) where username is not null;

create index if not exists profiles_sub_idx
  on public.profiles (subscription_status, subscription_expires_at);

-- ------------------------------------------------------------
-- 2) منع المشترك من تعديل ما ليس له
--    صلاحيات على مستوى الأعمدة أقوى من شرط داخل السياسة: حتى لو
--    أُسيئت كتابة السياسة لاحقاً، تبقى بقية الأعمدة ممنوعة.
-- ------------------------------------------------------------
revoke update on public.profiles from authenticated;
grant  update (full_name, phone) on public.profiles to authenticated;

-- السياسة تبقى للتحكم في الصفوف: كل مشترك صفه هو فقط
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ------------------------------------------------------------
-- 3) هل الاشتراك نافذ؟ تُستخدم لبوابة المحتوى المدفوع.
--    التاريخ الفارغ يعني اشتراكاً بلا نهاية محددة.
-- ------------------------------------------------------------
create or replace function public.has_active_subscription(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = uid
      and status = 'active'
      and subscription_status = 'active'
      and (subscription_expires_at is null or subscription_expires_at > now())
  );
$$;

revoke all on function public.has_active_subscription(uuid) from public;
grant execute on function public.has_active_subscription(uuid) to authenticated;

-- ------------------------------------------------------------
-- 4) إنهاء الاشتراكات المنتهية تلقائياً عند القراءة
--    (تُنادى من اللوحة؛ لا تعتمد على مهمة مجدولة)
-- ------------------------------------------------------------
create or replace function public.expire_subscriptions()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n integer;
begin
  if not public.is_admin() then
    raise exception 'هذه العملية للإدارة فقط';
  end if;

  update public.profiles
  set subscription_status = 'expired'
  where subscription_status = 'active'
    and subscription_expires_at is not null
    and subscription_expires_at <= now();

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.expire_subscriptions() from public;
grant execute on function public.expire_subscriptions() to authenticated;

-- ------------------------------------------------------------
-- 5) التسجيل الذاتي ممنوع
--    أوقف "Allow new users to sign up" من:
--    Authentication ← Sign In / Providers ← Email
--    هذا يمنع signUp من الـ API حتى لو نودي مباشرة بالمفتاح العلني.
-- ------------------------------------------------------------

notify pgrst, 'reload schema';

-- تحقق
select
  (select count(*) from public.profiles) as الأعضاء,
  (select count(*) from public.profiles where username is not null) as لديهم_اسم_مستخدم,
  (select count(*) from public.profiles where subscription_status = 'active') as اشتراك_نافذ;
