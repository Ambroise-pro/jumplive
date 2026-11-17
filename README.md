# JumpMeasure LIVE

Borne de mesure de détente verticale pour l'EPS, en mode « photocall » : une tablette fixe, un emplacement de saut, les élèves passent les uns après les autres, sans nom ni compte. Les images restent sur l'appareil.

> ⚠️ Outil pédagogique : ce n'est **pas** une mesure biomécanique de laboratoire. Avant tout usage évaluatif, validez-le contre une référence (voir « Validation »).

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Application complète (interface, caméra, tampon vidéo, IA, mode manuel) |
| `core.js` | Calculs purs : px→cm, repère natif ↔ affiché, validation de calibration, machine à états du saut |
| `a4detect.js` | Détection automatique de l'étalon (3 méthodes, voir « Calibration automatique ») |
| `feuille-calibration.html` | Feuille à marqueurs à imprimer à 100 % |
| `tests/core.test.mjs`, `tests/a4detect.test.mjs` | Tests unitaires (`node --test tests/*.test.mjs`) |
| `tests/scene.mjs` | Générateur d'images synthétiques à géométrie connue |
| `tests/e2e_calibration.py` | Test des 3 boutons de détection avec une fausse caméra (scène de gymnase synthétique) |
| `tests/e2e_playwright.py` | Tests de bout en bout dans Chrome avec caméra **simulée** |
| `tests/mock-mediapipe/` | **Faux** modèle IA pour les tests (sujet qui saute 38 cm) |
| `CLAUDE.md` | Cahier des charges / consignes de développement |

Aucun build, aucune dépendance à installer.

## Lancer

La caméra exige **HTTPS** ou `localhost`.

- **En local (ordinateur)** : `python3 -m http.server 8000` dans le dossier, puis ouvrir `http://localhost:8000`.
- **Sur tablette** : déployer (ci-dessous) et ouvrir l'URL HTTPS. Une adresse `http://192.168…` ne donnera pas accès à la caméra.

### Déploiement GitHub + Vercel
1. Pousser le dossier dans un dépôt GitHub.
2. Vercel → *Add New Project* → importer le dépôt → *Framework Preset : Other*, pas de commande de build, *Output Directory* : racine.
3. Ouvrir l'URL `https://….vercel.app` sur la tablette et autoriser la caméra.

## Mise en place (une fois par séance)

1. **Tablette** fixe (pied ou support), en paysage, à environ 2,5–4 m. Le sujet doit être visible **en entier, pieds compris, avec de la marge au-dessus de la tête** pour le saut. Lumière suffisante, fond si possible contrasté.
2. **Paramètres** : **maintenir ⚙ une seconde** (un appui court ne fait rien, pour éviter un recalibrage accidentel).
3. **Caméra** : choisir la caméra (la caméra avant permet aux élèves de voir leur résultat), la résolution, le miroir (affichage seulement).
4. **Calibration** : l'écran *Calibration* s'ouvre au démarrage (désactivable) avec trois boutons de détection automatique, décrits plus bas. Méthode manuelle : tenir ou scotcher une feuille **A4 verticale** (29,7 cm) **à l'endroit où se trouvera le bassin du sauteur** (même distance de la caméra), puis *Placer les repères A4* : glisser les deux repères sur les bords haut et bas (une loupe apparaît sous le doigt) → *Enregistrer*.
5. **Zone de saut** (conseillé) : limiter la zone pour ignorer les personnes qui passent à côté.

La calibration est enregistrée dans le navigateur (`localStorage`) avec la caméra, la résolution, l'orientation et le zoom. À chaque ouverture elle est revérifiée : si l'un d'eux change, un bandeau rouge l'indique et aucune mesure n'est faite tant qu'elle n'est pas refaite. **Si la tablette ou la feuille bouge, recalibrez** : l'application ne peut pas le détecter.

## Calibration automatique (3 méthodes à comparer)

