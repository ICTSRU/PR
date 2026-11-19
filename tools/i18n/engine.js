/* POFlow i18n + theme engine (v2.1) — Arabic is the source language; English is applied at runtime.
   - Every UI string stays Arabic in the code; this engine translates text nodes and the
     placeholder/title/aria-label/alt attributes from the AR→EN dictionary (exact match first,
     then known phrases inside longer strings, then numeric patterns).
   - The official Purchase Requisition paper (.fpage) and the PDF are never translated — the
     official form is already bilingual. Mark any other subtree with data-noi18n to skip it.
   - Language and theme are per-browser preferences (localStorage) and may be forced by
     ?lang=en|ar and ?theme=dark|light (the login page passes them on). */
(function () {
  var DICT = window.I18N_DICT || {}, PATS = window.I18N_PATTERNS || [];
  var AR = /[؀-ۿ]/, SKIP = '.fpage,.fdoc-host,[data-noi18n],script,style,textarea,code,.mono';
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'label', 'data-tip'];
  var store = (function () { try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return localStorage; } catch (e) { return null; } })();
  function get(k, d) { try { return (store && store.getItem(k)) || d; } catch (e) { return d; } }
  function put(k, v) { try { store && store.setItem(k, v); } catch (e) {} }
  var q = {}; try { (location.search || '').slice(1).split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); }); } catch (e) {}
  var boot = window.BOOT && window.BOOT.params || {};
  var lang = (q.lang || boot.lang || get('poflow_lang', 'ar')) === 'en' ? 'en' : 'ar';
  var theme = (q.theme || boot.theme || get('poflow_theme', '')) || ((window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light');
  theme = theme === 'dark' ? 'dark' : 'light';
  if (q.lang) put('poflow_lang', lang); if (q.theme) put('poflow_theme', theme);

  var norm = function (s) { return s.replace(/\s+/g, ' ').trim(); };
  var KEYS = Object.keys(DICT).filter(function (k) { return k.length >= 2; }).sort(function (a, b) { return b.length - a.length; });
  var cache = new Map(), miss = window.__I18N_MISS = new Set();
  function tr(s) {
    if (s == null) return s; s = String(s);
    if (lang !== 'en' || !AR.test(s)) return s;
    if (cache.has(s)) return cache.get(s);
    var lead = s.match(/^\s*/)[0], tail = s.match(/\s*$/)[0], k = norm(s), out = DICT[k];
    if (out == null) {
      out = k;
      for (var i = 0; i < PATS.length && AR.test(out); i++) out = out.replace(PATS[i][0], PATS[i][1]);
      if (AR.test(out)) for (var j = 0; j < KEYS.length; j++) { if (out.indexOf(KEYS[j]) > -1) { out = out.split(KEYS[j]).join(DICT[KEYS[j]]); if (!AR.test(out)) break; } }
      out = out.replace(/،\s*/g, ', ').replace(/؛/g, ';').replace(/؟/g, '?').replace(/«/g, '“').replace(/»/g, '”').replace(/ـ/g, '').replace(/\s{2,}/g, ' ');
      /* all-or-nothing: free text the user typed (subjects, item descriptions, names) is never half-translated */
      if (AR.test(out)) { miss.add(k); out = s; cache.set(s, s); return s; }
    }
    out = lead + out + tail; cache.set(s, out); return out;
  }
  function skip(el) { return el && el.closest && el.closest(SKIP); }
  var busy = false;
  function doText(n) {
    if (n.__en === n.data) return;
    if (!AR.test(n.data)) return;
    var p = n.parentElement; if (!p || skip(p)) return;
    var t = tr(n.data);
    if (t === n.data) { if (/[A-Za-z0-9]/.test(t) && !p.hasAttribute('data-bidi')) p.setAttribute('data-bidi', ''); return; }   /* mixed Arabic data + Latin/digits: keep it readable in LTR */
    if (p.tagName === 'OPTION' && !p.hasAttribute('value')) p.setAttribute('value', n.data.trim());   /* keep the Arabic value that is saved */
    n.__ar = n.data; n.__en = t; n.data = t;
  }
  var SKIP_ATTR = '.fpage,.fdoc-host,[data-noi18n]';
  function doEl(el) {
    if (el.closest && el.closest(SKIP_ATTR)) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i], v = el.getAttribute && el.getAttribute(a);
      if (v && AR.test(v) && !(el.__ard && el.__ard[a] === v)) { var t = tr(v); (el.__ara = el.__ara || {})[a] = v; (el.__ard = el.__ard || {})[a] = t; el.setAttribute(a, t); }
    }
    if ((el.tagName === 'INPUT' && /^(button|submit)$/i.test(el.type)) && AR.test(el.value)) { (el.__ara = el.__ara || {}).value = el.value; el.value = tr(el.value); }
  }
  function apply(root) {
    if (lang !== 'en' || !root) return;
    busy = true;
    try {
      if (root.nodeType === 3) { doText(root); return; }
      if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
      if (root.nodeType === 1) { if (skip(root)) { doEl(root); return; } doEl(root); }
      var w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) { if (n.nodeType === 1 && n.matches(SKIP)) { if (!n.matches(SKIP_ATTR)) doEl(n); return NodeFilter.FILTER_REJECT; } return NodeFilter.FILTER_ACCEPT; } });
      var n; while ((n = w.nextNode())) { if (n.nodeType === 3) doText(n); else doEl(n); }
    } finally { busy = false; }
  }
  function restore() {
    var w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT), n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) { if (n.__ar != null && n.data === n.__en) n.data = n.__ar; n.__ar = n.__en = null; }
      else if (n.hasAttribute && n.hasAttribute('data-bidi')) n.removeAttribute('data-bidi');
      if (n.nodeType === 1 && n.__ara) { for (var a in n.__ara) { if (a === 'value') n.value = n.__ara[a]; else n.setAttribute(a, n.__ara[a]); } n.__ara = n.__ard = null; }
    }
  }
  var mo = new MutationObserver(function (list) {
    if (busy || lang !== 'en') return;
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m.type === 'characterData') apply(m.target);
      else if (m.type === 'attributes') { if (m.target.getAttribute(m.attributeName) && AR.test(m.target.getAttribute(m.attributeName))) apply(m.target); }
      else for (var j = 0; j < m.addedNodes.length; j++) apply(m.addedNodes[j]);
    }
  });
  function setDoc() {
    var h = document.documentElement;
    h.lang = lang; h.dir = lang === 'en' ? 'ltr' : 'rtl'; h.setAttribute('data-theme', theme);
    var t = document.querySelector('meta[name=color-scheme]'); if (t) t.content = theme;
  }
  setDoc();
  var titleAr = null;
  function start() {
    if (titleAr == null) titleAr = document.title;
    document.title = tr(titleAr);
    apply(document.body);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    syncButtons();
  }
  function syncButtons() {
    document.querySelectorAll('[data-i18n-toggle]').forEach(function (b) {
      b.setAttribute('data-noi18n', '');
      b.innerHTML = lang === 'en' ? '<span lang="ar" style="font-family:Cairo,Tahoma,sans-serif">عربي</span>' : '<span lang="en" style="font-family:Arial,sans-serif">English</span>';
      b.setAttribute('aria-label', lang === 'en' ? 'التبديل إلى العربية' : 'Switch to English'); b.title = b.getAttribute('aria-label');
      b.__ara = null;
    });
    document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
      var dark = theme === 'dark';
      b.innerHTML = dark
        ? '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>'
        : '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
      var lbl = dark ? (lang === 'en' ? 'Light mode' : 'الوضع النهاري') : (lang === 'en' ? 'Dark mode' : 'الوضع الليلي');
      b.title = lbl; b.setAttribute('aria-label', lbl); b.setAttribute('aria-pressed', dark ? 'true' : 'false'); b.__ara = null;
    });
  }
  var hooks = [];
  window.I18N = {
    t: tr, apply: apply, get lang() { return lang; }, get theme() { return theme; },
    locale: function () { return lang === 'en' ? 'en-GB' : 'ar-SA-u-ca-gregory-nu-latn'; },
    onChange: function (f) { hooks.push(f); },
    setLang: function (l) {
      l = l === 'en' ? 'en' : 'ar'; if (l === lang) return;
      if (l === 'ar') { mo.disconnect(); restore(); }
      lang = l; put('poflow_lang', l); cache.clear(); setDoc();
      document.title = tr(titleAr);
      if (l === 'en') { apply(document.body); mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS }); }
      syncButtons(); hooks.forEach(function (f) { try { f('lang'); } catch (e) {} });
    },
    toggleLang: function () { this.setLang(lang === 'en' ? 'ar' : 'en'); },
    setTheme: function (t) { theme = t === 'dark' ? 'dark' : 'light'; put('poflow_theme', theme); setDoc(); syncButtons(); hooks.forEach(function (f) { try { f('theme'); } catch (e) {} }); },
    toggleTheme: function () { this.setTheme(theme === 'dark' ? 'light' : 'dark'); },
    misses: function () { return Array.from(miss); }
  };
  /* native dialogs */
  ['alert', 'confirm', 'prompt'].forEach(function (k) { var f = window[k]; if (f) window[k] = function (m, d) { return f.call(window, tr(m), d); }; });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
