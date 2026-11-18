/**
 * =====================================================================
 *  POFlow v1.6 — منصة أوامر الشراء والتوقيعات والموافقات الإلكترونية
 *  Purchase Order Approval & Digital Signature Platform
 *  Built on SRU Secure Access Kit v1.4 — access limited to @sr.edu.sa accounts
 *  E-signature logic = the ICTD Policy Platform model (v3.4), applied to a sequential PO workflow:
 *    · an independent, encrypted signature register for this platform only (sheet «Signers» + private Drive folder)
 *    · images encrypted/decrypted ONLY in the signer's browser (AES-256-GCM, PBKDF2 key from the PIN)
 *    · the server never receives a PIN; it verifies SHA-256(PIN-derived tag + secret pepper), locks after 5 wrong PINs
 *    · every signature stores the SHA-256 of the content it signed; display modes stamp · image · blur
 *    · the last signer's browser renders the final A4 PDF (form + DoA matrix + certificate with QR);
 *      the server archives it, fingerprints it, e-mails it and serves verification (code · QR · PDF fingerprint)
 *  ICTD — ITOC
 * ---------------------------------------------------------------------
 *  Workflow (status codes):
 *    draft → req_sign (requesting manager signs) → proc_review (procurement) ─┬→ returned → (edit) → req_sign …
 *                                                                         └→ signing (sequential chain) ─┬→ approved (final PDF, archive)
 *                                                                                                        └→ rejected (stop, notify) → revise = new version
 *    cancelled (requester before submission · procurement/admin any time before approval)
 *  Project files (bound to the Google Sheet «سجل أوامر الشراء - POFlow»):
 *    Code.gs · Index.html (app) · HowTo.html (كيفية التوقيع) · Logos.html · CompanyLogo.html · PdfFont.html · Denied.html
 *  Deploy: push apps-script/** to ICTSRU/POFlow-server — GitHub Actions + clasp move the existing deployment
 *          to a new version (same /exec URL). Manual: Deploy ▸ Manage deployments ▸ ✏️ ▸ New version
 *          Execute as: Me · Who has access: Anyone within Sulaiman Al Rajhi University
 * =====================================================================
 */

/* ▼▼▼ CONFIG ▼▼▼ */
const APP_NAME       = 'منصة أوامر الشراء';
const APP_NAME_EN    = 'POFlow — Purchase Order Approval & Digital Signature Platform';
const APP_SHORT      = 'POFlow';
const APP_VERSION    = '1.6';
const ALLOWED_DOMAIN = 'sr.edu.sa';
const FAVICON_URL    = 'https://ictsru.github.io/ITOC/assets/itoc-logo.png';
const TZ             = 'Asia/Riyadh';

/* v1.1 — linked data store (Google Drive ▸ My Drive ▸ POFlow)
   SPREADSHEET_ID  = «سجل أوامر الشراء - POFlow» (the register). '' = the spreadsheet this script is bound to.
   ROOT_FOLDER_ID  = the POFlow folder; the private sub-folders (attachments, encrypted signatures, approved PDFs) are created inside it. */
const SPREADSHEET_ID = '1SGMuJHvyJhgWroQAfhMtTVIxqB1Xhm5BLq_kfEcyMVs';
const ROOT_FOLDER_ID = '1anlqtdCToNwt8QJuAeeINGP9TUd_BrZT';

/* Access (kit v1.4). v1.3: 'LIST' = only active rows of AllowedUsers may open the platform (Admin · Editor · Viewer);
   anyone else sees the access-request screen, which e-mails ACCESS_ADMIN_EMAIL. 'DOMAIN' = every @sr.edu.sa account (DEFAULT_ROLE);
   'LIST' = only active rows of AllowedUsers. */
const ACCESS_MODE          = 'LIST';
const DEFAULT_ROLE         = 'viewer';
const ACCESS_ADMIN_EMAIL   = 'm.elmahdy@sr.edu.sa';   // receives access requests (v1.3)
const OWNER_EMAILS         = ['m.elmahdy@sr.edu.sa'];   // always allowed, always admin
const ACCESS_CACHE_SECONDS = 120;
const LOG_DEDUP_MINUTES    = 30;
const LOG_RETENTION_DAYS   = 180;

/* E-signatures (policy-platform model) */
const SIG_MAX_FAILS = 5;
const SIG_LOCK_MIN  = 15;
const MAX_PDF_B64   = 24000000;
const MAX_ATT_BYTES = 10 * 1024 * 1024;      // per attachment
const MAX_ATTS      = 15;

/* Default access list — added by setupAccessList() (existing rows are kept). */
const DEFAULT_ALLOWED = [
  // [email, name, role, notes]
  ['m.elmahdy@sr.edu.sa', 'Mohamed ElMahdy', 'admin', 'Owner — IT Operations Manager'],
  ['nabounar@sr.edu.sa',  'Nasser Abounar',  'admin', 'CIO']
];
/* ▲▲▲ CONFIG ▲▲▲ */

/* v1.3 — three access roles. Editors flagged «procurement» in AllowedUsers also run procurement (review, route, start).
   admin        = Admin: users, access requests, delegation, settings + everything below
   editor_proc  = Editor + procurement team: all POs, review, return, route, start, finalize
   editor       = Editor: create / edit own requests, sign or reject the steps assigned to his e-mail
   viewer       = Viewer: read-only — all POs, archive, reports, verification, audit trail */
const ROLES   = ['admin', 'editor', 'viewer'];
const ROLE_AR = { admin: 'مدير النظام (Admin)', editor: 'محرر (Editor)', editor_proc: 'محرر · المشتريات (Editor)', viewer: 'مشاهد (Viewer)' };
const STATUS_AR = {
  draft: 'مسودة', req_sign: 'بانتظار توقيع الجهة الطالبة', proc_review: 'قيد مراجعة المشتريات', returned: 'معاد للاستكمال',
  signing: 'بانتظار التوقيع', rejected: 'مرفوض', approved: 'مكتمل ومعتمد', cancelled: 'ملغى'
};

/* Sheets */
const SH_PO = 'POs', SH_VER = 'Versions', SH_AUDIT = 'AuditLog', SH_ACCESS = 'AllowedUsers', SH_ACCLOG = 'AccessLog';
const SH_SIGNERS = 'Signers', SH_SIGNED = 'Signed', SH_NOTIFY = 'Notifications', SH_DELEG = 'Delegations', SH_SETTINGS = 'Settings';
const CHUNK = 45000, JSON_COLS = 6;
const PO_HEADERS = ['id', 'version', 'status', 'statusAr', 'serial', 'dept', 'requester', 'requesterEmail', 'subject', 'supplier',
  'total', 'currency', 'currentEmail', 'currentName', 'currentSince', 'targetDate', 'createdAt', 'submittedAt', 'routedAt',
  'approvedAt', 'rejectedAt', 'updatedAt', 'updatedBy'];
const VER_HEADERS = ['id', 'version', 'status', 'savedAt', 'savedBy', 'reason'];
const AUDIT_HEADERS = ['timestamp', 'date', 'time', 'email', 'action', 'poId', 'version', 'step', 'detail', 'result'];
const ACCESS_HEADERS = ['email', 'name', 'role', 'active', 'notes', 'procurement'];
const SH_ACCREQ = 'AccessRequests';
const ACCREQ_HEADERS = ['rid', 'timestamp', 'date', 'time', 'email', 'name', 'role', 'reason', 'status', 'decidedBy', 'decidedAt', 'note'];
const ACCLOG_HEADERS = ['timestamp', 'date', 'time', 'day', 'email', 'result', 'version'];
const SIGNERS_HEADERS = ['id', 'name', 'position', 'org', 'fileId', 'encSalt', 'encIv', 'iter', 'authSalt', 'authHash', 'fails', 'lockUntil', 'status', 'createdBy', 'createdAt', 'updatedAt', 'ownerEmail'];
const SIGNED_HEADERS = ['id', 'version', 'serial', 'subject', 'contentHash', 'fullHash', 'pdfId', 'pdfHash', 'finalizedAt', 'finalizedBy', 'sentTo', 'verifyId'];
const NOTIFY_HEADERS = ['nid', 'timestamp', 'to', 'poId', 'type', 'title', 'read'];
const DELEG_HEADERS = ['did', 'fromEmail', 'toEmail', 'start', 'end', 'active', 'reason', 'createdBy', 'createdAt'];
const DAYS_AR_ = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/* Delegation-of-Authority matrix (page 2 of the official form). Editable in Settings ▸ «مسارات العمل». */
const DEFAULT_DOA = {
  cons: [
    { max: 50000,  C: [],                                                          A: 'مدير إدارة المشتريات',              I: [] },
    { max: 100000, C: ['مدير إدارة المستودعات', 'مدير إدارة المشتريات'],            A: 'الرئيس التنفيذي للخدمات المشتركة', I: [] },
    { max: 500000, C: ['مدير إدارة المستودعات', 'مدير إدارة المشتريات', 'الإدارة المالية', 'الجهة الطالبة'], A: 'الرئيس التنفيذي للخدمات المشتركة', I: ['مدير الشركة'] },
    { max: null,   C: ['مدير إدارة المستودعات', 'مدير إدارة المشتريات', 'الإدارة المالية', 'الجهة الطالبة'], A: 'مدير الشركة', I: [] }
  ],
  asset: [
    { max: 50000,  C: [],                                                          A: 'مدير إدارة المرافق',                I: [] },
    { max: 100000, C: ['مدير إدارة المرافق'],                                       A: 'الرئيس التنفيذي للخدمات المشتركة', I: [] },
    { max: null,   C: ['مدير إدارة المرافق', 'مدير إدارة المشتريات', 'الإدارة المالية', 'الجهة الطالبة'], A: 'مدير الشركة', I: [] }
  ]
};
const DEFAULT_SETTINGS = {
  PROC_EMAILS: '',                 // procurement inbox (comma separated) — receives submissions, rejections, final PDFs
  ESCALATE_EMAIL: '',              // escalation contact when a step exceeds the target
  MAIL_FROM: 'itoc@sr.edu.sa',     // used if it is a Gmail alias of the script owner; otherwise the owner's address
  REMIND_HOURS: '24',              // reminder to the current signer after N hours without action
  ESCALATE_DAYS: '3',              // escalate after N days on one step (or when the target date passes)
  TARGET_DAYS: '5',                // default target for completing approvals (days after routing)
  CURRENCY: 'SAR',
  COMPANY_AR: 'شركة سليمان بن عبدالعزيز الراجحي للتعليم والتنمية',
  COMPANY_EN: 'Sulaiman Bin Abdul Aziz Al-Rajhi Educational and Development Company',
  RETENTION_YEARS: '10',
  POSITIONS: JSON.stringify([      // position directory used by the DoA suggestion: title → signer e-mail
    { title: 'مدير إدارة المشتريات', email: '', name: '' },
    { title: 'مدير إدارة المستودعات', email: '', name: '' },
    { title: 'مدير إدارة المرافق', email: '', name: '' },
    { title: 'الإدارة المالية', email: '', name: '' },
    { title: 'الرئيس التنفيذي للخدمات المشتركة', email: '', name: '' },
    { title: 'مدير الشركة', email: '', name: '' }
  ]),
  DOA: JSON.stringify(DEFAULT_DOA),
  DEPTS: JSON.stringify(['الإدارة التنفيذية للاتصالات وتقنية المعلومات', 'إدارة المرافق', 'إدارة المستودعات', 'الإدارة المالية', 'إدارة الموارد البشرية', 'عمادة شؤون الطلاب', 'عمادة القبول والتسجيل']),
  BUDGETS: JSON.stringify([]),
  DIGITAL_PROVIDER: ''             // reserved: qualified digital-signature provider (future integration)
};
const DEFAULT_SIG_MODE = 'image';
const MODES_ = ['stamp', 'image', 'blur'];

/* =============================== Web app =============================== */

function doGet(e) {
  const p = (e && e.parameter) || {};
  try { setup_(); ensureInstalled_(); } catch (err) { console.error('install ' + err); }
  const email = currentEmail_();
  const status = accessStatus_(email);
  if (status !== 'ok') {
    logAccess_(email || '(unknown)', status === 'list' ? 'not-listed' : 'denied');
    const deny = { app: APP_NAME, appEn: APP_NAME_EN, version: APP_VERSION, email: email || '', reason: status, admin: ACCESS_ADMIN_EMAIL,
                   pending: status === 'list' ? !!pendingRequestOf_(email) : false };
    const dh = HtmlService.createHtmlOutputFromFile('Denied').getContent()
      .replace('<script src="config.js"></script>', function () { return '<script>window.DENY=' + safeJson_(deny) + ';</script>' + include('Logos'); });
    const dOut = HtmlService.createHtmlOutput(dh).setTitle(APP_NAME + ' | طلب صلاحية الدخول').addMetaTag('viewport', 'width=device-width, initial-scale=1');
    if (FAVICON_URL) dOut.setFaviconUrl(FAVICON_URL);
    return dOut;
  }
  logAccess_(email, 'granted');
  setup_();
  const page = String(p.page || '').toLowerCase();
  if (page === 'howto') {
    const h = HtmlService.createHtmlOutputFromFile('HowTo').setTitle('كيفية التوقيع | ' + APP_SHORT).addMetaTag('viewport', 'width=device-width, initial-scale=1');
    if (FAVICON_URL) h.setFaviconUrl(FAVICON_URL);
    return h;
  }
  const info = userInfo_(email);
  const params = {};
  ['po', 'page', 'verify', 'version'].forEach(function (k) { if (p[k] != null) params[k] = String(p[k]).slice(0, 60); });
  const boot = {
    gas: true, app: APP_NAME, appEn: APP_NAME_EN, short: APP_SHORT, version: APP_VERSION,
    user: email, name: info.name, role: info.role, roleAr: ROLE_AR[info.role], perms: perms_(info.role),
    principals: principals_(email), baseUrl: ScriptApp.getService().getUrl(), params: params,
    statusAr: STATUS_AR, settings: publicSettings_(),
    pendingRequests: perms_(info.role).admin ? accessRequests_().filter(function (x) { return x.status === 'pending'; }).length : 0,
    sheetUrl: perms_(info.role).admin ? sheetUrl_() : '', folderUrl: perms_(info.role).admin && ROOT_FOLDER_ID ? 'https://drive.google.com/drive/folders/' + ROOT_FOLDER_ID : ''
  };
  const inject = '<script>window.BOOT=' + safeJson_(boot) + ';</script>' + include('Logos') + include('CompanyLogo') + include('PdfFont');
  const html = HtmlService.createHtmlOutputFromFile('Index').getContent()
    .replace('<script src="config.js"></script>', function () { return inject; });
  const out = HtmlService.createHtmlOutput(html).setTitle(APP_NAME + ' | ' + APP_SHORT).addMetaTag('viewport', 'width=device-width, initial-scale=1');
  if (FAVICON_URL) out.setFaviconUrl(FAVICON_URL);
  return out;
}

