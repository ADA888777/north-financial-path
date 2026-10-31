-- ============================================================
-- ٥٣) دورة الاشتراك: شهران أوّلاً، ثم شهرٌ شهراً — تلقائياً وبيد الإدارة
--
-- قاعدة العمل كما وصفتها العميلة:
--   • أول اشتراكٍ للحساب فترته شهران.
--   • كل تجديدٍ بعدها شهرٌ واحد.
--   • قبل الانتهاء بسبعة أيام تذكيرٌ، وعند الانتهاء يُقفل المحتوى
--     من تلقاء نفسه، وتُقرأ لها رسالةٌ تقول ماذا تفعل.
--   • الإدارة ترى كل هذا وتتدخّل فيه إن أخطأ شيء.
--
-- المدّتان ليستا رقمين في الكود: عمودان في الباقة (duration_days
-- للفترة الأولى، وrenewal_days للتجديد) تضبطهما الإدارة من تبويب
-- الباقات. والدالة تختار بينهما بنفسها: حسابٌ لم تكن له فترةٌ قطّ
-- يأخذ الأولى، وما سواه يأخذ التجديد — وللإدارة أن تكتب مدّةً أخرى
-- فتُطاع.
--
-- القفل ليس عمليةً تُشغَّل: effective_sub_status تحسبه من التاريخ
-- لحظة السؤال، فلا يبقى منتهٍ يتصفّح لأنّ وظيفةً مجدولةً تأخّرت.
-- والوظيفة المجدولة تكتب الحالة في الصفّ للتقارير، وترسل التذكير.
--
-- الهجرة idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- ١) مدّة التجديد في الباقة
-- ------------------------------------------------------------
alter table public.plans
  add column if not exists renewal_days integer not null default 30;

alter table public.plans drop constraint if exists plans_renewal_days_chk;
alter table public.plans
  add constraint plans_renewal_days_chk check (renewal_days between 1 and 1830);

-- الفترة الأولى: ما لم تضبطه الإدارة فشهران
update public.plans set duration_days = 60 where duration_days is null;
alter table public.plans alter column duration_days set default 60;

-- ------------------------------------------------------------
-- ٢) effective_sub_status تقرأ now() فهي stable لا immutable
-- ------------------------------------------------------------
create or replace function public.effective_sub_status(
  p_status text, p_expires timestamptz)
returns text
language sql
stable
as $$
  select case
    when p_status is distinct from 'active' then coalesce(p_status, 'inactive')
    when p_expires is null then 'active'            -- اشتراك بلا نهاية محددة
    when p_expires > now() then 'active'
    else 'expired'
  end;
$$;

-- ------------------------------------------------------------
-- ٣) أيّ فترةٍ تأتي بعدُ لهذا الحساب؟
--    «أولى» = لم تُسجَّل له فترةٌ قطّ: لا تاريخ بداية ولا نهاية في
--    ملفه، ولا حدثُ تجديدٍ في سجلّه. وما سواه تجديد.
-- ------------------------------------------------------------
create or replace function public.sub_period(p_user uuid, p_plan text default null)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with p as (select * from public.profiles where id = p_user),
  pl as (
    select * from public.plans
    where name = coalesce(nullif(btrim(coalesce(p_plan, '')), ''), (select plan from p))
  ),
  first as (
    select (select subscription_started_at is null and subscription_expires_at is null from p)
       and not exists (select 1 from public.subscription_events e
                       where e.user_id = p_user and e.expires_at is not null) as f
  )
  select jsonb_build_object(
    'first', (select f from first),
    'days',  case when (select f from first)
                  then coalesce((select duration_days from pl), 60)
                  else coalesce((select renewal_days  from pl), 30) end,
    'label', case when (select f from first) then 'اشتراك أول' else 'تجديد' end);
$$;

revoke all on function public.sub_period(uuid, text) from public;
grant execute on function public.sub_period(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- ٤) التجديد: المدّة تلقائية، والبداية والنهاية قابلتان للضبط
--    التوقيع تغيّر فتُحذف النسخة القديمة أولاً — نسختان بالاسم نفسه
--    تُربك PostgREST عند النداء بالاسم.
-- ------------------------------------------------------------
drop function if exists public.admin_renew_days(uuid, integer, text, text, boolean, text);

