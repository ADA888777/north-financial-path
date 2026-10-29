// تعطيل حساب وتفعيله وحذفه — Supabase Edge Function
//
// سبب وجودها: تغيير `status` في الجدول لا يُبطل جلسةً قائمة. رمز
// الدخول صالح نحو ساعة بعد التعطيل، فيظل الحساب يعمل. حظر المستخدم في
// نظام المصادقة (ban) يمنع تجديد الرمز والدخول من جديد، والحذف يُنهي
// كل جلساته فوراً. كلاهما يحتاج service_role الذي لا يوضع في المتصفح.
//
// النشر:
//   supabase functions deploy admin-account-action --project-ref ukdcdbbbzeqztoqctnxb

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

// مئة عام: الحظر عندنا دائم حتى يُرفع يدوياً بالتفعيل.
const FOREVER = '876000h';

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

  // 2) هل هو أدمن فعلاً؟ is_admin ترفض الأدمن المعطَّل أيضاً.
  const { data: isAdmin, error: roleErr } = await asCaller.rpc('is_admin');
  if (roleErr || isAdmin !== true) return reply({ error: 'هذه العملية للإدارة فقط' }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply({ error: 'طلب غير صالح' }, 400); }

  const userId = String(body.user_id ?? '').trim();
  const action = String(body.action ?? '').trim();
  const reason = body.reason ? String(body.reason).slice(0, 300) : null;

  if (!/^[0-9a-f-]{36}$/i.test(userId)) return reply({ error: 'معرّف غير صالح' }, 400);
  if (!['suspend', 'activate', 'delete'].includes(action)) {
    return reply({ error: 'عملية غير معروفة' }, 400);
  }

  // 3) الضوابط من القاعدة لا من هنا: مرجع واحد لا قاعدتان تفترقان.
  //    التفعيل وحده لا يحتاجها — إعادة حساب إلى العمل لا تقفل باباً.
  if (action !== 'activate') {
    const { data: may, error: mayErr } = await asCaller.rpc('admin_may_act', {
      p_user: userId, p_action: action,
    });
    if (mayErr) return reply({ error: 'تعذّر التحقق من الصلاحية: ' + mayErr.message }, 500);
    if (!may?.ok) return reply({ error: may?.error ?? 'غير مسموح' }, 403);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // ---------- تعطيل ----------
  if (action === 'suspend') {
    // الجدول أولاً: لو فشل الحظر بقي الحساب ممنوعاً من كل الدوال.
    const { data: dbRes, error: dbErr } = await asCaller.rpc('admin_set_member_status', {
      p_user: userId, p_status: 'suspended', p_reason: reason,
    });
    if (dbErr) return reply({ error: dbErr.message }, 500);
    if (dbRes?.error) return reply({ error: dbRes.error }, 400);

    const { error: banErr } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: FOREVER,
    });

    return reply({
      ok: true,
      sessions_revoked: !banErr,
      message: banErr
        ? 'عُطِّل الحساب في المنصة، لكن تعذّر حظره في نظام المصادقة: ' + banErr.message +
          ' — قد تبقى جلسة قائمة تعمل حتى تنتهي.'
        : 'عُطِّل الحساب وأُنهيت جلساته. بياناته وسجلّه محفوظة.',
    });
  }

  // ---------- تفعيل ----------
  if (action === 'activate') {
    const { data: dbRes, error: dbErr } = await asCaller.rpc('admin_set_member_status', {
      p_user: userId, p_status: 'active', p_reason: reason,
    });
    if (dbErr) return reply({ error: dbErr.message }, 500);
    if (dbRes?.error) return reply({ error: dbRes.error }, 400);

    const { error: unbanErr } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: 'none',
    });

    return reply({
      ok: true,
      message: unbanErr
        ? 'فُعِّل الحساب في المنصة، لكن تعذّر رفع الحظر عنه في نظام المصادقة: ' +
          unbanErr.message
        : 'أُعيد تفعيل الحساب ويستطيع الدخول الآن.',
    });
  }

  // ---------- حذف ----------
  // ما سيُحذف يُقرأ ويُسجَّل قبل الحذف: الجداول مرتبطة بـ cascade،
  // فبعد الحذف لا يبقى ما يُحصى.
  const { data: preview } = await asCaller.rpc('admin_delete_preview', { p_user: userId });
  if (preview?.error) return reply({ error: preview.error }, 403);

  await asCaller.rpc('admin_log_delete', {
    p_user: userId,
    p_label: preview?.name ?? null,
    p_email: preview?.email ?? null,
    p_counts: preview?.counts ?? {},
    p_reason: reason,
  });

  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) {
    return reply({ error: 'تعذّر حذف الحساب: ' + delErr.message }, 500);
  }

  return reply({
    ok: true,
    deleted: preview?.counts ?? {},
    message: 'حُذف الحساب وكل سجلاته. بقي أثر العملية في السجل الإداري.',
  });
});
