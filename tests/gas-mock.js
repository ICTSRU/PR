/**
 * POFlow test harness — in-memory emulation of the Apps Script services used by Code.gs
 * (SpreadsheetApp, DriveApp, PropertiesService, CacheService, LockService, Session, Utilities,
 *  MailApp, GmailApp, HtmlService, ScriptApp). Lets the real Code.gs run unchanged under Node.
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');

function makeEnv(opts) {
  opts = opts || {};
  const state = { user: '', mails: [], files: {}, folders: {}, props: {}, cache: {}, sheets: {}, triggers: [] };
  let fileSeq = 0;

  /* ---------- Sheets ---------- */
  function Sheet(name) { this.name = name; this.rows = []; this.maxRows = 1000; }
  Sheet.prototype.getName = function () { return this.name; };
  Sheet.prototype.getLastRow = function () { let n = this.rows.length; while (n > 0 && this.rows[n - 1].every(v => v === '' || v == null)) n--; return n; };
  Sheet.prototype.getLastColumn = function () { return this.rows.reduce((m, r) => Math.max(m, r.length), 0); };
  Sheet.prototype.getMaxRows = function () { return Math.max(this.maxRows, this.rows.length); };
  Sheet.prototype.appendRow = function (vals) { this.rows.splice(this.getLastRow(), 0, vals.map(v => v)); return this; };
  Sheet.prototype.getRange = function (r, c, nr, nc) {
    if (typeof r === 'string') return new Range(this, 1, 1, 1, 1);
    return new Range(this, r, c, nr || 1, nc || 1);
  };
  Sheet.prototype.deleteRows = function (r, n) { this.rows.splice(r - 1, n); };
  ['setFrozenRows', 'setRightToLeft', 'hideColumns', 'setColumnWidth'].forEach(k => Sheet.prototype[k] = function () { return this; });
  Sheet.prototype.protect = function () { const p = { setDescription: () => p, removeEditors: () => p, getEditors: () => [], canDomainEdit: () => false, setDomainEdit: () => p }; return p; };

  function Range(sh, r, c, nr, nc) { this.sh = sh; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
  Range.prototype.getValues = function () {
    const out = [];
    for (let i = 0; i < this.nr; i++) { const row = this.sh.rows[this.r - 1 + i] || []; const o = []; for (let j = 0; j < this.nc; j++) { const v = row[this.c - 1 + j]; o.push(v === undefined ? '' : v); } out.push(o); }
    return out;
  };
  Range.prototype.getDisplayValues = function () { return this.getValues().map(r => r.map(v => v instanceof Date ? v.toISOString() : (v === true ? 'TRUE' : v === false ? 'FALSE' : String(v)))); };
  Range.prototype.getDisplayValue = function () { return this.getDisplayValues()[0][0]; };
  Range.prototype.getValue = function () { return this.getValues()[0][0]; };
  Range.prototype.setValues = function (vals) {
    for (let i = 0; i < vals.length; i++) { const ri = this.r - 1 + i; while (this.sh.rows.length <= ri) this.sh.rows.push([]); const row = this.sh.rows[ri];
      for (let j = 0; j < vals[i].length; j++) { while (row.length < this.c - 1 + j) row.push(''); row[this.c - 1 + j] = vals[i][j]; } }
    return this;
  };
  Range.prototype.setValue = function (v) { return this.setValues([[v]]); };
  ['setFontWeight', 'setBackground', 'setFontColor', 'setNumberFormat', 'setNote', 'insertCheckboxes', 'setDataValidation'].forEach(k => Range.prototype[k] = function () { return this; });

  const Spreadsheet = {
    getSheetByName: n => state.sheets[n] || null,
    insertSheet: n => (state.sheets[n] = new Sheet(n)),
    getId: () => 'SS1', getSheets: () => Object.values(state.sheets), deleteSheet: sh => { delete state.sheets[sh.name]; }
  };

  /* ---------- Drive ---------- */
  function Blob(bytes, mime, name) { this.bytes = bytes; this.mime = mime; this.name = name; }
  Blob.prototype.getBytes = function () { return this.bytes.slice(); };
  Blob.prototype.getDataAsString = function () { return Buffer.from(this.bytes.map(b => (b + 256) % 256)).toString('utf8'); };
  Blob.prototype.getName = function () { return this.name; };
  function File(id, name, bytes, mime, folder) { this.id = id; this.name = name; this.bytes = bytes; this.mime = mime; this.folder = folder; this.trashed = false; }
  File.prototype.getId = function () { return this.id; };
  File.prototype.getName = function () { return this.name; };
  File.prototype.getBlob = function () { return new Blob(this.bytes, this.mime, this.name); };
  File.prototype.setTrashed = function (t) { this.trashed = !!t; return this; };
  File.prototype.setContent = function (s) { this.bytes = toSigned(Buffer.from(String(s), 'utf8')); return this; };
  function toSigned(buf) { return Array.from(buf).map(b => b > 127 ? b - 256 : b); }
  function Folder(id, name) { this.id = id; this.name = name; }
  Folder.prototype.getId = function () { return this.id; };
  Folder.prototype.createFolder = function (n) { const id = 'D' + (++fileSeq); state.folders[id] = new Folder(id, n); state.folders[id].parent = this.id; return state.folders[id]; };
  Folder.prototype.createFile = function (a, b, c) {
    const id = 'F' + (++fileSeq);
    let f;
    if (a instanceof Blob) f = new File(id, a.name, a.bytes, a.mime, this.id);
    else f = new File(id, a, toSigned(Buffer.from(String(b), 'utf8')), c || 'text/plain', this.id);
    state.files[id] = f; return f;
  };
  Folder.prototype.getFilesByName = function (n) {
    const list = Object.values(state.files).filter(f => f.folder === this.id && f.name === n && !f.trashed); let i = 0;
    return { hasNext: () => i < list.length, next: () => list[i++] };
  };
  const DriveApp = {
    createFolder: n => { const id = 'D' + (++fileSeq); state.folders[id] = new Folder(id, n); return state.folders[id]; },
    getFolderById: id => { if (!state.folders[id]) { if (/^D\d+$/.test(id)) throw new Error('no folder ' + id); state.folders[id] = new Folder(id, 'existing'); } return state.folders[id]; },
    getFileById: id => { const f = state.files[id]; if (!f) throw new Error('no file ' + id); return f; }
  };

  /* ---------- Utilities ---------- */
  const Utilities = {
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, v) => toSigned(crypto.createHash('sha256').update(typeof v === 'string' ? Buffer.from(v, 'utf8') : Buffer.from(v.map(b => (b + 256) % 256))).digest()),
    getUuid: () => crypto.randomUUID(),
    base64Decode: s => toSigned(Buffer.from(s, 'base64')),
    base64Encode: bytes => Buffer.from(bytes.map(b => (b + 256) % 256)).toString('base64'),
    newBlob: (bytes, mime, name) => new Blob(bytes, mime, name),
    formatDate: (d, tz, p) => {
      const x = new Date(d.getTime() + 3 * 3600e3); const z = n => String(n).padStart(2, '0');
      return p.replace('yyyy', x.getUTCFullYear()).replace('MM', z(x.getUTCMonth() + 1)).replace('dd', z(x.getUTCDate()))
        .replace('HH', z(x.getUTCHours())).replace('mm', z(x.getUTCMinutes())).replace('ss', z(x.getUTCSeconds()));
    }
  };

  const sandbox = {
    console, JSON, Math, Date, Object, Array, String, Number, Boolean, RegExp, Error,
    SpreadsheetApp: { getActiveSpreadsheet: () => Spreadsheet, openById: () => Spreadsheet, getUi: () => { throw new Error('no ui'); }, newDataValidation: () => ({}) },
    DriveApp,
    MimeType: { PLAIN_TEXT: 'text/plain' },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => state.props[k] == null ? null : state.props[k], setProperty: (k, v) => { state.props[k] = String(v); } }) },
    CacheService: { getScriptCache: () => ({ get: k => (state.cache[k] && state.cache[k].exp > Date.now()) ? state.cache[k].v : null, put: (k, v, s) => { state.cache[k] = { v, exp: Date.now() + (s || 600) * 1000 }; }, remove: k => { delete state.cache[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, tryLock: () => true, releaseLock: () => {} }) },
    Session: { getActiveUser: () => ({ getEmail: () => state.user }) },
    Utilities,
    MailApp: { sendEmail: o => state.mails.push({ to: o.to, subject: o.subject, html: o.htmlBody, attachments: (o.attachments || []).length }) },
    GmailApp: { getAliases: () => [], sendEmail: (to, subject, b, o) => state.mails.push({ to, subject, html: o.htmlBody, from: o.from }) },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }), getProjectTriggers: () => state.triggers, deleteTrigger: () => {}, newTrigger: h => ({ timeBased: () => ({ everyHours: () => ({ create: () => state.triggers.push({ getHandlerFunction: () => h }) }) }) }) },
    HtmlService: {
      createHtmlOutputFromFile: n => { const c = fs.readFileSync(path.join(opts.dir, n + '.html'), 'utf8'); const o = { getContent: () => c, setTitle: () => o, addMetaTag: () => o, setFaviconUrl: () => o }; return o; },
      createHtmlOutput: c => { const o = { content: c, getContent: () => c, setTitle: () => o, addMetaTag: () => o, setFaviconUrl: () => o }; return o; },
      createTemplateFromFile: n => ({ evaluate: () => { const o = { setTitle: () => o, addMetaTag: () => o, getContent: () => 'denied' }; return o; } })
    }
  };
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.join(opts.dir, 'Code.gs'), 'utf8');
  vm.runInContext(code + '\n;this.__api={poApi:poApi,requestAccess:requestAccess,doGet:doGet,remindPending:remindPending,setup:setup,_SETUP:()=>{SETUP_DONE_=false;}};', sandbox, { filename: 'Code.gs' });
  const api = sandbox.__api;
  return {
    state, sandbox,
    as(email) { state.user = email; return this; },
    call(email, req) { state.user = email; return JSON.parse(JSON.stringify(api.poApi(req))); },
    doGet(email, params) { state.user = email; return api.doGet({ parameter: params || {} }); },
    remind() { return api.remindPending(); },
    sheet(n) { return state.sheets[n]; },
    rows(n) { const sh = state.sheets[n]; return sh ? sh.rows.slice(1) : []; }
  };
}
module.exports = { makeEnv };
