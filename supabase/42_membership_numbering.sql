-- ============================================================
-- ٤٢) رقم العضوية: عدد تسلسلي واحد، لا يتكرّر ولا يُعاد
--
-- ما طلبته العميلة: لكل حساب رقم واحد فريد يبدأ من التالي المتاح،
-- يُمنح تلقائياً للحساب الجديد (#47 ثم #48)، لا يتكرّر ولو أُنشئ
-- حسابان في اللحظة نفسها، لا يتغيّر بتعديل الاسم أو البريد أو
-- الباقة، ولا يُعاد استعمال رقم حسابٍ حُذف، ولا يُخلط بـ UUID.
--
-- ما كان: القيمة نصّ على هيئة N-2026-0046 والواجهة تعرض آخر عدد
-- فيه — فـ N-2025-0003 و N-2026-0003 كلاهما «#3». رقمان مختلفان
-- في القاعدة وواحدٌ عند العميلة. ولو ضبطت الإدارة رقماً عالياً
-- يدوياً لم يتحرّك العدّاد معه، فالحساب التالي يصطدم به.
--
-- ما صار:
--   أ) القيمة المخزَّنة هي الرقم نفسه: '46' تُعرض '#46'. ما يُخزَّن
--      هو ما يُرى، فلا موضع لالتباس.
--   ب) مشغّل على profiles يحرس العمود في كل طريق — التسجيل،
--      create-member، إدخال الإدارة، تعديلها — فالضمان في القاعدة
--      لا في صفحةٍ قد تُنسى.
--   ج) العدّاد يُرفع عند كل رقم يُكتب يدوياً، فلا يصطدم به تالٍ.
--      ولا يُخفَض أبداً، فرقم المحذوف لا يعود.
--   د) الفهرس الفريد يبقى الفاصل عند التزامن.
--
-- الهجرة idempotent: الأرقام المضبوطة لا تُمسّ عند إعادة التشغيل.
-- ============================================================

-- ------------------------------------------------------------
-- ١) رفع العدّاد: يعلو ولا ينزل
-- ------------------------------------------------------------
create or replace function public.bump_membership_seq(p_n bigint)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare cur bigint;
begin
  if p_n is null or p_n < 1 then return; end if;
  select last_value into cur from public.membership_seq;
  if p_n >= cur then
    perform setval('public.membership_seq', p_n, true);
  end if;
end;
$fn$;

revoke all on function public.bump_membership_seq(bigint) from public;

-- ------------------------------------------------------------
-- ٢) الرقم التالي: من العدّاد، ويتخطّى ما كان مأخوذاً
-- ------------------------------------------------------------
create or replace function public.next_membership_no()
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare n bigint; tries integer := 0;
begin
  loop
    n := nextval('public.membership_seq');
    tries := tries + 1;
    exit when not exists (select 1 from public.profiles where membership_no = n::text);
    if tries > 100000 then
      raise exception 'تعذّر إيجاد رقم عضوية متاح';
    end if;
  end loop;
  return n::text;
end;
$fn$;

revoke all on function public.next_membership_no() from public;
grant execute on function public.next_membership_no() to authenticated;

-- ------------------------------------------------------------
-- ٣) تطبيع الأرقام القائمة
--    الأقدم يحتفظ برقمه، ومن تعارض معه يأخذ رقماً جديداً من
--    أعلى العدّاد. والتعارض هنا كان قائماً أصلاً في العرض.
-- ------------------------------------------------------------
do $mig$
declare
  r      record;
  cand   bigint;
  top    bigint := 0;
  moved  integer := 0;
  fresh  integer := 0;
  had_guard boolean;
