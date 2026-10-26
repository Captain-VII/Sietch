# Sietch

Compagnon de bureau non officiel pour **Dune: Awakening** : carte à marqueurs, minuteurs avec alarmes, builds, wiki et overlay toujours au premier plan.
Sietch ne lit ni ne modifie la mémoire du jeu : il reste compatible avec BattlEye.

## Fonctionnalités

- **Accueil** : compte à rebours de la tempête de Coriolis, minuteurs actifs, dernier marqueur, raccourcis, builds récents, notes rapides.
- **Carte** : Bassin de Hagga et Désert profond, grille A1–I9, marqueurs par type (clic droit pour en poser un), filtres, recherche par nom ou secteur, minuteur de réapparition lié, import/export JSON.
- **Minuteurs** : groupes, pause, relance, répétition, glisser-déposer. Ils tournent côté Rust, même fenêtres fermées.
- **Alarmes** : silencieuses, par notification système et message dans l'application ; rappels avant la tempête de Coriolis (24 h, 1 h, 10 min par défaut) ; mode Ne pas déranger.
- **Builds** : 9 emplacements, 5 écoles de compétences, notes, code de partage `SIETCH1-…`.
- **Wiki** : les articles du [Dune: Awakening Community Wiki](https://awakening.wiki/) (soutenu par Funcom), chargés à la demande et affichés dans Sietch ; recherche dans les titres, fenêtre dédiée avec historique. Contenu sous licence CC BY-NC-SA 4.0, source citée sous chaque article.
- **Base de données** : [dune.gaming.tools](https://dune.gaming.tools/) s'ouvre dans une fenêtre de Sietch. Ses conditions interdisent de copier sa base sans autorisation : Sietch ne la récupère donc pas.
- **Overlay** : heure serveur, Coriolis, minuteurs ; opacité, position, clic traversant.
- **Position en direct** (modules sans BattlEye) : en mode solo ou sur un serveur privé lancé sans BattlEye, Sietch lit la position du joueur (lecture seule) pour l'afficher sur la carte et dans l'overlay. Coupé dès que BattlEye est détecté. Réglage dans `position.json` (chaîne de pointeurs), calibration depuis la carte. Test sans le jeu : `SIETCH_SIMULATION=1 npm run tauri dev`.
- **Zone de notification**, **raccourcis globaux** réglables, lancement au démarrage, sauvegarde complète.

## Développement

```bash
npm install
npm run tauri dev
```

- Interface : TypeScript sans framework, Vite, Leaflet (`src/`).
- Moteur : Rust, Tauri 2 (`src-tauri/src/`). Tests : `cargo test` dans `src-tauri`.
- Wiki : `src/lib/wiki.ts`. Sietch lit le plan du site (sitemap) et les pages `?action=render`, jamais `api.php` ni `index.php`, que le robots.txt du wiki réserve.
- En mode navigateur (`npm run dev`), les requêtes du wiki passent par le relais de Vite.

## Version Windows

À chaque envoi sur `main`, GitHub Actions compile Sietch pour Windows (`.github/workflows/windows.yml`).
Le résultat se télécharge dans l'onglet **Actions** du dépôt, rubrique **Artifacts** :
l'installateur (`setup.exe` ou `.msi`) et l'exécutable seul.

## Licence

GPL-3.0-or-later. Dune et Dune: Awakening appartiennent à leurs ayants droit ; Sietch n'y est pas affilié.
