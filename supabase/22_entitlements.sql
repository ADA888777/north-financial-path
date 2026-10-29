-- ============================================================
-- نورث للمسار المالي — الهجرة الثانية والعشرون
-- مصفوفة صلاحيات الباقات
--
-- المبدأ: الصلاحية تُحسب من اشتراك المستخدم في القاعدة، وتُفرض في كل
-- دالة تعرض محتوى. ظهور ميزة في صفحة الباقات ليس منحاً لها.
--
-- الرتبة بدل أسماء الباقات: ربط المحتوى باسم «ماسية» نصّاً يكسر كل
-- شيء يوم تتغيّر التسمية أو تُضاف باقة ثالثة. الرتبة رقمٌ يقارَن.
--
-- تُشغَّل بعد 21. إضافية بالكامل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) رتبة الباقة ومدّتها بالأيام
-- ------------------------------------------------------------
alter table public.plans add column if not exists tier smallint not null default 1;
alter table public.plans add column if not exists duration_days integer;
alter table public.plans add column if not exists badge text;

do $$ begin
  alter table public.plans add constraint plans_tier_chk check (tier between 1 and 9);
exception when duplicate_object then null; end $$;

-- البذرة: البرونزية الرتبة الأولى والماسية الثانية، وستون يوماً لكل
-- منهما كما هو معتمد. تُعدَّل من اللوحة متى شاءت الإدارة.
update public.plans set tier = 1, duration_days = coalesce(duration_days, 60)
 where name = 'برونزية' and tier = 1;
update public.plans set tier = 2, duration_days = coalesce(duration_days, 60)
 where name = 'ماسية';
update public.plans set duration_days = coalesce(duration_days, 60)
 where duration_days is null;

-- ------------------------------------------------------------
-- 2) أدنى رتبة تفتح المحتوى
--    الافتراضي ١: متاح لكل مشترك نافذ. الإدارة ترفعه إلى ٢ لما يخصّ
--    الماسية. المحتوى لا يُقفل من تلقاء نفسه.
-- ------------------------------------------------------------
alter table public.levels  add column if not exists min_tier smallint not null default 1;
alter table public.lessons add column if not exists min_tier smallint not null default 1;
alter table public.tracks  add column if not exists min_tier smallint not null default 1;

create index if not exists lessons_tier_idx on public.lessons (min_tier, published);

-- ------------------------------------------------------------
-- 3) مميزات الباقة وروابطها
--    القنوات والقروبات والتدريب روابط خارجية تتغيّر. مكانها جدولٌ
--    تملؤه الإدارة، لا سطرٌ في الكود يحتاج نشراً كلما تبدّل رابط.
-- ------------------------------------------------------------
create table if not exists public.plan_features (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references public.plans(id) on delete cascade,
  kind       text not null default 'feature'
             check (kind in ('feature', 'channel', 'group', 'training', 'note')),
  label      text not null check (length(btrim(label)) > 0),
  detail     text not null default '',
  url        text,
  icon       text,
  sort_order integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists plan_features_idx on public.plan_features (plan_id, sort_order);

alter table public.plan_features enable row level security;

-- الزائر يرى المميزات بلا روابط (الروابط تُحجب في الدالة أدناه)،
-- والمشترك النافذ يرى رابط باقته وحدها.
drop policy if exists "read features" on public.plan_features;
create policy "read features" on public.plan_features
  for select to anon, authenticated using (active or public.is_admin());

drop policy if exists "admin writes features" on public.plan_features;
create policy "admin writes features" on public.plan_features
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select on public.plan_features to anon, authenticated;
grant insert, update, delete on public.plan_features to authenticated;

-- ------------------------------------------------------------
-- 4) رتبة المستخدم الفعلية
--    صفر = لا اشتراك نافذ. انتهاء المدة يُسقط الرتبة تلقائياً دون
--    أي مهمة مجدولة: الحساب من التاريخ في كل نداء.
-- ------------------------------------------------------------
create or replace function public.my_tier(p_uid uuid default auth.uid())
returns smallint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select pl.tier
    from public.profiles p
    join public.plans pl on pl.name = p.plan
    where p.id = p_uid
      and p.status = 'active'
      and p.subscription_status = 'active'
      and (p.subscription_expires_at is null or p.subscription_expires_at > now())
  ), 0::smallint);
$$;

revoke all on function public.my_tier(uuid) from public;
grant execute on function public.my_tier(uuid) to authenticated;

