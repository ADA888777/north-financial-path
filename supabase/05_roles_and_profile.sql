-- ============================================================
-- نورث للمسار المالي — الهجرة الخامسة
-- دور المحللة، وضبط ما يملك المشترك تعديله
--
-- تُشغَّل بعد 01..04. آمنة لإعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) دور ثالث: المحللة / مقدّمة الكلاس
-- ------------------------------------------------------------
alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles
  add constraint user_roles_role_check
  check (role in ('user', 'admin', 'analyst'));

create or replace function public.is_analyst(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = uid and role = 'analyst'
  );
$$;

revoke all on function public.is_analyst(uuid) from public;
grant execute on function public.is_analyst(uuid) to authenticated;

-- الدور المعروض للواجهة. يقرأ المستخدم دوره هو فقط.
create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select role from public.user_roles where user_id = auth.uid()),
    'user'
  );
$$;

revoke all on function public.my_role() from public;
grant execute on function public.my_role() to authenticated;

-- المحللة ليست أدمن: is_admin تفحص الدور 'admin' وحده، فلا توسعة هنا.
-- صلاحياتها تُقيَّد بجدول الحجوزات حين يُنشأ، ولا تُمنح وصولاً عاماً
-- إلى profiles. سياسات profiles الحالية تمنعها بالفعل من رؤية غيرها.

-- ------------------------------------------------------------
-- 2) ما يملك المشترك تعديله
--    تأكيد صلاحيات الأعمدة: الاسم والجوال فقط.
--    رقم العضوية واسم المستخدم والباقة وحالة الاشتراك وحالة الحساب
--    والدور كلها خارج متناوله حتى لو نادى الـ API مباشرة.
-- ------------------------------------------------------------
revoke update on public.profiles from authenticated;
grant  update (full_name, phone) on public.profiles to authenticated;

-- ------------------------------------------------------------
-- 3) طبقة ثانية: مشغّل يرفض أي تغيير في الحقول المحمية
--    صلاحيات الأعمدة تكفي، وهذا احتياط لو مُنحت صلاحية أوسع سهواً.
-- ------------------------------------------------------------
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  if new.membership_no    is distinct from old.membership_no
     or new.username              is distinct from old.username
     or new.plan                  is distinct from old.plan
     or new.subscription_status   is distinct from old.subscription_status
     or new.subscription_expires_at is distinct from old.subscription_expires_at
     or new.status               is distinct from old.status
     or new.email                is distinct from old.email
     or new.created_by           is distinct from old.created_by
  then
    raise exception 'لا يمكن تعديل هذه البيانات من الحساب الشخصي';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_update on public.profiles;
create trigger profiles_guard_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ------------------------------------------------------------
-- 4) المشترك يعلن أنه غيّر كلمة مروره
--    must_change_password محمي من التعديل المباشر، فيُطفأ بدالة.
-- ------------------------------------------------------------
create or replace function public.mark_password_changed()
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  update public.profiles
  set must_change_password = false
  where id = auth.uid();
$$;

revoke all on function public.mark_password_changed() from public;
grant execute on function public.mark_password_changed() to authenticated;

notify pgrst, 'reload schema';

-- تحقق
select role, count(*) from public.user_roles group by role order by role;
