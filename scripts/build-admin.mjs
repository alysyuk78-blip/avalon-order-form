// Збірка кабінету + відбиток версії.
//
// Навіщо відбиток: браузер (особливо окреме вікно застосунку) може тримати в памʼяті
// стару сторінку після деплою — власник бачить CRM «без змін». Тому в бандл
// зашивається BUILD_ID, а поруч кладеться /admin/version.json із тим самим ID.
// Кабінет час від часу порівнює їх і показує кнопку «Оновити», коли вийшла нова версія.
//
// ID = хеш самого бандла, тому він однаковий у будь-кого, хто зібрав ті самі джерела.

import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const OUT_FILE = "public/admin/assets/admin.js";
const PAGE_FILE = "public/admin/index.html";
const VERSION_FILE = "public/admin/version.json";
const PLACEHOLDER = "__BUILD_ID_PLACEHOLDER__";

await build({
  entryPoints: ["admin/src/main.jsx"],
  bundle: true,
  outfile: OUT_FILE,
  minify: true,
  loader: { ".jsx": "jsx" },
  define: { __ADMIN_BUILD__: JSON.stringify(PLACEHOLDER) },
});

// У хеш входить і index.html: усі стилі кабінету лежать там, і зміна лише стилів
// теж має вмикати кнопку «Оновити».
const bundle = await readFile(OUT_FILE, "utf8");
const page = await readFile(PAGE_FILE, "utf8");
const buildId = createHash("sha256").update(bundle).update("\n").update(page).digest("hex").slice(0, 12);

await writeFile(OUT_FILE, bundle.split(PLACEHOLDER).join(buildId));
await writeFile(VERSION_FILE, JSON.stringify({ build: buildId }) + "\n");

console.log(`admin.js зібрано, версія ${buildId}`);
