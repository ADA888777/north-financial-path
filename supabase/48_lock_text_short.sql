-- ============================================================
-- ٤٨) سبب القفل سطرٌ قصير بلا عنوان الدرس
--
-- كان: «أنهي «الدرس الاول ( الجزء الثاني )» أولاً» — عنوانٌ كامل
-- داخل السطر، فيلتفّ على سطرين في بطاقةٍ ضيّقة ويزاحم عنوان الدرس
-- نفسه. والمرجع سطرٌ واحد: «اجتز اختبار الدرس السابق 100% لفتحه».
--
-- «السابق» تكفي: البطاقة تحت سابقتها مباشرةً في القائمة، فالإشارة
-- إليه بالاسم تكرارٌ لما تراه العين فوقها بسطر.
--
-- ويبقى سطر «أفضل نتيجة لك …» لمن حاولت ولم تبلغ المئة: الفرق بين
-- «لم أختبر بعد» و«اقتربتُ» يغيّر الخطوة التالية.
--
-- ملاحظة على المحتوى: الدرس الذي لا اختبار لدرسه السابق لا يُقال
-- فيه «اجتز الاختبار» — لا اختبار يُجتاز. يُقال «أنهي الدرس
-- السابق أولاً»، وهو الصدق. ولجعل البوابة اختباراً في كل درس
-- تُضاف الاختبارات من اللوحة، فيتبدّل النصّ وحده.
-- ============================================================

create or replace function public.lesson_lock_reason(p_lesson uuid, p_uid uuid default auth.uid())
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  l    record;
  prev record;
  qz   uuid;
  best integer;
begin
  if p_uid is null then return 'سجّلي الدخول لعرض الدرس'; end if;
  if public.lesson_unlocked(p_lesson, p_uid) then return null; end if;

  select id, level_id, sort_order, week_no, published, free_preview, access, title
    into l
  from public.lessons where id = p_lesson;

  if not found or not l.published then return 'الدرس غير متاح'; end if;
  if l.access = 'locked' then return 'هذا الدرس مغلق من الإدارة'; end if;

  if not public.lesson_tier_ok(p_lesson, p_uid) then
    return coalesce('يتطلب باقة ' || public.lesson_required_plan(p_lesson),
                    'يتطلب باقة أعلى');
  end if;

  if l.level_id is not null and not public.level_unlocked(l.level_id, p_uid) then
    return 'أكملي المستوى السابق أولاً';
  end if;

  select ls.id into prev
  from public.lessons ls
  where ls.published
    and ls.level_id is not distinct from l.level_id
    and (ls.week_no, ls.sort_order, ls.id) < (l.week_no, l.sort_order, l.id)
  order by ls.week_no desc, ls.sort_order desc, ls.id desc
  limit 1;

  if not found then return 'غير متاح الآن'; end if;

  qz := public.gating_quiz(prev.id);

  -- لا اختبار للسابق: البوابة إنهاؤه، فلا يُقال غير ذلك
  if qz is null then return 'أنهي الدرس السابق أولاً'; end if;

  select max(a.percent) into best
  from public.quiz_attempts a
  where a.quiz_id = qz and a.user_id = p_uid;

  if best is null then
    return 'اجتازي اختبار الدرس السابق 100% لفتحه';
  end if;

  return 'أفضل نتيجة لك في اختبار الدرس السابق ' || best ||
         '% — المطلوب 100% لفتحه';
end;
$fn$;

revoke all on function public.lesson_lock_reason(uuid, uuid) from public;
grant execute on function public.lesson_lock_reason(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
