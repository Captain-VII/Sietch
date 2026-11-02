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

## Carte 3D et régions (fond et régions faits le 2026-11-02)

- La carte plein écran de Hagga n'a pas de modèle 3D unique : un sable uni (matériaux `MapLevel/Materials/SeaOfSand`)
  et, pour chaque bloc de terrain, une maquette simplifiée `SM_…_UIMap` listée dans
  `Dune/Maps/Arrakis/MapLevel/DT_UIMapTerrainMeshes` (145 lignes : nom du bloc → maquette + décalage).
- **Fond calculé** : `sietch-assets relief <fichier> [pixels]` (`tools/sietch-assets/Relief.cs`). Les blocs sont posés par
  les sous-niveaux de Hagga (`SOC_1/SubLevels/Survival_1_*.umap`, acteurs `BP_TerrainBlockActor_C` :
  `m_TerrainBlockAsset` = nom de la ligne, composant racine = position et angle). Les maquettes UIMap sont au **1/100**
  (×100, puis le décalage de la table, puis la place du bloc). Cadrage du `DuneWorldGenerator` de `Survival_1` : origine
  −51200, 8128 m de côté, soit −457200 → 355600 sur X et Y (le même que la texture officielle). 632 blocs posés ; sans
  maquette : bordures de sables mouvants, décor hors zone de la Muraille, un bloc d'événement.
- Vérifié contre la texture officielle (contours des roches : quelques mètres au sud) et les captures du jeu. La texture
  officielle est plus ancienne : elle n'a pas la région **Sheol** (sud-ouest, `Survival_1_Sheol`).
- Déblocage de la géométrie : CUE4Parse récent (1.2.2.202611, .NET 10) avec `EGame.GAME_DuneAwakening`. Avec la 1.2.2
  en UE 5.2, `RenderData` restait nul ; aucun `.usmap` n'a été nécessaire.
- Couleurs (2026-11-02) : prises zone par zone sur une image de la carte du jeu calée sur Sietch, lissées sur ~100 m
  (sable et roche à part, hachures roses écartées). Les captures de la carte 3D (`hagga.captures`) donnent le rendu de
  TH.GL ; la carte peinte `T_Survival_WorldMap_MiniMap_D` est plus rouge et n'a pas Sheol.
  Frontières des régions en `#C8B0BB` (`MI_3DMap_AreaBorders_Regions`), sans remplissage.
- Dunes : les 8 × 8 tuiles de mer de sable `SOC_1/Tiles/LOD/SOS-MinorErg_x*_y*_LOD1.umap` (`LandscapeMeshProxyComponent`
  → `SM_LandscapeStreamingProxy_MinorErg_*_LOD1`, en coordonnées du monde après sa position), jointures bouchées et
  lissées sur ~10 m (maquettes à grosses facettes) ; elles ombrent le sable, la roche garde son propre relief.
- Roche = ce qui dépasse de 3 m le sol du bloc ; pour un bloc posé à plus de 20 m sous les dunes (fond de la Faille de
  Hagga), le sol est celui des dunes, qui recouvrent sa plaque de base (sinon : un grand rectangle de roche).
- Zones de danger sans hachures du jeu (une tuile du motif par petit cercle faisait des cases) : teinte seule.
- Ombres portées comme la carte du jeu : soleil au nord-nord-est (ombres vers le sud-sud-ouest, mesurées sur les
  captures), 20° de haut, à 30 % ; calculées rangée par rangée depuis le soleil. Plus un léger assombrissement des creux
  (gorges de la Faille de Hagga) : l'occlusion seule était trop lourde.
