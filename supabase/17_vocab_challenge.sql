-- ============================================================
-- نورث للمسار المالي — الهجرة السابعة عشرة
-- التحدي: المتعلم يكتب تعريف المصطلح
--
-- التحقق بقواعد معلنة لا بذكاء اصطناعي: يُقارَن جواب المتعلم بالكلمات
-- الأساسية في التعريف الذي كتبه الأدمن. القاعدة تُعرض للمتعلم كما هي،
-- فلا يُقال له إن التقييم ذكي وهو مطابقة كلمات.
--
-- تُشغَّل بعد 16.
-- ============================================================

-- ------------------------------------------------------------
-- 1) المحاولات
--    صفّ واحد لكل (متعلم، مفردة): إعادة الإجابة تُحدّثه ولا تضيف
--    صفاً، فلا تُحتسب المفردة الواحدة مرتين في النتيجة مهما كُرّر
--    الضغط على «تحقق».
-- ------------------------------------------------------------
create table if not exists public.vocab_attempts (
  user_id    uuid not null references auth.users(id) on delete cascade,
  vocab_id   uuid not null references public.vocab(id) on delete cascade,
  answer     text not null default '',
  verdict    text not null check (verdict in ('correct', 'close', 'wrong')),
  overlap    integer not null default 0,
  tries      integer not null default 1,
  first_at   timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, vocab_id)
);

create index if not exists vocab_attempts_user_idx
  on public.vocab_attempts (user_id, updated_at desc);

alter table public.vocab_attempts enable row level security;

drop policy if exists "own vocab attempts" on public.vocab_attempts;
create policy "own vocab attempts" on public.vocab_attempts
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "admin reads vocab attempts" on public.vocab_attempts;
create policy "admin reads vocab attempts" on public.vocab_attempts
  for select to authenticated using (public.is_admin());

grant select on public.vocab_attempts to authenticated;
-- لا كتابة مباشرة: الحكم يصدر من الخادم، وإلا كتب المتعلم 'correct'.
revoke insert, update, delete on public.vocab_attempts from authenticated, anon;

-- ------------------------------------------------------------
-- 2) قياس التطابق
--    نسبة كلمات التعريف المعتمد الأساسية الواردة في جواب المتعلم.
--    الكلمات القصيرة وحروف الجر مستبعدة بـ ar_tokens.
-- ------------------------------------------------------------
create or replace function public.answer_overlap(p_expected text, p_given text)
returns integer
language plpgsql
immutable
as $$
declare
  want text[];
  got  text;
  hit  integer := 0;
  tk   text;
begin
  want := public.ar_tokens(coalesce(p_expected, ''));
  got  := public.ar_norm(coalesce(p_given, ''));

  if array_length(want, 1) is null or got = '' then return 0; end if;

  foreach tk in array want loop
    -- جذر تقريبي: «المقاومة» و«مقاومة» و«مقاوم» تُعدّ إصابة واحدة.
    if got like '%' || tk || '%'
       or (length(tk) > 4 and got like '%' || substr(tk, 1, length(tk) - 1) || '%')
       or (length(tk) > 5 and got like '%' || substr(tk, 3) || '%')
    then hit := hit + 1; end if;
  end loop;

  return (hit * 100) / array_length(want, 1);
end;
$$;

grant execute on function public.answer_overlap(text, text) to authenticated;

