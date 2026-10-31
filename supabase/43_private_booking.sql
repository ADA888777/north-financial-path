-- ============================================================
-- ٤٣) الكلاسات الخاصة: ٣٠ دقيقة، الاثنين–الخميس، ولا حجز مزدوج
--
-- ما طلبته العميلة: جلسة ٣٠ دقيقة، من الاثنين إلى الخميس، من ٦
-- إلى ١١ مساءً بتوقيت الرياض، مربوطة بتوفّر الكوتش لا بقائمة
-- أوقات ثابتة، ومنعُ الحجز المزدوج حتى لو ضغط اثنان في اللحظة
-- نفسها، وإعادة جدولة تحترم سياسة الـ١٢ ساعة.
--
-- المنطق موجود: coach_slots() تبني الشبكة من coach_availability
-- و booking_policy و slot_min، و book_private() تتحقّق من كل ذلك
-- مرّة أخرى قبل الكتابة. الناقص ثلاثة:
--
--   ١) منع التزامن. فحصُ «هل الموعد محجوز؟» ثم الإدراج فجوةٌ بين
--      لحظتين: طلبان متوازيان يمرّان من الفحص معاً ثم يكتبان معاً.
--      القيد الاستبعادي يغلقها في القاعدة، لا بترتيب الكود.
--
--   ٢) الإعدادات. المدة ٦٠ والأيام من الأحد — تُضبط هنا، وبحذر:
--      لا يُمسّ ما عدّلته الإدارة، فقط ما بقي على القيمة الأولى.
--
--   ٣) جدول توفّر للكوتشات. بلا صفوف في coach_availability تعود
--      coach_slots فارغةً دائماً — وهذا سبب خلوّ قائمة المواعيد.
--      يُبذَر لمن لا جدول لها أصلاً، ولا يُمسّ جدولٌ قائم.
--
-- وأُضيفت reschedule_booking(): كانت الصفحة تعد بإعادة الجدولة
-- ولا دالة تنفّذها، فالوحيد المتاح إلغاءٌ ثم حجزٌ من جديد.
--
-- الهجرة idempotent.
-- ============================================================

create extension if not exists btree_gist;

-- ------------------------------------------------------------
-- ١) لا موعدان متداخلان لكوتش واحد — في القاعدة
--
--    نهاية الموعد في دالة immutable لأن الفهرس لا يقبل غيرها.
--    و«timestamptz + interval» stable في العموم: الفاصل الذي فيه
--    أيامٌ أو شهور يتبع المنطقة الزمنية (التوقيت الصيفي). أما فاصل
--    دقائق محضة فلا حقل تقويمياً فيه، والجمع حسابٌ على اللحظة
--    المطلقة لا يستشير منطقةً ولا تقويماً — فالوسم صادق هنا.
--    ولهذا تُكتب بـ«دقائق × interval» لا بـ make_interval: لا يدخلها
--    يومٌ ولا شهر مهما كان المُدخَل.
-- ------------------------------------------------------------
create or replace function public.slot_end(p_start timestamptz, p_mins integer)
returns timestamptz
language sql
immutable
parallel safe
as $$ select p_start + (coalesce(p_mins, 60) * interval '1 minute'); $$;

do $mig$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'class_slots_coach_no_overlap') then
    begin
      alter table public.class_slots
        add constraint class_slots_coach_no_overlap
        exclude using gist (
          coach_id with =,
          tstzrange(starts_at, public.slot_end(starts_at, duration_min)) with &&
        )
        where (kind = 'private' and status = 'scheduled' and coach_id is not null);
    exception when others then
      -- بيانات قائمة فيها تداخل: القيد لا يُضاف، والهجرة لا تسقط.
      -- الرسالة تُخبر الإدارة أيّ المواعيد تحتاج تنظيفاً.
      raise warning 'تعذّر إضافة قيد منع التداخل (%). راجعي المواعيد الخاصة المتداخلة ثم أعيدي تشغيل الهجرة.', sqlerrm;
    end;
  end if;
end;
$mig$;

-- ------------------------------------------------------------
-- ٢) مدة الجلسة ٣٠ دقيقة
--    الافتراض للجديد، والتعديل لمن بقيت على الستّين وحدها.
-- ------------------------------------------------------------
alter table public.coaches alter column slot_min set default 30;
update public.coaches set slot_min = 30 where slot_min = 60;

