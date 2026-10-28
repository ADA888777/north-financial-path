-- ============================================================
-- نورث للمسار المالي — الهجرة الثانية
-- حقل المبلغ المعروض على بطاقة القصة
--
-- تُشغَّل بعد 01_stories_and_admin.sql في: SQL Editor > New query
-- آمنة لإعادة التشغيل.
-- ============================================================

-- نص وليس رقماً: الشارة تُعرض كما تُكتب («٣٬٠٠٠ ر.س.» أو «1,000 USD»)
-- ولا يُجرى عليها أي حساب.
alter table public.success_stories
  add column if not exists amount text;

comment on column public.success_stories.amount is
  'نص الشارة المعروضة على بطاقة القصة. اختياري.';

-- PostgREST يخزّن بنية الجداول في ذاكرة مؤقتة، وبدون تحديثها يظل العمود
-- الجديد غير مرئي للواجهة ويظهر خطأ:
--   Could not find the 'amount' column of 'success_stories' in the schema cache
notify pgrst, 'reload schema';

-- تحقق
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'success_stories'
order by ordinal_position;
