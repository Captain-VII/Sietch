# Feuille de route de Sietch

État au 2026-10-26 : toutes les fonctions de la maquette sont codées et testées dans le navigateur, la CI produit
le `.exe` Windows. Le 2026-10-26, la vraie application (mode dev) a été validée sur le PC à côté du jeu. Cette feuille de route va du plus sûr au plus incertain ;
chaque étape dit ce qui la débloque et à quoi on reconnaît qu'elle est finie.

Légende : 🟢 prêt à faire · 🟡 dépend d'une info ou d'un choix · 🔴 dépend d'un tiers (Funcom, gaming.tools)

---

## Étape 0 — Valider sur le PC (priorité absolue)

Objectif : que la version actuelle marche vraiment à côté du jeu, avant d'ajouter quoi que ce soit.

- ✅ Installer depuis l'artefact de la CI (et non en mode dev) : installé et lancé le 2026-10-26 (commit `6e3d7bb`,
  après correction du démarrage en release). SmartScreen et le lancement au démarrage de Windows restent à voir à l'usage.
- ✅ Passer la liste « Pas encore vérifié » de `CLAUDE.md` : wiki dans l'app, notifications Windows, zone de
  notification, raccourcis globaux **pendant que le jeu a le focus**, overlay par-dessus le jeu en plein écran fenêtré
  (validé le 2026-10-26, en mode dev).
- ✅ Heure réelle de la tempête de Coriolis : le défaut (mardi 03:00, UTC+1) est confirmé sur ton serveur.
- ✅ `cargo test`, `cargo clippy` (0 avertissement) et `tsc` tournent dans la CI avant la compilation.

**Fini quand** : une soirée de jeu complète avec Sietch ouvert, sans bug bloquant.

## Étape 1 — Position en direct réelle (solo / privé, sans BattlEye)

Objectif : le point bleu suit vraiment le joueur sur la carte.

- ✅ Trouver la chaîne de pointeurs : trouvée le 2026-10-26 avec `tools/sietch-scan` (3 niveaux, tient après une
  relance du jeu), position « en direct » dans Sietch. La chaîne reste en local dans `position.json`.
- 🟢 Calibrer les deux régions (Bassin de Hagga, Désert profond).
- ✅ (2026-10-28) Ajouter un outil de diagnostic dans l'onglet « Sans BattlEye » : dernière valeur lue, nombre d'échecs,
  pour comprendre vite pourquoi la position ne vient pas.
- 🟡 Rendre la chaîne **résistante aux patchs** : retrouver automatiquement le point de départ (recherche d'une
  signature d'octets) au lieu d'un décalage fixe. Gros gain de confort, mais plus technique.
- 🟢 Proposer la calibration de la région en un clic quand on change de zone (Hagga ↔ Désert profond).

**Fini quand** : la position tient après un redémarrage du jeu, et se répare en moins de 10 minutes après un patch.

## Étape 2 — Confort de jeu, pour tout le monde (aucune lecture du jeu)

Objectif : rendre Sietch utile même en ligne, avec BattlEye.

- ✅ **Minuteurs prêts à l'emploi** : délais de réapparition des ressources courantes (à relever en jeu ou sur le
  wiki), en un clic depuis le marqueur.
- 🟢 **Fond de carte** : importer sa propre image par région (capture de la carte du jeu) et la caler sur la grille.
- ✅ **Partage de marqueurs** par code, comme pour les builds (entre amis, en guilde).
- ✅ **Overlay personnalisable** (2026-10-26) : un widget par élément (heure, Coriolis, secteur, minuteurs),
  placé à la souris (Ctrl+Maj+L), taille à la molette, plusieurs dispositions (Ctrl+Maj+N), réglages dans
  Paramètres › Overlay. Reste : l'essai en jeu par l'utilisateur et l'installation de la version de la CI.
