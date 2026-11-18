# POFlow v1.3 — توثيق قاعدة البيانات · Database

قاعدة البيانات المركزية = Google Sheet **«سجل أوامر الشراء - POFlow»** (خاص بالمالك، تقرؤه المنصة بصلاحية Execute as Me) + مجلدات Drive خاصة.
كل أمر شراء يُحفظ **سجلًا كاملًا بصيغة JSON** (حتى 6 خلايا × 45,000 حرف) مع **أعمدة فهرسة** للبحث والتقارير والتكامل.

## الأوراق · Sheets
| الورقة | الغرض | المفتاح |
|---|---|---|
| `POs` | النسخة الحالية من كل أمر شراء | `id` |
| `Versions` | لقطة لكل إصدار عند الإرسال/الإعادة/الرفض/الاعتماد/الأرشفة | `id` + `version` |
| `AuditLog` | سجل التدقيق (للإضافة فقط، ورقة محمية) | — |
| `AllowedUsers` | المستخدمون والأدوار: `email` · `name` · `role` (admin/editor/viewer) · `active` · `notes` · `procurement` | `email` |
| `AccessRequests` | طلبات صلاحية الدخول: `rid` · `timestamp` · `date` · `time` · `email` · `name` · `role` · `reason` · `status` (pending/approved/rejected) · `decidedBy` · `decidedAt` · `note` | `rid` |
| `AccessLog` | سجل الدخول (البريد، التاريخ، الوقت، اليوم، النتيجة، الإصدار) | — |
| `Signers` | سجل التوقيعات المشفّرة (الأعمدة التقنية مخفية) | `id` |
| `Signed` | الأرشيف النهائي: النسخ المعتمدة PDF وبصماتها ورموز التحقق | `id` + `version` |
| `Notifications` | الإشعارات داخل المنصة | `nid` |
| `Delegations` | تفويضات التوقيع المؤقتة | `did` |
| `Settings` | الإعدادات (key/value) | `key` |

### `POs` (وكذلك `Versions` بأعمدة `id, version, status, savedAt, savedBy, reason` ثم JSON)
`id` · `version` · `status` · `statusAr` · `serial` · `dept` · `requester` · `requesterEmail` · `subject` · `supplier` · `total` · `currency` · `currentEmail` · `currentName` · `currentSince` · `targetDate` · `createdAt` · `submittedAt` · `routedAt` · `approvedAt` · `rejectedAt` · `updatedAt` · `updatedBy` · `JSON_1…JSON_6`

### `AuditLog`
`timestamp` · `date` · `time` · `email` · `action` · `poId` · `version` · `step` · `detail` · `result`
الإجراءات: `create` `save` `submit` `sign` `reject` `unsign` `return` `route` `start` `route-edit` `revise` `cancel` `attach` `detach` `att-open` `finalized` `final-downloaded` `final-images` `verify-code` `verify-pdf` `add-signature` `unlock-for-sign` `preview` `pin-change` `pin-changed` `delete-signature` `show-image` `display-mode` `display-default` `user-add` `user-update` `delegation-add` `delegation-on/off` `settings-save` `escalate`

### `Signers` (نموذج منصة السياسات)
`id` · `name` · `position` · `org` · `fileId` · `encSalt` · `encIv` · `iter` · `authSalt` · `authHash` · `fails` · `lockUntil` · `status` · `createdBy` · `createdAt` · `updatedAt` · `ownerEmail`
- الصورة المشفّرة في ملف Drive (`fileId`)؛ `authHash = SHA-256(authTag + SIG_PEPPER)`؛ لا يُخزَّن الرقم السري.

### `Signed`
`id` · `version` · `serial` · `subject` · `contentHash` · `fullHash` · `pdfId` · `pdfHash` · `finalizedAt` · `finalizedBy` · `sentTo` · `verifyId`

### `Delegations`
`did` · `fromEmail` · `toEmail` · `start` · `end` · `active` · `reason` · `createdBy` · `createdAt`

### `Settings`
`PROC_EMAILS` · `ESCALATE_EMAIL` · `MAIL_FROM` · `REMIND_HOURS` · `ESCALATE_DAYS` · `TARGET_DAYS` · `CURRENCY` · `COMPANY_AR` · `COMPANY_EN` · `RETENTION_YEARS` · `POSITIONS` (JSON) · `DOA` (JSON) · `DEPTS` (JSON) · `BUDGETS` (JSON) · `DIGITAL_PROVIDER`

