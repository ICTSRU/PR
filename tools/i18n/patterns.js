/* Numeric patterns (applied before phrase replacement). Keep the most specific first. */
window.I18N_PATTERNS = [
  [/^(\d+) قاعة$/, '$1 rooms'],
  [/^(\d+(?:\.\d+)?) س$/, '$1 h'],
  [/\((\d+) من (\d+)\)/g, '($1 of $2)'],
  [/^(\d+) (قطعة|قطع)$/, '$1 pcs'],
  [/^(\d+) (جهاز|أجهزة)$/, '$1 units'],
  [/^(\d+) (لفة|لفات)$/, '$1 rolls'],
  [/^— صدرت (.+) · رمز التحقق$/, '— issued $1 · verification code'],
  [/(\d+(?:\.\d+)?)\s*يوم/g, '$1 days'],
  [/(\d+)\s*أيام/g, '$1 days'],
  [/(\d+)\s*ساعة/g, '$1 h'],
  [/(\d+)\s*دقيقة/g, '$1 min'],
  [/(\d+)\s*ثانية/g, '$1 s'],
  [/(\d+)\s*صفحة/g, '$1 pages'],
  [/(\d+)\s*صفحات/g, '$1 pages'],
  [/(\d+)\s*مرفقات?/g, '$1 attachments'],
  [/(\d+)\s*عناصر/g, '$1 items'],
  [/(\d+)\s*بند/g, '$1 items'],
  [/(\d{1,2}):(\d{2})\s*ص\b/g, '$1:$2 AM'],
  [/(\d{1,2}):(\d{2})\s*م\b/g, '$1:$2 PM']
];