/** Single entry point for the page (google.script.run.poApi). The account is re-checked on every call. */
function poApi(req) {
  const email = requireSruUser_();
  req = req || {};
  try {
    setup_();
    const role = userInfo_(email).role, P = perms_(role);
    const need = ACTION_PERM_[req.action];
    if (need && !P[need]) return { ok: false, error: 'forbidden', msg: 'هذه العملية غير متاحة لصلاحيتك (' + ROLE_AR[role] + ')' };
    switch (req.action) {
      case 'ping':          return { ok: true, version: 'v' + APP_VERSION, user: email, role: role };
      case 'list':          return { ok: true, items: list_(email, role), now: new Date().toISOString() };
      case 'get':           return get_(email, role, req.id, req.version);
      case 'versions':      return { ok: true, items: versions_(email, role, req.id) };
      case 'save':          return save_(email, role, req);
      case 'submit':        return submit_(email, role, req);
      case 'cancel':        return cancel_(email, role, req);
      case 'return':        return return_(email, role, req);
      case 'route':         return route_(email, role, req);
      case 'editSteps':     return editSteps_(email, role, req);
      case 'sign':          return signStep_(email, role, req);
      case 'reject':        return rejectStep_(email, role, req);
      case 'unsign':        return unsignStep_(email, role, req);
      case 'revise':        return revise_(email, role, req);
      case 'upload':        return upload_(email, role, req);
      case 'attachment':    return attachment_(email, role, req);
      case 'removeAtt':     return removeAtt_(email, role, req);
      /* signature register (policy-platform model) */
      case 'sigs':          return { ok: true, items: mySigs_(email), admin: P.admin, all: P.admin ? allSigs_() : [], displayDefault: displayDefault_() };
      case 'sigAdd':        return sigAdd_(email, req);
      case 'sigUnlock':     return sigUnlock_(email, req);
      case 'sigPin':        return sigPin_(email, req);
      case 'sigDelete':     return sigDelete_(email, req);
      case 'sigShow':       return sigShow_(email, role, req);
      case 'setDisplay':    return setDisplay_(email, role, req);
      case 'setDefaultDisplay': return setDefaultDisplay_(email, req);
      case 'finalImages':   return finalImages_(email, role, req);
      case 'vtoken':        return vtoken_(email, role, req);
      case 'finalize':      return finalize_(email, role, req);
      case 'finalPdf':      return finalPdf_(email, role, req);
      case 'verify':        return verifyById_(email, req.id);
      case 'verifyHash':    return verifyByHash_(email, req.hash);
      /* notifications · admin */
      case 'notifications': return { ok: true, items: notifications_(email) };
      case 'markRead':      return markRead_(email, req);
      case 'users':         return { ok: true, items: usersList_() };
      case 'userSave':      return userSave_(email, req);
      case 'accessRequests': return { ok: true, items: accessRequests_() };
      case 'accessDecide':  return accessDecide_(email, req);
      case 'delegations':   return { ok: true, items: delegations_() };
      case 'delegationSave': return delegationSave_(email, req);
      case 'settings':      return { ok: true, settings: settingsAll_() };
      case 'settingsSave':  return settingsSave_(email, req);
      case 'audit':         return { ok: true, items: audit_(req) };
      case 'remindNow':     return { ok: true, sent: remindPending() };
      default:              return { ok: false, error: 'unknown action' };
    }
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

/* =============================== Roles =============================== */

function perms_(role) {
  const r = String(role || ''), ad = r === 'admin', pr = ad || r === 'editor_proc', ed = pr || r === 'editor';
  return { admin: ad, procurement: pr, create: ed, sign: ed, viewAll: pr || r === 'viewer', audit: pr || r === 'viewer', viewer: r === 'viewer' };
}
const ACTION_PERM_ = {
  save: 'create', submit: 'create', revise: 'create', upload: 'create', removeAtt: 'create',
  'return': 'procurement', route: 'procurement', editSteps: 'procurement', setDisplay: 'procurement',
  sign: 'sign', reject: 'sign', unsign: 'sign', sigAdd: 'sign', sigUnlock: 'sign', sigPin: 'sign', sigDelete: 'sign', sigShow: 'sign',
  users: 'admin', userSave: 'admin', accessRequests: 'admin', accessDecide: 'admin', delegations: 'admin', delegationSave: 'admin', settingsSave: 'admin', setDefaultDisplay: 'admin', remindNow: 'admin',
  audit: 'audit'
};
/** v1.3: admin · editor · viewer (legacy v1.0–1.2 values are mapped; anything unknown = viewer). */
function normRole_(v) {
  const r = String(v || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (r === 'admin' || r === 'administrator') return 'admin';
  if (['editor', 'procurement', 'purchasing', 'requester', 'requestor', 'signer', 'approver', 'user', 'super', 'superuser'].indexOf(r) > -1) return 'editor';
  return 'viewer';
}
function isTrue_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }

/* =============================== Access =============================== */

function currentEmail_() { return String(Session.getActiveUser().getEmail() || '').toLowerCase(); }
function isAllowed_(email) { return !!email && email.endsWith('@' + ALLOWED_DOMAIN); }
function isOwner_(email) { return OWNER_EMAILS.map(norm_).indexOf(norm_(email)) !== -1; }
function requireSruUser_() {
  const email = currentEmail_(), st = accessStatus_(email);
  if (st === 'domain') throw new Error('غير مصرح — الدخول لمنسوبي الجامعة فقط');
  if (st === 'list') throw new Error('غير مصرح — حسابك غير مضاف إلى قائمة المصرّح لهم');
  return email;
}
function accessStatus_(email) {
  if (!isAllowed_(email)) return 'domain';
  if (ACCESS_MODE !== 'LIST' || isOwner_(email)) return 'ok';
  return aclMap_()[email] ? 'ok' : 'list';
}
/** Effective role used by perms_(): admin · editor_proc · editor · viewer. */
function userInfo_(email) {
  const r = aclMap_()[email];
  if (isOwner_(email)) return { role: 'admin', name: (r && r.name) || '' };
  if (!r) return { role: ACCESS_MODE === 'LIST' ? 'viewer' : DEFAULT_ROLE, name: '' };
  return { role: r.role === 'editor' && r.proc ? 'editor_proc' : r.role, name: r.name };
}
function aclMap_() {
  const cache = CacheService.getScriptCache(), hit = cache.get('po_acl_v2');
  if (hit) return JSON.parse(hit);
  const map = {};
  try {
    const sh = sheet_(SH_ACCESS);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues()
      .filter(function (r) { return r[0] && r[3] !== false && String(r[3]).toUpperCase() !== 'FALSE'; })
      .forEach(function (r) { map[norm_(r[0])] = { name: String(r[1] || ''), role: normRole_(r[2]), proc: isTrue_(r[5]) || /procurement|purchasing/i.test(String(r[2])) }; });
  } catch (e) { console.error('aclMap_ ' + e); }
  cache.put('po_acl_v2', JSON.stringify(map), ACCESS_CACHE_SECONDS);
  return map;
}
function logAccess_(email, result) {
  try {
    const sh = sheet_(SH_ACCLOG), now = new Date();
    if (LOG_DEDUP_MINUTES > 0 && result === 'granted') {
      const c = CacheService.getScriptCache(), k = 'acc_' + email;
      if (c.get(k)) return;
      c.put(k, '1', LOG_DEDUP_MINUTES * 60);
    }
    sh.appendRow([now, fmt_(now, 'yyyy-MM-dd'), fmt_(now, 'HH:mm:ss'), DAYS_AR_[now.getDay()], email, result, 'v' + APP_VERSION]);
  } catch (e) { console.error('logAccess_ ' + e); }
}
/** Run once: creates AllowedUsers with the default list. */
function setupAccessList() {
  setup_();
  const sh = sheet_(SH_ACCESS);
  const have = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(function (r) { return norm_(r[0]); }) : [];
  DEFAULT_ALLOWED.forEach(function (u) { if (have.indexOf(norm_(u[0])) === -1) sh.appendRow([u[0], u[1], u[2], true, u[3], false]); });
  CacheService.getScriptCache().remove('po_acl_v2');
  return 'AllowedUsers ready';
}
/** Admin housekeeping: delete AccessLog rows older than LOG_RETENTION_DAYS. */
function purgeOldLogs() {
  const sh = sheet_(SH_ACCLOG), n = sh.getLastRow() - 1;
  if (n < 1) return 0;
  const lim = Date.now() - LOG_RETENTION_DAYS * 864e5, vals = sh.getRange(2, 1, n, 1).getValues();
  let k = 0; while (k < vals.length && new Date(vals[k][0]).getTime() < lim) k++;
  if (k) sh.deleteRows(2, k);
  return k;
}

/* =============================== Setup =============================== */

let SS_CACHE_ = null;
function ss_() { return SS_CACHE_ || (SS_CACHE_ = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet()); }
function sheetUrl_() { return 'https://docs.google.com/spreadsheets/d/' + ss_().getId() + '/edit'; }
function sheet_(name) { setup_(); return ss_().getSheetByName(name); }
let SETUP_DONE_ = false;
function setup_() {
  if (SETUP_DONE_) return;
  const ss = ss_();
  const defs = [
    [SH_PO, PO_HEADERS.concat(jsonHeaders_())], [SH_VER, VER_HEADERS.concat(jsonHeaders_())], [SH_AUDIT, AUDIT_HEADERS],
    [SH_ACCESS, ACCESS_HEADERS], [SH_ACCLOG, ACCLOG_HEADERS], [SH_SIGNERS, SIGNERS_HEADERS], [SH_SIGNED, SIGNED_HEADERS],
    [SH_NOTIFY, NOTIFY_HEADERS], [SH_ACCREQ, ACCREQ_HEADERS], [SH_DELEG, DELEG_HEADERS], [SH_SETTINGS, ['key', 'value', 'updatedAt', 'updatedBy']]
  ];
  defs.forEach(function (x) {
    let sh = ss.getSheetByName(x[0]);
    if (!sh) {
      sh = ss.insertSheet(x[0]);
      sh.getRange(1, 1, 1, x[1].length).setValues([x[1]]).setFontWeight('bold').setBackground('#501e8c').setFontColor('#ffffff');
      sh.setFrozenRows(1);
      try { sh.setRightToLeft(true); } catch (e) {}
      try { sh.getRange(1, 1, sh.getMaxRows(), x[1].length).setNumberFormat('@'); } catch (e) {}
      if (x[0] === SH_SIGNERS) try { sh.hideColumns(5, 6); } catch (e) {}
      if (x[0] === SH_AUDIT) protectSheet_(sh);
      if (x[0] === SH_SETTINGS) Object.keys(DEFAULT_SETTINGS).forEach(function (k) { sh.appendRow([k, DEFAULT_SETTINGS[k], new Date().toISOString(), 'setup']); });
    }
  });
  // v1.3 migration: AllowedUsers gets the «procurement» column; legacy role values are mapped by normRole_()
  try { const ac = ss.getSheetByName(SH_ACCESS); if (ac.getLastColumn() < ACCESS_HEADERS.length) ac.getRange(1, 1, 1, ACCESS_HEADERS.length).setValues([ACCESS_HEADERS]).setFontWeight('bold').setBackground('#501e8c').setFontColor('#ffffff'); } catch (e) {}
  SETUP_DONE_ = true;
}
function jsonHeaders_() { const a = []; for (let i = 1; i <= JSON_COLS; i++) a.push('JSON_' + i); return a; }
/** The audit trail is append-only by the script; the tab is protected so editors of the spreadsheet cannot change it. */
function protectSheet_(sh) {
  try {
    const p = sh.protect().setDescription('POFlow audit trail — append-only (script)');
    p.removeEditors(p.getEditors()); if (p.canDomainEdit()) p.setDomainEdit(false);
  } catch (e) { console.error('protect ' + e); }
}
/** v1.4 — self-install after every new version (auto-deploy from GitHub): the first request after a deploy
 *  creates/migrates the sheets, seeds AllowedUsers, creates the private folders and the secret pepper,
 *  installs the hourly reminder trigger and removes the empty default tab. Runs once per APP_VERSION. */
function ensureInstalled_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('INSTALLED_VERSION') === APP_VERSION) return;
  const lock = LockService.getScriptLock(); if (!lock.tryLock(10000)) return;
  try {
    if (props.getProperty('INSTALLED_VERSION') === APP_VERSION) return;
    const from = props.getProperty('INSTALLED_VERSION') || '—';
    setupAccessList(); sigFolder_(); finalFolder_(); attFolder_(); imgFolder_(); pepper_();
    try { if (!ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'remindPending'; })) ScriptApp.newTrigger('remindPending').timeBased().everyHours(1).create(); }
    catch (e) { console.error('trigger ' + e); }
    try {
      const ss = ss_();
      ['Sheet1', 'الورقة1', 'ورقة1'].forEach(function (n) { const sh = ss.getSheetByName(n); if (sh && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh); });
    } catch (e) {}
    props.setProperty('INSTALLED_VERSION', APP_VERSION);
    audit_log_('system', { action: 'install', detail: 'v' + from + ' → v' + APP_VERSION });
  } finally { lock.releaseLock(); }
}
/** Optional, run once from the editor: sheets, folders, pepper, access list, reminder trigger. */
function setup() {
  setup_(); setupAccessList(); sigFolder_(); finalFolder_(); attFolder_(); pepper_(); setupTriggers();
  return 'POFlow v' + APP_VERSION + ' ready';
}
/** Hourly reminder/escalation trigger (idempotent). */
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'remindPending') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('remindPending').timeBased().everyHours(1).create();
  return 'trigger: remindPending hourly';
}
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('POFlow')
      .addItem('إعداد المنصة (مرة واحدة)', 'setup')
      .addItem('إرسال التذكيرات الآن', 'remindPending')
      .addItem('حذف سجلات الدخول القديمة', 'purgeOldLogs')
      .addItem('رابط المنصة', 'showWebAppUrl').addToUi();
  } catch (e) {}
}
function showWebAppUrl() { const u = ScriptApp.getService().getUrl(); try { SpreadsheetApp.getUi().alert(u); } catch (e) {} return u; }

