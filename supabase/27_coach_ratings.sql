-- ============================================================
-- 27: تقييم الكوتش بعد حضور فعلي، ونافذة الحجز، ومعرّف تيليجرام
--
--   أ) التقييم لا يُمنح إلا لمن حضرت جلستها فعلاً. انتهاء الوقت
--      ليس حضوراً: الحضور حالة يسجّلها الكوتش أو الإدارة.
--   ب) نافذة الحجز: الأحد–الخميس ٦–١١ مساءً بتوقيت الرياض، تُدار
--      من اللوحة ويُقاس عليها توفّر كل كوتش.
--   ج) لا جلستان متداخلتان لكوتش واحد — كان التحقّق على تطابق
--      البداية فقط، فـ٦:٠٠ و٦:٣٠ كانتا تمرّان معاً.
--   د) معرّف تيليجرام تكتبه المتعلمة بنفسها: بيانات تواصلها.
-- ============================================================

-- ------------------------------------------------------------
-- أ-١) الحضور: من سجّله ومتى
--      العميلة لا تملك تغييره — سياسة RLS على bookings تمنعها،
--      والدالة أدناه تقبل الأدمن وحده.
-- ------------------------------------------------------------
alter table public.bookings add column if not exists attended_at timestamptz;
alter table public.bookings add column if not exists attendance_by uuid;

comment on column public.bookings.attended_at is
  'لحظة تسجيل الحضور الفعلي. انتهاء وقت الجلسة وحده ليس حضوراً.';

create or replace function public.admin_set_attendance(
  p_booking uuid, p_status text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare b record; ends_at timestamptz;
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'غير مصرّح');
  end if;
  if p_status not in ('attended', 'no_show', 'booked') then
    return jsonb_build_object('error', 'حالة غير معروفة');
  end if;

  select b2.id, b2.user_id, cs.starts_at, cs.duration_min, cs.kind
    into b
  from public.bookings b2
  join public.class_slots cs on cs.id = b2.slot_id
  where b2.id = p_booking;

  if not found then return jsonb_build_object('error', 'الحجز غير موجود'); end if;

  ends_at := b.starts_at + make_interval(mins => coalesce(b.duration_min, 60));
  if p_status = 'attended' and now() < ends_at then
    return jsonb_build_object('error', 'لم تنتهِ الجلسة بعد. لا يُسجَّل حضور قبل انتهائها.');
  end if;

  update public.bookings
  set status = p_status,
      attended_at = case when p_status = 'attended' then now() else null end,
      attendance_by = case when p_status = 'attended' then auth.uid() else null end
  where id = p_booking;

  perform public.log_admin('attendance', b.user_id,
    'حجز ' || p_booking::text,
    'الحالة: ' || p_status || coalesce(' — ' || p_note, ''),
    jsonb_build_object('booking', p_booking, 'status', p_status));

  return jsonb_build_object('ok', true, 'status', p_status,
    'message', case p_status
      when 'attended' then 'سُجّل الحضور. صار بإمكانها تقييم الكوتش.'
      when 'no_show'  then 'سُجّل عدم الحضور.'
      else 'أُعيدت الحالة إلى محجوزة.' end);
end;
$$;

revoke all on function public.admin_set_attendance(uuid, text, text) from public;
grant execute on function public.admin_set_attendance(uuid, text, text) to authenticated;

