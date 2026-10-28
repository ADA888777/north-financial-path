-- ============================================================
-- نورث للمسار المالي — الهجرة الثانية عشرة
-- المساعد داخل قاعدة البيانات: بحث فعلي في الدروس بلا خدمة خارجية
--
-- تُشغَّل بعد 11. تستبدل منطق المساعد ولا تحذف بياناته.
-- ============================================================

-- ------------------------------------------------------------
-- 1) توحيد شكل النص العربي
--    بدونه لا يطابق «الإغلاق» كلمة «الاغلاق»، ولا «شمعه» «شمعة».
-- ------------------------------------------------------------
create or replace function public.ar_norm(t text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(
    translate(
      regexp_replace(lower(coalesce(t, '')), '[ً-ْـ]', '', 'g'),
      'أإآٱىةؤئ',
      'اااايهوي'
    ),
    '[^a-z0-9ء-ي]+', ' ', 'g'));
$$;

-- كلمات لا تميّز سؤالاً عن آخر
create or replace function public.ar_stop()
returns text[]
language sql
immutable
as $$
  select array[
    'من','في','على','عن','الى','الي','ما','ماذا','هل','كيف','ليش','لماذا','وش','ايش',
    'هو','هي','هذا','هذه','ذلك','التي','الذي','و','او','ثم','ان','انا','انت','كان',
    'يكون','تكون','مع','كل','بين','عند','بعد','قبل','لكن','يعني','شنو','وين','متى',
    'اريد','ابي','ابغى','اشرح','اشرحلي','وضح','فهمني','سؤال','الفرق','معنى','تعريف'
  ];
$$;

-- كلمات السؤال المفيدة
create or replace function public.ar_tokens(t text)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(w), '{}')
  from (
    select distinct w
    from unnest(string_to_array(public.ar_norm(t), ' ')) as w
    where length(w) >= 3 and not (w = any(public.ar_stop()))
  ) s;
$$;

-- ------------------------------------------------------------
-- 2) أعمدة مُطبَّعة للبحث السريع
-- ------------------------------------------------------------
do $$
begin
  alter table public.lessons
    add column norm_blob text
    generated always as (
      public.ar_norm(coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(content,''))
    ) stored;
exception when duplicate_column then null;
end $$;

do $$
begin
  alter table public.lessons
    add column norm_title text generated always as (public.ar_norm(coalesce(title,''))) stored;
exception when duplicate_column then null;
end $$;

do $$
begin
  alter table public.vocab
    add column norm_term text generated always as (public.ar_norm(coalesce(term,''))) stored;
exception when duplicate_column then null;
end $$;

-- امتداد التشابه النصي. لا بد أن يسبق الفهرس أدناه، لأن gin_trgm_ops
-- يأتي معه؛ وبدونه يفشل السكربت بـ
-- operator class "gin_trgm_ops" does not exist for access method "gin".
-- في Supabase تُثبَّت الامتدادات في مخطط extensions وهو ضمن search_path.
create extension if not exists pg_trgm with schema extensions;

create index if not exists lessons_norm_idx on public.lessons using gin (norm_blob gin_trgm_ops);
create index if not exists vocab_norm_idx   on public.vocab (norm_term);

-- ------------------------------------------------------------
-- 3) أفضل فقرة في درس تجيب عن السؤال
--    تُقسَّم المادة فقرات، وتُرتَّب بعدد كلمات السؤال الواردة فيها.
-- ------------------------------------------------------------
create or replace function public.best_passage(p_text text, p_tokens text[], p_max integer default 2)
returns text
language sql
immutable
as $$
  with paras as (
    select trim(p) as body
    from unnest(regexp_split_to_array(coalesce(p_text, ''), E'\n\\s*\n')) p
    where length(trim(p)) >= 20
  ),
  scored as (
    select body,
           (select count(*) from unnest(p_tokens) tk
            where public.ar_norm(body) like '%' || tk || '%') as score
    from paras
  ),
  top as (
    select body from scored where score > 0
    order by score desc, length(body) limit greatest(1, p_max)
  )
  select coalesce(
    nullif((select string_agg(body, E'\n\n') from top), ''),
    left(trim(coalesce(p_text, '')), 700)
  );
$$;

