# Sietch — mémoire du projet

Compagnon de bureau **non officiel** pour Dune: Awakening (Funcom, Unreal Engine 5, Windows).
Application Tauri 2 : moteur Rust + interface TypeScript sans framework. Dépôt **public** :
https://github.com/Captain-VII/Sietch (licence GPL-3.0-or-later).

À lire avant toute modification. Pour installer le projet sur une nouvelle machine : [docs/REPRENDRE.md](docs/REPRENDRE.md).

## L'utilisateur

- Parle français : interface, commentaires, commits et réponses en français.
- Veut aller vite : **pas de tags ni de releases**. Un push sur `main` suffit, la CI produit le `.exe`.
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
| `src/views/*.ts` | écrans : accueil, carte (Leaflet), minuteurs, builds, wiki, paramètres |
| `src/widget.ts`, `src/wiki-window.ts` | widgets de l'overlay (une fenêtre par élément, `windows.rs`) et fenêtre wiki |
| `src/lib/` | `api.ts` (types + invoke), `data.ts` (marqueurs/builds via plugin-store), `time.ts`, `dom.ts` (`h()`), `wiki*.ts`, `live.ts` + `affine.ts` (position), `mock.ts` (mode navigateur) |
| `.github/workflows/windows.yml` | compilation Windows à chaque push sur `main` |

## Commandes

```bash
npm ci                       # dépendances
npm run tauri dev            # lancer (Rust + Vite sur le port 1420)
SIETCH_SIMULATION=1 npm run tauri dev   # simule un jeu sans BattlEye et une position qui bouge
npx tsc --noEmit -p .        # types
cd src-tauri && cargo test && cargo clippy   # tests (10) et lint Rust, doit rester à 0 avertissement
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