L'écran de démarrage propose trois boutons. Après un appui, un **compte à rebours de 5 s** (réglable de 0 à 30 s, avec un bip à chaque seconde et un bouton *Annuler*) laisse le temps d'aller placer la feuille. Chaque méthode analyse ensuite 5 images (3 pour OpenCV), combine les résultats (médiane), puis **affiche ce qu'il a trouvé** (contour ou marqueurs en vert) avec la confiance et la stabilité. Tu valides avec *Enregistrer* ou tu ajustes les repères au doigt. *Annuler* revient à l'écran de choix. Un tableau compare les méthodes déjà essayées.

1. **Feuille blanche** (JavaScript pur, aucun téléchargement) : cherche une zone claire aux proportions d'une A4 verticale, puis mesure les bords haut et bas au gradient sous-pixel. Il faut un fond **plus sombre** que la feuille. Les murs blancs, les fenêtres et les tapis clairs peuvent tromper la détection : un avertissement s'affiche si une autre forme comparable est trouvée.
2. **Feuille blanche — OpenCV** : OpenCV.js (≈ 10 Mo, téléchargé à la première utilisation depuis docs.opencv.org) trouve le quadrilatère de la feuille, puis les bords sont remesurés comme en 1. En effet, les contours OpenCV sont décalés d'environ 1 px vers l'intérieur, ce qui donnait jusqu'à 5 % d'erreur sur une petite feuille. C'est plus robuste qu'en 1 face aux fonds chargés. Pour un usage hors ligne : `npm pack @techstark/opencv-js@4.10.0-release.1`, copier `dist/opencv.js` dans `vendor/` et renseigner `./vendor/opencv.js` dans *Paramètres → Calibration*.
3. **Feuille à marqueurs** (recommandée) : imprimer `feuille-calibration.html` **à 100 %**. Elle porte deux carrés noirs évidés, dont les centres sont espacés de 20,0 cm. Contrôle avec la règle de 10 cm imprimée ; si l'impression n'est pas exacte, saisir la distance mesurée entre les centres. La détection fonctionne même sur un fond clair. L'étalon mesure 20 cm au lieu de 29,7 cm, mais le centre d'un marqueur se localise plus finement qu'un bord de feuille.

Une limite commune aux trois : la détection ne vérifie **pas** que la feuille est au même plan de profondeur que le bassin. La feuille doit être **retirée avant de sauter**, puisqu'elle est à l'emplacement du saut ; elle ne peut donc pas servir à détecter un déplacement de la caméra pendant la séance.

## Utilisation

- **Mode IA** : l'élève entre dans la zone (« Placez-vous dans la zone »), reste immobile (« Restez immobile… »), puis saute quand « Prêt — sautez ! » s'affiche. La détente s'affiche en grand. Le saut suivant est armé automatiquement après quelques secondes, une fois l'élève de nouveau immobile.
- **Vérifier** : rejoue les images du dernier saut (tampon circulaire). Les lignes sont pré-placées depuis l'IA. Choisir l'image de départ et l'image du sommet, ajuster les lignes au doigt ou avec ▲▼ (1 pixel natif), zoom ×2/×3, puis *Valider* : l'écart manuel − IA s'affiche.
- **Mode manuel** : pas d'IA. Après le saut, *Figer et mesurer* fige les 3 à 5 dernières secondes, puis même procédure.
- **Nouveau saut** : réinitialise l'essai sans couper la caméra ni toucher à la calibration.
- **Mesures de la session** (paramètres) : tableau IA / manuel / écart, export CSV. Rien n'est conservé après fermeture de la page.

Clavier (ordinateur, en vérification) : ←/→ image par image, ↑/↓ ligne (Maj = 5 px).

## Calcul

- `cmParPixel = 29,7 / hauteurA4Pixels` (distance entre les deux repères).
- `détente = (yRéférence − ySommet) × cmParPixel`, axe Y vers le bas.
- Tous les points sont convertis dans le **repère natif de la caméra** (`videoWidth × videoHeight`) : le cadrage (image entière ou recadrée), le miroir, le zoom de vérification et la densité de pixels de l'écran sont compensés. Le tampon peut être à plus basse résolution : les lignes restent en coordonnées natives.
- **Référence** : médiane de la position du bassin (milieu des deux hanches) sur une fenêtre d'immobilité (0,7 s par défaut).
- **Sommet** : position la plus haute du bassin entre le décollage et la réception.