-- ------------------------------------------------------------
-- أ-٢) التقييمات
--      المفتاح الأساسي هو الحجز: تقييم واحد لكل جلسة، لا بالكود
--      بل بالقاعدة. والكتابة تمرّ بدالة واحدة تتحقّق من كل شرط.
-- ------------------------------------------------------------
create table if not exists public.coach_ratings (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  coach_id   uuid not null references public.coaches(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  stars      smallint not null check (stars between 1 and 5),
  comment    text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists coach_ratings_coach_idx
  on public.coach_ratings (coach_id, created_at desc);

alter table public.coach_ratings enable row level security;

-- تقرأ المتعلمة تقييمها هي، والإدارة تقرأ الكل.
-- المتوسط يصل الجميع محسوباً من الدالة، لا بقراءة الصفوف.
drop policy if exists ratings_read on public.coach_ratings;
create policy ratings_read on public.coach_ratings
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- لا كتابة مباشرة إطلاقاً: الشروط كلها في rate_coach().
drop policy if exists ratings_no_write on public.coach_ratings;
create policy ratings_no_write on public.coach_ratings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select on public.coach_ratings to authenticated;
revoke insert, update, delete on public.coach_ratings from authenticated;

drop trigger if exists coach_ratings_touch on public.coach_ratings;
create trigger coach_ratings_touch before update on public.coach_ratings
  for each row execute function public.touch_updated_at();

-- سياسة التعديل: هل يُسمح بتغيير تقييم مُسجَّل؟ قرار إداري.
create table if not exists public.booking_policy (
  id           boolean primary key default true check (id),
  allow_recoat boolean not null default false,   -- تعديل تقييم مُسجَّل
  open_weekdays smallint[] not null default '{0,1,2,3,4}',  -- ٠ الأحد … ٦ السبت
  open_from    time not null default '18:00',
  open_to      time not null default '23:00',
  require_telegram boolean not null default true,
  updated_at   timestamptz not null default now()
);

insert into public.booking_policy (id) values (true) on conflict (id) do nothing;

alter table public.booking_policy enable row level security;

drop policy if exists policy_read on public.booking_policy;
create policy policy_read on public.booking_policy
  for select to authenticated using (true);

drop policy if exists policy_write on public.booking_policy;
create policy policy_write on public.booking_policy
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select on public.booking_policy to authenticated;
grant insert, update on public.booking_policy to authenticated;

-- ------------------------------------------------------------
-- أ-٣) تسجيل التقييم
-- ------------------------------------------------------------
create or replace function public.rate_coach(
  p_booking uuid, p_stars integer, p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid     uuid := auth.uid();
  b       record;
  ends_at timestamptz;
  pol     public.booking_policy;
  existed boolean;
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;
  if p_stars is null or p_stars < 1 or p_stars > 5 then
    return jsonb_build_object('error', 'التقييم من نجمة إلى خمس.');
  end if;

  select b2.id, b2.user_id, b2.status, cs.coach_id, cs.kind,
         cs.starts_at, cs.duration_min, cs.status as slot_status
    into b
  from public.bookings b2
  join public.class_slots cs on cs.id = b2.slot_id
  where b2.id = p_booking;

  if not found then return jsonb_build_object('error', 'الحجز غير موجود'); end if;

  -- حجزها هي، لا حجز غيرها
  if b.user_id <> uid then
    return jsonb_build_object('error', 'هذا ليس حجزك');
  end if;
  if b.kind <> 'private' or b.coach_id is null then
    return jsonb_build_object('error', 'التقييم للجلسات الخاصة مع كوتش.');
  end if;

  ends_at := b.starts_at + make_interval(mins => coalesce(b.duration_min, 60));
  if now() < ends_at then
    return jsonb_build_object('error', 'الجلسة لم تنتهِ بعد.');
  end if;

  -- الشرط الحاسم: حضور مسجَّل، لا مجرّد وقت انقضى
  if b.status <> 'attended' then
    return jsonb_build_object('error',
      'التقييم بعد حضور الجلسة. لم يُسجَّل حضورك لهذه الجلسة.');
  end if;

  select * into pol from public.booking_policy where id;

  existed := exists (select 1 from public.coach_ratings where booking_id = p_booking);
  if existed and not coalesce(pol.allow_recoat, false) then
    return jsonb_build_object('error', 'قيّمتِ هذه الجلسة من قبل.');
  end if;

  insert into public.coach_ratings (booking_id, coach_id, user_id, stars, comment)
  values (p_booking, b.coach_id, uid, p_stars::smallint,
          left(btrim(coalesce(p_comment, '')), 400))
  on conflict (booking_id) do update
    set stars = excluded.stars, comment = excluded.comment, updated_at = now();

  return jsonb_build_object('ok', true, 'stars', p_stars,
    'message', case when existed then 'حُدِّث تقييمك.' else 'شكراً، سُجّل تقييمك.' end);
end;
$$;

revoke all on function public.rate_coach(uuid, integer, text) from public;
grant execute on function public.rate_coach(uuid, integer, text) to authenticated;

-- جلسات تنتظر تقييمها: حضرتها ولم تقيّمها بعد
create or replace function public.my_ratable_sessions()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'booking_id', b.id,
      'coach_id', c.id,
      'coach', c.name,
      'photo_path', c.photo_path,
      'starts_at', cs.starts_at,
      'my_stars', r.stars,
      'rated', r.booking_id is not null)
      order by cs.starts_at desc), '[]'::jsonb)
  from public.bookings b
  join public.class_slots cs on cs.id = b.slot_id
  join public.coaches c on c.id = cs.coach_id
  left join public.coach_ratings r on r.booking_id = b.id
  where b.user_id = auth.uid()
    and cs.kind = 'private'
    and b.status = 'attended'
    and (r.booking_id is null
         or coalesce((select allow_recoat from public.booking_policy where id), false));
$$;

