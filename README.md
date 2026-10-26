# Sietch

Compagnon de bureau non officiel pour **Dune: Awakening** : carte à marqueurs, minuteurs avec alarmes, builds, wiki et overlay toujours au premier plan.
Sietch ne lit ni ne modifie la mémoire du jeu : il reste compatible avec BattlEye.

## Fonctionnalités

- **Accueil** : compte à rebours de la tempête de Coriolis, minuteurs actifs, dernier marqueur, raccourcis, builds récents, notes rapides.
- **Carte** : Bassin de Hagga et Désert profond, grille A1–I9, marqueurs par type (clic droit pour en poser un), filtres, recherche par nom ou secteur, minuteur de réapparition lié, import/export JSON.
- **Minuteurs** : groupes, pause, relance, répétition, glisser-déposer. Ils tournent côté Rust, même fenêtres fermées.
- **Alarmes** : silencieuses, par notification système et message dans l'application ; rappels avant la tempête de Coriolis (24 h, 1 h, 10 min par défaut) ; mode Ne pas déranger.
- **Builds** : 9 emplacements, 5 écoles de compétences, notes, code de partage `SIETCH1-…`.
- **Wiki** : recherche sans accents, catégories, fenêtre dédiée avec historique.
- **Overlay** : heure serveur, Coriolis, minuteurs ; opacité, position, clic traversant.
- **Zone de notification**, **raccourcis globaux** réglables, lancement au démarrage, sauvegarde complète.

## Développement

```bash
npm install
npm run tauri dev
```

- Interface : TypeScript sans framework, Vite, Leaflet (`src/`).
- Moteur : Rust, Tauri 2 (`src-tauri/src/`). Tests : `cargo test` dans `src-tauri`.
- Contenu du wiki : `src/data/wiki.json` (les valeurs `[À COMPLÉTER]` sont à renseigner).

## Licence

GPL-3.0-or-later. Dune et Dune: Awakening appartiennent à leurs ayants droit ; Sietch n'y est pas affilié.
