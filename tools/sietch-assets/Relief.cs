// Fond de Hagga vu de dessus, au rendu de la carte plein écran du jeu : les maquettes simplifiées `SM_…_UIMap` de
// chaque bloc de terrain (`DT_UIMapTerrainMeshes`), posées là où les sous-niveaux de Hagga placent les blocs
// (`BP_TerrainBlockActor`), sur le sable, aux couleurs de la carte du jeu. Image carrée qui couvre tout Hagga (même cadrage que la texture officielle).
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Engine;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.UE4.Objects.UObject;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse_Conversion.Textures;
using SkiaSharp;

static class Relief
{
    // Cadrage de Hagga en cm (DuneWorldGenerator de Survival_1 : origine -51200, 8128 m de côté).
    const double Min = -457200, Size = 812800;
    // Les maquettes UIMap sont au 1/100 (un bloc de 500 m y fait 5 m) ; le décalage de la table est, lui, en vraie grandeur.
    const float UiScale = 100;
    const string Levels = "DuneSandbox/Content/Dune/Maps/Arrakis/SOC_1/";
    const string Table = "DuneSandbox/Content/Dune/Maps/Arrakis/MapLevel/DT_UIMapTerrainMeshes.uasset";

    public static int Run(DefaultFileProvider provider, string output, int px, (string path, double[] box)? colors = null)
    {
        var table = provider.LoadPackage(Table).GetExports().OfType<UDataTable>().First();
        var rows = table.RowMap.ToDictionary(r => r.Key.Text, r => r.Value);
        var meshes = new Dictionary<string, (FVector[] verts, FRawStaticIndexBuffer index)?>();
        // Hauteur la plus haute par pixel, et le niveau du sable sous le bloc qui la donne (là où le jeu pose le bloc).
        var height = new float[px * px];
        var ground = new float[px * px];
        Array.Fill(height, float.NaN);
        int blocks = 0, unknown = 0;

        foreach (var level in provider.Files.Keys.Where(k => k.StartsWith(Levels) && k.EndsWith(".umap") && !k.Contains("/SOS-")).Order())
        {
            IEnumerable<UObject> exports;
            try { exports = provider.LoadPackage(level).GetExports(); }
            catch (Exception e) { Console.Error.WriteLine($"{level} : {e.Message}"); continue; }
            foreach (var actor in exports.Where(e => e.ExportType == "BP_TerrainBlockActor_C"))
            {
                var name = actor.GetOrDefault<FPackageIndex>("m_TerrainBlockAsset")?.Name;
                if (name is null || !rows.TryGetValue(name, out var row)) { unknown++; continue; }
                var mesh = Mesh(provider, meshes, row.Get<FSoftObjectPath>("Mesh").AssetPathName.Text);
                if (mesh is null || !actor.GetOrDefault<FPackageIndex>("RootComponent").TryLoad(out var root)) { unknown++; continue; }
                var at = root.GetOrDefault<FVector>("RelativeLocation");
                var place = new FTransform(
                    root.GetOrDefault<FRotator>("RelativeRotation"),
                    at,
                    root.GetOrDefault("RelativeScale3D", FVector.OneVector));
                var offset = row.Get<FTransform>("Offset");
                Draw(height, ground, (float)at.Z, px, mesh.Value.verts.Select(v => place.TransformPosition(offset.TransformPosition(v * UiScale))).ToArray(), mesh.Value.index);
                blocks++;
            }
        }
        // Sans maquette : bordures de sables mouvants, décor hors zone jouable de la Muraille, blocs d'événement.
        Console.Error.WriteLine($"{blocks} blocs posés, {unknown} sans maquette");
        // Dunes : les 8 × 8 tuiles de la mer de sable de Hagga, chacune avec sa maquette simplifiée.
        var dunes = new float[px * px];
        Array.Fill(dunes, float.NaN);
        var tiles = 0;
        foreach (var level in provider.Files.Keys.Where(k => k.StartsWith(Levels + "Tiles/LOD/SOS-") && k.EndsWith("_LOD1.umap")))
        foreach (var tile in provider.LoadPackage(level).GetExports().Where(e => e.ExportType == "LandscapeMeshProxyComponent"))
        {
            if (!tile.GetOrDefault<FPackageIndex>("StaticMesh").TryLoad(out UStaticMesh sm) || sm.RenderData?.LODs?.FirstOrDefault() is not { PositionVertexBuffer.Verts: { } v, IndexBuffer: { } ix }) continue;
            var place = new FTransform(tile.GetOrDefault<FRotator>("RelativeRotation"), tile.GetOrDefault<FVector>("RelativeLocation"), tile.GetOrDefault("RelativeScale3D", FVector.OneVector));
            Draw(dunes, new float[px * px], 0, px, v.Select(place.TransformPosition).ToArray(), ix);
            tiles++;
        }
        Console.Error.WriteLine($"{tiles} tuiles de dunes");
        Smooth(dunes, px);
        Save(provider, height, ground, dunes, px, output, colors);
        return 0;
    }

