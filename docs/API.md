# POFlow v1.3 — واجهات API

نقطة دخول واحدة من الصفحة: `google.script.run.poApi({ action, … })` → `{ ok: true, … }` أو `{ ok: false, error, msg? }`.
كل استدعاء يعيد التحقق من حساب `@sr.edu.sa` النشط (`Session.getActiveUser`) ومن الدور (`ACTION_PERM_`).
`baseUpdatedAt` (اختياري) = آخر `updatedAt` استلمته الصفحة؛ إن تغيّر السجل يعود `{ ok:false, conflict:true }`.

## روابط الصفحات · doGet
| الرابط | يفتح |
|---|---|
| `…/exec` | التطبيق (لوحة التحكم، أو صندوق التوقيعات لدور signer) |
| `…/exec?po=PR-2026-0001` | أمر شراء محدد (رابط رسائل البريد) |
| `…/exec?verify=XXXX-XXXX-XXXX` | نتيجة التحقق (رمز QR) |
| `…/exec?page=howto` | «كيفية التوقيع» |

## طلب صلاحية الدخول (v1.3)
`google.script.run.requestAccess({ name, role: 'editor'|'viewer', reason })` — الدالة الوحيدة المتاحة لحساب جامعي غير مصرّح له؛ تسجّل الطلب في `AccessRequests` وترسله بالبريد إلى `ACCESS_ADMIN_EMAIL` (m.elmahdy@sr.edu.sa). تعيد `{sent}` أو `{pending}` أو `{already}`.

## الطلبات · Requests
| action | الصلاحية | المدخلات | المخرجات |
|---|---|---|---|
| `ping` | الجميع | — | `version, user, role` |
| `list` | الجميع (حسب الرؤية) | — | `items[]` (فهرس خفيف: الحالة، الإجماليات، الخطوة الحالية، `mine`) |
| `get` | من يملك الرؤية | `id, version?` | `data, updatedAt, final, totals, principals, latest` |
| `versions` | من يملك الرؤية | `id` | `items[{version,status,savedAt,savedBy,reason}]` |
| `save` | create | `data{meta,consumables,assets}, managerEmail, managerName, baseUpdatedAt?` | `data, updatedAt` (ينشئ `PR-YYYY-NNNN`) |
| `submit` | create (صاحب الطلب) | `id, baseUpdatedAt?` | الحالة `req_sign` + إشعار مدير الإدارة |
| `cancel` | صاحب الطلب قبل المشتريات · المشتريات قبل الاعتماد | `id, reason` | `cancelled` |
| `upload` | create / procurement | `id, name, mime, b64, kind, procurement?` | مرفق في Drive + `sha` |
| `removeAtt` | صاحب الطلب (مسودة) | `id, attId` | — |
| `attachment` | من يملك الرؤية | `id, attId` | `name, mime, b64` |
| `toSpecs` | procurement | `id, email, name, note, due` | `proc_review` ← `tech_specs` + بريد للجهة الفنية (v1.9) |
| `specsSave` | الجهة الفنية المحالة / procurement | `id, cons[], asset[], general, submit` | حفظ المسودة؛ `submit:true` ← يعود إلى `proc_review` ويُبلّغ المشتريات |
| `specsRecall` | procurement | `id, note` | استرجاع الطلب من الجهة الفنية |
| `return` | procurement | `id, note` | `returned` + إصدار جديد + مسح توقيع الجهة |
| `route` | procurement | `id, serial, procNote, targetDate, steps[], start` | المسار؛ `start:true` ← `signing` وإشعار الأول |
| `editSteps` | procurement | `id, steps[] (الخطوات المعلّقة فقط), reason` | تعديل ما لم يُبلغ بعد (مسجّل) |
| `sign` | sign (صاحب الخطوة أو مفوَّضه) | `id, step, signerId, tag, img?, blur?, baseUpdatedAt?` | `data, allSigned, phase, docHash` |
| `reject` | sign (صاحب الخطوة الحالية) | `id, step, reason` | `rejected` + إشعار المشتريات والجهة الطالبة |
| `unsign` | صاحب التوقيع | `id, step, tag` | قبل إجراء الخطوة التالية فقط |
| `revise` | صاحب الطلب / procurement | `id` | إصدار جديد `draft` بعد الرفض |
| `vtoken` | — | `id` (approved) | `id (رمز التحقق), url, contentHash, fullHash` |
| `finalImages` | الموقّعون / procurement | `id` | الصور الواضحة لوضع «مموّهة» |
| `finalize` | الموقّعون / procurement | `id, pdf (base64)` | أرشفة + `pdfHash, verifyId, sentTo` (عملية لا تتكرر) |
| `finalPdf` | من يملك الرؤية | `id, version` | `name, b64` |
| `verify` | الجميع | `id` (رمز التحقق) | تقرير: `valid, signers[{match}], hashes` |
| `verifyHash` | الجميع | `hash` (SHA-256 للملف) | التقرير نفسه |

