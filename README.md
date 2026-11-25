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
| `assets/logo.png`, `assets/logo-ecole.png` | Logos PassSport Santé et L'École promotrice de santé (voir `assets/LISEZ-MOI.txt`) |
| `vendor/opencv.js` | OpenCV.js 4.10.0 (Apache 2.0), chargé seulement pour la méthode 2 |
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

L'écran de démarrage propose trois boutons, plus *Repères à la main*. Après un appui, un **compte à rebours de 5 s** (réglable de 0 à 30 s, avec un bip à chaque seconde et un bouton *Annuler*) laisse le temps d'aller placer la feuille. À la fin du décompte, l'application **prend une photo** et lance la détection dessus. La photo reste affichée, figée : tu vérifies, tu ajustes les repères au doigt (avec une loupe), tu peux reprendre une photo, puis tu enregistres. Si la détection échoue, la raison s'affiche et tu places les repères à la main sur la même photo. Un tableau compare les méthodes déjà essayées.

1. **Feuille blanche** (JavaScript pur, aucun téléchargement) : cherche une zone claire aux proportions d'une A4 verticale, puis mesure les bords haut et bas au gradient sous-pixel. Il faut un fond **plus sombre** que la feuille. Les murs blancs, les fenêtres et les tapis clairs peuvent tromper la détection : un avertissement s'affiche si une autre forme comparable est trouvée.
2. **Feuille blanche — OpenCV** : OpenCV.js (≈ 10 Mo) trouve le quadrilatère de la feuille, puis les bords sont remesurés comme en 1. En effet, les contours OpenCV sont décalés d'environ 1 px vers l'intérieur, ce qui donnait jusqu'à 5 % d'erreur sur une petite feuille. C'est plus robuste qu'en 1 face aux fonds chargés. OpenCV est **inclus dans le dépôt** (`vendor/opencv.js`, version 4.10.0 du paquet npm `@techstark/opencv-js`, licence Apache 2.0) et servi avec l'application. Si cette copie manque, l'application essaie jsDelivr, puis docs.opencv.org. Une URL personnalisée peut être saisie dans *Paramètres → Calibration*.
3. **Feuille à marqueurs** (recommandée) : imprimer `feuille-calibration.html` **à 100 %**. Elle porte deux carrés noirs évidés, dont les centres sont espacés de 20,0 cm. Contrôle avec la règle de 10 cm imprimée ; si l'impression n'est pas exacte, saisir la distance mesurée entre les centres. La détection fonctionne même sur un fond clair. L'étalon mesure 20 cm au lieu de 29,7 cm, mais le centre d'un marqueur se localise plus finement qu'un bord de feuille.

Une limite commune aux trois : la détection ne vérifie **pas** que la feuille est au même plan de profondeur que le bassin. La feuille doit être **retirée avant de sauter**, puisqu'elle est à l'emplacement du saut ; elle ne peut donc pas servir à détecter un déplacement de la caméra pendant la séance.

## Parcours

1. **Choix de l'activité** (au démarrage) : **⬆ Détente verticale** ou **➡ Saut en longueur**.
2. **Calibration propre à l'activité** :
   - détente : écran *Calibration — Détente verticale* (feuille A4 : 3 méthodes de détection ou repères à la main, sur photo) ;
   - longueur : écran *Calibration — Saut en longueur* (repères alignés sur le décamètre, sur l'image en direct).
   Si une calibration valide existe déjà, *Continuer avec la calibration actuelle* (détente) ou *Garder la calibration actuelle* (longueur).
3. **Accueil des mesures** de l'activité : **« Commencer les mesures »**, puis les séries de sauts.
4. **⇄ Changer d'activité** (maintenir 1 s, sur l'accueil des mesures) ramène à l'écran de choix. Chaque activité garde sa propre calibration, sa zone de saut et sa caméra.