## سجل أمر الشراء · PO record (JSON)
```json
{
  "meta": {
    "id": "PR-2026-0001", "version": "1.0", "status": "signing", "serial": "SRN/18/11/2026-1",
    "date": "2026-11-18", "dept": "…", "budget": "BUD-ICT-2026-07", "subject": "…", "supplier": "…", "supplierContact": "",
    "currency": "SAR", "notes": "", "terms": "", "requester": "…", "requesterEmail": "…@sr.edu.sa",
    "procNote": "توجيه إدارة المشتريات", "targetDate": "2026-11-25", "sigDisplay": "image",
    "createdAt": "ISO", "createdBy": "…", "submittedAt": "ISO", "routedAt": "ISO", "approvedAt": "", "rejectedAt": "",
    "prevVersion": "", "returnNote": "", "contentHash": "sha256", "fullHash": "sha256", "finalizedAt": ""
  },
  "consumables": [{ "desc": "…", "unit": "جهاز", "qty": 6, "price": 9500 }],
  "assets": [],
  "attachments": [{ "id": "driveFileId", "name": "…pdf", "mime": "application/pdf", "size": 1234, "sha": "sha256", "by": "…", "at": "ISO", "kind": "quotation" }],
  "steps": [
    { "key": "req-1", "phase": "requester", "kind": "sign", "email": "…", "name": "…", "title": "المدير المعني — مدير إدارة الجهة الطالبة",
      "raci": "R", "slots": ["cons.R"], "state": "signed",
      "sig": { "signerId": "uuid", "signerName": "…", "position": "…", "by": "…", "onBehalfOf": "", "at": "ISO", "docHash": "contentHash", "scope": "content", "hasImg": true } },
    { "key": "c-1a2b3c", "phase": "chain", "kind": "sign", "email": "…", "title": "مدير إدارة المستودعات", "slots": ["cons.C"], "state": "current", "since": "ISO", "notifiedAt": "ISO" },
    { "key": "c-4d5e6f", "phase": "chain", "kind": "inform", "email": "…", "title": "مدير الشركة", "slots": ["cons.I"], "state": "pending" }
  ],
  "history": [{ "at": "ISO", "by": "…", "action": "sign", "note": "…", "version": "1.0" }]
}
```
- `state`: `pending` · `current` · `signed` · `rejected` (مع `rejectedAt` · `rejectedBy` · `reason`).
- `slots` = **موضع التوقيع في المستند**: `cons|asset` × `R` (يعد) · `C` (يقترح/يوصي) · `A` (يعتمد) · `I` (يعلم).
- صور التوقيع لا تُحفظ في السجل إلا حسب طريقة العرض؛ النسخ الواضحة في مجلد `POFlow-Signature-Images` (`<id>_v<ver>_<stepKey>.json`).

## الحالات · Status codes
| الرمز | العربية |
|---|---|
| `draft` | مسودة |
| `req_sign` | بانتظار توقيع الجهة الطالبة |
| `proc_review` | قيد مراجعة المشتريات |
| `returned` | معاد للاستكمال |
| `signing` | بانتظار التوقيع |
| `rejected` | مرفوض |
| `approved` | مكتمل ومعتمد |
| `cancelled` | ملغى |

## مصفوفة الصلاحيات الافتراضية (`DOA`) — من الصفحة الثانية للنموذج الرسمي
| الفئة | الحد الأعلى | يقترح/يوصي (C) | يعتمد (A) | يعلم (I) |
|---|---|---|---|---|
| مستهلكات/خدمات | 50,000 | — (المدير المعني) | مدير إدارة المشتريات | — |
| | 100,000 | مدير إدارة المستودعات / مدير إدارة المشتريات | الرئيس التنفيذي للخدمات المشتركة | — |
| | 500,000 | لجنة (المستودعات · المشتريات · المالية · الجهة الطالبة) | الرئيس التنفيذي للخدمات المشتركة | مدير الشركة |
| | بلا حد | لجنة (المستودعات · المشتريات · المالية · الجهة الطالبة) | مدير الشركة | — |
| أصول | 50,000 | — (المدير المعني) | مدير إدارة المرافق | — |
| | 100,000 | مدير إدارة المرافق | الرئيس التنفيذي للخدمات المشتركة | — |
| | بلا حد | لجنة (المرافق · المشتريات · المالية · الجهة الطالبة) | مدير الشركة | — |

«يعد» (R) دائمًا: المدير المعني = مدير إدارة الجهة الطالبة (المرحلة الأولى).

## الاحتفاظ والنسخ الاحتياطي
- النسخ النهائية والمرفقات في Drive المالك؛ `RETENTION_YEARS` (افتراضي 10) سياسة موثّقة، والنسخ الاحتياطي عبر Google Vault/Workspace.
- `purgeOldLogs()` يحذف سجلات **الدخول** الأقدم من 180 يومًا فقط؛ سجل التدقيق لا يُحذف.