## Détection IA

MediaPipe Pose Landmarker (version 0.10.14, figée), exécuté dans le navigateur. Machine à états : `WAITING → STABILIZING → READY → JUMPING → RESULT → WAITING`.

- **Décollage** : le bassin monte d'au moins 3 cm **et** le point le plus bas de **chaque pied** (talon ou pointe) monte d'au moins 2,5 cm. Une montée sur pointes (talons levés, pointes au sol) n'est donc pas comptée, et le message « Montée sur pointes : non comptée » s'affiche.
- **Réception** : les deux pieds reviennent à moins de 1,5 cm du sol de référence.
- **Mesure écartée** si : plusieurs personnes dans la zone, perte de suivi (plus de 160 ms), sortie du cadre, vol trop court ou trop long, valeur aberrante, calibration invalide.
- **« Mesure incertaine »** si : confiance moyenne du suivi faible, moins de 12 analyses IA par seconde pendant le vol, images perdues ou référence peu stable.
- **Anti double comptage** : délai de 2,5 s après chaque résultat, puis une nouvelle phase d'immobilité est exigée.
- Le **temps de vol** (`h = g·t²/8`) est affiché à titre indicatif seulement : à 20–30 analyses/s, il est trop imprécis pour servir de mesure.
- Tous les seuils sont réglables dans *Paramètres → Analyse IA*.

La cadence réelle de l'IA dépend de l'appareil (affichée en bas à gauche). Aucune cadence n'est garantie.

## Confidentialité et hors-ligne

Aucune image n'est envoyée. Au premier lancement, le navigateur **télécharge** la bibliothèque MediaPipe (jsDelivr) et le modèle (Google Storage). Pour ne dépendre d'aucun service tiers :

```bash
npm pack @mediapipe/tasks-vision@0.10.14 && tar xzf mediapipe-tasks-vision-0.10.14.tgz
mkdir -p vendor/mediapipe models
cp package/vision_bundle.mjs vendor/mediapipe/ && cp -r package/wasm vendor/mediapipe/
curl -L -o models/pose_landmarker_lite.task https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
```
Puis, dans *Paramètres → Analyse IA* : Base MediaPipe = `./vendor/mediapipe`, URL du modèle = `./models/pose_landmarker_lite.task`.

## Limites de précision (à connaître)