### Saut en longueur : installation
- **Tablette de profil**, perpendiculaire au couloir, à environ 4–5 m et à hauteur de hanche, pour voir la ligne d'appel et toute la zone de réception (jusqu'à environ 3 m) avec de la marge : un élève qui sort du cadre à la réception voit son saut écarté.
- **Au sol**, pose le **décamètre** le long du couloir, le zéro sur la **ligne d'appel**.
- **Calibration** sur l'**image en direct**, dans l'écran *Calibration — Saut en longueur* (ou *Paramètres → Calibration → Calibrer la longueur*). Les 3 repères apparaissent sur le direct : aligne-les sur le décamètre, d'abord le zéro (ligne d'appel, en bleu), puis deux graduations, par défaut **1 m et 2 m**. Ces distances se règlent dans la même barre, par exemple 1 m et 3 m pour couvrir toute la zone de réception. Une loupe aide au placement, et **⏸ Figer l'image** gèle le direct si quelqu'un passe devant (**▶ Revenir au direct** ensuite). Trois repères permettent de **corriger la perspective** si la tablette n'est pas parfaitement perpendiculaire : un avertissement s'affiche alors.
- À l'écran, une **règle au sol** (ligne d'appel, graduations tous les 50 cm) permet de vérifier la calibration d'un coup d'œil.

### Changer de caméra
Le bouton **🔄 Changer de caméra** (écran Calibration, barre de calibration de la longueur sur le direct, *Paramètres → Caméra*) passe d'une caméra à l'autre ; la caméra active est affichée. Chaque calibration reste liée à la caméra avec laquelle elle a été faite : sur une autre caméra, elle est signalée invalide. Si les deux modes ont été calibrés avec des caméras différentes (par exemple avant pour la détente, arrière pour la longueur), **changer de mode à l'accueil rebascule automatiquement sur la bonne caméra**.

### Saut en longueur : mesure
- **Seuls les pieds comptent** : un pied bien détecté suffit (ils sont joints). Les hanches, le haut du corps ou la tête peuvent être hors champ ; la caméra peut donc être placée plus bas et plus près, pour bien voir les pieds sur toute la zone. La zone de saut et la règle « une seule personne » se basent sur la position des pieds.
- Consignes : « Placez-vous derrière la ligne d'appel » → « Ne bougez plus… » → **« VOUS POUVEZ SAUTER ! »**. « Reculez » s'affiche si les pointes dépassent la ligne, « Avancez » si l'élève est à plus de 60 cm derrière.
- **Sol de référence** : le niveau des pieds de l'élève immobile, et non la ligne du décamètre, qui n'est jamais exactement sous les pieds. La ligne calibrée ne sert qu'à mesurer la distance et à suivre la pente du sol. Si « Ne bougez plus » reste affiché, le bas de l'écran indique ce qui bouge trop (« immobilité : pointes ±… cm · hauteur des pieds ±… cm (max …) »).
- **Décollage** : les deux pieds quittent le sol, confirmé sur deux images. Un faux départ (sursaut du suivi, élan des bras) est annulé sans message si les pieds restent sur place. **Réception** : dès qu'un pied retouche le sol devant la ligne. Chaque pied a sa propre hauteur de référence, et un pied nettement moins bien vu que l'autre (souvent celui du fond, caché) est écarté de la mesure du talon.
- *(détail)* Les deux pieds quittent le sol. **Réception** : les deux pieds reviennent au sol. Pendant 0,3 s après le contact, l'application retient le **talon le plus proche de la ligne d'appel**, parmi les images où les pieds ne glissent plus vers l'avant.
- **Résultat** = distance de la ligne d'appel à ce talon (**règle officielle**), affichée en mètres. La distance depuis les pointes de pieds au départ est aussi indiquée et exportée.
- **Mesure incertaine** si une **main se pose derrière les talons** (chute en arrière), si le suivi est peu fiable ou si l'IA analyse trop peu d'images par seconde. Saut écarté si le pied mord la ligne, si les pieds ne sont plus suivis ou sortent de l'image, ou s'il y a plusieurs personnes.
- **Photo de la réception** : ligne d'appel, ligne de réception et flèche avec la distance.
- **Vérification** (outils professeur) : choisir l'image de réception, glisser la ligne verticale sur le talon (◀ ▶ pour ajuster au pixel près).