/* =============================== Settings =============================== */

function settingsAll_() {
  const c = CacheService.getScriptCache(), hit = c.get('po_settings_v1');
  if (hit) return JSON.parse(hit);
  const out = Object.assign({}, DEFAULT_SETTINGS), sh = sheet_(SH_SETTINGS);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) { if (r[0]) out[String(r[0])] = String(r[1]); });
  c.put('po_settings_v1', JSON.stringify(out), 300);
  return out;
}
function setting_(k) { return settingsAll_()[k]; }
function settingJson_(k, dflt) { try { return JSON.parse(setting_(k)); } catch (e) { return dflt; } }
function publicSettings_() {
  const s = settingsAll_();
  return { CURRENCY: s.CURRENCY, COMPANY_AR: s.COMPANY_AR, COMPANY_EN: s.COMPANY_EN, TARGET_DAYS: s.TARGET_DAYS,
           DOA: settingJson_('DOA', DEFAULT_DOA), POSITIONS: settingJson_('POSITIONS', []), DEPTS: settingJson_('DEPTS', []),
           BUDGETS: settingJson_('BUDGETS', []), sigDefault: displayDefault_() };
}
function settingsSave_(email, p) {
  const vals = p.settings || {};
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = sheet_(SH_SETTINGS), n = Math.max(sh.getLastRow() - 1, 0);
    const keys = n ? sh.getRange(2, 1, n, 1).getValues().map(function (r) { return String(r[0]); }) : [];
    Object.keys(vals).forEach(function (k) {
      if (!(k in DEFAULT_SETTINGS)) return;
      let v = vals[k];
      if (['POSITIONS', 'DOA', 'DEPTS', 'BUDGETS'].indexOf(k) > -1) { v = typeof v === 'string' ? v : JSON.stringify(v); JSON.parse(v); }
      v = String(v).slice(0, 40000);
      const i = keys.indexOf(k), now = new Date().toISOString();
      if (i > -1) sh.getRange(i + 2, 2, 1, 3).setValues([[v, now, email]]); else { sh.appendRow([k, v, now, email]); keys.push(k); }
    });
    CacheService.getScriptCache().remove('po_settings_v1');
    audit_log_(email, { action: 'settings-save', detail: Object.keys(vals).join(', ') });
    return { ok: true, settings: settingsAll_() };
  } finally { lock.releaseLock(); }
}

/* =============================== Users & delegation =============================== */

function usersList_() {
  const sh = sheet_(SH_ACCESS), n = Math.max(sh.getLastRow() - 1, 0);
  return (n ? sh.getRange(2, 1, n, 6).getValues() : []).filter(function (r) { return String(r[0]).trim(); }).map(function (r) {
    const e = norm_(r[0]), own = isOwner_(e), role = own ? 'admin' : normRole_(r[2]);
    return { email: e, name: String(r[1] || ''), role: role, procurement: role === 'editor' && (isTrue_(r[5]) || /procurement|purchasing/i.test(String(r[2]))),
             active: own || !(r[3] === false || String(r[3]).toUpperCase() === 'FALSE'), notes: String(r[4] || ''), owner: own };
  });
}
function userSave_(email, p) {
  const e = norm_(p.email);
  if (!isAllowed_(e)) throw new Error('البريد يجب أن يكون حسابًا جامعيًا @' + ALLOWED_DOMAIN);
  const role = normRole_(p.role), active = p.active !== false;
  if (isOwner_(e) && (role !== 'admin' || !active)) throw new Error('لا يمكن تغيير صلاحية مالك المنصة أو إيقافه');
  if (e === email && (role !== 'admin' || !active)) throw new Error('لا يمكنك خفض صلاحيتك أو إيقاف حسابك بنفسك');
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = sheet_(SH_ACCESS), n = Math.max(sh.getLastRow() - 1, 0), vals = n ? sh.getRange(2, 1, n, 6).getValues() : [];
    let row = 0; for (let i = 0; i < vals.length; i++) if (norm_(vals[i][0]) === e) { row = i + 2; break; }
    const isNew = !row; if (!row) row = sh.getLastRow() + 1;
    const cur = vals[row - 2] || ['', '', '', '', '', false];
    const proc = role === 'editor' && (p.procurement != null ? !!p.procurement : isTrue_(cur[5]));
    sh.getRange(row, 1, 1, 6).setValues([[e, p.name != null ? clean_(p.name, 120) : cur[1], role, active, p.notes != null ? clean_(p.notes, 300) : cur[4], proc]]);
    CacheService.getScriptCache().remove('po_acl_v2');
    audit_log_(email, { action: isNew ? 'user-add' : 'user-update', detail: e + ' → ' + role + (proc ? ' + procurement' : '') + (active ? '' : ' (موقوف)') });
    return { ok: true, items: usersList_() };
  } finally { lock.releaseLock(); }
}
/* ======================= Access requests (v1.3) =======================
 *  A signed-in @sr.edu.sa account that is not on the access list sees «طلب صلاحية الدخول».
 *  requestAccess() is the ONLY server function callable without access: it records the request
 *  (sheet AccessRequests) and e-mails ACCESS_ADMIN_EMAIL; the admin approves or rejects it in «المستخدمون».
 * ===================================================================== */
function accessRequests_() {
  const sh = sheet_(SH_ACCREQ), n = Math.max(sh.getLastRow() - 1, 0);
  return (n ? sh.getRange(2, 1, n, ACCREQ_HEADERS.length).getDisplayValues() : []).map(function (r) {
    const o = {}; ACCREQ_HEADERS.forEach(function (k, i) { o[k] = r[i]; }); return o;
  }).reverse();
}
function pendingRequestOf_(email) { try { return accessRequests_().filter(function (x) { return norm_(x.email) === norm_(email) && x.status === 'pending'; })[0] || null; } catch (e) { return null; } }
/** Called from the access-request screen (google.script.run.requestAccess). */
function requestAccess(p) {
  p = p || {};
  const email = currentEmail_();
  if (!isAllowed_(email)) throw new Error('الطلب متاح لحسابات الجامعة @' + ALLOWED_DOMAIN + ' فقط');
  if (accessStatus_(email) === 'ok') return { ok: true, already: true };
  const prev = pendingRequestOf_(email);
  if (prev) return { ok: true, pending: true, at: prev.timestamp };
  const name = clean_(p.name, 120), role = ['editor', 'viewer'].indexOf(String(p.role)) > -1 ? String(p.role) : 'viewer', reason = clean_(p.reason, 600);
  if (!name) throw new Error('اكتب اسمك');
  if (reason.length < 5) throw new Error('اكتب سبب طلب الصلاحية');
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const now = new Date(), rid = Utilities.getUuid().slice(0, 8);
    sheet_(SH_ACCREQ).appendRow([rid, now.toISOString(), fmt_(now, 'yyyy-MM-dd'), fmt_(now, 'HH:mm:ss'), email, name, role, reason, 'pending', '', '', '']);
    audit_log_(email, { action: 'access-request', detail: role + ' · ' + reason });
    const url = ScriptApp.getService().getUrl() + '?page=users';
    const html = '<div dir="rtl" style="font-family:Tahoma,Arial;color:#241436;max-width:600px;border:1px solid #e3dcef">' +
      '<div style="background:#501e8c;color:#fff;padding:12px 16px;font-size:16px"><b>' + esc_(APP_NAME) + '</b> · <span dir="ltr">' + APP_SHORT + '</span></div>' +
      '<div style="padding:14px 16px"><h3 style="color:#3a1464;margin:0 0 8px">طلب صلاحية الدخول إلى المنصة</h3><table style="border-collapse:collapse;font-size:13px;width:100%">' +
      [['الاسم', name], ['البريد', email], ['الصلاحية المطلوبة', ROLE_AR[role]], ['السبب', reason], ['التاريخ', fmt_(now, 'yyyy-MM-dd HH:mm')]]
        .map(function (r) { return '<tr><td style="padding:5px;border:1px solid #eee;background:#f7f5fb;width:30%"><b>' + r[0] + '</b></td><td style="padding:5px;border:1px solid #eee">' + esc_(r[1]) + '</td></tr>'; }).join('') +
      '</table><p><a href="' + url + '" style="display:inline-block;background:#501e8c;color:#fff;padding:9px 18px;border-radius:4px;text-decoration:none">مراجعة الطلب في «المستخدمون»</a></p>' +
      '<p style="font-size:12px;color:#6b5a80">الإدارة التنفيذية للاتصالات وتقنية المعلومات — جامعة سليمان الراجحي · مركز العمليات التقنية ITOC</p></div></div>';
    sendMail_([ACCESS_ADMIN_EMAIL], 'طلب صلاحية دخول — ' + name + ' | ' + APP_SHORT, html);
    return { ok: true, sent: true, rid: rid };
  } finally { lock.releaseLock(); }
}
/** Admin: approve (adds the user with the chosen role) or reject an access request; the requester is e-mailed. */
function accessDecide_(email, p) {
  const sh = sheet_(SH_ACCREQ), all = accessRequests_().slice().reverse();
  const i = all.map(function (x) { return x.rid; }).indexOf(String(p.rid)); if (i < 0) throw new Error('الطلب غير موجود');
  const r = all[i]; if (r.status !== 'pending') throw new Error('تمت معالجة هذا الطلب مسبقًا');
  const approve = p.decision === 'approve', role = normRole_(p.role || r.role), note = clean_(p.note, 300);
  if (approve) userSave_(email, { email: r.email, name: r.name, role: role, active: true, procurement: !!p.procurement, notes: 'طلب دخول ' + r.date });
  sh.getRange(i + 2, 9, 1, 4).setValues([[approve ? 'approved' : 'rejected', email, new Date().toISOString(), note]]);
  audit_log_(email, { action: approve ? 'access-approve' : 'access-reject', detail: r.email + (approve ? ' → ' + role : '') + (note ? ' · ' + note : '') });
  const url = ScriptApp.getService().getUrl();
  sendMail_([r.email], (approve ? 'تمت الموافقة على صلاحية الدخول' : 'تعذّرت الموافقة على طلب صلاحية الدخول') + ' | ' + APP_SHORT,
    '<div dir="rtl" style="font-family:Tahoma,Arial;color:#241436"><h3 style="color:#3a1464">' + esc_(APP_NAME) + '</h3>' +
    (approve ? '<p>تمت الموافقة على طلبك بصلاحية <b>' + esc_(ROLE_AR[role === 'editor' && p.procurement ? 'editor_proc' : role]) + '</b>.</p><p><a href="' + url + '">الدخول إلى المنصة</a></p>'
             : '<p>لم تتم الموافقة على طلب صلاحية الدخول.' + (note ? '<br>الملاحظة: ' + esc_(note) : '') + '</p>') + '</div>');
  return { ok: true, items: accessRequests_(), users: usersList_() };
}