- 🟢 **Liens wiki ↔ builds** : un emplacement de build ouvre l'article de l'objet sur awakening.wiki.
- 🟢 **Notes par marqueur** enrichies (captures d'écran, liste de choses à récolter).

**Fini quand** : on peut préparer une sortie dans le Désert profond uniquement depuis Sietch.

## Étape 3 — Plus de données du jeu (solo / privé, sans BattlEye)

Catégorie « Personnage en direct ». Référence fonctionnelle : l'overlay de Dune Companion (gaming.tools) affiche
les valeurs exactes des jauges (vie, endurance, eau…), la charge des équipements utilitaires (ceinture à suspenseur,
power pack) et l'inventaire (emplacements, volume). On reprend les **fonctions**, jamais leur contenu ni leur code.

**Choix technique** : lire les structures d'Unreal Engine **par leurs noms** (table des noms + table des objets +
réflexion des classes) au lieu d'une chaîne de pointeurs par valeur. Les offsets se retrouvent seuls au démarrage,
donc ça résiste mieux aux patchs et chaque nouvelle valeur ne coûte qu'un nom de plus.

**Performance** : un seul fil de lecture côté Rust, offsets résolus une fois (cache), un instantané du personnage
lu 4 fois par seconde, un seul événement `player-state` envoyé aux widgets, rien n'est envoyé si rien ne change.
Les widgets ne lisent rien eux-mêmes.

| # | Tâche | Vérifiable |
|---|---|---|
| 1 | `sietch-scan ue` : trouver la table des noms et la table des objets | les premiers noms (« None », « ByteProperty ») s'affichent |
| 2 | `sietch-scan ue-find` + liste des champs d'une classe (nom, type, offset) | on voit les champs du personnage (vie, endurance, eau…) |
| 3 | Moteur : `live.rs` résout les noms au démarrage et lit l'instantané (position comprise) | les valeurs suivent le jeu dans un journal |
| 4 | Widgets **Vie**, **Endurance**, **Eau** : barre fine + valeur exacte, style jeu | par-dessus le jeu, à côté de ses jauges |
| 5 | Widgets **Équipement** (charge, durabilité) et **Inventaire** (emplacements, volume) | idem |
| 6 | Alertes silencieuses : eau basse, équipement bientôt vide (seuils réglables) | notification + toast |
| 7 | Onglet « Stats brutes » dans la fenêtre principale : toutes les valeurs lues | liste en direct |

**État au 2026-10-26** : tâches 1 à 7 faites et vérifiées en jeu (vie, endurance, eau, énergie, volume du sac,
heure du jeu jour/nuit, alertes, Stats brutes). Reste : le nombre d'emplacements du sac (liste interne à décoder)
et la durabilité des équipements utilitaires.

**Fini quand** : en solo sans BattlEye, les widgets affichent vie, endurance, eau, équipement et inventaire en
direct, sans ralentir le jeu ni lui prendre le focus, et ça survit à une relance du jeu.

**Liste d'attente** (autres catégories) : carte en direct avec position et région (catégorie Carte), minuteur lancé
à la récolte d'un nœud (Minuteurs), « ce qu'il me manque » pour un build à partir de l'inventaire réel (Builds).

**Décision à prendre avant** : 🔴 la position de Funcom. Dune Companion et TH.GL lisent déjà ces données en ligne et
disent que Funcom le tolère ; si Funcom le confirme publiquement, on pourra rediscuter du garde-fou BattlEye.

## Étape 4 — Outils pour serveur privé

Objectif : aider à gérer un serveur privé.

- 🟡 D'abord **savoir comment ton serveur est hébergé** : chez un hébergeur (4Netplayers, BisectHosting…) via un
  panneau web, ou sur ta machine. Les outils possibles en dépendent complètement.
- 🟡 Sauvegarde automatique du monde avant la tempête de Coriolis et avant une mise à jour.
- 🟡 Éditeur des réglages du serveur, redémarrages planifiés avec annonce aux joueurs.

## Étape 5 — Diffusion

Objectif : que d'autres joueurs puissent l'utiliser sans friction.

- 🟢 README avec captures d'écran et GIF, page d'installation claire.
- 🟡 **Mises à jour automatiques** dans l'app : demande des releases GitHub (aujourd'hui exclues pour aller vite).
  À rediscuter quand il y aura des utilisateurs.
