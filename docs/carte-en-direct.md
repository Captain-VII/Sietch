# Carte en direct : ce que le jeu garde en mémoire

Exploré le 2026-10-26 avec `tools/sietch-scan` (lecture seule, solo sans BattlEye), dans le Bassin de Hagga.
`ue-classes PersistentLevel` liste les objets du niveau par classe.

## Points d'intérêt : les « Terrain Blocks »

`BP_TerrainBlockActor_C` (environ 1 000 dans le niveau, **toute la région**, pas seulement autour du joueur).
Chacun pointe (`m_TerrainBlockAsset`, +0x3F0) vers un `TerrainBlockDataAsset` dont le nom donne le type :
`CB_<biome>_<type>_<n>`. Les données (`m_Data` → `TerrainBlockRow.Settings.Tags`) ont aussi des Gameplay Tags,
à lire pour une classification plus fine.

| Mot dans le nom | Point d'intérêt |
|---|---|
| `Ecolab` | station écologique |
| `SB_…Base`, `AtreidesBase`, `SandFliesBase` | bases (petites bases, bases ennemies) |
| `WreckedShip`, `ChoamWreckage` | épaves |
| `MiningGallery` | galeries de mine |
| `Altar`, `Altar_Room` | autels et salles d'autel |
| `LandsraadShelter` | abris du Landsraad |
| `Harvester` | moissonneuses |
| `Story_…` | lieux de l'histoire |
| `Generic`, `CliffFormation`, `Hoodoo`, `Peak`, `Slope`… | relief : à ignorer |

## Ressources : les générateurs

Classes `BP_<ressource>_Spawner_C` et `BP_<ressource>_Pickup_<x>_Spawner_C`, chargées autour du joueur :
Azurite (minerai de cuivre), Rhyolite (pierre), ScrapMetal (ferraille), ScrapElectronics, ImpureFuel, champs d'épice
(`BP_SpiceField_Small_C`), champs de sable de farine (`BP_FlourSandField_Small_C`), épaves d'ornithoptère
(`BP_CrashedOrnithopterSpawn_C`).

## Position

Comme le personnage : `RootComponent` → `RelativeLocation` (3 × f64, en cm).

## Pistes écartées

- `MapMarkerSubsystem`, `ServerMapMarkerComponent` : données internes, rien d'exploitable par les noms.
- `BP_MapMarkerZone_C` : simples boîtes de découverte, sans type ni icône.

## Fond de carte à partir de captures

La carte du jeu ne se dézoome pas assez pour tenir sur un écran : on la capture en plusieurs morceaux (même
zoom, un peu de chevauchement), puis `tools/assembler-carte.py` les assemble (corrélation de phase, puis vote
pour relier les groupes qui ne se recouvrent que sur une bande étroite). Le cadre hachuré rouge de la carte
correspond aux limites lues en mémoire : on recadre l'image dessus et elle se cale sans alignement manuel.

```bash
python -I tools/assembler-carte.py <dossier des captures> <image assemblée>
```

Les captures et l'image (contenu de Funcom) restent dans `%APPDATA%\com.captainvii.sietch\`, jamais dans le dépôt.

## Noms des zones (piste, 2026-10-27)

Le nom affiché en haut à droite du jeu (« Sud du Bassin de Hagga ») vient du widget `W_MapAreaInformationHUDWidget_C` (instance sous un `WidgetTree`, pas le modèle) : `m_MapAreaName` (`CommonTextBlock`) → `Text` (`FText`). Reste à décoder la chaîne de l'`FText` (`TextData` partagé → chaîne affichée) : la première tentative n'a pas trouvé de `FString` lisible. Autre piste : `FullscreenMapAreasComponent` du `DunePlayerController` (zones découvertes, `MapAreaData.m_AreaId`).

Suite (2026-10-27) : la chaîne `m_MapAreaName` → `Text` → `TextData` → historique (`TextId` : espace `NPCS_AND_WORLD/WORLD_REGIONS…`) → chaîne partagée donne **« Hagga Basin South »** (texte source anglais), alors que le jeu affiche « Sud du Bassin de Hagga ». Les chaînes françaises existent en mémoire (`sietch-scan find-text`) mais aucun pointeur direct n'y mène : elles passent par la table de localisation. Piste suivante : la table d'affichage de `FTextLocalizationManager` (clé `TextId` → chaîne), ou se contenter du nom anglais. Outils ajoutés : `sietch-scan strings <adresse> [taille] [profondeur]` et `find-text <texte>`.

## Carte 3D et régions (piste, 2026-11-02, reportée)

- La carte plein écran de Hagga n'a pas de modèle 3D unique : un sable uni (matériaux `MapLevel/Materials/SeaOfSand`)
  et, pour chaque bloc de terrain, une maquette simplifiée `SM_…_UIMap` listée dans
  `Dune/Maps/Arrakis/MapLevel/DT_UIMapTerrainMeshes` (145 lignes : nom du bloc → maquette + décalage). Les positions
  des blocs sont celles que Sietch lit déjà (`TerrainBlockActor`).
- Contours de Hagga : `MapLevel/CustomRegionShapes/Survival_1/Borders/SM_RegionBorders`, `SM_AreaBorders`,
  `SM_SubregionBorders`, et formes du brouillard de guerre `SM_FogOfWarAreaDefineSpline_C_*`.
- Noms des régions (anglais) : `Dune/Localization/ST_Localization_NPCs_World`, clés `WORLD_REGION_NAMES_SURVIVAL1_…`.
  Les traductions (`.locres`) n'apparaissent pas dans les archives lues par CUE4Parse.
- Blocage : `sietch-assets json` charge les `StaticMesh` sans géométrie (`RenderData` nul) en UE 5.2 ; en 5.3 / 5.4,
  plus rien ne se charge. Il manque sans doute les types du jeu (`.usmap`) : à générer en lecture seule depuis la
  mémoire (`sietch-scan`), jamais en injectant du code dans le jeu.
- Les cercles de `DA_WorldMap_AreasData_Survival_1` ne sont pas des régions : ce sont les zones de danger
  (`EWorldMapAreaType` : sable tambour, radiations faibles, fortes, sables mouvants).
- Lieux nommés : `DuneStaticMarkerActor.m_DisplayName` (texte affiché, en français), chargés seulement près du joueur.