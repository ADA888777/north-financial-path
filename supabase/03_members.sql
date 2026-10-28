-- ============================================================
-- نورث للمسار المالي — الهجرة الثالثة
-- بيانات الأعضاء: البريد ورقم العضوية والباقة وحالة الحساب
--
-- تُشغَّل بعد 01 و 02. آمنة لإعادة التشغيل.
-- ============================================================

alter table public.profiles
  add column if not exists email          text,
  add column if not exists membership_no  text,
  add column if not exists plan           text,
  add column if not exists created_by     uuid references auth.users(id);

-- رقم العضوية فريد حين يوجد، ويقبل الفراغ للحسابات القديمة
create unique index if not exists profiles_membership_no_key
  on public.profiles (membership_no) where membership_no is not null;

create index if not exists profiles_created_idx on public.profiles (created_at desc);

-- ------------------------------------------------------------
-- توليد رقم عضوية تسلسلي: N-2026-0001
-- ------------------------------------------------------------
create sequence if not exists public.membership_seq start 1;

create or replace function public.next_membership_no()
returns text
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select 'N-' || to_char(now(), 'YYYY') || '-' ||
         lpad(nextval('public.membership_seq')::text, 4, '0');
$$;

revoke all on function public.next_membership_no() from public;
grant execute on function public.next_membership_no() to authenticated;

-- ------------------------------------------------------------
-- نسخ البريد إلى profiles عند التسجيل، وملء رقم العضوية
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name, phone, membership_no)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    coalesce(new.raw_user_meta_data->>'phone', new.phone),
    public.next_membership_no()
  )
  on conflict (id) do update
    set email = excluded.email;

  insert into public.user_roles (user_id, role)
  values (new.id, 'user')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- تعبئة الحسابات الموجودة مسبقاً
-- ------------------------------------------------------------
insert into public.profiles (id, email)
select u.id, u.email from auth.users u
on conflict (id) do nothing;

update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id and (p.email is null or p.email <> u.email);

update public.profiles
set membership_no = public.next_membership_no()
where membership_no is null;

-- ------------------------------------------------------------
-- تحديث ذاكرة PostgREST حتى ترى الأعمدة الجديدة فوراً
-- ------------------------------------------------------------
notify pgrst, 'reload schema';

-- تحقق
select count(*) as أعضاء,
       count(*) filter (where membership_no is not null) as لديهم_رقم_عضوية
from public.profiles;