function delegations_() {
  const sh = sheet_(SH_DELEG), n = Math.max(sh.getLastRow() - 1, 0);
  return (n ? sh.getRange(2, 1, n, DELEG_HEADERS.length).getDisplayValues() : []).map(function (r) {
    const o = {}; DELEG_HEADERS.forEach(function (k, i) { o[k] = r[i]; }); o.active = String(o.active).toUpperCase() !== 'FALSE'; return o;
  });
}
/** Admin: a temporary, dated delegation of signing authority (recorded in the audit trail). */
function delegationSave_(email, p) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = sheet_(SH_DELEG);
    if (p.did) {
      const all = delegations_(), i = all.map(function (d) { return d.did; }).indexOf(String(p.did));
      if (i < 0) throw new Error('التفويض غير موجود');
      sh.getRange(i + 2, 6).setValue(p.active ? 'TRUE' : 'FALSE');
      audit_log_(email, { action: p.active ? 'delegation-on' : 'delegation-off', detail: all[i].fromEmail + ' → ' + all[i].toEmail });
      return { ok: true, items: delegations_() };
    }
    const from = norm_(p.fromEmail), to = norm_(p.toEmail);
    if (!isAllowed_(from) || !isAllowed_(to)) throw new Error('البريدان يجب أن يكونا حسابين جامعيين');
    if (from === to) throw new Error('لا يمكن التفويض للشخص نفسه');
    const st = String(p.start || '').slice(0, 10), en = String(p.end || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(st) || !/^\d{4}-\d{2}-\d{2}$/.test(en) || en < st) throw new Error('حدّد فترة تفويض صحيحة');
    const did = Utilities.getUuid().slice(0, 8);
    sh.appendRow([did, from, to, st, en, 'TRUE', clean_(p.reason, 200), email, new Date().toISOString()]);
    audit_log_(email, { action: 'delegation-add', detail: from + ' → ' + to + ' (' + st + ' … ' + en + ')' });
    return { ok: true, items: delegations_() };
  } finally { lock.releaseLock(); }
}
/** E-mails this user may act for today: himself + everyone who delegated to him (active, in date). */
function principals_(email) {
  const today = fmt_(new Date(), 'yyyy-MM-dd'), out = [email];
  try { delegations_().forEach(function (d) { if (d.active && norm_(d.toEmail) === email && d.start <= today && d.end >= today) out.push(norm_(d.fromEmail)); }); } catch (e) {}
  return out.filter(function (x, i, a) { return a.indexOf(x) === i; });
}

/* =============================== PO register =============================== */

function blank_() {
  return {
    meta: { id: '', version: '1.0', status: 'draft', serial: '', date: fmt_(new Date(), 'yyyy-MM-dd'), dept: '', budget: '', subject: '',
            supplier: '', supplierContact: '', currency: setting_('CURRENCY') || 'SAR', notes: '', terms: '', requester: '', requesterEmail: '',
            procNote: '', targetDate: '', sigDisplay: '', createdAt: '', createdBy: '', submittedAt: '', routedAt: '', approvedAt: '', rejectedAt: '', prevVersion: '' },
    consumables: [], assets: [], attachments: [], steps: [], history: []
  };
}
function nextId_() {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const y = fmt_(new Date(), 'yyyy'), k = 'PO_SEQ_' + y, props = PropertiesService.getScriptProperties();
    const n = Number(props.getProperty(k) || 0) + 1; props.setProperty(k, String(n));
    return 'PR-' + y + '-' + ('000' + n).slice(-4);
  } finally { lock.releaseLock(); }
}
function readJson_(sh, row, first) {
  const parts = sh.getRange(row, first, 1, JSON_COLS).getValues()[0].join('');
  return parts ? JSON.parse(parts) : null;
}
function chunk_(s) { const a = []; for (let i = 0; i < JSON_COLS; i++) a.push(s.slice(i * CHUNK, (i + 1) * CHUNK)); if (s.length > CHUNK * JSON_COLS) throw new Error('حجم أمر الشراء كبير جدًا'); return a; }
function findRow_(sh, keys) {
  const n = sh.getLastRow() - 1; if (n < 1) return 0;
  const v = sh.getRange(2, 1, n, keys.length).getDisplayValues();
  for (let i = v.length - 1; i >= 0; i--) { let ok = true; for (let j = 0; j < keys.length; j++) if (String(v[i][j]).toUpperCase() !== String(keys[j]).toUpperCase()) { ok = false; break; } if (ok) return i + 2; }
  return 0;
}
function load_(id) {
  const sh = sheet_(SH_PO), row = findRow_(sh, [String(id || '').trim()]);
  if (!row) throw new Error('أمر الشراء غير موجود');
  const d = readJson_(sh, row, PO_HEADERS.length + 1);
  return { d: d, row: row, updatedAt: String(sh.getRange(row, PO_HEADERS.indexOf('updatedAt') + 1).getDisplayValue() || '') };
}
function totals_(d) {
  const t = function (rows) { return (rows || []).reduce(function (s, r) { return s + (Number(r.qty) || 0) * (Number(r.price) || 0); }, 0); };
  const c = round2_(t(d.consumables)), a = round2_(t(d.assets));
  return { cons: c, asset: a, all: round2_(c + a) };
}
function round2_(x) { return Math.round(x * 100) / 100; }
function current_(d) { return (d.steps || []).filter(function (s) { return s.state === 'current'; })[0] || null; }

/** Persists the PO row (index columns + JSON) and, when asked, a snapshot in Versions. */
function persist_(d, email, opt) {
  opt = opt || {};
  const sh = sheet_(SH_PO), now = new Date().toISOString(), m = d.meta, cur = current_(d), t = totals_(d);
  m.statusAr = STATUS_AR[m.status] || m.status;
  const vals = [m.id, m.version, m.status, STATUS_AR[m.status] || '', m.serial, m.dept, m.requester, m.requesterEmail, m.subject, m.supplier,
    t.all, m.currency, cur ? cur.email : '', cur ? (cur.name || cur.title) : '', cur ? (cur.since || '') : '', m.targetDate,
    m.createdAt, m.submittedAt, m.routedAt, m.approvedAt, m.rejectedAt, now, email].map(function (v) { return v == null ? '' : String(v); });
  const json = chunk_(JSON.stringify(d));
  let row = findRow_(sh, [m.id]);
  if (!row) { sh.appendRow(vals.concat(json)); row = sh.getLastRow(); }
  else sh.getRange(row, 1, 1, vals.length + JSON_COLS).setValues([vals.concat(json)]);
  if (opt.snapshot) {
    const vs = sheet_(SH_VER), vrow = findRow_(vs, [m.id, m.version]);
    const vv = [m.id, m.version, m.status, now, email, opt.reason || ''].concat(json);
    if (vrow) vs.getRange(vrow, 1, 1, vv.length).setValues([vv]); else vs.appendRow(vv);
  }
  return now;
}
function hist_(d, email, action, note) {
  (d.history = d.history || []).push({ at: new Date().toISOString(), by: email, action: action, note: note || '', version: d.meta.version });
}

/* ----- visibility ----- */
function canView_(d, email, role) {
  if (perms_(role).viewAll) return true;
  if (norm_(d.meta.createdBy) === email || norm_(d.meta.requesterEmail) === email) return true;
  if (d.meta.status === 'draft') return false;
  const pr = principals_(email);
  return (d.steps || []).some(function (s) { return pr.indexOf(norm_(s.email)) > -1 || (s.sig && norm_(s.sig.by) === email); });
}
function isRequester_(d, email) { return norm_(d.meta.createdBy) === email || norm_(d.meta.requesterEmail) === email; }

function list_(email, role) {
  const sh = sheet_(SH_PO), n = sh.getLastRow() - 1; if (n < 1) return [];
  const rows = sh.getRange(2, 1, n, PO_HEADERS.length + JSON_COLS).getValues();
  const out = [];
  rows.forEach(function (r) {
    let d; try { d = JSON.parse(r.slice(PO_HEADERS.length).join('')); } catch (e) { return; }
    if (!d || !canView_(d, email, role)) return;
    const t = totals_(d), cur = current_(d), pr = principals_(email);
    out.push({
      id: d.meta.id, version: d.meta.version, status: d.meta.status, serial: d.meta.serial, dept: d.meta.dept, subject: d.meta.subject,
      supplier: d.meta.supplier, requester: d.meta.requester, requesterEmail: d.meta.requesterEmail, createdBy: d.meta.createdBy,
      total: t.all, cons: t.cons, asset: t.asset, currency: d.meta.currency, date: d.meta.date,
      createdAt: d.meta.createdAt, submittedAt: d.meta.submittedAt, routedAt: d.meta.routedAt, approvedAt: d.meta.approvedAt, rejectedAt: d.meta.rejectedAt,
      targetDate: d.meta.targetDate, updatedAt: String(r[PO_HEADERS.indexOf('updatedAt')]),
      current: cur ? { email: cur.email, name: cur.name || '', title: cur.title || '', since: cur.since || '', phase: cur.phase } : null,
      mine: !!cur && pr.indexOf(norm_(cur.email)) > -1,
      steps: (d.steps || []).map(function (s) { return { email: s.email, name: s.name, title: s.title, state: s.state, phase: s.phase, at: s.sig ? s.sig.at : (s.rejectedAt || ''), since: s.since || '', kind: s.kind || 'sign' }; })
    });
  });
  return out;
}
function get_(email, role, id, version) {
  let d, updatedAt = '';
  if (version) {
    const vs = sheet_(SH_VER), row = findRow_(vs, [id, version]);
    if (!row) throw new Error('الإصدار غير موجود');
    d = readJson_(vs, row, VER_HEADERS.length + 1);
  } else { const L = load_(id); d = L.d; updatedAt = L.updatedAt; }
  if (!canView_(d, email, role)) return { ok: false, error: 'forbidden', msg: 'لا تملك صلاحية الاطّلاع على هذا الطلب' };
  project_(d);
  return { ok: true, data: d, updatedAt: updatedAt, final: finalInfo_(d.meta.id, d.meta.version), totals: totals_(d), principals: principals_(email), latest: !version };
}
function versions_(email, role, id) {
  const L = load_(id); if (!canView_(L.d, email, role)) return [];
  const vs = sheet_(SH_VER), n = vs.getLastRow() - 1; if (n < 1) return [];
  return vs.getRange(2, 1, n, VER_HEADERS.length).getDisplayValues().filter(function (r) { return r[0] === id; })
    .map(function (r) { return { version: r[1], status: r[2], statusAr: STATUS_AR[r[2]] || r[2], savedAt: r[3], savedBy: r[4], reason: r[5] }; });
}

/* ----- requester: create / edit / submit ----- */
const REQ_FIELDS_ = ['date', 'dept', 'budget', 'subject', 'supplier', 'supplierContact', 'currency', 'notes', 'terms', 'requester', 'requesterEmail'];
function cleanItems_(rows) {
  return (Array.isArray(rows) ? rows : []).slice(0, 200).map(function (r) {
    return { desc: clean_(r.desc, 400), unit: clean_(r.unit, 40), qty: Math.max(0, Number(r.qty) || 0), price: Math.max(0, Number(r.price) || 0) };
  }).filter(function (r) { return r.desc || r.qty || r.price; });
}
function save_(email, role, p) {
  const inp = p.data || {}, im = inp.meta || {};
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    let d, isNew = !im.id;
    if (isNew) {
      d = blank_(); d.meta.id = nextId_(); d.meta.createdAt = new Date().toISOString(); d.meta.createdBy = email;
      d.meta.requester = userInfo_(email).name || ''; d.meta.requesterEmail = email;
    } else {
      const L = load_(im.id); d = L.d;
      if (!isRequester_(d, email) && !perms_(role).admin) throw new Error('يعدّل الطلب صاحبه فقط');
      if (['draft', 'returned'].indexOf(d.meta.status) === -1) throw new Error('لا يمكن تعديل الطلب في حالته الحالية (' + STATUS_AR[d.meta.status] + ')');
      if (p.baseUpdatedAt !== undefined && p.baseUpdatedAt !== L.updatedAt) return { ok: false, conflict: true, error: 'عُدّل الطلب في مكان آخر بعد فتحه — أعد تحميله' };
    }
    REQ_FIELDS_.forEach(function (k) { if (im[k] !== undefined) d.meta[k] = clean_(im[k], k === 'notes' || k === 'terms' ? 3000 : 300); });
    d.meta.requesterEmail = norm_(d.meta.requesterEmail || email);
    d.consumables = cleanItems_(inp.consumables); d.assets = cleanItems_(inp.assets);
    // requesting-department manager (Responsible / يعد) — first signature
    const prevMgr = (d.steps || []).filter(function (s) { return s.phase === 'requester'; })[0] || {};
    const mEmail = p.managerEmail != null ? p.managerEmail : inp.managerEmail, mName = p.managerName != null ? p.managerName : inp.managerName;
    const mgr = norm_(mEmail != null ? mEmail : prevMgr.email), mgrName = clean_(mName != null ? mName : prevMgr.name, 120);
    d.steps = mgr ? [reqStep_(d, mgr, mgrName)] : [];
    hist_(d, email, isNew ? 'create' : 'edit', '');
    const at = persist_(d, email, { snapshot: false });
    audit_log_(email, { action: isNew ? 'create' : 'save', poId: d.meta.id, version: d.meta.version, detail: d.meta.subject });
    return { ok: true, data: d, updatedAt: at, totals: totals_(d) };
  } finally { lock.releaseLock(); }
}
function reqStep_(d, email, name) {
  const slots = []; if ((d.consumables || []).length) slots.push('cons.R'); if ((d.assets || []).length) slots.push('asset.R');
  return { key: 'req-1', phase: 'requester', kind: 'sign', email: email, name: name || '', title: 'المدير المعني — مدير إدارة الجهة الطالبة', raci: 'R', slots: slots.length ? slots : ['cons.R'], state: 'pending' };
}
function submit_(email, role, p) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const L = load_(p.id), d = L.d;
    if (!isRequester_(d, email) && !perms_(role).admin) throw new Error('يُرسل الطلب صاحبه فقط');
    if (['draft', 'returned'].indexOf(d.meta.status) === -1) throw new Error('الطلب ليس مسودة');
    const errs = validate_(d); if (errs.length) return { ok: false, error: errs.join(' · ') };
    if (p.baseUpdatedAt !== undefined && p.baseUpdatedAt !== L.updatedAt) return { ok: false, conflict: true, error: 'عُدّل الطلب بعد فتحه — أعد تحميله' };
    d.steps = [reqStep_(d, d.steps[0].email, d.steps[0].name)];
    d.steps[0].state = 'current'; d.steps[0].since = new Date().toISOString();
    d.meta.status = 'req_sign';
    hist_(d, email, 'submit', 'أُرسل لتوقيع ' + d.steps[0].email);
    const at = persist_(d, email, { snapshot: true, reason: 'submitted' });
    audit_log_(email, { action: 'submit', poId: d.meta.id, version: d.meta.version, detail: 'to ' + d.steps[0].email });
    notifyStep_(d, d.steps[0], 'request');
    return { ok: true, data: d, updatedAt: at };
  } finally { lock.releaseLock(); }
}
function validate_(d) {
  const e = [], m = d.meta;
  if (!m.dept) e.push('حدّد الجهة الطالبة');
  if (!m.subject) e.push('أدخل موضوع الطلب');
  if (!(d.consumables.length || d.assets.length)) e.push('أضف صنفًا واحدًا على الأقل');
  d.consumables.concat(d.assets).forEach(function (r, i) { if (!r.desc || !(r.qty > 0)) e.push('الصنف ' + (i + 1) + ': البيان والكمية مطلوبان'); });
  if (!d.steps.length || !isAllowed_(d.steps[0].email)) e.push('أدخل البريد الجامعي لمدير إدارة الجهة الطالبة (الموقّع الأول)');
  return e;
}
function cancel_(email, role, p) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const L = load_(p.id), d = L.d, st = d.meta.status, P = perms_(role);
    const mine = isRequester_(d, email) && ['draft', 'returned', 'req_sign'].indexOf(st) > -1;
    if (!(mine || (P.procurement && ['approved', 'cancelled'].indexOf(st) === -1))) throw new Error('لا يمكنك إلغاء هذا الطلب');
    const reason = clean_(p.reason, 500); if (!reason) throw new Error('سبب الإلغاء مطلوب');
    (d.steps || []).forEach(function (s) { if (s.state === 'current') s.state = 'pending'; });
    d.meta.status = 'cancelled'; hist_(d, email, 'cancel', reason);
    const at = persist_(d, email, { snapshot: true, reason: 'cancelled' });
    audit_log_(email, { action: 'cancel', poId: d.meta.id, version: d.meta.version, detail: reason });
    notify_([d.meta.requesterEmail], d, 'cancel', 'أُلغي طلب الشراء ' + d.meta.id, 'سبب الإلغاء: ' + reason);
    return { ok: true, data: d, updatedAt: at };
  } finally { lock.releaseLock(); }
}

