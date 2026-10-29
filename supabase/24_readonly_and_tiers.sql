-- ============================================================
-- 24: حساب العميل للعرض فقط، ورتبة الباقة تُضبط عمداً لا بالافتراض
--
-- جزآن مستقلان:
--   أ) المشترك يقرأ بياناته ولا يعدّلها. التعديل من اللوحة وحدها،
--      ممنوعاً في القاعدة لا بإخفاء زر.
--   ب) سبب ظهور «برونزية» لمشتركة ماسية: الرتبة تُحسم بمطابقة الاسم
--      حرفياً، وأي باقة بصيغة أخرى تبقى على الافتراض ١ فتتصرّف كأنها
--      البرونزية. يُكشف الخلل ويُصلَح بقرار الإدارة لا بتخميننا.
-- ============================================================

-- ------------------------------------------------------------
-- أ-١) ما الذي يملك المشترك تغييره في صفّه؟ لا شيء تقريباً.
--
--      كان الحارس يمنع حقول الهوية والاشتراك ويترك الاسم والجوال.
--      صار يمنع كل شيء، ويستثني عمودين تشغيليين فقط يكتبهما النظام
--      نيابةً عنه أثناء عمل آخر:
--        telegram              — يكتبه حجز الجلسة الخاصة
--        must_change_password  — تطفئه mark_password_changed بعد
--                                تغيير كلمة المرور
--      ما عداهما يُرفض، فلا ينفع طلب مباشر إلى الـAPI.
-- ------------------------------------------------------------
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  -- صفّ شخص آخر: لا يُمسّ أصلاً (سياسة RLS تمنعه، وهذا سدّ ثانٍ)
  if new.id is distinct from auth.uid() then
    raise exception 'لا يمكن تعديل بيانات حساب آخر';
  end if;

  if new.id                      is distinct from old.id
     or new.email                is distinct from old.email
     or new.full_name            is distinct from old.full_name
     or new.phone                is distinct from old.phone
     or new.username             is distinct from old.username
     or new.membership_no        is distinct from old.membership_no
     or new.plan                 is distinct from old.plan
     or new.status               is distinct from old.status
     or new.subscription_status  is distinct from old.subscription_status
     or new.subscription_started_at is distinct from old.subscription_started_at
     or new.subscription_expires_at is distinct from old.subscription_expires_at
     or new.created_by           is distinct from old.created_by
     or new.created_at           is distinct from old.created_at
  then
    raise exception 'بيانات الحساب تُعدَّل من إدارة المنصة فقط';
  end if;

  return new;
end;
$$;

-- لا تعديل مباشر على الجدول بأي حال؛ تُعاد هنا صراحةً كي لا تعتمد
-- الحماية على ترتيب تطبيق الهجرات.
revoke update on public.profiles from authenticated;
revoke update on public.profiles from anon;

-- ------------------------------------------------------------
-- أ-٢) الدالة التي كان يحفظ بها المشترك اسمه وجواله
--
--      تبقى موجودة ليظلّ أي نداء قديم مفهوماً، لكنها ترفض وتشرح.
--      لا تُحذف: حذفها يعطي المتصفح خطأ «الدالة غير موجودة» وهو
--      لا يقول للمستخدمة شيئاً.
-- ------------------------------------------------------------
create or replace function public.update_my_profile(
  p_full_name text, p_phone text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then return jsonb_build_object('error', 'غير مصرّح'); end if;
  return jsonb_build_object(
    'error', 'تعديل بيانات الحساب من إدارة المنصة. تواصلي معها لتغيير اسمك أو جوالك.',
    'readonly', true);
end;
$$;

revoke all on function public.update_my_profile(text, text) from public;
grant execute on function public.update_my_profile(text, text) to authenticated;

-- ------------------------------------------------------------
-- أ-٣) ما يحتاجه الواجهة لتعرض الحقول معطّلة بصدق
-- ------------------------------------------------------------
create or replace function public.my_account_readonly()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not coalesce(public.is_admin(), false);
$$;

revoke all on function public.my_account_readonly() from public;
grant execute on function public.my_account_readonly() to authenticated;

