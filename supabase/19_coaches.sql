-- ============================================================
-- نورث للمسار المالي — الهجرة التاسعة عشرة
-- الكوتشات وجداول التوفّر، والحصص بنوعيها
--
-- الفرق بين النوعين بحقل kind لا بالسعة: حصة جماعية بمقعد واحد متبقٍ
-- ليست كلاساً خاصاً.
--
-- المواعيد الخاصة تُولَّد من جدول توفّر الكوتش الأسبوعي، فلا تُدخل
-- الإدارة مئات الصفوف يدوياً.
--
-- تُشغَّل بعد 18.
-- ============================================================

-- ------------------------------------------------------------
-- 1) الكوتشات
-- ------------------------------------------------------------
create table if not exists public.coaches (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) > 0),
  title      text not null default '',
  bio        text not null default '',
  photo_path text,
  telegram   text,
  slot_min   integer not null default 60 check (slot_min between 15 and 180),
  active     boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.coaches enable row level security;

drop policy if exists "read active coaches" on public.coaches;
create policy "read active coaches" on public.coaches
  for select to authenticated using (active or public.is_admin());

drop policy if exists "admin writes coaches" on public.coaches;
create policy "admin writes coaches" on public.coaches
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select on public.coaches to authenticated;
grant insert, update, delete on public.coaches to authenticated;

-- ------------------------------------------------------------
-- 2) التوفّر الأسبوعي
--    يوم الأسبوع بتقويم Postgres: 0 الأحد … 6 السبت.
--    الأوقات بتوقيت الرياض، وهو التوقيت المعتمد للمشروع.
-- ------------------------------------------------------------
create table if not exists public.coach_availability (
  id         uuid primary key default gen_random_uuid(),
  coach_id   uuid not null references public.coaches(id) on delete cascade,
  weekday    smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time   time not null,
  active     boolean not null default true,
  check (end_time > start_time)
);

create index if not exists coach_avail_idx
  on public.coach_availability (coach_id, weekday);

alter table public.coach_availability enable row level security;

drop policy if exists "read availability" on public.coach_availability;
create policy "read availability" on public.coach_availability
  for select to authenticated using (true);

drop policy if exists "admin writes availability" on public.coach_availability;
create policy "admin writes availability" on public.coach_availability
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select on public.coach_availability to authenticated;
grant insert, update, delete on public.coach_availability to authenticated;

-- ------------------------------------------------------------
-- 3) الحصة تعرف كوتشها
-- ------------------------------------------------------------
alter table public.class_slots
  add column if not exists coach_id uuid references public.coaches(id) on delete set null;

create index if not exists class_slots_coach_idx
  on public.class_slots (coach_id, starts_at);

-- معرّف تيليجرام للتنسيق، يكتبه المتعلم عند الحجز
alter table public.profiles add column if not exists telegram text;
alter table public.bookings add column if not exists telegram text;

-- إلغاء متأخر: يُحتسب من الرصيد حسب السياسة
do $$ begin
  alter table public.bookings drop constraint bookings_status_check;
exception when undefined_object then null; end $$;

do $$ begin
  alter table public.bookings add constraint bookings_status_check
    check (status in ('booked', 'attended', 'no_show', 'cancelled', 'late_cancel'));
exception when duplicate_object then null; end $$;

alter table public.bookings add column if not exists cancelled_at timestamptz;

-- ------------------------------------------------------------
-- 4) رصيد الجلسات الخاصة
--    من باقة العضو لا من رقم في الواجهة. الشهر تقويمي بتوقيت الرياض.
--    الإلغاء المتأخر وعدم الحضور يُحتسبان، والإلغاء المبكر لا يُحتسب.
-- ------------------------------------------------------------
create or replace function public.my_private_quota()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  uid   uuid := auth.uid();
  p     record;
  quota integer;
  used  integer;
  m0    timestamptz;
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;

  select * into p from public.profiles where id = uid;
  select coalesce(pl.private_quota, 0) into quota
  from public.plans pl where pl.name = p.plan;
  quota := coalesce(quota, 0);

  m0 := date_trunc('month', (now() at time zone 'Asia/Riyadh')) at time zone 'Asia/Riyadh';

  select count(*) into used
  from public.bookings b
  join public.class_slots cs on cs.id = b.slot_id
  where b.user_id = uid and cs.kind = 'private'
    and cs.starts_at >= m0
    and b.status in ('booked', 'attended', 'no_show', 'late_cancel');

  return jsonb_build_object(
    'plan', p.plan,
    'quota', quota,
    'used', used,
    'left', greatest(0, quota - used),
    'month_start', m0,
    'subscription_ok', public.has_active_subscription(uid));
end;
$$;

revoke all on function public.my_private_quota() from public;
grant execute on function public.my_private_quota() to authenticated;