    static (FVector[] verts, FRawStaticIndexBuffer index)? Mesh(DefaultFileProvider provider, Dictionary<string, (FVector[] verts, FRawStaticIndexBuffer index)?> cache, string path)
    {
        if (cache.TryGetValue(path, out var known)) return known;
        (FVector[] verts, FRawStaticIndexBuffer index)? mesh = null;
        if (provider.TryLoadPackageObject<UStaticMesh>(path, out var sm) && sm.RenderData?.LODs?.FirstOrDefault() is { PositionVertexBuffer.Verts: { } v, IndexBuffer: { } i })
            mesh = (v, i);
        return cache[path] = mesh;
    }

    /// Triangles projetés vue de dessus : chaque pixel garde la hauteur la plus haute.
    static void Draw(float[] height, float[] ground, float floor, int px, FVector[] world, FRawStaticIndexBuffer index)
    {
        var k = px / Size;
        for (var t = 0; t + 2 < index.Length; t += 3)
        {
            var (a, b, c) = (world[index[t]], world[index[t + 1]], world[index[t + 2]]);
            double ax = (a.X - Min) * k, ay = (a.Y - Min) * k, bx = (b.X - Min) * k, by = (b.Y - Min) * k, cx = (c.X - Min) * k, cy = (c.Y - Min) * k;
            var area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
            if (Math.Abs(area) < 1e-9) continue;
            int x0 = Math.Max(0, (int)Math.Floor(Math.Min(ax, Math.Min(bx, cx)))), x1 = Math.Min(px - 1, (int)Math.Ceiling(Math.Max(ax, Math.Max(bx, cx))));
            int y0 = Math.Max(0, (int)Math.Floor(Math.Min(ay, Math.Min(by, cy)))), y1 = Math.Min(px - 1, (int)Math.Ceiling(Math.Max(ay, Math.Max(by, cy))));
            for (var y = y0; y <= y1; y++)
            for (var x = x0; x <= x1; x++)
            {
                double sx = x + 0.5, sy = y + 0.5;
                var wa = ((bx - sx) * (cy - sy) - (by - sy) * (cx - sx)) / area;
                var wb = ((cx - sx) * (ay - sy) - (cy - sy) * (ax - sx)) / area;
                var wc = 1 - wa - wb;
                if (wa < 0 || wb < 0 || wc < 0) continue;
                var z = (float)(wa * a.Z + wb * b.Z + wc * c.Z);
                var i = y * px + x;
                if (float.IsNaN(height[i]) || z > height[i]) (height[i], ground[i]) = (z, floor);
            }
        }
    }

    /// Couleurs de la carte du jeu, zone par zone : prises sur une image de sa carte calée sur Sietch (les captures de
    /// la carte 3D du jeu, `colors`, avec leur calage en unités de la carte Sietch 0–900), sinon sur sa carte peinte
    /// (`T_Survival_WorldMap_MiniMap_D`, plus ancienne : sans Sheol). Lissées sur ~100 m : le relief garde son dessin.
    /// À défaut, le sable de son matériau (`MI_UIMap_Terrain_3`, « Color ») et une roche brune.
    const string Painted = "DuneSandbox/Content/Dune/Maps/Arrakis/SOC_1/WorldMaps/T_Survival_WorldMap_MiniMap_D";
    static readonly double[] SandColor = [0xCC, 0xAE, 0x7A], DefaultRock = [176, 118, 76];