- 🟡 **Signature du `.exe`** pour supprimer l'alerte SmartScreen : certificat payant (environ 100 à 300 € par an).
- 🟡 Interface en anglais (le wiki l'est déjà).
- 🔴 Demander à gaming.tools l'accès à leur base (recettes, statistiques), aujourd'hui interdit sans accord.
- 🔴 Vérifier le contrat d'utilisation de Funcom avant de diffuser les modules sans BattlEye.

---

## Ordre conseillé

1. Étape 0 en entier : sans elle, tout le reste repose sur du non testé.
2. Étape 1 (position), puisque c'est ce que tu voulais en premier.
3. Étape 2 par petits morceaux, entre deux sessions de jeu : c'est ce qui sert au plus de monde.
4. Étapes 3 à 5 selon tes envies et les réponses de Funcom.

## Questions ouvertes

- Ton serveur privé : hébergé où, et avec quel accès ?
- Sietch reste un outil perso, ou tu veux le diffuser à d'autres joueurs ?

## Minuteurs, builds et données (2026-10-26)

- ✅ Modèles de minuteurs : un minuteur enregistré comme modèle se démarre en un clic (export et import compris).
- ✅ Ctrl+Maj+R relance le dernier minuteur terminé sans ouvrir Sietch (notification silencieuse).
- ✅ Builds : recherche (nom, équipement, notes) et filtre par usage, affichés à partir de 4 builds.
- 🟡 À essayer en jeu : le raccourci de relance, une fois la vraie version installée.
- ✅ Widget Mini-carte (2026-10-27) : nord en haut, centré sur le joueur, fond, zones, lieux, flèche et secteur ; validé en jeu.

## Overlay et carte (2026-10-27)

- ✅ Écran Overlay dans la barre de gauche ; overlay affiché au lancement.
- ✅ Jauges en anneaux avec icônes : fonctions vitales en arc près du viseur, équipement au-dessus de la compétence C ; disposition par défaut réglée en jeu.
- ✅ Carte sans défilement, région automatique, suivi interrompu au déplacement manuel.
- ✅ Ressources en direct, mémoire des ressources vues, minuteur au clic.
- ✅ Pictogrammes des lieux et ressources, en silhouettes pleines (2026-10-27).
- ✅ Emplacements du sac et menace du ver (anneaux + alerte).
- 🟡 Noms des zones : seul le nom anglais est trouvé ; durabilité : dans le système d'entités du jeu, non lue.
- 🟡 Installation de la version de la CI : reportée par l'utilisateur.

## Idées pour plus tard (notées le 2026-10-27, rien de commencé)

Ordre conseillé : 1 + 2, puis 6, puis 8.

**Utiles aussi en ligne (aucune lecture du jeu)**
1. ✅ (2026-10-27) Calculateur d'artisanat : chaîne complète des matériaux d'un objet (minerai → lingot → pièce), recettes tirées d'awakening.wiki (CC BY-NC-SA, source citée).
2. ✅ (2026-10-27) Liste de courses d'un build : total des matériaux des pièces d'un build (relie Builds au calculateur).
3. ✅ (2026-10-27) Préparer une sortie dans le Désert profond : liste à cocher (eau, carburant, munitions, réparations), temps avant Coriolis, minuteurs utiles.
4. ✅ (2026-10-27) Minuteurs prêts à l'emploi : réapparitions des ressources (délais relevés en jeu). 🟡 Entretien de base et impôts : durées à relever en jeu.
5. ✅ (2026-10-27) Partage de marqueurs par code (amis, guilde), comme les builds.

**En solo, sans BattlEye**
6. ✅ (2026-10-27) Trace du trajet de la session sur la carte et la mini-carte.
7. Inventaire réel → « ce qu'il me manque » pour une recette (dépend du décodage de la liste du sac).
8. ✅ (2026-10-27) Alertes de chaleur et de soleil (valeurs déjà lues).
9. Journal de session : ressources récoltées, distance, durée.
12. ✅ (2026-10-27) Alerte du ver : niveau de menace (chance d'attirer le ver selon le bruit, le véhicule, le sable), lu dans le jeu si la valeur existe ; alerte avant l'attaque.

**Technique**
10. ✅ (2026-10-28) Écran de diagnostic dans l'onglet « Sans BattlEye ».
11. ✅ (2026-10-27) Installation de la version de la CI et mises à jour automatiques (quand l'utilisateur le voudra).

Écartés : lecture de l'écran (OCR des barres du jeu), jugée pas assez fiable par l'utilisateur.
13. ✅ (2026-10-27) Overlay seulement quand le jeu est au premier plan, masqué dans ses menus (curseur affiché).
14. ✅ (2026-10-27) Temps de jeu (session, jour, 7 jours).
15. ✅ (2026-10-28) Disposition automatique de l'overlay (arme en main, véhicule), validée en jeu.