create or replace function public.admin_renew_days(
  p_user uuid, p_days integer default null, p_plan text default null,
  p_note text default null, p_paid boolean default false,
  p_payment_ref text default null,
  p_start timestamptz default null, p_end timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.profiles; new_plan text; days integer; per jsonb;
  starts timestamptz; ends timestamptz; was_active boolean;
begin
  p := public.admin_target(p_user);
  new_plan := coalesce(nullif(btrim(coalesce(p_plan, '')), ''), p.plan);

  if new_plan is null or not exists (select 1 from public.plans where name = new_plan) then
    return jsonb_build_object('error', 'باقة غير معتمدة. أضفها من إدارة الباقات أولاً.');
  end if;

  -- المدّة: ما كتبته الإدارة، وإلا فالمعتمدة لهذه الفترة (أولى/تجديد)
  per  := public.sub_period(p_user, new_plan);
  days := coalesce(p_days, (per->>'days')::int);
  if days < 1 or days > 1830 then
    return jsonb_build_object('error', 'مدة التجديد بين يوم و١٨٣٠ يوماً');
  end if;

  was_active := public.effective_sub_status(
                  p.subscription_status, p.subscription_expires_at) = 'active'
                and p.subscription_expires_at is not null;

  -- البداية: ما حدّدته الإدارة، وإلا فنهاية النافذ (لا تضيع أيامه)، وإلا الآن
  starts := coalesce(p_start, case when was_active then p.subscription_expires_at else now() end);
  ends   := coalesce(p_end, starts + make_interval(days => days));

  if ends <= starts then
    return jsonb_build_object('error', 'تاريخ الانتهاء يجب أن يكون بعد البداية.');
  end if;

  update public.profiles
     set plan = new_plan, subscription_status = 'active',
         subscription_started_at = starts, subscription_expires_at = ends,
         last_payment_at = case when p_paid then now() else last_payment_at end,
         status = case when status = 'active' then status else 'active' end
   where id = p_user;

  insert into public.subscription_events
    (user_id, kind, plan_before, plan_after, status_before, status_after,
     starts_at, expires_at, months, note, actor_id, paid, payment_ref)
  values
    (p_user, 'renew', p.plan, new_plan, p.subscription_status, 'active',
     starts, ends, null,
     (per->>'label') || ' · ' || days || ' يوماً' ||
       case when p_note is null or btrim(p_note) = '' then '' else ' · ' || btrim(p_note) end,
     auth.uid(), coalesce(p_paid, false),
     nullif(btrim(coalesce(p_payment_ref, '')), ''));

  return jsonb_build_object('ok', true, 'plan', new_plan, 'days', days,
    'first', (per->>'first')::boolean,
    'starts_at', starts, 'expires_at', ends, 'extended', was_active and p_start is null,
    'paid', coalesce(p_paid, false),
    'message',
      (per->>'label') || ': ' ||
      (case when was_active and p_start is null
         then 'أُضيف ' || days || ' يوماً إلى الاشتراك النافذ'
         else days || ' يوماً' end) ||
      '، ينتهي ' || to_char(ends at time zone 'Asia/Riyadh', 'YYYY-MM-DD') ||
      (case when coalesce(p_paid, false) then '. وسُجِّل الدفع.' else '.' end));
end;
$$;

revoke all on function public.admin_renew_days(uuid, integer, text, text, boolean, text, timestamptz, timestamptz) from public;
grant execute on function public.admin_renew_days(uuid, integer, text, text, boolean, text, timestamptz, timestamptz) to authenticated;

-- ------------------------------------------------------------
-- ٥) ملف العضو للإدارة: الفترة القادمة ومدّتها، وعلامة الدفع في السجل
-- ------------------------------------------------------------
create or replace function public.admin_member(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare p public.profiles;
begin
  p := public.admin_target(p_user);

  return jsonb_build_object(
    'id', p.id,
    'full_name', p.full_name,
    'email', p.email,
    'phone', p.phone,
    'username', p.username,
    'membership_no', p.membership_no,
    'plan', p.plan,
    'account_status', p.status,
    'subscription_status', p.subscription_status,
    'effective_status', public.effective_sub_status(
                          p.subscription_status, p.subscription_expires_at),
    'subscription_started_at', p.subscription_started_at,
    'subscription_expires_at', p.subscription_expires_at,
    'days_left', case when p.subscription_expires_at is null then null
                      else greatest(0, (p.subscription_expires_at::date - current_date)) end,
    'next_period', public.sub_period(p.id, null),
    'created_at', p.created_at,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'kind', e.kind,
        'plan_before', e.plan_before, 'plan_after', e.plan_after,
        'status_before', e.status_before, 'status_after', e.status_after,
        'starts_at', e.starts_at, 'expires_at', e.expires_at,
        'months', e.months, 'note', e.note, 'created_at', e.created_at,
        'paid', e.paid, 'payment_ref', e.payment_ref,
        'actor', (select a.full_name from public.profiles a where a.id = e.actor_id))
        order by e.created_at desc)
      from public.subscription_events e where e.user_id = p_user), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_member(uuid) from public;
