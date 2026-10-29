-- ============================================================
-- نورث للمسار المالي — الهجرة السادسة عشرة
-- المساعد: التحيات، والبحث المتدرّج، والتصريح بحدوده
--
-- المشكلة: «مرحبا» كانت تُعامَل سؤالاً، فيُجيب أنه لم يجد شيئاً في
-- الدروس. التحية ليست سؤالاً، والردّ عليها بالاعتذار تجربة سيئة.
--
-- وكذلك: البحث كان صارماً فيعتذر عن أسئلة محتواها موجود بصياغة أخرى.
-- صار على مرحلتين: مطابقة دقيقة، فإن خلت فمطابقة متساهلة تُعرض
-- بوصفها احتمالاً لا جواباً مؤكداً.
--
-- تُشغَّل بعد 15.
-- ============================================================

-- ------------------------------------------------------------
-- 1) تصنيف المدخل: تحية أم شكر أم سؤال عن قدرات المساعد أم سؤال
-- ------------------------------------------------------------
create or replace function public.msg_intent(p_text text)
returns text
language plpgsql
immutable
as $$
declare n text; w text[];
begin
  n := public.ar_norm(coalesce(p_text, ''));
  if n = '' then return 'empty'; end if;

  w := regexp_split_to_array(n, '\s+');

  -- التحية تُعرف بأنها كل الرسالة تقريباً، لا بورودها في أثنائها.
  -- «مرحبا، وش معنى المقاومة» سؤالٌ لا تحية.
  if array_length(w, 1) <= 4 then
    if n ~ '(السلام عليكم|سلام عليكم|مرحبا|اهلا|هلا|هاي|صباح الخير|مساء الخير|صباح النور|مساء النور|hi|hello|hey|salam)'
      then return 'greeting'; end if;
    if n ~ '(شكرا|مشكور|يعطيك العافيه|تسلم|جزاك الله|thanks|thank you)'
      then return 'thanks'; end if;
    if n ~ '(مع السلامه|باي|الى اللقاء|وداعا|bye)'
      then return 'bye'; end if;
    if n ~ '(كيف الحال|كيفك|شلونك|وش اخبارك|how are you)'
      then return 'greeting'; end if;
  end if;

  if n ~ '(وش تسوي|ايش تسوي|وش تقدر|ايش تقدر|كيف استخدمك|وش فايدتك|من انت|ماذا تفعل|مساعده|مساعدة|help)'
     and array_length(w, 1) <= 6
    then return 'capabilities'; end if;

  return 'question';
end;
$$;

grant execute on function public.msg_intent(text) to authenticated;

-- ------------------------------------------------------------
-- 2) عناوين قريبة تُقترح حين لا يُعثر على جواب
--    «لم أجد» وحدها طريق مسدود. العناوين تعطي خطوة تالية.
-- ------------------------------------------------------------
create or replace function public.lesson_suggestions(p_tokens text[], p_limit integer default 3)
returns jsonb
language sql
stable
security definer
-- بلا similarity: دالتها في مخطط extensions، وإضافته إلى search_path
-- لدالة security definer يوسّع ما يمكن أن يُختطف. الترتيب بالمطابقة
-- النصية يكفي لاقتراح عناوين.
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title)), '[]'::jsonb)
  from (
    select ls.id, ls.title,
           (select count(*) from unnest(p_tokens) tk where ls.norm_title like '%' || tk || '%') * 3
           + (select count(*) from unnest(p_tokens) tk where ls.norm_blob like '%' || tk || '%') as score
    from public.lessons ls
    where ls.published
    order by score desc, ls.sort_order
    limit greatest(1, p_limit)
  ) t
  where t.score > 0;
$$;

revoke all on function public.lesson_suggestions(text[], integer) from public;
grant execute on function public.lesson_suggestions(text[], integer) to authenticated;

