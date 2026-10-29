-- ============================================================
-- 23: تهيئة الواجهة الموحّدة
-- يُعيد my_private_quota ليعيد معرّف تيليجرام المحفوظ، فيظهر
-- جاهزاً في نموذج الحجز بدل أن تكتبه المتعلمة في كل مرة.
-- لا يغيّر صلاحيات ولا يوسّع ما يراه المستخدم: المعرّف ملكه.
-- ============================================================

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
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;

  select * into p from public.profiles where id = uid;
  select coalesce(pl.private_quota, 0) into quota
  from public.plans pl where pl.name = p.plan;
  quota := coalesce(quota, 0);

  m0 := date_trunc('month', (now() at time zone 'Asia/Riyadh')) at time zone 'Asia/Riyadh';

  select count(*) into used
  from public.bookings b
  join public.class_slots cs on cs.id = b.slot_id
  where b.user_id = uid
    and cs.kind = 'private'
    and cs.starts_at >= m0
    -- الإلغاء المبكر لا يُحتسب؛ المتأخر وعدم الحضور يُحتسبان
    and b.status in ('booked', 'attended', 'no_show', 'late_cancel');

  return jsonb_build_object(
    'plan', p.plan,
    'quota', quota,
    'used', used,
    'left', greatest(0, quota - used),
    'month_start', m0,
    'telegram', p.telegram,
    'subscription_ok', public.has_active_subscription(uid));
end;
$$;

revoke all on function public.my_private_quota() from public;
grant execute on function public.my_private_quota() to authenticated;