    /// Sable, et roche dès quelques mètres au-dessus du sable (le pied des blocs se fond dans le désert) ; le tout ombré,
    /// avec ses ombres portées, sous le soleil de la carte du jeu.
    static void Save(DefaultFileProvider provider, float[] height, float[] ground, float[] dunes, int px, string output, (string path, double[] box)? colors)
    {
        var cell = (float)(Size / px);
        float H(int x, int y) => height[Math.Clamp(y, 0, px - 1) * px + Math.Clamp(x, 0, px - 1)] is var h && float.IsNaN(h) ? 0 : h;
        float D(int x, int y) => dunes[Math.Clamp(y, 0, px - 1) * px + Math.Clamp(x, 0, px - 1)] is var h && float.IsNaN(h) ? 0 : h;
        // Éclairage d'une pente (dx, dy) : lumière venant du soleil de la carte (`SunX`, `SunY`), à 45° de haut ; 1 sur le plat.
        static double Lit(double dx, double dy) => Math.Clamp((-dx * SunX * 0.7071 - dy * SunY * 0.7071 + 0.7071) / Math.Sqrt(dx * dx + dy * dy + 1) / 0.7071, 0.35, 1.25);
        // Roche : ce qui dépasse de quelques mètres le sol du bloc. Un bloc posé bien en contrebas des dunes (plus de 20 m,
        // comme le fond de la Faille de Hagga) a son pied recouvert par la mer de sable : le sol y est celui des dunes.
        // Les autres sont posés à fleur de sable par le jeu, et les maquettes des dunes, grossières, mangeraient leurs rochers.
        double Floor(int i) => !float.IsNaN(dunes[i]) && dunes[i] > ground[i] + 2000 ? dunes[i] : ground[i];
        double Rock(int i) => float.IsNaN(height[i]) ? 0 : Math.Clamp((height[i] - Floor(i) - 300) / 1200.0, 0, 1);
        SKBitmap? source = null;
        double[] box = [0, 0, 900, 900];
        if (colors is { } c)
            (source, box) = (SKBitmap.Decode(c.path), c.box);
        else if (provider.TryLoadPackageObject<UTexture2D>(Painted, out var tex))
            source = tex.Decode()?.ToSkBitmap();
        if (source is null) Console.Error.WriteLine("pas d'image de couleurs : sable et roche unis");
        var sandColor = Field(source, box, px, i => 1 - Rock(i), SandColor);
        var rockColor = Field(source, box, px, Rock, DefaultRock);
        // Surface vue de dessus : la roche, sinon les dunes.
        var surface = new double[px * px];
        for (var i = 0; i < surface.Length; i++)
            surface[i] = Rock(i) > 0 ? height[i] : float.IsNaN(dunes[i]) ? Floor(i) : dunes[i];
        var sun = Shadows(surface, px, cell);
        // Creux, en léger : la surface comparée à sa moyenne sur ~40 m ; les gorges (Faille de Hagga) restent un peu plus
        // sombres que leurs bords, même hors de l'ombre.
        var around = (double[])surface.Clone();
        for (var pass = 0; pass < 3; pass++) Blur(around, px, 7, 1);
        using var bmp = new SKBitmap(px, px, SKColorType.Rgba8888, SKAlphaType.Opaque);
        var pixels = new SKColor[px * px];
        for (var y = 0; y < px; y++)
        for (var x = 0; x < px; x++)
        {
            var i = y * px + x;
            var rock = Rock(i);
            var stoneLight = Lit((H(x + 1, y) - H(x - 1, y)) / (2 * cell), (H(x, y + 1) - H(x, y - 1)) / (2 * cell));
            // Le sable prend le relief des dunes (pas celui du pied des maquettes, en marches) ; la roche, le sien.
            var sandLight = Lit((D(x + 1, y) - D(x - 1, y)) / (2 * cell), (D(x, y + 1) - D(x, y - 1)) / (2 * cell));
            var light = (1 + (sandLight - 1) * 0.8 + (stoneLight - sandLight) * rock)
                * (1 - 0.3 * (1 - sun[i]))
                * (1 - Math.Clamp((around[i] - surface[i] - 500) / 6000, 0, 0.25));
            var (sand, stone) = (sandColor(x, y), rockColor(x, y));
            byte C(int k) => (byte)Math.Clamp((sand[k] + (stone[k] - sand[k]) * rock) * light, 0, 255);
            pixels[i] = new SKColor(C(0), C(1), C(2));
        }
        bmp.Pixels = pixels;
        using var data = bmp.Encode(output.EndsWith(".png") ? SKEncodedImageFormat.Png : SKEncodedImageFormat.Jpeg, 92);
        File.WriteAllBytes(output, data.ToArray());
        Console.Error.WriteLine($"{output} : {px} px, {Size / px / 100:0.##} m par pixel");
    }

    // Soleil de la carte du jeu : au nord-nord-est (ses ombres partent vers le sud-sud-ouest) et bas.
    const double SunX = 0.46, SunY = -0.89, SunElevation = 20;

    /// Ombres portées, comme sur la carte du jeu : longues, vers le sud-sud-ouest. Les rangées sont parcourues depuis le
    /// soleil (le nord) : la hauteur du rayon d'ombre vient du point amont de la rangée précédente (interpolé), moins sa
    /// descente ; un point plus bas que lui est à l'ombre. 1 au soleil, 0 à l'ombre, bords adoucis.
    static double[] Shadows(double[] surface, int px, float cell)
    {
        var shift = -SunX / SunY;  // décalage en x, par rangée, du point amont vers le soleil
        var drop = Math.Sqrt(1 + shift * shift) * cell * Math.Tan(SunElevation * Math.PI / 180);
        var sun = new double[px * px];
        var ray = new double[px];
        var prev = new double[px];
        Array.Fill(prev, double.NegativeInfinity);
        for (var y = 0; y < px; y++)
        {
            for (var x = 0; x < px; x++)
            {
                var ux = x + shift;
                int x0 = (int)Math.Floor(ux);
                var f = ux - x0;
                var up = x0 < 0 || x0 + 1 >= px ? double.NegativeInfinity : prev[x0] * (1 - f) + prev[x0 + 1] * f;
                var h = surface[y * px + x];
                sun[y * px + x] = h >= up - drop - 50 ? 1 : 0;
                ray[x] = Math.Max(h, up - drop);
            }
            (prev, ray) = (ray, prev);
        }
        for (var pass = 0; pass < 2; pass++) Blur(sun, px, 1, 1);
        return sun;
    }

