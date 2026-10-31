/* بيانات حساب العضو: الاسم الظاهر واسم المستخدم والبريد وكلمة المرور.
   البريد يمرّ بدالة الخادم لأنه هوية الدخول في نظام المصادقة، لا عمود
   في جدول الملفات وحده. وكلمة المرور لا تُعرض ولا تُخزَّن ولا تُغيَّر
   من هنا: يُرسَل رابط إعادة تعيين إلى العميلة. */
(function () {
  'use strict';
  var A = window.northAdmin;
  if (!A) return;
  var db = A.db, el = A.el, esc = A.esc, no = A.no, who = A.who;

  var cur = null, onDone = null, busy = false, sheet = null;

  function shell() {
    if (sheet) return sheet;
    sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.id = 'acc-sheet';
    sheet.innerHTML = '<div class="sheet-in" role="dialog" aria-modal="true" ' +
      'aria-labelledby="acc-title"><div class="sheet-h">' +
      '<h2 id="acc-title">بيانات الحساب</h2>' +
      '<button class="bt bt-ghost bt-sm" type="button" id="acc-x">إغلاق</button>' +
      '</div><div id="acc-body"></div></div>';
    document.body.appendChild(sheet);
    sheet.addEventListener('click', function (e) { if (e.target === sheet) close(); });
    el('acc-x').addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sheet.classList.contains('on')) close();
    });
    return sheet;
  }

  function close() { if (sheet) sheet.classList.remove('on'); cur = null; }

  /* اشتراك نافذ الآن؟ تغيير الباقة وحده لا يُفعّل اشتراكاً منتهياً،
     ولو خُفي ذلك لرقّت الإدارة عضوة ثم لم تر العضوة شيئاً. */
  function live(m) {
    return m.account_status === 'active' && m.effective_status === 'active';
  }

  function subTag(m) {
    if (live(m)) {
      return '<span class="tag tag-ok">نافذ' +
        (m.days_left != null ? ' · ' + m.days_left + ' يوماً' : '') + '</span>';
    }
    return '<span class="tag tag-off">' +
      (m.effective_status === 'expired' ? 'منتهٍ' : 'غير نافذ') + '</span>';
  }

  function expiredWarn(m) {
    if (live(m)) return '';
    return '<p class="warn-line"><span class="ms">report</span>' +
      'اشتراك هذه العضوة غير نافذ الآن، فتغيير الباقة وحده لن يفتح لها شيئاً. ' +
      'استعملي «غيّر الباقة وفعّل 60 يوماً»، أو غيّري الباقة ثم جدّدي من ' +
      '«الاشتراك».</p>';
  }

  function render(m, events) {
    cur = m;
    el('acc-title').textContent = 'بيانات الحساب: ' + who(m.full_name, m.membership_no);

    el('acc-body').innerHTML =
      '<div class="sub-now">' +
        '<div><span>رقم العضوية</span><b class="num">' +
          esc(window.northNo(m.membership_no) || '—') + '</b></div>' +
        '<div><span>الحساب</span><b>' +
          (m.account_status === 'active'
            ? '<span class="tag tag-ok">فعّال</span>'
            : '<span class="tag tag-off">موقوف</span>') + '</b></div>' +
        '<div><span>الباقة</span><b>' + esc(m.plan || '—') + '</b></div>' +
        '<div><span>الاشتراك</span><b>' + subTag(m) + '</b></div>' +
      '</div>' +

      /* الترقية من هنا مباشرة: الباقة تظهر في هذا الشيت، فيُنتظر
         تغييرها فيه. العضوية ورقمها لا تتغيّر — الاسم وحده ينتقل. */
      '<div class="sub-act">' +
        '<h3>الباقة</h3>' +
        '<p class="sub-h">ترقية العميلة أو تخفيضها تتم هنا، على حسابها نفسه. ' +
          'رقم العضوية والبريد وكلمة المرور وتقدّمها في الدروس لا يتغيّر شيء منها، ' +
          'ويُسجَّل التغيير في سجلّ الاشتراك.</p>' +
        '<div class="fld"><label for="a-plan">الباقة</label>' +
          '<select id="a-plan"><option value="">جارٍ التحميل…</option></select></div>' +
        '<div class="fld"><label for="a-plan-note">ملاحظة (اختيارية)</label>' +
          '<input id="a-plan-note" type="text" maxlength="200" placeholder="سبب الترقية أو مرجع الدفع">' +
        '</div>' +
        expiredWarn(m) +
        '<button class="bt bt-main" type="button" id="do-plan">غيّر الباقة</button>' +
        (live(m) ? '' :
          '<button class="bt bt-soft" type="button" id="do-plan-renew" style="margin-inline-start:8px">' +
            'غيّر الباقة وفعّل 60 يوماً</button>') +
      '</div>' +

      '<div class="sub-act">' +
        '<h3>الاسم الظاهر</h3>' +
        '<p class="sub-h">هذا ما تراه العميلة في لوحتها وفي شريط الموقع وفي كل مكان ' +
          'يُذكر فيه اسمها. يُكتب كما تريده هي، بالعربية أو اللاتينية.</p>' +
        '<div class="fld"><label for="a-name">الاسم الظاهر</label>' +
          '<input id="a-name" type="text" maxlength="80"></div>' +
        '<div class="fld"><label for="a-phone">الجوال</label>' +
          '<input id="a-phone" type="text" dir="ltr" maxlength="20" placeholder="05XXXXXXXX"></div>' +
        '<button class="bt bt-main" type="button" id="do-name">احفظ الاسم والجوال</button>' +
      '</div>' +

      '<div class="sub-act">' +
        '<h3>اسم المستخدم</h3>' +
        '<p class="sub-h"><b>ليس اسم الدخول.</b> الدخول بالبريد وكلمة المرور وحدهما. ' +
          'اسم المستخدم معرّف تنظيمي اختياري للإدارة، ويبقى فارغاً بلا أي أثر على ' +
          'العميلة. تغييره لا يغيّر الاسم الظاهر.</p>' +
        '<div class="fld"><label for="a-user">اسم المستخدم</label>' +
          '<input id="a-user" type="text" dir="ltr" maxlength="32" placeholder="اتركه فارغاً لمحوه">' +
          '<span class="hint">حروف لاتينية وأرقام ونقطة وشرطة، من 3 إلى 32 خانة. لا يتكرّر بين عضوين.</span></div>' +
        '<button class="bt bt-ghost" type="button" id="do-user">احفظ اسم المستخدم</button>' +
      '</div>' +

      '<div class="sub-act">' +
        '<h3>رقم العضوية</h3>' +
        '<p class="sub-h">عدد تسلسلي واحد لكل حساب. يُمنح تلقائياً عند ' +
          'الإنشاء ويمكن تغييره هنا. لا يتكرّر بين عضوتين — ترفض القاعدة ' +
          'الرقم المستعمل — ولا يتغيّر بتعديل الاسم أو البريد أو الباقة، ' +
          'ولا يُعاد رقم حسابٍ حُذف. وضبطُه يدوياً يرفع العدّاد فلا يصطدم ' +
          'به الحساب التالي.</p>' +
        '<div class="fld"><label for="a-no">رقم العضوية</label>' +
          '<input id="a-no" type="text" dir="ltr" inputmode="numeric" ' +
            'pattern="[0-9]*" maxlength="9">' +
          '<span class="hint">عدد صحيح موجب بلا أصفار بادئة — مثل 47. ' +
            '<b id="a-no-view"></b></span></div>' +
        '<button class="bt bt-ghost" type="button" id="do-no">احفظ رقم العضوية</button>' +
      '</div>' +

      '<div class="sub-act">' +
        '<h3>البريد الإلكتروني</h3>' +
        '<p class="sub-h">بهذا البريد تسجّل العميلة دخولها. تغييره هنا يغيّره في ' +
          'نظام الدخول وفي بياناتها معاً.</p>' +
        '<div class="fld"><label for="a-email">البريد</label>' +
          '<input id="a-email" type="email" dir="ltr" maxlength="120"></div>' +
        '<label class="chk"><input type="checkbox" id="a-confirm" checked>' +
          '<span>فعّلي البريد الجديد فوراً</span></label>' +
        '<p class="sub-h">الخيار مفعّل: تدخل العميلة ببريدها الجديد مباشرة، ' +
          'بكلمة المرور نفسها — لا شيء إضافي عليها.</p>' +
        '<p class="sub-h sub-warn">الخيار مُلغى: نرسل رسالة تأكيد إلى البريد الجديد، ' +
          'ولا تستطيع الدخول حتى تفتح الرسالة وتضغط التأكيد. اتركيه مفعّلاً ' +
          'إلا إن أردتِ التأكّد أن البريد الذي كتبتِه يصلها فعلاً.</p>' +
        '<button class="bt bt-ghost" type="button" id="do-email">غيّر البريد</button>' +
      '</div>' +

      '<div class="sub-act">' +
        '<h3>كلمة المرور</h3>' +
        '<p class="sub-h">كلمة المرور مخزّنة مُعمّاة في نظام المصادقة، فلا يمكن عرضها ' +
          'لا لكِ ولا لأحد، وهذا هو الصحيح. المتاح إرسال رابط إعادة تعيين إلى بريد ' +
          'العميلة لتختار كلمة جديدة بنفسها.</p>' +
        '<button class="bt bt-ghost" type="button" id="do-reset">أرسل رابط إعادة التعيين</button>' +
        '<p class="sub-h" id="reset-note" hidden></p>' +
      '</div>' +

      '<div class="sub-act">' +
        '<h3>تصفير التقدّم</h3>' +
        '<p class="sub-h">نسبة التقدّم تُحسب من الدروس المنجزة ولا تُكتب يدوياً، ' +
          'فتصفيرها يعني حذف ما أُنجز: الدروس المكتملة ومواضع التوقّف ومحاولات ' +
          'الاختبارات وأيام النشاط. وبحذفها تعود الدروس مقفلةً من أولها، ' +
          'والنسبة وسلسلة الأيام إلى صفر. ' +
          '<b>لا يُمسّ</b> الاشتراك ولا الباقة ولا الحجوزات ولا التقييمات. ' +
          'مفيد لحساب جرّبتِ عليه.</p>' +
        '<button class="bt bt-ghost danger-btn" type="button" id="do-zero">صفّري التقدّم…</button>' +
      '</div>' +

      '<div class="sub-act danger">' +
        '<h3>حالة الحساب</h3>' +
        (m.account_status === 'active'
          ? '<p class="sub-h">التعطيل يوقف دخول العضو ويُنهي جلساته القائمة، ' +
            'ويحتفظ ببياناته وسجل اشتراكاته وحجوزاته كما هي. يمكن التراجع عنه في أي وقت.</p>' +
            '<div class="fld"><label for="x-reason">سبب التعطيل (يُسجَّل)</label>' +
              '<input id="x-reason" type="text" maxlength="200"></div>' +
            '<button class="bt bt-ghost" type="button" id="do-suspend">عطّل الحساب</button>'
          : '<p class="sub-h">الحساب معطَّل الآن: لا يستطيع الدخول، وبياناته محفوظة.</p>' +
            '<button class="bt bt-main" type="button" id="do-activate">أعد تفعيل الحساب</button>') +
      '</div>' +

      '<div class="sub-act danger">' +
        '<h3>حذف الحساب</h3>' +
        '<p class="sub-h">الحذف نهائي ولا رجعة فيه. يمحو معه الاشتراكات والحجوزات ' +
          'والتقدّم والنتائج — كلها مرتبطة بالحساب وتُحذف معه. ' +
          '<b>إن كان الهدف منع الدخول مؤقتاً فالتعطيل أعلاه يكفي ويحفظ كل شيء.</b></p>' +
        '<button class="bt bt-ghost danger-btn" type="button" id="do-delete">احذف الحساب نهائياً…</button>' +
      '</div>' +

      '<div class="sub-act">' +
        '<h3>سجل التعديلات</h3>' + history(events) +
      '</div>';

    el('a-name').value = m.full_name || '';
    el('a-phone').value = m.phone || '';
    el('a-user').value = m.username || '';
    el('a-no').value = m.membership_no || '';
    /* المخزَّن هو المعروض بعد الهجرة ٤٢، لكن السطر يبقى: قاعدةٌ لم
       تُهاجَر بعد قد تحمل «N-2026-0003»، والمعاينة تُري الإدارة ما
       تراه العميلة فعلاً قبل الحفظ. */
    function viewNo() {
      var f = window.northNo || function (v) { return v || ''; };
      var v = f(el('a-no').value);
      el('a-no-view').textContent = v ? 'يظهر لها: ' + v : '';
    }
    el('a-no').addEventListener('input', viewNo);
    viewNo();
    el('a-email').value = m.email || '';

    el('do-name').addEventListener('click', saveName);
    el('do-user').addEventListener('click', saveUser);
    el('do-no').addEventListener('click', saveNo);
    el('do-email').addEventListener('click', saveEmail);
    el('do-reset').addEventListener('click', sendReset);
    el('do-zero').addEventListener('click', zeroProgress);

    var sus = el('do-suspend'); if (sus) sus.addEventListener('click', suspend);
    var act = el('do-activate'); if (act) act.addEventListener('click', activate);
    el('do-delete').addEventListener('click', remove);

    fillPlans(m);
    el('do-plan').addEventListener('click', function () { changePlan(false); });
    var pr = el('do-plan-renew');
    if (pr) pr.addEventListener('click', function () { changePlan(true); });
  }

  /* ---------- الباقة ----------
     القائمة من جدول الباقات لا من باقات الأعضاء الحاليين: باقة لا
     يملكها أحدٌ بعد يجب أن تكون قابلة للاختيار، وإلا استحالت أول ترقية
     إليها — وهذا بالضبط ما كان يمنع الترقية من البرونزية إلى الماسية. */
  function fillPlans(m) {
    var sel = el('a-plan');
    db.rpc('admin_plans').then(function (r) {
      var list = (!r.error && r.data) || [];
      var names = list
        .filter(function (p) { return p.active !== false; })
        .map(function (p) { return typeof p === 'string' ? p : p.name; });

      // باقتها الحالية تبقى في القائمة ولو أُوقفت، كي لا يبدو الحقل فارغاً
      if (m.plan && names.indexOf(m.plan) === -1) names.unshift(m.plan);

      if (!names.length) {
        sel.innerHTML = '<option value="">لا توجد باقات — أضيفيها من تبويب «الباقات»</option>';
        el('do-plan').disabled = true;
        return;
      }
      sel.innerHTML = names.map(function (n) {
        return '<option value="' + esc(n) + '"' +
          (n === m.plan ? ' selected' : '') + '>' + esc(n) + '</option>';
      }).join('');
    }).catch(function () {
      sel.innerHTML = '<option value="' + esc(m.plan || '') + '">' +
        esc(m.plan || '—') + '</option>';
    });
  }

  function changePlan(alsoRenew) {
    var plan = el('a-plan').value;
    var note = el('a-plan-note').value || null;
    if (!plan) { A.toast('اختاري باقة.', 'bad'); return; }

    if (plan === (cur && cur.plan) && !alsoRenew) {
      A.toast('الباقة كما هي، لم يُغيَّر شيء.');
      return;
    }

    var btn = alsoRenew ? el('do-plan-renew') : el('do-plan');
    var was = btn.textContent;
    btn.disabled = true; btn.textContent = 'جارٍ الحفظ…';

    /* التفعيل مع الترقية نداءٌ واحد: admin_renew_days تضبط الباقة
       والمدّة والحالة معاً، فلا تبقى عضوة بباقة ماسية واشتراك منتهٍ. */
    var call = alsoRenew
      ? db.rpc('admin_renew_days', {
          p_user: cur.id, p_days: 60, p_plan: plan,
          p_note: note || 'ترقية وتفعيل من بيانات الحساب',
          p_paid: false, p_payment_ref: null })
      : db.rpc('admin_set_plan', { p_user: cur.id, p_plan: plan, p_note: note });

    call.then(function (r) {
      btn.disabled = false; btn.textContent = was;
      var d = (r && r.data) || {};
      if (r.error || d.error) { A.toast(d.error || r.error.message, 'bad'); return; }
      A.toast(d.message || 'حُفظت الباقة.');
      if (onDone) onDone();
      reload(cur.id);
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = was;
      A.toast((e && e.message) || 'تعذّر الحفظ', 'bad');
    });
  }

  var LABEL = { full_name: 'الاسم الظاهر', username: 'اسم المستخدم',
                phone: 'الجوال', email: 'البريد',
                membership_no: 'رقم العضوية' };

  function history(ev) {
    if (!ev || !ev.length) return '<p class="sub-h">لا توجد تعديلات مسجّلة.</p>';
    return '<ol class="sub-log">' + ev.map(function (e) {
      return '<li><div class="sl-h"><b>' + esc(LABEL[e.field] || e.field) + '</b>' +
        '<span>' + esc(A.fmtDate(e.at)) + '</span></div>' +
        '<p>' + esc(e.old_value || '(فارغ)') + ' ← ' + esc(e.new_value || '(فارغ)') + '</p>' +
        (e.actor ? '<span class="sl-a">بواسطة ' + esc(e.actor) + '</span>'
                 : '<span class="sl-a">من الخادم</span>') +
        '</li>';
    }).join('') + '</ol>';
  }

  function run(btn, call) {
    if (busy || !cur) return;
    busy = true;
    var txt = btn.textContent;
    btn.disabled = true; btn.textContent = 'جارٍ الحفظ…';
    call().then(function (r) {
      busy = false; btn.disabled = false; btn.textContent = txt;
      var d = (r && r.data) || {};
      if (r.error) { A.toast(r.error.message || 'تعذّر الحفظ', 'bad'); return; }
      if (d.error) { A.toast(d.error, 'bad'); return; }
      A.toast(d.message || 'تم الحفظ', 'ok');
      if (onDone) onDone();
      reload(cur.id);
    }).catch(function (e) {
      busy = false; btn.disabled = false; btn.textContent = txt;
      A.toast((e && e.message) || 'تعذّر الحفظ', 'bad');
    });
  }

  function saveName() {
    run(el('do-name'), function () {
      return db.rpc('admin_update_member', {
        p_user: cur.id,
        p_full_name: el('a-name').value,
        p_phone: el('a-phone').value,
        p_set_phone: true
      });
    });
  }

  function saveUser() {
    run(el('do-user'), function () {
      return db.rpc('admin_update_member', {
        p_user: cur.id,
        p_username: el('a-user').value,
        p_set_username: true
      });
    });
  }

  /* حذفٌ لا رجعة فيه: التأكيد يكتب ما سيُحذف لا «هل أنت متأكد؟» */
  function zeroProgress() {
    if (busy || !cur) return;
    var who = cur.full_name || cur.email || cur.membership_no || 'هذه العضوة';
    if (!window.confirm(
      'تصفير تقدّم ' + who + '؟\n\n' +
      'يُحذف: الدروس المنجزة، ومواضع التوقّف، ومحاولات الاختبارات،\n' +
      'وأيام النشاط وسلسلة الاستمرارية.\n' +
      'تعود الدروس مقفلةً من أولها والنسبة والسلسلة إلى صفر.\n\n' +
      'لا يُمسّ الاشتراك ولا الباقة ولا الحجوزات. لا رجعة في هذا.')) return;

    run(el('do-zero'), function () {
      return db.rpc('admin_reset_member_progress', { p_user: cur.id });
    });
  }

  function saveNo() {
    run(el('do-no'), function () {
      return db.rpc('admin_set_membership_no', {
        p_user: cur.id, p_no: el('a-no').value
      });
    });
  }

  function saveEmail() {
    var e = (el('a-email').value || '').trim();
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(e)) {
      A.toast('صيغة البريد غير صحيحة', 'bad');
      return;
    }
    if (e.toLowerCase() === String(cur.email || '').toLowerCase()) {
      A.toast('البريد كما هو، لم يُغيَّر شيء.', 'ok');
      return;
    }
    if (!window.confirm('تغيير بريد الدخول إلى ' + e + '؟\n' +
      'ستدخل العميلة بالبريد الجديد بعد الحفظ.')) return;

    run(el('do-email'), function () {
      return db.functions.invoke('update-member-email', {
        body: { user_id: cur.id, email: e, confirm_now: el('a-confirm').checked }
      }).then(function (r) {
        // دالة الخادم تردّ الخطأ في الجسم لا في r.error
        if (r.error && !r.data) {
          return { data: { error: 'تعذّر الوصول إلى دالة الخادم. تأكد من نشر update-member-email.' } };
        }
        return { data: r.data || {} };
      });
    });
  }

  function sendReset() {
    var b = el('do-reset');
    var mail = (cur.email || '').trim();
    if (!mail) { A.toast('لا يوجد بريد لهذا العضو', 'bad'); return; }
    if (!window.confirm('إرسال رابط إعادة تعيين كلمة المرور إلى ' + mail + '؟')) return;

    b.disabled = true; b.textContent = 'جارٍ الإرسال…';
    db.auth.resetPasswordForEmail(mail, {
      redirectTo: window.location.origin + '/reset.html'
    }).then(function (r) {
      b.disabled = false; b.textContent = 'أرسل رابط إعادة التعيين';
      var note = el('reset-note');
      note.hidden = false;
      if (r.error) {
        note.textContent = 'تعذّر الإرسال: ' + r.error.message;
        A.toast(r.error.message, 'bad');
        return;
      }
      note.textContent = 'أُرسل الرابط إلى ' + mail +
        '. صلاحيته محدودة، وتختار العميلة كلمتها بنفسها.';
      A.toast('أُرسل رابط إعادة التعيين', 'ok');
    }).catch(function (e) {
      b.disabled = false; b.textContent = 'أرسل رابط إعادة التعيين';
      A.toast((e && e.message) || 'تعذّر الإرسال', 'bad');
    });
  }

  /* الثلاث تمرّ بدالة الخادم: التعطيل يحتاج حظراً في نظام المصادقة،
     والحذف يحتاج حذف المستخدم نفسه. الجدول وحده لا يكفي لأي منهما. */
  function callServer(btn, action, reason, after) {
    if (busy || !cur) return;
    busy = true;
    var txt = btn.textContent;
    btn.disabled = true; btn.textContent = 'جارٍ التنفيذ…';

    db.functions.invoke('admin-account-action', {
      body: { user_id: cur.id, action: action, reason: reason || null }
    }).then(function (r) {
      busy = false; btn.disabled = false; btn.textContent = txt;
      var d = (r && r.data) || {};
      if (r.error && !r.data) {
        A.toast('تعذّر الوصول إلى دالة الخادم. تأكد من نشر admin-account-action.', 'bad');
        return;
      }
      if (d.error) { A.toast(d.error, 'bad'); return; }
      A.toast(d.message || 'تم', 'ok');
      if (onDone) onDone();
      if (after) after(d); else reload(cur.id);
    }).catch(function (e) {
      busy = false; btn.disabled = false; btn.textContent = txt;
      A.toast((e && e.message) || 'تعذّر التنفيذ', 'bad');
    });
  }

  function suspend() {
    if (!window.confirm('تعطيل حساب ' + (cur.full_name || '') + '؟\n' +
      'سيُمنع من الدخول فوراً، وتبقى بياناته وسجلّه كما هي.')) return;
    callServer(el('do-suspend'), 'suspend', el('x-reason') ? el('x-reason').value : null);
  }

  function activate() {
    callServer(el('do-activate'), 'activate', null);
  }

  /* الحذف لا يُنفَّذ بنقرة: نقرأ أولاً ما سيُمحى ونعرضه، ثم نطلب كتابة
     رقم العضوية. نافذة «هل أنت متأكد» وحدها تُضغط بلا قراءة. */
  function remove() {
    var btn = el('do-delete');
    btn.disabled = true;
    db.rpc('admin_delete_preview', { p_user: cur.id }).then(function (r) {
      btn.disabled = false;
      var d = (r && r.data) || {};
      if (r.error || d.error) { A.toast(d.error || r.error.message, 'bad'); return; }

      var counts = d.counts || {};
      var lines = Object.keys(counts)
        .filter(function (k) { return counts[k] > 0; })
        .map(function (k) { return '  • ' + counts[k] + ' ' + k; });

      var ref = d.membership_no || d.email || '';
      var typed = window.prompt(
        'حذف نهائي لحساب: ' + (d.name || '') + '\n' +
        (lines.length ? 'سيُمحى معه:\n' + lines.join('\n') + '\n\n'
                      : 'لا توجد سجلات مرتبطة به.\n\n') +
        'لا رجعة في هذا.\nاكتب رقم العضوية للتأكيد: ' + ref);

      if (typed === null) return;
      if (String(typed).trim() !== String(ref).trim()) {
        A.toast('لم يطابق رقم العضوية. أُلغي الحذف.', 'bad');
        return;
      }

      callServer(btn, 'delete', null, function () {
        close();
        if (onDone) onDone();
      });
    }).catch(function (e) {
      btn.disabled = false;
      A.toast((e && e.message) || 'تعذّر التحقق', 'bad');
    });
  }

  function reload(id) {
    return Promise.all([
      db.rpc('admin_member', { p_user: id }),
      db.rpc('admin_member_events', { p_user: id })
    ]).then(function (r) {
      if (r[0].error) { A.toast(r[0].error.message, 'bad'); return; }
      var d = r[0].data || {};
      if (d.error) { A.toast(d.error, 'bad'); return; }
      render(d, (!r[1].error && r[1].data) || []);
    });
  }

  function open(id, after) {
    onDone = after || null;
    shell().classList.add('on');
    el('acc-body').innerHTML =
      '<div class="state"><span class="ms">hourglass_top</span>جارٍ التحميل…</div>';
    reload(id).catch(function (e) {
      el('acc-body').innerHTML = '<div class="state"><span class="ms">error</span>' +
        esc((e && e.message) || 'تعذّر التحميل') + '</div>';
    });
  }

  window.northAccount = { open: open, close: close };
})();
