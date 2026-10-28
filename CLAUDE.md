# Sietch — mémoire du projet

Compagnon de bureau **non officiel** pour Dune: Awakening (Funcom, Unreal Engine 5, Windows).
Application Tauri 2 : moteur Rust + interface TypeScript sans framework. Dépôt **public** :
https://github.com/Captain-VII/Sietch (licence GPL-3.0-or-later).

À lire avant toute modification. Pour installer le projet sur une nouvelle machine : [docs/REPRENDRE.md](docs/REPRENDRE.md).

## L'utilisateur

- Parle français : interface, commentaires, commits et réponses en français.
- Veut aller vite : un push sur `main` suffit au quotidien (la CI produit le `.exe`, sans paquet de mise à jour).
  Les **releases** (depuis le 2026-10-27) se font sur demande, voir « Release et mises à jour » : jamais un tag par
  petit changement ; on accumule en dev, et la release ne part que quand l'utilisateur a tout validé.
- Les **overlays et widgets** se testent par-dessus le jeu, sur l'écran principal (sans jamais voler son focus) ;
  le reste de Sietch s'ouvre sur l'écran secondaire.
- Ne veut **aucun son** : les alertes passent par la notification système (silencieuse) et un toast dans l'app.
- A fourni l'illustration du logo (`assets/icon.png`, ver peint) et sa version plate (`assets/icon-plate.png`).
- La maquette de design est l'artefact claude.ai « Dune Compagnon » (canevas Design).

## Arborescence

| Où | Quoi |
|---|---|
| `src-tauri/src/lib.rs` | commandes Tauri, démarrage, fermeture vers la zone de notification |
| `src-tauri/src/engine.rs` | boucle de fond (500 ms) : minuteurs, rappels Coriolis, notifications |
| `src-tauri/src/timers.rs`, `settings.rs`, `state.rs` | minuteurs, réglages (calcul Coriolis), persistance JSON atomique |
| `src-tauri/src/live.rs` | **modules sans BattlEye** : détection jeu/BattlEye, lecture mémoire (Windows) |
| `src-tauri/src/tray.rs`, `shortcuts.rs`, `windows.rs` | zone de notification, raccourcis globaux, fenêtres (principale, overlay, wiki, web) |
| `src/main.ts` | coquille de la fenêtre principale, routeur, événements |
| `src/views/*.ts` | écrans : accueil, overlay (dispositions des widgets), carte (Leaflet), stats brutes, minuteurs, builds, wiki, paramètres |
| `src/widget.ts`, `src/wiki-window.ts` | widgets de l'overlay (une fenêtre par élément, `windows.rs` ; jauges en anneaux, mini-carte en canevas) et fenêtre wiki |
| `src/lib/carte.ts` | types de lieux et de ressources (couleurs, pictogrammes dessinés pour Sietch), conversion jeu → carte |
| `tools/sietch-scan`, `tools/assembler-carte.py` | exploration de la mémoire (lecture seule) ; assemblage des captures de la carte du jeu (local) |
| `src/lib/` | `api.ts` (types + invoke), `data.ts` (marqueurs/builds via plugin-store), `time.ts`, `dom.ts` (`h()`), `wiki*.ts`, `live.ts` + `affine.ts` (position), `mock.ts` (mode navigateur) |
| `.github/workflows/windows.yml` | compilation Windows à chaque push sur `main` |

## Commandes

```bash
npm ci                       # dépendances
npm run tauri dev            # lancer (Rust + Vite sur le port 1420)
SIETCH_SIMULATION=1 npm run tauri dev   # simule un jeu sans BattlEye et une position qui bouge
npx tsc --noEmit -p .        # types
cd src-tauri && cargo test && cargo clippy   # tests (25) et lint Rust, doit rester à 0 avertissement
npm run tauri build          # installateurs (sous Windows : NSIS + MSI)
npm run icon                 # regénère toutes les icônes depuis assets/ (et force la recompilation Rust)
```

