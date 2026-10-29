// تغيير بريد عضو — Supabase Edge Function
//
// سبب وجودها: البريد ليس عموداً في profiles فحسب، بل هوية الدخول في
// auth.users ومعها صفّ في auth.identities. تحديث الجدول وحده يترك
// العميلة تدخل ببريدها القديم وترى الجديد في حسابها — تناقض صامت.
// واجهة auth.admin تحدّثهما معاً، وهي تتطلب service_role الذي لا
// يوضع في المتصفح إطلاقاً.
//
// النشر:
//   supabase functions deploy update-member-email --project-ref ukdcdbbbzeqztoqctnxb

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

  // 1) من المنادي؟ جلسته تُقرأ بمفتاحه هو.
  const authHeader = req.headers.get('Authorization') ?? '';
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await asCaller.auth.getUser();
  if (userErr || !userData?.user) return reply({ error: 'غير مصرّح' }, 401);

  // 2) هل هو أدمن فعلاً؟ الدالة تسأل القاعدة ولا تثق بما يرسله المتصفح.
  const { data: isAdmin, error: roleErr } = await asCaller.rpc('is_admin');
  if (roleErr || isAdmin !== true) return reply({ error: 'هذه العملية للإدارة فقط' }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply({ error: 'طلب غير صالح' }, 400); }

  const userId = String(body.user_id ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  // تأكيد فوري: الأدمن يغيّر البريد نيابةً عن العميلة، وانتظار تأكيدها
  // يترك الحساب بين بريدين. يُمرَّر false لإرسال رسالة تأكيد بدلاً من ذلك.
  const confirmNow = body.confirm_now !== false;

  if (!/^[0-9a-f-]{36}$/i.test(userId)) return reply({ error: 'معرّف غير صالح' }, 400);
  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(email)) {
    return reply({ error: 'صيغة البريد غير صحيحة' }, 400);
  }

  // 3) الآن فقط المفتاح السري.
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // البريد مأخوذ؟ auth.admin يردّ خطأً عاماً، فنفحص أولاً لنعطي سبباً مفهوماً.
  const { data: taken } = await admin
    .from('profiles').select('id').ilike('email', email).maybeSingle();
  if (taken && taken.id !== userId) {
    return reply({ error: 'هذا البريد مستخدم لعضو آخر' }, 409);
  }

  const { data: before } = await admin
    .from('profiles').select('email, full_name').eq('id', userId).maybeSingle();
  if (!before) return reply({ error: 'العضو غير موجود' }, 404);

  if ((before.email ?? '').toLowerCase() === email) {
    return reply({ ok: true, unchanged: true, email, message: 'البريد كما هو، لم يُغيَّر شيء.' });
  }

  // أ) نظام المصادقة أولاً: لو فشل بقي الجدول صحيحاً ولم ينشأ تناقض.
  const { error: authErr } = await admin.auth.admin.updateUserById(userId, {
    email,
    email_confirm: confirmNow,
  });

  if (authErr) {
    const m = String(authErr.message ?? '');
    return reply({
      error: /already|registered|exists/i.test(m)
        ? 'هذا البريد مسجّل في نظام المصادقة لحساب آخر'
        : 'تعذّر تحديث البريد في نظام المصادقة: ' + m,
    }, 400);
  }

  // ب) ثم الجدول. لو فشل هنا نُرجع المصادقة إلى ما كانت.
  const { error: dbErr } = await admin
    .from('profiles').update({ email }).eq('id', userId);

  if (dbErr) {
    await admin.auth.admin.updateUserById(userId, {
      email: before.email ?? undefined,
      email_confirm: true,
    });
    return reply({ error: 'تعذّر تحديث البريد في الجدول، وأُعيد إلى ما كان: ' + dbErr.message }, 500);
  }

  return reply({
    ok: true,
    email,
    previous: before.email,
    confirmed: confirmNow,
    message: confirmNow
      ? 'تغيّر البريد. تدخل العميلة به مباشرة بكلمة مرورها نفسها.'
      : 'أُرسلت رسالة تأكيد إلى البريد الجديد. لا يعمل للدخول قبل تأكيده.',
  });
});
