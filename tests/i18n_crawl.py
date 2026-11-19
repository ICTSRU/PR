"""POFlow i18n coverage crawl (v2.1) — opens every screen in English for every role and reports
Arabic UI strings that are not yet in tools/i18n/ar-en.json.  Run after tests/e2e.py (needs its data):
  node tests/e2e-server.js 8787 &  python3 tests/e2e.py && python3 tests/i18n_crawl.py [out.json]"""
import json, sys, os, re
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
src = open(os.path.join(os.path.dirname(__file__), 'e2e.py'), encoding='utf8').read().split('\nwith sync_playwright')[0]
exec(src)
OUTF = sys.argv[1] if len(sys.argv) > 1 else '/tmp/e2e/i18n-miss.json'
ROLES = [OWNER, REQ, MGR, PROC, S1, 'viewer.demo@sr.edu.sa']
miss, shots = set(), 0
def collect(pg):
    pg.wait_for_timeout(350)
    for m in pg.evaluate('I18N.misses()'): miss.add(m)
    # also anything Arabic still visible outside the official paper
    left = pg.evaluate(r"""() => { const AR=/[؀-ۿ]/, out=[]; const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
      let n; while((n=w.nextNode())){ const p=n.parentElement; if(!p||p.closest('.fpage,.fdoc-host,[data-noi18n],script,style,textarea')) continue;
        if(AR.test(n.data) && p.offsetParent!==null) out.push(n.data.replace(/\s+/g,' ').trim()); } return out; }""")
    for m in left: miss.add(m)
with sync_playwright() as p:
    br = p.chromium.launch(executable_path='/usr/bin/google-chrome')
    for who in ROLES:
        ctx = br.new_context(viewport={'width': 1400, 'height': 1000}); ctx.route('**/*', router); pg = ctx.new_page()
        pg.on('dialog', lambda d: d.dismiss())
        pg.goto(f'{BASE}/?as={who}&lang=en#dash')
        try: pg.wait_for_selector('#view h2', timeout=15000)
        except Exception: collect(pg); ctx.close(); continue
        collect(pg)
        hrefs = pg.evaluate("[...document.querySelectorAll('#nav a')].map(a=>a.getAttribute('href'))")
        pos = set()
        for h in hrefs:
            pg.goto(f'{BASE}/?as={who}&lang=en{h}'); pg.wait_for_timeout(900); collect(pg)
            pos |= set(pg.evaluate("[...document.querySelectorAll('[onclick*=\"po/\"],a[href^=\"#po/\"]')].map(e=>(e.getAttribute('href')||e.getAttribute('onclick')).match(/PR-\\d{4}-\\d{4}/)?.[0]).filter(Boolean)"))
        for po in sorted(pos)[:6]:
            for r in ('po', 'route', 'specs'):
                pg.goto(f'{BASE}/?as={who}&lang=en#{r}/{po}'); pg.wait_for_timeout(900); collect(pg)
        for sel in ['#btnBell', '#btnSigs']:
            try: pg.goto(f'{BASE}/?as={who}&lang=en#dash'); pg.wait_for_selector('#view h2'); pg.click(sel, timeout=2000); pg.wait_for_timeout(600); collect(pg)
            except Exception: pass
        for h in ['new', 'verify/XXXX-0000']:
            pg.goto(f'{BASE}/?as={who}&lang=en#{h}'); pg.wait_for_timeout(800); collect(pg)
        ctx.close()
    ctx = br.new_context(); ctx.route('**/*', router); pg = ctx.new_page()
    pg.goto(f'{BASE}/?as=nobody@sr.edu.sa&lang=en'); pg.wait_for_timeout(800); collect(pg)
    pg.goto(f'{BASE}/?as={OWNER}&page=howto&lang=en'); pg.wait_for_timeout(800); collect(pg)
    br.close()
miss = sorted(m for m in miss if m)
json.dump(miss, open(OUTF, 'w', encoding='utf8'), ensure_ascii=False, indent=0)
print(f'{len(miss)} untranslated strings → {OUTF}')
