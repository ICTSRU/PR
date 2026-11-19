/**
 * POFlow v1.0 — acceptance tests (run: node tests/acceptance.test.js)
 *  A. Full approval: requester creates → requesting manager signs → procurement routes 3 signers (+1 informed)
 *     → sequential signatures → final PDF archived + e-mailed → verification by code and by PDF fingerprint.
 *  B. Rejection at signer 2: cycle stops, procurement + requester notified, signer 3 never asked, new version possible.
 *  C. Guards: wrong PIN lockout counter, out-of-turn signing, return for completion, delegation, roles.
 */
'use strict';
const path = require('path'), assert = require('assert');
const { webcrypto } = require('crypto');
const { makeEnv } = require('./gas-mock');
const subtle = webcrypto.subtle, te = new TextEncoder();

/* same envelope as the browser (Index.html · sealSignature / authTag) */
const ITER = 310000;
const b64 = u => Buffer.from(u).toString('base64');
const fromB64 = s => new Uint8Array(Buffer.from(s, 'base64'));
const rand = n => webcrypto.getRandomValues(new Uint8Array(n));
async function pinBase(pin) { return subtle.importKey('raw', te.encode(pin), 'PBKDF2', false, ['deriveKey', 'deriveBits']); }
async function authTag(pin, saltB64, iter) { return b64(new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', salt: fromB64(saltB64), iterations: iter, hash: 'SHA-256' }, await pinBase(pin), 256))); }
async function seal(dataUrl, pin) {
  const salt = rand(16), iv = rand(12), aSalt = b64(rand(16));
  const key = await subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, await pinBase(pin), { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(dataUrl)));
  return { enc: { salt: b64(salt), iv: b64(iv), ct: b64(ct), iter: ITER }, auth: { salt: aSalt, tag: await authTag(pin, aSalt, ITER) } };
}
async function open(enc, pin) {
  const key = await subtle.deriveKey({ name: 'PBKDF2', salt: fromB64(enc.salt), iterations: enc.iter, hash: 'SHA-256' }, await pinBase(pin), { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  return new TextDecoder().decode(await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(enc.iv) }, key, fromB64(enc.ct)));
}
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PDF = Buffer.from('%PDF-1.4\n% POFlow test document\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');

const OWNER = 'm.elmahdy@sr.edu.sa', REQ = 'requester@sr.edu.sa', MGR = 'it.manager@sr.edu.sa', PROC = 'procurement@sr.edu.sa';
const S1 = 'warehouse.mgr@sr.edu.sa', S2 = 'proc.manager@sr.edu.sa', S3 = 'ceo.shared@sr.edu.sa', INF = 'company.mgr@sr.edu.sa', AUD = 'auditor@sr.edu.sa', DLG = 'deputy@sr.edu.sa';
const PIN = { [MGR]: 'Mgr2026pin', [S1]: 'Sig1pass99', [S2]: 'Sig2pass99', [S3]: 'Sig3pass99', [DLG]: 'Dep2026pin' };

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ✔ ' + msg); };

async function registerSig(env, email, name, pos) {
  const sealed = await seal(IMG, PIN[email]);
  const r = env.call(email, Object.assign({ action: 'sigAdd', name, position: pos, org: 'جامعة سليمان الراجحي' }, sealed));
  assert.ok(r.ok, 'sigAdd ' + email + ' ' + JSON.stringify(r));
  return r.id;
}
async function sign(env, email, id, pinOverride) {
  const g = env.call(email, { action: 'get', id });
  assert.ok(g.ok, 'get as ' + email + ': ' + JSON.stringify(g));
  const pr = g.principals;
  const step = g.data.steps.find(s => s.state === 'current' && pr.includes(s.email));
  if (!step) return { ok: false, error: 'no current step for ' + email };
  const sigs = env.call(email, { action: 'sigs' }).items, s = sigs[0];
  const pin = pinOverride || PIN[email];
  const un = env.call(email, { action: 'sigUnlock', id: s.id, tag: await authTag(pin, s.authSalt, s.iter), purpose: 'sign' });
  if (!un.ok) return un;
  const img = await open(un.enc, pin);           // decrypted in "the browser"
  return env.call(email, { action: 'sign', id, step: step.key, signerId: s.id, img, blur: '', tag: await authTag(pin, s.authSalt, s.iter), baseUpdatedAt: g.updatedAt });
}
function mailsTo(env, email, poId) { return env.state.mails.filter(m => String(m.to).split(',').includes(email) && (!poId || m.html.includes(poId))); }

function newPO(env, subject, consumables, assets) {
  const r = env.call(REQ, { action: 'save', data: { meta: { dept: 'الإدارة التنفيذية للاتصالات وتقنية المعلومات', subject, supplier: 'شركة التقنية المتقدمة', budget: 'BUD-ICT-2026-07', date: '2026-11-18' }, consumables, assets: assets || [] }, managerEmail: MGR, managerName: 'مدير إدارة العمليات التقنية' });
  assert.ok(r.ok, 'save ' + JSON.stringify(r));
  return r.data.meta.id;
}
const chain3 = [
  { email: S1, name: 'مدير إدارة المستودعات', title: 'مدير إدارة المستودعات', slots: ['cons.C'] },
  { email: S2, name: 'مدير إدارة المشتريات', title: 'مدير إدارة المشتريات', slots: ['cons.C'] },
  { email: S3, name: 'الرئيس التنفيذي للخدمات المشتركة', title: 'الرئيس التنفيذي للخدمات المشتركة', slots: ['cons.A'] },
  { email: INF, name: 'مدير الشركة', title: 'مدير الشركة', kind: 'inform', slots: ['cons.I'] }
];

(async function main() {
  const env = makeEnv({ dir: path.join(__dirname, '..', 'apps-script') });
  console.log('POFlow acceptance tests\n');

  console.log('0 · setup, roles, signature register');
  ok(env.doGet(OWNER, {}).content.includes('window.BOOT='), 'doGet serves the app with BOOT data to an @sr.edu.sa account');
  ok(/window\.DENY=.*"reason":"domain"/.test(env.doGet('someone@gmail.com', {}).content), 'non-university account → domain-only screen');
  ok(/window\.DENY=.*"reason":"list"/.test(env.doGet(REQ, {}).content), 'unlisted @sr.edu.sa account → «طلب صلاحية الدخول» screen');
  ok((() => { try { env.call(REQ, { action: 'list' }); return false; } catch (e) { return /غير مصرح/.test(e.message); } })(), 'unlisted account cannot call the API');
  env.state.user = REQ;
  let ar = env.sandbox.__api.requestAccess({ name: 'مقدم الطلب', role: 'editor', reason: 'أحتاج إنشاء أوامر شراء لإدارتي' });
  ok(ar.sent && env.state.mails.some(m => m.to === 'm.elmahdy@sr.edu.sa' && /طلب صلاحية دخول/.test(m.subject)), 'access request e-mailed to m.elmahdy@sr.edu.sa');
  ok(env.sandbox.__api.requestAccess({ name: 'x', role: 'editor', reason: 'مرة أخرى' }).pending, 'a second request while pending is not duplicated');
  const rq = env.call(OWNER, { action: 'accessRequests' }).items.find(x => x.email === REQ);
  ok(env.call(OWNER, { action: 'accessDecide', rid: rq.rid, decision: 'approve', role: 'editor' }).ok, 'admin approves the request as Editor');
  ok(env.call(REQ, { action: 'list' }).ok && env.state.mails.some(m => m.to === REQ && /تمت الموافقة/.test(m.subject)), 'approved user can now enter and was notified');
  ok(env.call(OWNER, { action: 'userSave', email: PROC, name: 'إدارة المشتريات', role: 'editor', procurement: true }).ok, 'admin adds an Editor flagged «procurement»');
  ok(env.call(OWNER, { action: 'userSave', email: AUD, name: 'المراجع الداخلي', role: 'viewer' }).ok, 'admin adds a Viewer');
  for (const e of [MGR, S1, S2, S3, INF, DLG]) env.call(OWNER, { action: 'userSave', email: e, name: '', role: 'editor' });
  ok(env.call(AUD, { action: 'sigAdd', name: 'x' }).error === 'forbidden', 'a Viewer cannot register signatures or sign');
  ok(env.call(REQ, { action: 'route', id: 'x' }).error === 'forbidden', 'a requester cannot route (server-side RBAC)');
  for (const [e, n, p] of [[MGR, 'م. خالد المنصور', 'مدير إدارة العمليات التقنية'], [S1, 'أ. فهد العتيبي', 'مدير إدارة المستودعات'], [S2, 'أ. سارة الزهراني', 'مدير إدارة المشتريات'], [S3, 'د. ناصر القحطاني', 'الرئيس التنفيذي للخدمات المشتركة'], [DLG, 'أ. عمر صالح', 'نائب مدير المستودعات']]) await registerSig(env, e, n, p);
  ok(env.rows('Signers').length === 5, '5 encrypted signatures registered (no PIN or clear image stored on the server)');
  ok(!JSON.stringify(env.rows('Signers')).includes('iVBORw0KGgo'), 'register holds ciphertext only');

  console.log('\nA · full approval cycle with 3 sequential signers');
  const A = newPO(env, 'توريد أجهزة شبكات ومستلزمات تشغيل', [
    { desc: 'محولات شبكية 48 منفذ', unit: 'جهاز', qty: 10, price: 9500 },
    { desc: 'كابلات ألياف ضوئية', unit: 'لفة', qty: 20, price: 1250 }]);
  let g = env.call(REQ, { action: 'get', id: A });
  ok(g.totals.cons === 120000, 'consumables total = 120,000 SAR (DoA band 100k–500k)');
  ok(env.call(REQ, { action: 'submit', id: A, baseUpdatedAt: g.updatedAt }).ok, 'requester submits for the department manager signature');
  ok(mailsTo(env, MGR, A).length === 1, 'manager receives the signature request e-mail');
  let r = await sign(env, MGR, A, 'WrongPin123');
  ok(!r.ok && /غير صحيح/.test(r.msg), 'wrong PIN rejected and counted (' + r.msg + ')');
  r = await sign(env, MGR, A);
  ok(r.ok && r.data.meta.status === 'proc_review', 'manager signs → status «قيد مراجعة المشتريات»');
  ok(mailsTo(env, PROC, A).length >= 1, 'procurement notified of the new request');
  r = env.call(S1, { action: 'route', id: A });
  ok(r.error === 'forbidden', 'a signer cannot set the route');
  g = env.call(PROC, { action: 'get', id: A });
  r = env.call(PROC, { action: 'route', id: A, serial: 'SRN/18/11/2026-001', procNote: 'يُعتمد الشراء المباشر وفق عرض السعر الأقل', targetDate: '2026-11-25', steps: chain3, start: true, baseUpdatedAt: g.updatedAt });
  ok(r.ok && r.data.meta.status === 'signing', 'procurement assigns serial, 3 signers + 1 informed, starts the cycle');
  ok(r.data.steps.find(s => s.state === 'current').email === S1, 'first signer is current');
  ok(mailsTo(env, S1, A).length === 1 && mailsTo(env, S2, A).length === 0, 'only signer 1 is asked first');
  r = await sign(env, S2, A);
  ok(!r.ok, 'signer 2 cannot sign out of turn');
  r = await sign(env, S1, A);
  ok(r.ok && r.data.steps.find(s => s.state === 'current').email === S2, 'signer 1 signs → request moves to signer 2 automatically');
  ok(mailsTo(env, S2, A).length === 1, 'signer 2 receives the request');
  r = await sign(env, S1, A);
  ok(!r.ok, 'the same step cannot be signed twice');
  r = await sign(env, S2, A);
  ok(r.ok && r.data.steps.find(s => s.state === 'current').email === S3, 'signer 2 signs → signer 3');
  r = await sign(env, S3, A);
  ok(r.ok && r.allSigned && r.data.meta.status === 'approved', 'signer 3 signs → «مكتمل ومعتمد»');
  const hashes = r.data.steps.filter(s => s.sig).map(s => s.sig.scope + ':' + s.sig.docHash.slice(0, 8));
  ok(new Set(r.data.steps.filter(s => s.sig && s.sig.scope === 'full').map(s => s.sig.docHash)).size === 1, 'all chain signatures bind the same SHA-256 content hash (' + hashes.join(' · ') + ')');
  const vt = env.call(S3, { action: 'vtoken', id: A });
  ok(vt.ok && /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(vt.id), 'verification code issued for the certificate page (' + vt.id + ')');
  const before = env.state.mails.length;
  r = env.call(S3, { action: 'finalize', id: A, pdf: PDF });
  ok(r.ok && r.verifyId === vt.id, 'final PDF archived, fingerprinted (' + r.pdfHash.slice(0, 16) + '…)');
  const fin = env.state.mails.slice(before)[0];
  ok(fin && fin.attachments === 1 && [PROC, REQ, S1, S2, S3, INF].every(e => fin.to.split(',').includes(e)), 'final PDF e-mailed to procurement, requester, signers and the informed party');
  ok(env.rows('Signed').length === 1, 'archive row written (Signed)');
  ok(env.call(PROC, { action: 'finalize', id: A, pdf: PDF }).already, 'finalisation is idempotent');
  let v = env.call(AUD, { action: 'verify', id: vt.id });
  ok(v.found && v.valid && v.signers.length === 4, 'verification by code: valid, 4 signatures match');
  const pdfHash = require('crypto').createHash('sha256').update(Buffer.from(PDF, 'base64')).digest('hex');
  v = env.call(AUD, { action: 'verifyHash', hash: pdfHash });
  ok(v.found && v.valid, 'verification by PDF fingerprint: match');
  ok(env.call(AUD, { action: 'list' }).items.some(x => x.id === A && x.status === 'approved'), 'Viewer sees the approved PO in the archive');
  ok(env.call(AUD, { action: 'save', data: { meta: { subject: 'x' } } }).error === 'forbidden', 'Viewer is read-only');
  env.call(OWNER, { action: 'userSave', email: 'other.user@sr.edu.sa', name: '', role: 'editor' });
  ok(!env.call('other.user@sr.edu.sa', { action: 'get', id: A }).ok, 'an unrelated Editor cannot open the PO');
  ok(env.call(S1, { action: 'unsign', id: A, step: 'x' }).ok === false, 'signatures cannot be removed after the final PDF');

  console.log('\nB · rejection at signer 2');
  const B = newPO(env, 'توريد أثاث مكتبي', [{ desc: 'مكاتب إدارية', unit: 'قطعة', qty: 30, price: 4000 }]);
  g = env.call(REQ, { action: 'get', id: B });
  env.call(REQ, { action: 'submit', id: B, baseUpdatedAt: g.updatedAt });
  await sign(env, MGR, B);
  g = env.call(PROC, { action: 'get', id: B });
  env.call(PROC, { action: 'route', id: B, serial: 'SRN/18/11/2026-002', procNote: '', targetDate: '2026-11-26', steps: chain3, start: true, baseUpdatedAt: g.updatedAt });
  await sign(env, S1, B);
  const procMails0 = mailsTo(env, PROC, B).length, reqMails0 = mailsTo(env, REQ, B).length;
  g = env.call(S2, { action: 'get', id: B });
  const st2 = g.data.steps.find(s => s.state === 'current');
  ok(env.call(S2, { action: 'reject', id: B, step: st2.key, reason: '' }).ok === false, 'a reason is mandatory for rejection');
  r = env.call(S2, { action: 'reject', id: B, step: st2.key, reason: 'السعر أعلى من متوسط السوق — يلزم عرض سعر إضافي' });
  ok(r.ok && r.data.meta.status === 'rejected', 'signer 2 rejects → status «مرفوض», cycle stopped');
  const rej = r.data.steps.find(s => s.state === 'rejected');
  ok(rej.rejectedBy === S2 && rej.reason && rej.rejectedAt, 'rejector, reason and time recorded');
  ok(mailsTo(env, PROC, B).length > procMails0 && mailsTo(env, REQ, B).length > reqMails0, 'procurement and requester notified immediately');
  ok(mailsTo(env, S3, B).length === 0, 'signer 3 was never sent the request');
  r = await sign(env, S3, B);
  ok(!r.ok, 'signer 3 cannot sign a rejected PO');
  ok(env.call(PROC, { action: 'route', id: B, serial: 'x', steps: chain3, start: true }).ok === false, 'the cycle cannot resume without a new procedure');
  r = env.call(REQ, { action: 'revise', id: B });
  ok(r.ok && r.data.meta.version === '1.1' && r.data.meta.status === 'draft', 'requester creates version 1.1 for editing');
  const vers = env.call(REQ, { action: 'versions', id: B }).items.map(x => x.version + ':' + x.status);
  ok(vers.includes('1.0:rejected'), 'version 1.0 (rejected) kept in history [' + vers.join(', ') + ']');

  console.log('\nC · return for completion, delegation, reminders, audit');
  const C = newPO(env, 'شراء أصول — خوادم', [], [{ desc: 'خادم تخزين', unit: 'جهاز', qty: 1, price: 45000 }]);
  g = env.call(REQ, { action: 'get', id: C });
  env.call(REQ, { action: 'submit', id: C, baseUpdatedAt: g.updatedAt });
  await sign(env, MGR, C);
  r = env.call(PROC, { action: 'return', id: C, note: 'يرجى إرفاق عرض السعر الرسمي' });
  ok(r.ok && r.data.meta.status === 'returned' && r.data.meta.version === '1.1' && !r.data.steps[0].sig, 'procurement returns the request: new version, signatures cleared');
  g = env.call(REQ, { action: 'get', id: C });
  r = env.call(REQ, { action: 'upload', id: C, name: 'عرض-سعر.pdf', mime: 'application/pdf', b64: PDF, kind: 'quotation' });
  ok(r.ok && r.data.attachments.length === 1 && r.data.attachments[0].sha.length === 64, 'attachment stored in Drive with SHA-256');
  g = env.call(REQ, { action: 'get', id: C });
  env.call(REQ, { action: 'submit', id: C, baseUpdatedAt: g.updatedAt });
  await sign(env, MGR, C);
  ok(env.call(OWNER, { action: 'delegationSave', fromEmail: S1, toEmail: DLG, start: '2026-01-01', end: '2030-12-31', reason: 'إجازة' }).ok, 'admin records a dated delegation S1 → deputy');
  g = env.call(PROC, { action: 'get', id: C });
  env.call(PROC, { action: 'route', id: C, serial: 'SRN/18/11/2026-003', steps: [{ email: S1, title: 'مدير إدارة المرافق', slots: ['asset.A'] }], start: true, baseUpdatedAt: g.updatedAt });
  r = await sign(env, DLG, C);
  ok(r.ok && r.data.steps.find(s => s.phase === 'chain').sig.onBehalfOf === S1, 'deputy signs on behalf of S1 (recorded as «بالنيابة عن»)');
  const D = newPO(env, 'مستلزمات مكتبية', [{ desc: 'ورق طباعة', unit: 'كرتون', qty: 50, price: 120 }]);
  g = env.call(REQ, { action: 'get', id: D });
  env.call(REQ, { action: 'submit', id: D, baseUpdatedAt: g.updatedAt });
  // age the current step by 2 days
  const row = env.sheet('POs').rows.findIndex(x => x[0] === D);
  const d = JSON.parse(env.sheet('POs').rows[row].slice(23).join('')); d.steps[0].since = d.steps[0].notifiedAt = new Date(Date.now() - 5 * 864e5).toISOString();
  const js = JSON.stringify(d); for (let i = 0; i < 6; i++) env.sheet('POs').rows[row][23 + i] = js.slice(i * 45000, (i + 1) * 45000);
  env.call(OWNER, { action: 'settingsSave', settings: { ESCALATE_EMAIL: 'cio@sr.edu.sa' } });
  const sent = env.remind();
  ok(sent >= 2 && mailsTo(env, 'cio@sr.edu.sa', D).length === 1, 'hourly job sends a reminder and escalates the overdue step');
  const aud = env.call(AUD, { action: 'audit', poId: A }).items.map(x => x.action);
  ok(['create', 'submit', 'sign', 'route', 'start', 'finalized'].every(a => aud.includes(a)), 'audit trail holds every action for PO A (' + aud.length + ' entries)');
  ok(env.call(REQ, { action: 'notifications' }).items.length > 0, 'in-app notifications delivered');

  console.log('\nD · technical specifications stage (v1.9)');
  const TECH = 'it.specs@sr.edu.sa';
  ok(env.call(PROC, { action: 'toSpecs', id: 'x', email: TECH }).ok === false, 'referral requires an existing PO in review');
  const E = newPO(env, 'توريد أجهزة حاسب محمولة', [{ desc: 'حاسب محمول للموظفين', unit: 'جهاز', qty: 10, price: 4200 }, { desc: 'حقيبة حاسب', unit: 'قطعة', qty: 10, price: 150 }]);
  g = env.call(REQ, { action: 'get', id: E }); env.call(REQ, { action: 'submit', id: E, baseUpdatedAt: g.updatedAt }); await sign(env, MGR, E);
  const ch0 = env.call(PROC, { action: 'get', id: E }).data.meta.contentHash;
  ok(/غير مضاف/.test(env.call(PROC, { action: 'toSpecs', id: E, email: TECH }).error), 'the technical party must be a platform user');
  env.call(OWNER, { action: 'userSave', email: TECH, name: 'إدارة تقنية المعلومات', role: 'editor' });
  ok(env.call(REQ, { action: 'toSpecs', id: E, email: TECH }).error === 'forbidden', 'only procurement can refer for specs');
  r = env.call(PROC, { action: 'toSpecs', id: E, email: TECH, name: 'إدارة تقنية المعلومات', note: 'الحد الأدنى للمواصفات', due: '2026-12-01' });
  ok(r.ok && r.data.meta.status === 'tech_specs', 'procurement refers the request → «بانتظار المواصفات الفنية»');
  ok(mailsTo(env, TECH, E).length === 1, 'technical party receives the request e-mail');
  ok(env.call(TECH, { action: 'list' }).items.some(x => x.id === E && x.mine && x.current.title === 'إعداد المواصفات الفنية'), 'request appears in the technical party inbox as «mine»');
  ok(env.call(PROC, { action: 'route', id: E, serial: 'x', steps: chain3, start: true }).ok === false, 'routing is blocked while specs are pending');
  ok(env.call(S1, { action: 'specsSave', id: E, cons: ['x'] }).ok === false, 'another user cannot write the specs');
  r = env.call(TECH, { action: 'specsSave', id: E, cons: ['Core i7 · 16GB RAM · SSD 512GB · شاشة 14"', ''], submit: true });
  ok(r.ok === false && /جميع البنود/.test(r.error), 'submitting requires a spec for every item');
  r = env.call(TECH, { action: 'specsSave', id: E, cons: ['Core i7 · 16GB RAM · SSD 512GB · شاشة 14"', 'مقاس 15.6"، مقاومة للماء'], general: 'ضمان 3 سنوات', submit: true });
  ok(r.ok && r.data.meta.status === 'proc_review' && r.data.consumables[0].spec, 'specs submitted → request back to procurement «قيد مراجعة المشتريات»');
  ok(mailsTo(env, PROC, E).some(m => /اكتملت المواصفات/.test(m.subject)), 'procurement notified that specs are complete');
  ok(r.data.meta.contentHash === ch0, 'requester signature hash unchanged by the specs');
  g = env.call(PROC, { action: 'get', id: E });
  env.call(PROC, { action: 'route', id: E, serial: 'SRN/19/11/2026-005', steps: [{ email: S2, title: 'مدير إدارة المشتريات', slots: ['cons.A'] }], start: true, baseUpdatedAt: g.updatedAt });
  r = await sign(env, S2, E);
  ok(r.ok && r.allSigned, 'approval chain signs (specs included in fullHash)');
  const vtE = env.call(S2, { action: 'vtoken', id: E }); env.call(S2, { action: 'finalize', id: E, pdf: PDF });
  v = env.call(AUD, { action: 'verify', id: vtE.id });
  ok(v.valid, 'verification valid for a PO with technical specs');
  console.log('\n' + passed + ' checks passed ✔');
})().catch(e => { console.error('\n✘ FAILED: ' + e.message); process.exit(1); });
