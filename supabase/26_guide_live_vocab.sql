-- ============================================================
-- 26: دليل المبتدئين، وتذكير اللايفات، وبيانات تحدّي المفردات
--
--   أ) الدليل محتوى ثابت يراه الجميع، لا يرتبط بتقدّم ولا بباقة.
--   ب) تذكير اللايف قبل ٢٤ ساعة يُرسَل من الخادم، لا من صفحة مفتوحة.
--   ج) المفردة تحمل درسها ومستواها، والإجمالي من القاعدة لا من الواجهة.
-- ============================================================

-- ------------------------------------------------------------
-- أ) دليل المبتدئين
--
--    كان beginner_guide() يعيد المسارات الموسومة for_beginners، أي
--    أنه كان جزءاً من المنهج. الدليل المطلوب شيء آخر: نصائح ثابتة
--    تُقرأ قبل البدء وبعده، لا تتغيّر بإكمال درس ولا تختلف بين باقة
--    وأخرى. فله جدوله الخاص، ودالته لا تسأل عن رتبة ولا عن تقدّم.
-- ------------------------------------------------------------
create table if not exists public.guide_steps (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null default '',
  icon       text not null default 'check_circle',
  accent     text not null default 'blue'
             check (accent in ('blue','green','violet','amber','rose','teal')),
  is_goal    boolean not null default false,   -- بطاقة الهدف الختامية
  sort_order integer not null default 0,
  published  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists guide_steps_order_idx
  on public.guide_steps (published, sort_order);

alter table public.guide_steps enable row level security;

drop policy if exists guide_read on public.guide_steps;
create policy guide_read on public.guide_steps
  for select to authenticated
  using (published or public.is_admin());

drop policy if exists guide_write on public.guide_steps;
create policy guide_write on public.guide_steps
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop trigger if exists guide_steps_touch on public.guide_steps;
create trigger guide_steps_touch before update on public.guide_steps
  for each row execute function public.touch_updated_at();

-- الدليل: لا رتبة ولا تقدّم في الشرط. من سجّل دخوله يراه كاملاً.
create or replace function public.beginner_guide()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', g.id, 'title', g.title, 'body', g.body,
      'icon', g.icon, 'accent', g.accent, 'is_goal', g.is_goal
    ) order by g.is_goal, g.sort_order, g.title), '[]'::jsonb)
  from public.guide_steps g
  where g.published;
$$;

revoke all on function public.beginner_guide() from public;
grant execute on function public.beginner_guide() to authenticated;

create or replace function public.admin_guide_steps()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when not public.is_admin() then jsonb_build_object('error','غير مصرّح')
  else coalesce((select jsonb_agg(to_jsonb(g) order by g.is_goal, g.sort_order, g.title)
                 from public.guide_steps g), '[]'::jsonb) end;
$$;

revoke all on function public.admin_guide_steps() from public;
grant execute on function public.admin_guide_steps() to authenticated;

-- ------------------------------------------------------------
-- ب) تذكير اللايفات قبل ٢٤ ساعة
--
--    القاعدة تعرف المواعيد، فهي من يذكّر. الاعتماد على صفحة مفتوحة
--    يعني أن من أغلقت المتصفح لا تُذكَّر — وهو بالضبط ما لا نريده.
--    منع التكرار ليس شرطاً في الكود: unique(user_id, dedupe_key) على
--    جدول الإشعارات يمنعه في القاعدة، والمفتاح يحمل معرّف الحصة.
-- ------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('booking_created','booking_changed','booking_cancelled',
                  'subscription_expiring','subscription_expired',
                  'live_soon','live_changed','general'));

create or replace function public.send_live_reminders()
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  s   record;
  u   record;
  n   integer := 0;
  whn text;
