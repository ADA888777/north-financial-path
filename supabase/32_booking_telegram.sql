-- ============================================================
-- ٣٢) معرّف تيليجرام يصل إلى الكوتش
--
-- المعرّف يُكتب في نموذج حجز الكلاس الخاص ويُحفظ على الحجز،
-- لكن بريد الإشعار الذي يصل الكوتش كان يحمل الاسم والجوال ورقم
-- العضوية فقط — فالكوتش تعرف مَن حجز ولا تعرف كيف تصل إليه،
-- وهو الغرض الذي طُلب المعرّف من أجله.
--
-- لا يُمنح هذا الإخراج للواجهة: دالة الخادم وحدها تنادي
-- pending_notifications بمفتاحها السري، فلا يرى معرَّفَ أحدٍ
-- غيرُه ولا الإدارة إلا من بابها.
-- ============================================================

create or replace function public.pending_notifications(p_booking uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', n.id, 'kind', n.kind, 'to_email', n.to_email,
    'member_name', p.full_name, 'member_phone', p.phone,
    'membership_no', p.membership_no,
    -- المعرّف المسجَّل على الحجز نفسه، وإن غاب فالمحفوظ في الملف
    'telegram', coalesce(nullif(btrim(b.telegram), ''), p.telegram),
    'slot_title', s.title, 'starts_at', s.starts_at,
    'duration_min', s.duration_min, 'booked_at', b.created_at
  )), '[]'::jsonb)
  from public.booking_notifications n
  join public.bookings b on b.id = n.booking_id
  join public.class_slots s on s.id = b.slot_id
  join public.profiles p on p.id = b.user_id
  where n.status = 'pending'
    and (p_booking is null or n.booking_id = p_booking);
$$;

revoke all on function public.pending_notifications(uuid) from public;
-- لا تُمنح للواجهة: دالة الخادم وحدها تناديها بمفتاحها السري.

notify pgrst, 'reload schema';
