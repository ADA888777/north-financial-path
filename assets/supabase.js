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

  /* رقم العضوية للعرض: «46» يُقرأ ‎#46.
     الهجرة ٤٢ جعلت المخزَّن هو الرقم نفسه، لكن الاستخراج يبقى
     لأن قاعدةً لم تُهاجَر بعد قد تحمل «N-2026-0046». */
  window.northNo = function (raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    var m = s.match(/(\d+)\s*$/);
    if (!m) return s;
    return '#' + m[1].replace(/^0+(?=\d)/, '');
  };

  /* «Albtol #46»: الاسم ورقمه معاً حيثما ذُكر عضو في الإدارة.
     صيغة واحدة في موضع واحد — لو كُتبت في كل صفحة لافترقت عند
     أول تعديل. وبلا اسم يبقى الرقم وحده معرِّفاً لا فراغاً. */
  window.northWho = function (name, no) {
    var n = String(name == null ? '' : name).trim();
    var r = window.northNo(no);
    if (n && r) return n + ' ' + r;
    return n || r || '—';
  };

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
