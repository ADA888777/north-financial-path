-- ============================================================
-- نورث للمسار المالي — الهجرة العاشرة
-- تنبيهات داخل المنصة مرتبطة بأحداث فعلية
--
-- تُشغَّل بعد 09. إضافية بالكامل.
-- ============================================================

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in
               ('booking_created','booking_changed','booking_cancelled',
                'subscription_expiring','subscription_expired','general')),
  title      text not null,
  body       text not null default '',
  link       text,
  -- مفتاح منع التكرار: الحدث نفسه لا يولّد تنبيهين.
  dedupe_key text not null,
  read_at    timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create index if not exists notif_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notif_unread_idx on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;

-- كل مستخدم تنبيهاته هو فقط
drop policy if exists "own notifications" on public.notifications;
create policy "own notifications" on public.notifications
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "read own notification" on public.notifications;
create policy "read own notification" on public.notifications
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- الإدراج من الدوال والمشغّلات وحدها
revoke update on public.notifications from authenticated;
grant  update (read_at) on public.notifications to authenticated;

-- ------------------------------------------------------------
-- دالة إنشاء تنبيه: تتجاهل المكرر بصمت
-- ------------------------------------------------------------
create or replace function public.push_notification(
  p_user uuid, p_kind text, p_title text,
  p_body text default '', p_link text default null, p_key text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare nid uuid;
begin
  insert into public.notifications (user_id, kind, title, body, link, dedupe_key)
  values (p_user, p_kind, p_title, p_body, p_link,
          coalesce(p_key, p_kind || ':' || gen_random_uuid()::text))
  on conflict (user_id, dedupe_key) do nothing
  returning id into nid;
  return nid;
end;
$$;

revoke all on function public.push_notification(uuid, text, text, text, text, text) from public;

-- ------------------------------------------------------------
-- تنبيه عند الحجز
-- ------------------------------------------------------------
create or replace function public.notify_on_booking()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare s record;
begin
  select title, starts_at into s from public.class_slots where id = new.slot_id;

  perform public.push_notification(
    new.user_id, 'booking_created',
    'تم تأكيد حجزك',
    'حصة «' || coalesce(s.title, '') || '» في ' ||
      to_char(s.starts_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI') || ' بتوقيت الرياض.',
    'classes.html',
    'booking_created:' || new.id::text);

  return new;
end;
$$;

drop trigger if exists bookings_inapp_notify on public.bookings;
create trigger bookings_inapp_notify after insert on public.bookings
  for each row execute function public.notify_on_booking();

-- تنبيه عند تغيّر حالة الحجز أو إلغاء الحصة
create or replace function public.notify_on_booking_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare s record;
begin
  if new.status is distinct from old.status then
    select title into s from public.class_slots where id = new.slot_id;
    perform public.push_notification(
      new.user_id, 'booking_changed',
      'تغيّرت حالة حجزك',
      'حصة «' || coalesce(s.title, '') || '»: ' ||
        case new.status when 'attended' then 'سُجّل حضورك.'
                        when 'no_show'  then 'سُجّل غيابك.'
                        else new.status end,
      'classes.html',
      'booking_changed:' || new.id::text || ':' || new.status);
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_change_notify on public.bookings;
create trigger bookings_change_notify after update on public.bookings
  for each row execute function public.notify_on_booking_change();

-- إلغاء الحصة يُنبّه كل من حجزها
create or replace function public.notify_on_slot_cancel()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare b record;
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    for b in select user_id, id from public.bookings where slot_id = new.id loop
      perform public.push_notification(
        b.user_id, 'booking_cancelled',
        'أُلغيت الحصة',
        'أُلغيت حصة «' || new.title || '». تواصل معنا لإعادة الجدولة.',
        'classes.html',
        'slot_cancelled:' || new.id::text || ':' || b.id::text);
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists slots_cancel_notify on public.class_slots;
create trigger slots_cancel_notify after update on public.class_slots
  for each row execute function public.notify_on_slot_cancel();

-- ------------------------------------------------------------
-- تذكير انتهاء الاشتراك قبل سبعة أيام
--    مفتاح منع التكرار يحمل تاريخ الانتهاء، فلو جُدّد الاشتراك
--    وتغيّر التاريخ، يُرسل تذكير جديد للمدة الجديدة لا تكرار للقديمة.
-- ------------------------------------------------------------
create or replace function public.queue_expiry_reminders()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare p record; made integer := 0; expired integer := 0;
begin
  for p in
    select id, subscription_expires_at
    from public.profiles
    where status = 'active'
      and subscription_status = 'active'
      and subscription_expires_at is not null
      and subscription_expires_at > now()
      and subscription_expires_at <= now() + interval '7 days'
  loop
    if public.push_notification(
         p.id, 'subscription_expiring',
         'اشتراكك على وشك الانتهاء',
         'ينتهي اشتراكك في ' ||
           to_char(p.subscription_expires_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD') ||
           '. جدّد من متجر نورث على سلة ليستمر وصولك إلى المحتوى.',
         'https://salla.sa/northacademy',
         'sub_expiring:' || to_char(p.subscription_expires_at, 'YYYY-MM-DD')
       ) is not null then
      made := made + 1;
    end if;
  end loop;

  -- المنتهية فعلاً
  for p in
    select id, subscription_expires_at
    from public.profiles
    where subscription_expires_at is not null
      and subscription_expires_at <= now()
      and subscription_status in ('active','expired')
  loop
    if public.push_notification(
         p.id, 'subscription_expired',
         'انتهى اشتراكك',
         'انتهت مدة اشتراكك وأُقفل المحتوى المدفوع. جدّد من متجر نورث على سلة.',
         'https://salla.sa/northacademy',
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
-- قراءة التنبيهات
-- ------------------------------------------------------------
create or replace function public.my_notifications(p_limit integer default 30)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  -- التذكيرات تُولَّد عند الفتح، فلا تحتاج مهمة مجدولة.
  -- دالة push تتجاهل المكرر، فلا خطر من تكرار النداء.
  perform public.queue_expiry_reminders();

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body,
      'link', n.link, 'read', n.read_at is not null, 'created_at', n.created_at
    ) order by n.created_at desc)
    from (
      select * from public.notifications
      where user_id = auth.uid()
      order by created_at desc
      limit greatest(1, least(p_limit, 100))
    ) n), '[]'::jsonb);
end;
$$;

revoke all on function public.my_notifications(integer) from public;
grant execute on function public.my_notifications(integer) to authenticated;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare n integer;
begin
  update public.notifications
  set read_at = now()
  where user_id = auth.uid() and read_at is null
    and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.mark_notifications_read(uuid[]) from public;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

notify pgrst, 'reload schema';

select kind, count(*) from public.notifications group by kind;