-- ------------------------------------------------------------
-- ب-١) رتبتان متساويتان لباقتين نافذتين = خلل، لا تفضيل
--
--      الرتبة هي ما يفتح المحتوى. باقتان نافذتان برتبة واحدة تعني
--      أن إحداهما تتصرّف كالأخرى بلا أن يقصد أحد ذلك. يُمنع إنشاء
--      هذه الحالة من الآن. الحالات القائمة لا تُكسر الهجرة: يكشفها
--      تقرير الصحة أدناه لتُصلَح بقرار الإدارة.
-- ------------------------------------------------------------
create or replace function public.guard_plan_tier()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare clash text;
begin
  if not new.active then return new; end if;

  select p.name into clash
  from public.plans p
  where p.active and p.tier = new.tier and p.id is distinct from new.id
  limit 1;

  if clash is not null then
    raise exception 'الرتبة % مستعملة في الباقة «%». لكل باقة نافذة رتبة خاصة بها، لأن الرتبة هي ما يفتح المحتوى.',
      new.tier, clash;
  end if;

  return new;
end;
$$;

drop trigger if exists plans_tier_guard on public.plans;
create trigger plans_tier_guard
  before insert or update of tier, active on public.plans
  for each row execute function public.guard_plan_tier();

-- ------------------------------------------------------------
-- ب-٢) تقرير صحّة الباقات — يقول أين الخلل بالاسم والعدد
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
    -- باقات نافذة تتقاسم الرتبة: كلّ منها يفتح ما تفتحه الأخرى
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

    -- أعضاء على اسم باقة لا صفّ له في جدول الباقات: رتبتهم صفر
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

    -- أعضاء على باقة موقوفة
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

    -- باقات نافذة بلا مميزات مسجّلة: صفحة المشترك تظهر فارغة
    'no_features', coalesce((
      select jsonb_agg(p.name order by p.tier)
      from public.plans p
      where p.active
        and not exists (select 1 from public.plan_features f
                        where f.plan_id = p.id and f.active)), '[]'::jsonb),

    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'name', p.name, 'tier', p.tier, 'active', p.active,
               'members', (select count(*) from public.profiles pr where pr.plan = p.name))
             order by p.tier, p.sort_order)
      from public.plans p), '[]'::jsonb)
  ) into res;

  return res;
end;
$$;

revoke all on function public.admin_plan_health() from public;
grant execute on function public.admin_plan_health() to authenticated;

-- ------------------------------------------------------------
-- ب-٣) دمج باقة مكرّرة في الباقة المعتمدة
--
--      حين يتبيّن أن «الماسية» و«ماسية» شيء واحد كُتب بصيغتين،
--      تُنقل عضوات الأولى إلى الثانية بقرار الإدارة، ويُسجَّل لكل
--      عضوة حدثٌ في سجلّ الاشتراكات. لا تُغيَّر مدّة اشتراك أحد ولا
--      حالته: الاسم وحده ينتقل. والباقة المصدر تُوقَف لئلا تُستعمل.
-- ------------------------------------------------------------
create or replace function public.admin_merge_plan(
  p_from text, p_to text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  src public.plans;
  dst public.plans;
  moved int := 0;
  r record;
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'غير مصرّح');
  end if;

  select * into src from public.plans where name = btrim(coalesce(p_from, ''));
  if not found then return jsonb_build_object('error', 'الباقة المصدر غير موجودة'); end if;

  select * into dst from public.plans where name = btrim(coalesce(p_to, ''));
  if not found then return jsonb_build_object('error', 'الباقة الهدف غير موجودة'); end if;

  if src.id = dst.id then
    return jsonb_build_object('error', 'الباقتان واحدة');
  end if;
  if not dst.active then
    return jsonb_build_object('error', 'الباقة الهدف موقوفة. فعّليها أولاً.');
  end if;

  for r in
    select id, plan, subscription_status, subscription_expires_at
    from public.profiles where plan = src.name
  loop
    update public.profiles set plan = dst.name where id = r.id;

    insert into public.subscription_events
      (user_id, kind, plan_before, plan_after, status_before, status_after,
       expires_at, note, actor_id)
    values
      (r.id, 'plan_change', r.plan, dst.name, r.subscription_status,
       r.subscription_status, r.subscription_expires_at,
       coalesce(nullif(btrim(coalesce(p_note, '')), ''),
                'دمج باقة «' || src.name || '» في «' || dst.name || '»'),
       auth.uid());

    moved := moved + 1;
  end loop;

  update public.plans set active = false where id = src.id;

  perform public.log_admin(
    'plan_merge', null,
    'باقة «' || src.name || '» → «' || dst.name || '»',
    'نُقلت ' || moved || ' عضوية، وأُوقفت الباقة المصدر.',
    jsonb_build_object('from', src.name, 'to', dst.name, 'members', moved));

  return jsonb_build_object('ok', true, 'moved', moved,
    'message', 'نُقلت ' || moved || ' عضوية من «' || src.name ||
               '» إلى «' || dst.name || '»، وأُوقفت الباقة المصدر.');
