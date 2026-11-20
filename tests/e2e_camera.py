"""Changement de caméra avec DEUX caméras simulées par Chrome.
Usage : python3 tests/e2e_camera.py [chemin_chrome]"""
import subprocess, sys, os, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = sys.argv[1] if len(sys.argv) > 1 else '/usr/bin/google-chrome'
PORT = 8768; URL = f'http://localhost:{PORT}/index.html'
results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond))); print(('OK   ' if cond else 'ÉCHEC'), name, detail)

srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.8)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME, args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream=device-count=2', '--no-sandbox'])
        ctx = b.new_context(viewport={'width': 1280, 'height': 800}, permissions=['camera'])
        ctx.add_init_script("""if (!localStorage.getItem('jml.settings.v1')) localStorage.setItem('jml.settings.v1', JSON.stringify(
          { showWizard: false, detectDelaySec: 0, measureMode: 'long' }))""")
        page = ctx.new_page(); errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        ev = page.evaluate
        def long_press(sel='#homeGear'):
            bb = page.locator(sel).bounding_box(); page.mouse.move(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2)
            page.mouse.down(); page.wait_for_timeout(1250); page.mouse.up()
        page.goto(URL); page.wait_for_function('document.querySelector("#video").videoWidth > 0 && JML.cameras.length > 0', timeout=15000)
        cams = ev('JML.cameras.map(c => c.id)'); cam1 = ev('JML.curDeviceId')
        check('deux caméras détectées', len(cams) == 2, ', '.join(ev('JML.cameras.map(c => c.label)')))

        # calibration longueur sur le direct : changement de caméra depuis la barre
        long_press(); page.click('#btnCalLong'); page.wait_for_function('JML.edit && JML.edit.kind === "calLong"')
        check('bouton caméra dans la barre de calibration', ev('!document.querySelector("#editCam").classList.contains("hidden")'))
        page.click('#editCam'); page.wait_for_function(f'JML.curDeviceId && JML.curDeviceId !== "{cam1}" && document.querySelector("#video").videoWidth > 0', timeout=10000)
        cam2 = ev('JML.curDeviceId')
        check('caméra changée pendant la calibration, réglage toujours ouvert', cam2 != cam1 and ev('JML.edit && JML.edit.kind') == 'calLong', page.inner_text('#editTxt')[-60:])
        page.click('#editSave'); page.wait_for_timeout(300)
        check('calibration longueur liée à la 2e caméra', ev('JML.calLong.deviceId') == cam2 and ev('JML.calLongStatus.valid'))

        # retour à la 1re caméra → calibration longueur invalide
        long_press(); page.click('summary:has-text("Caméra")'); page.click('#admin .camswitch')
        page.wait_for_function(f'JML.curDeviceId === "{cam1}"', timeout=10000); page.wait_for_timeout(400)
        check('autre caméra → calibration longueur signalée invalide', not ev('JML.calLongStatus.valid') and 'Caméra différente' in ev('JML.calLongStatus.reasons.join()'))
        page.click('#adminClose')

        # changement de mode : la longueur reprend sa caméra
        page.click('[data-measure="vertical"]'); page.wait_for_timeout(300)
        page.click('[data-measure="long"]')
        page.wait_for_function(f'JML.curDeviceId === "{cam2}"', timeout=10000); page.wait_for_timeout(400)
        check('mode longueur → bascule automatique sur sa caméra, calibration valide', ev('JML.calLongStatus.valid') and not ev('document.querySelector("#btnStart").disabled'))

        # assistant : bouton et nom de la caméra active
        long_press(); page.click('#btnWizard'); page.wait_for_timeout(300)
        check('écran Calibration : bouton et caméra active affichés', 'Caméra active' in page.inner_text('#wizard .camname'), page.inner_text('#wizard .camname'))
        check('persistance du choix de caméra', ev('JML.S.deviceId') == cam2)
        check('aucune erreur JavaScript', not errors, '; '.join(errors)[:300])
        b.close()
finally:
    srv.terminate()
ok = sum(1 for _, c in results if c)
print(f'\n{ok}/{len(results)} vérifications réussies')
sys.exit(0 if ok == len(results) else 1)
