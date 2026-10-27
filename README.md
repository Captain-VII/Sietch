# Sietch

Compagnon de bureau non officiel pour **Dune: Awakening** : carte à marqueurs, minuteurs avec alarmes, builds, wiki et overlay toujours au premier plan.
Sietch ne modifie jamais le jeu. Il ne lit sa mémoire (en lecture seule) qu'en mode solo ou sur un serveur privé sans BattlEye, et seulement si vous l'activez.

## Installation

Téléchargez `Sietch_…_x64-setup.exe` dans la [dernière release](https://github.com/Captain-VII/Sietch/releases/latest) et lancez-le.
L'exécutable n'est pas signé : Windows SmartScreen peut demander « Informations complémentaires » › « Exécuter quand même ».
Sietch vérifie ensuite lui-même les nouvelles versions et les installe depuis Paramètres › À propos.

## Fonctionnalités

- **Accueil** : compte à rebours de la tempête de Coriolis, minuteurs actifs, dernier marqueur, raccourcis, builds récents, notes rapides.
- **Carte** : Bassin de Hagga et Désert profond, grille A1–I9, marqueurs par type (clic droit pour en poser un), filtres, recherche par nom ou secteur, minuteur de réapparition lié, import/export JSON.
- **Minuteurs** : groupes, pause, relance, répétition, glisser-déposer. Ils tournent côté Rust, même fenêtres fermées.
- **Alarmes** : silencieuses, par notification système et message dans l'application ; rappels avant la tempête de Coriolis (24 h, 1 h, 10 min par défaut) ; mode Ne pas déranger.
- **Builds** : 9 emplacements, 5 écoles de compétences, notes, code de partage `SIETCH1-…`.
- **Wiki** : les articles du [Dune: Awakening Community Wiki](https://awakening.wiki/) (soutenu par Funcom), chargés à la demande et affichés dans Sietch ; recherche dans les titres, fenêtre dédiée avec historique. Contenu sous licence CC BY-NC-SA 4.0, source citée sous chaque article.
- **Base de données** : [dune.gaming.tools](https://dune.gaming.tools/) s'ouvre dans une fenêtre de Sietch. Ses conditions interdisent de copier sa base sans autorisation : Sietch ne la récupère donc pas.
- **Overlay** : un widget par élément (heure, Coriolis, secteur, minuteurs, mini-carte, jauges), dispositions, échelle, opacité, clic traversant ; bandeau d'alerte en haut de l'écran.
- **Modules sans BattlEye** (à activer) : en mode solo ou sur un serveur privé lancé sans BattlEye, Sietch lit le personnage en lecture seule : position et trajet sur la carte et la mini-carte, vie, endurance, eau, énergie, sac, menace du ver, ressources alentour avec minuteur de réapparition, et alertes (eau, vie, chaleur, ver…). Tout est coupé dès que BattlEye est détecté. Test sans le jeu : `SIETCH_SIMULATION=1 npm run tauri dev`.
- **Zone de notification**, **raccourcis globaux** réglables, lancement au démarrage, sauvegarde complète.

## Développement

```bash
npm install
npm run tauri dev
```

- Interface : TypeScript sans framework, Vite, Leaflet (`src/`).
- Moteur : Rust, Tauri 2 (`src-tauri/src/`). Tests : `cargo test` dans `src-tauri`.
- Reprendre sur une autre machine : [docs/REPRENDRE.md](docs/REPRENDRE.md). Mémoire du projet pour Claude : [CLAUDE.md](CLAUDE.md).
- Position en direct : [docs/position-en-direct.md](docs/position-en-direct.md).
- Feuille de route : [docs/ROADMAP.md](docs/ROADMAP.md).
- Wiki : `src/lib/wiki.ts`. Sietch lit le plan du site (sitemap) et les pages `?action=render`, jamais `api.php` ni `index.php`, que le robots.txt du wiki réserve.
- En mode navigateur (`npm run dev`), les requêtes du wiki passent par le relais de Vite.

## Version Windows

À chaque envoi sur `main`, GitHub Actions compile Sietch pour Windows (`.github/workflows/windows.yml`) :
installateurs dans l'onglet **Actions**, rubrique **Artifacts**.
Un tag `vX.Y.Z` publie une release signée avec son fichier de mise à jour (`.github/workflows/release.yml`).

## Licence

GPL-3.0-or-later. Dune et Dune: Awakening appartiennent à leurs ayants droit ; Sietch n'y est pas affilié.
