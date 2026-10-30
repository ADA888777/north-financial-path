-- ============================================================
-- ٣٤) «تابع التعلم»: الدرس الذي وقفت عنده فعلاً
--
-- البطاقة كانت تعرض أحياناً درساً فرغت منه المشتركة، أو أول درس
-- في المنهج كله. سببان:
--
-- ١) موضع المتابعة كان «آخر درس تُرك فيه أثر، مكتملاً كان أو لا».
--    فمن فتحت درساً وأنهته ثم عادت إلى اللوحة وجدت البطاقة تدعوها
--    إلى الدرس نفسه.
--
-- ٢) البديل حين لا أثر كان أول درس غير مكتمل مرتّباً بـ
--    lessons.sort_order وحده — بلا ترتيب المستوى ولا الأسبوع، وبلا
--    التحقق أن الدرس مفتوح لها. و sort_order يبدأ من واحد في كل
--    مستوى، فكان الترتيب يقفز إلى درسٍ في مستوى آخر، أو إلى درس
--    مقفل تقودها البطاقة إلى بابه المغلق.
--
-- هنا تعريف واحد: أول درس مفتوح لم يكتمل، بترتيب المنهج —
-- المستوى ثم الأسبوع ثم ترتيب الدرس. والموضع يُقرأ لهذا الدرس
-- وحده، فلا يعود أثرٌ قديم بها إلى الوراء.
-- ============================================================

create or replace function public.my_next_lesson(p_uid uuid default auth.uid())
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := coalesce(p_uid, auth.uid());
  nx  record;
  pos integer;
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;

  select l.id, l.title, l.level_id, lv.title as level
    into nx
  from public.lessons l
  left join public.levels lv on lv.id = l.level_id
  where l.published
    and public.lesson_unlocked(l.id, uid)
    and not exists (select 1 from public.lesson_progress lp
                    where lp.lesson_id = l.id and lp.user_id = uid)
  order by coalesce(lv.sort_order, 9999), coalesce(l.week_no, 0),
           coalesce(l.sort_order, 0), l.title
  limit 1;

  -- لا درس مفتوحاً غير مكتمل: إمّا أنهت المتاح، وإمّا لم يُفتح لها
  -- شيء بعد. التفريق بينهما للواجهة، فالرسالتان مختلفتان.
  if not found then
    return jsonb_build_object(
      'done_all', true,
      'any_open', exists (
        select 1 from public.lessons l
        where l.published and public.lesson_unlocked(l.id, uid)));
  end if;

  select s.pos into pos
  from public.lesson_spots s
  where s.user_id = uid and s.lesson_id = nx.id;

  return jsonb_build_object(
    'done_all',  false,
    'lesson_id', nx.id,
    'title',     nx.title,
    'level_id',  nx.level_id,
    'level',     nx.level,
    'pos',       coalesce(pos, 0));
end;
$$;

revoke all on function public.my_next_lesson(uuid) from public;
grant execute on function public.my_next_lesson(uuid) to authenticated;

notify pgrst, 'reload schema';