-- ------------------------------------------------------------
-- 3) المساعد
--    يردّ على التحية تحيةً، ويبحث على مرحلتين، ويصرّح بما هو:
--    بحثٌ في محتوى الدروس، لا نموذج لغوي.
-- ------------------------------------------------------------
create or replace function public.ask_assistant(p_question text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  toks    text[];
  v       record;
  l       record;
  parts   text[] := '{}';
  srcs    jsonb  := '[]'::jsonb;
  answer  text;
  found   boolean := false;
  loose   boolean := false;
  q       text;
  intent  text;
  sugg    jsonb  := '[]'::jsonb;
  nm      text;
begin
  if auth.uid() is null then
    return jsonb_build_object('error', 'غير مصرّح');
  end if;
  if not (public.is_admin() or public.has_active_subscription()) then
    return jsonb_build_object('error', 'المساعد متاح للمشتركين باشتراك نافذ.');
  end if;

  q := trim(coalesce(p_question, ''));
  if q = '' then
    return jsonb_build_object('error', 'اكتب سؤالك أولاً');
  end if;

  insert into public.assistant_messages (user_id, role, content, grounded)
  values (auth.uid(), 'user', q, null);

  -- ---------- أ) ما ليس سؤالاً ----------
  intent := public.msg_intent(q);

  if intent in ('greeting', 'thanks', 'bye', 'capabilities', 'empty') then
    select full_name into nm from public.profiles where id = auth.uid();

    answer := case intent
      when 'greeting' then
        'أهلاً' || coalesce(' ' || split_part(coalesce(nm, ''), ' ', 1), '') ||
        '. أنا مساعد الدروس في نورث: أبحث لك في دروس المنصة ومفرداتها وأعرض ما ورد فيها مع اسم الدرس. ' ||
        'اسألني عن مصطلح أو مفهوم درسته — مثل «وش معنى المقاومة» أو «كيف أحسب حجم المركز».'
      when 'thanks' then
        'العفو. إن احتجت شرح مصطلح أو مراجعة درس، اسأل.'
      when 'bye' then
        'إلى اللقاء. دروسك بانتظارك متى رجعت.'
      when 'capabilities' then
        'أبحث في دروس المنصة المنشورة ومفرداتها، وأعرض لك ما ورد فيها كما هو مع اسم الدرس ورابطه. ' ||
        'لا أؤلّف إجابات من عندي، ولا أجيب عمّا هو خارج الدروس، ولا أقدّم توصية بشراء أو بيع ولا توقّع سعر.'
      else
        'اكتب سؤالك عن أي مصطلح أو مفهوم في الدروس.'
    end;

    insert into public.assistant_messages (user_id, role, content, grounded)
    values (auth.uid(), 'assistant', answer, null);

    return jsonb_build_object('answer', answer, 'grounded', null,
                              'kind', intent, 'sources', '[]'::jsonb);
  end if;

  -- ---------- ب) سؤال ----------
  toks := public.ar_tokens(q);

  if array_length(toks, 1) is null then
    answer := 'صياغة السؤال عامة. اذكر المصطلح أو المفهوم الذي تريد شرحه.';
    insert into public.assistant_messages (user_id, role, content, grounded)
    values (auth.uid(), 'assistant', answer, false);
    return jsonb_build_object('answer', answer, 'grounded', false,
                              'kind', 'vague', 'sources', '[]'::jsonb);
  end if;

  -- مفردة مطابقة
  for v in
    select vb.term, vb.meaning, l2.id as lesson_id, l2.title as lesson_title
    from public.vocab vb
    join public.lessons l2 on l2.id = vb.lesson_id
    where l2.published and vb.meaning <> ''
      and exists (select 1 from unnest(toks) tk
                  where vb.norm_term like '%' || tk || '%' or tk like '%' || vb.norm_term || '%')
    limit 3
  loop
    found := true;
    parts := parts || ('• ' || v.term || ': ' || v.meaning);
    srcs := srcs || jsonb_build_array(
      jsonb_build_object('id', v.lesson_id, 'title', v.lesson_title));
  end loop;

  -- دروس بعتبة صلة صارمة
  for l in
    select ls.id, ls.title, ls.summary, ls.content,
           (select count(*) from unnest(toks) tk where ls.norm_title like '%' || tk || '%') as t_hits,
           (select count(*) from unnest(toks) tk where ls.norm_blob  like '%' || tk || '%') as b_hits
    from public.lessons ls
    where ls.published
    order by
      (select count(*) from unnest(toks) tk where ls.norm_title like '%' || tk || '%') * 3
      + (select count(*) from unnest(toks) tk where ls.norm_blob like '%' || tk || '%') desc,
      ls.sort_order
    limit 4
  loop
    continue when l.b_hits * 2 < array_length(toks, 1);
    continue when l.t_hits = 0 and l.b_hits < 2;

    found := true;
    parts := parts || ('من درس «' || l.title || '»:' || E'\n' ||
                       public.best_passage(coalesce(nullif(l.content, ''), l.summary), toks, 2));
    srcs := srcs || jsonb_build_array(jsonb_build_object('id', l.id, 'title', l.title));
    exit when array_length(parts, 1) >= 3;
  end loop;

  -- مرحلة متساهلة: مطابقة واحدة قوية تُعرض احتمالاً لا جواباً مؤكداً.
  -- بدونها يعتذر المساعد عن سؤال محتواه موجود بصياغة أخرى.
  if not found then
    for l in
      select ls.id, ls.title, ls.summary, ls.content,
             (select count(*) from unnest(toks) tk
              where ls.norm_title like '%' || tk || '%' and length(tk) >= 4) as t_hits,
             (select count(*) from unnest(toks) tk
              where ls.norm_blob like '%' || tk || '%' and length(tk) >= 4) as b_hits
      from public.lessons ls
      where ls.published
      order by
        (select count(*) from unnest(toks) tk
         where ls.norm_title like '%' || tk || '%' and length(tk) >= 4) * 3
        + (select count(*) from unnest(toks) tk
           where ls.norm_blob like '%' || tk || '%' and length(tk) >= 4) desc,
        ls.sort_order
      limit 1
    loop
      continue when l.t_hits = 0 and l.b_hits = 0;
      found := true; loose := true;
      parts := parts || ('لم أجد تطابقاً دقيقاً، وأقرب ما وجدته في درس «' || l.title || '»:' ||
                         E'\n' || public.best_passage(
                           coalesce(nullif(l.content, ''), l.summary), toks, 1));
      srcs := srcs || jsonb_build_array(jsonb_build_object('id', l.id, 'title', l.title));
    end loop;
  end if;

  srcs := coalesce((select jsonb_agg(distinct e) from jsonb_array_elements(srcs) e), '[]'::jsonb);

  if not found then
    sugg := public.lesson_suggestions(toks, 3);
    answer := 'لم أجد في دروس المنصة ما يجيب عن سؤالك. أنا مساعد بحث في محتوى الدروس ' ||
              'ولست نموذج ذكاء اصطناعي، فما لم يكتبه المعلّم في درس لا أعرفه. ' ||
              case when jsonb_array_length(sugg) > 0
                   then 'قد تجد ما تبحث عنه في الدروس المقترحة أدناه.'
                   else 'إن كان سؤالك داخل الدروس فجرّب ذكر المصطلح نفسه كما ورد فيها.' end;

    insert into public.assistant_messages (user_id, role, content, grounded)
    values (auth.uid(), 'assistant', answer, false);

    return jsonb_build_object('answer', answer, 'grounded', false,
                              'kind', 'not_found', 'sources', '[]'::jsonb,
                              'suggestions', sugg);
  end if;

  answer := array_to_string(parts, E'\n\n');

  insert into public.assistant_messages (user_id, role, content, grounded)
  values (auth.uid(), 'assistant', answer, true);

  return jsonb_build_object('answer', answer, 'grounded', true,
                            'kind', case when loose then 'loose' else 'exact' end,
                            'sources', srcs);
end;
$$;

revoke all on function public.ask_assistant(text) from public;
grant execute on function public.ask_assistant(text) to authenticated;

notify pgrst, 'reload schema';
