# CLAUDE.md — JumpMeasure LIVE

## Mission
Développer et maintenir **JumpMeasure LIVE**, une application web de mesure de détente verticale en mode « photocall » pour l'EPS. Une tablette et un emplacement de saut restent fixes ; les personnes passent successivement, sans identification ni saisie de nom.

## Contraintes du projet
- Application web responsive, priorité tablette en mode paysage ; compatible smartphone et ordinateur.
- Privilégier **HTML, CSS et JavaScript natifs**, sans build, déployables sur GitHub + Vercel en site statique.
- Caméra via `getUserMedia` (HTTPS ou localhost requis), analyse **en direct** sans démarrer/arrêter un enregistrement à chaque saut.
- Vidéos et données traitées localement ; aucun envoi d'images vers un serveur.
- Deux modes accessibles à tout moment : **automatique IA** et **manuel** ; conserver la comparaison des mesures.
- Aucune gestion de noms, comptes, listes de classe ou profils d'élèves à ce stade.
- Ne pas présenter la mesure comme une mesure biomécanique de laboratoire.

## Parcours utilisateur
1. **Configuration administrateur (une fois)** : fixer la tablette, choisir la caméra, définir une zone de saut, placer une feuille A4 verticale (29,7 cm) dans le même plan de profondeur que le bassin, positionner deux repères sur ses extrémités et sauvegarder la calibration localement.
2. **Mode borne** : caméra allumée en continu, indication « placez-vous dans la zone », puis « restez immobile » ; estimer une position de référence stable du bassin.
3. **Saut** : détecter une impulsion plausible, suivre la position verticale du bassin et identifier l'apogée puis la réception ; afficher la détente en cm.
4. **Contrôle manuel** : revoir les dernières secondes via un tampon vidéo circulaire, choisir les images de départ et d'apogée, positionner deux lignes horizontales et recalculer.
5. **Nouveau saut** : réinitialiser l'essai sans couper la caméra et **sans perdre la calibration**.

## Calcul et calibration
- Calibrage de base : `cmParPixel = 29.7 / hauteurA4Pixels`.
- Mesure : `detenteCm = (yReferencePx - ySommetPx) * cmParPixel`, avec axe Y orienté vers le bas.
- Attention : utiliser les coordonnées dans le **repère natif de l'image**, pas directement les pixels CSS affichés. Corriger les effets de `object-fit`, du miroir éventuel et des redimensionnements.
- La distance caméra-personne saisie à titre indicatif ne suffit pas à calibrer l'échelle ; la feuille A4 doit être au même plan de profondeur que le sujet. Prévenir si la caméra, son zoom, son orientation ou la zone de saut changent.
- Conserver calibration, caméra sélectionnée, dimensions vidéo et paramètres utiles dans `localStorage`. Vérifier la validité de la calibration lors de chaque réouverture.

## Analyse IA en direct
- Utiliser **MediaPipe Pose Landmarker** côté navigateur si compatible, avec chargement du modèle et gestion des erreurs explicites.
- Suivre le milieu des deux hanches lorsque les points sont suffisamment fiables ; afficher le squelette et la qualité du suivi.
- Définir une machine à états explicite : `WAITING -> STABILIZING -> READY -> JUMPING -> RESULT -> WAITING`.
- Référence : médiane des positions du bassin sur une fenêtre stable, pas une image unique.
- Détection : filtrer le bruit, vérifier le mouvement cohérent du bassin et des jambes, surveiller les chevilles/pieds, utiliser seuils et délais configurables, éviter les doubles comptages.
- Écarter les mesures si perte de suivi, plusieurs personnes dans la zone, sortie du cadre ou calibration invalide.
- Une élévation du bassin seule ne prouve pas un saut : ne pas confondre montée sur pointes et décollage.
- Afficher « mesure incertaine » si la confiance est insuffisante ; toujours permettre la vérification manuelle.
- Ne pas promettre 60/120 analyses IA par seconde : la fréquence réelle dépend de l'appareil et du modèle. Mesurer les performances et ne pas bloquer l'interface.

## Mode manuel et tampon vidéo
- Prévoir un **tampon circulaire de 3 à 5 secondes** sans conservation permanente par défaut.
- Permettre de parcourir les images disponibles, de choisir une image initiale et une image au sommet, puis de placer les lignes avec le doigt (grandes zones tactiles).
- Attention : un simple tableau de frames décodées peut consommer beaucoup de mémoire ; adapter résolution, cadence et durée aux performances de la tablette.
- Si l'appareil ne permet pas une lecture réellement image par image, le signaler au lieu de prétendre à une précision parfaite.

## Interface
- Écran principal sobre, lisible à distance : aperçu caméra, état de détection, détente en **cm** en très grand, sélecteur `IA / Manuel`, bouton `Nouveau saut`, bouton `Vérifier`.
- Paramètres administrateur dans un panneau séparé pour éviter un recalibrage accidentel.
- Afficher les repères de calibration, les lignes de mesure et, en IA, le squelette.
- États d'erreur explicites : caméra refusée, caméra indisponible, modèle IA non chargé, faible luminosité, calibration manquante, sujet hors zone.
- Pas de formulaire d'identité ni de classement nominatif.

## Qualité, tests et livraison
- Tester au minimum : caméra avant/arrière, rotation tablette, changement de résolution, redémarrage, persistance du calibrage, nouveau saut, perte de suivi, absence de sujet, deux personnes visibles, saut avorté, saut sur pointes, mode manuel et mode IA.
- Tester la conversion pixels/cm avec valeurs connues et vérifier les coordonnées lorsque l'image est recadrée.
- Documenter les limites de précision et proposer une validation expérimentale contre une référence fiable avant usage évaluatif.
- Ne pas déclarer une fonctionnalité opérationnelle sans test ; distinguer implémentation, simulation et validation réelle.
- Livrer un `index.html` directement exploitable (ou quelques fichiers statiques), un `README.md` avec instructions de test/déploiement et ce `CLAUDE.md`.

## Priorité de développement
1. Fiabiliser le flux caméra, l'interface borne et la calibration persistante.
2. Fiabiliser la mesure manuelle avec tampon vidéo.
3. Ajouter l'IA temps réel et les états du saut.
4. Ajouter comparaison IA/manuelle, indicateurs de qualité et tests sur tablette.

## Consigne à Claude Code
Avant toute modification, inspecter les fichiers existants, préserver les fonctionnalités qui marchent et proposer un plan court. Implémenter ensuite, exécuter les tests possibles et signaler précisément les éléments qui nécessitent un essai sur matériel réel. Ne pas ajouter de gestion d'élèves sans demande explicite.
