-- ============================================================
-- نورث للمسار المالي — الهجرة الأولى
-- الأدوار الإدارية + قصص النجاح + تخزين الصور + سياسات RLS
--
-- تُشغَّل مرة واحدة في: Supabase Dashboard > SQL Editor > New query
-- آمنة لإعادة التشغيل (idempotent).
-- ============================================================

-- ------------------------------------------------------------
-- 1) جدول الأدوار
--    الدور يُخزَّن منفصلاً عن profiles حتى لا يستطيع المستخدم
--    ترقية نفسه بتعديل ملفه الشخصي.
-- ------------------------------------------------------------
create table if not exists public.user_roles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null default 'user' check (role in ('user','admin')),
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id)
);

alter table public.user_roles enable row level security;

-- دالة فحص الصلاحية. SECURITY DEFINER حتى تقرأ الجدول
-- بغض النظر عن سياسات الصف، وsearch_path مثبّت ضد حقن الدوال.
create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = uid and role = 'admin'
  );
$$;

revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to authenticated, anon;

-- كل مستخدم يقرأ دوره فقط؛ الأدمن يقرأ الجميع.
drop policy if exists "read own role" on public.user_roles;
create policy "read own role" on public.user_roles
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- لا INSERT ولا UPDATE ولا DELETE لأي دور عبر الـ API.
-- منح الصلاحية يتم من SQL Editor فقط (خطوة 5 أدناه).
-- غياب السياسات = المنع الكامل مع تفعيل RLS.

-- ------------------------------------------------------------
-- 2) ملفات المستخدمين
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  phone      text,
  status     text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and status = (select status from public.profiles where id = auth.uid()));

drop policy if exists "admin manages profiles" on public.profiles;
create policy "admin manages profiles" on public.profiles
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- إنشاء الملف تلقائياً عند التسجيل
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'phone')
  on conflict (id) do nothing;

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
-- 3) قصص النجاح
-- ------------------------------------------------------------
create table if not exists public.success_stories (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (length(btrim(title)) > 0),
  body          text not null default '',
  trainee_name  text,
  show_name     boolean not null default false,
  image_path    text,
  sort_order    integer not null default 0,
  published     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id)
);

create index if not exists success_stories_public_idx
  on public.success_stories (published, sort_order, created_at desc);

alter table public.success_stories enable row level security;

-- الزوار يقرؤون المنشور فقط. المسودة لا تخرج من قاعدة البيانات أصلاً.
drop policy if exists "public reads published stories" on public.success_stories;
create policy "public reads published stories" on public.success_stories
  for select to anon, authenticated
  using (published = true);

-- الأدمن وحده يقرأ كل شيء ويضيف ويعدّل ويحذف.
drop policy if exists "admin reads all stories" on public.success_stories;
create policy "admin reads all stories" on public.success_stories
  for select to authenticated using (public.is_admin());

drop policy if exists "admin writes stories" on public.success_stories;
create policy "admin writes stories" on public.success_stories
  for insert to authenticated with check (public.is_admin());

drop policy if exists "admin updates stories" on public.success_stories;
create policy "admin updates stories" on public.success_stories
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin deletes stories" on public.success_stories;
create policy "admin deletes stories" on public.success_stories
  for delete to authenticated using (public.is_admin());

-- تحديث updated_at تلقائياً
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists success_stories_touch on public.success_stories;
create trigger success_stories_touch
  before update on public.success_stories
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- 4) تخزين صور القصص
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('story-images', 'story-images', true, 3145728,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = 3145728,
      allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "public reads story images" on storage.objects;
create policy "public reads story images" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'story-images');

drop policy if exists "admin uploads story images" on storage.objects;
create policy "admin uploads story images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'story-images' and public.is_admin());

drop policy if exists "admin updates story images" on storage.objects;
create policy "admin updates story images" on storage.objects
  for update to authenticated
  using (bucket_id = 'story-images' and public.is_admin());

drop policy if exists "admin deletes story images" on storage.objects;
create policy "admin deletes story images" on storage.objects
  for delete to authenticated
  using (bucket_id = 'story-images' and public.is_admin());

-- ------------------------------------------------------------
-- 5) منح صلاحية الإدارة
--    شغّل هذا الجزء بعد التأكد أن الحساب موجود فعلاً في Authentication > Users.
--    يفشل عمداً إذا لم يكن البريد مسجلاً، بدل أن ينشئ دوراً معلّقاً.
-- ------------------------------------------------------------
do $$
declare
  target_email text := 'alnorthofficial@gmail.com';
  uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(target_email);

  if uid is null then
    raise exception
      'الحساب % غير موجود في نظام المصادقة. أنشئه أولاً من Authentication > Users > Add user، ثم أعد تشغيل هذا الجزء.',
      target_email;
  end if;

  -- not exists لا on conflict: المشغّل الحارس (الهجرة ٤٢) يسحب رقم
  -- عضوية قبل أن يُكتشف التعارض، فكل إعادة تشغيل كانت تحرق رقماً.
  insert into public.profiles (id)
  select uid where not exists (select 1 from public.profiles where id = uid);

  insert into public.user_roles (user_id, role, granted_by)
  values (uid, 'admin', uid)
  on conflict (user_id) do update set role = 'admin', granted_at = now();

  raise notice 'تم منح صلاحية الإدارة للمستخدم % (%)', target_email, uid;
end $$;

-- ------------------------------------------------------------
-- 6) تحقق
-- ------------------------------------------------------------
select u.email, r.role, r.granted_at
from public.user_roles r
join auth.users u on u.id = r.user_id
where r.role = 'admin';
