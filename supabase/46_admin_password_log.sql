-- ============================================================
-- ٤٦) أثرُ ضبط كلمة المرور في السجلّ الإداري
--
-- الإدارة تضبط كل شيء في هذه المنصة، والعميلة لا تملك تغيير كلمة
-- مرورها من حسابها. فحين تنساها، البديل عن رابطٍ يصل بريدها أن
-- تكتب لها الإدارة واحدة جديدة وتسلّمها إياها.
--
-- التغيير نفسه يجري في نظام المصادقة عبر Edge Function، لأنه
-- يحتاج service_role الذي لا يوضع في المتصفح. وما يبقى هنا هو
-- الأثر: مَن غيّر، ولمن، ومتى. لا ما كُتب.
--
-- كلمة المرور لا تمرّ بهذه الدالة ولا بأي جدول: تذهب إلى نظام
-- المصادقة فيُجزّئها ولا تعود منه. والإدارة تعرفها لأنها كتبتها،
-- لا لأننا خزّناها.
-- ============================================================

create or replace function public.admin_log_password_set(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare p public.profiles;
begin
  -- admin_target ترفض من ليس أدمن، وترفض الحساب غير الموجود
  p := public.admin_target(p_user);

  perform public.log_admin(
    'password_set', p_user,
    coalesce(p.full_name, p.email, p.membership_no),
    'ضبطت الإدارة كلمة مرور جديدة وسلّمتها للعميلة.',
    '{}'::jsonb);

  return jsonb_build_object('ok', true);
end;
$fn$;

revoke all on function public.admin_log_password_set(uuid) from public;
grant execute on function public.admin_log_password_set(uuid) to authenticated;

notify pgrst, 'reload schema';