revoke all on function public.my_ratable_sessions() from public;
grant execute on function public.my_ratable_sessions() to authenticated;

-- ------------------------------------------------------------
-- ب) نافذة الحجز — الأحد إلى الخميس، ٦ إلى ١١ مساءً
--
--    تُدار من booking_policy، ويُقاس عليها توفّر كل كوتش: صفّ توفّر
--    خارجها لا يُقبل، ومولّد المواعيد يرشّحها مرة أخرى. طبقتان لأن
--    صفّاً قديماً قد يكون أُدخل قبل القاعدة.
-- ------------------------------------------------------------
create or replace function public.guard_coach_availability()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare pol public.booking_policy;
begin
  select * into pol from public.booking_policy where id;
  if not found then return new; end if;

  if not (new.weekday = any(pol.open_weekdays)) then
    raise exception 'يوم % خارج أيام العمل المعتمدة (الأحد إلى الخميس).', new.weekday;
  end if;
  if new.start_time < pol.open_from or new.end_time > pol.open_to then
    raise exception 'الوقت خارج ساعات العمل المعتمدة (% إلى %).',
      pol.open_from, pol.open_to;
  end if;

  return new;
end;
$$;

drop trigger if exists coach_availability_window on public.coach_availability;
create trigger coach_availability_window
  before insert or update on public.coach_availability
  for each row execute function public.guard_coach_availability();

-- ------------------------------------------------------------
-- ج) مولّد المواعيد: النافذة، والتداخل، والمحجوز
-- ------------------------------------------------------------
create or replace function public.coach_slots(p_coach uuid, p_days integer default 21)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  c   record;
  pol public.booking_policy;
  res jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'غير مصرّح'); end if;

  select * into c from public.coaches where id = p_coach and active;
  if not found then return jsonb_build_object('error', 'الكوتش غير متاح'); end if;

  select * into pol from public.booking_policy where id;

  select coalesce(jsonb_agg(jsonb_build_object('starts_at', s.ts) order by s.ts), '[]'::jsonb)
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
    -- time + interval يلتفّ حول منتصف الليل.
    where (d.day + av.start_time + ((n.i + 1) * (c.slot_min || ' minutes')::interval))
          <= (d.day + av.end_time)
      -- النافذة المعتمدة، ولو كان صفّ التوفّر أقدم من القاعدة
      and extract(dow from d.day)::smallint = any(pol.open_weekdays)
      and (av.start_time + (n.i * (c.slot_min || ' minutes')::interval)) >= pol.open_from
      and (av.start_time + ((n.i + 1) * (c.slot_min || ' minutes')::interval)) <= pol.open_to
  ) s
  where s.ts > now() + interval '2 hour'
    -- لا تداخل: أي جلسة مجدولة للكوتش تتقاطع مع هذا الموعد تُسقطه.
    -- كان الشرط تطابق البداية، فـ٦:٠٠ و٦:٣٠ تمرّان معاً.
    and not exists (
      select 1 from public.class_slots cs
      where cs.coach_id = p_coach and cs.kind = 'private'
        and cs.status = 'scheduled'
        and cs.starts_at < s.ts + (c.slot_min || ' minutes')::interval
        and s.ts < cs.starts_at + make_interval(mins => coalesce(cs.duration_min, c.slot_min)));

  return jsonb_build_object('coach', c.name, 'slot_min', c.slot_min, 'slots', res);
end;
$$;

revoke all on function public.coach_slots(uuid, integer) from public;
grant execute on function public.coach_slots(uuid, integer) to authenticated;

-- ------------------------------------------------------------
-- بطاقة الكوتش: تقييم فعليّ بدل الوصف
--    المتوسط محسوب من coach_ratings، فلا يمكن لأحد كتابته يدوياً.
-- ------------------------------------------------------------
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
      'id', c.id, 'name', c.name, 'title', c.title,
      'photo_path', c.photo_path, 'slot_min', c.slot_min,
      'rating_avg', rt.avg_stars,      -- null حين لا تقييمات: لا صفر وهميّ
      'rating_count', coalesce(rt.n, 0),
      'days', coalesce((
        select jsonb_agg(distinct av.weekday order by av.weekday)
        from public.coach_availability av
        where av.coach_id = c.id and av.active), '[]'::jsonb))
      order by c.sort_order, c.name)
    from public.coaches c
    left join lateral (
      select round(avg(r.stars)::numeric, 1) as avg_stars, count(*)::int as n
      from public.coach_ratings r where r.coach_id = c.id) rt on true
    where c.active), '[]'::jsonb);
end;
$$;

revoke all on function public.active_coaches() from public;
grant execute on function public.active_coaches() to authenticated;

