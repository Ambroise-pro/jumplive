"""Tablette en PORTRAIT : vidéo portrait (720×1280) diffusée comme caméra + faux modèle IA.
Usage : python3 tests/e2e_portrait.py [chemin_chrome]   (nécessite ffmpeg, Pillow)"""
import subprocess, sys, os, time
import numpy as np
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = sys.argv[1] if len(sys.argv) > 1 else '/usr/bin/google-chrome'
OUT = os.environ.get('SHOTS', '/tmp/jml-shots-portrait'); os.makedirs(OUT, exist_ok=True)
cache = os.path.join(ROOT, 'tests', '.cache'); os.makedirs(cache, exist_ok=True)
PORT = 8769; URL = f'http://localhost:{PORT}/index.html'
results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond))); print(('OK   ' if cond else 'ÉCHEC'), name, detail)

# scène portrait (gymnase simplifié) → y4m
W, H = 720, 1280
y = np.linspace(0, 1, H)[:, None]; img = np.stack([np.full((H, W), 160.0) - 20 * y] * 3, -1); img[1000:] = [95, 80, 65]
sc = Image.fromarray(img.astype('uint8')); d = ImageDraw.Draw(sc)
d.ellipse([330, 330, 390, 390], fill=(40, 40, 40)); d.rectangle([320, 390, 400, 990], fill=(40, 45, 70))   # silhouette
sc.save(f'{OUT}/scene_portrait.png')
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-loop', '1', '-i', f'{OUT}/scene_portrait.png', '-t', '2', '-r', '30', '-pix_fmt', 'yuv420p', f'{cache}/portrait.y4m'], check=True)

srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.8)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME, args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
                              f'--use-file-for-fake-video-capture={cache}/portrait.y4m', '--no-sandbox'])
        ctx = b.new_context(viewport={'width': 800, 'height': 1280}, permissions=['camera'], device_scale_factor=1)
        ctx.add_init_script("""if (!localStorage.getItem('jml.settings.v1')) localStorage.setItem('jml.settings.v1', JSON.stringify(
          { detectDelaySec: 0, mode: 'ai', mpBase: './tests/mock-mediapipe' }))""")
        page = ctx.new_page(); errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        ev = page.evaluate
        page.goto(URL); page.wait_for_function('document.querySelector("#video").videoWidth > 0', timeout=15000)
        vw, vh = ev('[document.querySelector("#video").videoWidth, document.querySelector("#video").videoHeight]')
        check('tablette debout : image portrait', vh > vw, f'{vw}×{vh}')
        check('réglage « Automatique » : orientation portrait demandée', ev('JML.S.camOrient') == 'auto')
        check('mise en page portrait (image agrandie)', ev('document.body.classList.contains("portrait-cam")'))
        # calibration détente : feuille simulée par repères placés à la main (photo) puis série avec le faux modèle
        page.click('[data-choose="vertical"]'); page.wait_for_function('JML.wizardOpen')
        page.click('#wzManual'); page.wait_for_function('JML.edit && JML.edit.photo', timeout=15000)
        cb = page.locator('#view').bounding_box()
        def drag(src, dst):
            a = ev('pt => JML.toView(pt)', src); c = ev('pt => JML.toView(pt)', dst)
            page.mouse.move(cb['x'] + a['x'], cb['y'] + a['y']); page.mouse.down(); page.mouse.move(cb['x'] + c['x'], cb['y'] + c['y'], steps=8); page.mouse.up()
        e = ev('JML.edit'); drag(e['p1'], {'x': 360, 'y': 500}); drag(e['p2'], {'x': 360, 'y': 620})
        page.screenshot(path=f'{OUT}/01_calibration_portrait.png')
        page.click('#editSave'); page.wait_for_timeout(300)
        cal = ev('JML.cal')
        check('calibration en portrait enregistrée (720×1280)', cal['videoWidth'] == vw and cal['videoHeight'] == vh and ev('JML.calStatus.valid'), f"{cal['cmPerPx']:.4f} cm/px")
        ev('c => { window.__MOCK_CMPX = c; window.__MOCK_FLIGHTS = [30, 40]; window.__MOCK_PERIOD = 6500; }', cal['cmPerPx'])
        page.wait_for_function('JML.aiState === "ready"', timeout=15000)
        page.click('#btnStart'); t0 = time.time(); shot = False
        while time.time() - t0 < 18 and ev('JML.session.entries.length') < 2:
            if not shot and ev('JML.detector.state') == 'READY': page.screenshot(path=f'{OUT}/02_pret_portrait.png'); shot = True
            page.wait_for_timeout(100)
        vals = ev('JML.session.entries.map(e => e.ai)')
        check('2 sauts mesurés en portrait (≈ 38 et 48 cm)', len(vals) == 2 and abs(vals[0] - 38) < 2.5 and abs(vals[1] - 48) < 2.5, ', '.join(f'{v:.1f}' for v in vals))
        page.wait_for_timeout(500); page.screenshot(path=f'{OUT}/03_resultat_portrait.png')
        # passage forcé en paysage depuis les paramètres : la calibration portrait n'est plus valable
        ev('() => { const el = document.querySelector("select[data-s=camOrient]"); el.value = "landscape"; el.dispatchEvent(new Event("change")); }')
        page.wait_for_timeout(2500)
        check('réglage « Paysage » : caméra relancée en paysage demandé', ev('JML.S.camOrient') == 'landscape')
        check('aucune erreur JavaScript', not errors, '; '.join(errors)[:300])
        b.close()
finally:
    srv.terminate()
ok = sum(1 for _, c in results if c)
print(f'\n{ok}/{len(results)} vérifications réussies')
sys.exit(0 if ok == len(results) else 1)