/* ----- procurement: return / route / edit route ----- */
function return_(email, role, p) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const L = load_(p.id), d = L.d;
    if (d.meta.status !== 'proc_review') throw new Error('الإعادة متاحة أثناء مراجعة المشتريات فقط');
    const note = clean_(p.note, 1500); if (!note) throw new Error('اكتب المطلوب استكماله');
    persist_(d, email, { snapshot: true, reason: 'returned' });             // keep the signed copy in the history
    clearSigs_(d);
    d.meta.prevVersion = d.meta.version; d.meta.version = bumpVersion_(d.meta.version);
    d.meta.status = 'returned'; d.meta.returnNote = note;
    d.steps = d.steps.filter(function (s) { return s.phase === 'requester'; }).map(function (s) { s.state = 'pending'; delete s.since; return s; });
    hist_(d, email, 'return', note);
    const at = persist_(d, email, { snapshot: false });
    audit_log_(email, { action: 'return', poId: d.meta.id, version: d.meta.version, detail: note });
    notify_([d.meta.requesterEmail, d.meta.createdBy], d, 'return', 'أُعيد طلب الشراء ' + d.meta.id + ' لاستكمال البيانات', note);
    return { ok: true, data: d, updatedAt: at };
  } finally { lock.releaseLock(); }
}
function cleanSteps_(d, steps) {
  const okSlots = ['cons.C', 'cons.A', 'cons.I', 'asset.C', 'asset.A', 'asset.I'];
  const out = (Array.isArray(steps) ? steps : []).slice(0, 25).map(function (s, i) {
    const kind = s.kind === 'inform' ? 'inform' : 'sign';
    const slots = (Array.isArray(s.slots) ? s.slots : []).filter(function (x) { return okSlots.indexOf(x) > -1; });
    const e = norm_(s.email);
    if (!isAllowed_(e)) throw new Error('الخطوة ' + (i + 1) + ': بريد جامعي غير صالح');
    if (kind === 'sign' && !slots.length) throw new Error('الخطوة ' + (i + 1) + ': حدّد موضع التوقيع في المستند');
    return { key: 'c-' + Utilities.getUuid().slice(0, 6), phase: 'chain', kind: kind, email: e, name: clean_(s.name, 120), title: clean_(s.title, 160),
             raci: slots.length ? slots[0].split('.')[1] : 'I', slots: slots, state: 'pending' };
  });
  if (!out.filter(function (s) { return s.kind === 'sign'; }).length) throw new Error('أضف موقّعًا واحدًا على الأقل');
  const need = []; if (d.consumables.length) need.push('cons.A'); if (d.assets.length) need.push('asset.A');
  need.forEach(function (k) { if (!out.some(function (s) { return s.slots.indexOf(k) > -1; })) throw new Error('حدّد صاحب الاعتماد (يعتمد) في جدول ' + (k === 'cons.A' ? 'المستهلكات أو الخدمات' : 'الأصول')); });
  return out;
}
function route_(email, role, p) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const L = load_(p.id), d = L.d;
    if (d.meta.status !== 'proc_review') throw new Error('تحديد المسار متاح أثناء مراجعة المشتريات فقط');
    if (p.baseUpdatedAt !== undefined && p.baseUpdatedAt !== L.updatedAt) return { ok: false, conflict: true, error: 'عُدّل الطلب بعد فتحه — أعد تحميله' };
    const serial = clean_(p.serial, 60); if (!serial) throw new Error('أدخل الرقم التسلسلي (Serial Number)');
    d.meta.serial = serial; d.meta.procNote = clean_(p.procNote, 2000);
    d.meta.targetDate = /^\d{4}-\d{2}-\d{2}$/.test(String(p.targetDate || '')) ? String(p.targetDate) : '';
    const chain = cleanSteps_(d, p.steps);
    d.steps = d.steps.filter(function (s) { return s.phase === 'requester'; }).concat(chain);
    d.meta.fullHash = fullHash_(d);
    hist_(d, email, 'route', chain.map(function (s) { return (s.kind === 'inform' ? '(يعلم) ' : '') + (s.name || s.email); }).join(' ← '));
    audit_log_(email, { action: 'route', poId: d.meta.id, version: d.meta.version, detail: chain.length + ' steps' });
    if (p.start) {
      const first = nextSignStep_(d);
      first.state = 'current'; first.since = new Date().toISOString();
      d.meta.status = 'signing'; d.meta.routedAt = new Date().toISOString();
      hist_(d, email, 'start', 'بدء دورة التوقيعات — ' + (first.name || first.email));
      audit_log_(email, { action: 'start', poId: d.meta.id, version: d.meta.version, step: first.key, detail: first.email });
    }
    const at = persist_(d, email, { snapshot: !!p.start, reason: p.start ? 'routed' : '' });
    if (p.start) notifyStep_(d, current_(d), 'request');
    return { ok: true, data: d, updatedAt: at };
  } finally { lock.releaseLock(); }
}
/** Procurement may add / remove / re-order steps that have not been reached yet (logged). */
function editSteps_(email, role, p) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const L = load_(p.id), d = L.d;
    if (d.meta.status !== 'signing') throw new Error('تعديل المسار بعد البدء متاح أثناء دورة التوقيعات فقط');
    const reason = clean_(p.reason, 500); if (!reason) throw new Error('سبب تعديل المسار مطلوب');
    const done = d.steps.filter(function (s) { return s.phase === 'requester' || s.state === 'signed' || s.state === 'current'; });
    const rest = cleanSteps_({ consumables: [], assets: [] }, p.steps);
    const before = d.steps.map(function (s) { return s.email; }).join(',');
    d.steps = done.concat(rest);
    const need = []; if (d.consumables.length) need.push('cons.A'); if (d.assets.length) need.push('asset.A');
    need.forEach(function (k) { if (!d.steps.some(function (s) { return s.slots.indexOf(k) > -1; })) throw new Error('يجب أن يبقى صاحب الاعتماد (يعتمد) في المسار'); });
    hist_(d, email, 'route-edit', reason);
    audit_log_(email, { action: 'route-edit', poId: d.meta.id, version: d.meta.version, detail: reason + ' | before: ' + before + ' | after: ' + d.steps.map(function (s) { return s.email; }).join(',') });
    const at = persist_(d, email, {});
    return { ok: true, data: d, updatedAt: at };
  } finally { lock.releaseLock(); }
}
function nextSignStep_(d) { return (d.steps || []).filter(function (s) { return s.phase === 'chain' && s.kind === 'sign' && s.state === 'pending'; })[0] || null; }

/* ----- hashes (signatures bind to content, not to who signs next) ----- */
function canon_(v) {
  if (Array.isArray(v)) return '[' + v.map(canon_).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canon_(v[k]); }).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
/** What the requesting manager signs: the request itself (fields, items, attachment fingerprints). */
function contentHash_(d) {
  const m = {}; ['id', 'version'].concat(REQ_FIELDS_).forEach(function (k) { m[k] = d.meta[k] == null ? '' : String(d.meta[k]); });
  return sha_(canon_({ meta: m, consumables: d.consumables || [], assets: d.assets || [],
    attachments: (d.attachments || []).map(function (a) { return { name: a.name, sha: a.sha }; }) }));
}
/** What the approval chain signs: the request + procurement's serial number and direction. */
function fullHash_(d) { return sha_(canon_({ content: contentHash_(d), serial: d.meta.serial || '', procNote: d.meta.procNote || '' })); }
function stepHash_(d, s) { return s.phase === 'requester' ? contentHash_(d) : fullHash_(d); }

