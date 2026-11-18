"""
POFlow v1.0 — browser end-to-end acceptance test (headless Chrome + the real Index.html).
  A. requester creates a PO in the UI → manager registers a signature (in-browser AES-GCM) and signs →
     procurement suggests the DoA route and starts it → 3 signers sign in order in the UI → the last signer's
     browser renders the final PDF (jsPDF) → archived, e-mailed, verifiable.
  B. a second PO is rejected by signer 2 in the UI → cycle stops, signer 3 never notified.
Run: node tests/e2e-server.js 8787 &  then  python3 tests/e2e.py [CDN_LIB_DIR] [OUT_DIR]
"""
import json, sys, os, base64, urllib.request, time
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8787'
LIB = sys.argv[1] if len(sys.argv) > 1 else '/tmp/e2e/node_modules'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/e2e/out'
os.makedirs(OUT, exist_ok=True)
OWNER, REQ, MGR, PROC = 'm.elmahdy@sr.edu.sa', 'requester@sr.edu.sa', 'it.manager@sr.edu.sa', 'procurement@sr.edu.sa'
S1, S2, S3 = 'warehouse.mgr@sr.edu.sa', 'proc.manager@sr.edu.sa', 'ceo.shared@sr.edu.sa'
PIN = 'Sign2026ok'
passed = 0

def env(q):
    r = urllib.request.Request(BASE + '/__env', data=json.dumps(q).encode(), method='POST')
    return json.loads(urllib.request.urlopen(r).read())

def ok(c, msg):
    global passed
    assert c, msg
    passed += 1
    print('  ✔ ' + msg)

LIBS = {
    'jspdf.umd.min.js': ('jspdf/dist/jspdf.umd.min.js', 'application/javascript'),
    'qrcode.min.js': ('qrcode-generator/qrcode.js', 'application/javascript'),
    'lucide.min.js': ('lucide/dist/umd/lucide.min.js', 'application/javascript'),
}
def router(route):
    u = route.request.url
    for k, (p, ct) in LIBS.items():
        if u.endswith(k):
            return route.fulfill(path=os.path.join(LIB, p), content_type=ct)
    if u.startswith(BASE) or u.startswith('data:') or u.startswith('blob:'):
        return route.continue_()
    return route.abort()

def page_as(browser, email, hash_=''):
    ctx = browser.new_context(viewport={'width': 1400, 'height': 1000}, locale='ar-SA', accept_downloads=True)
    ctx.route('**/*', router)
    pg = ctx.new_page()
    pg.on('dialog', lambda d: d.accept())
    pg.on('pageerror', lambda e: print('    [pageerror]', email, e))
    pg.goto(f'{BASE}/?as={email}#{hash_}')
    pg.wait_for_selector('#view h2', timeout=20000)
    return pg

def register_sig(pg, name, pos):
    pg.click('#btnSigs'); pg.wait_for_selector('#dlgSigs[open]')
    pg.fill('#msName', name); pg.fill('#msPos', pos)
    pg.set_input_files('#msFile', SIGIMG)
    pg.wait_for_function("document.querySelector('#msPrev').style.display==='block'")
    pg.fill('#msPin', PIN); pg.fill('#msPin2', PIN)
    pg.click('#msAdd')
    pg.wait_for_function("document.querySelector('#msBody').textContent.includes('مشفّر')", timeout=30000)
    pg.click('#dlgSigs .dlg-h button:has-text("إغلاق")')

def sign_ui(pg, po):
    pg.goto(f'{BASE}/?as={pg._as}#po/{po}'); pg.wait_for_selector('.side .btn.ok', timeout=20000)
    pg.click('.side .btn.ok'); pg.wait_for_selector('#dlgSign[open]')
    pg.fill('#sgPin', PIN); pg.check('#sgAgree'); pg.click('#sgGo')
    try: pg.wait_for_selector('#dlgSign[open]', state='detached', timeout=60000)
    except Exception: raise AssertionError('sign dialog stayed open: ' + pg.inner_text('#sgMsg'))

