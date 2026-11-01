# Analyse : gaming.tools Companion (0.5.110)

Analyse faite le 2026-11-01 à partir de l'installation locale, des journaux et des fichiers d'état
(`%LOCALAPPDATA%\gaming.tools`). Rien n'a été décompilé ni repris : seulement l'architecture,
pour comparer avec Sietch.

## Architecture

- **GT.Launcher.exe** : appli .NET (fichier unique, ~160 Mo), interface WinUI 3 + WebView2.
  Lanceur multi-jeux (Dune, Palworld, Valheim, Aion 2, Pax Dei, Enshrouded, Palia).
- **L'interface est en ligne** : carte et mini-carte sont des pages `app.gaming.tools/<langue>/dune/map`
  et `/minimap` chargées dans WebView2. Le natif leur parle par un « bridge » (`Bridge hello`).
  Tuiles de carte en paquets `.gtpk` sur `cdn-hosted.gaming.tools`.
- **GTBridgeHost** : service Windows, compte **LocalSystem**, démarrage auto. L'interface attend
  qu'il soit prêt avant d'ouvrir le navigateur. C'est lui qui a les droits sur le processus du jeu :
  l'interface tourne sans élévation.
- **GTNative.dll** : partie native (overlay, suivi de fenêtre).
- Protocole `gt-companion://` enregistré, mises à jour par `CompanionUpdater.exe`.

## Lecture du jeu

- Processus visé : `DuneSandbox-Win64-Shipping.exe`, suivi en continu ; le compagnon démarre
  et s'arrête avec le jeu, l'overlay s'accroche à la fenêtre du jeu.
- Bibliothèque maison **UESharp** (.NET) : recherche par motifs de `GObjects` / `FNames`, puis
  **découverte automatique des offsets** (propriétés enfants, noms de champs). Après une mise à jour
  du jeu, échecs typiques : `Invalid GObjects structure resolved by pattern`,
  `FindChildPropertiesAndFieldNameOffsets`. Même principe que Sietch (`src-tauri/src/ue.rs`,
  lecture par les noms UE).
- **« FGS discovery »** par monde : repère les réserves d'objets et le décalage des lignes de la
  table des objets, réessaie jusqu'à confirmation.
- Monde détecté avec sa graine : `survival_N`, `deepdesert_N`, `sh_arrakeen`, `overmap`.
- Données lues : sac, équipement utilitaire, soute du véhicule, recettes connues, bases
  (totem de revendication), position.

## Fonctions côté serveur

- **Scan de carte collaboratif** : les acteurs vus sont envoyés à `dune-api-vN.gaming.tools/actors`.
  Sans le droit payant `apps.dune.mapscan`, seuls les « acteurs publics » sont envoyés.
- **Sessions de jeu** (`dune-companion/sessions/*.json`) : par personnage, durée, temps actif,
  distance, XP, butin, XP de spécialisation, monnaies, donjons, quotidiennes ; mises en file
  d'envoi vers leur serveur (`pendingUploadIds`).

## Idées pour Sietch

Absentes de Sietch aujourd'hui, à faire avec nos propres lectures :

- Bilan de session : XP gagnée, butin, distance (Sietch a déjà le trajet et le temps de jeu).
- Démarrage et arrêt automatiques avec le jeu.
- Soute du véhicule et recettes connues.
- Détection du monde et de sa graine (utile pour la carte du Désert profond).

Écarté : service LocalSystem permanent (Sietch lit sans service ni élévation).