begin
  for s in
    select cs.id, cs.title, cs.starts_at, cs.meeting_url
    from public.class_slots cs
    where cs.kind = 'live' and cs.published and cs.status = 'scheduled'
      and cs.starts_at > now()
      and cs.starts_at <= now() + interval '24 hour'
  loop
    whn := to_char(s.starts_at at time zone 'Asia/Riyadh', 'HH12:MI AM');

    -- المؤهّلون: من حجزت مقعدها، أو كل مشترك نافذ إن كانت مفتوحة
    for u in
      select distinct p.id
      from public.profiles p
      where p.status = 'active'
        and public.has_active_subscription(p.id)
        and (exists (select 1 from public.bookings b
                     where b.slot_id = s.id and b.user_id = p.id
                       and b.status = 'booked')
             or not exists (select 1 from public.bookings b where b.slot_id = s.id))
    loop
      if public.push_notification(
           u.id, 'live_soon',
           'حصة مباشرة بعد أقل من ٢٤ ساعة',
           '«' || s.title || '» تبدأ ' || whn || ' بتوقيت الرياض.',
           'live.html',
           'live_soon:' || s.id::text) is not null then
        n := n + 1;
      end if;
    end loop;
  end loop;

  return n;
end;
$$;

revoke all on function public.send_live_reminders() from public;
grant execute on function public.send_live_reminders() to authenticated;

-- تغيّر الموعد أو أُلغي: التذكير القديم يُسحب ليُبنى على الموعد الجديد.
create or replace function public.live_slot_changed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.kind <> 'live' then return new; end if;

  if new.starts_at is distinct from old.starts_at
     or new.status is distinct from old.status
     or new.published is distinct from old.published then

    -- يُحذف التذكير القديم فيُرسل من جديد على الموعد الجديد
    delete from public.notifications
    where dedupe_key = 'live_soon:' || new.id::text;

    if new.starts_at is distinct from old.starts_at and new.status = 'scheduled' then
      insert into public.notifications (user_id, kind, title, body, link, dedupe_key)
      select b.user_id, 'live_changed', 'تغيّر موعد حصة مباشرة',
             '«' || new.title || '» صار موعدها ' ||
             to_char(new.starts_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH12:MI AM') ||
             ' بتوقيت الرياض.',
             'live.html',
             'live_changed:' || new.id::text || ':' ||
               extract(epoch from new.starts_at)::bigint::text
      from public.bookings b
      where b.slot_id = new.id and b.status = 'booked'
      on conflict (user_id, dedupe_key) do nothing;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists class_slots_live_changed on public.class_slots;
create trigger class_slots_live_changed
  after update on public.class_slots
  for each row execute function public.live_slot_changed();

-- جدولة من الخادم متى كان pg_cron مفعّلاً في المشروع.
-- إن لم يكن، تبقى الدالة قابلة للنداء ويُفعَّل cron من لوحة Supabase.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('north-live-reminders', '*/15 * * * *',
                          $cron$select public.send_live_reminders();$cron$);
  end if;
exception when others then
  raise notice 'pg_cron غير مهيّأ: تُجدوَل send_live_reminders يدوياً من لوحة Supabase.';
end $$;

-- ------------------------------------------------------------
-- حالة الحصة: قادمة أم جارية أم انتهت
--     عدّاد تنازلي يستمر بعد البداية رقمٌ خاطئ يراه الجميع.
-- ------------------------------------------------------------
create or replace function public.slots_by_kind(p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;
  if p_kind not in ('live', 'private') then
    return jsonb_build_object('error', 'نوع غير معروف');
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', cs.id, 'title', cs.title, 'description', cs.description,
      'starts_at', cs.starts_at, 'duration_min', cs.duration_min,
      'ends_at', cs.starts_at + make_interval(mins => coalesce(cs.duration_min, 60)),
      'capacity', cs.capacity,
      'seats_left', greatest(0, cs.capacity -
        (select count(*) from public.bookings b
         where b.slot_id = cs.id and b.status <> 'no_show')),
      'mine', exists (select 1 from public.bookings b
                      where b.slot_id = cs.id and b.user_id = uid),
      -- الحالة من الخادم: ساعة المتصفح قد تكون مضبوطة خطأً
      'phase', case
        when now() < cs.starts_at then 'upcoming'
        when now() < cs.starts_at + make_interval(mins => coalesce(cs.duration_min, 60))
          then 'live'
        else 'ended' end,
      'soon', cs.starts_at > now() and cs.starts_at <= now() + interval '24 hour',
      'meeting_url', case when exists (
          select 1 from public.bookings b
          where b.slot_id = cs.id and b.user_id = uid and b.status = 'booked')
        then cs.meeting_url else null end)
      order by cs.starts_at)
    from public.class_slots cs
    where cs.published and cs.kind = p_kind
      and cs.status = 'scheduled'
      -- الجارية تبقى ظاهرة حتى تنتهي
      and cs.starts_at + make_interval(mins => coalesce(cs.duration_min, 60)) > now()
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.slots_by_kind(text) from public;
grant execute on function public.slots_by_kind(text) to authenticated;

