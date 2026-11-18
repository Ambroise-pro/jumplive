"""Tests de bout en bout dans Chrome avec CAMÉRA SIMULÉE (mire de Chrome) et FAUX modèle IA.
Parcours : accueil → calibration sur photo → série de sauts autonome → terminer → accueil.
Usage : pip install playwright && python3 tests/e2e_playwright.py [chemin_chrome]
Ce n'est PAS une validation sur matériel réel : voir README.
"""
import subprocess, sys, os, time
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
        # l'assistant de calibration au démarrage est testé dans e2e_calibration.py ; pas de décompte ici
        ctx.add_init_script("if (!localStorage.getItem('jml.settings.v1')) localStorage.setItem('jml.settings.v1', JSON.stringify({ showWizard: false, detectDelaySec: 0 }))")
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))

        def wait(js, t=15000): page.wait_for_function(js, timeout=t)
        def ev(js, arg=None): return page.evaluate(js, arg)
        def hidden(sel): return ev(f'document.querySelector("{sel}").classList.contains("hidden")')

        def long_press(sel='#homeGear'):
            bb = page.locator(sel).bounding_box()
            page.mouse.move(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2)
            page.mouse.down(); page.wait_for_timeout(1250); page.mouse.up()

        def drag_native(src, dst):
            cb = page.locator('#view').bounding_box()
            a = ev('pt => JML.toView(pt)', src); c = ev('pt => JML.toView(pt)', dst)
            page.mouse.move(cb['x'] + a['x'], cb['y'] + a['y']); page.mouse.down()
            page.mouse.move(cb['x'] + c['x'], cb['y'] + c['y'], steps=8); page.mouse.up()

        def tools():
            if hidden('#tools'): page.click('#btnTools')

        # 1. Démarrage : accueil, caméra, IA réelle indisponible ici (CDN bloqué) → état explicite
        page.goto(URL)
        wait('window.JML && document.querySelector("#video").videoWidth > 0')
        W, H = ev('[document.querySelector("#video").videoWidth, document.querySelector("#video").videoHeight]')
        check('caméra démarrée', W > 0, f'{W}×{H}')
        page.wait_for_timeout(300)
        check('accueil affiché, bouton bloqué sans calibration', not hidden('#home') and ev('document.querySelector("#btnStart").disabled')
              and 'Calibration' in page.inner_text('#startSub'), page.inner_text('#startSub'))
        wait('JML.aiState === "error" || JML.aiState === "ready"', 40000)
        check('modèle IA : état explicite', ev('JML.aiState') in ('error', 'ready'), ev('JML.aiErr')[:80])
        page.screenshot(path=f'{OUT}/01_accueil_sans_calibration.png')

        # 2. Paramètres par appui long, calibration manuelle SUR PHOTO (affichage miroir actif)
        page.click('#homeGear'); page.wait_for_timeout(200)
        check('appui court n’ouvre pas les paramètres', hidden('#admin'))
        long_press()
        check('appui long ouvre les paramètres', not hidden('#admin'))
        page.click('#btnCal')
        wait('JML.edit && JML.edit.photo')
        check('calibration : photo prise et affichée', ev('!!JML.edit.photo') and hidden('#home') and not hidden('#editRetake'))
        f1 = ev('document.querySelector("#view").toDataURL().length'); page.wait_for_timeout(700)
        check('photo figée (la mire animée ne bouge plus)', ev('document.querySelector("#view").toDataURL().length') == f1)
        e = ev('JML.edit'); y1 = H * 0.3
        drag_native(e['p1'], {'x': W / 2, 'y': y1})
        drag_native(e['p2'], {'x': W / 2, 'y': y1 + 120})
        page.screenshot(path=f'{OUT}/02_calibration_photo.png')
        page.click('#editSave')
        cal = ev('JML.cal')
        d = ((cal['p2']['x'] - cal['p1']['x']) ** 2 + (cal['p2']['y'] - cal['p1']['y']) ** 2) ** 0.5
        check('calibration enregistrée (repère natif)', abs(d - 120) < 4 and abs(cal['cmPerPx'] - 29.7 / d) < 1e-9, f'A4 = {d:.1f} px, {cal["cmPerPx"]:.4f} cm/px')
        page.wait_for_timeout(300)
        check('retour à l’accueil, bouton actif', not hidden('#home') and not ev('document.querySelector("#btnStart").disabled'))

        # 2b. Détection impossible (pas de feuille dans la mire) → placement manuel proposé sur la photo
        long_press(); page.click('#btnWizard'); page.click('[data-detect="white"]')
        wait('JML.edit && JML.edit.photo', 20000)
        check('détection impossible → repères à la main sur la photo', ev('JML.edit.detect') is None and 'impossible' in page.inner_text('#editTxt'), page.inner_text('#editTxt')[:120])
        page.click('#editCancel'); page.wait_for_timeout(300); page.click('#wzContinue'); page.wait_for_timeout(300)
        check('calibration précédente conservée après annulation', ev('JML.calStatus.valid') and abs(ev('JML.cal.cmPerPx') - cal['cmPerPx']) < 1e-12)

        # 3. Persistance après rechargement
        page.reload(); wait('document.querySelector("#video").videoWidth > 0'); page.wait_for_timeout(500)
        check('calibration conservée après rechargement', ev('JML.calStatus.valid'))

        # 4. Changement de résolution → calibration invalide, puis retour
        long_press(); page.click('summary:has-text("Caméra")')
        page.select_option('select[data-s="resolution"]', '640x480'); page.click('#btnCamApply'); page.wait_for_timeout(2500)
        W2, H2 = ev('[document.querySelector("#video").videoWidth, document.querySelector("#video").videoHeight]')
        if (W2, H2) != (W, H):
            check('résolution modifiée → calibration invalide, accueil bloqué', not ev('JML.calStatus.valid'), ev('JML.calStatus.reasons.join()'))
        else:
            check('résolution modifiée (caméra simulée inchangée)', True, 'non testable ici')
        page.select_option('select[data-s="resolution"]', '1280x720'); page.click('#btnCamApply'); page.wait_for_timeout(2500)
        check('retour à la résolution d’origine → calibration valide', ev('JML.calStatus.valid'))
        page.click('#adminClose')

        # 5. Série en mode manuel (outils professeur) avec tampon vidéo
        page.click('#btnStart'); page.wait_for_timeout(300)
        check('commencer → série ouverte', ev('JML.screen') == 'session' and hidden('#home'))
        tools(); page.click('[data-mode="manual"]'); page.wait_for_timeout(3000)
        page.click('#btnVerify'); page.wait_for_timeout(300)
        n = ev('JML.R ? JML.R.frames.length : 0')
        check('tampon figé pour vérification', n >= 30, f'{n} images')
        page.click('#rvSetRef')
        for _ in range(5): page.click('#rvPrev')
        page.click('#rvSetTop')
        for _ in range(40): page.click('#rvUp')
        expected = 20 + 40 * cal['cmPerPx']  # ligne sommet placée par défaut 20 cm au-dessus du départ
        shown = float(page.inner_text('#resultVal').replace(',', '.'))
        check('mesure manuelle = 20 cm + 40 px natifs × cm/px', abs(shown - expected) < 0.06, f'{shown} cm (attendu {expected:.2f})')
        before = ev('JML.R.yTop')
        cb = page.locator('#view').bounding_box(); v = ev('y => JML.toView({x: 100, y})', before)
        page.mouse.move(cb['x'] + cb['width'] / 2, cb['y'] + v['y']); page.mouse.down()
        page.mouse.move(cb['x'] + cb['width'] / 2, cb['y'] + v['y'] - 30, steps=5); page.mouse.up()
        check('ligne déplacée au doigt (conversion vue → natif)', ev('JML.R.yTop') < before - 20)
        page.click('#rvSave'); page.click('#rvClose')
        check('mesure manuelle ajoutée à la série', ev('JML.session.entries.length') == 1 and ev('JML.history[0].manual') is not None)
        page.click('#btnEnd'); page.wait_for_timeout(300)
        check('terminer → retour à l’accueil, série fermée', ev('JML.screen') == 'home' and ev('JML.session') is None and not hidden('#home'))

        # 6. Série autonome en mode IA (faux modèle : 3 sauts de 38, 48 et 33 cm, sans toucher la tablette)
        ev('''() => { const s = JSON.parse(localStorage.getItem("jml.settings.v1")); s.mode = "ai"; s.mpBase = "./tests/mock-mediapipe";
                     localStorage.setItem("jml.settings.v1", JSON.stringify(s)); }''')
        page.reload(); wait('document.querySelector("#video").videoWidth > 0')
        ev('() => { window.__MOCK_CMPX = JML.cal.cmPerPx; window.__MOCK_FLIGHTS = [30, 40, 25]; window.__MOCK_PERIOD = 6500; }')
        wait('JML.aiState === "ready"')
        # logo de TEST (image générée) importé depuis les paramètres
        from PIL import Image, ImageDraw
        lg = Image.new('RGBA', (400, 160), (255, 255, 255, 0)); d = ImageDraw.Draw(lg)
        d.ellipse([10, 10, 150, 150], fill=(220, 38, 38, 255)); d.rectangle([170, 50, 390, 110], fill=(37, 99, 235, 255))
        lg.save(f'{OUT}/logo_test.png')
        page.set_input_files('#logoFile', f'{OUT}/logo_test.png')
        wait('!!JML.logoImg', 5000)
        check('logo importé et affiché à l’accueil', not hidden('#homeLogo') and ev('localStorage.getItem("jml.logo.v1") || ""').startswith('data:image/png'))
        page.click('#btnStart')
        seen, texts, shots = set(), set(), set()
        t0 = time.time()
        while time.time() - t0 < 26 and ev('JML.session.entries.length') < 3:
            st = ev('JML.detector.state'); seen.add(st); texts.add(page.inner_text('#bigTxt'))
            if ev('JML.showingResultPhoto()'): seen.add('PHOTO')
            if st == 'READY' and 'ready' not in shots: page.screenshot(path=f'{OUT}/03_vous_pouvez_sauter.png'); shots.add('ready')
            if st == 'RESULT' and ev('JML.session.entries.length') == 2 and 'res' not in shots:
                page.wait_for_timeout(200); page.screenshot(path=f'{OUT}/04_resultat_record.png'); shots.add('res')
            page.wait_for_timeout(80)
        vals = ev('JML.session.entries.map(e => e.ai)')
        check('machine à états parcourue', {'WAITING', 'STABILIZING', 'READY', 'JUMPING', 'RESULT'} <= seen, ','.join(sorted(seen)))
        check('consignes géantes affichées', any('VOUS POUVEZ SAUTER' in t.replace('\xa0', ' ') for t in texts) and any('Ne bougez plus' in t for t in texts), ' | '.join(sorted(texts))[:160])
        check('3 sauts enchaînés sans toucher la tablette', len(vals) == 3 and all(abs(a - b) < 2.5 for a, b in zip(vals, [38, 48, 33])),
              ', '.join(f'{v:.1f}' for v in vals))
        best = ev('JML.bestOf(JML.session)')
        check('meilleur saut retenu', best and abs(best['ai'] - max(vals)) < 1e-9 and page.inner_text('#bestVal').replace(',', '.') == f'{max(vals):.1f}',
              page.inner_text('#bestVal'))
        check('record signalé au 2e saut', ev('JML.session.entries[1].isRecord') and not ev('JML.session.entries[2].isRecord'))
        page.wait_for_timeout(800)
        page.screenshot(path=f'{OUT}/05_serie_3_sauts.png')

        # 6b. Photo au sommet : affichée pendant le résultat, vignette, visionneuse, envoi
        check('photo au sommet affichée à l’écran pendant le résultat', 'PHOTO' in seen)
        ph = ev('JML.session.entries.map(e => e.photo && { w: e.photo.w, h: e.photo.h, kb: Math.round(e.photo.blob.size / 1024) })')
        check('logo sur l’écran de mesure et sur les photos', not hidden('#stageLogo') and ev('JML.session.entries.every(e => e.photo && e.photo.logo)'))
        check('photo au sommet enregistrée pour chaque saut', all(ph) and ph[0]['w'] == W and ph[0]['h'] == H + round(H * 0.22), str(ph))
        apex_ok = ev('JML.session.entries.every(e => e.apex && Math.abs(e.apex.apexY - (e.apex.refY - e.ai / JML.cal.cmPerPx)) < 0.01)')
        check('lignes départ/sommet de la photo = valeurs mesurées', apex_ok)
        page.click('#lastPhoto'); page.wait_for_timeout(500)
        nat = ev('[document.querySelector("#viewerImg").naturalWidth, document.querySelector("#viewerImg").naturalHeight]')
        check('visionneuse : photo + performance', ev('JML.viewerOpen') and nat[0] == W and 'Mail' in page.inner_text('#vMsg'), f'{nat}')
        page.screenshot(path=f'{OUT}/05b_photo_sommet.png')
        n_before = ev('JML.session.entries.length'); page.wait_for_timeout(3000)
        check('analyse en pause pendant la visionneuse', ev('JML.session.entries.length') == n_before)
        with page.expect_download() as dl:
            page.click('#vShare')
        check('envoyer : partage système ou, à défaut, photo enregistrée', dl.value.suggested_filename.endswith('cm.jpg'), dl.value.suggested_filename)
        page.click('#vClose')
        check('fermeture de la visionneuse', not ev('JML.viewerOpen'))

        # 7. Vérification du dernier saut pré-remplie depuis l'IA (outils), suppression du dernier saut
        tools(); page.click('#btnVerify'); page.wait_for_timeout(300)
        rv = ev('JML.R && ({ai: !!JML.R.clip.ai, n: JML.R.frames.length})')
        shown = float(page.inner_text('#resultVal').replace(',', '.'))
        check('vérification pré-remplie depuis l’IA', rv and rv['ai'] and abs(shown - vals[-1]) < 0.05, f"{rv and rv['n']} images, {shown} cm")
        page.click('#rvClose')
        page.click('#btnDelLast')
        check('suppression du dernier saut', ev('JML.session.entries.length') == 2)

        # 8. Deux personnes → aucune mesure
        page.click('#btnNew'); ev('() => { window.__MOCK_TWO = true; }')
        n0 = ev('JML.session.entries.length'); page.wait_for_timeout(7500)
        check('deux personnes : pas de mesure', ev('JML.session.entries.length') == n0, page.inner_text('#bigTxt'))
        ev('() => { window.__MOCK_TWO = false; }')
        page.click('#btnEnd'); page.wait_for_timeout(300)
        check('terminer → accueil, historique conservé côté professeur', ev('JML.screen') == 'home' and ev('JML.history.length') >= 3)
        check('photos effacées à la fin de la série', ev('JML.history.every(h => !h.photo && !h.apex)'))  # historique en mémoire (rechargé à l’étape 6)
        page.screenshot(path=f'{OUT}/06_accueil.png')

        # 9. Rotation simulée (calibration enregistrée en orientation inverse)
        ev('''() => { const c = JSON.parse(localStorage.getItem("jml.calibration.v1")); [c.videoWidth, c.videoHeight] = [c.videoHeight, c.videoWidth];
                     localStorage.setItem("jml.calibration.v1", JSON.stringify(c)); }''')
        page.reload(); wait('document.querySelector("#video").videoWidth > 0'); page.wait_for_timeout(500)
        check('rotation détectée → calibration invalide, accueil bloqué', 'Orientation' in ev('JML.calStatus.reasons.join()') and ev('document.querySelector("#btnStart").disabled'))

        check('aucune erreur JavaScript', not errors, '; '.join(errors)[:300])

        # 10. Mise en page portrait (smartphone, tablette) : accueil puis série
        for name, vp in [('08_smartphone', {'width': 390, 'height': 844}), ('09_tablette_portrait', {'width': 800, 'height': 1280})]:
            c2 = b.new_context(viewport=vp, permissions=['camera'], device_scale_factor=2)
            c2.add_init_script("""localStorage.setItem('jml.settings.v1', JSON.stringify({ showWizard: false, mode: 'ai', mpBase: './tests/mock-mediapipe' }));
              localStorage.setItem('jml.calibration.v1', JSON.stringify({ p1: {x: 640, y: 216}, p2: {x: 640, y: 336}, cmPerPx: 29.7/120, refCm: 29.7, method: 'manual', videoWidth: 1280, videoHeight: 720, date: new Date().toISOString() }));""")
            p2 = c2.new_page(); p2.goto(URL); p2.wait_for_function('document.querySelector("#video").videoWidth > 0', timeout=15000)
            p2.wait_for_timeout(1200); p2.screenshot(path=f'{OUT}/{name}_accueil.png')
            if not p2.evaluate('document.querySelector("#btnStart").disabled'):
                p2.evaluate('() => { window.__MOCK_CMPX = 29.7/120; }')
                p2.click('#btnStart'); p2.wait_for_timeout(9000); p2.screenshot(path=f'{OUT}/{name}_serie.png')
            c2.close()
        b.close()
finally:
    srv.terminate()

ok = sum(1 for _, c in results if c)
print(f'\n{ok}/{len(results)} vérifications réussies')
sys.exit(0 if ok == len(results) else 1)
