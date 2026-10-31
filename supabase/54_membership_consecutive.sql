-- ============================================================
-- ٥٤) أرقام العضوية متتالية دائماً: 1، 2، 3… بلا فجوة
--
-- ما كان يصنع الفجوة («North #1» ثم «Munirah #3»):
--   ١) الرقم يُسحب من sequence، والـsequence لا يتراجع إن فشلت
--      العملية بعده — محاولة إنشاءٍ تفشل تحرق رقماً للأبد.
--   ٢) حذف حسابٍ يترك رقمه فارغاً، وكانت القاعدة «لا يُعاد رقم
--      محذوف».
--   ٣) الإدارة تستطيع كتابة أي رقم يدوياً، ولو ٥٠ والأعلى ٣.
--
-- والمطلوب الآن صريح: الترتيب 1 ثم 2 ثم 3 دائماً. فصار:
--   • الرقم التالي = أعلى رقمٍ قائم + 1، تحت قفلٍ داخل المعاملة.
--     فشل الإنشاء يُرجع كل شيء ولا يحرق رقماً، وحسابان يُنشآن معاً
--     ينتظر أحدهما الآخر فلا يأخذان الرقم نفسه.
--   • حذف حسابٍ يُنزل من بعده درجةً: حُذف #2 فصار #3 هو #2.
--     (تعطيل الحساب لا يمسّ الأرقام — الحذف وحده.)
--   • التعديل اليدوي نقلٌ لا قفز: الرقم بين 1 وعدد الحسابات، وإن
--     كان لعضوةٍ أخرى تبادلتا. فلا يُصنع ثقبٌ بيدٍ ولا بخطأ.
--   • ترقيمٌ واحدٌ الآن لما هو قائم: بالترتيب الحالي نفسه، فتبقى
--     الإدارة #1، وتنزل Munirah من #3 إلى #2.
--
-- وفي الطريق: الحارس guard_profile_update كان يرفض كتابة دالة
-- create-member (مفتاح الخدمة، بلا مستخدم) لملف العضوة الجديدة —
-- «لا يمكن تعديل بيانات حساب آخر» — فتُنشأ العضوة وتبقى بياناتها
-- الإدارية (الباقة وحالة الاشتراك) غير محفوظة. صار يقبل دور الخدمة،
-- وهو لا يوجد إلا في دوال الخادم.
--
-- الهجرة idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- ١) مفتاح الترقيم الداخلي
--    إعدادٌ داخل المعاملة يفتح للحارسين بابَ إعادة الترقيم وحده.
--    لا يضبطه عميلٌ من المتصفّح: PostgREST لا يمرّر إعدادات عامة.
-- ------------------------------------------------------------
create or replace function public.renumbering()
returns boolean
language sql
stable
as $$ select coalesce(current_setting('north.renumbering', true), '') = 'on'; $$;

-- ------------------------------------------------------------
-- ٢) حارس الملف: دور الخدمة وإعادة الترقيم مسموحان
-- ------------------------------------------------------------
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_admin() or public.renumbering()
     or coalesce(auth.role(), '') = 'service_role' then
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

-- ------------------------------------------------------------
-- ٣) الرقم التالي: أعلى قائم + 1، تحت قفل المعاملة
-- ------------------------------------------------------------
create or replace function public.next_membership_no()
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare n bigint;
begin
  -- القفل يُفكّ مع نهاية المعاملة: إنشاءان متزامنان يصطفّان
  perform pg_advisory_xact_lock(hashtext('north.membership_no'));
  select coalesce(max(membership_no::bigint), 0) + 1 into n
  from public.profiles
  where membership_no ~ '^[1-9][0-9]{0,8}$';
  return n::text;
end;
$fn$;

revoke all on function public.next_membership_no() from public;

-- ------------------------------------------------------------
-- ٤) حارس الرقم: لا ثقب
--    الإدراج بلا رقم يأخذ التالي، وبرقمٍ صريح يُقبل إن كان هو التالي
--    نفسه. والتعديل لا يتجاوز عدد الحسابات. وإعادة الترقيم الداخلية
--    تمرّ بلا فحص لأنها هي التي تحفظ التتالي.
-- ------------------------------------------------------------
create or replace function public.guard_membership_no()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare nxt bigint; total bigint;
begin
  if public.renumbering() then
    return new;
  end if;

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
      return new;
    end if;
    new.membership_no := old.membership_no;  -- لا يُفرَّغ رقمٌ قائم
    return new;
  end if;

  if new.membership_no !~ '^[1-9][0-9]{0,8}$' then
    raise exception 'رقم العضوية يكون عدداً صحيحاً موجباً (مثل 3 أو #3). المُدخَل: %',
      new.membership_no using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    nxt := public.next_membership_no()::bigint;
    if new.membership_no::bigint <> nxt then
      -- رقمٌ صريح غير التالي يصنع ثقباً أو يصطدم: يُعطى التالي
      new.membership_no := nxt::text;
    end if;
    return new;
  end if;

  select count(*) into total from public.profiles;
  if new.membership_no::bigint > total then
    raise exception 'رقم العضوية بين 1 و% — عدد الحسابات الحالي. رقمٌ أعلى يترك فجوة.',
      total using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

drop trigger if exists profiles_membership_no_guard on public.profiles;
create trigger profiles_membership_no_guard
  before insert or update of membership_no on public.profiles
  for each row execute function public.guard_membership_no();

