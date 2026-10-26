# Trouver la position du joueur (modules sans BattlEye)

Sietch lit la position du joueur **en lecture seule**, et seulement quand Dune: Awakening tourne **sans BattlEye**
(mode solo, ou serveur privé qui ne l'exige pas). Il lui faut une **chaîne de pointeurs** : le chemin, dans la mémoire
du jeu, qui mène à la position. Elle change à chaque mise à jour du jeu ; il faut donc la retrouver après un patch.

> À faire uniquement en solo ou sur ton propre serveur, jeu lancé sans BattlEye. Ne jamais l'utiliser sur un serveur
> officiel. Avant de diffuser une chaîne, vérifier que le contrat d'utilisation de Funcom l'autorise.

## Avant de commencer

1. Lancer Dune: Awakening **sans BattlEye** (option de lancement proposée par Steam depuis la 1.5, si ta version l'a),
   en mode solo.
2. Dans Sietch, **Paramètres › Sans BattlEye** : « Jeu détecté : oui » et « BattlEye : absent ».
3. Installer [Cheat Engine](https://www.cheatengine.org/). Pendant l'installation, **refuser les logiciels proposés en plus**.

## 1. Trouver l'adresse de la position

Unreal Engine 5 range la position en trois nombres **Double** consécutifs : X, puis Y (8 octets plus loin), puis Z
(16 octets plus loin). Le plus simple est de chercher la **hauteur Z**.

1. Cheat Engine › icône d'ordinateur › choisir `DuneSandbox-Win64-Shipping.exe`.
2. Type de valeur : **Double**. Type de recherche : **Unknown initial value** › **First Scan**.
3. Monte sur une dune › **Increased value** › **Next Scan**. Redescends › **Decreased value**. Reste immobile ›
   **Unchanged value**. Répète jusqu'à n'avoir que quelques dizaines d'adresses.
4. Parmi elles, garde celle dont les deux Doubles **juste avant** (adresse − 16 et − 8) changent quand tu marches
   vers le nord ou l'est : ce sont X et Y. L'adresse utile pour Sietch est celle de **X** (adresse de Z − 16).
   Il existe plusieurs copies (caméra, physique…) : préfère celle qui suit exactement tes déplacements.

## 2. Trouver une chaîne de pointeurs stable

1. Clic droit sur l'adresse de X › **Pointer scan for this address**.
   Réglages conseillés : niveau maximum **7**, décalage maximum **0x1000**. Enregistrer le résultat.
2. **Relancer le jeu**, retrouver l'adresse de X (étape 1), puis dans la fenêtre du pointer scan :
   **Pointer scanner › Rescan memory** avec la nouvelle adresse. Recommencer 2 ou 3 fois.
3. Garder un résultat dont la base est `DuneSandbox-Win64-Shipping.exe+XXXXXXXX` et qui pointe toujours sur X.

## 3. Le mettre dans Sietch

Ouvrir `%APPDATA%\com.captainvii.sietch\position.json` (créé au premier lancement) et remplir `pointerChain`
**dans l'ordre des colonnes de Cheat Engine** : le décalage de la base, puis Offset 0, Offset 1, etc.

```json
{
  "gameProcesses": ["DuneSandbox-Win64-Shipping.exe"],
  "battleyeProcesses": ["BEService.exe", "BEService_x64.exe", "DuneSandbox_BE.exe"],
  "module": "",
  "pointerChain": ["0x0A1B2C30", "0x30", "0x2A0", "0x1B0"],
  "coordinates": "f64"
}
```

(Les valeurs ci-dessus sont des exemples, pas une vraie chaîne.)

Puis **Paramètres › Sans BattlEye › Recharger position.json**, et activer « Position en direct ».
L'état doit passer à « Position : en direct ».

## 4. Calibrer la carte

Sur la **Carte** (bandeau bleu) : place-toi à un endroit reconnaissable, clique sur **Ajouter un point**, puis clique
sur la carte à cet endroit. Trois points bien écartés suffisent (Sietch gère échelle, rotation et inversion d'axes).
Une calibration par région (Bassin de Hagga, Désert profond).

## Après une mise à jour du jeu

La position ne s'affiche plus : refaire l'étape 2 à partir du pointer scan enregistré (**Rescan memory** avec la
nouvelle adresse de X), puis mettre à jour `pointerChain`. La calibration de la carte, elle, reste valable.

## Méthode plus robuste (plus technique)

Dans Unreal Engine, la position suit presque toujours ce chemin :
`GWorld → OwningGameInstance → LocalPlayers[0] → PlayerController → AcknowledgedPawn → RootComponent → RelativeLocation`.
Un outil qui extrait les structures du jeu (un « SDK dumper ») donne les décalages de chaque étape, plus stables
d'un patch à l'autre que ceux d'un pointer scan.