**Mode navigateur** : `npm run dev`, puis ouvrir http://localhost:1420. `src/lib/mock.ts` simule le moteur Rust
(données dans le localStorage, clé `sietch-mock`). Pratique pour tester l'interface avec un navigateur piloté.
Les requêtes du wiki y passent par le relais Vite `/__wiki`.

## Décisions à respecter

- **Wiki** : articles d'awakening.wiki (CC BY-NC-SA 4.0, source citée sous chaque article), chargés à la demande
  par `?action=render` ; index par le sitemap (cache 7 jours). Jamais `api.php` ni `index.php` (robots.txt).
- **dune.gaming.tools** : seulement ouvert dans la fenêtre « web ». Leurs CGU interdisent de copier leur base sans
  autorisation, et le site bloque les accès automatiques. Ne pas scraper.
- **Modules sans BattlEye** (`live.rs`) : la lecture de la mémoire du jeu n'a lieu que si le jeu tourne **sans**
  BattlEye (mode solo ou serveur privé ; option officielle depuis la 1.5) **et** que l'utilisateur l'a activée.
  Lecture seule (`PROCESS_VM_READ`), poignée fermée dès que BattlEye apparaît, état incertain = BattlEye supposé actif.
  Le jeu n'est ouvert qu'après 3 vérifications d'affilée sans BattlEye (6 s), pour ne jamais le lire au lancement.
  Ne jamais écrire dans la mémoire du jeu ni ajouter de triche. Ce garde-fou reste tant que Funcom n'a rien dit d'officiel.
- **Sécurité des fenêtres** : la fenêtre « web » (sites externes) n'a aucune permission Tauri ; seuls
  awakening.wiki et dune.gaming.tools y sont autorisés (`windows.rs`).
- Icônes embarquées à la compilation : après un changement d'icône, `npm run icon` (touche `lib.rs`).
- **Fenêtres** : `"create": false` dans `tauri.conf.json`, créées dans `setup` après `manage(AppState)`. Sinon, en
  release (pages embarquées), le front appelle les commandes avant `manage()` → « state not managed ». Invisible en dev.
  Toute nouvelle fenêtre de la config suit la même règle. Une commande Tauri qui crée une fenêtre doit être `async`,
  sinon la fenêtre reste blanche sous Windows (cas de `open_site`, corrigé le 2026-10-26).
  Les fenêtres de la config ont `"focus": false` : sinon, même cachées, elles prennent le focus au jeu au démarrage.
- **Widgets de l'overlay** (`windows.rs`) : une fenêtre par élément, créée depuis une tâche de fond (`refresh_widgets`),
  transparente, toujours devant, avec `WS_EX_NOACTIVATE` (un clic ne doit jamais prendre le focus au jeu ;
  `focusable(false)` ne suffit pas). Positions enregistrées en sortant du mode édition. En dev, la fenêtre principale
  reste cachée au démarrage (l'appli redémarre à chaque modification du Rust).

## Release et mises à jour

1. Monter la version dans `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` et `package.json` (les trois identiques).
2. Commit, push, puis tag `vX.Y.Z` poussé : `.github/workflows/release.yml` vérifie que le tag = la version, teste,
   compile, signe et publie la release GitHub avec `latest.json`.
3. Les Sietch installés lisent `releases/latest/download/latest.json` (`update.rs`) : au lancement + 30 s puis toutes les
   6 h, notification silencieuse ; l'installation se lance depuis Paramètres › À propos (installateur NSIS passif,
   puis relance). Rien en mode dev.

- Clé de signature : `C:\Users\Admin\Sietch-keys\` (`updater.key`, `updater.password`, hors dépôt, à sauvegarder),
  copiée dans les secrets GitHub `TAURI_SIGNING_PRIVATE_KEY` et `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
  (avec `gh secret set … --body`, pas par un tube PowerShell : il ajoute un BOM et la clé devient illisible). Perdue = plus
  aucune mise à jour possible pour les versions installées. Clé publique dans `tauri.conf.json` (`plugins.updater`).