begin
  -- حارس profiles يرفض أي تعديل لا يأتي من أدمن، و auth.uid() في
  -- محرّر SQL فارغ. يُعطَّل للكتلة وحدها ويعود — والكتلة معاملة
  -- واحدة، فلو انقطعت عاد الحارس معها.
  select exists (
    select 1 from pg_trigger
    where tgrelid = 'public.profiles'::regclass
      and tgname = 'profiles_guard_update' and not tgisinternal
  ) into had_guard;
  if had_guard then
    alter table public.profiles disable trigger profiles_guard_update;
  end if;

  -- أ) من قيمته رقم صحيح سليم: تبقى كما هي، ويُرفع بها السقف
  select coalesce(max(membership_no::bigint), 0) into top
  from public.profiles
  where membership_no ~ '^[1-9][0-9]{0,8}$';

  -- ب) الباقي: يُستخرج آخر عدد في النصّ ويُمنح إن كان حرّاً
  for r in
    select id, membership_no, created_at
    from public.profiles
    where membership_no is not null
      and membership_no !~ '^[1-9][0-9]{0,8}$'
    order by created_at nulls last, id
  loop
    cand := nullif(regexp_replace(
              coalesce((regexp_match(r.membership_no, '([0-9]+)[^0-9]*$'))[1], ''),
              '^0+', ''), '')::bigint;

    if cand is not null and cand between 1 and 999999999
       and not exists (select 1 from public.profiles
                       where membership_no = cand::text and id <> r.id) then
      update public.profiles set membership_no = cand::text where id = r.id;
      if cand > top then top := cand; end if;
      moved := moved + 1;
    else
      -- يُؤجَّل إلى ما بعد ضبط العدّاد كي لا يأخذ رقماً محجوزاً
      update public.profiles set membership_no = null where id = r.id;
      fresh := fresh + 1;
    end if;
  end loop;

  -- ج) العدّاد فوق أعلى رقم مستعمل
  perform public.bump_membership_seq(top);

  -- د) من بقي بلا رقم — المؤجَّلون والحسابات القديمة الفارغة
  for r in select id from public.profiles where membership_no is null
           order by created_at nulls last, id
  loop
    update public.profiles set membership_no = public.next_membership_no()
    where id = r.id;
  end loop;

  if had_guard then
    alter table public.profiles enable trigger profiles_guard_update;
  end if;

  raise notice 'أرقام العضوية: % طُبِّعت، % أُعيد ترقيمها، السقف %', moved, fresh, top;
end;
$mig$;

-- ------------------------------------------------------------
-- ٤) المشغّل: العمود محروس في كل طريق
--
--    على INSERT يُمنح الرقم إن غاب، ويُتحقَّق منه إن حضر.
--    على UPDATE لا يُتحقَّق إلا إن تغيّر: تعديل الباقة أو الاسم
--    لا يمسّ الرقم ولا يجوز أن يُعطَّل بسببه.
-- ------------------------------------------------------------
create or replace function public.guard_membership_no()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  new.membership_no := nullif(btrim(coalesce(new.membership_no, '')), '');

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
    raise exception 'رقم العضوية يكون عدداً صحيحاً موجباً بلا أصفار بادئة (مثل 47). المُدخَل: %',
      new.membership_no
      using errcode = 'check_violation';
  end if;

  perform public.bump_membership_seq(new.membership_no::bigint);
  return new;
end;
$fn$;

drop trigger if exists profiles_membership_no_guard on public.profiles;
create trigger profiles_membership_no_guard
  before insert or update of membership_no on public.profiles
  for each row execute function public.guard_membership_no();

-- ------------------------------------------------------------
-- ٥) إدخال الإدارة: الرسالة بالعربية قبل أن يرفع المشغّل خطأه
-- ------------------------------------------------------------
create or replace function public.admin_set_membership_no(p_user uuid, p_no text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare p public.profiles; no text;
begin
  p := public.admin_target(p_user);

  -- الأرقام العربية الشرقية تُقبل وتُحوَّل: الإدارة قد تنسخ الرقم
  -- من مكان يكتبه ٤٧ لا 47، والرفض هنا لبسٌ لا حماية.
  no := translate(nullif(btrim(coalesce(p_no, '')), ''),
                  '٠١٢٣٤٥٦٧٨٩٠١٢٣٤٥٦٧٨٩', '01234567890123456789');
  no := regexp_replace(coalesce(no, ''), '^[#＃]\s*', '');
  no := nullif(btrim(no), '');

  if no is null then
    return jsonb_build_object('error', 'رقم العضوية لا يصحّ فارغاً');
  end if;
  if no !~ '^[1-9][0-9]{0,8}$' then
    return jsonb_build_object('error',
      'رقم العضوية يكون عدداً صحيحاً موجباً بلا أصفار بادئة — مثل 47');
  end if;

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
    'message', 'حُفظ رقم العضوية #' || no || '.');
exception
  when unique_violation then
    return jsonb_build_object('error', 'رقم العضوية مستعمل لعضو آخر');
end;
$fn$;

revoke all on function public.admin_set_membership_no(uuid, text) from public;
grant execute on function public.admin_set_membership_no(uuid, text) to authenticated;

notify pgrst, 'reload schema';
