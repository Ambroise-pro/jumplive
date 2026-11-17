"""Test de bout en bout des 3 boutons de détection automatique, avec une FAUSSE CAMÉRA qui diffuse une scène
synthétique : la vraie feuille-calibration.html (rendue par Chrome) incrustée, inclinée, dans un décor de gymnase.
Usage : python3 tests/e2e_calibration.py [chrome] [opencv.js]   (nécessite playwright, Pillow, numpy, ffmpeg)
"""
import os, sys, subprocess, time, shutil
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = sys.argv[1] if len(sys.argv) > 1 else '/usr/bin/google-chrome'
OCV_SRC = sys.argv[2] if len(sys.argv) > 2 else os.environ.get('OPENCV_JS', '')
OUT = os.environ.get('SHOTS', '/tmp/jml-shots-cal'); os.makedirs(OUT, exist_ok=True)
PORT = 8766; BASE = f'http://localhost:{PORT}'
SHEET_H = 150      # hauteur de la feuille dans la scène (px natifs) → attendu 29,7/150 cm/px
TILT = 2.0         # inclinaison (degrés)
results = []

def check(name, cond, detail=''):
    results.append((name, bool(cond))); print(('OK   ' if cond else 'ÉCHEC'), name, detail)

cache = os.path.join(ROOT, 'tests', '.cache'); os.makedirs(cache, exist_ok=True)
if OCV_SRC and os.path.exists(OCV_SRC): shutil.copy(OCV_SRC, os.path.join(cache, 'opencv.js'))
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.8)
try:
    with sync_playwright() as p:
        # 1. rendu de la feuille imprimable
        b = p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
        pg = b.new_page(viewport={'width': 900, 'height': 1300}, device_scale_factor=2)
        pg.goto(f'{BASE}/feuille-calibration.html'); pg.wait_for_timeout(300)
        pg.locator('.sheet').screenshot(path=f'{cache}/sheet.png'); b.close()

        # 2. scène de gymnase
        W, H = 1280, 720
        y = np.linspace(0, 1, H)[:, None]; x = np.linspace(0, 1, W)[None, :]
        wall = 150 + 25 * x - 15 * y
        img = np.stack([wall * 1.05, wall, wall * 0.9], -1)
        img[560:] = np.array([95, 80, 65])                          # parquet
        sc = Image.fromarray(np.clip(img, 0, 255).astype('uint8'))
        d = ImageDraw.Draw(sc)
        d.rectangle([60, 60, 360, 220], fill=(250, 250, 245))       # fenêtre lumineuse
        for i in range(8): d.rectangle([900 + i * 40, 120, 912 + i * 40, 560], fill=(120, 80, 50))  # espalier
        d.rectangle([905, 200, 1220, 210], fill=(120, 80, 50))
        d.ellipse([180, 300, 240, 360], fill=(50, 40, 40)); d.rectangle([170, 360, 250, 560], fill=(40, 45, 70))  # silhouette
        d.rectangle([1100, 600, 1240, 700], fill=(235, 235, 235))    # tapis clair au sol
        sh = Image.open(f'{cache}/sheet.png').convert('RGB')
        sw = round(SHEET_H * sh.width / sh.height)
        sh = sh.resize((sw, SHEET_H), Image.LANCZOS).convert('RGBA').rotate(TILT, resample=Image.BICUBIC, expand=True)
        cx, cy = 640, 330
        sc.paste(sh, (round(cx - sh.width / 2), round(cy - sh.height / 2)), sh)
        sc = sc.filter(ImageFilter.GaussianBlur(0.8))
        a = np.asarray(sc).astype(float); a += np.random.default_rng(1).normal(0, 4, a.shape)
        sc = Image.fromarray(np.clip(a, 0, 255).astype('uint8')); sc.save(f'{OUT}/00_scene.png')
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-loop', '1', '-i', f'{OUT}/00_scene.png', '-t', '2', '-r', '30',
                        '-pix_fmt', 'yuv420p', f'{cache}/scene.y4m'], check=True)
        exp_a4 = 29.7 / SHEET_H
        exp_mk = 20.0 / (SHEET_H * 200 / 297)

        # 3. application avec la scène comme caméra
        b = p.chromium.launch(executable_path=CHROME, args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
                              f'--use-file-for-fake-video-capture={cache}/scene.y4m', '--no-sandbox'])
        ctx = b.new_context(viewport={'width': 1280, 'height': 800}, permissions=['camera'])
        if os.path.exists(f'{cache}/opencv.js'):
            ctx.add_init_script("""if (!localStorage.getItem('jml.settings.v1'))
              localStorage.setItem('jml.settings.v1', JSON.stringify({ opencvUrl: './tests/.cache/opencv.js', mode: 'manual' }));""")
        page = ctx.new_page(); errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        ev = page.evaluate
        page.goto(f'{BASE}/index.html')
        page.wait_for_function('document.querySelector("#video").videoWidth > 0', timeout=15000)
        check('écran de calibration affiché au démarrage', ev('JML.wizardOpen'))
        page.wait_for_timeout(800)
        page.screenshot(path=f'{OUT}/01_assistant.png')

        def detect(method, timeout=90000):
            page.click(f'[data-detect="{method}"]')
            page.wait_for_function('JML.edit || /Échec/.test(document.querySelector("#wzMsg").textContent)', timeout=timeout)
            return ev('JML.edit && { h: JML.edit.detect.heightPx, ref: JML.edit.refCm, conf: JML.edit.detect.confidence, n: JML.edit.detect.success + "/" + JML.edit.detect.frames, ms: JML.edit.detect.ms, spread: JML.edit.detect.spreadPx }'), page.inner_text('#wzMsg')

        for method, exp, label in [('white', exp_a4, '1 · feuille blanche'), ('opencv', exp_a4, '2 · OpenCV'), ('markers', exp_mk, '3 · marqueurs')]:
            if method == 'opencv' and not os.path.exists(f'{cache}/opencv.js'):
                check(label, True, 'ignoré : OpenCV non fourni'); continue
            r, msg = detect(method)
            if r:
                got = r['ref'] / r['h']; err = abs(got / exp - 1) * 100
                check(f'{label} : détectée, erreur < 1 %', err < 1, f"{got:.4f} cm/px (attendu {exp:.4f}) · erreur {err:.2f} % · confiance {r['conf']*100:.0f} % · {r['n']} images · ±{r['spread']:.2f} px · {r['ms']:.0f} ms")
                page.screenshot(path=f'{OUT}/02_{method}.png')
                if method != 'markers': page.click('#editCancel'); page.wait_for_timeout(300)
            else:
                check(f'{label} : détectée', False, msg)
                ev('() => { if (JML.edit) document.querySelector("#editCancel").click(); }')

        page.click('#editSave'); page.wait_for_timeout(300)
        cal = ev('JML.cal')
        check('calibration « marqueurs » enregistrée (étalon 20 cm)', cal and cal['method'] == 'markers' and cal['refCm'] == 20 and ev('JML.calStatus.valid'),
              f"{cal and cal['cmPerPx']:.4f} cm/px")
        ev('() => document.querySelector("#btnWizard").click()'); page.wait_for_timeout(400)
        n = ev('Object.keys(JML.wzResults).length')
        check('tableau comparatif des méthodes', n >= 2, f'{n} méthodes')
        page.screenshot(path=f'{OUT}/03_comparaison.png')
        page.click('#wzContinue')
        page.reload(); page.wait_for_function('document.querySelector("#video").videoWidth > 0', timeout=15000); page.wait_for_timeout(500)
        check('après rechargement : assistant affiché, calibration valide', ev('JML.wizardOpen') and ev('JML.calStatus.valid'))
        # distance de marqueurs corrigée (impression non à 100 %)
        page.fill('input[data-s="markerDistCm"]', '19.5'); page.dispatch_event('input[data-s="markerDistCm"]', 'change')
        r, msg = detect('markers')
        check('distance de marqueurs saisie prise en compte', r and abs(r['ref'] - 19.5) < 1e-9, msg)
        page.click('#editCancel'); page.click('#wzContinue')
        check('aucune erreur JavaScript', not errors, '; '.join(errors)[:300])
        b.close()
finally:
    srv.terminate()

ok = sum(1 for _, c in results if c)
print(f'\n{ok}/{len(results)} vérifications réussies')
sys.exit(0 if ok == len(results) else 1)
