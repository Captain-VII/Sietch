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