-- تقييمات كوتش للإدارة: الصفوف كما هي، والمتوسط محسوب لا مكتوب
create or replace function public.admin_coach_ratings(p_coach uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when not public.is_admin()
    then jsonb_build_object('error','غير مصرّح')
    else coalesce((
      select jsonb_agg(jsonb_build_object(
        'coach_id', c.id, 'coach', c.name,
        'avg', rt.avg_stars, 'count', coalesce(rt.n, 0),
        'ratings', coalesce((
          select jsonb_agg(jsonb_build_object(
            'booking_id', r.booking_id, 'stars', r.stars, 'comment', r.comment,
            'member', p.full_name, 'membership_no', p.membership_no,
            'at', r.created_at) order by r.created_at desc)
          from public.coach_ratings r
          join public.profiles p on p.id = r.user_id
          where r.coach_id = c.id), '[]'::jsonb))
        order by c.sort_order, c.name)
      from public.coaches c
      left join lateral (
        select round(avg(r.stars)::numeric, 1) as avg_stars, count(*)::int as n
        from public.coach_ratings r where r.coach_id = c.id) rt on true
      where p_coach is null or c.id = p_coach), '[]'::jsonb)
  end;
$$;

revoke all on function public.admin_coach_ratings(uuid) from public;
grant execute on function public.admin_coach_ratings(uuid) to authenticated;

-- ------------------------------------------------------------
-- د) معرّف تيليجرام — تكتبه المتعلمة بنفسها
--
--    بيانات الحساب تُعدَّل من الإدارة (الهجرة ٢٤)، وهذا استثناء
--    مقصود: معرّف التواصل ملك صاحبته. يُقبل بـ@ أو بدونها ويُخزَّن
--    بصيغة واحدة، ولا يراه إلا هي والإدارة.
-- ------------------------------------------------------------
create or replace function public.set_my_telegram(p_handle text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); tg text;
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;

  tg := btrim(coalesce(p_handle, ''));
  tg := regexp_replace(tg, '^@+', '');          -- بـ@ أو بدونها
  tg := regexp_replace(tg, '^https?://t\.me/', '', 'i');

  if tg = '' then
    update public.profiles set telegram = null where id = uid;
    return jsonb_build_object('ok', true, 'telegram', null, 'message', 'حُذف المعرّف.');
  end if;

  -- قاعدة تيليجرام: ٥ إلى ٣٢ خانة، حروف وأرقام وشرطة سفلية
  if tg !~ '^[A-Za-z][A-Za-z0-9_]{4,31}$' then
    return jsonb_build_object('error',
      'المعرّف من ٥ إلى ٣٢ خانة، يبدأ بحرف ويحوي حروفاً وأرقاماً وشرطة سفلية. '
      || 'المطلوب اسم المستخدم مثل ‎@username، لا الاسم الظاهر ولا رقم الجوال.');
  end if;

  update public.profiles set telegram = tg where id = uid;
  return jsonb_build_object('ok', true, 'telegram', '@' || tg, 'message', 'حُفظ معرّفك.');
end;
$$;

