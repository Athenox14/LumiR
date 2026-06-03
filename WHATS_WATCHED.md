# Whats Watched

This file is a working list of the behavioral signals and usage patterns considered by LumiR's recommendation and personalization logic.

- ordre de navigation
- allers-retours entre pages
- historique de consultation court
- cycle de vie de la session
- requêtes tapées dans la recherche, notamment celle de la navbar
- temps entre la saisie et le clic sur un résultat
- résultat finalement cliqué
- position du résultat cliqué
- recherches modifiées ou raffinées
- aller-retour entre recherche et catalogue / accueil
- ouverture d'une fiche film / média
- temps passé sur la fiche
- scroll depth sur la fiche
- lecture potentielle du synopsis
- retour plusieurs fois sur la même fiche
- consultation des métadonnées présentes sur la fiche
- vitesse de défilement
- distance de scroll
- nombre de médias vus sans clic
- temps passé à parcourir le catalogue sans interaction
- "fatigue" du catalogue
- hésitation / indécision
- passage devant des films sans jamais cliquer dessus
- exclusions implicites via non-clic répété
- hover sur une affiche / carte média
- durée du hover
- position de la souris
- dernier passage avant clic
- mouvements pouvant signaler hésitation ou intention
- clics frénétiques ou impatience perçue
- démarrage de lecture
- arrêt de lecture
- durée de visionnage
- progression
- taux de complétion
- point d'abandon précis
- abandon rapide
- visionnage complet ou quasi complet
- historique des derniers films vus / arrêtés
- reprise éventuelle d'une lecture
- genres aimés
- genres rejetés
- réalisateurs appréciés
- acteurs / cast appréciés
- ancienneté des films préférés
- préférence pour films récents vs anciens
- préférence possible par durée
- historique récent de genres consommés
- exclusions volontaires ou implicites
- heure de la journée
- jour de la semaine
- distinction semaine / week-end
- éventuellement saisonnalité
- habitudes selon créneau horaire
- habitudes selon période de l'année
- type d'appareil
- desktop / mobile / TV
- état de la fenêtre
- plein écran ou fenêtré
- résolution / ratio d'écran
- niveau d'immersion supposé
- langue choisie
- sous-titres choisis
- changements de piste audio
- changements de sous-titres
- éventuelle préférence VOSTFR / VF / autre
- tags favoris détectés
- scores par genre
- scores par réalisateur
- scores par acteur
- scores par période / décennie
- scores contextuels
- derniers événements ayant influencé le profil
- historique récent des signaux positifs et négatifs
- nombre de recherches avant sélection d'un média
- abandon de recherche sans clic
- recherche d'un même titre à plusieurs sessions différentes
- requête vide puis navigation ensuite
- média resté le plus longtemps à l'écran
- pourcentage de la fiche effectivement vu
- si l'utilisateur remonte la page après lecture du bas
- temps passé sur cast, synopsis, metadata si ces zones sont séparables
- sortie immédiate de la fiche

## Ajouts utiles côté lecture

- pause / reprise
- nombre de pauses
- seek avant / arrière
- moments souvent sautés
- moments souvent revus
- abandon après buffering ou après erreur
- temps entre ouverture de fiche et lancement réel
- relance d'un film abandonné plus tard
- sessions multi-épisodes / multi-films (films de la même saga par exemple)
- tolérance au contenu en fonction de sa durée
- réceptivité à la nouveauté vs rewatch

## Ajouts utiles côté contexte

- temps depuis la dernière session
- fréquence d'usage
- sessions courtes vs longues
- heure habituelle de démarrage
- comportement différent selon le moment de la semaine / année
- like / dislike
- reprendre plus tard
- recherche navbar (très très fort signal)
- clic sur résultat de recherche
- retour sur une fiche déjà vue
- ouverture d'une fiche
- temps sur fiche (> quelques secondes)
- scroll lent sur fiche
- focus visuel (hover long sur une carte)
- derniers films consultés
- derniers genres vus
- dernier film presque lancé
- aller-retour entre 2-3 films
- abandon récent d'un film (remplacement probable)

## Signaux ajoutés et pris en compte dans l'algo

Ces signaux sont désormais réellement observés et intégrés au score de
recommandation (voir `docs/recommendation-algorithm.md` pour le détail technique).

> **Couverture 100 %** : chaque champ suivi dans le profil (`profileData`) est
> effectivement consommé par le scoring — soit comme terme par titre, soit fondu
> dans un « style utilisateur » global (`deriveUserStyle`). Aucun signal n'est
> collecté sans servir.

### Goûts explicites
- like / dislike des films (renforcé : propagé aux genres, mots-clés, réalisateur, etc.)
- watchlist / « reprendre plus tard » (vraie fonctionnalité, signal d'intention fort)
- genres rejetés via dislike (exclusion de la découverte)

### Qualité de visionnage par titre (agrégé entre utilisateurs, anonyme)
- courbe d'abandon par titre (position normalisée, 10 déciles)
- pénalité d'abandon précoce (premiers 20 %)
- complétion effective (visionné à plus de 75 %)
- nombre de séances nécessaires pour finir un titre (« bingeabilité »)
- taux de clic impression → ouverture de fiche
- survol sans ouverture (hésitation au niveau du titre)
- impressions sans clic (titre vu en rayon mais jamais ouvert)

### Engagement de lecture
- temps actif vs lecture en veille / pause (idle)
- complétions effectives cumulées
- arrêt après 75 % compté comme visionnage effectif

### Métadonnées de contenu
- collection / saga (affinité par franchise)
- mots-clés / thèmes (issus de TMDB)
- réalisateur
- compositeur de musique
- classification d'âge (certification)
- popularité (signal de foule)
- nouveauté (sorties récentes)

### Contexte temporel
- genre × moment : affinité genre selon le créneau (jour de la semaine × partie de journée)
  - ex. action le samedi soir, dessins animés le mercredi après-midi
- saisonnalité (répartition par mois)
- churn : temps depuis la dernière activité, plus longue interruption, réactivations
- jours actifs récents (fenêtre glissante)

### Binge & foyer
- détection de séances de binge (complétions rapprochées, séries de visionnages)
- plus longue série de visionnages consécutifs
- continuation de saga pendant une session de binge
- signaux de co-visionnage (capturés pour profilage par foyer)