    /// Couleur moyenne lissée (~100 m) de l'image source, pondérée par `weight` (sable ou roche du relief) ; tend vers
    /// `prior` là où l'image n'a rien (hors de son cadre, ou pas de pixel de ce genre alentour).
    static Func<int, int, double[]> Field(SKBitmap? source, double[] box, int px, Func<int, double> weight, double[] prior)
    {
        if (source is null) return (_, _) => prior;
        const int Scale = 8;
        var src = source.Pixels;
        int sw = source.Width, sh = source.Height;
        var m = px / Scale;
        var acc = new double[m * m * 4];
        for (var y = 0; y < px; y++)
        for (var x = 0; x < px; x++)
        {
            var w = weight(y * px + x);
            if (w <= 0) continue;
            // Pixel de la carte Sietch (0–900) → pixel de l'image source selon son calage.
            int sx = (int)((x * 900.0 / px - box[0]) / (box[2] - box[0]) * sw), sy = (int)((y * 900.0 / px - box[1]) / (box[3] - box[1]) * sh);
            if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue;
            var c = src[sy * sw + sx];
            // Hachures roses du jeu (bord de la carte, sable tambour) : pas une couleur de terrain.
            if (c.Red - c.Green > 50 && c.Blue >= c.Green - 10) continue;
            var k = ((y / Scale) * m + x / Scale) * 4;
            (acc[k], acc[k + 1], acc[k + 2], acc[k + 3]) = (acc[k] + c.Red * w, acc[k + 1] + c.Green * w, acc[k + 2] + c.Blue * w, acc[k + 3] + w);
        }
        for (var pass = 0; pass < 3; pass++) Blur(acc, m, 6);
        // Un peu de `prior` dans chaque case : il ne l'emporte que là où l'image ne dit rien.
        const double Prior = 2;
        return (x, y) =>
        {
            var k = (Math.Min(m - 1, y / Scale) * m + Math.Min(m - 1, x / Scale)) * 4;
            var w = acc[k + 3] + Prior;
            return [(acc[k] + prior[0] * Prior) / w, (acc[k + 1] + prior[1] * Prior) / w, (acc[k + 2] + prior[2] * Prior) / w];
        };
    }

    /// Dunes adoucies : les maquettes des tuiles sont grossières (facettes de plusieurs dizaines de mètres) et laissent
    /// un pixel vide à leurs jointures. Trous bouchés par le voisin, puis flou d'une dizaine de mètres.
    static void Smooth(float[] dunes, int px)
    {
        for (var i = 1; i < dunes.Length; i++)
            if (float.IsNaN(dunes[i])) dunes[i] = dunes[i - 1];
        for (var i = dunes.Length - px - 1; i >= 0; i--)
            if (float.IsNaN(dunes[i])) dunes[i] = dunes[i + px];
        var a = Array.ConvertAll(dunes, d => float.IsNaN(d) ? 0.0 : d);
        for (var pass = 0; pass < 3; pass++) Blur(a, px, 3, 1);
        for (var i = 0; i < a.Length; i++) dunes[i] = (float)a[i];
    }

    /// Flou en boîte (rayon r cases) sur `channels` canaux entrelacés, horizontal puis vertical ; trois passes ≈ flou
    /// gaussien.
    static void Blur(double[] a, int m, int r, int channels = 4)
    {
        var tmp = new double[a.Length];
        for (var dir = 0; dir < 2; dir++)
        {
            for (var row = 0; row < m; row++)
            for (var ch = 0; ch < channels; ch++)
            {
                double sum = 0;
                int At(int i) => (dir == 0 ? row * m + i : i * m + row) * channels + ch;
                for (var i = -r; i <= r; i++) sum += i >= 0 && i < m ? a[At(i)] : 0;
                for (var i = 0; i < m; i++)
                {
                    tmp[At(i)] = sum / (2 * r + 1);
                    if (i + r + 1 < m) sum += a[At(i + r + 1)];
                    if (i - r >= 0) sum -= a[At(i - r)];
                }
            }
            Array.Copy(tmp, a, a.Length);
        }
    }
}
