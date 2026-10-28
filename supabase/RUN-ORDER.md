# ما يجب تشغيله في قاعدة البيانات

الخطأ `Could not find the function public.<name> in the schema cache` معناه
أن الهجرة التي تنشئ تلك الدالة لم تُشغَّل بعد.

## 1) ملفات SQL — بهذا الترتيب

افتح Supabase ← **SQL Editor** ← **New query** ← الصق محتوى الملف ← **Run**.
ملف واحد في كل مرة، وبالترتيب، لأن كل ملف يبني على ما قبله.

| # | الملف | ماذا ينشئ | ما يتعطّل بدونه |
| --- | --- | --- | --- |
| 1 | `01_stories_and_admin.sql` | جدول الأدوار، `is_admin()`، الملفات الشخصية، قصص النجاح، التخزين | كل شيء |
| 2 | `02_story_amount.sql` | عمود المبلغ على بطاقة القصة | حفظ قصة بمبلغ |
| 3 | `03_members.sql` | البريد ورقم العضوية والباقة في الملف الشخصي | إضافة مشترك، جدول الأعضاء |
| 4 | `04_closed_membership.sql` | اسم المستخدم، حالة الاشتراك، `has_active_subscription()` | بوابة المحتوى المدفوع |
| 5 | `05_content_and_classes.sql` | المستويات والدروس والاختبارات والحصص والحجوزات | لوحة المحتوى كلها |
| 6 | `05_roles_and_profile.sql` | دور المحللة، `my_role()`، حماية حقول الملف الشخصي | قائمة الحساب، منع المشترك من تعديل باقته |
| 7 | `07_content_tree.sql` | المسارات والدورات والمفردات، `get_lesson()`، `get_quiz()`، `submit_quiz()` | صفحة الدرس وصفحة الاختبار |
| 8 | `08_learner.sql` | **`my_dashboard()`**، المهام اليومية، سلسلة الاستمرارية | **لوحة المتعلم** |
| 9 | `09_bookings_notify.sql` | المحللة المسؤولة، سجل إشعارات البريد، `available_slots()` | صفحة الكلاسات |
| 10 | `10_notifications.sql` | التنبيهات داخل المنصة وتذكير انتهاء الاشتراك | جرس التنبيهات |
| 11 | `11_assistant.sql` | فهرس البحث في الدروس وسجل المساعد | المساعد التعليمي |
| 12 | `12_assistant_local.sql` | دالة المساعد داخل القاعدة: بحث عربي في الدروس | المساعد لا يرد |

> ملفان يحملان الرقم 5 لأنهما كُتبا بالتوازي ولا يتعارضان. شغّلهما كليهما
> بأي ترتيب بينهما، ثم انتقل إلى 7. لا يوجد ملف برقم 6.

كل الملفات **آمنة لإعادة التشغيل**: `if not exists` و `or replace` و
`drop policy if exists`. تشغيل ملف مرتين لا يكسر شيئاً ولا يحذف بيانات.

## 2) بعد التشغيل

تحقق أن الدوال موجودة:

```sql
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'is_admin','has_active_subscription','my_role',
    'my_dashboard','get_lesson','get_quiz','submit_quiz',
    'available_slots','my_notifications','search_lesson_content')
order by routine_name;
```

يجب أن تظهر العشرة كلها. وإذا ظهر الخطأ نفسه بعد التشغيل:

```sql
notify pgrst, 'reload schema';
```

أو من Supabase ← Settings ← API ← **Reload schema cache**.

## 3) إعدادات نظام المصادقة

- **Authentication ← Sign In / Providers ← Email**: أوقف
  **Allow new users to sign up**. العضوية مغلقة والحسابات تُنشأ من اللوحة.
- **Authentication ← URL Configuration**: أضف عنوان الموقع إلى
  **Redirect URLs** ليعمل رابط تعيين كلمة المرور.

## 4) دوال الخادم — دالتان

```bash
supabase login
supabase link --project-ref ukdcdbbbzeqztoqctnxb

supabase functions deploy create-member
supabase functions deploy notify-booking
```

### المفاتيح السرية

```bash
supabase secrets set RESEND_API_KEY=...
supabase secrets set MAIL_FROM="نورث للمسار المالي <no-reply@النطاق>"
```

`SUPABASE_URL` و `SUPABASE_ANON_KEY` و `SUPABASE_SERVICE_ROLE_KEY` تُضبط
تلقائياً في بيئة الدوال، فلا تُكتب يدوياً ولا توضع في المستودع.

**لا يوضع `service_role` ولا مفتاح بريد في كود الواجهة إطلاقاً.** مفتاح `service_role` يتجاوز كل سياسات RLS.

| الدالة | بدونها |
| --- | --- |
| `create-member` | زر «إنشاء الحساب» في اللوحة لا يعمل |
| `notify-booking` | الحجز ينجح لكن لا يصل بريد |

المساعد لا يحتاج دالة خادم: هو `ask_assistant()` داخل القاعدة نفسها
(`12_assistant_local.sql`).

## 5) ملاحظة على تكرار دوال الاختبار

`05_content_and_classes.sql` فيه `quiz_paper()` و `grade_quiz()`، و
`07_content_tree.sql` فيه `get_quiz()` و `submit_quiz()` — مجموعتان لنفس
الغرض كُتبتا بالتوازي. الواجهة الحالية تستخدم **`get_quiz` و `submit_quiz`**.
المجموعة الأخرى غير مستخدمة ولا تضر، ويمكن حذفها لاحقاً بعد التأكد.
