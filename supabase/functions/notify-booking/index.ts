// إشعار الحجز بالبريد — Supabase Edge Function
//
// يُرسل من الخادم لا من الواجهة: مفتاح مزوّد البريد سرّي ومن يملكه
// يرسل باسم المنصة. لا يوضع في المتصفح ولا في المستودع.
//
// منع التكرار: جدول booking_notifications مفتاحه (booking_id, kind)،
// والدالة لا تعالج إلا الصفوف التي حالتها pending، وتحدّثها فور الإرسال.
//
// النشر:
//   supabase secrets set RESEND_API_KEY=... MAIL_FROM="نورث <no-reply@your-domain>"
//   supabase functions deploy notify-booking --project-ref ukdcdbbbzeqztoqctnxb

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function fmtWhen(iso: string, minutes: number): string {
  try {
    const d = new Date(iso);
    const date = new Intl.DateTimeFormat('ar-SA', {
      dateStyle: 'full', timeZone: 'Asia/Riyadh',
    }).format(d);
    const time = new Intl.DateTimeFormat('ar-SA', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh',
    }).format(d);
    return `${date} — ${time} (بتوقيت الرياض) · ${minutes} دقيقة`;
  } catch {
    return iso;
  }
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!
  ));
}

type Row = {
  id: string; kind: 'analyst' | 'member'; to_email: string | null;
  member_name: string | null; member_phone: string | null; membership_no: string | null;
  telegram: string | null;
  slot_title: string; starts_at: string; duration_min: number; booked_at: string;
};

function build(row: Row): { subject: string; html: string } {
  const when = fmtWhen(row.starts_at, row.duration_min);

  if (row.kind === 'analyst') {
    return {
      subject: `حجز جديد: ${row.slot_title}`,
      html: `<div dir="rtl" style="font-family:system-ui,sans-serif;line-height:1.9;color:#0A1C30">
        <h2 style="margin:0 0 14px">حجز جديد في حصة خاصة</h2>
        <p style="margin:0 0 6px"><b>الحصة:</b> ${esc(row.slot_title)}</p>
        <p style="margin:0 0 6px"><b>الموعد:</b> ${esc(when)}</p>
        <p style="margin:0 0 6px"><b>المشترك:</b> ${esc(row.member_name ?? '—')}</p>
        <p style="margin:0 0 6px"><b>رقم العضوية:</b> ${esc(row.membership_no ?? '—')}</p>
        ${row.member_phone ? `<p style="margin:0 0 6px"><b>الجوال:</b> ${esc(row.member_phone)}</p>` : ''}
        ${row.telegram ? `<p style="margin:0 0 6px"><b>تيليجرام:</b> <span dir="ltr">@${esc(String(row.telegram).replace(/^@+/, ''))}</span></p>` : ''}
        <p style="margin:14px 0 0;color:#51657D;font-size:13px">
          أُرسلت هذه الرسالة آلياً من منصة نورث للمسار المالي.</p>
      </div>`,
    };
  }

  return {
    subject: `تأكيد حجزك: ${row.slot_title}`,
    html: `<div dir="rtl" style="font-family:system-ui,sans-serif;line-height:1.9;color:#0A1C30">
      <h2 style="margin:0 0 14px">تم تأكيد حجزك</h2>
      <p style="margin:0 0 6px"><b>الحصة:</b> ${esc(row.slot_title)}</p>
      <p style="margin:0 0 6px"><b>الموعد:</b> ${esc(when)}</p>
      <p style="margin:14px 0 0">تجد رابط الحضور في صفحة الكلاسات داخل حسابك قبل الموعد.</p>
      <p style="margin:14px 0 0;color:#51657D;font-size:13px">
        إذا لم تكن أنت من حجز، راسلنا فوراً.</p>
    </div>`,
  };
}

async function send(apiKey: string, from: string, to: string, subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply({ error: 'POST فقط' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('MAIL_FROM') ?? 'North <onboarding@resend.dev>';

  // لا بد من جلسة صحيحة: الدالة لا تُنادى من مجهول.
  const authHeader = req.headers.get('Authorization') ?? '';
  const asCaller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: who, error: whoErr } = await asCaller.auth.getUser();
  if (whoErr || !who?.user) return reply({ error: 'غير مصرّح' }, 401);

  let body: { booking_id?: string } = {};
  try { body = await req.json(); } catch { /* بلا حجز محدد: يعالج كل المعلّق */ }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: rows, error: rowsErr } = await admin
    .rpc('pending_notifications', { p_booking: body.booking_id ?? null });

  if (rowsErr) return reply({ error: rowsErr.message }, 500);

  const list = (rows ?? []) as Row[];
  if (!list.length) return reply({ processed: 0, note: 'لا يوجد إشعار معلّق' });

  // بلا مفتاح بريد: نعلّم الصفوف skipped بدل تركها معلّقة إلى الأبد.
  if (!apiKey) {
    await admin.from('booking_notifications')
      .update({ status: 'skipped', error: 'RESEND_API_KEY غير مضبوط' })
      .in('id', list.map((r) => r.id));
    return reply({ processed: 0, skipped: list.length, error: 'مزوّد البريد غير مهيّأ' }, 200);
  }

  let sent = 0, failed = 0;

  for (const row of list) {
    if (!row.to_email) {
      await admin.from('booking_notifications')
        .update({ status: 'skipped', error: 'لا يوجد بريد مستقبِل' }).eq('id', row.id);
      continue;
    }
    try {
      const { subject, html } = build(row);
      await send(apiKey, from, row.to_email, subject, html);
      await admin.from('booking_notifications')
        .update({ status: 'sent', sent_at: new Date().toISOString(), error: null })
        .eq('id', row.id);
      sent++;
    } catch (e) {
      failed++;
      // تبقى failed لا pending، فلا تُعاد تلقائياً بلا تدخّل.
      await admin.from('booking_notifications')
        .update({ status: 'failed', error: String((e as Error).message).slice(0, 500) })
        .eq('id', row.id);
    }
  }

  return reply({ processed: list.length, sent, failed });
});