end;
$$;

revoke all on function public.admin_merge_plan(text, text, text) from public;
grant execute on function public.admin_merge_plan(text, text, text) to authenticated;

-- ------------------------------------------------------------
-- ب-٤) my_entitlements يفصل باقة المشتركة عن حالتها
--
--      plan        اسم باقتها كما هو مسجّل
--      plan_tier   رتبة باقتها نفسها (ولو كان اشتراكها منتهياً)
--      tier        الرتبة النافذة الآن: صفر عند الانتهاء
--      plan_known  هل لاسم باقتها صفّ في جدول الباقات أصلاً؟
--
--      من دون plan_known كانت باقة بصيغة غير معروفة تظهر كأنها
--      أدنى الباقات بلا أي إشارة إلى أن الإعداد ناقص.
-- ------------------------------------------------------------
create or replace function public.my_entitlements()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  uid  uuid := auth.uid();
  p    public.profiles;
  pl   public.plans;
  t    smallint;
  adm  boolean;
  known boolean;
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;

  select * into p from public.profiles where id = uid;
  if not found then return jsonb_build_object('error', 'الحساب غير موجود'); end if;

  adm := public.is_admin();
  t   := public.my_tier(uid);
  select * into pl from public.plans where name = p.plan;
  known := found;

  return jsonb_build_object(
    'plan', p.plan,
    'plan_badge', pl.badge,
    'plan_known', known,
    'plan_tier', pl.tier,
    'plan_id', pl.id,
    'tier', t,
    'is_admin', adm,
    'account_status', p.status,
    'subscription_status', p.subscription_status,
    'effective_status', public.effective_sub_status(
                          p.subscription_status, p.subscription_expires_at),
    'active', t > 0,
    'started_at', p.subscription_started_at,
    'expires_at', p.subscription_expires_at,
    'days_left', case when p.subscription_expires_at is null then null
                      else greatest(0, (p.subscription_expires_at::date - current_date)) end,

    'lessons_open', (select count(*) from public.lessons l
                     where l.published and (adm or l.min_tier <= t)),
    'lessons_total', (select count(*) from public.lessons where published),
    'strategies_open', (select count(*) from public.lessons l
                        where l.published and l.kind = 'strategy' and (adm or l.min_tier <= t)),
    'strategies_total', (select count(*) from public.lessons
                         where published and kind = 'strategy'),
    'private_quota', coalesce(pl.private_quota, 0),

    'features', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', f.kind, 'label', f.label, 'detail', f.detail, 'icon', f.icon,
        'url', case when (t > 0 or adm) then f.url else null end,
        'locked', not (t > 0 or adm))
        order by f.sort_order, f.label)
      from public.plan_features f
      where f.plan_id = pl.id and f.active), '[]'::jsonb),

    -- الأعلى من باقتها فقط. تُقاس برتبة باقتها لا برتبتها النافذة،
    -- وإلا ظهرت لمشتركة ماسية منتهية ترقيةٌ إلى باقتها نفسها.
    'upgrade', coalesce((
      select jsonb_agg(jsonb_build_object(
        'plan', p2.name, 'tier', p2.tier, 'checkout_url', p2.checkout_url,
        'features', coalesce((
          select jsonb_agg(jsonb_build_object('kind', f2.kind, 'label', f2.label,
                                              'detail', f2.detail, 'icon', f2.icon)
                           order by f2.sort_order, f2.label)
          from public.plan_features f2
          where f2.plan_id = p2.id and f2.active), '[]'::jsonb))
        order by p2.tier)
      from public.plans p2
      where p2.active and p2.tier > coalesce(pl.tier, 0)), '[]'::jsonb));
end;
$$;

revoke all on function public.my_entitlements() from public;
grant execute on function public.my_entitlements() to authenticated;

notify pgrst, 'reload schema';
