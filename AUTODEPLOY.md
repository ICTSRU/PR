# POFlow — النشر التلقائي · Auto-publish (autodeploy v2.0) — مستودع واحد `ICTSRU/PR`

بعد إعداد لمرة واحدة يصبح التحديث: **رفع الإصدار ← commit ← push**. لا نسخ ولصق في محرر Apps Script ولا «Manage deployments».

```
ICTSRU/PR (main)
 ├─ index.html · assets/      ──▶ GitHub Pages ──▶ https://ictsru.github.io/PR/   (صفحة الدخول بهوية ITOC)
 └─ apps-script/**            ──▶ GitHub Actions «Deploy Apps Script»
                                   1. Version guard   (tools/bump_version.py --check + إصدار أعلى من السابق)
                                   2. Acceptance tests (tests/acceptance.test.js)
                                   3. clasp push --force
                                   4. clasp deploy -i DEPLOYMENT_ID  ──▶ رابط /exec نفسه، إصدار جديد
                                   5. أول زيارة للمنصة ──▶ ensureInstalled_() يحدّث «سجل أوامر الشراء - POFlow»
```

## الأسرار · Secrets (Settings ▸ Secrets and variables ▸ Actions)
| الاسم | القيمة |
|---|---|
| `CLASPRC_JSON` | محتوى `~/.clasprc.json` كاملًا (الحساب m.elmahdy@sr.edu.sa — نفس SOP/Policy). عند الحاجة: `npx @google/clasp@2.4.2 login` |
| `SCRIPT_ID` | Apps Script ▸ ⚙️ Project Settings ▸ Script ID (مشروع الجدول «سجل أوامر الشراء - POFlow») |
| `DEPLOYMENT_ID` | `AKfycbyri6uknwOxquUaXBhE5Q4oqDUuaTYWMlqpRkDewHwl7PUeWGrCJUTuJxmbWGqv7FC6` (الجزء بين `/s/` و`/exec`) |

> إن جعلت `CLASPRC_JSON` **Organization secret** في ICTSRU ومنحته للمستودعات `SOP` و`Policy-server` و`PR` فلا حاجة لتكراره.

## كل تعديل · Every edit
| # | الخطوة |
|---|---|
| 1 | عدّل الملفات |
| 2 | `python3 tools/bump_version.py "وصف التغيير"` — يرفع الإصدار (1.9 ← 2.0) في `Code.gs` و`Index`/`Denied`/`HowTo` و`index.html` و`README` ويضيف قيدًا في `CHANGELOG` |
| 3 | `git commit` + `git push` إلى `main` |
| 4 | Actions ▸ «Deploy Apps Script» ← ✅ «POFlow vX.Y published» |
| 5 | افتح المنصة مرة ← يحدّث الجدول تلقائيًا (يُسجّل `install` في `AuditLog`) |

**الرفع من واجهة GitHub (Upload files):** ارفع الإصدار يدويًا في الملفات نفسها؛ وإلا يرفض **Version guard** النشر برسالة توضح الأمر المطلوب.

## ملاحظات
- يحتفظ الإجراء بملف `appsscript.json` الحي للمشروع ويستبدل ملفات الكود فقط — عدّل الكود في GitHub لا في المحرر.
- **لا أسرار في الكود:** `SIG_PEPPER` ومعرّفات المجلدات في Script Properties ولا تتأثر بالرفع.
- **صلاحية Google جديدة** في إصدار ما (مثل المشغّلات أو Gmail): افتح المشروع وشغّل `setup` مرة للموافقة عليها.
- إذا منع مسؤول Workspace تطبيقات الطرف الثالث: اسمح بـ **clasp (Google Apps Script CLI)** في Google Admin ▸ Security ▸ API controls.
- **التراجع:** Deploy ▸ Manage deployments ▸ ✏️ ▸ اختر إصدارًا سابقًا، أو `git revert` ثم push (مع رفع الإصدار).
- المستودع **عام**: لا يحتوي بيانات أو أسرارًا (بريد المالك ومعرّفا الجدول والمجلد فقط، وهي محمية بصلاحيات Google).
