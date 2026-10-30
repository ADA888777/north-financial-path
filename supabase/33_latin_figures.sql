-- ============================================================
-- ٣٣) علامة النسبة في رسالة قفل الدرس
--
-- الواجهة صارت تكتب أرقامها لاتينية وعلامتها «%»، ورسالة القفل
-- وحدها بقيت على «٪». حرفٌ واحد، لكنه يظهر تحت كل درس مقفل في
-- الخارطة بجوار «21% مكتمل» فيُقرأ اختلافاً لا تنسيقاً.
--
-- النسبة نفسها تبقى من الاختبار لا من الكود: لو رفعت الإدارة
-- درجة النجاح تبعتها الرسالة.
-- ============================================================

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
    if public.my_tier(p_uid) = 0 then
      return 'انتهى اشتراكك. جدّديه لمتابعة الدروس.';
    end if;
    return 'حصري لـ«' ||
           coalesce(public.lesson_required_plan(p_lesson), 'الباقة الأعلى') || '»';
  end if;

  if l.level_id is not null and not public.level_unlocked(l.level_id, p_uid) then
    return public.level_lock_reason(l.level_id, p_uid);
  end if;

  select ls.id, ls.title into prev
  from public.lessons ls
  where ls.published and ls.level_id is not distinct from l.level_id
    and (ls.week_no, ls.sort_order, ls.id) < (l.week_no, l.sort_order, l.id)
  order by ls.week_no desc, ls.sort_order desc, ls.id desc
  limit 1;

  if not found then return 'هذا الدرس غير متاح لك الآن.'; end if;

  select q.id, q.pass_score into qz from public.quizzes q
  where q.lesson_id = prev.id and q.published order by q.sort_order limit 1;

  if qz.id is not null then
    -- نصّ المرجع. النسبة من الاختبار نفسه فتبقى صادقة لو عدّلتها الإدارة.
    return 'اجتز اختبار السابق ' || coalesce(qz.pass_score, 100) || '% لفتحه';
  end if;

  return 'أكمل درس «' || prev.title || '» لفتحه.';
end;
$$;

revoke all on function public.lesson_lock_reason(uuid, uuid) from public;
grant execute on function public.lesson_lock_reason(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