-- ------------------------------------------------------------
-- 5) المواعيد المتاحة لكوتش
--    تُولَّد من توفّره الأسبوعي، وتُطرح منها المحجوزة والماضية.
--    التوليد في الخادم: لو حُسب في المتصفح لاختلف بين جهاز وآخر.
-- ------------------------------------------------------------
create or replace function public.coach_slots(
  p_coach uuid, p_days integer default 21)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); c record; res jsonb;
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;
  if not (public.is_admin() or public.has_active_subscription()) then
    return jsonb_build_object('error', 'الحجز متاح للمشتركين باشتراك نافذ.');
  end if;

  select * into c from public.coaches where id = p_coach and active;
  if not found then return jsonb_build_object('error', 'الكوتش غير متاح'); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'starts_at', s.ts, 'duration_min', c.slot_min) order by s.ts), '[]'::jsonb)
    into res
  from (
    select (d.day + av.start_time + (n.i * (c.slot_min || ' minutes')::interval))
             at time zone 'Asia/Riyadh' as ts
    from generate_series(
           (now() at time zone 'Asia/Riyadh')::date,
           (now() at time zone 'Asia/Riyadh')::date + greatest(1, p_days),
           interval '1 day') d(day)
    join public.coach_availability av
      on av.coach_id = p_coach and av.active
     and av.weekday = extract(dow from d.day)::smallint
    cross join generate_series(0, 23) n(i)
    -- المقارنة على الطابع الزمني لا على الوقت وحده: في Postgres
    -- time + interval يلتفّ حول منتصف الليل، فـ 16:00 + 8h = 00:00
    -- ويجتاز شرط «<= 20:00»، فتظهر مواعيد في الثالثة فجراً.
    where (d.day + av.start_time + ((n.i + 1) * (c.slot_min || ' minutes')::interval))
          <= (d.day + av.end_time)
  ) s
  where s.ts > now() + interval '2 hour'          -- لا حجز للحظة الحالية
    and not exists (
      select 1 from public.class_slots cs
      where cs.coach_id = p_coach and cs.kind = 'private'
        and cs.status = 'scheduled' and cs.starts_at = s.ts);

  return jsonb_build_object('coach', c.name, 'slot_min', c.slot_min, 'slots', res);
end;
$$;

revoke all on function public.coach_slots(uuid, integer) from public;
grant execute on function public.coach_slots(uuid, integer) to authenticated;

