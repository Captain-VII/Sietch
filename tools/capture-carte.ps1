param([string]$Out, [int]$Seconds = 240)
# Captures de la carte du jeu pendant que l'utilisateur la fait glisser : écran principal, jeu au premier plan,
# seulement quand l'image a changé (vignette 64 × 36 comparée à la dernière gardée).
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class Fg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  public static string Cls() { var s = new StringBuilder(64); GetClassName(GetForegroundWindow(), s, 64); return s.ToString(); }
}
"@
New-Item -ItemType Directory -Force $Out | Out-Null
$last = $null; $n = 0; $end = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $end) {
  Start-Sleep -Milliseconds 1500
  if ([Fg]::Cls() -ne "UnrealWindow") { continue }
  $bmp = New-Object System.Drawing.Bitmap 2560, 1440
  $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(0, 0, 0, 0, $bmp.Size); $g.Dispose()
  $thumb = New-Object System.Drawing.Bitmap $bmp, 64, 36
  $px = New-Object int[] (64 * 36)
  for ($y = 0; $y -lt 36; $y++) { for ($x = 0; $x -lt 64; $x++) { $c = $thumb.GetPixel($x, $y); $px[$y * 64 + $x] = $c.R + $c.G + $c.B } }
  $thumb.Dispose()
  $diff = if ($last) { ($(for ($i = 0; $i -lt $px.Length; $i++) { [Math]::Abs($px[$i] - $last[$i]) }) | Measure-Object -Average).Average } else { 999 }
  if ($diff -gt 12) {
    $bmp.Save((Join-Path $Out ("cap-{0:D3}.png" -f $n)), [System.Drawing.Imaging.ImageFormat]::Png)
    $n++; $last = $px
    Write-Output ("{0:HH:mm:ss} capture {1} (écart {2:N0})" -f (Get-Date), $n, $diff)
  }
  $bmp.Dispose()
}
Write-Output "Fini : $n captures"
