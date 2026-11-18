/**
 * POFlow v1.0 — demo data (run seedDemoData once from the Apps Script editor on a TEST copy only).
 * Creates demo positions and requests covering every DoA band and both tables, as the script owner.
 * Requests are created as drafts / submitted (signatures are never fabricated: they must be made by
 * real signers with their own encrypted signature and PIN — see docs/TESTING.md for the full scenarios).
 */
function seedDemoData() {
  setup_();
  const me = currentEmail_();
  settingsSave_(me, { settings: {
    BUDGETS: ['BUD-ICT-2026-07 · تشغيل البنية التحتية', 'BUD-FAC-2026-02 · صيانة المرافق', 'BUD-STU-2026-04 · الأنشطة الطلابية']
  } });
  const demo = [
    { dept: 'الإدارة التنفيذية للاتصالات وتقنية المعلومات', subject: 'مستلزمات تشغيل لمركز البيانات (أقل من 50 ألف)', supplier: 'مؤسسة الحلول التقنية',
      consumables: [{ desc: 'كابلات شبكة Cat6A', unit: 'لفة', qty: 10, price: 850 }, { desc: 'وحدات SFP+ 10G', unit: 'قطعة', qty: 20, price: 300 }], assets: [], submit: true },
    { dept: 'الإدارة التنفيذية للاتصالات وتقنية المعلومات', subject: 'تجديد تراخيص برمجيات (50–100 ألف)', supplier: 'شركة البرمجيات المتقدمة',
      consumables: [{ desc: 'ترخيص سنوي — نظام النسخ الاحتياطي', unit: 'ترخيص', qty: 1, price: 72000 }], assets: [], submit: true },
    { dept: 'إدارة المرافق', subject: 'شراء خوادم وأجهزة تخزين (أصول أكثر من 100 ألف)', supplier: 'شركة الأنظمة المتكاملة',
      consumables: [], assets: [{ desc: 'خادم تخزين 200TB', unit: 'جهاز', qty: 2, price: 68000 }, { desc: 'مبدّل ألياف SAN', unit: 'جهاز', qty: 2, price: 21000 }], submit: false },
    { dept: 'إدارة الحياة الجامعية', subject: 'أثاث وتجهيزات قاعات الأنشطة (مستهلكات + أصول)', supplier: 'مؤسسة الأثاث الحديث',
      consumables: [{ desc: 'مستلزمات قرطاسية للأنشطة', unit: 'طقم', qty: 40, price: 150 }], assets: [{ desc: 'شاشات عرض تفاعلية 86 بوصة', unit: 'جهاز', qty: 3, price: 24000 }], submit: false }
  ];
  const out = [];
  demo.forEach(function (x) {
    const r = save_(me, 'admin', { data: { meta: { dept: x.dept, subject: x.subject, supplier: x.supplier, budget: '', date: fmt_(new Date(), 'yyyy-MM-dd') }, consumables: x.consumables, assets: x.assets }, managerEmail: me, managerName: 'مدير الإدارة (تجريبي)' });
    if (x.submit) submit_(me, 'admin', { id: r.data.meta.id });
    out.push(r.data.meta.id);
  });
  console.log('demo requests: ' + out.join(', '));
  return out;
}