-- ------------------------------------------------------------
-- ٣) نافذة الحجز: الاثنين–الخميس، ٦–١١ مساءً
--    لا تُمسّ إن غيّرتها الإدارة.
-- ------------------------------------------------------------
update public.booking_policy
set open_weekdays = '{1,2,3,4}', updated_at = now()
where id and open_weekdays = '{0,1,2,3,4}';

-- ------------------------------------------------------------
-- ٤) جدول التوفّر لمن لا جدول لها
-- ------------------------------------------------------------
do $mig$
declare c record; n integer := 0;
begin
  for c in select id, name from public.coaches where active loop
    if not exists (select 1 from public.coach_availability where coach_id = c.id) then
      insert into public.coach_availability (coach_id, weekday, start_time, end_time, active)
      select c.id, w, '18:00'::time, '23:00'::time, true
      from unnest(array[1,2,3,4]::smallint[]) w;
      n := n + 1;
    end if;
  end loop;
  if n > 0 then
    raise notice 'بُذر جدول توفّر (الاثنين–الخميس ٦–١١ مساءً) لـ % كوتش بلا جدول.', n;
  end if;
end;
$mig$;

-- ------------------------------------------------------------
-- ٥) إعادة الجدولة
--    نقلُ الموعد نفسه لا إلغاءٌ وحجزٌ جديد: الرصيد لا يُمسّ،
--    والتقييم والملاحظة يبقيان مع الحجز.
--    قبل الموعد بـ١٢ ساعة فأكثر فقط — وإلا فهي إلغاء متأخر
--    يُحتسب، فتُترك للعميلة تختاره صراحةً من زرّ الإلغاء.
-- ------------------------------------------------------------
create or replace function public.reschedule_booking(p_booking uuid, p_start timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  uid uuid := auth.uid();
  b   record;
  c   record;
  pol public.booking_policy;
  wd  smallint;
  lt  time;
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;

  select b2.id, b2.slot_id, b2.status, cs.starts_at, cs.kind, cs.coach_id,
         cs.duration_min
    into b
  from public.bookings b2
  join public.class_slots cs on cs.id = b2.slot_id
  where b2.id = p_booking and b2.user_id = uid;

  if not found then return jsonb_build_object('error', 'الحجز غير موجود'); end if;
  if b.status <> 'booked' then
    return jsonb_build_object('error', 'هذا الحجز غير قابل لإعادة الجدولة.');
  end if;
  if b.kind <> 'private' then
    return jsonb_build_object('error', 'إعادة الجدولة للجلسات الخاصة وحدها.');
  end if;
  if b.starts_at < now() + interval '12 hour' then
    return jsonb_build_object('error',
      'بقي أقل من ١٢ ساعة على الجلسة. إعادة الجدولة الآن تُحتسب من رصيدك، ' ||
      'فإن أردتِها ألغي الحجز ثم احجزي موعداً جديداً.');
  end if;

  select * into c from public.coaches where id = b.coach_id and active;
  if not found then return jsonb_build_object('error', 'الكوتش غير متاح'); end if;
  select * into pol from public.booking_policy where id;

  if p_start is null or p_start <= now() + interval '2 hour' then
    return jsonb_build_object('error', 'اختاري موعداً بعد ساعتين على الأقل من الآن.');
  end if;

  wd := extract(dow from (p_start at time zone 'Asia/Riyadh'))::smallint;
  lt := (p_start at time zone 'Asia/Riyadh')::time;

  if not (wd = any(pol.open_weekdays)) then
    return jsonb_build_object('error', 'هذا اليوم خارج أيام الحجز.');
  end if;
  if lt < pol.open_from
     or (lt + (c.slot_min || ' minutes')::interval) > pol.open_to then
    return jsonb_build_object('error',
      'الحجز بين ' || to_char(pol.open_from, 'HH12:MI AM') ||
      ' و' || to_char(pol.open_to, 'HH12:MI AM') || ' بتوقيت الرياض.');
  end if;
  if not exists (
    select 1 from public.coach_availability av
    where av.coach_id = c.id and av.active and av.weekday = wd
      and lt >= av.start_time
      and (lt + (c.slot_min || ' minutes')::interval) <= av.end_time)
  then
    return jsonb_build_object('error', 'هذا الموعد خارج جدول الكوتش.');
  end if;

  -- النقل نفسه: القيد الاستبعادي هو الفاصل عند التزامن، والرسالة
  -- المفهومة تأتي من الاستثناء لا من فحصٍ يسبقه بلحظة.
  begin
    update public.class_slots
    set starts_at = p_start, duration_min = c.slot_min
    where id = b.slot_id;
  exception when exclusion_violation then
    return jsonb_build_object('error', 'حُجز هذا الموعد للتوّ. اختاري موعداً آخر.');
  end;

  return jsonb_build_object('ok', true, 'starts_at', p_start,
    'message', 'نُقلت جلستك إلى الموعد الجديد. لم يُحتسب شيء من رصيدك.');
end;
$fn$;

revoke all on function public.reschedule_booking(uuid, timestamptz) from public;
grant execute on function public.reschedule_booking(uuid, timestamptz) to authenticated;

-- ------------------------------------------------------------
-- ٦) رسالة التزامن في book_private من القيد لا من الفحص
--    الفحص السابق يبقى لأنه يعطي الرسالة في الحالة الشائعة؛
--    هذا يمسك اللحظة التي يفلت منها.
-- ------------------------------------------------------------
create or replace function public.book_private(
  p_coach uuid, p_start timestamptz, p_telegram text default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
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

  wd := extract(dow from (p_start at time zone 'Asia/Riyadh'))::smallint;
  lt := (p_start at time zone 'Asia/Riyadh')::time;
  if not (wd = any(pol.open_weekdays)) then
    return jsonb_build_object('error', 'هذا اليوم خارج أيام الحجز.');
  end if;
  if lt < pol.open_from
     or (lt + (c.slot_min || ' minutes')::interval) > pol.open_to then
    return jsonb_build_object('error',
      'الحجز بين ' || to_char(pol.open_from, 'HH12:MI AM') ||
      ' و' || to_char(pol.open_to, 'HH12:MI AM') || ' بتوقيت الرياض.');
  end if;

  if not exists (
    select 1 from public.coach_availability av
    where av.coach_id = p_coach and av.active
      and av.weekday = wd
      and lt >= av.start_time
      and (lt + (c.slot_min || ' minutes')::interval) <= av.end_time)
  then
    return jsonb_build_object('error', 'هذا الموعد خارج جدول الكوتش.');
  end if;

  if exists (
    select 1 from public.class_slots cs
    where cs.coach_id = p_coach and cs.kind = 'private'
      and cs.status = 'scheduled'
      and cs.starts_at < p_start + (c.slot_min || ' minutes')::interval
      and p_start < cs.starts_at + make_interval(mins => coalesce(cs.duration_min, c.slot_min)))
  then
    return jsonb_build_object('error', 'حُجز هذا الموعد للتوّ. اختاري موعداً آخر.');
  end if;

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

  begin
    insert into public.class_slots
      (title, description, starts_at, duration_min, capacity, kind, coach_id,
       status, published, created_by)
    values ('جلسة خاصة مع ' || c.name, coalesce(p_note, ''), p_start, c.slot_min, 1,
            'private', p_coach, 'scheduled', true, uid)
    returning id into slot;
  exception when exclusion_violation then
    -- طلبان في اللحظة نفسها: الفحص أعلاه مرّ بهما، والقيد ردّ أحدهما
    return jsonb_build_object('error', 'حُجز هذا الموعد للتوّ. اختاري موعداً آخر.');
  end;

  insert into public.bookings (slot_id, user_id, status, note, telegram)
  values (slot, uid, 'booked', p_note, tg)
  returning id into bk;

  return jsonb_build_object('ok', true, 'booking_id', bk, 'slot_id', slot,
    'left', ((public.my_private_quota())->>'left')::int,
    'message', 'تم الحجز. يصلك التأكيد والتفاصيل.');
end;
$fn$;

revoke all on function public.book_private(uuid, timestamptz, text, text) from public;
grant execute on function public.book_private(uuid, timestamptz, text, text) to authenticated;

notify pgrst, 'reload schema';