/* ----- signing ----- */
function actorFor_(email, s) {
  const pr = principals_(email), e = norm_(s.email);
  if (e === email) return { ok: true, onBehalf: '' };
  if (pr.indexOf(e) > -1) return { ok: true, onBehalf: e };
  return { ok: false };
}
function signStep_(email, role, p) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const L = load_(p.id), d = L.d;
    if (p.baseUpdatedAt !== undefined && p.baseUpdatedAt !== L.updatedAt) return { ok: false, conflict: true, error: 'تغيّرت حالة الطلب بعد فتحه — أعد تحميله ثم وقّع' };
    if (['req_sign', 'signing'].indexOf(d.meta.status) === -1) throw new Error('الطلب ليس في مرحلة توقيع (' + STATUS_AR[d.meta.status] + ')');
    const s = (d.steps || []).filter(function (x) { return x.key === p.step; })[0];
    if (!s) throw new Error('خطوة التوقيع غير موجودة');
    if (s.state !== 'current') throw new Error(s.state === 'signed' ? 'هذه الخطوة موقّعة مسبقًا' : 'ليس دور هذه الخطوة في التسلسل');
    const who = actorFor_(email, s);
    if (!who.ok) throw new Error('هذه الخطوة مخصّصة لتوقيع ' + s.email);
    const sg = mySigRow_(email, p.signerId);
    const img = sigImg_(p.img), blur = sigImg_(p.blur);
    const v = verifySig_(sg, p.tag);
    const h = stepHash_(d, s);
    audit_log_(email, { action: 'sign', poId: d.meta.id, version: d.meta.version, step: s.key, detail: (who.onBehalf ? 'on behalf of ' + who.onBehalf + ' · ' : '') + sg.name + ' · ' + h.slice(0, 16), result: v.ok ? 'success' : (v.locked ? 'locked' : 'failed') });
    if (!v.ok) return v;
    s.sig = { signerId: sg.id, signerName: String(sg.name || ''), position: String(sg.position || ''), by: email, onBehalfOf: who.onBehalf, at: new Date().toISOString(), docHash: h, scope: s.phase === 'requester' ? 'content' : 'full' };
    s.state = 'signed';
    if (!d.meta.sigDisplay) d.meta.sigDisplay = displayDefault_();
    if (img) vaultPut_(d.meta.id, d.meta.version, s.key, sg.id, img, blur);
    hist_(d, email, 'sign', (s.title || '') + ' — ' + sg.name + (who.onBehalf ? ' (بالنيابة عن ' + who.onBehalf + ')' : ''));
    let all = false, next = null;
    if (s.phase === 'requester') {
      d.meta.status = 'proc_review'; d.meta.submittedAt = new Date().toISOString(); d.meta.contentHash = h;
      hist_(d, 'system', 'to-procurement', 'أُحيل إلى إدارة المشتريات');
    } else {
      next = nextSignStep_(d);
      if (next) { next.state = 'current'; next.since = new Date().toISOString(); }
      else { all = true; d.meta.status = 'approved'; d.meta.approvedAt = new Date().toISOString(); hist_(d, 'system', 'approved', 'اكتملت جميع التوقيعات'); }
    }
    project_(d);
    const at = persist_(d, email, { snapshot: s.phase === 'requester' || all, reason: s.phase === 'requester' ? 'requester-signed' : (all ? 'approved' : '') });
    // notifications
    if (s.phase === 'requester') {
      notify_(procEmails_(), d, 'submitted', 'طلب شراء جديد للمراجعة: ' + d.meta.id, (d.meta.dept || '') + ' — ' + (d.meta.subject || ''));
      notify_([d.meta.requesterEmail], d, 'submitted', 'أُحيل طلبك ' + d.meta.id + ' إلى إدارة المشتريات', 'وُقّع من ' + sg.name);
    } else {
      notify_([d.meta.requesterEmail].concat(procEmails_()), d, 'step-signed', 'وُقّع طلب الشراء ' + d.meta.id + ' — ' + (s.title || s.name || ''), sg.name, true);
      if (next) notifyStep_(d, next, 'request');
    }
    return { ok: true, data: d, updatedAt: at, allSigned: all, docHash: h, phase: s.phase };
  } finally { lock.releaseLock(); }
}
function rejectStep_(email, role, p) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const L = load_(p.id), d = L.d;
    if (['req_sign', 'signing'].indexOf(d.meta.status) === -1) throw new Error('لا يمكن الرفض في هذه الحالة');
    const s = (d.steps || []).filter(function (x) { return x.key === p.step; })[0];
    if (!s || s.state !== 'current') throw new Error('ليس دور هذه الخطوة');
    const who = actorFor_(email, s); if (!who.ok) throw new Error('هذه الخطوة مخصّصة لـ ' + s.email);
    const reason = clean_(p.reason, 1500); if (reason.length < 3) throw new Error('سبب الرفض إلزامي');
    s.state = 'rejected'; s.rejectedAt = new Date().toISOString(); s.rejectedBy = email; s.reason = reason; s.onBehalfOf = who.onBehalf;
    d.meta.status = 'rejected'; d.meta.rejectedAt = s.rejectedAt;
    hist_(d, email, 'reject', (s.title || s.name || '') + ' — ' + reason);
    const at = persist_(d, email, { snapshot: true, reason: 'rejected' });
    audit_log_(email, { action: 'reject', poId: d.meta.id, version: d.meta.version, step: s.key, detail: reason });
    notify_(procEmails_().concat([d.meta.requesterEmail]), d, 'rejected', '⛔ رُفض طلب الشراء ' + d.meta.id,
      'رفضه: ' + (s.name || email) + ' (' + (s.title || '') + ')\nسبب الرفض: ' + reason);
    return { ok: true, data: d, updatedAt: at };
  } finally { lock.releaseLock(); }
}
/** The signer withdraws his signature while the next step has not acted yet (PIN verified). */
function unsignStep_(email, role, p) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const L = load_(p.id), d = L.d, i = (d.steps || []).map(function (x) { return x.key; }).indexOf(p.step), s = d.steps[i];
    if (!s || s.state !== 'signed') throw new Error('هذه الخطوة غير موقّعة');
    if (norm_(s.sig.by) !== email) throw new Error('يزيل التوقيع صاحبه فقط');
    if (isFinal_(d.meta.id, d.meta.version)) throw new Error('صدرت النسخة النهائية — لا يمكن إزالة التوقيع');
    const later = d.steps.slice(i + 1).filter(function (x) { return x.kind === 'sign'; });
    if (later.some(function (x) { return x.state === 'signed' || x.state === 'rejected'; }) || (s.phase === 'requester' && d.meta.status !== 'proc_review'))
      throw new Error('لا يمكن الإزالة بعد أن اتخذت الخطوة التالية إجراءً');
    const sg = mySigRow_(email, s.sig.signerId), v = verifySig_(sg, p.tag);
    audit_log_(email, { action: 'unsign', poId: d.meta.id, version: d.meta.version, step: s.key, result: v.ok ? 'success' : 'failed' });
    if (!v.ok) return v;
    later.forEach(function (x) { if (x.state === 'current') { x.state = 'pending'; delete x.since; } });
    delete s.sig; s.state = 'current'; s.since = new Date().toISOString();
    try { vaultDel_(d.meta.id, d.meta.version, s.key); } catch (e) {}
    d.meta.status = s.phase === 'requester' ? 'req_sign' : 'signing'; d.meta.approvedAt = '';
    hist_(d, email, 'unsign', s.title || '');
    const at = persist_(d, email, {});
    return { ok: true, data: d, updatedAt: at };
  } finally { lock.releaseLock(); }
}
/** After rejection (or cancellation by mistake): a new version for editing, previous versions stay in Versions. */
function revise_(email, role, p) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const L = load_(p.id), d = L.d;
    if (d.meta.status !== 'rejected') throw new Error('إنشاء نسخة جديدة متاح بعد الرفض فقط');
    if (!isRequester_(d, email) && !perms_(role).procurement) throw new Error('غير مصرح');
    const from = d.meta.version, why = (d.steps.filter(function (s) { return s.state === 'rejected'; })[0] || {}).reason || '';
    clearSigs_(d);
    d.meta.prevVersion = from; d.meta.version = bumpVersion_(from); d.meta.status = 'draft';
    d.meta.serial = d.meta.serial; d.meta.submittedAt = d.meta.routedAt = d.meta.approvedAt = d.meta.rejectedAt = '';
    d.steps = d.steps.filter(function (s) { return s.phase === 'requester'; }).map(function (s) { s.state = 'pending'; delete s.since; delete s.reason; delete s.rejectedAt; return s; });
    hist_(d, email, 'revise', 'نسخة جديدة ' + d.meta.version + ' بعد رفض الإصدار ' + from + (why ? ' — ' + why : ''));
    const at = persist_(d, email, { snapshot: false });
    audit_log_(email, { action: 'revise', poId: d.meta.id, version: d.meta.version, detail: 'from ' + from });
    return { ok: true, data: d, updatedAt: at };
  } finally { lock.releaseLock(); }
}
function clearSigs_(d) {
  (d.steps || []).forEach(function (s) { if (s.sig) { try { vaultDel_(d.meta.id, d.meta.version, s.key); } catch (e) {} delete s.sig; } });
  d.meta.sigDisplay = ''; delete d.meta.fullHash; delete d.meta.contentHash;
}
function bumpVersion_(v) { const m = /^(\d+)\.(\d)$/.exec(String(v || '').trim()); if (!m) return '1.1'; return m[2] === '9' ? (Number(m[1]) + 1) + '.0' : m[1] + '.' + (Number(m[2]) + 1); }

/* ----- attachments (private Drive folder per PO) ----- */
function attFolder_() { return folderProp_('PO_ATT_FOLDER_ID', 'POFlow-Attachments'); }
function upload_(email, role, p) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const L = load_(p.id), d = L.d;
    if (!isRequester_(d, email) && !perms_(role).procurement) throw new Error('غير مصرح');
    const editable = ['draft', 'returned'].indexOf(d.meta.status) > -1 || (perms_(role).procurement && d.meta.status === 'proc_review' && p.procurement);
    if (!editable) throw new Error('المرفقات مقفلة بعد إرسال الطلب للتوقيع');
    if ((d.attachments || []).length >= MAX_ATTS) throw new Error('الحد الأقصى ' + MAX_ATTS + ' مرفقًا');
    if (!isB64_(p.b64, Math.ceil(MAX_ATT_BYTES * 4 / 3) + 8)) throw new Error('الملف غير صالح أو أكبر من 10MB');
    const mime = /^(application\/pdf|image\/(png|jpeg|webp)|application\/vnd\.openxmlformats-officedocument\.[a-z.]+|application\/msword|application\/vnd\.ms-excel|text\/plain)$/.test(String(p.mime)) ? String(p.mime) : 'application/octet-stream';
    const bytes = Utilities.base64Decode(p.b64), sha = hexDigest_(bytes);
    const name = clean_(p.name, 160).replace(/[\\/:*?"<>|]/g, '_') || 'file';
    const f = DriveApp.getFolderById(attFolder_()).createFile(Utilities.newBlob(bytes, mime, d.meta.id + '__' + name));
    const att = { id: f.getId(), name: name, mime: mime, size: bytes.length, sha: sha, by: email, at: new Date().toISOString(), kind: clean_(p.kind, 40) || 'supporting', procurement: !!p.procurement };
    (d.attachments = d.attachments || []).push(att);
    hist_(d, email, 'attach', name);
    if (d.meta.status === 'proc_review') d.meta.fullHash = fullHash_(d);
    const at = persist_(d, email, {});
    audit_log_(email, { action: 'attach', poId: d.meta.id, version: d.meta.version, detail: name + ' · ' + sha.slice(0, 16) });
    return { ok: true, data: d, updatedAt: at };
  } finally { lock.releaseLock(); }
}
function removeAtt_(email, role, p) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const L = load_(p.id), d = L.d;
    if (['draft', 'returned'].indexOf(d.meta.status) === -1 || (!isRequester_(d, email) && !perms_(role).admin)) throw new Error('لا يمكن حذف المرفق الآن');
    const i = (d.attachments || []).map(function (a) { return a.id; }).indexOf(p.attId); if (i < 0) throw new Error('المرفق غير موجود');
    const a = d.attachments.splice(i, 1)[0];
    try { DriveApp.getFileById(a.id).setTrashed(true); } catch (e) {}
    hist_(d, email, 'detach', a.name);
    const at = persist_(d, email, {});
    audit_log_(email, { action: 'detach', poId: d.meta.id, version: d.meta.version, detail: a.name });
    return { ok: true, data: d, updatedAt: at };
  } finally { lock.releaseLock(); }
}
function attachment_(email, role, p) {
  const L = load_(p.id); if (!canView_(L.d, email, role)) return { ok: false, error: 'forbidden' };
  const a = (L.d.attachments || []).filter(function (x) { return x.id === p.attId; })[0]; if (!a) throw new Error('المرفق غير موجود');
  const b = DriveApp.getFileById(a.id).getBlob();
  audit_log_(email, { action: 'att-open', poId: L.d.meta.id, version: L.d.meta.version, detail: a.name });
  return { ok: true, name: a.name, mime: a.mime, b64: Utilities.base64Encode(b.getBytes()) };
}

/* =============================== Notifications =============================== */

function procEmails_() {
  const s = String(setting_('PROC_EMAILS') || '').split(/[,;\s]+/).map(norm_).filter(isAllowed_);
  usersList_().forEach(function (u) { if (u.active && u.procurement) s.push(u.email); });
  return s.filter(function (x, i, a) { return a.indexOf(x) === i; });
}
function poUrl_(id) { return ScriptApp.getService().getUrl() + '?po=' + encodeURIComponent(id); }
function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function mailHtml_(title, d, body, cta) {
  const t = totals_(d);
  return '<div dir="rtl" style="font-family:Tahoma,Arial;color:#241436;max-width:640px;border:1px solid #e3dcef">' +
    '<div style="background:#501e8c;color:#fff;padding:12px 16px;font-size:16px"><b>' + esc_(APP_NAME) + '</b> · <span dir="ltr">' + APP_SHORT + '</span></div>' +
    '<div style="padding:14px 16px"><h3 style="color:#3a1464;margin:0 0 8px">' + esc_(title) + '</h3>' +
    '<table style="border-collapse:collapse;font-size:13px;width:100%">' +
    [['رقم الطلب', d.meta.id + (d.meta.serial ? ' · ' + d.meta.serial : '') + ' · الإصدار ' + d.meta.version], ['الجهة الطالبة', d.meta.dept], ['الموضوع', d.meta.subject],
     ['الإجمالي التقديري', t.all.toLocaleString('en-US') + ' ' + d.meta.currency], ['الحالة', STATUS_AR[d.meta.status]]]
      .map(function (r) { return '<tr><td style="padding:5px;border:1px solid #eee;background:#f7f5fb;width:32%"><b>' + r[0] + '</b></td><td style="padding:5px;border:1px solid #eee">' + esc_(r[1]) + '</td></tr>'; }).join('') +
    '</table>' + (body ? '<p style="white-space:pre-line">' + esc_(body) + '</p>' : '') +
    '<p><a href="' + poUrl_(d.meta.id) + '" style="display:inline-block;background:#501e8c;color:#fff;padding:9px 18px;border-radius:4px;text-decoration:none">' + (cta || 'فتح الطلب في المنصة') + '</a></p>' +
    '<p style="font-size:12px;color:#6b5a80">الإدارة التنفيذية للاتصالات وتقنية المعلومات — جامعة سليمان الراجحي · مركز العمليات التقنية ITOC</p></div></div>';
}
/** In-app notification for each recipient + e-mail (unless quiet). */
function notify_(to, d, type, title, body, quiet, attachments) {
  to = (to || []).map(norm_).filter(isAllowed_).filter(function (x, i, a) { return a.indexOf(x) === i; });
  if (!to.length) return 0;
  const sh = sheet_(SH_NOTIFY), now = new Date().toISOString();
  to.forEach(function (e) { sh.appendRow([Utilities.getUuid().slice(0, 10), now, e, d.meta.id, type, title, 'FALSE']); });
  if (quiet) return to.length;
  sendMail_(to, title + ' | ' + APP_SHORT, mailHtml_(title, d, body, type === 'request' ? 'فتح الطلب للتوقيع' : ''), attachments);
  return to.length;
}
function notifyStep_(d, s, type) {
  if (!s) return;
  const pr = [s.email].concat(delegatesOf_(s.email));
  s.notifiedAt = new Date().toISOString();
  notify_(pr, d, type, (type === 'reminder' ? '⏰ تذكير: ' : '✍️ ') + 'طلب توقيع على أمر الشراء ' + d.meta.id,
    'المطلوب منك: ' + (s.title || 'التوقيع') + (s.phase === 'requester' ? ' (توقيع الجهة الطالبة)' : '') +
    (d.meta.targetDate ? '\nالموعد المستهدف لاستكمال الاعتماد: ' + d.meta.targetDate : ''));
}
function delegatesOf_(email) {
  const today = fmt_(new Date(), 'yyyy-MM-dd');
  try { return delegations_().filter(function (x) { return x.active && norm_(x.fromEmail) === norm_(email) && x.start <= today && x.end >= today; }).map(function (x) { return norm_(x.toEmail); }); }
  catch (e) { return []; }
}
function sendMail_(to, subject, html, attachments) {
  try {
    const from = norm_(setting_('MAIL_FROM'));
    let aliases = []; try { aliases = GmailApp.getAliases().map(norm_); } catch (e) {}
    const o = { htmlBody: html, name: APP_NAME + ' — ITOC' }; if (attachments) o.attachments = attachments;
    if (from && aliases.indexOf(from) > -1) { o.from = from; GmailApp.sendEmail(to.join(','), subject, '', o); }
    else MailApp.sendEmail(Object.assign({ to: to.join(','), subject: subject }, o));
  } catch (e) { console.error('mail failed: ' + e); }
}
function notifications_(email) {
  const sh = sheet_(SH_NOTIFY), n = sh.getLastRow() - 1; if (n < 1) return [];
  const from = Math.max(2, sh.getLastRow() - 1500);
  return sh.getRange(from, 1, sh.getLastRow() - from + 1, NOTIFY_HEADERS.length).getDisplayValues()
    .map(function (r, i) { return { nid: r[0], at: r[1], to: r[2], poId: r[3], type: r[4], title: r[5], read: String(r[6]).toUpperCase() === 'TRUE', _row: from + i }; })
    .filter(function (x) { return norm_(x.to) === email; }).reverse().slice(0, 60);
}
function markRead_(email, p) {
  const sh = sheet_(SH_NOTIFY), list = notifications_(email);
  list.forEach(function (x) { if (!x.read && (p.all || (p.ids || []).indexOf(x.nid) > -1)) sh.getRange(x._row, 7).setValue('TRUE'); });
  return { ok: true };
}
/** Time-driven (hourly): reminds the current signer after REMIND_HOURS, escalates after ESCALATE_DAYS or past the target date. */
function remindPending() {
  setup_();
  const H = Number(setting_('REMIND_HOURS')) || 24, D = Number(setting_('ESCALATE_DAYS')) || 3, esc = norm_(setting_('ESCALATE_EMAIL'));
  const sh = sheet_(SH_PO), n = sh.getLastRow() - 1; if (n < 1) return 0;
  const now = Date.now(), today = fmt_(new Date(), 'yyyy-MM-dd');
  let sent = 0;
  for (let i = 0; i < n; i++) {
    const row = i + 2, d = readJson_(sh, row, PO_HEADERS.length + 1);
    if (!d || ['req_sign', 'signing'].indexOf(d.meta.status) === -1) continue;
    const s = current_(d); if (!s) continue;
    let changed = false;
    const since = Date.parse(s.since || '') || now, last = Date.parse(s.notifiedAt || s.since || '') || now;
    if (now - last >= H * 36e5) { notifyStep_(d, s, 'reminder'); sent++; changed = true; }
    const late = (now - since >= D * 864e5) || (d.meta.targetDate && d.meta.targetDate < today);
    if (late && esc && s.escalatedOn !== today) {
      notify_([esc].concat(procEmails_()), d, 'escalation', '🚩 تصعيد: تأخر توقيع أمر الشراء ' + d.meta.id,
        'الخطوة الحالية: ' + (s.title || '') + ' — ' + (s.name || s.email) + '\nبانتظار منذ: ' + fmt_(new Date(since), 'yyyy-MM-dd HH:mm') + (d.meta.targetDate ? '\nالموعد المستهدف: ' + d.meta.targetDate : ''));
      s.escalatedOn = today; sent++; changed = true;
      audit_log_('system', { action: 'escalate', poId: d.meta.id, version: d.meta.version, step: s.key, detail: esc });
    }
    if (changed) { const json = chunk_(JSON.stringify(d)); sh.getRange(row, PO_HEADERS.length + 1, 1, JSON_COLS).setValues([json]); }
  }
  return sent;
}

