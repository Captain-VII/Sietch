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
