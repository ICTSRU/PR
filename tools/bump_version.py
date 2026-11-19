#!/usr/bin/env python3
"""POFlow — bump the version on every edit (single decimal: 1.9 → 2.0, never 1.10).
Updates every in-page badge and the CHANGELOG in one step.
  python3 tools/bump_version.py "وصف التغيير"            # next version
  python3 tools/bump_version.py "وصف" --set 2.0          # explicit version
  python3 tools/bump_version.py --check                   # verify all files carry the same version (used by CI)
"""
import re, sys, datetime, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
CODE = ROOT / 'apps-script' / 'Code.gs'

def current():
    return re.search(r"const APP_VERSION\s*=\s*'(\d+\.\d)'", CODE.read_text(encoding='utf8')).group(1)

def nxt(v):
    a, b = map(int, v.split('.'))
    return f'{a + 1}.0' if b == 9 else f'{a}.{b + 1}'

# (file, regex with one group = the version) — every place a version is shown
TARGETS = [
    ('apps-script/Code.gs', r"const APP_VERSION\s*=\s*'(\d+\.\d)'"),
    ('apps-script/Code.gs', r"POFlow v(\d+\.\d) — منصة"),
    ('apps-script/Index.html', r'<meta name="version" content="(\d+\.\d)">'),
    ('apps-script/Index.html', r'id="appVer">v(\d+\.\d)</span>'),
    ('apps-script/Index.html', r'POFlow v(\d+\.\d) — Purchase Order Platform'),
    ('index.html', r'assets/i18n\.js\?v=(\d+\.\d)'),
    ('apps-script/Denied.html', r'<meta name="version" content="(\d+\.\d)">'),
    ('apps-script/HowTo.html', r'POFlow v(\d+\.\d)</span>'),
    ('apps-script/HowTo.html', r'<span class="en">v(\d+\.\d)</span></footer>'),
    ('index.html', r'<meta name="version" content="(\d+\.\d)">'),
    ('index.html', r'VERSION:\s*"(\d+\.\d)"'),
    ('README.md', r'POFlow — منصة أوامر الشراء · v(\d+\.\d)'),
]

def found():
    out = []
    for f, rx in TARGETS:
        p = ROOT / f
        if not p.exists(): continue
        m = re.search(rx, p.read_text(encoding='utf8'))
        out.append((f, rx, m.group(1) if m else None))
    return out

def check():
    v = current(); bad = [(f, x) for f, _, x in found() if x != v]
    top = re.search(r'## \[v(\d+\.\d)\]', (ROOT / 'CHANGELOG.md').read_text(encoding='utf8'))
    if not top or top.group(1) != v: bad.append(('CHANGELOG.md', top and top.group(1)))
    if bad:
        print(f'::error::Version mismatch — APP_VERSION is {v}: ' + ', '.join(f'{f}={x}' for f, x in bad)); sys.exit(1)
    print(f'✔ all files at v{v}')

def bump(msg, new=None):
    old = current(); new = new or nxt(old)
    if not re.fullmatch(r'\d+\.\d', new): sys.exit('version must look like 1.4')
    for f, rx, _ in found():
        p = ROOT / f; s = p.read_text(encoding='utf8')
        s = re.sub(rx, lambda m: m.group(0).replace(m.group(1), new, 1), s, count=1)
        p.write_text(s, encoding='utf8')
    cl = ROOT / 'CHANGELOG.md'; c = cl.read_text(encoding='utf8')
    entry = f'## [v{new}] — {datetime.date.today().isoformat()}\n### تغيّر · Changed\n- {msg or "تحديث"}\n\n'
    i = c.find('## [v'); c = c[:i] + entry + c[i:] if i >= 0 else c + '\n' + entry
    cl.write_text(c, encoding='utf8')
    print(f'v{old} → v{new}')

if __name__ == '__main__':
    a = sys.argv[1:]
    if '--check' in a: check()
    else:
        new = a[a.index('--set') + 1] if '--set' in a else None
        msg = next((x for x in a if not x.startswith('--') and x != new), '')
        bump(msg, new)