revoke all on function public.set_my_telegram(text) from public;
grant execute on function public.set_my_telegram(text) to authenticated;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- هـ) book_private: نفس قواعد المولّد، لا قواعد أرخَص
--
--     المولّد يرشّح، لكنه ليس الحارس: الطلب قد يأتي مباشرة إلى الـAPI
--     بموعد لم يُعرض قط. فكل شرط هنا مكرَّر عمداً.
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
  pol   public.booking_policy;
  q     jsonb;
  slot  uuid;
  bk    uuid;
  tg    text;
  wd    smallint;
  lt    time;
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;
  if not public.has_active_subscription(uid) then
    return jsonb_build_object('error', 'الحجز يتطلب اشتراكاً نافذاً.');
  end if;

  select * into c from public.coaches where id = p_coach and active;
  if not found then return jsonb_build_object('error', 'الكوتش غير متاح'); end if;

  select * into pol from public.booking_policy where id;

  if p_start is null or p_start <= now() + interval '2 hour' then
    return jsonb_build_object('error', 'اختاري موعداً بعد ساعتين على الأقل من الآن.');
  end if;

  q := public.my_private_quota();
  if (q->>'left')::int <= 0 then
    return jsonb_build_object('error',
      'استنفدتِ رصيد جلساتك الخاصة لهذا الشهر (' || (q->>'quota') || ').');
  end if;

  -- معرّف تيليجرام: شرط الحجز متى قرّرته الإدارة
  tg := nullif(btrim(coalesce(p_telegram, '')), '');
  if tg is null then
    select telegram into tg from public.profiles where id = uid;
    tg := nullif(btrim(coalesce(tg, '')), '');
  end if;
  if coalesce(pol.require_telegram, true) and tg is null then
    return jsonb_build_object('error',
      'أضيفي اسم المستخدم في تيليجرام قبل تأكيد الحجز — به يتواصل معك الكوتش.',
      'need_telegram', true);
  end if;

  -- النافذة المعتمدة
  wd := extract(dow from (p_start at time zone 'Asia/Riyadh'))::smallint;
  lt := (p_start at time zone 'Asia/Riyadh')::time;
  if not (wd = any(pol.open_weekdays)) then
    return jsonb_build_object('error', 'الحجز من الأحد إلى الخميس فقط.');
  end if;
  if lt < pol.open_from
     or (lt + (c.slot_min || ' minutes')::interval) > pol.open_to then
    return jsonb_build_object('error',
      'الحجز بين ' || to_char(pol.open_from, 'HH12:MI AM') ||
      ' و' || to_char(pol.open_to, 'HH12:MI AM') || ' بتوقيت الرياض.');
  end if;

  -- ضمن توفّر الكوتش فعلاً
  if not exists (
    select 1 from public.coach_availability av
    where av.coach_id = p_coach and av.active
      and av.weekday = wd
      and lt >= av.start_time
      and (lt + (c.slot_min || ' minutes')::interval) <= av.end_time)
  then
    return jsonb_build_object('error', 'هذا الموعد خارج جدول الكوتش.');
  end if;

  -- لا تداخل مع أي جلسة مجدولة لهذا الكوتش
  if exists (
    select 1 from public.class_slots cs
    where cs.coach_id = p_coach and cs.kind = 'private'
      and cs.status = 'scheduled'
      and cs.starts_at < p_start + (c.slot_min || ' minutes')::interval
      and p_start < cs.starts_at + make_interval(mins => coalesce(cs.duration_min, c.slot_min)))
  then
    return jsonb_build_object('error', 'حُجز هذا الموعد للتوّ. اختاري موعداً آخر.');
  end if;

  -- ولا تداخل مع جلسة أخرى لها هي
  if exists (
    select 1 from public.bookings b
    join public.class_slots cs on cs.id = b.slot_id
    where b.user_id = uid and b.status = 'booked' and cs.status = 'scheduled'
      and cs.starts_at < p_start + (c.slot_min || ' minutes')::interval
      and p_start < cs.starts_at + make_interval(mins => coalesce(cs.duration_min, 60)))
  then
    return jsonb_build_object('error', 'لديكِ حجز يتداخل مع هذا الموعد.');
  end if;

  if tg is not null then
    tg := regexp_replace(tg, '^@+', '');
    update public.profiles set telegram = tg
    where id = uid and telegram is distinct from tg;
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
    'left', ((public.my_private_quota())->>'left')::int,
    'message', 'تم الحجز. يصلك التأكيد والتفاصيل.');
end;
$$;

revoke all on function public.book_private(uuid, timestamptz, text, text) from public;
grant execute on function public.book_private(uuid, timestamptz, text, text) to authenticated;

-- الرصيد يحمل المعرّف وشرطه، فتعرف الواجهة متى تطلبه
create or replace function public.my_private_quota()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  uid   uuid := auth.uid();
  p     public.profiles;
  quota int;
  used  int;
  m0    timestamptz;
  pol   public.booking_policy;
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;

  select * into p from public.profiles where id = uid;
  select coalesce(pl.private_quota, 0) into quota
  from public.plans pl where pl.name = p.plan;
  quota := coalesce(quota, 0);

  select * into pol from public.booking_policy where id;

  m0 := date_trunc('month', (now() at time zone 'Asia/Riyadh')) at time zone 'Asia/Riyadh';

  select count(*) into used
  from public.bookings b
  join public.class_slots cs on cs.id = b.slot_id
  where b.user_id = uid
    and cs.kind = 'private'
    and cs.starts_at >= m0
    and b.status in ('booked', 'attended', 'no_show', 'late_cancel');

  return jsonb_build_object(
    'plan', p.plan,
    'quota', quota,
    'used', used,
    'left', greatest(0, quota - used),
    'month_start', m0,
    'telegram', p.telegram,
    'require_telegram', coalesce(pol.require_telegram, true),
    'open_from', pol.open_from,
    'open_to', pol.open_to,
    'open_weekdays', to_jsonb(pol.open_weekdays),
    'subscription_ok', public.has_active_subscription(uid));
end;
$$;

revoke all on function public.my_private_quota() from public;
grant execute on function public.my_private_quota() to authenticated;

notify pgrst, 'reload schema';