-- ------------------------------------------------------------
-- 6) حجز جلسة خاصة
--    إنشاء الحصة والحجز في عملية واحدة: لو أُنشئت الحصة ثم فشل الحجز
--    بقي موعدٌ محجوز لا أحد فيه.
-- ------------------------------------------------------------
create or replace function public.book_private(
  p_coach uuid, p_start timestamptz, p_telegram text default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid   uuid := auth.uid();
  c     record;
  q     jsonb;
  slot  uuid;
  bk    uuid;
  tg    text;
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;
  if not public.has_active_subscription(uid) then
    return jsonb_build_object('error', 'الحجز يتطلب اشتراكاً نافذاً.');
  end if;

  select * into c from public.coaches where id = p_coach and active;
  if not found then return jsonb_build_object('error', 'الكوتش غير متاح'); end if;

  if p_start is null or p_start <= now() + interval '2 hour' then
    return jsonb_build_object('error', 'اختر موعداً بعد ساعتين على الأقل من الآن.');
  end if;

  q := public.my_private_quota();
  if (q->>'left')::int <= 0 then
    return jsonb_build_object('error',
      'استنفدت رصيد جلساتك الخاصة لهذا الشهر (' || (q->>'quota') || ').');
  end if;

  -- الموعد ضمن توفّر الكوتش فعلاً
  if not exists (
    select 1 from public.coach_availability av
    where av.coach_id = p_coach and av.active
      and av.weekday = extract(dow from (p_start at time zone 'Asia/Riyadh'))::smallint
      and (p_start at time zone 'Asia/Riyadh')::time >= av.start_time
      and ((p_start at time zone 'Asia/Riyadh')::time
           + (c.slot_min || ' minutes')::interval) <= av.end_time)
  then
    return jsonb_build_object('error', 'هذا الموعد خارج جدول الكوتش.');
  end if;

  -- لا حجزان في الموعد نفسه، لا للكوتش ولا للمتعلم
  if exists (select 1 from public.class_slots cs
             where cs.coach_id = p_coach and cs.kind = 'private'
               and cs.status = 'scheduled' and cs.starts_at = p_start) then
    return jsonb_build_object('error', 'حُجز هذا الموعد للتوّ. اختر موعداً آخر.');
  end if;

  if exists (select 1 from public.bookings b
             join public.class_slots cs on cs.id = b.slot_id
             where b.user_id = uid and b.status = 'booked'
               and cs.status = 'scheduled' and cs.starts_at = p_start) then
    return jsonb_build_object('error', 'لديك حجز في هذا الموعد بالفعل.');
  end if;

  tg := nullif(btrim(coalesce(p_telegram, '')), '');
  if tg is not null then
    tg := regexp_replace(tg, '^@', '');
    update public.profiles set telegram = tg where id = uid and telegram is distinct from tg;
  end if;

  insert into public.class_slots
    (title, description, starts_at, duration_min, capacity, kind, coach_id,
     status, published, created_by)
  values ('جلسة خاصة مع ' || c.name, coalesce(p_note, ''), p_start, c.slot_min, 1,
          'private', p_coach, 'scheduled', true, uid)
  returning id into slot;

  insert into public.bookings (slot_id, user_id, status, note, telegram)
  values (slot, uid, 'booked', p_note, tg)
  returning id into bk;

  return jsonb_build_object('ok', true, 'booking_id', bk, 'slot_id', slot,
    'starts_at', p_start, 'coach', c.name,
    'left', ((public.my_private_quota())->>'left')::int,
    'message', 'تم حجز جلستك مع ' || c.name || '.');
end;
$$;

revoke all on function public.book_private(uuid, timestamptz, text, text) from public;
grant execute on function public.book_private(uuid, timestamptz, text, text) to authenticated;

-- ------------------------------------------------------------
-- 7) الإلغاء
--    قبل اثنتي عشرة ساعة فأكثر: لا يُحتسب من الرصيد.
--    بعدها: يُحتسب، وهذا معروض للمتعلم قبل الحجز.
-- ------------------------------------------------------------
create or replace function public.cancel_booking(p_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); b record; late boolean;
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;

  select b2.id, b2.slot_id, b2.status, cs.starts_at, cs.kind, cs.coach_id
    into b
  from public.bookings b2
  join public.class_slots cs on cs.id = b2.slot_id
  where b2.id = p_booking and b2.user_id = uid;

  if not found then return jsonb_build_object('error', 'الحجز غير موجود'); end if;
  if b.status <> 'booked' then
    return jsonb_build_object('error', 'هذا الحجز غير قابل للإلغاء.');
  end if;
  if b.starts_at <= now() then
    return jsonb_build_object('error', 'مضى موعد هذه الجلسة.');
  end if;

  late := b.starts_at < now() + interval '12 hour';

  update public.bookings
     set status = case when late then 'late_cancel' else 'cancelled' end,
         cancelled_at = now()
   where id = p_booking;

  -- الجلسة الخاصة موعدٌ أُنشئ لهذا الحجز وحده، فيُحرَّر بإلغائه
  if b.kind = 'private' then
    update public.class_slots set status = 'cancelled' where id = b.slot_id;
  end if;

  return jsonb_build_object('ok', true, 'late', late,
    'left', ((public.my_private_quota())->>'left')::int,
    'message', case when late
      then 'أُلغي الحجز. الإلغاء قبل أقل من ١٢ ساعة يُحتسب من رصيدك.'
      else 'أُلغي الحجز ولم يُحتسب من رصيدك.' end);
end;
$$;

revoke all on function public.cancel_booking(uuid) from public;
grant execute on function public.cancel_booking(uuid) to authenticated;

-- ------------------------------------------------------------
-- 8) جلساتي
-- ------------------------------------------------------------
create or replace function public.my_sessions(p_kind text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'booking_id', b.id, 'slot_id', cs.id, 'title', cs.title,
      'kind', cs.kind, 'starts_at', cs.starts_at, 'duration_min', cs.duration_min,
      'status', b.status, 'slot_status', cs.status,
      'coach', co.name, 'coach_id', co.id,
      'telegram', b.telegram,
      'upcoming', cs.starts_at > now(),
      'can_cancel', b.status = 'booked' and cs.starts_at > now(),
      'late_if_cancel', b.status = 'booked' and cs.starts_at < now() + interval '12 hour',
      'meeting_url', case when b.status = 'booked' and cs.status = 'scheduled'
                          then cs.meeting_url else null end)
      order by cs.starts_at desc)
    from public.bookings b
    join public.class_slots cs on cs.id = b.slot_id
    left join public.coaches co on co.id = cs.coach_id
    where b.user_id = uid
      and (p_kind is null or cs.kind = p_kind)), '[]'::jsonb);
end;
$$;

revoke all on function public.my_sessions(text) from public;
grant execute on function public.my_sessions(text) to authenticated;

-- الكوتشات المتاحة للمتعلم
create or replace function public.active_coaches()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'title', c.title, 'bio', c.bio,
      'photo_path', c.photo_path, 'slot_min', c.slot_min,
      'days', coalesce((
        select jsonb_agg(distinct av.weekday order by av.weekday)
        from public.coach_availability av
        where av.coach_id = c.id and av.active), '[]'::jsonb))
      order by c.sort_order, c.name)
    from public.coaches c where c.active), '[]'::jsonb);
end;
$$;

revoke all on function public.active_coaches() from public;
grant execute on function public.active_coaches() to authenticated;

notify pgrst, 'reload schema';
