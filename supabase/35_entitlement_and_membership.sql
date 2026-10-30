-- ============================================================
-- ٣٥) استحقاق الجلسات الخاصة، ورقم العضوية بيد الإدارة
--
-- ١) book_private كانت تفحص الرصيد المتبقي وحده:
--       if (q->>'left')::int <= 0 then «استنفدتِ رصيد جلساتك»
--    فمن لا تمنحها باقتها جلسةً أصلاً كانت تُمنع — وهذا صحيح —
--    لكن برسالةٍ تقول إنها استهلكت رصيداً لم يكن لها قط. الحالة
--    المحسوبة في my_private_quota تفرّق بين الأمرين، فصارت هي
--    الحَكَم هنا كما في الواجهة.
--
-- ٢) رقم العضوية لم يكن يُعدَّل من أي مكان: الحارس على profiles
--    يرفضه من الحساب الشخصي، ولا دالة إدارية تضبطه. صار للإدارة
--    بابٌ واحد يتحقّق من الصيغة ومن عدم التكرار ويسجّل التغيير.
-- ============================================================

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

  -- الاستحقاق قبل الرصيد: لمن لا تمنحها باقتها جلسةً لا يُقال
  -- «استنفدتِ رصيدك»، فذلك إخبارٌ بغير الواقع.
  if (q->>'state') = 'no_plan' then
    return jsonb_build_object('error',
      'باقتك «' || coalesce(q->>'plan', '—') ||
      '» غير مُعدّة في المنصة. أبلغي الإدارة.');
  end if;
  if (q->>'state') = 'inactive' then
    return jsonb_build_object('error', 'اشتراكك غير نافذ. جدّديه لتستأنفي الحجز.');
  end if;
  if (q->>'state') = 'not_included' then
    return jsonb_build_object('error',
      'باقة ' || coalesce(q->>'plan', '') || ' لا تتضمّن جلسات خاصة.');
  end if;
  if (q->>'state') <> 'ok' or (q->>'left')::int <= 0 then
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

-- ------------------------------------------------------------
-- رقم العضوية: تضبطه الإدارة، ولا يتكرّر
-- ------------------------------------------------------------
create or replace function public.admin_set_membership_no(p_user uuid, p_no text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare p public.profiles; no text;
begin
  p := public.admin_target(p_user);

  no := nullif(btrim(coalesce(p_no, '')), '');
  if no is null then
    return jsonb_build_object('error', 'رقم العضوية لا يصحّ فارغاً');
  end if;
  if length(no) > 32 then
    return jsonb_build_object('error', 'رقم العضوية أطول من 32 خانة');
  end if;

  -- التكرار يُمنع هنا وفي فهرس فريد على الجدول: الرسالة من هنا،
  -- والضمان من هناك — فطلبان متزامنان لا يمرّان معاً.
  if exists (select 1 from public.profiles
             where membership_no = no and id <> p_user) then
    return jsonb_build_object('error', 'رقم العضوية مستعمل لعضو آخر');
  end if;

  if no is not distinct from p.membership_no then
    return jsonb_build_object('ok', true, 'unchanged', true,
      'membership_no', no, 'message', 'لا تغيير يُحفظ.');
  end if;

  update public.profiles set membership_no = no where id = p_user;

  insert into public.member_events (user_id, field, old_value, new_value, actor_id)
  values (p_user, 'membership_no', p.membership_no, no, auth.uid());

  return jsonb_build_object('ok', true, 'membership_no', no,
    'message', 'حُفظ رقم العضوية.');
exception
  when unique_violation then
    return jsonb_build_object('error', 'رقم العضوية مستعمل لعضو آخر');
end;
$$;

revoke all on function public.admin_set_membership_no(uuid, text) from public;
grant execute on function public.admin_set_membership_no(uuid, text) to authenticated;

notify pgrst, 'reload schema';
