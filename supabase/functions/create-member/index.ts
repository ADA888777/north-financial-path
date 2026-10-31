// دالة إنشاء عضو — Supabase Edge Function
//
// سبب وجودها: إنشاء حساب بكلمة مرور يحتاج auth.admin وهو يتطلب مفتاح
// service_role. هذا المفتاح لا يوضع في المتصفح إطلاقاً لأن من يملكه يتجاوز
// كل سياسات RLS. فالمتصفح ينادي هذه الدالة، وهي وحدها تحمل المفتاح.
//
// النشر:
//   supabase functions deploy create-member --project-ref ukdcdbbbzeqztoqctnxb
// المتغيرات (SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY) تُضبط تلقائياً في البيئة.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply({ error: 'POST فقط' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // 1) من المنادي؟ نقرأ جلسته بمفتاحه هو لا بالمفتاح السري.
  const authHeader = req.headers.get('Authorization') ?? '';
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await asCaller.auth.getUser();
  if (userErr || !userData?.user) return reply({ error: 'غير مصرّح' }, 401);

  // 2) هل هو أدمن فعلاً؟ لا نثق بما يرسله المتصفح.
  const { data: isAdmin, error: roleErr } = await asCaller.rpc('is_admin');
  if (roleErr || isAdmin !== true) return reply({ error: 'هذه العملية للإدارة فقط' }, 403);

  // 3) الآن فقط نستخدم المفتاح السري.
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply({ error: 'طلب غير صالح' }, 400); }

  const email = String(body.email ?? '').trim().toLowerCase();
  const fullName = String(body.full_name ?? '').trim();
  const phone = body.phone ? String(body.phone).trim() : null;
  const plan = body.plan ? String(body.plan).trim() : null;
  const membershipNo = body.membership_no ? String(body.membership_no).trim() : null;
  const username = body.username ? String(body.username).trim() : null;
  const subStatus = body.subscription_status ? String(body.subscription_status).trim() : 'active';
  // دورة الاشتراك: البداية من النموذج (اليوم افتراضاً)، والنهاية لا
  // تُرسل إلا إن عدّلتها الإدارة بيدها — وإلا حسبتها القاعدة من مدّة
  // الباقة المعتمدة (الاشتراك الأول شهران). ورقم طلب سلة مرجعٌ يُحفظ
  // في سجلّ الاشتراك لا أكثر.
  const subStart = body.subscription_started_at ? String(body.subscription_started_at) : null;
  const subExpires = body.subscription_expires_at ? String(body.subscription_expires_at) : null;
  const paymentRef = body.payment_ref ? String(body.payment_ref).trim().slice(0, 100) : null;
  const siteUrl = body.site_url ? String(body.site_url) : null;
  const acctStatus = body.status === 'suspended' ? 'suspended' : 'active';

  if (!email || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
    return reply({ error: 'بريد إلكتروني غير صالح' }, 400);
  }
  if (!fullName) return reply({ error: 'الاسم الكامل مطلوب' }, 400);

  if (username && !/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
    return reply({ error: 'اسم المستخدم: 3 إلى 32 خانة، حروف لاتينية وأرقام ونقطة وشرطة فقط' }, 400);
  }
  if (!['active', 'expired', 'inactive', 'cancelled'].includes(subStatus)) {
    return reply({ error: 'حالة اشتراك غير معروفة' }, 400);
  }

  // اسم المستخدم ورقم العضوية فريدان. نفحص قبل إنشاء الحساب حتى لا يبقى
  // حساب في نظام المصادقة بلا ملف شخصي عند فشل الحفظ.
  if (username) {
    const { data: taken } = await admin
      .from('profiles').select('id').ilike('username', username).maybeSingle();
    if (taken) return reply({ error: 'اسم المستخدم محجوز' }, 409);
  }
  if (membershipNo) {
    const { data: taken } = await admin
      .from('profiles').select('id').eq('membership_no', membershipNo).maybeSingle();
    if (taken) return reply({ error: 'رقم العضوية مستخدم مسبقاً' }, 409);
  }
  {
    const { data: taken } = await admin
      .from('profiles').select('id, full_name').ilike('email', email).maybeSingle();
    if (taken) {
      return reply({
        error: 'هذا البريد مسجّل مسبقاً' +
          (taken.full_name ? ' باسم ' + taken.full_name : '') +
          '. عدّل بياناته من جدول الأعضاء بدل إنشاء حساب جديد.',
      }, 409);
    }
  }

  // كلمة المرور تكتبها الإدارة ولا تتولّد: من يسلّمها للعميلة يجب أن
  // يعرفها، والمولَّدة تُعرض مرّة ثم تضيع. ولا تُخزَّن عندنا نصّاً —
  // تذهب إلى نظام المصادقة فيُجزّئها، ولا تعود منه أبداً.
  const password = body.password ? String(body.password) : '';
  if (!password) return reply({ error: 'اكتبي كلمة المرور — تسلّمينها للعميلة' }, 400);
  if (password.length < 8) return reply({ error: 'كلمة المرور 8 خانات على الأقل' }, 400);

  // الحساب مؤكَّد مباشرة: الإدارة هي من أنشأه، فلا حاجة لبريد تأكيد.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, phone },
  });

  if (createErr) {
    const msg = createErr.message || '';
    if (/already (been )?registered|exists/i.test(msg)) {
      return reply({ error: 'هذا البريد مسجّل مسبقاً' }, 409);
    }
    return reply({ error: msg }, 400);
  }

  const id = created.user!.id;

  // المشغّل أنشأ الملف الشخصي؛ نكمل الحقول التي تخص الإدارة.
  const patch: Record<string, unknown> = {
    email,
    full_name: fullName,
    phone,
    plan,
    username,
    // الاشتراك النافذ تضبطه admin_renew_days أدناه (تواريخ وسجلّ)؛
    // هنا يُكتب «غير مفعّل» فقط حتى لا يبقى الحساب نافذاً بلا فترة.
    subscription_status: subStatus === 'active' ? 'inactive' : subStatus,
    subscription_expires_at: null,
    status: acctStatus,
    // الإدارة تضبط كل شيء ولا تملك العميلة تغيير كلمة مرورها من
    // حسابها، فإلزامها بتغييرها بابٌ لا تجده مفتوحاً.
    must_change_password: false,
    created_by: userData.user.id,
  };
  if (membershipNo) patch.membership_no = membershipNo;

  const { error: profErr } = await admin.from('profiles').update(patch).eq('id', id);
  if (profErr) {
    // الحساب أُنشئ لكن بياناته ناقصة — نخبر الإدارة بدل الصمت.
    return reply({ id, password, warning: 'أُنشئ الحساب لكن تعذّر حفظ بياناته: ' + profErr.message });
  }

  // الاشتراك الأول: بهويّة الأدمن نفسها (asCaller) لا بمفتاح الخدمة،
  // فتمرّ من admin_target() وتُسجَّل باسمها في سجلّ الاشتراك.
  // المدّة تختارها القاعدة: أول فترةٍ للحساب = duration_days للباقة.
  let subWarning: string | null = null;
  let subInfo: Record<string, unknown> | null = null;
  if (subStatus === 'active' && plan) {
    const { data: ren, error: renErr } = await asCaller.rpc('admin_renew_days', {
      p_user: id,
      p_days: null,
      p_plan: plan,
      p_note: 'إنشاء الحساب',
      p_paid: !!paymentRef,
      p_payment_ref: paymentRef,
      p_start: subStart,
      p_end: subExpires,
    });
    const r = (ren ?? {}) as Record<string, unknown>;
    if (renErr || r.error) {
      subWarning = 'أُنشئ الحساب لكن لم يُفعَّل اشتراكه: ' +
        String(r.error ?? renErr?.message ?? '') + ' — فعّليه من ملف العضو.';
    } else {
      subInfo = { starts_at: r.starts_at, expires_at: r.expires_at, days: r.days, first: r.first };
    }
  }

  // رابط تعيين كلمة المرور: الأفضل أن يختارها المشترك بنفسه بدل تداولها.
  let setPasswordLink: string | null = null;
  try {
    const { data: link } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: siteUrl ? { redirectTo: siteUrl + 'reset.html' } : undefined,
    });
    setPasswordLink = link?.properties?.action_link ?? null;
  } catch {
    // الرابط إضافة مريحة لا شرط للنجاح؛ كلمة المرور المؤقتة تكفي.
  }

  const { data: saved } = await admin
    .from('profiles').select('membership_no, username').eq('id', id).maybeSingle();

  return reply({
    id,
    email,
    password,
    membership_no: saved?.membership_no ?? membershipNo,
    username: saved?.username ?? username,
    set_password_link: setPasswordLink,
    subscription: subInfo,
    warning: subWarning,
  });
});
