-- ============================================================
-- 31: الاستحقاق والرصيد شرطان مستقلّان
--
--    حساب ماسيّ نشِط كان يرى رسالتين متناقضتين معاً:
--    «باقتك لا تتضمّن جلسات خاصة» و«استنفدت رصيد جلساتك».
--
--    السبب واحد لا اثنان: plans.private_quota = 0 للباقة الماسية.
--    العمود أُنشئ في الهجرة ١٥ بـ default 0، والباقتان المبذورتان
--    أخذتا الافتراض ولم يضبطه أحد. فالقاعدة تقول «صفر جلسة»،
--    والواجهة تقرأ الصفر مرّتين فتستنتج منه حكمين متناقضين.
--
--    الإصلاح في المصدر: الدالة تقول الحالة صراحةً، فلا تستنتجها
--    الواجهة من رقم. والصفر له معنى واحد: الباقة لا تمنح جلسات.
-- ============================================================
create or replace function public.my_private_quota()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  uid    uuid := auth.uid();
  p      public.profiles;
  pl     public.plans;
  known  boolean;
  quota  int;
  used   int;
  m0     timestamptz;
  pol    public.booking_policy;
  live   boolean;
  st     text;
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;

  select * into p from public.profiles where id = uid;
  if not found then return jsonb_build_object('error', 'الحساب غير موجود'); end if;

  select * into pl from public.plans where name = p.plan;
  known := found;
  quota := coalesce(pl.private_quota, 0);

  select * into pol from public.booking_policy where id;
  live := public.has_active_subscription(uid) and p.status = 'active';

  m0 := date_trunc('month', (now() at time zone 'Asia/Riyadh')) at time zone 'Asia/Riyadh';

  -- الإلغاء المبكر لا يُحتسب؛ المتأخر وعدم الحضور يُحتسبان.
  -- 'cancelled' خارج القائمة عمداً.
  select count(*) into used
  from public.bookings b
  join public.class_slots cs on cs.id = b.slot_id
  where b.user_id = uid
    and cs.kind = 'private'
    and cs.starts_at >= m0
    and b.status in ('booked', 'attended', 'no_show', 'late_cancel');

  /* حالة واحدة صريحة بدل رقمٍ يُستنتج منه حكمان:
       no_plan      اسم باقتها لا صفّ له — خطأ إعداد لا حكمٌ عليها
       inactive     اشتراكها غير نافذ
       not_included باقتها لا تمنح جلسات خاصة أصلاً (quota = 0)
       exhausted    تمنحها، واستنفدتها هذا الشهر
       ok           تستطيع الحجز
  */
  st := case
    when not known      then 'no_plan'
    when not live       then 'inactive'
    when quota <= 0     then 'not_included'
    when used >= quota  then 'exhausted'
    else 'ok' end;

  return jsonb_build_object(
    'plan', p.plan,
    'plan_known', known,
    'subscription_ok', live,
    -- الاستحقاق: هل تمنح باقتها هذه الميزة؟ مستقلّ عن الرصيد المتبقي.
    'entitled', known and quota > 0,
    'quota', quota,
    'used', used,
    'left', greatest(0, quota - used),
    'state', st,
    'month_start', m0,
    'telegram', p.telegram,
    'require_telegram', coalesce(pol.require_telegram, true),
    'slot_min', (select min(c.slot_min) from public.coaches c where c.active),
    'open_from', pol.open_from,
    'open_to', pol.open_to,
    'open_weekdays', to_jsonb(pol.open_weekdays));
end;
$$;

revoke all on function public.my_private_quota() from public;
grant execute on function public.my_private_quota() to authenticated;

-- ------------------------------------------------------------
-- تقرير الباقات يكشف التناقض: باقة تَعِد بتدريب فردي ورصيدها صفر
--
--    ليس حكماً على اختيار الإدارة — باقة بلا جلسات أمرٌ مشروع.
--    لكن أن تُسجَّل لها ميزة «تدريب مباشر فردي» ثم يكون رصيدها صفراً،
--    فهذا وعدٌ في صفحة المشتركة لا يقابله شيء في القاعدة.
-- ------------------------------------------------------------
create or replace function public.admin_plan_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare res jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'غير مصرّح');
  end if;

  select jsonb_build_object(
    'tier_clashes', coalesce((
      select jsonb_agg(x order by x->>'tier')
      from (
        select jsonb_build_object(
                 'tier', p.tier,
                 'plans', jsonb_agg(p.name order by p.sort_order, p.name),
                 'members', (select count(*) from public.profiles pr
                             where pr.plan in (select p2.name from public.plans p2
                                               where p2.active and p2.tier = p.tier))
               ) as x
        from public.plans p
        where p.active
        group by p.tier
        having count(*) > 1
      ) q), '[]'::jsonb),

    'orphan_plans', coalesce((
      select jsonb_agg(jsonb_build_object('plan', t.plan, 'members', t.n)
                       order by t.n desc)
      from (
        select pr.plan, count(*) as n
        from public.profiles pr
        where pr.plan is not null and btrim(pr.plan) <> ''
          and not exists (select 1 from public.plans p where p.name = pr.plan)
        group by pr.plan
      ) t), '[]'::jsonb),

    'inactive_plans', coalesce((
      select jsonb_agg(jsonb_build_object('plan', t.plan, 'members', t.n)
                       order by t.n desc)
      from (
        select pr.plan, count(*) as n
        from public.profiles pr
        join public.plans p on p.name = pr.plan
        where not p.active
        group by pr.plan
      ) t), '[]'::jsonb),

    'no_features', coalesce((
      select jsonb_agg(p.name order by p.tier)
      from public.plans p
      where p.active
        and not exists (select 1 from public.plan_features f
                        where f.plan_id = p.id and f.active)), '[]'::jsonb),

    -- التناقض الجديد: وعدٌ بتدريب فردي ورصيد صفر
    'training_without_quota', coalesce((
      select jsonb_agg(jsonb_build_object(
               'plan', p.name,
               'members', (select count(*) from public.profiles pr where pr.plan = p.name))
             order by p.tier)
      from public.plans p
      where p.active and coalesce(p.private_quota, 0) = 0
        and exists (select 1 from public.plan_features f
                    where f.plan_id = p.id and f.active and f.kind = 'training')),
      '[]'::jsonb),

    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'name', p.name, 'tier', p.tier, 'active', p.active,
               'private_quota', coalesce(p.private_quota, 0),
               'members', (select count(*) from public.profiles pr where pr.plan = p.name))
             order by p.tier, p.sort_order)
      from public.plans p), '[]'::jsonb)
  ) into res;

  return res;
end;
$$;

revoke all on function public.admin_plan_health() from public;
grant execute on function public.admin_plan_health() to authenticated;

notify pgrst, 'reload schema';
