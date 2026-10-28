// Extraction locale d'images du jeu (icônes, fond de carte) pour la Sietch de l'utilisateur.
// Lecture seule des archives du jeu (non chiffrées) ; rien de ce qui sort d'ici ne va dans le dépôt.
//
//   sietch-assets version              version d'Unreal Engine du jeu
//   sietch-assets list <filtre>        chemins des fichiers dont le nom contient <filtre>
//   sietch-assets export <chemin> <dossier>   textures du paquet (ou de tous ceux qui commencent par <chemin>) en PNG
using System.Text;
using System.Text.RegularExpressions;
using CUE4Parse.Compression;
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Versions;
using CUE4Parse_Conversion.Textures;
using CUE4Parse.MappingsProvider;

const string Game = @"D:\SteamLibrary\steamapps\common\DuneAwakening";
var paks = Path.Combine(Game, @"DuneSandbox\Content\Paks");

if (args.Length == 0) { Console.WriteLine("usage : version | list <filtre> | export <chemin> <dossier>"); return 1; }

if (args[0] == "version")
{
    var exe = File.ReadAllBytes(Path.Combine(Game, @"DuneSandbox\Binaries\Win64\DuneSandbox-Win64-Shipping.exe"));
    foreach (var enc in new Encoding[] { Encoding.ASCII, Encoding.Unicode })
    {
        var m = Regex.Matches(enc.GetString(exe), @"\+\+UE5\+Release-5\.\d+");
        foreach (var v in m.Select(x => x.Value).Distinct().Take(3)) Console.WriteLine(v);
    }
    return 0;
}

var version = Environment.GetEnvironmentVariable("SIETCH_UE") is { } ue ? Enum.Parse<EGame>(ue) : EGame.GAME_UE5_2;
var provider = new DefaultFileProvider(paks, SearchOption.TopDirectoryOnly, new VersionContainer(version));
var oodle = Path.Combine(AppContext.BaseDirectory, "oo2core_9_win64.dll");
if (File.Exists(oodle)) OodleHelper.Initialize(oodle);
var usmap = Environment.GetEnvironmentVariable("SIETCH_USMAP");
if (usmap is not null) provider.MappingsContainer = new FileUsmapTypeMappingsProvider(usmap);
provider.Initialize();
provider.Mount();
Console.Error.WriteLine($"{provider.Files.Count} fichiers, {provider.MountedVfs.Count} archives");

switch (args[0])
{
    case "list":
        foreach (var f in provider.Files.Keys.Where(k => k.Contains(args[1], StringComparison.OrdinalIgnoreCase)).Order())
            Console.WriteLine(f);
        return 0;
    case "json":
        // Contenu d'un paquet (références vers ses textures, maillages…), pour suivre la piste d'une image.
        Console.WriteLine(Newtonsoft.Json.JsonConvert.SerializeObject(provider.LoadPackage(args[1]).GetExports(), Newtonsoft.Json.Formatting.Indented));
        return 0;
    case "export":
        Directory.CreateDirectory(args[2]);
        var n = 0;
        foreach (var path in provider.Files.Keys.Where(k => k.EndsWith(".uasset") && k.StartsWith(args[1], StringComparison.OrdinalIgnoreCase)).Order())
        {
            try
            {
                foreach (var tex in provider.LoadPackage(path).GetExports().OfType<UTexture2D>())
                {
                    var bmp = tex.Decode();
                    if (bmp is null) continue;
                    using var data = bmp.Encode(SkiaSharp.SKEncodedImageFormat.Png, 100);
                    File.WriteAllBytes(Path.Combine(args[2], tex.Name + ".png"), data.ToArray());
                    n++;
                }
            }
            catch (Exception e)
            {
                Console.Error.WriteLine($"{path} : {e.Message}");
            }
        }
        Console.Error.WriteLine($"{n} textures écrites dans {args[2]}");
        return 0;
}
return 1;