**Limites propres à la longueur** : de profil, le pied éloigné de la caméra est en partie caché ; la détection du talon par l'IA fluctue d'environ 1 à 3 cm ; le flou de bouger à la réception peut gêner (bonne lumière nécessaire) ; la distorsion grand-angle aux bords de l'image n'est corrigée que si les repères couvrent la zone de réception. À valider contre un décamètre avant tout usage évaluatif.

## Utilisation en classe (élèves autonomes)

1. **Accueil** : un grand bouton **« Commencer les mesures »**. Il reste grisé tant que la calibration n'est pas valide, et le motif est affiché dessous.
2. L'élève appuie, puis va se placer dans la zone de saut. Les consignes s'affichent **en très grand sur l'image** :
   - « Placez-vous dans la zone de saut » : il faut voir tout le corps, pieds compris ;
   - « Ne bougez plus… » : repérage de la position des hanches ;
   - **« VOUS POUVEZ SAUTER ! »** (vert, avec un bip) ;
   - puis le résultat, par exemple « 38,2 cm · Saut 2 · 🏆 Nouveau record ! ».
3. L'élève **enchaîne les sauts sans toucher la tablette**. Après chaque saut, il se replace et s'immobilise ; la consigne repasse au vert.
4. Le panneau de droite affiche le dernier saut, le **meilleur saut** et la liste des sauts de la série. Une mesure « incertaine » est affichée mais **non retenue** pour le meilleur saut (réglable dans *Paramètres → Analyse IA*). Un saut écarté (deux personnes, perte de suivi…) affiche « Saut non mesuré » avec la raison.
5. **Hauteur sur l'image** : pendant le résultat, une flèche entre la ligne de départ et celle du sommet affiche la hauteur à côté de l'élève, à l'écran comme sur la photo.
6. **Logos** : *PassSport Santé* en haut à droite et *L'École promotrice de santé 26-27* en haut à gauche de chaque photo. Ils apparaissent aussi sur l'accueil, et le logo PassSport sur l'écran de mesure. Ils sont posés sur fond transparent. Les fichiers sont `assets/logo.png` et `assets/logo-ecole.png`. Chacun peut être remplacé sur une tablette depuis *Paramètres → Affichage*.
7. **Photo au sommet** : à chaque saut, l'image où les hanches sont au plus haut est gardée en pleine résolution. Elle s'affiche sur l'écran pendant le résultat, puis en vignette dans le panneau ; on peut toucher la vignette ou un saut marqué 📷 dans la liste. La photo agrandie porte la performance, les lignes départ/sommet, le numéro du saut et la date, et propose :
   - **📧 Envoyer par e-mail** : ouvre le menu de partage de la tablette ; l'élève choisit *Mail* et saisit son adresse. La photo ne passe par aucun serveur de l'application, mais **elle part depuis le compte mail configuré sur la tablette**, qui en garde une copie dans ses messages envoyés. Si le navigateur ne permet pas le partage de fichiers, la photo est enregistrée.
   - **⬇ Enregistrer** sur l'appareil.
   L'analyse est en pause tant que la photo est ouverte (fermeture automatique au bout de 2 min). Chaque photo porte le **numéro de série**, aussi affiché à l'élève pendant sa série.
   **Galerie** (*Paramètres → Photos conservées*) : les photos sont gardées sur la tablette, même après « Terminer mes mesures » ou un rechargement de la page, jusqu'à ce que tu les effaces. Depuis la galerie : voir une photo et l'envoyer, **tout enregistrer en ZIP** (fichiers `serie-012_saut-2_47-9cm.jpg`), **tout partager** (AirDrop, Drive…), **tout effacer**. Décocher « Conserver les photos » efface les photos à la fin de chaque série. Les fonctions d'envoi et d'affichage se désactivent dans *Paramètres → Affichage*. **Droit à l'image** : vérifiez les autorisations des élèves et de leurs responsables.
8. **« Terminer mes mesures »** ferme la série et revient à l'accueil pour l'élève suivant.