-- هل تكفي رتبة المستخدم لهذا المحتوى؟ الأدمن يرى كل شيء.
create or replace function public.tier_ok(p_min smallint, p_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_admin(p_uid) or public.my_tier(p_uid) >= coalesce(p_min, 1);
$$;

revoke all on function public.tier_ok(smallint, uuid) from public;
grant execute on function public.tier_ok(smallint, uuid) to authenticated;

-- ------------------------------------------------------------
-- 5) صلاحياتي مجتمعة
--    مرجع واحد تقرأ منه الواجهة، فلا تعيد حساب القاعدة بقاعدة أخرى.
--    الروابط لا تخرج إلا لمن اشتراكه نافذ ورتبته تكفي.
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
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;

  select * into p from public.profiles where id = uid;
  if not found then return jsonb_build_object('error', 'الحساب غير موجود'); end if;

  adm := public.is_admin();
  t   := public.my_tier(uid);
  select * into pl from public.plans where name = p.plan;

  return jsonb_build_object(
    'plan', p.plan,
    'plan_badge', pl.badge,
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

    -- ما تفتحه رتبته من المحتوى، محسوباً لا مكتوباً
    'lessons_open', (select count(*) from public.lessons l
                     where l.published and (adm or l.min_tier <= t)),
    'lessons_total', (select count(*) from public.lessons where published),
    'strategies_open', (select count(*) from public.lessons l
                        where l.published and l.kind = 'strategy' and (adm or l.min_tier <= t)),
    'strategies_total', (select count(*) from public.lessons
                         where published and kind = 'strategy'),
    'private_quota', coalesce(pl.private_quota, 0),

    -- مميزات باقته: الرابط يخرج فقط إن كان اشتراكه نافذاً
    'features', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', f.kind, 'label', f.label, 'detail', f.detail, 'icon', f.icon,
        'url', case when (t > 0 or adm) then f.url else null end,
        'locked', not (t > 0 or adm))
        order by f.sort_order, f.label)
      from public.plan_features f
      where f.plan_id = pl.id and f.active), '[]'::jsonb),

    -- ما تفوته: مميزات الباقات الأعلى، بلا روابط بطبيعة الحال
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

-- الباقات كما تُعرض للزائر في صفحة الموقع: بلا روابط خاصة.
create or replace function public.public_plans()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'description', p.description, 'badge', p.badge,
      'price_sar', p.price_sar, 'duration_days', p.duration_days,
      'tier', p.tier, 'private_quota', p.private_quota,
      'checkout_url', p.checkout_url,
      'features', coalesce((
        select jsonb_agg(jsonb_build_object('kind', f.kind, 'label', f.label,
                                            'detail', f.detail, 'icon', f.icon)
                         order by f.sort_order, f.label)
        from public.plan_features f
        where f.plan_id = p.id and f.active), '[]'::jsonb))
      order by p.tier, p.sort_order), '[]'::jsonb)
  from public.plans p where p.active;
$$;

revoke all on function public.public_plans() from public;
grant execute on function public.public_plans() to anon, authenticated;

