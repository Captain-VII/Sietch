# Personnage en direct : où sont les valeurs

Trouvé le 2026-10-26 avec `tools/sietch-scan` (lecture seule, jeu en solo sans BattlEye), par les noms
d'Unreal Engine : rien ne dépend d'une adresse fixe, seulement de noms de classes et de champs.

```bash
cd tools\sietch-scan; cargo build --release
.\target\release\sietch-scan.exe ue                  # tables des noms et des objets (≈ 1 min, gardées dans ue.txt)
.\target\release\sietch-scan.exe ue-find <texte>     # objets par nom ou classe
.\target\release\sietch-scan.exe ue-fields <Classe>  # champs : offset, type, nom
.\target\release\sietch-scan.exe ue-dump <n>         # valeurs d'un objet
.\target\release\sietch-scan.exe raw <adresse>       # octets bruts
```

## Le personnage

`BP_DunePlayerCharacter_C_…` (dans `PersistentLevel`). Ses jeux d'attributs (Gameplay Ability System) ont le
personnage pour Outer :

| Objet | Classe | Valeurs |
|---|---|---|
| `CharacterStats` | `DuneCharacterAttributeSet` | `CurrentHealth`/`MaxHealth`, `CurrentStamina`/`MaxStamina`, `CurrentPower`/`MaxPower` (power pack), bonus de dégâts… |
| `HydrationAttributes` | `DuneHydrationAttributeSet` | `CurrentHydration`/`MaxHydration`, `CurrentSunExposure`, `HeatExhaustion`/`HeatExhaustionMax` |
| `PlayerCharacterStats` | `DunePlayerCharacterAttributeSet` | temps de recharge des écoles, bonus d'XP… |

Autres classes à explorer : `DuneShieldAttributeSet`, `DuneColdnessAttributeSet`, `DuneSpiceAddictionAttributeSet`,
`DunePoiseAttributeSet`.

## Lire une valeur

- `FGameplayAttributeData` (16 octets) : `BaseValue` à +0x8, `CurrentValue` (f32) à +0xC.
- **Exception, la vie** : `CurrentHealth` est un `FglGameplayAttributeData` (40 octets). Son `CurrentValue` reste
  figé ; la valeur à jour est le premier f32 du bloc pointé à +0x10 (vérifié : 100,01 pour 100 en jeu).

Les offsets des champs se relisent par réflexion à chaque lancement (`ue-fields`) : ne pas les écrire en dur.

## Ajouts du 2026-10-27

- **Emplacements du sac** : `m_BackpackInventoryComponent` → `m_Inventory` (`ItemInventory`) : liste interne des objets (`TArray` d'identifiants de 8 octets), non reflétée, placée juste avant `m_ClientMonitors` (offset de `m_ClientMonitors` − 0x18 ; nombre à +8). Capacité : `m_InitialMaxItemCount` de l'inventaire. Le sous-inventaire (200 places, vide) n'est pas compté. Lu : 9/35, **confirmé dans le jeu** (2026-10-27).
- **Menace du ver** : composant `SandwormThreatSourceComponent` du personnage (outer = personnage) : `m_CurrentThreatBlobValue` / `m_CurrentSandwormAttackThreshold` (1000 par défaut). Sietch affiche le rapport en %, 100 = le ver attaque. Alerte à 75 % (réglable). Lu à 0 dans une base ; **valeurs sur le sable à vérifier**.
- **Durabilité des équipements** : stockée dans le système d'entités du jeu (`ItemStackAndDurabilityStats`, objets `bUsesFgl`), pas dans des `UObject` : non lue pour l'instant.

## Arme en main, à bord d'un véhicule (disposition automatique)

Confirmés en jeu le 2026-10-28 avec `sietch-scan ue-diff` (champs de `BP_DunePlayerCharacter_C`) :

| Champ | Type | Sens |
|---|---|---|
| `m_bHasWeaponInHand` | BoolProperty | arme en main (`m_bServerWantsWeaponInHand` change en même temps) |
| `m_CurrentSeat` | WeakObjectProperty | non nul = assis dans un véhicule, à toutes les places |
| `m_bIsDriving` | BoolProperty | conducteur seulement (secours) ; `m_CurrentVehicleSeatName` = `DriverSeat` |

Sietch passe l'overlay en Véhicule à bord, en Combat arme en main, en Exploration sinon (`settings.rs::auto_layout`,
appliqué dans `live.rs` après 0,75 s d'état stable). Vérifié en jeu : chaque geste change la disposition. À la descente
du véhicule, le jeu remet parfois l'arme en main : on passe alors en Combat, c'est normal.

Après un patch qui renomme un champ : `sietch-scan ue-fields BP_DunePlayerCharacter_C`, puis `ue-diff <adresse> 60`
en sortant l'arme et en montant dans un véhicule, et mettre le nouveau nom dans `ARMED_FIELDS` / `VEHICLE_FIELDS` (`ue.rs`).