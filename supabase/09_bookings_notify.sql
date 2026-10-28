-- ============================================================
-- نورث للمسار المالي — الهجرة التاسعة
-- المحللة المسؤولة، سجل إشعارات البريد، والمقاعد المتبقية
--
-- تُشغَّل بعد 05_content_and_classes.sql. إضافية بالكامل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) المحللة المسؤولة عن الحصة
--    analyst_id لمن له حساب في النظام، وhost_name للعرض فقط.
-- ------------------------------------------------------------
alter table public.class_slots
  add column if not exists analyst_id    uuid references auth.users(id) on delete set null,
  add column if not exists host_name     text,
  add column if not exists notify_email  text;

create index if not exists slots_analyst_idx on public.class_slots (analyst_id, starts_at);

-- ------------------------------------------------------------
-- 2) سجل الإشعارات
--    المفتاح الفريد (booking_id, kind) يمنع إرسال إشعارين لنفس الحجز.
-- ------------------------------------------------------------
create table if not exists public.booking_notifications (
  id         uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  kind       text not null check (kind in ('analyst','member')),
  to_email   text,
  status     text not null default 'pending'
             check (status in ('pending','sent','failed','skipped')),
  error      text,
  attempts   integer not null default 0,
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  unique (booking_id, kind)
);

create index if not exists notif_status_idx on public.booking_notifications (status, created_at);

alter table public.booking_notifications enable row level security;

-- الإدارة وحدها تطّلع على السجل. المشترك لا يحتاجه.
drop policy if exists "admin reads notifications" on public.booking_notifications;
create policy "admin reads notifications" on public.booking_notifications
  for select to authenticated using (public.is_admin());

-- الكتابة من المشغّل ودالة الخادم فقط، فلا سياسات كتابة.

-- ------------------------------------------------------------
-- 3) كل حجز جديد يفتح صفّي إشعار معلّقين
-- ------------------------------------------------------------
create or replace function public.queue_booking_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  analyst_email text;
  member_email  text;
begin
  select coalesce(s.notify_email, p.email)
    into analyst_email
  from public.class_slots s
  left join public.profiles p on p.id = s.analyst_id
  where s.id = new.slot_id;

  select email into member_email from public.profiles where id = new.user_id;

  insert into public.booking_notifications (booking_id, kind, to_email, status)
  values (new.id, 'analyst', analyst_email,
          case when analyst_email is null then 'skipped' else 'pending' end)
  on conflict do nothing;

  insert into public.booking_notifications (booking_id, kind, to_email, status)
  values (new.id, 'member', member_email,
          case when member_email is null then 'skipped' else 'pending' end)
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists bookings_notify on public.bookings;
create trigger bookings_notify after insert on public.bookings
  for each row execute function public.queue_booking_notifications();

-- ------------------------------------------------------------
-- 4) صلاحية المحللة: حجوزات حصصها هي فقط
--    لا وصول إلى بقية الحجوزات ولا إلى بيانات المشتركين.
-- ------------------------------------------------------------
drop policy if exists "analyst reads own slot bookings" on public.bookings;
create policy "analyst reads own slot bookings" on public.bookings
  for select to authenticated
  using (exists (
    select 1 from public.class_slots s
    where s.id = slot_id and s.analyst_id = auth.uid()
  ));

-- ------------------------------------------------------------
-- 5) المواعيد المتاحة مع المقاعد المتبقية
--    المشترك لا يرى حجوزات غيره بحكم RLS، فلا يستطيع عدّ المحجوز
--    بنفسه. هذه الدالة تعطيه الرقم دون كشف من حجز.
-- ------------------------------------------------------------
create or replace function public.available_slots()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(x order by (x->>'starts_at')), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', s.id,
      'title', s.title,
      'description', s.description,
      'starts_at', s.starts_at,
      'duration_min', s.duration_min,
      'capacity', s.capacity,
      'taken', (select count(*) from public.bookings b where b.slot_id = s.id),
      'seats_left', greatest(s.capacity - (
          select count(*) from public.bookings b where b.slot_id = s.id), 0),
      'host', coalesce(s.host_name, (select p.full_name from public.profiles p
                                     where p.id = s.analyst_id)),
      'mine', exists (select 1 from public.bookings b
                      where b.slot_id = s.id and b.user_id = auth.uid()),
      -- رابط الحضور لمن حجز فقط
      'meeting_url', case when exists (select 1 from public.bookings b
                                       where b.slot_id = s.id and b.user_id = auth.uid())
                          then s.meeting_url else null end
    ) as x
    from public.class_slots s
    where s.published and s.status = 'scheduled' and s.starts_at > now()
  ) t;
$$;

revoke all on function public.available_slots() from public;
grant execute on function public.available_slots() to authenticated;

-- حجوزاتي السابقة والقادمة
create or replace function public.my_bookings()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(x order by (x->>'starts_at') desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', b.id,
      'slot_id', s.id,
      'title', s.title,
      'starts_at', s.starts_at,
      'duration_min', s.duration_min,
      'status', b.status,
      'slot_status', s.status,
      'booked_at', b.created_at,
      'host', coalesce(s.host_name, (select p.full_name from public.profiles p
                                     where p.id = s.analyst_id)),
      'meeting_url', s.meeting_url,
      'upcoming', s.starts_at > now()
    ) as x
    from public.bookings b
    join public.class_slots s on s.id = b.slot_id
    where b.user_id = auth.uid()
  ) t;
$$;

revoke all on function public.my_bookings() from public;
grant execute on function public.my_bookings() to authenticated;

-- ------------------------------------------------------------
-- 6) ما ينتظر الإرسال — تستدعيها دالة الخادم
-- ------------------------------------------------------------
create or replace function public.pending_notifications(p_booking uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', n.id, 'kind', n.kind, 'to_email', n.to_email,
    'member_name', p.full_name, 'member_phone', p.phone,
    'membership_no', p.membership_no,
    'slot_title', s.title, 'starts_at', s.starts_at,
    'duration_min', s.duration_min, 'booked_at', b.created_at
  )), '[]'::jsonb)
  from public.booking_notifications n
  join public.bookings b on b.id = n.booking_id
  join public.class_slots s on s.id = b.slot_id
  join public.profiles p on p.id = b.user_id
  where n.status = 'pending'
    and (p_booking is null or n.booking_id = p_booking);
$$;

revoke all on function public.pending_notifications(uuid) from public;
-- لا تُمنح للواجهة: دالة الخادم وحدها تناديها بمفتاحها السري.

notify pgrst, 'reload schema';

-- تحقق
select status, count(*) from public.booking_notifications group by status;