-- ------------------------------------------------------------
-- 4) المساعد
--    يبني الجواب من نص الدروس نفسه. لا نص جاهز يُقدَّم كأنه معرفة:
--    العبارات الثابتة الوحيدة هي رسالتا «خارج النطاق» و«لم أجد».
-- ------------------------------------------------------------
create or replace function public.ask_assistant(p_question text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  toks     text[];
  v        record;
  l        record;
  hits     integer;
  parts    text[] := '{}';
  srcs     jsonb  := '[]'::jsonb;
  answer   text;
  found    boolean := false;
  q        text;
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

  toks := public.ar_tokens(q);

  if array_length(toks, 1) is null then
    answer := 'صياغة السؤال عامة. اذكر المصطلح أو المفهوم الذي تريد شرحه.';
    insert into public.assistant_messages (user_id, role, content, grounded)
    values (auth.uid(), 'assistant', answer, false);
    return jsonb_build_object('answer', answer, 'grounded', false, 'sources', '[]'::jsonb);
  end if;

  -- أ) مفردة مطابقة: المعنى من قاموس الدرس مباشرة
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

  -- ب) أفضل درسين، بعتبة صلة لا بمجرد مطابقة كلمة واحدة.
  --    بدون العتبة يجيب سؤال «كم سعر الذهب» من درس الشموع لمجرد
  --    ورود كلمة «سعر» فيه.
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
    limit 3
  loop
    -- شرطان معاً: نصف كلمات السؤال على الأقل موجودة،
    -- وإما أن تكون إحداها في العنوان وإما أن تتطابق كلمتان فأكثر.
    continue when l.b_hits * 2 < array_length(toks, 1);
    continue when l.t_hits = 0 and l.b_hits < 2;

    found := true;
    hits := l.b_hits;

    parts := parts || ('من درس «' || l.title || '»:' || E'\n' ||
      case
        when coalesce(l.summary, '') <> '' and
             (select count(*) from unnest(toks) tk
              where public.ar_norm(l.summary) like '%' || tk || '%') > 0
        then l.summary
        else public.best_passage(l.content, toks, 2)
      end);

    srcs := srcs || jsonb_build_array(jsonb_build_object('id', l.id, 'title', l.title));
  end loop;

  if not found then
    answer :=
      'لم أجد في دروس المنصة ما يجيب عن سؤالك. ' ||
      'أنا مخصص لشرح محتوى دورات نورث فقط، فإن كان سؤالك خارج الدروس فلن أستطيع الإجابة عنه. ' ||
      'وإن كان داخلها، جرّب ذكر المصطلح كما ورد في الدرس.';
    insert into public.assistant_messages (user_id, role, content, grounded)
    values (auth.uid(), 'assistant', answer, false);
    return jsonb_build_object('answer', answer, 'grounded', false, 'sources', '[]'::jsonb);
  end if;

  answer := array_to_string(parts, E'\n\n');

  -- مصدر واحد لكل درس حتى لو طابق من المفردات والنص معاً
  srcs := coalesce((
    select jsonb_agg(distinct e) from jsonb_array_elements(srcs) e
  ), '[]'::jsonb);

  insert into public.assistant_messages (user_id, role, content, grounded, sources)
  values (auth.uid(), 'assistant', answer, true, srcs);

  return jsonb_build_object('answer', answer, 'grounded', true, 'sources', srcs);
end;
$$;

revoke all on function public.ask_assistant(text) from public;
grant execute on function public.ask_assistant(text) to authenticated;

-- فهرس الدروس: يعرضه المساعد حين لا يجد شيئاً
create or replace function public.lesson_index()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'title', l.title)
                            order by l.sort_order, l.title), '[]'::jsonb)
  from public.lessons l where l.published;
$$;

revoke all on function public.lesson_index() from public;
grant execute on function public.lesson_index() to authenticated;

-- ------------------------------------------------------------
-- 9) إسقاط ما خلّفته النسخة الخارجية
--    `search_lesson_content` كانت تُغذّي النموذج الخارجي، و
--    `assistant_quota_left` كانت تحمي تكلفة كل سؤال. لا نموذج ولا تكلفة
--    الآن، فبقاؤهما صلاحية تنفيذ ممنوحة لدالة لا ينادِيها شيء.
--    `assistant_messages` و `my_assistant_history` تبقى: السجل بيان متعلّم.
-- ------------------------------------------------------------
drop function if exists public.search_lesson_content(text, integer);
drop function if exists public.assistant_quota_left(integer);

notify pgrst, 'reload schema';

select count(*) as دروس_قابلة_للبحث from public.lessons where published;