grant execute on function public.admin_member(uuid) to authenticated;

-- ------------------------------------------------------------
-- ٦) حالة الحساب عند الدخول: مع الاشتراك ورابط التجديد
--    الرابط من الباقة في القاعدة (الباقات ← رابط الشراء)، لا من
--    الكود. ولمن لا باقة لها: أدنى باقةٍ نشطةٍ لها رابط.
-- ------------------------------------------------------------
create or replace function public.account_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid(); p public.profiles; eff text; url text; adm boolean;
begin
  if uid is null then
    return jsonb_build_object('signed_in', false);
  end if;

  select * into p from public.profiles where id = uid;
  if not found then
    return jsonb_build_object('signed_in', true, 'active', false,
                              'reason', 'لم يعد لهذا الحساب ملف في المنصة.');
  end if;

  adm := public.is_admin();
  eff := public.effective_sub_status(p.subscription_status, p.subscription_expires_at);

  url := coalesce(
    (select checkout_url from public.plans where name = p.plan and active),
    (select checkout_url from public.plans
      where active and checkout_url is not null
      order by tier, sort_order limit 1));

  return jsonb_build_object(
    'signed_in', true,
    'active', p.status = 'active',
    'status', p.status,
    'is_admin', adm,
    'reason', case when p.status = 'active' then null
                   else 'حسابك معطَّل حالياً. تواصل مع إدارة المنصة.' end,
    -- الاشتراك: الأدمن لا يُحجب به، وما سواه يُقرأ من التاريخ لحظة السؤال
    'sub_status', case when adm then 'admin' else eff end,
    'plan', p.plan,
    'sub_expires_at', p.subscription_expires_at,
    'days_left', case when p.subscription_expires_at is null then null
                      else (p.subscription_expires_at::date - current_date) end,
    'renew_url', url);
end;
$$;

revoke all on function public.account_state() from public;
grant execute on function public.account_state() to authenticated;

