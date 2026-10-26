# Reprendre Sietch sur le PC Windows

Tout le projet est sur GitHub : https://github.com/Captain-VII/Sietch.
La mémoire du projet pour Claude est dans [`CLAUDE.md`](../CLAUDE.md), à la racine.

## 1. Installer les outils (une seule fois)

Dans **PowerShell** :

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Rustlang.Rustup -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

- Les Build Tools (compilateur C++ de Microsoft) sont nécessaires pour compiler Rust sous Windows : compter environ 10 minutes.
- WebView2 est déjà présent sur Windows 11.
- Fermer puis rouvrir PowerShell, puis vérifier :

```powershell
git --version; node --version; cargo --version
```

## 2. Récupérer le projet

```powershell
mkdir $HOME\Claude -Force
git clone https://github.com/Captain-VII/Sietch.git $HOME\Claude\Sietch
cd $HOME\Claude\Sietch
npm ci
npm run tauri dev
```

La première compilation Rust prend quelques minutes ; les suivantes sont rapides.

Pour tester la position en direct sans le jeu :

```powershell
$env:SIETCH_SIMULATION = "1"; npm run tauri dev
```

## 3. Reprendre avec Claude

1. Dans l'app Claude, onglet **Code** : nouvelle session dans le dossier `C:\Users\Admin\Claude\Sietch`.
2. Premier message, par exemple :
   > Lis CLAUDE.md et reprends Sietch. On commence par vérifier la liste « Pas encore vérifié », puis on cherche la position du joueur.

Claude y retrouve les décisions (pas de sons, pas de tags, garde-fou BattlEye, règles pour le wiki et dune.gaming.tools),
l'état du projet et la suite prévue.

## 4. Où sont les données de Sietch sous Windows

| Quoi | Où |
|---|---|
| Minuteurs, réglages, `position.json` | `%APPDATA%\com.captainvii.sietch\` |
| Marqueurs, builds, notes | `donnees.json` dans le même dossier |

Les données du Mac ne suivent pas toutes seules. Pour les garder : sur le Mac, **Paramètres › Données › Tout exporter**,
puis sur le PC **Importer une sauvegarde**.

## 5. Version Windows sans compiler

Chaque push sur `main` produit l'installateur : onglet **Actions** du dépôt, dernière exécution « Windows »,
rubrique **Artifacts** (il faut être connecté à GitHub). L'exécutable n'est pas signé : SmartScreen demandera
« Informations complémentaires » puis « Exécuter quand même ».