- **Hanches ≠ centre de masse** : le milieu des hanches détecté par l'IA n'est qu'une approximation, qui varie avec la posture (bras, flexion du tronc).
- **Référence debout** : la détente est mesurée depuis la position debout immobile, ce qui inclut l'extension des chevilles avant le décollage. Elle est donc **supérieure** à la hauteur de vol (souvent de 5 à 10 cm). Ne pas comparer directement avec une plateforme de force ou un Optojump.
- **Plan de la feuille** : si le sauteur est plus près ou plus loin de la caméra que la feuille, l'échelle est fausse (environ 1 % d'erreur par 3 cm d'écart à 3 m). Marquer l'emplacement au sol.
- **Objectif** : la distorsion grand-angle des tablettes déforme les bords de l'image : garder le sauteur au centre.
- **Cadence** : à 30 images/s, le sommet réel peut tomber entre deux images (erreur de quelques mm près de l'apogée, plus si la cadence est basse). Le flou de bouger, surtout en lumière faible, dégrade le suivi.
- **Tampon vidéo** : 480 px de large par défaut, par exemple 1 pixel du tampon ≈ 0,66 cm pour une A4 de 120 px en 1280×720 (valeur affichée pendant la vérification). Augmenter la largeur améliore la précision manuelle mais consomme plus de mémoire (estimation affichée). Si le navigateur ne fournit pas `requestVideoFrameCallback`, la capture image par image n'est pas garantie et un avertissement s'affiche.
- **IA** : le suivi des hanches fluctue de 1 à 3 cm d'une image à l'autre. La détection de deux personnes n'est pas infaillible.

## Validation proposée avant usage évaluatif

1. Filmer 20 à 30 sauts variés (élèves de tailles différentes) simultanément avec JumpMeasure et une référence : plateforme de contact, Optojump, ou vidéo 240 images/s analysée image par image (en comparant **le même indicateur**, c'est-à-dire la hauteur de vol ou l'élévation du bassin).
2. Calculer le biais moyen et les limites d'agrément (Bland-Altman), en IA et en manuel.
3. Vérifier la répétabilité : même élève, plusieurs sauts, plusieurs calibrations.
4. Ne retenir l'outil pour une évaluation que si l'erreur est acceptable par rapport aux écarts de barème.

## Tests

```bash
node --test tests/*.test.mjs                 # 65 tests : conversions, repères, calibration, détecteur, détection de feuille
OPENCV_JS=/chemin/opencv.js node --test tests/a4detect.test.mjs   # + tests OpenCV
python3 tests/e2e_calibration.py /chemin/chrome /chemin/opencv.js   # 11 vérifications : les 3 boutons via fausse caméra
pip install playwright && python3 tests/e2e_playwright.py /chemin/vers/chrome   # 21 vérifications de bout en bout
```

**Vérifié par les tests automatiques (caméra simulée de Chrome et faux modèle IA)** : démarrage caméra, message explicite si le modèle IA ne se charge pas, appui long pour les paramètres, calibration au doigt en affichage miroir (120 px natifs → 0,2475 cm/px), persistance après rechargement, invalidation si la résolution change ou en cas de rotation, tampon figé et revue image par image, mesure manuelle exacte (lignes en pixels natifs), glisser au doigt, nouveau saut sans perte de calibration, parcours complet de la machine à états avec un saut simulé mesuré à 38,0 cm (attendu 38), vérification pré-remplie depuis l'IA, aucune mesure à deux personnes, mise en page smartphone et tablette en portrait. Côté détecteur (séquences simulées) : montée sur pointes, saut avorté, perte de suivi, deuxième personne qui entre pendant le saut ou reste hors zone, rebond après réception, cadence IA faible, confiance faible.

**Calibration automatique (images synthétiques)** : sur 6 cas (droite, inclinée de 4°, petite, grande, objets parasites, bruit fort), l'erreur sur la valeur en cm/px est ≤ 0,04 % pour les méthodes 1 et 2 et ≤ 0,33 % pour la méthode 3. Il n'y a pas de fausse détection sans feuille, et les carrés noirs pleins ne sont pas pris pour des marqueurs. Dans Chrome, la vraie feuille imprimable incrustée dans une scène de gymnase et diffusée comme caméra donne 0,05 % (1), 0,05 % (2) et 0,11 % (3) d'erreur. Ces images restent idéalisées : pas de reflet, pas de pli, pas de flou de bouger, pas de distorsion d'objectif.

**Non vérifié, à tester sur la tablette réelle** :
- les 3 méthodes de détection avec une vraie feuille en gymnase (éclairage, reflets, fond, feuille tenue à la main) et le téléchargement d'OpenCV sur la tablette ;
- chargement et performances du vrai modèle MediaPipe (cadence, GPU/CPU, échauffement de la tablette) ;
- qualité du suivi des hanches et des pieds sur de vrais élèves (tenues amples, chaussures sombres, contre-jour) et réglage des seuils ;
- montée sur pointes et sauts avortés réels ;
- caméra avant/arrière, rotation physique de la tablette, redémarrage, mise en veille ;
- mémoire du tampon sur iPad/Android (et réglage durée/largeur/cadence) ;
- Safari iOS : `requestVideoFrameCallback`, maintien de l'écran allumé, plein écran (non disponible sur iPhone) ;
- exactitude globale contre une référence (voir « Validation »).
