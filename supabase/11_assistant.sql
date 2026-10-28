-- ============================================================
-- نورث للمسار المالي — الهجرة الحادية عشرة
-- بحث في محتوى الدروس، وسجل محادثات المساعد
--
-- تُشغَّل بعد 10. إضافية بالكامل.
-- ============================================================

-- ------------------------------------------------------------
-- 1) فهرس بحث عربي على الدروس
--    عمود مولَّد، فيتحدّث مع كل تعديل بلا مشغّل.
-- ------------------------------------------------------------
do $$
begin
  alter table public.lessons
    add column search_tsv tsvector
    generated always as (
      to_tsvector('arabic',
        coalesce(title, '') || ' ' ||
        coalesce(summary, '') || ' ' ||
        coalesce(content, ''))
    ) stored;
exception
  when duplicate_column then null;
  when undefined_object then
    -- لو لم تتوفر إعدادات البحث العربية، نستخدم simple
    alter table public.lessons
      add column search_tsv tsvector
      generated always as (
        to_tsvector('simple',
          coalesce(title, '') || ' ' ||
          coalesce(summary, '') || ' ' ||
          coalesce(content, ''))
      ) stored;
end $$;

create index if not exists lessons_search_idx on public.lessons using gin (search_tsv);

-- ------------------------------------------------------------
-- 2) استرجاع المقاطع ذات الصلة
--    تُنادى من دالة الخادم بمفتاحها السري، فلا تُمنح للواجهة.
--    المنشور فقط: المساعد لا يقتبس من مسودة.
-- ------------------------------------------------------------
create or replace function public.search_lesson_content(p_query text, p_limit integer default 6)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare cfg regconfig;
begin
  begin
    cfg := 'arabic'::regconfig;
  exception when undefined_object then
    cfg := 'simple'::regconfig;
  end;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'lesson_id', x.id,
      'title', x.title,
      'level', x.level_title,
      'summary', left(coalesce(x.summary, ''), 600),
      'content', left(coalesce(x.content, ''), 2200),
      'vocab', x.vocab,
      'rank', round(x.rank::numeric, 4)
    ) order by x.rank desc)
    from (
      select l.id, l.title, l.summary, l.content,
             lv.title as level_title,
             ts_rank(l.search_tsv, websearch_to_tsquery(cfg, p_query)) as rank,
             coalesce((
               select jsonb_agg(jsonb_build_object('term', v.term, 'meaning', v.meaning))
               from public.vocab v where v.lesson_id = l.id), '[]'::jsonb) as vocab
      from public.lessons l
      left join public.levels lv on lv.id = l.level_id
      where l.published
        and l.search_tsv @@ websearch_to_tsquery(cfg, p_query)
      order by rank desc
      limit greatest(1, least(p_limit, 12))
    ) x), '[]'::jsonb);
end;
$$;

revoke all on function public.search_lesson_content(text, integer) from public;
-- بلا grant: دالة الخادم وحدها تناديها.

-- ------------------------------------------------------------
-- 3) سجل المحادثة
-- ------------------------------------------------------------
create table if not exists public.assistant_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('user','assistant')),
  content    text not null,
  grounded   boolean,            -- هل استند الجواب إلى محتوى فعلي؟
  sources    jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists asst_user_idx on public.assistant_messages (user_id, created_at);

alter table public.assistant_messages enable row level security;

drop policy if exists "own messages" on public.assistant_messages;
create policy "own messages" on public.assistant_messages
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "clear own messages" on public.assistant_messages;
create policy "clear own messages" on public.assistant_messages
  for delete to authenticated using (user_id = auth.uid());

-- الكتابة من دالة الخادم وحدها.

create or replace function public.my_assistant_history(p_limit integer default 40)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'role', m.role, 'content', m.content,
    'grounded', m.grounded, 'sources', m.sources, 'created_at', m.created_at
  ) order by m.created_at), '[]'::jsonb)
  from (
    select * from public.assistant_messages
    where user_id = auth.uid()
    order by created_at desc
    limit greatest(1, least(p_limit, 100))
  ) m;
$$;

revoke all on function public.my_assistant_history(integer) from public;
grant execute on function public.my_assistant_history(integer) to authenticated;

-- حد يومي يحمي من استنزاف تكلفة الـ API
create or replace function public.assistant_quota_left(p_max integer default 40)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select greatest(0, p_max - (
    select count(*) from public.assistant_messages
    where user_id = auth.uid() and role = 'user'
      and created_at >= (public.north_today())::timestamp at time zone 'Asia/Riyadh'
  ))::integer;
$$;

revoke all on function public.assistant_quota_left(integer) from public;
grant execute on function public.assistant_quota_left(integer) to authenticated;

notify pgrst, 'reload schema';

select count(*) as دروس_مفهرسة from public.lessons where search_tsv is not null;
