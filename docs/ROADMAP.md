# Feuille de route de Sietch

État au 2026-10-28 : v0.1.2 installée, v0.1.3 en cours de publication, mises à jour automatiques en place. On avance par lots courts, validés en
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

- 🟢 Premier vrai test de la **mise à jour automatique** (0.1.2 installée → 0.1.3).
- 🎮 **Fond de Hagga refait** une fois la carte découverte : `tools/capture-carte.ps1` puis `tools/assembler-carte.py`,
  calé sur l'ancien fond (même cadrage, rien à réaligner).
- 🎮 **Désert profond** : fond de carte, calibration, vérifier région automatique, ressources et lieux.
- 🟢 **Coups portés** : ennemi repéré plus vite qu'au relevé complet (suivre les personnages proches à part).
- 🟢 **Diagnostic** : ajouter l'état du relevé (passage en cours, durée) et le nombre de personnages suivis.
- 🟢 Nettoyage : vider le cache des traductions du wiki retirées (clés `sietch-wiki-fr*` du localStorage).

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
- 🟢 **Carte** : calques à afficher / masquer mémorisés, recherche par nom de ressource en français.
- 🟡 **Interface en anglais** (le wiki l'est déjà) : seulement si Sietch est diffusé.

## Lot 4 — Robustesse face aux patchs

But : qu'une mise à jour du jeu ne casse rien, ou se répare vite.

- 🟢 **Contrôle au démarrage** : liste des champs attendus (vie, sac, arme, siège, zone…) et ceux trouvés, dans le
  diagnostic ; un champ manquant = message clair au lieu d'une valeur vide.
- 🟢 Mettre les **offsets internes** (FText +0x10/+0x40, sac +0x38/+0x3C, liste du sac) derrière des vérifications de
  vraisemblance, comme pour le volume du sac.
- 🎮 Après chaque patch du jeu : `sietch-scan ue` puis vérification des champs, procédure dans la doc.

## Lot 5 — Diffusion (si l'utilisateur le veut)

- 🟢 README avec captures et GIF, page d'installation.
- 🔴 Lire le contrat d'utilisation de Funcom avant de diffuser les modules sans BattlEye.
- 🟡 Signature du `.exe` (SmartScreen) : certificat payant, 100 à 300 € par an.
- 🔴 gaming.tools : demander l'accès à leur base (recettes, statistiques), aujourd'hui interdit sans accord.

---

## Écarté

- Lecture de l'écran (OCR des barres du jeu) : pas assez fiable.
- Traduction automatique du wiki : seul un service non officiel était gratuit, sans garantie de marcher (retirée le
  2026-10-28).

## Questions ouvertes

- Serveur privé : hébergé où, avec quel accès ? (outils de serveur : sauvegardes avant Coriolis, réglages, redémarrages)
- Sietch reste un outil perso, ou il sera diffusé à d'autres joueurs ? (décide du lot 5 et de l'anglais)
