// Розносить ЄДИНИЙ алгоритм ціни з lib/avalon-pricing.js у решту місць, де він має лежати
// дослівно: скрипт таблиці (google-apps-script-v2.js) і калькулятор (сусідня папка
// avalon-calculator, якщо вона є). Запуск: npm run sync:pricing
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const START = "// >>> AVALON-PRICING-CORE";
const END = "// <<< AVALON-PRICING-CORE";

function block(text, file) {
  const a = text.indexOf(START), b = text.indexOf(END);
  if (a < 0 || b < 0) throw new Error(`У ${file} немає блоку ${START} … ${END}`);
  return { a, b: b + END.length, core: text.slice(a, b + END.length) };
}

const { core } = block(readFileSync(join(root, "lib/avalon-pricing.js"), "utf8"), "lib/avalon-pricing.js");

const gasPath = join(root, "google-apps-script-v2.js");
const gas = readFileSync(gasPath, "utf8");
const g = block(gas, "google-apps-script-v2.js");
writeFileSync(gasPath, gas.slice(0, g.a) + core + gas.slice(g.b));

const calcDir = join(root, "..", "avalon-calculator", "src", "lib");
if (existsSync(calcDir)) {
  writeFileSync(join(calcDir, "avalonPricing.mjs"), `${core}

export {
  AVALON_PRICING_DEFAULTS, AVALON_MATERIALS, AVALON_MODEL_TYPES,
  avalonSnap, avalonModelType, avalonParseOptions, avalonPrice, avalonPriceItem,
  avalonMarkupFactor, avalonCostLines, avalonIsBaseColor, avalonColorSurcharge, AVALON_COLOR_SURCHARGE_NAME,
  avalonIsIndividualPricing, avalonIndividualReason, AVALON_COMPLEX_PATTERNS, avalonItemSized,
  avalonLamellaCount, avalonIsCustomPattern, AVALON_LAMELLA,
};
`);
  console.log("калькулятор: src/lib/avalonPricing.mjs оновлено");
} else {
  console.log("калькулятор: папки ../avalon-calculator немає — пропущено");
}
console.log("контрольна сума ядра:", createHash("sha256").update(core).digest("hex"));
