"""Test de bout en bout du SAUT EN LONGUEUR : caméra simulée + faux modèle IA (vue de profil SIMULÉE).
Usage : python3 tests/e2e_long.py [chemin_chrome]"""
import subprocess, sys, os, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = sys.argv[1] if len(sys.argv) > 1 else '/usr/bin/google-chrome'
OUT = os.environ.get('SHOTS', '/tmp/jml-shots-long'); os.makedirs(OUT, exist_ok=True)
PORT = 8767; URL = f'http://localhost:{PORT}/index.html'
results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond))); print(('OK   ' if cond else 'ÉCHEC'), name, detail)

srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.8)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME, args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'])
        ctx = b.new_context(viewport={'width': 1280, 'height': 800}, permissions=['camera'])
        ctx.add_init_script("""if (!localStorage.getItem('jml.settings.v1')) localStorage.setItem('jml.settings.v1', JSON.stringify(
          { showWizard: false, detectDelaySec: 0, mode: 'ai', mpBase: './tests/mock-mediapipe', measureMode: 'long' }))""")
        page = ctx.new_page(); errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        ev = page.evaluate
        def hidden(sel): return ev(f'document.querySelector("{sel}").classList.contains("hidden")')
        def long_press(sel='#homeGear'):
            bb = page.locator(sel).bounding_box(); page.mouse.move(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2)
            page.mouse.down(); page.wait_for_timeout(1250); page.mouse.up()
        def drag_native(src, dst):
            cb = page.locator('#view').bounding_box(); a = ev('pt => JML.toView(pt)', src); c = ev('pt => JML.toView(pt)', dst)
            page.mouse.move(cb['x'] + a['x'], cb['y'] + a['y']); page.mouse.down(); page.mouse.move(cb['x'] + c['x'], cb['y'] + c['y'], steps=8); page.mouse.up()

        page.goto(URL); page.wait_for_function('document.querySelector("#video").videoWidth > 0', timeout=15000)
        W, H = ev('[document.querySelector("#video").videoWidth, document.querySelector("#video").videoHeight]')
        page.wait_for_timeout(300)
        check('écran de choix au démarrage', not hidden('#choice'))
        page.click('[data-choose="long"]')
        page.wait_for_function('JML.longCalOpen && JML.edit && JML.edit.kind === "calLong"', timeout=10000)
        check('longueur → écran de calibration dédié (pas celui de la détente)', not hidden('#longcal') and not ev('JML.wizardOpen') and hidden('#editbar')
              and 'Saut en longueur' in page.inner_text('#longcal h2') and hidden('#lcKeep'))
        f1 = ev('document.querySelector("#view").toDataURL().length'); page.wait_for_timeout(700)
        live = ev('document.querySelector("#view").toDataURL().length') != f1
        check('calibration longueur sur l’image en direct (pas de photo)', ev('JML.edit.photo') is None and live and 'direct' in page.inner_text('#lcInfo'))
        page.click('#lcFreeze'); page.wait_for_timeout(300)
        f2 = ev('document.querySelector("#view").toDataURL().length'); page.wait_for_timeout(700)
        check('« Figer l’image » gèle le direct', ev('!!JML.edit.photo') and ev('document.querySelector("#view").toDataURL().length') == f2)
        page.click('#lcFreeze'); page.wait_for_timeout(200)
        check('retour au direct', ev('JML.edit.photo') is None)
        sel = '#longcal input[data-s="longD2"]'
        page.fill(sel, '250'); page.dispatch_event(sel, 'change')
        check('distance d’un repère modifiable dans l’écran de calibration', ev('JML.S.longD2') == 250 and '2,50 m' in page.inner_text('#lcInfo'))
        page.fill(sel, '200'); page.dispatch_event(sel, 'change')
        k = 3.0; p0x = round(W * 0.2); gy = round(H * 0.86)
        e = ev('JML.edit')
        for i, x in enumerate([p0x, p0x + 100 * k, p0x + 200 * k]):
            drag_native(e[f'p{i}'], {'x': x, 'y': gy})
        page.screenshot(path=f'{OUT}/02_calibration_longueur.png')
        page.click('#lcSave'); page.wait_for_timeout(300)
        check('valider → accueil des mesures « Saut en longueur »', not hidden('#home') and hidden('#longcal') and 'longueur' in page.inner_text('#homeMode'))
        page.screenshot(path=f'{OUT}/01_accueil_mesures.png')
        cl = ev('JML.calLong')
        ok = cl and abs(cl['p1']['x'] - cl['p0']['x'] - 300) < 4 and abs(cl['p2']['x'] - cl['p0']['x'] - 600) < 4 and cl['d1'] == 100 and cl['d2'] == 200
        check('calibration longueur enregistrée et valide', ok and ev('JML.calLongStatus.valid'), str(ev('JML.calLongStatus.reasons')))
        # repères réellement posés (positions natives après glisser) → le faux saut s'appuie dessus
        kk = (cl['p2']['x'] - cl['p0']['x']) / 200
        ev('c => { window.__MOCK_LONG = c; }', {'p0x': cl['p0']['x'], 'gy': cl['p0']['y'], 'k': kk, 'lands': [180, 210], 'period': 7000, 'upperHidden': True})  # caméra basse : seuls les pieds sont vus
        page.wait_for_function('JML.aiState === "ready"', timeout=15000)
        check('accueil débloqué après calibration', not ev('document.querySelector("#btnStart").disabled'))

        # série : 2 sauts en longueur sans toucher la tablette
        page.click('#btnStart')
        texts, shots = set(), set(); t0 = time.time()
        while time.time() - t0 < 22 and ev('JML.session.entries.length') < 2:
            texts.add(page.inner_text('#bigTxt').replace('\xa0', ' '))
            st = ev('JML.detector.state')
            if st == 'READY' and 'r' not in shots: page.screenshot(path=f'{OUT}/03_pret_regle_au_sol.png'); shots.add('r')
            if st == 'RESULT' and 'res' not in shots and ev('JML.session.entries.length') == 1:
                page.wait_for_timeout(250); page.screenshot(path=f'{OUT}/04_resultat_fleche.png'); shots.add('res')
            page.wait_for_timeout(80)
        vals = ev('JML.session.entries.map(e => e.ai)')
        check('consignes longueur affichées', any('derrière la ligne' in t for t in texts) and any('VOUS POUVEZ SAUTER' in t for t in texts), ' | '.join(sorted(texts))[:200])
        check('2 sauts mesurés avec seulement les pieds visibles (≈ 1,79 m et 2,09 m)', len(vals) == 2 and abs(vals[0] - 179) < 2 and abs(vals[1] - 209) < 2, ', '.join(f'{v:.1f}' for v in vals))
        check('affichage en mètres', page.inner_text('#resultUnit') == 'm' and page.inner_text('#bestVal') == f"{max(vals)/100:.2f}".replace('.', ','), page.inner_text('#bestVal'))
        fp = ev('JML.session.entries[0].fromToesCm')
        check('distance depuis les pointes aussi calculée', fp and abs(fp - 184) < 2.5, f'{fp:.1f}' if fp else '')
        page.wait_for_timeout(600)
        ph = ev('JML.session.entries.map(e => e.photo && e.apex && e.apex.mode)')
        check('photo de la réception enregistrée', ph == ['long', 'long'], str(ph))
        page.click('#lastPhoto'); page.wait_for_timeout(500); page.screenshot(path=f'{OUT}/05_photo_longueur.png')
        page.click('#vClose')

        # vérification manuelle
        page.click('#btnTools'); page.click('#btnVerify'); page.wait_for_timeout(400)
        rv = ev('JML.R && ({ long: JML.R.long, x: JML.R.xLand })')
        shown = float(page.inner_text('#resultVal').replace(',', '.')) * 100
        check('vérification longueur pré-remplie (ligne de réception)', rv and rv['long'] and rv['x'] and abs(shown - vals[-1]) < 1.5, f'{shown:.1f} cm')
        page.screenshot(path=f'{OUT}/06_verification_longueur.png')
        for _ in range(int(round(kk * 10))): page.click('#rvDown')
        shown2 = float(page.inner_text('#resultVal').replace(',', '.')) * 100
        check('ajustement ▶ de 10 cm environ', 7 < abs(shown2 - shown) < 13, f'{shown:.1f} → {shown2:.1f}')
        page.click('#rvSave'); page.click('#rvClose')
        check('valeur vérifiée reportée dans la série', ev('JML.session.entries[1].manual') is not None)
        page.click('#btnEnd'); page.wait_for_timeout(300)

        # changer d'activité (appui long) → choix → détente → retour → longueur (calibration gardée)
        page.click('#btnChangeAct'); page.wait_for_timeout(200)
        check('appui court sur « Changer d’activité » sans effet', ev('JML.screen') == 'home')
        long_press('#btnChangeAct'); page.wait_for_timeout(300)
        check('appui long → écran de choix', not hidden('#choice') and ev('JML.screen') == 'choice')
        page.click('[data-choose="vertical"]'); page.wait_for_function('JML.wizardOpen', timeout=5000)
        check('détente : son propre écran de calibration et son détecteur', ev('JML.detector.constructor.name') == 'JumpDetector' and hidden('#longcal'))
        page.click('#wzBack'); page.wait_for_timeout(200)
        page.click('[data-choose="long"]'); page.wait_for_function('JML.longCalOpen', timeout=5000); page.wait_for_timeout(300)
        check('longueur : calibration existante proposée', not hidden('#lcKeep'))
        page.click('#lcKeep'); page.wait_for_timeout(300)
        check('garder la calibration → mesures prêtes', ev('JML.detector.constructor.name') == 'LongJumpDetector' and not ev('document.querySelector("#btnStart").disabled'))
        check('aucune erreur JavaScript', not errors, '; '.join(errors)[:300])
        b.close()
finally:
    srv.terminate()
ok = sum(1 for _, c in results if c)
print(f'\n{ok}/{len(results)} vérifications réussies')
sys.exit(0 if ok == len(results) else 1)