-- ------------------------------------------------------------
-- 6) فرض الرتبة على المحتوى
--    القفل التسلسلي (الهجرة 18) يسأل: هل وصلتَ إلى هنا؟
--    والرتبة تسأل: هل باقتك تفتح هذا أصلاً؟ شرطان مستقلان.
-- ------------------------------------------------------------
create or replace function public.lesson_tier_ok(p_lesson uuid, p_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_admin(p_uid) or exists (
    select 1
    from public.lessons l
    left join public.levels lv on lv.id = l.level_id
    left join public.tracks tr on tr.id = lv.track_id
    where l.id = p_lesson
      and public.my_tier(p_uid) >= greatest(
            coalesce(l.min_tier, 1),
            coalesce(lv.min_tier, 1),
            coalesce(tr.min_tier, 1)));
$$;

revoke all on function public.lesson_tier_ok(uuid, uuid) from public;
grant execute on function public.lesson_tier_ok(uuid, uuid) to authenticated;

-- اسم الباقة الأدنى التي تفتح درساً، لعرضه في سبب القفل
create or replace function public.lesson_required_plan(p_lesson uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select pl.name
  from public.lessons l
  left join public.levels lv on lv.id = l.level_id
  left join public.tracks tr on tr.id = lv.track_id
  join public.plans pl on pl.active and pl.tier >= greatest(
         coalesce(l.min_tier, 1), coalesce(lv.min_tier, 1), coalesce(tr.min_tier, 1))
  where l.id = p_lesson
  order by pl.tier
  limit 1;
$$;

revoke all on function public.lesson_required_plan(uuid) from public;
grant execute on function public.lesson_required_plan(uuid) to anon, authenticated;

-- ------------------------------------------------------------
-- 7) الدوال التي تعرض الدروس، بشرط الرتبة مضافاً
-- ------------------------------------------------------------

create or replace function public.lesson_unlocked(p_lesson uuid, p_uid uuid default auth.uid())
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  l    record;
  prev record;
  qz   uuid;
begin
  if p_uid is null then return false; end if;
  if public.is_admin() then return true; end if;

  select id, level_id, sort_order, week_no, published, free_preview, access
    into l
  from public.lessons where id = p_lesson;

  if not found or not l.published then return false; end if;
  if l.free_preview then return true; end if;

  -- الباقة قبل الترتيب: درسٌ لا تفتحه باقته ليس «مفتوحاً» وإن أنهى ما قبله.
  if not public.lesson_tier_ok(p_lesson, p_uid) then return false; end if;
  if l.access = 'open'   then return true; end if;
  if l.access = 'locked' then return false; end if;

  -- المرحلة أولاً: درسٌ في مرحلة مقفلة مقفل مهما كان ترتيبه.
  if l.level_id is not null and not public.level_unlocked(l.level_id, p_uid) then
    return false;
  end if;

  -- الدرس السابق داخل المرحلة نفسها
  select ls.id, ls.sort_order into prev
  from public.lessons ls
  where ls.published
    and ls.level_id is not distinct from l.level_id
    and (ls.week_no, ls.sort_order, ls.id) < (l.week_no, l.sort_order, l.id)
  order by ls.week_no desc, ls.sort_order desc, ls.id desc
  limit 1;

  -- أول درس في المرحلة: لا سابق له
  if not found then return true; end if;

  if not exists (select 1 from public.lesson_progress lp
                 where lp.user_id = p_uid and lp.lesson_id = prev.id) then
    return false;
  end if;

  select q.id into qz from public.quizzes q
  where q.lesson_id = prev.id and q.published
  order by q.sort_order limit 1;

  if qz is null then return true; end if;

  return exists (select 1 from public.quiz_attempts a
                 where a.quiz_id = qz and a.user_id = p_uid and a.passed);
end;
$$;

create or replace function public.lesson_lock_reason(p_lesson uuid, p_uid uuid default auth.uid())
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare l record; prev record; qz record;
begin
  if public.lesson_unlocked(p_lesson, p_uid) then return null; end if;

  select id, level_id, sort_order, week_no, access into l
  from public.lessons where id = p_lesson;

  if l.access = 'locked' then return 'هذا الدرس مغلق حالياً من الإدارة.'; end if;

  if not public.lesson_tier_ok(p_lesson, p_uid) then
    -- رتبة صفر تعني اشتراكاً منتهياً لا باقةً أدنى. قول «رقِّ اشتراكك»
    -- لمن تملك الباقة فعلاً وانتهت مدّتها رسالةٌ تضلّل.
    if public.my_tier(p_uid) = 0 then
      return 'انتهى اشتراكك. جدّديه لمتابعة الدروس.';
    end if;
    return 'هذا الدرس ضمن الباقة «' ||
           coalesce(public.lesson_required_plan(p_lesson), 'الأعلى') ||
           '». رقِّ اشتراكك لفتحه.';
  end if;

  if l.level_id is not null and not public.level_unlocked(l.level_id, p_uid) then
    return 'أكمل دروس المرحلة السابقة واجتز اختبارها لفتح هذه المرحلة.';
  end if;

  select ls.id, ls.title into prev
  from public.lessons ls
  where ls.published and ls.level_id is not distinct from l.level_id
    and (ls.week_no, ls.sort_order, ls.id) < (l.week_no, l.sort_order, l.id)
  order by ls.week_no desc, ls.sort_order desc, ls.id desc
  limit 1;

  if not found then return 'هذا الدرس غير متاح لك الآن.'; end if;

  if not exists (select 1 from public.lesson_progress lp
                 where lp.user_id = p_uid and lp.lesson_id = prev.id) then
    return 'أكمل درس «' || prev.title || '» لفتحه.';
  end if;

  select q.id, q.title, q.pass_score into qz from public.quizzes q
  where q.lesson_id = prev.id and q.published order by q.sort_order limit 1;

  if qz.id is not null then
    return 'اجتز اختبار درس «' || prev.title || '» بنسبة ' ||
           coalesce(qz.pass_score, 60) || '% لفتحه.';
  end if;

  return 'هذا الدرس غير متاح لك الآن.';
end;
$$;

create or replace function public.get_lesson(p_lesson uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare l record; allowed boolean; unlocked boolean; tier_ok boolean;
        reason text; need text;
        prev_id uuid; next_id uuid; qz uuid;
begin
  select * into l from public.lessons
  where id = p_lesson and (published or public.is_admin());

  if not found then
    return jsonb_build_object('error', 'الدرس غير متاح');
  end if;

  unlocked := public.lesson_unlocked(p_lesson);
  reason   := public.lesson_lock_reason(p_lesson);

  -- شرطان مستقلان: هل باقتك تفتح هذا؟ وهل وصلتَ إليه بالترتيب؟
  tier_ok := public.lesson_tier_ok(p_lesson);

  allowed := public.is_admin()
             or l.free_preview
             or (public.has_active_subscription() and unlocked and tier_ok);

  if not tier_ok and not l.free_preview and not public.is_admin() then
    need   := public.lesson_required_plan(p_lesson);
    reason := case when public.my_tier() = 0
      then 'انتهى اشتراكك. جدّديه لمتابعة الدروس.'
      else 'هذا الدرس ضمن الباقة «' || coalesce(need, 'الأعلى') ||
           '». رقِّ اشتراكك لفتحه.' end;
  end if;

  select id into prev_id from public.lessons
   where published and level_id is not distinct from l.level_id
     and (week_no, sort_order, id) < (l.week_no, l.sort_order, l.id)
   order by week_no desc, sort_order desc, id desc limit 1;

  select id into next_id from public.lessons
   where published and level_id is not distinct from l.level_id
     and (week_no, sort_order, id) > (l.week_no, l.sort_order, l.id)
   order by week_no asc, sort_order asc, id asc limit 1;

  -- اختبار الدرس أولاً، فإن لم يكن له فاختبار مرحلته
  select q.id into qz from public.quizzes q
   where q.lesson_id = l.id and q.published order by q.sort_order limit 1;
  if qz is null then
    select q.id into qz from public.quizzes q
     where q.lesson_id is null and q.level_id = l.level_id and q.published
     order by q.sort_order limit 1;
  end if;

  return jsonb_build_object(
    'id', l.id, 'title', l.title, 'kind', l.kind,
    'level_id', l.level_id, 'course_id', l.course_id, 'week_no', l.week_no,
    'allowed', allowed, 'free_preview', l.free_preview,
    'unlocked', unlocked and tier_ok, 'locked_reason', reason,
    'tier_ok', tier_ok, 'required_plan', need,
    'duration_min', l.duration_min,
    'content',   case when allowed then l.content   else null end,
    'summary',   case when allowed then l.summary   else null end,
    'video_url', case when allowed then l.video_url else null end,
    'vocab', case when allowed then coalesce((
        select jsonb_agg(jsonb_build_object('term', v.term, 'meaning', v.meaning)
                         order by v.sort_order, v.term)
        from public.vocab v where v.lesson_id = l.id), '[]'::jsonb) else '[]'::jsonb end,
    'quiz_id', qz,
    'completed', exists (select 1 from public.lesson_progress lp
                         where lp.lesson_id = l.id and lp.user_id = auth.uid()),
    'spot', coalesce((select s.pos from public.lesson_spots s
                      where s.lesson_id = l.id and s.user_id = auth.uid()), 0),
    'prev_id', prev_id, 'next_id', next_id
  );
end;
$$;

revoke all on function public.lesson_unlocked(uuid, uuid) from public;
grant execute on function public.lesson_unlocked(uuid, uuid) to authenticated;
revoke all on function public.lesson_lock_reason(uuid, uuid) from public;
grant execute on function public.lesson_lock_reason(uuid, uuid) to authenticated;
revoke all on function public.get_lesson(uuid) from public;
grant execute on function public.get_lesson(uuid) to anon, authenticated;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 8) تقرير الاشتراكات
--    من انتهى اشتراكه ومن قارب، بالباقة والأيام المتبقية.
-- ------------------------------------------------------------
create or replace function public.admin_subscription_report(p_soon integer default 14)
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

  return jsonb_build_object(
    'soon_days', greatest(1, p_soon),
    'counts', (
      select jsonb_object_agg(k, n) from (
        select public.effective_sub_status(subscription_status, subscription_expires_at) k,
               count(*) n
        from public.profiles
        group by 1) c),
    'by_plan', coalesce((
      select jsonb_agg(jsonb_build_object('plan', t.plan, 'tier', t.tier, 'members', t.n)
                       order by t.tier nulls last, t.plan)
      from (select p.plan, pl.tier, count(*) n
            from public.profiles p
            left join public.plans pl on pl.name = p.plan
            group by p.plan, pl.tier) t), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.full_name, 'email', p.email,
        'membership_no', p.membership_no, 'plan', p.plan, 'tier', pl.tier,
        'account_status', p.status,
        'status', public.effective_sub_status(p.subscription_status, p.subscription_expires_at),
        'expires_at', p.subscription_expires_at,
        'days_left', (p.subscription_expires_at::date - current_date),
        'bucket', case
          when public.effective_sub_status(p.subscription_status, p.subscription_expires_at) <> 'active'
            then 'expired'
          when p.subscription_expires_at is null then 'open'
          when p.subscription_expires_at::date - current_date <= greatest(1, p_soon) then 'soon'
          else 'ok' end)
        order by p.subscription_expires_at nulls last)
      from public.profiles p
      left join public.plans pl on pl.name = p.plan
      where p.subscription_expires_at is null
         or p.subscription_expires_at::date - current_date <= greatest(1, p_soon)
         or public.effective_sub_status(p.subscription_status, p.subscription_expires_at) <> 'active'
      ), '[]'::jsonb));