**Outils (professeur)**, en bas du panneau : choix IA / Manuel, *Réarmer*, *Vérifier* (revue image par image du dernier saut ; la valeur validée remplace celle de l'IA dans la série, marquée « vérifié »), *Supprimer le dernier saut*. En mode manuel, *Figer et mesurer* ajoute la mesure à la série.

**Mesures de la session** (paramètres) : toutes les séries, avec IA, manuel, écart et sauts supprimés, exportables en CSV. Elles sont anonymes et ne sont pas conservées après fermeture de la page.

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

- **Flou de mouvement pendant le saut** : en vol, le modèle peut perdre les pieds ou les hanches pendant quelques images. Ces pertes sont tolérées : jusqu'à 0,45 s en détente (mesure alors signalée incertaine) ; en longueur, pendant tout le vol, la mesure se faisant quand les pieds réapparaissent au sol. Pendant le saut, la confiance des points est lissée (pas de « clignotement ») et le modèle est réglé un peu moins exigeant pour garder la personne. En bas de l'écran, **confiance pieds / hanches** (0 à 1) aide à régler l'installation : viser plus de 0,6 à l'arrêt.
- **Si le suivi se perd encore** : plus de lumière (moins de flou), pas de contre-jour, chaussures qui contrastent avec le sol, modèle *Full* (*Paramètres → Analyse IA*) si la tablette tient au moins 15 à 20 analyses par seconde, et caméra plus proche pour que les pieds soient plus grands à l'image.
- **Lissage du suivi** : l'IA réestime les points du corps à chaque image, avec quelques pixels d'écart, et le squelette « tremble » même quand l'élève est immobile. Un filtre (« One Euro ») lisse ces tremblements sans retarder les mouvements rapides. Les points lissés servent à l'affichage et à la détection de l'immobilité ; **pendant le saut, ce sont les points bruts** qui sont utilisés, pour ne pas écrêter le sommet ni décaler la réception. Réglages dans *Paramètres → Analyse IA* : **Lissage du suivi** (aucun, léger, moyen par défaut, fort) et **Tolérance d'immobilité** (stricte, normale par défaut, souple). Si « Ne bougez plus » reste affiché alors que l'élève est immobile, passer le lissage à *Fort* ou la tolérance à *Souple*.
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
node --test tests/*.test.mjs                 # 82 tests : conversions, calibrations, détecteurs (détente et longueur), lissage, détection de feuille
OPENCV_JS=/chemin/opencv.js node --test tests/a4detect.test.mjs   # + tests OpenCV
python3 tests/e2e_calibration.py /chemin/chrome   # 16 vérifications : les 3 boutons via fausse caméra
python3 tests/e2e_long.py /chemin/chrome          # 18 vérifications : saut en longueur (faux modèle, vue de profil simulée)
python3 tests/e2e_camera.py /chemin/chrome        # 9 vérifications : changement de caméra (2 caméras simulées)
pip install playwright && python3 tests/e2e_playwright.py /chemin/vers/chrome   # 48 vérifications de bout en bout
```

**Vérifié par les tests automatiques (caméra simulée de Chrome et faux modèle IA)** : démarrage caméra, message explicite si le modèle IA ne se charge pas, appui long pour les paramètres, calibration au doigt en affichage miroir (120 px natifs → 0,2475 cm/px), persistance après rechargement, invalidation si la résolution change ou en cas de rotation, tampon figé et revue image par image, mesure manuelle exacte (lignes en pixels natifs), glisser au doigt, nouveau saut sans perte de calibration, parcours complet de la machine à états avec un saut simulé mesuré à 38,0 cm (attendu 38), vérification pré-remplie depuis l'IA, aucune mesure à deux personnes, mise en page smartphone et tablette en portrait. Côté détecteur (séquences simulées) : montée sur pointes, saut avorté, perte de suivi, deuxième personne qui entre pendant le saut ou reste hors zone, rebond après réception, cadence IA faible, confiance faible. Nouveau parcours : accueil bloqué sans calibration ; calibration sur photo figée (manuelle, après échec de détection, ou en reprenant la photo) ; série de 3 sauts simulés enchaînés sans interaction (38,0, 47,9 et 32,7 cm), meilleur saut et record correctement signalés ; vérification et suppression du dernier saut ; « Terminer mes mesures » qui ramène à l'accueil.

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