-- ------------------------------------------------------------
-- ٥) الضغط: كل الأرقام 1..ن بالترتيب الحالي
--    تصاعدياً صفّاً صفّاً: الهدف دائماً ≤ الحالي، وما قبله امتلأ،
--    فلا يصطدم صفٌّ بفهرس التفرّد في منتصف الطريق.
-- ------------------------------------------------------------
create or replace function public.compact_membership_numbers()
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare r record; k bigint := 0; moved integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('north.membership_no'));
  perform set_config('north.renumbering', 'on', true);

  for r in
    select id, membership_no
    from public.profiles
    order by
      case when membership_no ~ '^[1-9][0-9]{0,8}$' then membership_no::bigint end nulls last,
      created_at, id
  loop
    k := k + 1;
    if r.membership_no is distinct from k::text then
      update public.profiles set membership_no = k::text where id = r.id;
      moved := moved + 1;
    end if;
  end loop;

  perform set_config('north.renumbering', 'off', true);

  -- الـsequence لم يعُد مصدر الرقم، لكن من يقرؤه يجد السقف الصحيح
  if k > 0 then perform setval('public.membership_seq', k, true); end if;
  return moved;
end;
$fn$;

revoke all on function public.compact_membership_numbers() from public;

-- ------------------------------------------------------------
-- ٦) حذف حسابٍ يُنزل من بعده درجة
-- ------------------------------------------------------------
create or replace function public.shift_after_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare r record; gone bigint;
begin
  if old.membership_no !~ '^[1-9][0-9]{0,8}$' then return old; end if;
  gone := old.membership_no::bigint;

  perform pg_advisory_xact_lock(hashtext('north.membership_no'));
  perform set_config('north.renumbering', 'on', true);

  for r in
    select id, membership_no::bigint as n
    from public.profiles
    where membership_no ~ '^[1-9][0-9]{0,8}$' and membership_no::bigint > gone
    order by membership_no::bigint
  loop
    update public.profiles set membership_no = (r.n - 1)::text where id = r.id;
  end loop;

  perform set_config('north.renumbering', 'off', true);
  return old;
end;
$fn$;

drop trigger if exists profiles_shift_after_delete on public.profiles;
create trigger profiles_shift_after_delete
  after delete on public.profiles
  for each row execute function public.shift_after_delete();

-- ------------------------------------------------------------
-- ٧) تعديل الإدارة: نقلٌ لا قفز — وإن كان الرقم لغيرها تبادلتا
-- ------------------------------------------------------------
create or replace function public.admin_set_membership_no(p_user uuid, p_no text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare p public.profiles; no text; total bigint; holder public.profiles; taken boolean;
begin
  p := public.admin_target(p_user);

  no := translate(nullif(btrim(coalesce(p_no, '')), ''),
                  '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');
  no := regexp_replace(coalesce(no, ''), '^[#＃]\s*', '');
  no := nullif(btrim(no), '');

  if no is null then
    return jsonb_build_object('error', 'رقم العضوية لا يصحّ فارغاً');
  end if;
  if no !~ '^[1-9][0-9]{0,8}$' then
    return jsonb_build_object('error', 'رقم العضوية عددٌ صحيح موجب — مثل 3 أو #3');
  end if;

  select count(*) into total from public.profiles;
  if no::bigint > total then
    return jsonb_build_object('error',
      'الأرقام متتالية من 1 إلى ' || total || ' (عدد الحسابات). رقمٌ أعلى يترك فجوة.');
  end if;

  if no is not distinct from p.membership_no then
    return jsonb_build_object('ok', true, 'unchanged', true,
      'membership_no', no, 'message', 'لا تغيير يُحفظ.');
  end if;

  perform pg_advisory_xact_lock(hashtext('north.membership_no'));
  select * into holder from public.profiles where membership_no = no and id <> p_user;
  taken := found;          -- يُلتقط فوراً: perform بعده يعيد ضبط FOUND

  perform set_config('north.renumbering', 'on', true);
  if taken then
    -- تبادل: رقمٌ مؤقّت يمنع اصطدام فهرس التفرّد بين الخطوتين
    update public.profiles set membership_no = 'swap-' || p_user::text where id = p_user;
    update public.profiles set membership_no = p.membership_no where id = holder.id;
  end if;
  update public.profiles set membership_no = no where id = p_user;
  perform set_config('north.renumbering', 'off', true);

  insert into public.member_events (user_id, field, old_value, new_value, actor_id)
  values (p_user, 'membership_no', p.membership_no, no, auth.uid());
  if taken then
    insert into public.member_events (user_id, field, old_value, new_value, actor_id)
    values (holder.id, 'membership_no', no, p.membership_no, auth.uid());
  end if;

  return jsonb_build_object('ok', true, 'membership_no', no,
    'swapped_with', case when not taken then null
                         else coalesce(holder.full_name, holder.email) end,
    'message', case when not taken
      then 'حُفظ رقم العضوية #' || no || '.'
      else 'صار الرقم #' || no || '، وأخذت ' || coalesce(holder.full_name, holder.email) ||
           ' الرقم #' || p.membership_no || ' بدلاً منه.' end);
end;
$fn$;

revoke all on function public.admin_set_membership_no(uuid, text) from public;
grant execute on function public.admin_set_membership_no(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- ٨) الترقيم الآن: ما هو قائم يصير 1..ن بترتيبه الحالي
-- ------------------------------------------------------------
do $$
declare moved integer;
begin
  moved := public.compact_membership_numbers();
  raise notice 'أرقام العضوية: أُعيد ترقيم % حساباً', moved;
end $$;

notify pgrst, 'reload schema';