-- ------------------------------------------------------------
-- 3) مفردات التحدي
--    من الدروس المنشورة في المراحل المفتوحة للمتعلم وحدها.
--    التعريف لا يُرسل إلى المتصفح إلا بعد أن يجيب.
-- ------------------------------------------------------------
create or replace function public.my_vocab_challenge(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); items jsonb; tot integer; ok integer;
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;
  if not (public.is_admin() or public.has_active_subscription()) then
    return jsonb_build_object('error', 'التحدي متاح للمشتركين باشتراك نافذ.');
  end if;

  select coalesce(jsonb_agg(x order by x->>'sort', x->>'term'), '[]'::jsonb) into items
  from (
    select jsonb_build_object(
      'id', v.id,
      'term', v.term,
      'lesson_id', l.id,
      'lesson', l.title,
      'sort', lpad(coalesce(l.sort_order, 0)::text, 6, '0') ||
              lpad(coalesce(v.sort_order, 0)::text, 6, '0'),
      'answered', a.vocab_id is not null,
      'verdict', a.verdict,
      'my_answer', a.answer,
      -- التعريف المعتمد لا يُرسل قبل الإجابة
      'meaning', case when a.vocab_id is not null then v.meaning else null end
    ) x
    from public.vocab v
    join public.lessons l on l.id = v.lesson_id and l.published
    left join public.vocab_attempts a on a.vocab_id = v.id and a.user_id = uid
    where btrim(v.meaning) <> ''
      and (l.level_id is null or public.level_unlocked(l.level_id, uid))
    limit greatest(1, p_limit)
  ) t;

  tot := jsonb_array_length(items);
  select count(*) into ok
  from public.vocab_attempts a
  join public.vocab v on v.id = a.vocab_id
  join public.lessons l on l.id = v.lesson_id and l.published
  where a.user_id = uid and a.verdict in ('correct', 'close');

  return jsonb_build_object(
    'items', items,
    'total', tot,
    'answered', (select count(*) from public.vocab_attempts a2
                 join public.vocab v2 on v2.id = a2.vocab_id
                 join public.lessons l2 on l2.id = v2.lesson_id and l2.published
                 where a2.user_id = uid),
    'correct', ok);
end;
$$;

revoke all on function public.my_vocab_challenge(integer) from public;
grant execute on function public.my_vocab_challenge(integer) to authenticated;

-- ------------------------------------------------------------
-- 4) التحقق
--    الحكم في الخادم. العتبتان معلنتان في الواجهة.
-- ------------------------------------------------------------
create or replace function public.check_vocab(p_vocab uuid, p_answer text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  v   record;
  ov  integer;
  res text;
  ans text;
  prev record;
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;
  if not (public.is_admin() or public.has_active_subscription()) then
    return jsonb_build_object('error', 'التحدي متاح للمشتركين باشتراك نافذ.');
  end if;

  ans := btrim(coalesce(p_answer, ''));
  if ans = '' then return jsonb_build_object('error', 'اكتب التعريف أولاً'); end if;

  select vb.id, vb.term, vb.meaning, l.id as lesson_id, l.title as lesson, l.level_id
  into v
  from public.vocab vb
  join public.lessons l on l.id = vb.lesson_id and l.published
  where vb.id = p_vocab and btrim(vb.meaning) <> '';

  if not found then return jsonb_build_object('error', 'المفردة غير متاحة'); end if;

  if v.level_id is not null and not public.level_unlocked(v.level_id, uid) then
    return jsonb_build_object('error', 'هذه المفردة في مرحلة لم تُفتح بعد');
  end if;

  ov := public.answer_overlap(v.meaning, ans);

  -- مطابقة حرفية بعد التوحيد تُقبل مهما كان التداخل
  if public.ar_norm(ans) = public.ar_norm(v.meaning) then
    ov := 100;
  end if;

  res := case when ov >= 70 then 'correct'
              when ov >= 45 then 'close'
              else 'wrong' end;

  select * into prev from public.vocab_attempts
   where user_id = uid and vocab_id = p_vocab;

  insert into public.vocab_attempts (user_id, vocab_id, answer, verdict, overlap)
  values (uid, p_vocab, ans, res, ov)
  on conflict (user_id, vocab_id) do update
    set answer     = excluded.answer,
        -- أفضل حكم يبقى: محاولة لاحقة أضعف لا تمحو نجاحاً سابقاً
        verdict    = case
                       when public.vocab_attempts.verdict = 'correct' then 'correct'
                       when public.vocab_attempts.verdict = 'close'
                            and excluded.verdict = 'wrong' then 'close'
                       else excluded.verdict end,
        overlap    = greatest(public.vocab_attempts.overlap, excluded.overlap),
        tries      = public.vocab_attempts.tries + 1,
        updated_at = now();

  perform public.touch_activity();

  return jsonb_build_object(
    'ok', true,
    'verdict', res,
    'overlap', ov,
    'meaning', v.meaning,
    'term', v.term,
    'lesson_id', v.lesson_id,
    'repeat', prev.vocab_id is not null,
    'counted', prev.vocab_id is null,
    'message', case res
      when 'correct' then 'إجابة صحيحة.'
      when 'close'   then 'قريبة — جوابك يغطي معظم التعريف المعتمد.'
      else 'غير صحيحة.' end);
end;
$$;

revoke all on function public.check_vocab(uuid, text) from public;
grant execute on function public.check_vocab(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 5) إدارة المفردات
-- ------------------------------------------------------------
create or replace function public.admin_vocab(p_lesson uuid default null, p_q text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare nq text;
begin
  if not public.is_admin() then
    raise exception 'هذه العملية للإدارة وحدها' using errcode = '42501';
  end if;
  nq := nullif(public.ar_norm(coalesce(p_q, '')), '');

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', v.id, 'term', v.term, 'meaning', v.meaning,
      'sort_order', v.sort_order,
      'lesson_id', l.id, 'lesson', l.title,
      'lesson_published', l.published,
      'level', lv.title,
      'attempts', (select count(*) from public.vocab_attempts a where a.vocab_id = v.id))
      order by l.sort_order, v.sort_order, v.term)
    from public.vocab v
    join public.lessons l on l.id = v.lesson_id
    left join public.levels lv on lv.id = l.level_id
    where (p_lesson is null or v.lesson_id = p_lesson)
      and (nq is null
           or public.ar_norm(v.term) like '%' || nq || '%'
           or public.ar_norm(v.meaning) like '%' || nq || '%')), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_vocab(uuid, text) from public;
