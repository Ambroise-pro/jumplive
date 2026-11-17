"""Tests de bout en bout dans Chrome avec CAMÉRA SIMULÉE (mire de Chrome) et FAUX modèle IA.
Usage : pip install playwright && python3 tests/e2e_playwright.py [chemin_chrome]
Ce n'est PAS une validation sur matériel réel : voir README.
"""
import json, subprocess, sys, os, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = sys.argv[1] if len(sys.argv) > 1 else '/usr/bin/google-chrome'
OUT = os.environ.get('SHOTS', '/tmp/jml-shots'); os.makedirs(OUT, exist_ok=True)
PORT = 8765; URL = f'http://localhost:{PORT}/index.html'
results = []

def check(name, cond, detail=''):
    results.append((name, bool(cond)))
    print(('OK   ' if cond else 'ÉCHEC'), name, detail)

srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.8)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME, args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'])
        ctx = b.new_context(viewport={'width': 1280, 'height': 800}, permissions=['camera'])
        # l'assistant de calibration au démarrage est testé dans e2e_calibration.py
        ctx.add_init_script("if (!localStorage.getItem('jml.settings.v1')) localStorage.setItem('jml.settings.v1', JSON.stringify({ showWizard: false }))")
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))

        def wait(js, t=15000): page.wait_for_function(js, timeout=t)
        def ev(js, arg=None): return page.evaluate(js, arg)

        def long_press_gear():
            bb = page.locator('#gear').bounding_box()
            page.mouse.move(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2)
            page.mouse.down(); page.wait_for_timeout(1250); page.mouse.up()

        def drag_native(src, dst):
            cb = page.locator('#view').bounding_box()
            a = ev('pt => JML.toView(pt)', src); c = ev('pt => JML.toView(pt)', dst)
            page.mouse.move(cb['x'] + a['x'], cb['y'] + a['y']); page.mouse.down()
            page.mouse.move(cb['x'] + c['x'], cb['y'] + c['y'], steps=8); page.mouse.up()

        # 1. Démarrage caméra + IA réelle indisponible (CDN bloqué ici) → erreur explicite
        page.goto(URL)
        wait('window.JML && document.querySelector("#video").videoWidth > 0')
        W, H = ev('[document.querySelector("#video").videoWidth, document.querySelector("#video").videoHeight]')
        check('caméra démarrée', W > 0, f'{W}×{H}')
        check('calibration manquante signalée', 'Calibration manquante' in page.inner_text('#banner'))
        wait('JML.aiState === "error" || JML.aiState === "ready"', 40000)
        st = ev('JML.aiState')
        check('modèle IA : état explicite', st in ('error', 'ready'), f'{st} {ev("JML.aiErr")[:80]}')
        page.wait_for_timeout(1500)
        page.screenshot(path=f'{OUT}/01_demarrage.png')

        # 2. Panneau admin (appui long) + calibration par glisser (affichage miroir actif)
        page.click('#gear'); page.wait_for_timeout(200)
        check('appui court n’ouvre pas les paramètres', ev('document.querySelector("#admin").classList.contains("hidden")'))
        long_press_gear()
        check('appui long ouvre les paramètres', not ev('document.querySelector("#admin").classList.contains("hidden")'))
        page.click('#btnCal')
        e = ev('JML.edit')
        check('assistant masqué si désactivé', not ev('JML.wizardOpen'))
        y1 = H * 0.3
        drag_native(e['p1'], {'x': W / 2, 'y': y1})
        drag_native(e['p2'], {'x': W / 2, 'y': y1 + 120})
        page.screenshot(path=f'{OUT}/02_calibration.png')
        page.click('#editSave')
        cal = ev('JSON.parse(localStorage.getItem("jml.calibration.v1"))')
        d = ((cal['p2']['x'] - cal['p1']['x']) ** 2 + (cal['p2']['y'] - cal['p1']['y']) ** 2) ** 0.5
        check('calibration enregistrée (repère natif)', abs(d - 120) < 4 and abs(cal['cmPerPx'] - 29.7 / d) < 1e-9, f'A4 = {d:.1f} px natifs, {cal["cmPerPx"]:.4f} cm/px')
        check('calibration valide', ev('JML.calStatus.valid'))

        # 3. Persistance après rechargement
        page.reload(); wait('document.querySelector("#video").videoWidth > 0'); page.wait_for_timeout(500)
        check('calibration conservée après rechargement', ev('JML.calStatus.valid'))

        # 4. Changement de résolution → calibration invalide, puis retour
        long_press_gear()
        page.click('summary:has-text("Caméra")')
        page.select_option('select[data-s="resolution"]', '640x480'); page.click('#btnCamApply')
        page.wait_for_timeout(2500)
        W2, H2 = ev('[document.querySelector("#video").videoWidth, document.querySelector("#video").videoHeight]')
        if (W2, H2) != (W, H):
            check('résolution modifiée → calibration invalide', not ev('JML.calStatus.valid'), ev('JML.calStatus.reasons.join()'))
        else:
            check('résolution modifiée (caméra simulée n’a pas changé de taille)', True, 'non testable ici')
        page.select_option('select[data-s="resolution"]', '1280x720'); page.click('#btnCamApply'); page.wait_for_timeout(2500)
        check('retour à la résolution d’origine → calibration valide', ev('JML.calStatus.valid'))
        page.click('#adminClose')

        # 5. Mode manuel avec tampon vidéo
        page.click('[data-mode="manual"]'); page.wait_for_timeout(3000)
        page.click('#btnVerify'); page.wait_for_timeout(300)
        n = ev('JML.R ? JML.R.frames.length : 0')
        check('tampon figé pour vérification', n >= 30, f'{n} images')
        page.click('#rvSetRef')
        for _ in range(5): page.click('#rvPrev')
        page.click('#rvSetTop')
        for _ in range(40): page.click('#rvUp')
        r = ev('({yRef: JML.R.yRef, yTop: JML.R.yTop, refIdx: JML.R.refIdx, topIdx: JML.R.topIdx})')
        expected = 20 + 40 * cal['cmPerPx']  # ligne sommet placée par défaut 20 cm au-dessus du départ
        shown = page.inner_text('#resultVal').replace(',', '.')
        check('mesure manuelle = 20 cm + 40 px natifs × cm/px', abs(float(shown) - expected) < 0.06 and r['refIdx'] - r['topIdx'] == 5, f'{shown} cm (attendu {expected:.2f})')
        page.click('#rvZoom'); page.wait_for_timeout(200)
        page.screenshot(path=f'{OUT}/03_revue_manuelle.png')
        page.click('#rvZoom'); page.click('#rvZoom')
        # glisser la ligne active au doigt
        before = ev('JML.R.yTop')
        cb = page.locator('#view').bounding_box(); v = ev('y => JML.toView({x: 100, y})', before)
        page.mouse.move(cb['x'] + cb['width'] / 2, cb['y'] + v['y']); page.mouse.down()
        page.mouse.move(cb['x'] + cb['width'] / 2, cb['y'] + v['y'] - 30, steps=5); page.mouse.up()
        after = ev('JML.R.yTop')
        check('ligne déplacée au doigt (conversion vue → natif)', after < before - 20, f'{before:.0f} → {after:.0f} px natifs')
        page.click('#rvSave')
        check('mesure manuelle enregistrée', ev('JML.history.length') == 1 and ev('JML.history[0].manual') is not None)
        page.click('#rvClose')

        # 6. Nouveau saut : calibration conservée
        page.click('#btnNew')
        check('nouveau saut conserve la calibration', ev('JML.calStatus.valid'))

        # 7. IA simulée de bout en bout (faux modèle, saut de 38 cm attendu)
        ev('''() => { const s = JSON.parse(localStorage.getItem("jml.settings.v1")); s.mode = "ai"; s.mpBase = "./tests/mock-mediapipe";
                     localStorage.setItem("jml.settings.v1", JSON.stringify(s)); }''')
        page.reload(); wait('document.querySelector("#video").videoWidth > 0')
        ev('() => { window.__MOCK_CMPX = JML.cal.cmPerPx; }')
        wait('JML.aiState === "ready"')
        seen = set()
        t0 = time.time()
        while time.time() - t0 < 12 and not ev('JML.history.some(h => h.ai != null || h.rejected)'):
            seen.add(ev('JML.detector.state')); page.wait_for_timeout(80)
            if 'JUMPING' in seen and not os.path.exists(f'{OUT}/04_ia_saut.png'): page.screenshot(path=f'{OUT}/04_ia_saut.png')
        h = ev('JML.history[0]')
        check('machine à états parcourue', {'WAITING', 'STABILIZING', 'READY', 'JUMPING'} <= seen | {'WAITING'}, ','.join(sorted(seen)))
        check('saut simulé mesuré par l’IA ≈ 38 cm', h and h.get('ai') and abs(h['ai'] - 38) < 2.5, f"{h.get('ai') if h else None} cm, rejet={h.get('rejected') if h else None}")
        page.wait_for_timeout(600)
        page.screenshot(path=f'{OUT}/05_ia_resultat.png')
        page.click('#btnVerify'); page.wait_for_timeout(300)
        rv = ev('JML.R && ({ai: !!JML.R.clip.ai, n: JML.R.frames.length, ref: JML.R.yRef, top: JML.R.yTop})')
        shown = float(page.inner_text('#resultVal').replace(',', '.'))
        check('vérification pré-remplie depuis l’IA', rv and rv['ai'] and abs(shown - h['ai']) < 0.05, f"{rv['n']} images, manuel={shown}")
        page.screenshot(path=f'{OUT}/06_ia_verification.png')
        page.click('#rvClose')

        # 8. Deux personnes → aucune mesure
        page.click('#btnNew'); ev('() => { window.__MOCK_TWO = true; }')
        n0 = ev('JML.history.length'); page.wait_for_timeout(8000)
        check('deux personnes : pas de mesure', ev('JML.history.length') == n0, ev('JML.detector.message'))
        ev('() => { window.__MOCK_TWO = false; }')

        # 9. Rotation simulée (calibration enregistrée en orientation inverse)
        ev('''() => { const c = JSON.parse(localStorage.getItem("jml.calibration.v1")); [c.videoWidth, c.videoHeight] = [c.videoHeight, c.videoWidth];
                     localStorage.setItem("jml.calibration.v1", JSON.stringify(c)); }''')
        page.reload(); wait('document.querySelector("#video").videoWidth > 0'); page.wait_for_timeout(500)
        check('rotation détectée → calibration invalide', 'Orientation' in ev('JML.calStatus.reasons.join()'))
        page.screenshot(path=f'{OUT}/07_rotation.png')

        check('aucune erreur JavaScript', not errors, '; '.join(errors)[:300])

        # 10. Mise en page portrait (smartphone, tablette)
        for name, vp in [('08_smartphone_portrait', {'width': 390, 'height': 844}), ('09_tablette_portrait', {'width': 800, 'height': 1280})]:
            c2 = b.new_context(viewport=vp, permissions=['camera'], device_scale_factor=2)
            p2 = c2.new_page(); p2.goto(URL); p2.wait_for_function('document.querySelector("#video").videoWidth > 0', timeout=15000)
            p2.wait_for_timeout(1500); p2.screenshot(path=f'{OUT}/{name}.png'); c2.close()
        b.close()
finally:
    srv.terminate()

ok = sum(1 for _, c in results if c)
print(f'\n{ok}/{len(results)} vérifications réussies')
sys.exit(0 if ok == len(results) else 1)
