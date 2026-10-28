// المساعد التعليمي — Supabase Edge Function
//
// يجيب من محتوى الدروس المنشورة وحدها. الخطوات:
//   1) يتحقق من الجلسة والاشتراك.
//   2) يبحث في الدروس عن مقاطع ذات صلة بالسؤال.
//   3) لا يوجد مقطع ذو صلة  ->  يعتذر ولا ينادي النموذج أصلاً (ولا تكلفة).
//   4) يوجد  ->  يرسل المقاطع للنموذج مع تعليمات صارمة بالالتزام بها.
//
// مفتاح النموذج سرّي ويبقى هنا. لا يوضع في المتصفح ولا في المستودع.
//
// النشر:
//   supabase secrets set ANTHROPIC_API_KEY=...
//   supabase functions deploy assistant --project-ref ukdcdbbbzeqztoqctnxb

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

const OUT_OF_SCOPE =
  'أساعدك في شرح محتوى دروس المنصة فقط. اسألني عن أي درس أو مفهوم ورد في مسارات نورث.';

const NOT_FOUND =
  'لم أجد في دروس المنصة ما يجيب عن سؤالك. قد يكون الموضوع غير مطروح بعد، ' +
  'أو صياغة السؤال تحتاج تحديداً أكثر. جرّب صياغة أخرى أو راجع فهرس الدروس.';

const SYSTEM = `أنت مساعد تعليمي داخل منصة «نورث للمسار المالي»، منصة سعودية لتعليم أساسيات الأسواق المالية.

قواعد صارمة لا تحيد عنها:

1. أجب **فقط** مما ورد في «مقاطع الدروس» المرفقة في رسالة المستخدم. لا تضف معلومة من معرفتك العامة ولو كنت واثقاً منها.
2. إن لم تجد في المقاطع ما يجيب عن السؤال، قل ذلك صراحة بهذه الصياغة أو قريباً منها: «لم أجد في دروس المنصة ما يجيب عن هذا السؤال.» ولا تخمّن ولا تكمل من عندك.
3. إن كان السؤال خارج موضوع الدروس (طقس، رياضة، برمجة، أي شيء لا علاقة له بمحتوى المنصة)، اعتذر بلطف ووضّح أنك تساعد في شرح محتوى المنصة فقط.
4. **لا تقدّم توصية بشراء أو بيع، ولا رأياً في أداة مالية بعينها، ولا توقعاً لسعر، ولا أي ضمان لربح.** إن طُلب منك ذلك، وضّح أن المنصة تعليمية ولا تقدّم توصيات، ثم اعرض شرح المفهوم التعليمي المتعلق بالسؤال إن وُجد في الدروس.
5. اذكر عنوان الدرس الذي استندت إليه في نهاية إجابتك هكذا: «المصدر: <عنوان الدرس>».
6. اكتب بالعربية الفصحى المبسّطة، بإيجاز، في فقرة أو فقرتين. لا تُطل.

أنت تشرح ما تعلّمه المنصة، ولست مستشاراً مالياً.`;

type Chunk = {
  lesson_id: string; title: string; level: string | null;
  summary: string; content: string;
  vocab: { term: string; meaning: string }[]; rank: number;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply({ error: 'POST فقط' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');

  // 1) الجلسة
  const authHeader = req.headers.get('Authorization') ?? '';
  const asCaller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: who, error: whoErr } = await asCaller.auth.getUser();
  if (whoErr || !who?.user) return reply({ error: 'غير مصرّح' }, 401);

  const { data: subOk } = await asCaller.rpc('has_active_subscription');
  const { data: isAdmin } = await asCaller.rpc('is_admin');
  if (subOk !== true && isAdmin !== true) {
    return reply({ error: 'المساعد متاح للمشتركين باشتراك نافذ.' }, 403);
  }

  const { data: quota } = await asCaller.rpc('assistant_quota_left', { p_max: 40 });
  if (typeof quota === 'number' && quota <= 0) {
    return reply({ error: 'بلغت حد الأسئلة لهذا اليوم. عد غداً.' }, 429);
  }

  let body: { question?: string } = {};
  try { body = await req.json(); } catch { return reply({ error: 'طلب غير صالح' }, 400); }

  const question = String(body.question ?? '').trim();
  if (!question) return reply({ error: 'اكتب سؤالك أولاً' }, 400);
  if (question.length > 600) return reply({ error: 'السؤال طويل. اختصره.' }, 400);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  async function log(role: 'user' | 'assistant', content: string,
                     grounded: boolean | null, sources: unknown[] = []) {
    await admin.from('assistant_messages')
      .insert({ user_id: who!.user.id, role, content, grounded, sources });
  }

  await log('user', question, null);

  // 2) البحث في الدروس
  const { data: found, error: searchErr } = await admin
    .rpc('search_lesson_content', { p_query: question, p_limit: 5 });

  if (searchErr) return reply({ error: 'تعذّر البحث في الدروس' }, 500);

  const chunks = (found ?? []) as Chunk[];

  // 3) لا مقاطع -> لا نداء للنموذج، فلا تكلفة على سؤال لا جواب له عندنا
  if (!chunks.length) {
    await log('assistant', NOT_FOUND, false);
    return reply({ answer: NOT_FOUND, grounded: false, sources: [] });
  }

  if (!apiKey) {
    return reply({ error: 'المساعد غير مهيّأ بعد. ANTHROPIC_API_KEY غير مضبوط.' }, 503);
  }

  // 4) النموذج، ومعه المقاطع وحدها
  const context = chunks.map((c, i) =>
    `--- مقطع ${i + 1} ---\n` +
    `عنوان الدرس: ${c.title}\n` +
    (c.level ? `المستوى: ${c.level}\n` : '') +
    (c.summary ? `الملخص: ${c.summary}\n` : '') +
    (c.vocab?.length
      ? `المفردات: ${c.vocab.map((v) => `${v.term} = ${v.meaning}`).join(' · ')}\n`
      : '') +
    `المحتوى:\n${c.content}`
  ).join('\n\n');

  let answer: string;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 700,
        system: SYSTEM,
        messages: [{
          role: 'user',
          content:
            `مقاطع الدروس المتاحة:\n\n${context}\n\n` +
            `----\nسؤال المتدرب: ${question}\n\n` +
            `أجب من المقاطع أعلاه وحدها، والتزم بالقواعد.`,
        }],
      }),
    });

    if (!res.ok) {
      const t = (await res.text()).slice(0, 300);
      return reply({ error: 'تعذّر الوصول إلى خدمة المساعد.', detail: t }, 502);
    }

    const json = await res.json();
    answer = (json?.content ?? [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text).join('\n').trim();

    if (!answer) throw new Error('رد فارغ');
  } catch (e) {
    return reply({ error: 'تعذّر الوصول إلى خدمة المساعد: ' + (e as Error).message }, 502);
  }

  // هل اعتذر النموذج؟ نعلّمها لتظهر في الواجهة بوضوح.
  const grounded = !/لم أجد في دروس المنصة/.test(answer);
  const sources = grounded
    ? chunks.map((c) => ({ id: c.lesson_id, title: c.title }))
    : [];

  await log('assistant', answer, grounded, sources);

  return reply({ answer, grounded, sources, quota_left: Math.max(0, (quota ?? 1) - 1) });
});