grant execute on function public.admin_vocab(uuid, text) to authenticated;

create or replace function public.admin_save_vocab(
  p_id uuid, p_lesson uuid, p_term text, p_meaning text, p_sort integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare tm text; mn text; rid uuid;
begin
  if not public.is_admin() then
    raise exception 'هذه العملية للإدارة وحدها' using errcode = '42501';
  end if;

  tm := nullif(btrim(coalesce(p_term, '')), '');
  mn := nullif(btrim(coalesce(p_meaning, '')), '');
  if tm is null then return jsonb_build_object('error', 'المصطلح مطلوب'); end if;
  if mn is null then
    return jsonb_build_object('error',
      'التعريف مطلوب: التحدي يقارن جواب المتعلم به، ومفردةٌ بلا تعريف لا تدخله.');
  end if;
  if p_lesson is null or not exists (select 1 from public.lessons where id = p_lesson) then
    return jsonb_build_object('error', 'اختر الدرس الذي تنتمي إليه المفردة');
  end if;

  if exists (select 1 from public.vocab
             where lesson_id = p_lesson and public.ar_norm(term) = public.ar_norm(tm)
               and (p_id is null or id <> p_id)) then
    return jsonb_build_object('error', 'هذا المصطلح مضاف في الدرس نفسه');
  end if;

  if p_id is null then
    insert into public.vocab (lesson_id, term, meaning, sort_order)
    values (p_lesson, tm, mn, coalesce(p_sort, 0)) returning id into rid;
    return jsonb_build_object('ok', true, 'id', rid, 'message', 'أُضيفت المفردة.');
  end if;

  update public.vocab
     set lesson_id = p_lesson, term = tm, meaning = mn,
         sort_order = coalesce(p_sort, 0)
   where id = p_id;

  if not found then return jsonb_build_object('error', 'المفردة غير موجودة'); end if;
  return jsonb_build_object('ok', true, 'id', p_id, 'message', 'حُفظت المفردة.');
end;
$$;

revoke all on function public.admin_save_vocab(uuid, uuid, text, text, integer) from public;
grant execute on function public.admin_save_vocab(uuid, uuid, text, text, integer) to authenticated;

create or replace function public.admin_delete_vocab(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n integer;
begin
  if not public.is_admin() then
    raise exception 'هذه العملية للإدارة وحدها' using errcode = '42501';
  end if;

  select count(*) into n from public.vocab_attempts where vocab_id = p_id;
  delete from public.vocab where id = p_id;
  if not found then return jsonb_build_object('error', 'المفردة غير موجودة'); end if;

  return jsonb_build_object('ok', true,
    'message', 'حُذفت المفردة' ||
      case when n > 0 then ' ومعها ' || n || ' محاولة مسجّلة.' else '.' end);
end;
$$;

revoke all on function public.admin_delete_vocab(uuid) from public;
grant execute on function public.admin_delete_vocab(uuid) to authenticated;

-- ------------------------------------------------------------
-- 6) مراجعة بشرية حين تعجز القاعدة
--    مطابقة الكلمات لا تعرف المرادفات: «نقطة يتوقف فيها ارتفاع السعر»
--    تعريف صحيح للمقاومة، وتُرفض لأن كلماتها غير كلمات التعريف. هذا
--    حدٌّ معروف للقاعدة، فالمخرج مراجعة الأدمن لا ادّعاء فهمٍ غير موجود.
-- ------------------------------------------------------------
alter table public.vocab_attempts
  add column if not exists disputed boolean not null default false;
alter table public.vocab_attempts
  add column if not exists resolved_at timestamptz;

create or replace function public.dispute_vocab(p_vocab uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;

  update public.vocab_attempts
     set disputed = true, resolved_at = null
   where user_id = uid and vocab_id = p_vocab and verdict <> 'correct';

  if not found then
    return jsonb_build_object('error', 'لا توجد إجابة لمراجعتها، أو هي مقبولة أصلاً.');
  end if;

  return jsonb_build_object('ok', true,
    'message', 'أُرسلت إجابتك للمراجعة. ستُحتسب إن قبلها المعلّم.');
end;
$$;

revoke all on function public.dispute_vocab(uuid) from public;
grant execute on function public.dispute_vocab(uuid) to authenticated;

create or replace function public.admin_disputes()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'هذه العملية للإدارة وحدها' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', a.user_id, 'vocab_id', a.vocab_id,
      'member', p.full_name, 'membership_no', p.membership_no,
      'term', v.term, 'meaning', v.meaning, 'lesson', l.title,
      'answer', a.answer, 'verdict', a.verdict, 'overlap', a.overlap,
      'at', a.updated_at) order by a.updated_at)
    from public.vocab_attempts a
    join public.vocab v on v.id = a.vocab_id
    join public.lessons l on l.id = v.lesson_id
    join public.profiles p on p.id = a.user_id
    where a.disputed and a.resolved_at is null), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_disputes() from public;
grant execute on function public.admin_disputes() to authenticated;

create or replace function public.admin_resolve_dispute(
  p_user uuid, p_vocab uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'هذه العملية للإدارة وحدها' using errcode = '42501';
  end if;

  update public.vocab_attempts
     set verdict = case when p_accept then 'correct' else verdict end,
         disputed = false, resolved_at = now()
   where user_id = p_user and vocab_id = p_vocab;

  if not found then return jsonb_build_object('error', 'المحاولة غير موجودة'); end if;

  return jsonb_build_object('ok', true,
    'message', case when p_accept then 'قُبلت الإجابة واحتُسبت.' else 'بقيت كما هي.' end);
end;
$$;

revoke all on function public.admin_resolve_dispute(uuid, uuid, boolean) from public;
grant execute on function public.admin_resolve_dispute(uuid, uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