### سجل التوقيعات (نموذج منصة السياسات)
| action | المدخلات | ملاحظات |
|---|---|---|
| `sigs` | — | توقيعاتي (+ الجميع للمدير) |
| `sigAdd` | `name, position, org, ownerEmail?, enc{salt,iv,ct,iter}, auth{salt,tag}` | التشفير في المتصفح؛ `ownerEmail` للمدير فقط |
| `sigUnlock` | `id, tag, purpose` | يعيد الظرف المشفّر بعد التحقق من الرقم السري (عدّاد المحاولات) |
| `sigPin` | `id, tag, enc, auth` | تغيير الرقم السري |
| `sigDelete` | `id` | — |
| `sigShow` | `id, step, img, blur, tag` | إظهار صورة توقيع سابق |
| `setDisplay` | `id, mode, blurs?` | procurement — `stamp` · `image` · `blur` |
| `setDefaultDisplay` | `mode` | admin |

### الإدارة
| action | الصلاحية | المدخلات |
|---|---|---|
| `notifications` · `markRead` | الجميع | `ids[] | all` |
| `users` · `userSave` | admin | `email, name, role (admin/editor/viewer), procurement, active, notes` |
| `accessRequests` | admin | — (قائمة طلبات الدخول) |
| `accessDecide` | admin | `rid, decision (approve/reject), role, procurement, note` — يُبلَّغ مقدم الطلب بالبريد |
| `delegations` · `delegationSave` | admin | `fromEmail, toEmail, start, end, reason` أو `did, active` |
| `settings` · `settingsSave` | settings: الجميع (قراءة عبر BOOT) · save: admin | `settings{…}` |
| `audit` | admin / procurement / auditor | `poId?, q?` |
| `remindNow` | admin | — |

## صيغة `steps[]` في `route`
```json
[
  { "kind": "sign",   "title": "مدير إدارة المستودعات", "name": "…", "email": "…@sr.edu.sa", "slots": ["cons.C"] },
  { "kind": "sign",   "title": "مدير إدارة المشتريات",  "name": "…", "email": "…@sr.edu.sa", "slots": ["cons.C", "asset.C"] },
  { "kind": "sign",   "title": "الرئيس التنفيذي للخدمات المشتركة", "email": "…", "slots": ["cons.A"] },
  { "kind": "inform", "title": "مدير الشركة", "email": "…", "slots": ["cons.I"] }
]
```
قواعد التحقق: بريد جامعي لكل خطوة، موضع توقيع لكل موقّع، وجود صاحب «يعتمد» لكل جدول فيه أصناف.

## الوظائف المجدولة والإدارية (من المحرر أو قائمة POFlow في الجدول)
| الدالة | الغرض |
|---|---|
| `setup()` | تهيئة الأوراق والمجلدات والمفتاح والمستخدمين والمشغّل |
| `setupTriggers()` | مشغّل `remindPending` كل ساعة |
| `remindPending()` | تذكير بعد `REMIND_HOURS` وتصعيد بعد `ESCALATE_DAYS` أو تجاوز الموعد المستهدف |
| `purgeOldLogs()` | حذف سجلات الدخول الأقدم من 180 يومًا |
| `seedDemoData()` | بيانات تجريبية (نسخة اختبار فقط) |
