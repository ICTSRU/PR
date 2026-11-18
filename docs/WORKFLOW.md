# POFlow v1.3 — مخطط سير العمل · Workflow

```mermaid
stateDiagram-v2
    direction RL
    [*] --> draft: الجهة الطالبة تنشئ الطلب
    draft --> req_sign: إرسال (submit)
    req_sign --> proc_review: توقيع مدير الإدارة (يعد) — إحالة تلقائية
    req_sign --> rejected: رفض مدير الإدارة
    proc_review --> returned: إعادة للاستكمال (إصدار جديد)
    returned --> req_sign: تعديل + إرسال
    proc_review --> signing: اعتماد المسار وبدء الدورة
    signing --> signing: توقيع ← الموقّع التالي تلقائيًا
    signing --> rejected: رفض بسبب إلزامي (إيقاف فوري)
    signing --> approved: توقيع آخر موقّع
    approved --> [*]: PDF نهائي · أرشفة · إرسال
    rejected --> draft: نسخة جديدة (revise)
    draft --> cancelled
    proc_review --> cancelled
    signing --> cancelled
```

```mermaid
sequenceDiagram
    autonumber
    participant R as الجهة الطالبة
    participant M as مدير الإدارة (يعد)
    participant P as إدارة المشتريات
    participant S1 as الموقّع 1
    participant S2 as الموقّع 2
    participant S3 as الموقّع 3 (يعتمد)
    participant X as POFlow
    R->>X: إنشاء أمر الشراء + المرفقات + إرسال
    X->>M: بريد + إشعار «طلب توقيع»
    M->>X: توقيع (رقم سري · contentHash)
    X->>P: «طلب جديد للمراجعة»
    P->>X: الرقم التسلسلي + التوجيه + المسار المرتب (مقترح من مصفوفة الصلاحيات)
    X->>S1: طلب توقيع
    S1->>X: توقيع (fullHash)
    X->>S2: طلب توقيع
    alt رفض
        S2->>X: رفض + السبب
        X->>P: ⛔ رفض + السبب
        X->>R: ⛔ رفض + السبب
        Note over S3: لا يُرسل له شيء
    else توقيع
        S2->>X: توقيع
        X->>S3: طلب توقيع
        S3->>X: توقيع
        S3->>X: متصفح S3 يُنشئ PDF النهائي (نموذج + مصفوفة + شهادة QR)
        X->>P: ✅ PDF المعتمد (مرفق) — أرشفة في Drive
        X->>R: ✅ نسخة للاطّلاع
    end
```

## قواعد المحرك
- **التسلسل:** خطوة واحدة فقط `current`؛ التوقيع على غيرها مرفوض في الخادم.
- **الانتقال التلقائي:** بعد كل توقيع تصبح أول خطوة `pending` من نوع `sign` هي `current` ويُرسل لها الطلب (ولمفوَّضيها).
- **«يعلم»:** خطوات `inform` لا توقّع؛ تُبلَّغ مع النسخة النهائية.
- **الرفض:** يوقف الدورة؛ الخطوات اللاحقة تبقى `pending` ولا يُرسل لها شيء. الاستئناف = `revise` ثم دورة جديدة كاملة.
- **التذكير والتصعيد:** كل ساعة — تذكير بعد `REMIND_HOURS`، وتصعيد لـ `ESCALATE_EMAIL` والمشتريات بعد `ESCALATE_DAYS` أو تجاوز الموعد المستهدف (مرة يوميًا).
- **التفويض:** `Delegations` النشطة في التاريخ تجعل المفوَّض «صاحب خطوة» بالنيابة؛ يُسجّل `onBehalfOf` في التوقيع والمستند والشهادة.
- **الفصل بين المشتريات ومحرك الاعتماد:** المشتريات تحدد السلسلة فقط؛ التنفيذ آلي بالكامل.
