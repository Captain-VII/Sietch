// Rend un SVG en PNG 1024 × 1024 en gardant la transparence (coins arrondis).
// Usage : node scripts/render-icon.mjs entree.svg sortie.png
// (Les icônes de Sietch viennent de assets/icon.png et assets/icon-plate.png : npm run icon)
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";

const [input, output] = process.argv.slice(2);
const png = new Resvg(readFileSync(input), { fitTo: { mode: "width", value: 1024 } }).render().asPng();
writeFileSync(output, png);
