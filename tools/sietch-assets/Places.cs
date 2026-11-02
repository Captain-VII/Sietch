// Lieux de Hagga tels que la carte du jeu les affiche : grottes, épaves, avant-postes, comptoirs… avec leur nom en
// français, leur type et leur icône officielle (`DT_Base_FullscreenMapMarkers`), en coordonnées du monde (cm).
// Les marqueurs (`DuneStaticMarkerActor`) sont dans les sous-niveaux des blocs de terrain : chaque bloc posé sur la carte
// active ses propres groupes de sous-niveaux (« Cave10_MarkerName », « MiniCamp01 »…), et les mini-camps sont des blocs
// imbriqués dans leur bloc, avec leur place et leurs groupes. Lecture par le JSON de CUE4Parse : la structure du jeu y
// est telle quelle.
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Localization;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse_Conversion.Options;
using CUE4Parse_Conversion.Textures;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

static class Places
{
    const string Levels = "DuneSandbox/Content/Dune/Maps/Arrakis/SOC_1/";
    const string MarkerTable = "DuneSandbox/Content/Dune/Systems/FullscreenMap/DataTables/FullscreenMapMarkers/DT_Base_FullscreenMapMarkers.uasset";
    const string Locres = "DuneSandbox/Content/Localization/Game/fr/Game.locres";

    /// Type de marqueur (sa configuration) → ligne de la table des marqueurs de la carte. Le jeu fait ce lien dans son
    /// code : pas dans les données. Fortins et intendants n'ont pas de faction ici : icône d'avant-poste, de marchand.
    static readonly Dictionary<string, string> Rows = new()
    {
        ["StaticMarker_Cave"] = "Cave",
        ["StaticMarker_CaveAltar"] = "Cave",
        ["StaticMarker_ControlPoint"] = "ControlPoint",
        ["StaticMarker_EcoLab"] = "EcoLab",
        ["StaticMarker_EnemyCamp"] = "EnemyCamp",
        ["StaticMarker_EnemyFortress"] = "EnemyOutpost",
        ["StaticMarker_EnemyOutpost"] = "EnemyOutpost",
        ["StaticMarker_EnemyOutpost_MiningGallery"] = "EnemyLaborOutpost",
        ["StaticMarker_EnemyOutpost_MiningRig"] = "EnemyLaborOutpost",
        ["StaticMarker_EnemyOutpost_MysaTaril"] = "EnemyOutpost",
        ["StaticMarker_EnemyOutpost_PyonVillage"] = "EnemyOutpost",
        ["StaticMarker_EnemyOutpost_StoneSentinel"] = "EnemyOutpost",
        ["StaticMarker_HouseRepresentative"] = "AtreidesLandsraadVendor",
        ["StaticMarker_QuarterMaster"] = "Vendor",
        ["StaticMarker_ShipWreck"] = "Shipwreck",
        ["StaticMarker_ShipWreck_Sheol"] = "Shipwreck",
        ["StaticMarker_TadingPost"] = "TradingPost",
    };

    /// Types sans traduction française dans le jeu.
    static readonly Dictionary<string, string> Labels = new() { ["EnemyLaborOutpost"] = "Avant-poste de travail ennemi" };

    /// `lod` et `scale` : niveau de zoom à partir duquel la carte du jeu montre ce type (0 : toujours, 2 : de près) et
    /// taille de son icône (`m_LOD`, `m_MapScale` de sa ligne).
    record Place(string name, string type, string label, string icon, int lod, double scale, double x, double y);