- **Lieux** : `sietch-assets lieux <fichier> <dossier icônes>` (`Places.cs`) → `jeu/lieux-hagga.json` (commande Rust
  `get_game_data`, comme les régions). 652 lieux : chaque `BP_TerrainBlockActor` active des groupes de sous-niveaux de son
  type de bloc (`TerrainBlockDataAsset` → `m_Data.Versions[0]` : `SubLevelsGroups`, `SubLevels`, `SubContentBlocksSettings`,
  réglages de l'instance par-dessus), les mini-camps sont des blocs imbriqués ; les `DuneStaticMarkerActor` y donnent nom
  (fr/Game.locres), type (`m_ConfigurationAsset` → `StaticMarker_*`) et position. Type → ligne de
  `FullscreenMap/.../DT_Base_FullscreenMapMarkers` faite à la main (`Rows`, le jeu la fait dans son code) ; la ligne donne
  l'icône officielle, le nom du type, `m_LOD` (zoom d'apparition : camps de près) et `m_MapScale`. Vérifié : les 9 lieux
  déjà lus en mémoire tombent à 0 m. Seuls les niveaux dont la table de noms cite un marqueur ou un bloc sont décodés
  (sinon 17 Go de mémoire).
- Rendu des lieux comme la carte du jeu : badge rond `MapLocationSmallBG` (disque sombre, anneau) et icône, teints par
  multiplication. Le jeu fixe la couleur par type dans le code de son widget (`W_MapMarkerWidget`, rien dans les
  fichiers) : relevée sur des captures, grottes `#F2832F`, stations `#5FA4E8`, le reste à la teinte « Normal » du widget
  `#FEDB97`. Non découvert : gris `#2D2D2D` dans le jeu, non reproduit (Sietch ne sait pas ce qui est découvert).
- La mini-carte de l'overlay montre les mêmes lieux (tous les types : elle montre les environs de près).
- Reste : le Désert profond n'est pas fait.
- **Régions** : `sietch-assets regions <fichier>` (`Regions.cs`) → `jeu/regions-hagga.json` (commande Rust
  `get_game_regions`). Les 12 régions sont les `BP_FogOfWarAreaDefineSpline_C_<n>` de `Survival_1_AreaDefinedSplines` :
  nom (`m_AreaName`), sous-titre (`m_AreaDescription`, le territoire de faction) et forme
  `CustomRegionShapes/Survival_1/SM_FogOfWarAreaDefineSpline_C_<n>_CustomRegionShape`, **déjà en coordonnées du monde**
  (ne pas y appliquer la place de l'acteur). Contour = arêtes de bord des triangles d'une face. Ces contours tombent pile
  sur les lignes du jeu `Borders/SM_AreaBorders` (régions), `SM_SubregionBorders` (6 sous-régions), `SM_RegionBorders`
  (bord de Hagga).
- Noms en français : `Localization/Game/fr/Game.locres`, lu directement (`FTextLocalizationResource`) ; CUE4Parse ne
  trouve pas la liste des langues du jeu (`ChangeCulture("fr")` échoue). Le jeu ne donne pas de couleur aux régions :
  Sietch colore par territoire (`TERRITORIES` dans `src/lib/carte.ts`).
- Couleurs des zones de danger (comme la carte du jeu et TH.GL) : `MapLevel/Materials/HazardAreas/MI_UIMap_DynamicAreaRender_*`,
  « SandArea - Color » `#692026` (sable tambour), `#7B272F` (sables mouvants), « Radiation - Color » `#EAEF6E` à 35 %,
  bord `#893B35`. Posées en incrustation (overlay) sur le fond, un calque par type pour que les cercles ne foncent pas.
  Radiations en brume, sans contour : filtre SVG `sietch-brume` (bruit, déformation, flou, nappes) ; flou simple sur la
  mini-carte. Les régions sont toujours affichées (pas de filtre), comme gravées sur le fond.
- Les cercles de `DA_WorldMap_AreasData_Survival_1` ne sont pas des régions : ce sont les zones de danger
  (`EWorldMapAreaType` : sable tambour, radiations faibles, fortes, sables mouvants).
- Lieux nommés : `DuneStaticMarkerActor.m_DisplayName` (texte affiché, en français), chargés seulement près du joueur.
