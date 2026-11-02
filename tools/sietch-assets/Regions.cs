// Régions de Hagga telles que la carte du jeu les découpe (`Survival_1_AreaDefinedSplines`) : identifiant, nom et
// sous-titre en français (fr/Game.locres), territoire (sous-titre anglais, pour la couleur) et contour en cm.
// Chaque `BP_FogOfWarAreaDefineSpline_C_<n>` a sa forme `SM_FogOfWarAreaDefineSpline_C_<n>_CustomRegionShape`.
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;
using CUE4Parse.UE4.Localization;
using CUE4Parse.UE4.Objects.Core.i18N;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.UE4.Objects.UObject;
using Newtonsoft.Json;

static class Regions
{
    const string Level = "DuneSandbox/Content/Dune/Maps/Arrakis/SOC_1/SubLevels/Survival_1_AreaDefinedSplines.umap";
    // Cadrage de Hagga en cm (le même que `Relief.cs`) : Sietch y place les contours sans attendre les données du jeu.
    const double Min = -457200, Max = 355600;
    const string Locres = "DuneSandbox/Content/Localization/Game/fr/Game.locres";
    const string Shapes = "DuneSandbox/Content/Dune/Maps/Arrakis/MapLevel/CustomRegionShapes/Survival_1/";

    public static int Run(DefaultFileProvider provider, string output)
    {
        // Traductions lues directement : CUE4Parse ne trouve pas la liste des langues du jeu (pas de DefaultGame.ini).
        var fr = new FTextLocalizationResource(provider.Files[Locres].CreateReader()).Entries
            .SelectMany(ns => ns.Value).GroupBy(e => e.Key.Str).ToDictionary(g => g.Key, g => g.First().Value.LocalizedString);
        string? French(FText? t) => t?.TextHistory is FTextHistory.StringTableEntry { Key: var k } && fr.TryGetValue(k, out var s) ? s : t?.Text;
        var regions = new List<object>();
        foreach (var area in provider.LoadPackage(Level).GetExports().Where(e => e.ExportType == "BP_FogOfWarAreaDefineSpline_C"))
        {
            if (!provider.TryLoadPackageObject<UStaticMesh>(Shapes + "SM_" + area.Name["BP_".Length..] + "_CustomRegionShape", out var mesh)
                || mesh.RenderData?.LODs?.FirstOrDefault() is not { } lod)
            {
                Console.Error.WriteLine($"{area.Name} : pas de forme");
                continue;
            }
            // Formes déjà en coordonnées du monde (comme les lignes `Borders/SM_*Borders`) : sans la place de l'acteur.
            var rings = Outline(lod.PositionVertexBuffer!.Verts, lod.IndexBuffer!);
            regions.Add(new
            {
                name = French(area.GetOrDefault<FText>("m_AreaName")),
                subtitle = French(area.GetOrDefault<FText>("m_AreaDescription")),
                territory = area.GetOrDefault<FText>("m_AreaDescription")?.Text,
                label = Label(rings[0]),
                rings,
            });
        }
        File.WriteAllText(output, JsonConvert.SerializeObject(new { bounds = new { minX = Min, minY = Min, maxX = Max, maxY = Max }, regions }));
        Console.Error.WriteLine($"{regions.Count} régions écrites dans {output}");
        return 0;
    }

    /// Contours vus de dessus, le plus grand d'abord : les arêtes qui ne bordent qu'un seul triangle d'une même face
    /// (dessus ou dessous, selon le sens des triangles ; les flancs verticaux n'ont pas de surface vue de dessus).
    public static List<double[][]> Outline(FVector[] verts, FRawStaticIndexBuffer index)
    {
        (long, long) Key(FVector v) => ((long)Math.Round(v.X), (long)Math.Round(v.Y));
        var edges = new Dictionary<((long, long) a, (long, long) b), int>();
        foreach (var sign in new[] { 1, -1 })
        {
            for (var t = 0; t + 2 < index.Length; t += 3)
            {
                var (a, b, c) = (verts[index[t]], verts[index[t + 1]], verts[index[t + 2]]);
                if (sign * ((b.X - a.X) * (c.Y - a.Y) - (b.Y - a.Y) * (c.X - a.X)) <= 1) continue;
                foreach (var (p, q) in new[] { (a, b), (b, c), (c, a) })
                {
                    var e = (Key(p), Key(q));
                    // Arête partagée : elle apparaît dans l'autre sens dans le triangle voisin.
                    if (!edges.Remove((e.Item2, e.Item1))) edges[e] = 1;
                }
            }
            if (edges.Count > 0) break;
        }
        var next = edges.Keys.GroupBy(e => e.a).ToDictionary(g => g.Key, g => g.Select(e => e.b).ToList());
        var rings = new List<double[][]>();
        while (next.Count > 0)
        {
            var start = next.Keys.First();
            var ring = new List<double[]>();
            for (var at = start; next.TryGetValue(at, out var outs);)
            {
                ring.Add([at.Item1, at.Item2]);
                var to = outs[^1];
                outs.RemoveAt(outs.Count - 1);
                if (outs.Count == 0) next.Remove(at);
                at = to;
                if (at == start) break;
            }
            if (ring.Count > 2) rings.Add(ring.ToArray());
        }
        return rings.OrderByDescending(r => Math.Abs(Area(r))).ToList();
    }

    static double Area(double[][] r) => r.Select((p, i) => p[0] * r[(i + 1) % r.Length][1] - r[(i + 1) % r.Length][0] * p[1]).Sum() / 2;

    /// Où écrire le nom : au milieu de la partie de la région visible sur la carte (certaines débordent du cadre),
    /// sur un point de la grille qui est bien dans la région (une région en croissant a son milieu dehors).
    public static double[] Label(double[][] r)
    {
        const double Step = 2000;
        var inside = new List<(double x, double y)>();
        for (var x = Min; x <= Max; x += Step)
        for (var y = Min; y <= Max; y += Step)
            if (Inside(r, x, y)) inside.Add((x, y));
        if (inside.Count == 0) return r[0];
        var (mx, my) = (inside.Average(p => p.x), inside.Average(p => p.y));
        var best = inside.MinBy(p => (p.x - mx) * (p.x - mx) + (p.y - my) * (p.y - my));
        return [best.x, best.y];
    }

    static bool Inside(double[][] r, double x, double y)
    {
        var inside = false;
        for (int i = 0, j = r.Length - 1; i < r.Length; j = i++)
            if ((r[i][1] > y) != (r[j][1] > y) && x < (r[j][0] - r[i][0]) * (y - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0])
                inside = !inside;
        return inside;
    }
}
