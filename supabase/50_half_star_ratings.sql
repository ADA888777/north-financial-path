-- ============================================================
-- ٥٠) التقييم: نجمة، أو نصف نجمة، أو لا نجمة — ومعها السبب
--
-- الخمس نجوم كانت مقياس زيارةٍ واحدة: من تحجز مرّة تعطي خمساً
-- ومن تحجز عشراً تعطي ثلاثاً، فيتأرجح المتوسط بما لا يصف الكوتش.
-- والعميلة هنا تعود: الجلسة الواحدة تستحقّ حكماً واحداً صغيراً،
-- والحصيلة تتراكم. فصار لكل جلسةٍ نجمة كاملة أو نصف أو لا شيء،
-- ومجموعُها هو رصيد الكوتش الذي يكبر بعمله لا بحماس زائرة.
--
-- ومن أعطت أقلّ من نجمةٍ كاملة تكتب السبب: رقمٌ ناقص بلا سبب
-- عقوبةٌ لا يستطيع الكوتش إصلاحها. السبب يصل الكوتش والإدارة
-- وحدهما — لا يُنشر لبقيّة العميلات.
--
-- تحويل ما سبق بلا حذف: ١-٢ ← لا نجمة، ٣ ← نصف، ٤-٥ ← نجمة.
-- وشرط السبب يُضاف NOT VALID: يلزم كل تقييمٍ جديد أو مُعدَّل،
-- ولا يرفض صفّاً قديماً سُجّل قبل القاعدة — ولا نخترع له سبباً.
--
-- المجموع والمتوسط محسوبان من الصفوف، فلا تكتبهما الإدارة يدوياً.
--
-- الهجرة idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- ١) السلّم الجديد: 0 أو 0.5 أو 1
-- ------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'coach_ratings'
      and column_name = 'stars' and data_type = 'smallint')
  then
    alter table public.coach_ratings drop constraint if exists coach_ratings_stars_check;
    alter table public.coach_ratings alter column stars drop default;
    alter table public.coach_ratings
      alter column stars type numeric(2,1)
      using (case when stars >= 4 then 1.0 when stars = 3 then 0.5 else 0.0 end)::numeric(2,1);
  end if;
end $$;

alter table public.coach_ratings drop constraint if exists coach_ratings_stars_check;
alter table public.coach_ratings
  add constraint coach_ratings_stars_check check (stars in (0, 0.5, 1));

-- السبب لازمٌ لكل ما دون النجمة الكاملة. NOT VALID: يحرس الجديد
-- ولا يرفض القديم — فلا يُحذف تقييمٌ ولا يُلفَّق له سبب.
alter table public.coach_ratings drop constraint if exists coach_ratings_reason_required;
alter table public.coach_ratings
  add constraint coach_ratings_reason_required
  check (stars = 1 or length(btrim(comment)) > 0) not valid;

-- ------------------------------------------------------------
-- ٢) تسجيل التقييم
-- ------------------------------------------------------------
drop function if exists public.rate_coach(uuid, integer, text);

create or replace function public.rate_coach(
  p_booking uuid, p_stars numeric, p_comment text default null)
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
  why     text := left(btrim(coalesce(p_comment, '')), 400);
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;

  if p_stars is null or p_stars not in (0, 0.5, 1) then
    return jsonb_build_object('error', 'التقييم: نجمة، أو نصف نجمة، أو بدون نجمة.');
  end if;

  -- أقلّ من نجمة ⇐ السبب لازم. الشرط في الخادم لا في المتصفّح.
  if p_stars < 1 and why = '' then
    return jsonb_build_object('error',
      'اكتبي سبب التقييم حتى يعرف الكوتش ما الذي ينقص.');
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

  ends_at := public.slot_end(b.starts_at, b.duration_min);
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
  values (p_booking, b.coach_id, uid, p_stars, why)
  on conflict (booking_id) do update
    set stars = excluded.stars, comment = excluded.comment, updated_at = now();

  return jsonb_build_object('ok', true, 'stars', p_stars,
    'message', case when existed then 'حُدِّث تقييمك.' else 'شكراً، سُجّل تقييمك.' end);
end;
$$;

revoke all on function public.rate_coach(uuid, numeric, text) from public;
grant execute on function public.rate_coach(uuid, numeric, text) to authenticated;

-- ------------------------------------------------------------
-- ٣) جلسات تنتظر التقييم — ومعها سببُ ما سُجّل
-- ------------------------------------------------------------
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
      'my_reason', r.comment,
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
-- ٤) بطاقة الكوتش: الرصيد مجموعُ ما كُسب
--    المجموع يكبر بالجلسات لا بسخاء زائرة واحدة. والمتوسط يبقى
--    محسوباً للإدارة، والعدد ليُقرأ المجموع في سياقه.
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
      'stars_total', coalesce(rt.total, 0),
      'rating_avg', rt.avg_stars,      -- null حين لا تقييمات: لا صفر وهميّ
      'rating_count', coalesce(rt.n, 0),
      'days', coalesce((
        select jsonb_agg(distinct av.weekday order by av.weekday)
        from public.coach_availability av
        where av.coach_id = c.id and av.active), '[]'::jsonb))
      order by c.sort_order, c.name)
    from public.coaches c
    left join lateral (
      select sum(r.stars)::numeric as total,
             round(avg(r.stars)::numeric, 2) as avg_stars,
             count(*)::int as n
      from public.coach_ratings r where r.coach_id = c.id) rt on true
    where c.active), '[]'::jsonb);
end;
$$;

revoke all on function public.active_coaches() from public;
grant execute on function public.active_coaches() to authenticated;

-- ------------------------------------------------------------
-- ٥) لوحة الإدارة: الأسباب كما كُتبت، والمجموع محسوب لا مكتوب
-- ------------------------------------------------------------
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
        'total', coalesce(rt.total, 0),
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
        select sum(r.stars)::numeric as total,
               round(avg(r.stars)::numeric, 2) as avg_stars,
               count(*)::int as n
        from public.coach_ratings r where r.coach_id = c.id) rt on true
      where p_coach is null or c.id = p_coach), '[]'::jsonb)
  end;
$$;

revoke all on function public.admin_coach_ratings(uuid) from public;
grant execute on function public.admin_coach_ratings(uuid) to authenticated;

notify pgrst, 'reload schema';