-- ------------------------------------------------------------
-- ج) تحدّي المفردات
--
--    ثلاثة نواقص: الإجمالي كان محدوداً بسقف الصفحة فلا يصلح لعرض
--    «مفردة ١ من ٩١»؛ والمستوى لم يكن في الحمولة فلا يُعرف من أين
--    جاءت المفردة؛ والترتيب لم يكن ثابتاً بين الزيارات.
-- ------------------------------------------------------------
create or replace function public.my_vocab_challenge(p_limit integer default 500)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  uid   uuid := auth.uid();
  items jsonb;
  tot   integer;
  shown integer;
  ok    integer;
  ans   integer;
begin
  if uid is null then return jsonb_build_object('error', 'غير مصرّح'); end if;
  if not (public.is_admin() or public.has_active_subscription()) then
    return jsonb_build_object('error', 'التحدي متاح للمشتركين باشتراك نافذ.');
  end if;

  -- الإجمالي الحقيقي للمفردات المتاحة لها، غير محدود بسقف العرض.
  -- هو ما يظهر في «مفردة ١ من N»، فلا يُكتب رقم في الواجهة.
  select count(*) into tot
  from public.vocab v
  join public.lessons l on l.id = v.lesson_id and l.published
  where btrim(coalesce(v.meaning, '')) <> ''
    and (l.level_id is null or public.level_unlocked(l.level_id, uid));

  select coalesce(jsonb_agg(x order by x->>'sort'), '[]'::jsonb) into items
  from (
    select jsonb_build_object(
      'id', v.id,
      'term', v.term,
      'lesson_id', l.id,
      'lesson', l.title,
      'level_id', lv.id,
      'level', lv.title,
      'level_code', lv.code,
      -- ترتيب ثابت بين الزيارات: المستوى ثم الدرس ثم المفردة ثم المعرّف
      'sort', lpad(coalesce(lv.sort_order, 0)::text, 6, '0') ||
              lpad(coalesce(l.sort_order, 0)::text, 6, '0') ||
              lpad(coalesce(v.sort_order, 0)::text, 6, '0') || v.id::text,
      'answered', a.vocab_id is not null,
      'verdict', a.verdict,
      'my_answer', a.answer,
      -- التعريف المعتمد لا يُرسل قبل أن تجيب
      'meaning', case when a.vocab_id is not null then v.meaning else null end
    ) x
    from public.vocab v
    join public.lessons l on l.id = v.lesson_id and l.published
    left join public.levels lv on lv.id = l.level_id
    left join public.vocab_attempts a on a.vocab_id = v.id and a.user_id = uid
    where btrim(coalesce(v.meaning, '')) <> ''
      and (l.level_id is null or public.level_unlocked(l.level_id, uid))
    order by lv.sort_order nulls last, l.sort_order, v.sort_order, v.id
    limit greatest(1, p_limit)
  ) t;

  shown := jsonb_array_length(items);

  select count(*) filter (where a.verdict in ('correct','close')),
         count(*)
    into ok, ans
  from public.vocab_attempts a
  join public.vocab v on v.id = a.vocab_id
  join public.lessons l on l.id = v.lesson_id and l.published
  where a.user_id = uid;

  return jsonb_build_object(
    'total', tot,          -- كل المفردات المتاحة لها
    'shown', shown,        -- ما حُمّل في هذه الصفحة
    'answered', coalesce(ans, 0),
    'correct', coalesce(ok, 0),
    'items', items);
end;
$$;

revoke all on function public.my_vocab_challenge(integer) from public;
grant execute on function public.my_vocab_challenge(integer) to authenticated;