# signature image (a drawn scribble) for upload
SIGIMG = os.path.join(OUT, 'sig.png')
from PIL import Image, ImageDraw
im = Image.new('RGBA', (360, 120), (255, 255, 255, 0)); dr = ImageDraw.Draw(im)
dr.line([(20, 80), (70, 30), (110, 90), (160, 40), (210, 85), (260, 35), (330, 70)], fill=(20, 18, 90, 255), width=5)
im.save(SIGIMG)

print('POFlow browser E2E\n')
env({'as': OWNER, 'call': {'action': 'userSave', 'email': PROC, 'name': 'إدارة المشتريات', 'role': 'editor', 'procurement': True}})
for e in (REQ, MGR, S1, S2, S3): env({'as': OWNER, 'call': {'action': 'userSave', 'email': e, 'name': '', 'role': 'editor'}})
env({'as': OWNER, 'call': {'action': 'settingsSave', 'settings': {'PROC_EMAILS': PROC, 'POSITIONS': [
    {'title': 'مدير إدارة المستودعات', 'name': 'أ. فهد العتيبي', 'email': S1},
    {'title': 'مدير إدارة المشتريات', 'name': 'أ. سارة الزهراني', 'email': S2},
    {'title': 'الرئيس التنفيذي للخدمات المشتركة', 'name': 'د. ناصر القحطاني', 'email': S3},
    {'title': 'مدير الشركة', 'name': 'م. عبدالله الراجحي', 'email': 'company.mgr@sr.edu.sa'}]}}})