/* =============================== Audit trail =============================== */

function audit_log_(email, o) {
  try {
    const d = new Date(), sh = sheet_(SH_AUDIT);
    sh.appendRow(AUDIT_HEADERS.map(function (k) {
      if (k === 'timestamp') return d.toISOString();
      if (k === 'date') return fmt_(d, 'yyyy-MM-dd');
      if (k === 'time') return fmt_(d, 'HH:mm:ss');
      if (k === 'email') return email;
      const v = o[k] == null ? '' : String(o[k]);
      return /^[=+\-@]/.test(v) ? "'" + v : v;
    }));
  } catch (e) { console.error('audit failed: ' + e); }
}
function audit_(p) {
  const sh = sheet_(SH_AUDIT), n = sh.getLastRow() - 1; if (n < 1) return [];
  const from = Math.max(2, sh.getLastRow() - 3000);
  let rows = sh.getRange(from, 1, sh.getLastRow() - from + 1, AUDIT_HEADERS.length).getDisplayValues().map(function (r) {
    const o = {}; AUDIT_HEADERS.forEach(function (k, i) { o[k] = r[i]; }); return o;
  });
  if (p.poId) rows = rows.filter(function (r) { return r.poId === p.poId; });
  if (p.q) { const q = String(p.q).toLowerCase(); rows = rows.filter(function (r) { return JSON.stringify(r).toLowerCase().indexOf(q) > -1; }); }
  return rows.reverse().slice(0, 800);
}

/* ======================= E-signature register (policy-platform model) =======================
 *  Signature register = this platform's own «Signers» sheet + encrypted files in a private Drive folder.
 *  Encryption / decryption happen ONLY in the browser (Web Crypto, AES-256-GCM, PBKDF2 key from the PIN).
 *  The script never receives a PIN or a clear image of the register; it verifies SHA-256(tag + pepper).
 * ============================================================================================ */
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function folderProp_(key, name) {
  let id = prop_(key);
  if (id) { try { DriveApp.getFolderById(id); return id; } catch (e) {} }
  id = (ROOT_FOLDER_ID ? DriveApp.getFolderById(ROOT_FOLDER_ID).createFolder(name) : DriveApp.createFolder(name)).getId();
  PropertiesService.getScriptProperties().setProperty(key, id); return id;
}
function pepper_() {
  let p = prop_('SIG_PEPPER');
  if (!p) { p = Utilities.getUuid() + Utilities.getUuid(); PropertiesService.getScriptProperties().setProperty('SIG_PEPPER', p); }
  return p;
}
function hashTag_(tag) { return sha_(tag + '|' + pepper_()); }
function sigFolder_() { return folderProp_('SIG_FOLDER_ID', 'POFlow-Signatures-Encrypted'); }
function finalFolder_() { return folderProp_('PO_FINAL_FOLDER_ID', 'POFlow-Approved-PDFs'); }
function imgFolder_() { return DriveApp.getFolderById(folderProp_('SIG_IMG_FOLDER_ID', 'POFlow-Signature-Images')); }

function sigRows_() {
  const sh = sheet_(SH_SIGNERS); if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, SIGNERS_HEADERS.length).getValues().map(function (r, i) {
    const o = { _row: i + 2 }; SIGNERS_HEADERS.forEach(function (k, j) { o[k] = r[j]; }); return o;
  });
}
function sigUpdate_(row, o) {
  const rg = sheet_(SH_SIGNERS).getRange(row, 1, 1, SIGNERS_HEADERS.length), cur = rg.getValues()[0];
  SIGNERS_HEADERS.forEach(function (k, j) { if (k in o) cur[j] = String(o[k]); }); rg.setValues([cur]);
}
function sigRow_(id) { const r = sigRows_().filter(function (x) { return x.id === id && x.status === 'active'; })[0]; if (!r) throw new Error('التوقيع غير موجود'); return r; }
function mySigRow_(email, id) { const r = sigRow_(id); if (norm_(r.ownerEmail) !== email) throw new Error('هذا التوقيع ليس مسجّلًا باسم حسابك'); return r; }
function mySigs_(email) {
  const now = Date.now();
  return sigRows_().filter(function (r) { return r.status === 'active' && norm_(r.ownerEmail) === email; }).map(function (r) {
    return { id: r.id, name: r.name, position: r.position, org: r.org, authSalt: r.authSalt, iter: Number(r.iter), createdAt: String(r.createdAt), locked: Number(r.lockUntil) > now };
  });
}
function allSigs_() {
  const now = Date.now();
  return sigRows_().filter(function (r) { return r.status === 'active'; }).map(function (r) {
    return { id: r.id, name: r.name, position: r.position, ownerEmail: String(r.ownerEmail || ''), createdAt: String(r.createdAt), createdBy: String(r.createdBy || ''), locked: Number(r.lockUntil) > now };
  });
}
function verifySig_(r, tag) {
  const now = Date.now(), until = Number(r.lockUntil) || 0;
  if (until > now) return { ok: false, locked: true, msg: 'التوقيع مقفل مؤقتًا — حاول بعد ' + Math.ceil((until - now) / 60000) + ' دقيقة' };
  if (!isB64_(tag, 100)) return { ok: false, msg: 'بيانات تحقق غير صالحة' };
  if (hashTag_(tag) === r.authHash) { if (Number(r.fails)) sigUpdate_(r._row, { fails: '0', lockUntil: '0' }); return { ok: true }; }
  const fails = (Number(r.fails) || 0) + 1;
  if (fails >= SIG_MAX_FAILS) { sigUpdate_(r._row, { fails: '0', lockUntil: String(now + SIG_LOCK_MIN * 60000) }); return { ok: false, locked: true, msg: 'تجاوزت عدد المحاولات — تم قفل التوقيع ' + SIG_LOCK_MIN + ' دقيقة' }; }
  sigUpdate_(r._row, { fails: String(fails) });
  return { ok: false, msg: 'رقم سري غير صحيح — المحاولات المتبقية: ' + (SIG_MAX_FAILS - fails) };
}
function validEnvelope_(enc, auth) {
  if (!enc || !auth) throw new Error('بيانات التشفير ناقصة');
  if (!isB64_(enc.salt, 64) || !isB64_(enc.iv, 64) || !isB64_(enc.ct, 1500000) || !isB64_(auth.salt, 64) || !isB64_(auth.tag, 100)) throw new Error('بيانات التشفير غير صالحة');
  const it = Number(enc.iter); if (!(it >= 100000 && it <= 2000000)) throw new Error('إعدادات التشفير غير صالحة');
}
function sigAdd_(email, p) {
  const name = clean_(p.name, 120); if (!name) throw new Error('الاسم مطلوب');
  const admin = perms_(userInfo_(email).role).admin, owner = admin && p.ownerEmail ? norm_(p.ownerEmail) : email;
  if (!isAllowed_(owner)) throw new Error('بريد صاحب التوقيع غير صالح');
  validEnvelope_(p.enc, p.auth);
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const id = Utilities.getUuid(), file = DriveApp.getFolderById(sigFolder_()).createFile(id + '.enc', p.enc.ct, MimeType.PLAIN_TEXT), now = new Date().toISOString();
    const o = { id: id, name: name, position: clean_(p.position, 120), org: clean_(p.org, 160), fileId: file.getId(), encSalt: p.enc.salt, encIv: p.enc.iv, iter: String(p.enc.iter),
                authSalt: p.auth.salt, authHash: hashTag_(p.auth.tag), fails: '0', lockUntil: '0', status: 'active', createdBy: email, createdAt: now, updatedAt: now, ownerEmail: owner };
    sheet_(SH_SIGNERS).appendRow(SIGNERS_HEADERS.map(function (k) { return o[k] === undefined ? '' : String(o[k]); }));
    audit_log_(email, { action: 'add-signature', detail: name + (owner !== email ? ' for ' + owner : ''), result: 'success' });
    return { ok: true, id: id };
  } finally { lock.releaseLock(); }
}
function sigUnlock_(email, p) {
  const r = mySigRow_(email, p.id), v = verifySig_(r, p.tag);
  audit_log_(email, { action: p.purpose === 'sign' ? 'unlock-for-sign' : (p.purpose === 'pin-change' ? 'pin-change' : 'preview'), detail: r.name, result: v.ok ? 'success' : (v.locked ? 'locked' : 'failed') });
  if (!v.ok) return v;
  return { ok: true, enc: { salt: r.encSalt, iv: r.encIv, ct: DriveApp.getFileById(r.fileId).getBlob().getDataAsString(), iter: Number(r.iter) } };
}
function sigPin_(email, p) {
  const r = mySigRow_(email, p.id), v = verifySig_(r, p.tag); if (!v.ok) return v;
  validEnvelope_(p.enc, p.auth);
  DriveApp.getFileById(r.fileId).setContent(p.enc.ct);
  sigUpdate_(r._row, { encSalt: p.enc.salt, encIv: p.enc.iv, iter: String(p.enc.iter), authSalt: p.auth.salt, authHash: hashTag_(p.auth.tag), updatedAt: new Date().toISOString() });
  audit_log_(email, { action: 'pin-changed', detail: r.name, result: 'success' });
  return { ok: true };
}
function sigDelete_(email, p) {
  const r = perms_(userInfo_(email).role).admin ? sigRow_(p.id) : mySigRow_(email, p.id);
  try { DriveApp.getFileById(r.fileId).setTrashed(true); } catch (e) {}
  sigUpdate_(r._row, { status: 'deleted', updatedAt: new Date().toISOString() });
  audit_log_(email, { action: 'delete-signature', detail: r.name, result: 'success' });
  return { ok: true };
}
function sigImg_(v) {
  if (!v) return '';
  v = String(v);
  if (v.length > 120000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/=]+$/.test(v)) throw new Error('صورة التوقيع غير صالحة أو كبيرة جدًا');
  return v;
}
/** The signer adds the picture of an existing signature (PIN-verified). */
function sigShow_(email, role, p) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const L = load_(p.id), d = L.d, s = (d.steps || []).filter(function (x) { return x.key === p.step; })[0];
    if (!s || !s.sig) throw new Error('هذه الخطوة غير موقّعة');
    if (norm_(s.sig.by) !== email) throw new Error('يظهر صورة التوقيع صاحبه فقط');
    if (isFinal_(d.meta.id, d.meta.version)) throw new Error('صدرت النسخة النهائية');
    const sg = mySigRow_(email, s.sig.signerId), img = sigImg_(p.img), blur = sigImg_(p.blur);
    if (!img) throw new Error('صورة التوقيع مفقودة');
    const v = verifySig_(sg, p.tag);
    audit_log_(email, { action: 'show-image', poId: d.meta.id, version: d.meta.version, step: s.key, result: v.ok ? 'success' : 'failed' });
    if (!v.ok) return v;
    vaultPut_(d.meta.id, d.meta.version, s.key, sg.id, img, blur);
    project_(d);
    const at = persist_(d, email, {});
    return { ok: true, data: d, updatedAt: at };
  } finally { lock.releaseLock(); }
}