-- تقرير للإدارة: كم مفردة منشورة فعلاً، وأين النقص
create or replace function public.admin_vocab_health()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when not public.is_admin()
    then jsonb_build_object('error','غير مصرّح')
    else jsonb_build_object(
      'ready', (select count(*) from public.vocab v
                join public.lessons l on l.id = v.lesson_id and l.published
                where btrim(coalesce(v.meaning,'')) <> ''),
      'no_meaning', (select count(*) from public.vocab v
                     join public.lessons l on l.id = v.lesson_id and l.published
                     where btrim(coalesce(v.meaning,'')) = ''),
      'unpublished_lesson', (select count(*) from public.vocab v
                             join public.lessons l on l.id = v.lesson_id
                             where not l.published),
      'by_level', coalesce((
        select jsonb_agg(jsonb_build_object('level', t.lvl, 'count', t.n)
                         order by t.so nulls last)
        from (select coalesce(lv.title,'بلا مستوى') lvl, lv.sort_order so, count(*) n
              from public.vocab v
              join public.lessons l on l.id = v.lesson_id and l.published
              left join public.levels lv on lv.id = l.level_id
              where btrim(coalesce(v.meaning,'')) <> ''
              group by lv.title, lv.sort_order) t), '[]'::jsonb))
  end;
$$;

revoke all on function public.admin_vocab_health() from public;
grant execute on function public.admin_vocab_health() to authenticated;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- د) أرقام الصفحة الرئيسية من المحتوى الفعلي
--
--    كانت أرقاماً مكتوبة في الصفحة تحتها سطر «أرقام تجريبية لعرض
--    التصميم». حذف السطر وحده يحوّل العرض إلى ادّعاء، فالأرقام نفسها
--    صارت تُحسب من المنشور. لا بيانات شخصية هنا: أعداد فقط.
-- ------------------------------------------------------------
create or replace function public.public_stats()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'tracks',  (select count(*) from public.tracks  where published),
    'levels',  (select count(*) from public.levels  where published),
    'lessons', (select count(*) from public.lessons where published),
    'quizzes', (select count(*) from public.quizzes where published),
    'strategies', (select count(*) from public.lessons
                   where published and kind = 'strategy'));
$$;

revoke all on function public.public_stats() from public;
grant execute on function public.public_stats() to anon, authenticated;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- هـ) نصّ مبدئي لدليل المبتدئين
--
--     النصّ كما اعتمدته العميلة. يُدرَج مرة واحدة وفقط إن كان
--     الجدول فارغاً، فلا يمسّ تعديلاً لاحقاً من اللوحة.
-- ------------------------------------------------------------
insert into public.guide_steps (title, body, icon, accent, is_goal, sort_order, published)
select * from (values
  ('كل يوم درس جديد', 'ستدرس يومياً درساً جديداً متكاملاً يحتوي على فيديو، نص، وتطبيق عملي لتضمن التطور التدريجي والمستمر.', 'menu_book', 'blue', false, 10, true),
  ('التركيز على التطبيق أولاً', 'التداول مهارة عملية؛ لذا ركز على التطبيق المباشر على الشارت أكثر من الحفظ والتعليم النظري.', 'target', 'green', false, 20, true),
  ('تعلّم بأمان على حساب تجريبي', 'الأخطاء واردة جداً في البداية. استخدم الحساب التجريبي لتتدرب براحتك دون المخاطرة بمالك الحقيقي.', 'shield', 'violet', false, 30, true),
  ('طبّق وشارك تحليلك يومياً', 'التدريب اليومي ضرورة. شارك تحليلاتك لنراجع تقدمك ونصحح أخطاءك أولاً بأول.', 'trending_up', 'amber', false, 40, true),
  ('هدفك: الاستقلالية التامة', 'مع الاستمرار والتصحيح ستصل لمرحلة تعتمد فيها على تحليلك الشخصي وتصنع قراراتك دون توصيات.', 'emoji_events', 'teal', true, 50, true)
) v(title, body, icon, accent, is_goal, sort_order, published)
where not exists (select 1 from public.guide_steps);

notify pgrst, 'reload schema';