-- ------------------------------------------------------------
-- ٧) التذكير والقفل المجدولان
--    الرابط من الباقة لا من الكود، والنداء للإدارة أو للمجدوِل وحده:
--    كانت مفتوحةً لكل مشترِك فيُشغّلها على الجميع.
-- ------------------------------------------------------------
create or replace function public.queue_expiry_reminders()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare p record; made integer := 0; expired integer := 0; url text;
begin
  if auth.uid() is not null and not public.is_admin() then
    return jsonb_build_object('error', 'غير مصرّح');
  end if;

  for p in
    select pr.id, pr.subscription_expires_at, pr.plan,
           (pr.subscription_expires_at::date - current_date) as left_days
    from public.profiles pr
    where pr.status = 'active'
      and pr.subscription_status = 'active'
      and pr.subscription_expires_at is not null
      and pr.subscription_expires_at > now()
      and pr.subscription_expires_at <= now() + interval '7 days'
  loop
    url := coalesce((select checkout_url from public.plans where name = p.plan and active),
                    (select checkout_url from public.plans
                      where active and checkout_url is not null
                      order by tier, sort_order limit 1));
    if public.push_notification(
         p.id, 'subscription_expiring',
         'اشتراكك ينتهي خلال ' ||
           case when p.left_days <= 1 then 'يوم' else p.left_days || ' أيام' end,
         'ينتهي اشتراكك في ' ||
           to_char(p.subscription_expires_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD') ||
           '. جدّدي قبل الموعد ليستمرّ وصولك إلى الدروس والجلسات بلا انقطاع.',
         url,
         'sub_expiring:' || to_char(p.subscription_expires_at, 'YYYY-MM-DD')
       ) is not null then
      made := made + 1;
    end if;
  end loop;

  -- المنتهية فعلاً: الحالة تُكتب في الصفّ للتقارير، والتنبيه يُرسل مرّة
  update public.profiles
     set subscription_status = 'expired'
   where subscription_status = 'active'
     and subscription_expires_at is not null
     and subscription_expires_at <= now();

  for p in
    select pr.id, pr.subscription_expires_at, pr.plan
    from public.profiles pr
    where pr.subscription_expires_at is not null
      and pr.subscription_expires_at <= now()
      and pr.subscription_status = 'expired'
      and pr.subscription_expires_at > now() - interval '30 days'
  loop
    url := coalesce((select checkout_url from public.plans where name = p.plan and active),
                    (select checkout_url from public.plans
                      where active and checkout_url is not null
                      order by tier, sort_order limit 1));
    if public.push_notification(
         p.id, 'subscription_expired',
         'انتهى اشتراكك',
         'انتهت فترة اشتراكك وتوقّف الوصول إلى المحتوى. جدّدي اشتراكك وأكملي تعليمك من حيث توقّفتِ.',
         url,
         'sub_expired:' || to_char(p.subscription_expires_at, 'YYYY-MM-DD')
       ) is not null then
      expired := expired + 1;
    end if;
  end loop;

  return jsonb_build_object('expiring', made, 'expired', expired);
end;
$$;

revoke all on function public.queue_expiry_reminders() from public;
grant execute on function public.queue_expiry_reminders() to authenticated;

-- ------------------------------------------------------------
-- ٨) قائمة الباقات للإدارة: بالرتبة والمدّتين
--    كانت تُرجع الباقة بلا tier ولا duration_days، فنموذج التعديل
--    يعرض الافتراضيّ (رتبة ١، ٦٠ يوماً) ويحفظه عند أيّ تعديل —
--    فتعديلُ وصف الماسية كان يُنزلها إلى رتبة البرونزية.
-- ------------------------------------------------------------
create or replace function public.admin_plans()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'هذه العملية للإدارة وحدها' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'description', p.description,
      'badge', p.badge, 'tier', p.tier,
      'price_sar', p.price_sar,
      'duration_days', p.duration_days, 'renewal_days', p.renewal_days,
      'private_quota', p.private_quota, 'checkout_url', p.checkout_url,
      'sort_order', p.sort_order, 'active', p.active,
      'members', (select count(*) from public.profiles pr where pr.plan = p.name))
      order by p.tier, p.sort_order, p.name)
    from public.plans p), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_plans() from public;
grant execute on function public.admin_plans() to authenticated;

-- ------------------------------------------------------------
-- ٩) رقم العضوية يُقبل مع العلامة «#3» ومن أرقامٍ عربية «٣»
--    التطبيع كان في دالة الإدارة وحدها، فمسار الإنشاء (الدالة
--    الطرفية تكتب الملف مباشرة) كان يرفض «#3» بينما تقبله شاشة
--    التعديل. صار التطبيع في المحفِّز نفسه فيستوي كل مسار.
-- ------------------------------------------------------------
create or replace function public.guard_membership_no()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  new.membership_no := nullif(btrim(coalesce(new.membership_no, '')), '');
  if new.membership_no is not null then
    new.membership_no := translate(new.membership_no,
                           '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');
    new.membership_no := nullif(btrim(regexp_replace(new.membership_no, '^[#＃]\s*', '')), '');
  end if;

  if tg_op = 'UPDATE' and new.membership_no is not distinct from old.membership_no then
    return new;                              -- لم يُمَسّ الرقم
  end if;

  if new.membership_no is null then
    if tg_op = 'INSERT' then
      new.membership_no := public.next_membership_no();
    else
      new.membership_no := old.membership_no; -- لا يُفرَّغ رقمٌ قائم
      return new;
    end if;
  end if;

  if new.membership_no !~ '^[1-9][0-9]{0,8}$' then
    raise exception 'رقم العضوية يكون عدداً صحيحاً موجباً بلا أصفار بادئة (مثل 47 أو #47). المُدخَل: %',
      new.membership_no
      using errcode = 'check_violation';
  end if;

  perform public.bump_membership_seq(new.membership_no::bigint);
  return new;
end;
$fn$;

notify pgrst, 'reload schema';