    public static int Run(DefaultFileProvider provider, string output, string iconDir)
    {
        var fr = new FTextLocalizationResource(provider.Files[Locres].CreateReader()).Entries
            .SelectMany(ns => ns.Value).GroupBy(e => e.Key.Str).ToDictionary(g => g.Key, g => g.First().Value.LocalizedString);
        // Seuls les niveaux qui ont un marqueur ou un bloc de terrain passent en JSON (vu dans leur table de noms, sans tout
        // décoder) : les niveaux de décor sont énormes.
        var cache = new Dictionary<string, JArray?>();
        JArray? Load(string path)
        {
            if (cache.TryGetValue(path, out var known)) return known;
            JArray? json = null;
            try
            {
                var pkg = provider.LoadPackage(path);
                if (!path.EndsWith(".umap") || pkg.NameMap.Any(n => n.Name.Contains("StaticMarkerActor") || n.Name == "BP_TerrainBlockActor_C"))
                    json = JArray.Parse(JsonConvert.SerializeObject(pkg.GetExports()));
            }
            catch (Exception e) { Console.Error.WriteLine($"{path} : {e.Message}"); }
            return cache[path] = json;
        }
        string? French(JToken? text) => text?["Key"]?.ToString() is { } k && fr.TryGetValue(k, out var s) ? s : text?["SourceString"]?.ToString();

        var rows = (JObject)Load(MarkerTable)![0]["Rows"]!;
        var found = new List<Place>();
        var unknown = new SortedSet<string>();
        var icons = new Dictionary<string, string>();

        // Marqueurs d'un niveau, placés par `place` (la place du bloc, plus le décalage du sous-niveau).
        void Markers(JArray level, Func<FVector, FVector> place)
        {
            foreach (var m in level.Where(e => e["Type"]!.ToString().Contains("StaticMarkerActor")))
            {
                var p = m["Properties"];
                var config = p?["m_ConfigurationAsset"]?["AssetPathName"]?.ToString().Split('/', '.')[^1] ?? "";
                if (!Rows.TryGetValue(config, out var row) || rows[row] is not JObject r) { unknown.Add(config); continue; }
                var at = place(Location(level, m) ?? new FVector(0, 0, 0));
                var texture = r["m_IconTexture"]?["AssetPathName"]?.ToString() ?? "";
                var name = texture.Split('.')[^1];
                var icon = name.StartsWith("T_UI_IconMap") ? name["T_UI_IconMap".Length..] : name.StartsWith("T_UI_Icon") ? name["T_UI_Icon".Length..] : name;
                icon = icon.EndsWith("_D") ? icon[..^2] : icon;
                if (texture != "") icons[texture] = name;
                found.Add(new Place(French(p?["m_DisplayName"]) ?? "", row, Labels.GetValueOrDefault(row) ?? French(r["m_MarkerDisplayName"]) ?? row, icon,
                    (int?)r["m_LOD"] ?? 1, (double?)r["m_MapScale"] ?? 1, Math.Round(at.X), Math.Round(at.Y)));
            }
        }

        // Un bloc posé : ses sous-niveaux actifs (groupes) et ses blocs imbriqués, récursivement.
        void Block(string? assetPath, Func<FVector, FVector> place, IEnumerable<JToken> settings, IEnumerable<JToken> overrides, JToken? subBlocks, int depth)
        {
            if (assetPath is null || depth > 4 || Load(Package(assetPath)) is not { } asset) return;
            var version = asset[0]?["Properties"]?["m_Data"]?["Versions"]?[0];
            if (version is null) return;
            var groups = new Dictionary<string, bool>();
            foreach (var g in version["SubLevelsGroups"] ?? new JArray()) groups[g["Key"]!.ToString()] = (bool?)g["Value"]?["bIsEnabled"] ?? false;
            foreach (var g in settings) groups[g["Key"]!.ToString()] = (bool?)g["Value"]?["bIsEnabled"] ?? false;
            foreach (var g in overrides.Where(o => (bool?)o["bShouldOverrideIsEnabled"] == true)) groups[g["GroupName"]!.ToString()] = (bool?)g["bIsEnabled"] ?? false;
            bool Active(JToken? names) => names is not JArray a || a.Count == 0 || a.Any(n => groups.GetValueOrDefault(n.ToString()));

            foreach (var sub in version["SubLevels"] ?? new JArray())
            {
                if (!Active(sub["GroupsNames"]) || sub["Level"]?["AssetPathName"]?.ToString() is not { Length: > 0 } path) continue;
                if (Load(Package(path)) is not { } level || !level.Any(e => e["Type"]!.ToString().Contains("StaticMarkerActor"))) continue;
                var shift = Vector(sub["RelativeLocation"]);
                Markers(level, v => place(new FVector(v.X + shift.X, v.Y + shift.Y, v.Z + shift.Z)));
            }
            // Blocs imbriqués : les réglages de l'instance remplacent ceux du type de bloc.
            foreach (var cb in (subBlocks as JArray is { Count: > 0 } own ? own : version["SubContentBlocksSettings"]) ?? new JArray())
            {
                var on = (bool?)cb["bShouldOverrideIsEnabled"] == true ? (bool?)cb["bIsEnabled"] ?? false : Active(cb["GroupsNames"]);
                if (!on || cb["ContentBlockActor"]?["AssetPathName"]?.ToString() is not { Length: > 0 } levelPath) continue;
                if (Load(Package(levelPath)) is not { } level) continue;
                var actorName = cb["ContentBlockActor"]?["SubPathString"]?.ToString().Split('.')[^1];
                if (level.FirstOrDefault(e => e["Name"]?.ToString() == actorName) is not { } actor) continue;
                var local = Transform(level, actor);
                var child = (bool?)cb["bShouldOverrideTerrainBlockAsset"] == true ? cb["TerrainBlockAsset"] : actor["Properties"]?["m_TerrainBlockAsset"];
                var childOverrides = (bool?)cb["bShouldOverrideSubLevelsGroups"] == true ? cb["SubLevelsGroupsOverride"] ?? new JArray() : new JArray();
                Block(child?["ObjectPath"]?.ToString(), v => place(local.TransformPosition(v)), actor["Properties"]?["m_SubLevelGroupsSettings"] ?? new JArray(),
                    childOverrides, actor["Properties"]?["m_SubContentBlocksSettings"], depth + 1);
            }
        }

        foreach (var path in provider.Files.Keys.Where(k => k.StartsWith(Levels) && k.EndsWith(".umap") && !k.Contains("/SOS-") && !k.Contains("/LOD/")).Order())
        {
            if (Load(path) is not { } level) continue;
            Markers(level, v => v);
            foreach (var actor in level.Where(e => e["Type"]?.ToString() == "BP_TerrainBlockActor_C"))
            {
                var place = Transform(level, actor);
                var p = actor["Properties"];
                Block(p?["m_TerrainBlockAsset"]?["ObjectPath"]?.ToString(), place.TransformPosition, p?["m_SubLevelGroupsSettings"] ?? new JArray(), [], p?["m_SubContentBlocksSettings"], 0);
            }
        }

        // Un même lieu peut venir de deux sous-niveaux (marqueur doublé) : même type et même nom à moins de 50 m.
        var places = new List<Place>();
        foreach (var f in found)
            if (!places.Any(q => q.type == f.type && q.name == f.name && Math.Abs(q.x - f.x) < 5000 && Math.Abs(q.y - f.y) < 5000))
                places.Add(f);
        // Même cadrage que les régions (DuneWorldGenerator de Survival_1) : Sietch place les lieux sans les données du jeu.
        File.WriteAllText(output, JsonConvert.SerializeObject(new { bounds = new { minX = -457200, minY = -457200, maxX = 355600, maxY = 355600 }, places }));
        Console.Error.WriteLine($"{places.Count} lieux écrits dans {output}" + (unknown.Count > 0 ? $" ; types inconnus : {string.Join(", ", unknown)}" : ""));
        foreach (var g in places.GroupBy(p => p.label).OrderByDescending(g => g.Count())) Console.Error.WriteLine($"  {g.Count(),4}  {g.Key}");

        // Icônes officielles de ces types, à côté des autres icônes de carte (sans écraser celles déjà extraites).
        Directory.CreateDirectory(iconDir);
        foreach (var (texture, name) in icons)
        {
            var file = Path.Combine(iconDir, name + ".png");
            if (File.Exists(file) || !provider.TryLoadPackageObject<UTexture2D>(texture.Split('.')[0], out var tex) || tex.Decode() is not { } bmp) continue;
            File.WriteAllBytes(file, bmp.Encode(ETextureFormat.Png, false, out _));
            Console.Error.WriteLine($"  icône ajoutée : {name}");
        }
        return 0;
    }

