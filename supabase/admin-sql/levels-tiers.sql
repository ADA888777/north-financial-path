-- ============================================================
-- فحص وضبط باقات المستويات — يُشغَّل في Supabase ← SQL Editor
--
-- عدد الدروس الذي تراه العضوة ليس رقماً مكتوباً في الكود: هو ما
-- تفتحه باقتها. والذي يقرّره حقلٌ واحد: levels.min_tier
--   min_tier = 1  →  البرونزية فما فوق
--   min_tier = 2  →  الماسية وحدها
-- ============================================================

-- ١) اقرئي الوضع الحالي أولاً
select lv.sort_order as "الترتيب",
       lv.code       as "الرمز",
       lv.title      as "المستوى",
       lv.min_tier   as "الباقة (1 برونزية / 2 ماسية)",
       count(l.id) filter (where l.published) as "عدد الدروس المنشورة",
       lv.published  as "منشور"
from public.levels lv
left join public.lessons l on l.level_id = lv.id
group by lv.id
order by lv.sort_order, lv.title;

-- ٢) ما ترى البرونزية وما ترى الماسية بعد هذا الضبط
select 'البرونزية' as "الباقة",
       count(*) filter (where l.published and coalesce(lv.min_tier,1) <= 1) as "دروس تفتحها"
from public.lessons l join public.levels lv on lv.id = l.level_id
union all
select 'الماسية',
       count(*) filter (where l.published)
from public.lessons l join public.levels lv on lv.id = l.level_id;

-- ============================================================
-- ٣) الضبط المطلوب: المحترف للماسية وحدها، والباقي للبرونزية
--    نفّذي هذين السطرين فقط إذا خالف الجدول أعلاه هذا الترتيب.
-- ============================================================

-- المحترف → الماسية وحدها
update public.levels set min_tier = 2
 where title ilike '%المحترف%' and min_tier is distinct from 2;

-- المبتدئ والمتقدم والخبير والاستراتيجيات → البرونزية فما فوق
update public.levels set min_tier = 1
 where title not ilike '%المحترف%' and min_tier is distinct from 1;

-- ٤) أعيدي تشغيل الاستعلام الأول للتأكد
