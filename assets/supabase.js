/* نورث للمسار المالي — عميل Supabase المشترك.

   المفتاح أدناه هو المفتاح العلني (publishable) وهو مصمَّم ليوضع في المتصفح.
   الحماية الفعلية في سياسات RLS داخل قاعدة البيانات لا في إخفاء هذا المفتاح.
   مفتاح service_role أو أي مفتاح سري لا يوضع في هذا الملف ولا في المستودع إطلاقاً. */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://ukdcdbbbzeqztoqctnxb.supabase.co';
  var SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_aT5b7Shrltis9cKExuosjw_DKlfF9x1';

  /* يُصدَّران ليستعملهما فحص الاتصال عند فشل الدخول. كلاهما علني
     بالتصميم ويظهر في كل طلب يرسله المتصفح أصلاً. */
  window.northConfig = { url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY };

  /* نحفظ العنوان كما وصل قبل أن تنظّفه المكتبة، لتعرف صفحة الاستعادة مصدر الزيارة */
  window.northEntryURL = { hash: window.location.hash || '', search: window.location.search || '' };

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    console.error('[north] لم تُحمَّل مكتبة supabase-js. تحقق من وسم <script> في الصفحة.');
    window.northDB = null;
    return;
  }

  window.northDB = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'north-auth'
    }
  });
})();