    /// « /Game/Dune/X/Y.Y » ou « /Game/Dune/X/Y.0 » → chemin du paquet dans les archives (niveau ou asset).
    static string Package(string path)
    {
        var p = "DuneSandbox/Content/" + path["/Game/".Length..].Split('.')[0];
        return p + (p.Contains("/Maps/") && !p.Contains("/Collection/") ? ".umap" : ".uasset");
    }

    static FVector Vector(JToken? v) => new((float?)v?["X"] ?? 0, (float?)v?["Y"] ?? 0, (float?)v?["Z"] ?? 0);

    /// Position d'un acteur dans son niveau : celle de son composant racine.
    static FVector? Location(JArray level, JToken actor) => Root(level, actor)?["Properties"]?["RelativeLocation"] is { } l ? Vector(l) : null;

    static FTransform Transform(JArray level, JToken actor)
    {
        var p = Root(level, actor)?["Properties"];
        var r = p?["RelativeRotation"];
        var s = p?["RelativeScale3D"];
        return new FTransform(new FRotator((float?)r?["Pitch"] ?? 0, (float?)r?["Yaw"] ?? 0, (float?)r?["Roll"] ?? 0), Vector(p?["RelativeLocation"]),
            s is null ? FVector.OneVector : Vector(s));
    }

    static JToken? Root(JArray level, JToken actor)
    {
        var name = actor["Properties"]?["RootComponent"]?["ObjectName"]?.ToString().TrimEnd('\'').Split('.')[^1];
        var owner = actor["Name"]?.ToString();
        return level.FirstOrDefault(e => e["Name"]?.ToString() == name && (e["Outer"]?["ObjectName"]?.ToString().Contains($".{owner}'") ?? false));
    }
}