/* ----- signature display (stamp · image · blur), image vault ----- */
function displayDefault_() { const m = prop_('SIG_DISPLAY_DEFAULT'); return MODES_.indexOf(m) > -1 ? m : DEFAULT_SIG_MODE; }
function modeOf_(d) { return (d && d.meta && MODES_.indexOf(d.meta.sigDisplay) > -1) ? d.meta.sigDisplay : displayDefault_(); }
function vaultName_(id, ver, key) { return String(id).toUpperCase() + '_v' + ver + '_' + key + '.json'; }
function vaultPut_(id, ver, key, signerId, img, blur) {
  const f = imgFolder_(), name = vaultName_(id, ver, key), it = f.getFilesByName(name); while (it.hasNext()) it.next().setTrashed(true);
  f.createFile(name, JSON.stringify({ signerId: signerId, img: img, blur: blur || '', at: new Date().toISOString() }), MimeType.PLAIN_TEXT);
}
function vaultGet_(id, ver, key) { const it = imgFolder_().getFilesByName(vaultName_(id, ver, key)); if (!it.hasNext()) return null; try { return JSON.parse(it.next().getBlob().getDataAsString()); } catch (e) { return null; } }
function vaultDel_(id, ver, key) { const it = imgFolder_().getFilesByName(vaultName_(id, ver, key)); while (it.hasNext()) it.next().setTrashed(true); }
/** Rewrites each signed step's picture fields from the vault according to the display mode (never persisted clear in 'blur'/'stamp'). */
function project_(d) {
  const mode = modeOf_(d), ver = String(d.meta.version);
  (d.steps || []).forEach(function (s) {
    if (!s.sig) return;
    const v = vaultGet_(d.meta.id, ver, s.key);
    delete s.sig.img; delete s.sig.imgBlur; s.sig.hasImg = !!(v && v.img);
    if (!v) return;
    if (mode === 'image') s.sig.img = v.img; else if (mode === 'blur' && v.blur) s.sig.imgBlur = v.blur;
  });
}
function setDefaultDisplay_(email, p) {
  const m = String(p.mode || ''); if (MODES_.indexOf(m) === -1) throw new Error('طريقة عرض غير معروفة');
  PropertiesService.getScriptProperties().setProperty('SIG_DISPLAY_DEFAULT', m);
  audit_log_(email, { action: 'display-default', detail: m });
  return { ok: true, mode: m };
}
function setDisplay_(email, role, p) {
  const m = String(p.mode || ''); if (MODES_.indexOf(m) === -1) throw new Error('طريقة عرض غير معروفة');
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const L = load_(p.id), d = L.d;
    if (isFinal_(d.meta.id, d.meta.version)) throw new Error('صدرت النسخة النهائية — لا يمكن تغيير طريقة العرض');
    const blurs = p.blurs || {};
    Object.keys(blurs).forEach(function (k) { const b = sigImg_(blurs[k]), v = vaultGet_(d.meta.id, d.meta.version, k); if (b && v && v.img && !v.blur) vaultPut_(d.meta.id, d.meta.version, k, v.signerId, v.img, b); });
    d.meta.sigDisplay = m; project_(d);
    const at = persist_(d, email, {});
    audit_log_(email, { action: 'display-mode', poId: d.meta.id, version: d.meta.version, detail: m });
    return { ok: true, data: d, updatedAt: at, mode: m };
  } finally { lock.releaseLock(); }
}
function finalImages_(email, role, p) {
  const L = load_(p.id), d = L.d;
  if (d.meta.status !== 'approved') throw new Error('لم تكتمل التوقيعات بعد');
  if (!mayFinalize_(d, email, role)) return { ok: false, error: 'forbidden' };
  const out = {}; (d.steps || []).forEach(function (s) { if (s.sig) { const v = vaultGet_(d.meta.id, d.meta.version, s.key); if (v && v.img) out[s.key] = v.img; } });
  audit_log_(email, { action: 'final-images', poId: d.meta.id, version: d.meta.version, detail: Object.keys(out).length + ' images' });
  return { ok: true, images: out };
}

/* ======================= Final PDF · archive · verification ======================= */
function mayFinalize_(d, email, role) {
  if (perms_(role).procurement) return true;
  return (d.steps || []).some(function (s) { return s.sig && norm_(s.sig.by) === email; });
}
function signedRows_() {
  const sh = sheet_(SH_SIGNED); if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, SIGNED_HEADERS.length).getDisplayValues().map(function (r) { const o = {}; SIGNED_HEADERS.forEach(function (k, j) { o[k] = r[j]; }); return o; });
}
function finalInfo_(id, version) {
  const r = signedRows_().filter(function (x) { return norm_(x.id) === norm_(id) && x.version === String(version); }).pop();
  return r ? { at: r.finalizedAt, by: r.finalizedBy, pdfHash: r.pdfHash, fullHash: r.fullHash, verifyId: r.verifyId } : null;
}
function isFinal_(id, version) { return !!finalInfo_(id, version); }
function verifyId_(id, ver, h) { const x = sha_('verify|' + String(id).toUpperCase() + '|' + ver + '|' + h + '|' + pepper_()).slice(0, 12).toUpperCase(); return x.slice(0, 4) + '-' + x.slice(4, 8) + '-' + x.slice(8, 12); }
function verifyUrl_(vid) { return ScriptApp.getService().getUrl() + '?verify=' + encodeURIComponent(vid); }
function vtoken_(email, role, p) {
  const L = load_(p.id), d = L.d;
  if (d.meta.status !== 'approved') throw new Error('لم تكتمل التوقيعات بعد');
  const vid = verifyId_(d.meta.id, d.meta.version, fullHash_(d));
  return { ok: true, id: vid, url: verifyUrl_(vid), contentHash: contentHash_(d), fullHash: fullHash_(d) };
}
/** The browser renders the A4 PDF; the server checks it, archives it, fingerprints it, e-mails it to procurement + requester + signers + informed. */
function finalize_(email, role, p) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const L = load_(p.id), d = L.d, ver = String(d.meta.version);
    const prev = finalInfo_(d.meta.id, ver); if (prev) return { ok: true, already: true, at: prev.at, verifyId: prev.verifyId };
    if (d.meta.status !== 'approved') throw new Error('لا يمكن إصدار النسخة النهائية قبل اكتمال جميع التوقيعات');
    if (!mayFinalize_(d, email, role)) throw new Error('الإصدار متاح للموقّعين وإدارة المشتريات فقط');
    if (!isB64_(p.pdf, MAX_PDF_B64)) throw new Error('ملف PDF غير صالح أو كبير جدًا');
    const bytes = Utilities.base64Decode(p.pdf);
    if (String.fromCharCode.apply(null, bytes.slice(0, 5).map(function (b) { return (b + 256) % 256; })) !== '%PDF-') throw new Error('الملف ليس PDF');
    const fh = fullHash_(d), ch = contentHash_(d), pdfHash = hexDigest_(bytes), vid = verifyId_(d.meta.id, ver, fh);
    const name = d.meta.id + '_v' + ver + '_approved.pdf';
    const blob = Utilities.newBlob(bytes, 'application/pdf', name);
    const file = DriveApp.getFolderById(finalFolder_()).createFile(blob), now = new Date().toISOString();
    const signers = d.steps.filter(function (s) { return s.sig; }).map(function (s) { return norm_(s.sig.by); });
    const informed = d.steps.filter(function (s) { return s.kind === 'inform'; }).map(function (s) { return norm_(s.email); });
    const to = procEmails_().concat([d.meta.requesterEmail, d.meta.createdBy], signers, informed, OWNER_EMAILS.map(norm_)).filter(function (e, i, a) { return isAllowed_(e) && a.indexOf(e) === i; });
    d.meta.finalizedAt = now; hist_(d, email, 'finalized', 'نسخة PDF نهائية · رمز التحقق ' + vid);
    persist_(d, email, { snapshot: true, reason: 'finalized' });
    sheet_(SH_SIGNED).appendRow([d.meta.id, ver, d.meta.serial, d.meta.subject, ch, fh, file.getId(), pdfHash, now, email, to.join(','), vid]);
    notify_(to, d, 'approved', '✅ اعتماد نهائي لأمر الشراء ' + d.meta.id + ' — النسخة النهائية الموقّعة',
      'اكتملت جميع التوقيعات. مرفق النسخة النهائية بصيغة PDF، وهي محفوظة في الأرشيف الإلكتروني.\nرمز التحقق: ' + vid + '\nبصمة الملف SHA-256: ' + pdfHash, false, [blob]);
    audit_log_(email, { action: 'finalized', poId: d.meta.id, version: ver, detail: 'pdf ' + pdfHash.slice(0, 16) + ' · ' + vid + ' · sent ' + to.length });
    return { ok: true, at: now, pdfHash: pdfHash, fullHash: fh, verifyId: vid, sentTo: to };
  } finally { lock.releaseLock(); }
}
function finalPdf_(email, role, p) {
  const L = load_(p.id); if (!canView_(L.d, email, role)) return { ok: false, error: 'forbidden' };
  const r = signedRows_().filter(function (x) { return norm_(x.id) === norm_(p.id) && x.version === String(p.version || L.d.meta.version); }).pop();
  if (!r) throw new Error('لا توجد نسخة نهائية لهذا الإصدار');
  const f = DriveApp.getFileById(r.pdfId);
  audit_log_(email, { action: 'final-downloaded', poId: r.id, version: r.version });
  return { ok: true, name: f.getName(), b64: Utilities.base64Encode(f.getBlob().getBytes()) };
}
function verifyReport_(r, how) {
  const vs = sheet_(SH_VER), row = findRow_(vs, [r.id, r.version]);
  let d = null; try { if (row) d = readJson_(vs, row, VER_HEADERS.length + 1); } catch (e) {}
  const okFull = !!d && fullHash_(d) === r.fullHash, okContent = !!d && contentHash_(d) === r.contentHash;
  const signers = d ? d.steps.filter(function (s) { return s.kind === 'sign'; }).map(function (s) {
    const g = s.sig || {}; const expect = s.phase === 'requester' ? r.contentHash : r.fullHash;
    return { title: s.title || '', signer: g.signerName || '', position: g.position || '', by: g.by || '', onBehalfOf: g.onBehalfOf || '', at: g.at || '', match: !!g.docHash && g.docHash === expect };
  }) : [];
  return { ok: true, found: true, how: how, valid: okFull && okContent && signers.length > 0 && signers.every(function (x) { return x.match; }),
           id: r.id, version: r.version, serial: r.serial, subject: r.subject, finalizedAt: r.finalizedAt, finalizedBy: r.finalizedBy,
           contentHash: r.contentHash, fullHash: r.fullHash, pdfHash: r.pdfHash, verifyId: r.verifyId, signers: signers,
           dept: d ? d.meta.dept : '', total: d ? totals_(d).all : 0, currency: d ? d.meta.currency : '' };
}
function verifyById_(email, id) {
  id = String(id || '').trim().toUpperCase().replace(/[^0-9A-F]/g, '');
  if (id.length !== 12) return { ok: true, found: false, error: 'رمز التحقق غير صالح — 12 خانة بالشكل XXXX-XXXX-XXXX' };
  const fmtd = id.slice(0, 4) + '-' + id.slice(4, 8) + '-' + id.slice(8, 12), r = signedRows_().filter(function (x) { return x.verifyId === fmtd; }).pop();
  audit_log_(email, { action: 'verify-code', poId: r ? r.id : '', detail: fmtd, result: r ? 'found' : 'not found' });
  return r ? verifyReport_(r, 'code') : { ok: true, found: false, error: 'لا يوجد أمر شراء معتمد بهذا الرمز' };
}
function verifyByHash_(email, hash) {
  hash = String(hash || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) return { ok: true, found: false, error: 'بصمة الملف غير صالحة' };
  const r = signedRows_().filter(function (x) { return String(x.pdfHash).toLowerCase() === hash; }).pop();
  audit_log_(email, { action: 'verify-pdf', poId: r ? r.id : '', detail: hash.slice(0, 16), result: r ? 'match' : 'no match' });
  return r ? verifyReport_(r, 'pdf') : { ok: true, found: false, error: 'الملف لا يطابق أي نسخة نهائية معتمدة في المنصة' };
}

/* =============================== Helpers =============================== */

function include(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }
function safeJson_(o) { return JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); }
function norm_(s) { return String(s || '').trim().toLowerCase(); }
function clean_(s, max) { return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, max); }
function isB64_(s, max) { return typeof s === 'string' && s.length > 0 && s.length <= max && /^[A-Za-z0-9+/=]+$/.test(s); }
function fmt_(d, p) { return Utilities.formatDate(d, TZ, p); }
function hex_(bytes) { return bytes.map(function (b) { const h = ((b + 256) % 256).toString(16); return h.length < 2 ? '0' + h : h; }).join(''); }
function sha_(s) { return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); }
function hexDigest_(bytes) { return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)); }
