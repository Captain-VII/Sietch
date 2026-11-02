# Feuille de route de Sietch

État au 2026-11-02 : v0.1.5 publiée, mises à jour automatiques vérifiées. On avance par lots courts, validés en
dev par l'utilisateur, puis une release quand il le demande (voir `CLAUDE.md`).

Légende : 🟢 prêt à faire · 🎮 demande le jeu sans BattlEye (l'utilisateur en jeu) · 🟡 dépend d'une info ou d'un choix ·
🔴 dépend d'un tiers.

---

## Déjà fait (résumé)

- **Overlay** : un widget par élément, dispositions Exploration / Combat / Véhicule choisies seules (arme, véhicule),
  grille d'édition aimantée au viseur, masqué dans les menus du jeu, bandeau des alertes.
- **Personnage en direct** (sans BattlEye, lecture par les noms d'Unreal Engine) : vie, endurance, eau, énergie, sac
  (volume et emplacements), chaleur, ver, heure du jeu, zone en français, coups portés (croix + dégâts), journal de partie.
- **Carte** : position en direct, région automatique, lieux et ressources lus dans le jeu, trajet, fond de carte local,
  partage de marqueurs.
- **Pour tous, avec BattlEye** : minuteurs (prêts à l'emploi, modèles), Coriolis, builds, artisanat (recettes du wiki),
  préparer une sortie, wiki intégré (en anglais), temps de jeu.
- **Diffusion** : releases signées pour la mise à jour, `latest.json`, CI de release rapide (cache partagé, LTO thin).

---

## Lot 1 — Fiabiliser ce qui existe (prochain)

But : que tout ce qui est livré marche sans surprise, en ligne comme en solo.

- ✅ Premier vrai test de la **mise à jour automatique** : 0.1.2 → 0.1.3 réussi (2026-10-28).
- ✅ **Fond de Hagga refait** : calculé depuis les maquettes 3D du jeu (2026-11-02, voir lot 6).
- 🎮 **Désert profond** : fond de carte, calibration, vérifier région automatique, ressources et lieux.
- 🟢 **Coups portés** : ennemi repéré plus vite qu'au relevé complet (suivre les personnages proches à part).
- ✅ **Diagnostic** : état du relevé et personnages suivis, dans Paramètres › À propos (2026-11-02).
- ✅ Nettoyage : cache des traductions du wiki retirées vidé au lancement (2026-11-02).

**Fini quand** : une soirée complète en ligne et une en solo avec la version installée, sans bug.

## Lot 2 — Inventaire réel (solo, sans BattlEye)

But : que Sietch sache ce que le joueur porte, pour répondre à « qu'est-ce qu'il me manque ? ».

- 🎮 **Décoder la liste du sac** : identifiants d'objets (déjà localisés, `docs/personnage-en-direct.md`) → modèle
  d'objet → nom. Commencer par 2 ou 3 objets connus, comparer avant / après un ramassage.
- 🎮 **Usure des équipements** : fiches de 0x58 octets trouvées (usure en %) ; les relier aux emplacements
  d'équipement (arme, power pack, ceinture, armure). Widget discret + alerte « bientôt cassé ».
- 🟢 Une fois l'inventaire lu : **« Ce qu'il me manque »** dans Artisanat et Builds (recette − sac), et liste de
  courses qui se coche toute seule.
- 🟢 **Journal de partie** enrichi : ressources ramassées (différence du sac), durée en combat.

**Fini quand** : l'écran Artisanat affiche, pour un objet, ce que le sac contient déjà et ce qu'il reste à récolter.

## Lot 3 — Confort pour tout le monde (avec BattlEye)

But : rendre Sietch utile aux joueurs en ligne, sans lire le jeu.

- 🟡 **Minuteurs d'entretien de base et d'impôts** : durées à relever en jeu par l'utilisateur.
- 🟢 **Notes de marqueur enrichies** : captures d'écran, liste à récolter, lien vers le minuteur.
- 🟢 **Liens builds ↔ wiki** : un emplacement de build ouvre l'article de l'objet.
- ✅ **Carte** : calques mémorisés (marqueurs compris), recherche par nom de ressource : la plus proche des présentes (2026-11-02).
- 🟡 **Interface en anglais** (le wiki l'est déjà) : seulement si Sietch est diffusé.

## Lot 4 — Robustesse face aux patchs

But : qu'une mise à jour du jeu ne casse rien, ou se répare vite.

- ✅ **Contrôle au démarrage** (2026-11-02) : Paramètres › À propos, carte « Lecture du jeu » : champs indispensables
  introuvables nommés (« le jeu a changé »), lectures facultatives (heure, sac, ver, arme, véhicule, zone, caméra) lues ou non.
- ✅ **Offsets internes** vérifiés (2026-11-02) : nom de zone illisible écarté (`ftext`), volume du sac entre 0 et deux
  fois le maximum ; liste du sac et maximum déjà contrôlés.
- 🎮 Après chaque patch du jeu : `sietch-scan ue` puis vérification des champs, procédure dans la doc.

## Lot 5 — Diffusion (plus tard, si besoin de partager)

- 🟢 README avec captures et GIF, page d'installation.
- 🔴 Lire le contrat d'utilisation de Funcom avant de diffuser les modules sans BattlEye.
- 🟡 Signature du `.exe` (SmartScreen) : certificat payant, 100 à 300 € par an.
- 🔴 Version en ligne (lecture avec BattlEye) : demander l'accord de Funcom une fois le mode hors ligne solide ;
  l'autorisation par BattlEye demandera sans doute un `.exe` signé (voir `docs/analyse-gaming-tools-companion.md`).
- 🔴 gaming.tools : demander l'accès à leur base (recettes, statistiques), aujourd'hui interdit sans accord.

## Lot 6 — Carte du jeu en 3D et régions (fond fait le 2026-11-02)

But : un fond de Hagga au rendu de la carte plein écran du jeu, calé au mètre, et les régions nommées dessus.
Piste et blocage détaillés dans `docs/carte-en-direct.md` (« Carte 3D et régions »).

- ✅ **Géométrie débloquée** : CUE4Parse récent réglé sur `GAME_DuneAwakening` (.NET 10), sans `.usmap`.
- ✅ **Fond 3D de Hagga** : `sietch-assets relief`, maquettes `SM_…_UIMap` posées aux blocs des sous-niveaux, ombrées,
  2 m par pixel (local, jamais dans le dépôt). Plus à jour que la texture officielle (Sheol).
- ✅ Dunes du sable (tuiles `SOS-MinorErg`) et couleurs de la vraie carte 3D, zone par zone.
- 🟢 Fond du **Désert profond** par la même méthode.
- ✅ **Régions nommées** : 12 régions de Hagga, noms et territoires en français, colorées par territoire, toujours
  affichées (`sietch-assets regions`). Zones de danger aux couleurs de la carte du jeu, radiations en brume.
- ✅ **Lieux du jeu** : 652 lieux de Hagga extraits des fichiers (noms français, icônes officielles, zoom d'apparition du
  jeu), sur la carte même jeu fermé ; recherche par nom ou type.
- ✅ Mini-carte : mêmes lieux que la carte, icônes officielles.
- ✅ Mini-carte : région d'après la position quand le nom de zone du jeu manque (2026-11-02).

---

## Écarté

- Lecture de l'écran (OCR des barres du jeu) : pas assez fiable.
- Traduction automatique du wiki : seul un service non officiel était gratuit, sans garantie de marcher (retirée le
  2026-10-28).

## Décisions (2026-10-28)

- **Jeu en solo**, avec ce personnage : pas de serveur privé, donc pas d'outils de serveur (sauvegardes, réglages,
  redémarrages). Les modules sans BattlEye restent la priorité.
- **Outil perso**, partagé plus tard si besoin : le lot 5 (diffusion, anglais, signature) attend ce besoin.
- **TH.GL** : l'onglet « Carte TH.GL » (iframe) est retiré le 2026-11-02 : la carte de Sietch, tirée des fichiers du jeu, le remplace.