- `npm run tauri build` en local exige ces deux variables d'environnement ; sinon ajouter
  `--config src-tauri/tauri.ci.conf.json` (sans paquet de mise à jour, comme la CI de `main`).

## État au 2026-10-27

Toujours en **mode dev** (`npm run tauri dev`) : l'utilisateur ne veut pas encore installer la version de la CI.

- **Personnage en direct** (`ue.rs`, lecture par les noms UE) : vie, endurance, eau, énergie, volume du sac, heure du jeu.
  Plusieurs `BP_DunePlayerCharacter_C` peuvent exister : on garde celui dont `MaxHealth` > 0.
- **Overlay** : écran à part dans la barre de gauche. Jauges en anneaux (widgets `gauges` = vie/endurance/eau en arc
  à droite du viseur, `gear` = énergie/sac au-dessus de la compétence C), menace du ver (`threat`, grand anneau + %, à gauche du viseur
  (à droite, le jeu affiche ses gains), violet et pulsant dès le seuil d'alerte), mini-carte en haut à droite.
  Disposition par défaut réglée en jeu sur 2560 × 1440, rapportée à l'écran (`windows.rs::default_pos`).
  L'overlay s'affiche au lancement.
- **Carte** : sans défilement (pleine hauteur), suivi du joueur arrêté dès qu'on déplace la carte, région automatique
  (calque de carte lu dans le jeu), lieux et ressources avec pictogrammes. Les pictogrammes restent jugés « vagues » : à reprendre.
- **Ressources en direct** : générateurs dérivés de `ResourceSpawner`, relus toutes les 15 s ; mémoire des ressources
  vues dans `%APPDATA%\com.captainvii.sietch\ressources-vues.json` (local). Clic sur une ressource = minuteur de réapparition.
- **Fond de carte** (local, jamais dans le dépôt) : captures de l'utilisateur assemblées puis retouchées zone par zone
  (`captures-carte\hagga\retouche-*.webp`). Pour capturer : masquer l'overlay (Ctrl+Maj+O) et les filtres
  « Événements/Dangers » de la carte du jeu, même zoom (dézoom maximum).
- **Sac** : emplacements occupés (sous l'anneau du volume). **Ver** : menace en % du seuil d'attaque, anneau + alerte.
  **Menus du jeu** (`menu.rs`) : widgets effacés tant que la fenêtre `UnrealWindow` est au premier plan avec le curseur
  affiché (inventaire, carte, Échap) ; Windows seul, rien de lu dans le jeu, marche avec BattlEye. Validé en jeu.
  **Bandeau des alertes** (`widget-banner`, hors dispositions) : en haut au centre, affiche chaque alerte 8 s ; suit l'overlay.
  **Chaleur** : alerte à 70 % de `HeatstrokeThreshold` (100 en jeu), texte « plein soleil » si `CurrentSunExposure` > 0.
  **Trajet** de la session (`state.trail`, un point tous les 20 m, coupé après un saut de 500 m, vidé au changement
  de région) : pointillés sur la carte et la mini-carte, bouton « Effacer le trajet ».
  Relevé des ressources découpé en morceaux (20 000 objets par tick, passage ~5 s en debug) pour ne pas figer la lecture.
- **Sans lire le jeu (marche avec BattlEye)** : widgets visibles seulement jeu au premier plan et hors menus
  (`menu.rs`) ; temps de jeu d'après le processus (`playtime.rs`, `temps-de-jeu.json`, carte de l'Accueil) ;
  minuteurs prêts à l'emploi (délais relevés : 25 min, buisson 3 min) ; « Préparer une sortie » (Accueil) ;
  partage de marqueurs `SIETCHM1-…` ; écran **Artisanat** (`lib/recipes.ts`, tableaux « Crafted By » du wiki,
  pages d'ensemble « Armor Set », eau en mL, cache 7 j) et liste de courses d'un build ; pictogrammes de la carte
  en silhouettes pleines (evenodd).
- **Dispositions préfaites** (`settings.rs::PRESETS`, copie dans `views/overlay.ts`) : Exploration, Combat (personnage
  seul), Véhicule (repères + ver) ; ajoutées une fois aux anciens réglages (`layouts_version`), placées comme la
  première disposition. Écran Overlay en trois blocs : Disposition (onglets), Éléments (Repères / Personnage), Comportement.
  **Disposition automatique** (`auto_layout`, sans BattlEye) : validée en jeu le 2026-10-28 (`m_bHasWeaponInHand`,
  `m_CurrentSeat` ; `docs/personnage-en-direct.md`). **Diagnostic** dans Paramètres › Sans BattlEye (`live.rs::Diagnostic`) :
  structures, personnage, dernière lecture, lectures réussies/manquées, arme, véhicule, ressources.
- Menace du ver : widget affiché seulement quand la menace dépasse 0 (sur le sable), 15 s de répit.
- **2026-10-28** : nom de zone en français (texte du widget du HUD, `ue.rs::ftext`) dans le widget Secteur ; coups portés
  (baisse de vie des personnages proches, widget `hits` au centre) ; grille du mode édition (`widget-grid`, aimantation 20 px).
- **Reste** : durabilité, trouvée en mémoire mais pas encore reliée aux objets (`docs/personnage-en-direct.md`).

## État au 2026-10-26 (fin de la session sur le Mac)

Fait et testé dans le navigateur (moteur simulé) : tous les écrans, minuteurs, carte, builds, wiki en ligne,
paramètres, overlay, position en direct simulée. CI Windows verte (dernier run : commit `7994955`).

**Vérifié sur le PC le 2026-10-26** (vraie application en mode dev, à côté du jeu) : wiki chargé depuis l'app
(plugin HTTP), notifications Windows, zone de notification, raccourcis globaux depuis le jeu (Ctrl+Maj+O/W/C/M/T),
overlay par-dessus le jeu (position, clic traversant), heure de la tempête de Coriolis (mardi 03:00, UTC+1, confirmée).

Installateur de la CI installé et lancé sans erreur (commit `6e3d7bb`). Étape 0 terminée.

Étape 1 : chaîne de pointeurs trouvée le 2026-10-26 avec `tools/sietch-scan` (lecture seule, refuse de tourner avec
BattlEye) ; Sietch affiche la position en direct. La chaîne et les chaînes de secours restent en local, dans
`%APPDATA%\com.captainvii.sietch\` (pas dans le dépôt). Après un patch : refaire la recherche, méthode dans
[docs/position-en-direct.md](docs/position-en-direct.md).

**Suite** : feuille de route dans [docs/ROADMAP.md](docs/ROADMAP.md) : calibrer la carte (Hagga, Désert profond),
puis outil de diagnostic, chaîne résistante aux patchs.
Tenir la feuille de route à jour quand une étape avance.

## Concurrence et contexte

- Dune Companion (gaming.tools) et TH.GL lisent déjà l'état du joueur en ligne et affirment que Funcom le tolère
  (déclaration Reddit non retrouvée). Sietch se distingue : open source, sans pub, sans compte, hors ligne.
- Noms de processus (sources communautaires) : jeu `DuneSandbox-Win64-Shipping.exe`, BattlEye `DuneSandbox_BE.exe`,
  `BEService.exe` / `BEService_x64.exe`. Modifiables dans `position.json` si besoin.

## Notes Obsidian

Le projet a une fiche `Sietch.md` dans le vault (projet github-obsidian : `Documents\github-obsidian\CLAUDE.md`).
La synchro du soir sur le PC la créera ou la mettra à jour à partir des commits.
