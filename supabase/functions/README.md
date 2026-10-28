# دوال الخادم

## create-member

تنشئ حساب عضو بكلمة مرور من لوحة الإدارة.

**لماذا دالة خادم ولا تُنفَّذ في المتصفح؟**
إنشاء حساب بكلمة مرور يمر بـ `auth.admin.createUser` وهو يتطلب مفتاح
`service_role`. هذا المفتاح يتجاوز **كل** سياسات RLS، فوضعه في المتصفح يعني
أن أي زائر يفتح أدوات المطور يملك قاعدة البيانات كاملة. الدالة وحدها تحمله.

**ثلاث طبقات تحقق قبل أي إنشاء:**

1. جلسة المنادي تُقرأ بمفتاحه العلني لا بالمفتاح السري.
2. `is_admin()` تُستدعى بصلاحية المنادي نفسه، فلا تُصدَّق دعوى الإدارة من المتصفح.
3. المفتاح السري لا يُستخدم إلا بعد نجاح الاثنين.

**النشر**

```bash
supabase login
supabase functions deploy create-member --project-ref ukdcdbbbzeqztoqctnxb
```

`SUPABASE_URL` و `SUPABASE_ANON_KEY` و `SUPABASE_SERVICE_ROLE_KEY` تُضبط
تلقائياً في بيئة الدالة، فلا تُكتب في الكود ولا في المستودع.

حتى تُنشر، تعمل بقية اللوحة طبيعياً، ويُضاف العضو مؤقتاً من
Supabase ← Authentication ← Add user ثم تُعدَّل باقته من الجدول.

## notify-booking

ترسل إشعار الحجز بالبريد: رسالة للمحللة المسؤولة وأخرى تأكيد للمشترك.

**لماذا من الخادم؟** مفتاح مزوّد البريد سرّي، ومن يملكه يرسل رسائل باسم
المنصة. لا يوضع في المتصفح ولا في المستودع.

**منع التكرار** بثلاث طبقات: مفتاح فريد `(booking_id, kind)` في جدول
`booking_notifications`، ومعالجة الصفوف التي حالتها `pending` وحدها،
وتحديث الحالة فور الإرسال.

**عند الفشل** تصير الحالة `failed` مع نص الخطأ، فلا تُعاد تلقائياً بلا
تدخّل. وبلا مفتاح بريد تصير `skipped` بدل أن تبقى معلّقة إلى الأبد،
والحجز نفسه ينجح في الحالتين.

**النشر**

```bash
supabase secrets set RESEND_API_KEY=... MAIL_FROM="نورث <no-reply@your-domain>"
supabase functions deploy notify-booking --project-ref ukdcdbbbzeqztoqctnxb
```

المزوّد الافتراضي Resend. لتبديله، غيّر دالة `send` وحدها.

## assistant — أُلغيت

المساعد لم يبقَ دالة خادم ولا خدمة خارجية. صار دالة داخل قاعدة البيانات:
`ask_assistant()` في `supabase/12_assistant_local.sql`، تُنادى من الواجهة
بـ `rpc`. لا مفتاح نموذج، ولا اشتراك، ولا تكلفة على السؤال.

راجع `supabase/README.md` لتفصيل كيف يبحث ويمتنع.

إن كانت الدالة القديمة منشورة على المشروع، احذفها:

```bash
supabase functions delete assistant --project-ref ukdcdbbbzeqztoqctnxb
supabase secrets unset ANTHROPIC_API_KEY
```
