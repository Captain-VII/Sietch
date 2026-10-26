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

- 🟢 Trouver la chaîne de pointeurs (guide : `docs/position-en-direct.md`) et calibrer les deux régions.
- 🟢 Ajouter un outil de diagnostic dans l'onglet « Sans BattlEye » : dernière valeur lue, nombre d'échecs,
  pour comprendre vite pourquoi la position ne vient pas.
- 🟡 Rendre la chaîne **résistante aux patchs** : retrouver automatiquement le point de départ (recherche d'une
  signature d'octets) au lieu d'un décalage fixe. Gros gain de confort, mais plus technique.
- 🟢 Proposer la calibration de la région en un clic quand on change de zone (Hagga ↔ Désert profond).

**Fini quand** : la position tient après un redémarrage du jeu, et se répare en moins de 10 minutes après un patch.

## Étape 2 — Confort de jeu, pour tout le monde (aucune lecture du jeu)

Objectif : rendre Sietch utile même en ligne, avec BattlEye.

- 🟡 **Minuteurs prêts à l'emploi** : délais de réapparition des ressources courantes (à relever en jeu ou sur le
  wiki), en un clic depuis le marqueur.
- 🟢 **Fond de carte** : importer sa propre image par région (capture de la carte du jeu) et la caler sur la grille.
- 🟢 **Partage de marqueurs** par code, comme pour les builds (entre amis, en guilde).
- 🟢 **Overlay personnalisable** : choisir les blocs affichés (heure, Coriolis, minuteurs, secteur), taille.
- 🟢 **Liens wiki ↔ builds** : un emplacement de build ouvre l'article de l'objet sur awakening.wiki.
- 🟢 **Notes par marqueur** enrichies (captures d'écran, liste de choses à récolter).

**Fini quand** : on peut préparer une sortie dans le Désert profond uniquement depuis Sietch.

## Étape 3 — Plus de données du jeu (solo / privé, sans BattlEye)

Objectif : étendre la lecture seule au-delà de la position. **Chaque donnée demande sa propre chaîne de pointeurs**,
donc du temps à chaque patch : ne faire que ce qui sert vraiment.

- 🟢 Généraliser `position.json` en liste de valeurs lues (position, eau, chaleur…).
- 🟡 Eau, chaleur, état du distille dans l'overlay, avec alerte quand ça baisse.
- 🟡 Minuteur lancé automatiquement quand on récolte un nœud.
- 🟡 Inventaire réel → « ce qu'il me manque » pour un build ou une fabrication.

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