end;
$$;

revoke all on function public.admin_subscription_report(integer) from public;
grant execute on function public.admin_subscription_report(integer) to authenticated;

-- ------------------------------------------------------------
-- 9) التجديد بأيام الباقة
--    مدّة الباقة ستون يوماً لا شهران: الشهر بين ٢٨ و٣١ يوماً، والفرق
--    يتراكم مع كل تجديد.
-- ------------------------------------------------------------
create or replace function public.admin_renew_days(
  p_user uuid, p_days integer default null, p_plan text default null,
  p_note text default null, p_paid boolean default false,
  p_payment_ref text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.profiles; new_plan text; days integer;
  starts timestamptz; ends timestamptz; was_active boolean;
begin
  p := public.admin_target(p_user);
  new_plan := coalesce(nullif(btrim(coalesce(p_plan, '')), ''), p.plan);

  if new_plan is null or not exists (select 1 from public.plans where name = new_plan) then
    return jsonb_build_object('error', 'باقة غير معتمدة. أضفها من إدارة الباقات أولاً.');
  end if;

  -- المدة الافتراضية مدّة الباقة نفسها
  days := coalesce(p_days, (select duration_days from public.plans where name = new_plan), 60);
  if days < 1 or days > 1830 then
    return jsonb_build_object('error', 'مدة التجديد بين يوم و١٨٣٠ يوماً');
  end if;

  was_active := public.effective_sub_status(
                  p.subscription_status, p.subscription_expires_at) = 'active'
                and p.subscription_expires_at is not null;

  starts := case when was_active then p.subscription_expires_at else now() end;
  ends   := starts + make_interval(days => days);

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
     coalesce(p_note, '') || case when p_note is null then '' else ' · ' end ||
       days || ' يوماً',
     auth.uid(), coalesce(p_paid, false),
     nullif(btrim(coalesce(p_payment_ref, '')), ''));

  return jsonb_build_object('ok', true, 'plan', new_plan, 'days', days,
    'starts_at', starts, 'expires_at', ends, 'extended', was_active,
    'paid', coalesce(p_paid, false),
    'message', (case when was_active
      then 'أُضيف ' || days || ' يوماً إلى الاشتراك النافذ.'
      else 'جُدِّد الاشتراك ' || days || ' يوماً ابتداءً من اليوم.' end)
      || (case when coalesce(p_paid, false) then ' وسُجِّل الدفع.' else ' بلا تسجيل دفع.' end));
end;
$$;

revoke all on function public.admin_renew_days(uuid, integer, text, text, boolean, text) from public;
grant execute on function public.admin_renew_days(uuid, integer, text, text, boolean, text) to authenticated;

notify pgrst, 'reload schema';