with sync_playwright() as p:
    br = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    print('A · full approval cycle in the UI')
    rq = page_as(br, REQ, 'new'); rq._as = REQ
    rq.fill('[data-m=dept]', 'الإدارة التنفيذية للاتصالات وتقنية المعلومات')
    rq.fill('[data-m=budget]', 'BUD-ICT-2026-07')
    rq.fill('[data-m=subject]', 'توريد أجهزة شبكات ومستلزمات تشغيل لمركز البيانات')
    rq.fill('[data-m=supplier]', 'شركة التقنية المتقدمة')
    rq.fill('#mgrEmail', MGR); rq.fill('#mgrName', 'م. خالد المنصور')
    rows = [('محولات شبكية 48 منفذ', 'جهاز', '6', '9500'), ('كابلات ألياف ضوئية OM4', 'لفة', '12', '1250'), ('وحدات SFP+ 10G', 'قطعة', '24', '300')]
    for i, r in enumerate(rows):
        if i: rq.click('text=إضافة صنف >> nth=0')
        for k, v in zip(('desc', 'unit', 'qty', 'price'), r): rq.fill(f'#tb-consumables input[data-i="{i}"][data-k="{k}"]', v)
    ok('79,200.00' in rq.inner_text('#tot-consumables'), 'live total 79,200.00 SAR')
    ok('الرئيس التنفيذي للخدمات المشتركة' in rq.inner_text('#doa-consumables'), 'DoA hint shows the 50k–100k route')
    rq.screenshot(path=f'{OUT}/01-new-po.png', full_page=True)
    rq.click('text=حفظ وإرسال لتوقيع مدير الإدارة')
    rq.wait_for_selector('.st-req_sign', timeout=20000)
    po = rq.url.split('#po/')[1]
    ok(po.startswith('PR-'), 'created and submitted ' + po)

    mg = page_as(br, MGR, 'sign'); mg._as = MGR
    register_sig(mg, 'م. خالد المنصور', 'مدير إدارة العمليات التقنية')
    ok(True, 'manager registered an encrypted signature in the browser')
    sign_ui(mg, po)
    mg.wait_for_selector('.st-proc_review', timeout=20000)
    ok(True, 'manager signed → «قيد مراجعة المشتريات»')

    pr = page_as(br, PROC, 'inbox'); pr._as = PROC
    ok(po in pr.inner_text('#view'), 'PO appears in the procurement inbox')
    pr.goto(f'{BASE}/?as={PROC}#route/{po}'); pr.wait_for_selector('#rtSteps .steprow')
    n = pr.locator('#rtSteps .steprow').count()
    ok(n == 3, f'DoA suggestion produced {n} ordered signers with e-mails from the position directory')
    pr.fill('#rtNote', 'يُعتمد الشراء المباشر وفق عرض السعر الأقل والمطابق فنيًا.')
    pr.screenshot(path=f'{OUT}/02-route.png', full_page=True)
    pr.click('text=اعتماد المسار وبدء دورة التوقيعات')
    pr.wait_for_selector('.st-signing', timeout=20000)
    ok(True, 'procurement started the sequential cycle')

    for i, (e, nm, ps) in enumerate([(S1, 'أ. فهد العتيبي', 'مدير إدارة المستودعات'), (S2, 'أ. سارة الزهراني', 'مدير إدارة المشتريات'), (S3, 'د. ناصر القحطاني', 'الرئيس التنفيذي للخدمات المشتركة')]):
        sp = page_as(br, e, 'sign'); sp._as = e
        ok(po in sp.inner_text('#view'), f'signer {i+1} sees the PO in his signature inbox')
        register_sig(sp, nm, ps)
        if i == 0:
            other = page_as(br, S2, f'po/{po}')
            ok(other.locator('.side .btn.ok').count() == 0, 'signer 2 has no sign button before his turn')
            other.context.close()
        sign_ui(sp, po)
        if i < 2:
            sp.wait_for_function(f"document.querySelector('.seq').textContent.includes('{['أ. فهد العتيبي','أ. سارة الزهراني'][i]}')")
            ok(True, f'signer {i+1} signed in the UI → next signer notified')
            if i == 1: sp.screenshot(path=f'{OUT}/03-po-signing.png', full_page=True)
            sp.context.close()
        else:
            sp.wait_for_selector('.banner.ok', timeout=120000)
            ok('نسخة نهائية معتمدة' in sp.inner_text('#view'), 'last signature → final PDF rendered in the browser and archived')
            sp.screenshot(path=f'{OUT}/04-po-approved.png', full_page=True)
            last = sp
    signed = env({'rows': 'Signed'})
    ok(len(signed) == 1 and signed[0][0] == po, 'Signed archive row written')
    f = env({'file': 1}); pdf = base64.b64decode(f['b64'])
    open(f'{OUT}/{f["name"]}', 'wb').write(pdf)
    ok(pdf[:5] == b'%PDF-' and len(pdf) > 50000, f'final PDF {f["name"]} ({len(pdf)//1024} KB)')
    mails = env({'mails': 1})
    fin = [m for m in mails if 'اعتماد نهائي' in m['subject']]
    ok(fin and fin[0]['attachments'] == 1 and PROC in fin[0]['to'] and REQ in fin[0]['to'], 'final PDF e-mailed to procurement and requester')
    vid = signed[0][11]
    last.goto(f'{BASE}/?as={S3}#verify/{vid}'); last.wait_for_selector('#vRes .banner', timeout=20000)
    ok('سليم' in last.inner_text('#vRes'), 'verification page: valid (' + vid + ')')
    last.screenshot(path=f'{OUT}/05-verify.png', full_page=True)
    d = page_as(br, OWNER, 'dash'); d.wait_for_selector('.tiles')
    d.screenshot(path=f'{OUT}/06-dashboard.png', full_page=True)

    print('\nB · rejection at signer 2 in the UI')
    r = env({'as': REQ, 'call': {'action': 'save', 'data': {'meta': {'dept': 'إدارة المرافق', 'subject': 'توريد أثاث مكتبي', 'supplier': 'مؤسسة الأثاث'}, 'consumables': [{'desc': 'مكاتب إدارية', 'unit': 'قطعة', 'qty': 20, 'price': 3500}]}, 'managerEmail': MGR}})
    po2 = r['data']['meta']['id']; g = env({'as': REQ, 'call': {'action': 'get', 'id': po2}})
    env({'as': REQ, 'call': {'action': 'submit', 'id': po2, 'baseUpdatedAt': g['updatedAt']}})
    mg = page_as(br, MGR, ''); mg._as = MGR; sign_ui(mg, po2)
    pr.goto(f'{BASE}/?as={PROC}#route/{po2}'); pr.wait_for_selector('#rtSteps .steprow')
    pr.click('text=اعتماد المسار وبدء دورة التوقيعات'); pr.wait_for_selector('.st-signing', timeout=20000)
    s1 = page_as(br, S1, ''); s1._as = S1; sign_ui(s1, po2)
    s2 = page_as(br, S2, f'po/{po2}'); s2.wait_for_selector('.side .btn.danger')
    s2.click('.side .btn.danger:has-text("رفض")'); s2.wait_for_selector('#dlgReject[open]')
    s2.click('#rjGo'); ok('إلزامي' in s2.inner_text('#rjMsg'), 'reason is mandatory in the UI')
    s2.fill('#rjReason', 'السعر أعلى من متوسط السوق — يلزم عرض سعر ثانٍ'); s2.click('#rjGo')
    s2.wait_for_selector('.banner.bad', timeout=20000)
    ok('رُفض الطلب' in s2.inner_text('#view'), 'signer 2 rejected → «مرفوض» with reason shown')
    s2.screenshot(path=f'{OUT}/07-rejected.png', full_page=True)
    mails = env({'mails': 1})
    rej = [m for m in mails if 'رُفض' in m['subject'] and po2 in m['subject']]
    ok(rej and PROC in rej[0]['to'] and REQ in rej[0]['to'], 'procurement and requester notified of the rejection')
    ok(not [m for m in mails if S3 in m['to'] and po2 in m['subject']], 'signer 3 never received the request')
    s3 = page_as(br, S3, f'po/{po2}')
    ok(s3.locator('.side .btn.ok').count() == 0, 'signer 3 has no sign action on the rejected PO')

    print('\nC · access request screen')
    nu = 'new.staff@sr.edu.sa'
    ctx = br.new_context(viewport={'width': 1200, 'height': 900}); ctx.route('**/*', router); pg = ctx.new_page()
    pg.goto(f'{BASE}/?as={nu}'); pg.wait_for_selector('#reqForm:not([hidden])')
    ok('لا تملك صلاحية الدخول' in pg.inner_text('body'), 'unlisted user sees «لا تملك صلاحية الدخول» with the request form')
    pg.fill('#rqName', 'موظف جديد'); pg.check('input[value=editor]'); pg.fill('#rqReason', 'أحتاج إنشاء أوامر الشراء الخاصة بإدارتي')
    pg.screenshot(path=f'{OUT}/08-access-request.png', full_page=True)
    pg.click('#rqGo'); pg.wait_for_selector('.msg.ok', timeout=20000)
    ok('أُرسل طلبك' in pg.inner_text('#res'), 'request sent from the UI')
    pg.screenshot(path=f'{OUT}/09-access-sent.png', full_page=True)
    mails = env({'mails': 1})
    ok(any(m['to'] == 'm.elmahdy@sr.edu.sa' and 'طلب صلاحية' in m['subject'] for m in mails), 'e-mail delivered to m.elmahdy@sr.edu.sa')
    ad = page_as(br, OWNER, 'users'); ad.wait_for_selector('tr[data-r]')
    ad.screenshot(path=f'{OUT}/10-users.png', full_page=True)
    ad.click('tr[data-r] .btn.ok'); ad.wait_for_function("!document.querySelector('tr[data-r]')", timeout=20000)
    ok(True, 'admin approved the request in «المستخدمون والصلاحيات»')
    pg.goto(f'{BASE}/?as={nu}'); pg.wait_for_selector('#view h2', timeout=20000)
    ok('محرر' in pg.inner_text('#meRole'), 'the new user now enters the platform as Editor')
    br.close()
print(f'\n{passed} browser checks passed ✔')
