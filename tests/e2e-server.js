/**
 * POFlow E2E server — serves the real Index.html (via Code.gs doGet on the mock services) and
 * bridges google.script.run → POST /api. Open http://localhost:8787/?as=<email>#<route>
 * Usage: node tests/e2e-server.js [port]
 */
'use strict';
const http = require('http'), path = require('path'), url = require('url');
const { makeEnv } = require('./gas-mock');
const env = makeEnv({ dir: path.join(__dirname, '..', 'apps-script') });
const port = Number(process.argv[2]) || 8787;
const SHIM = as => `<script>window.__AS=${JSON.stringify(as)};
(function(){function runner(){var h={};var p=new Proxy({},{get:function(_,k){
 if(k==='withSuccessHandler')return function(f){h.s=f;return p};
 if(k==='withFailureHandler')return function(f){h.f=f;return p};
 return function(arg){fetch('/api?as='+encodeURIComponent(window.__AS)+'&fn='+k,{method:'POST',body:JSON.stringify(arg)}).then(function(r){return r.json()}).then(function(r){if(r&&r.__error){h.f&&h.f(new Error(r.__error));}else h.s&&h.s(r)}).catch(function(e){h.f&&h.f(e)})}}});return p}
 window.google={script:{get run(){return runner()}}};})();</script>`;
http.createServer((req, res) => {
  const u = url.parse(req.url, true);
  if (u.pathname === '/api') {
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      let out; try { const arg = JSON.parse(b || '{}'); if (u.query.fn === 'requestAccess') { env.state.user = u.query.as; out = env.sandbox.__api.requestAccess(arg); } else out = env.call(u.query.as, arg); } catch (e) { out = { __error: e.message }; }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out));
    });
    return;
  }
  if (u.pathname === '/__env') {          // test hook: direct server calls and state
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      const q = JSON.parse(b || '{}'); let out;
      if (q.call) out = env.call(q.as, q.call);
      else if (q.rows) out = env.rows(q.rows);
      else if (q.mails) out = env.state.mails.map(m => ({ to: m.to, subject: m.subject, attachments: m.attachments }));
      else if (q.file) { const f = Object.values(env.state.files).filter(x => x.mime === 'application/pdf' && /approved/.test(x.name)).pop(); out = f ? { name: f.name, b64: Buffer.from(f.bytes.map(b => (b + 256) % 256)).toString('base64') } : null; }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out));
    });
    return;
  }
  const as = String(u.query.as || 'm.elmahdy@sr.edu.sa');
  const params = Object.assign({}, u.query); delete params.as;
  const o = env.doGet(as, params);
  const html = String(o.content || o.getContent()).replace('<head>', '<head>' + SHIM(as));
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html);
}).listen(port, () => console.log('POFlow E2E server on http://localhost:' + port));
