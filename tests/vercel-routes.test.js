// Маршрути Vercel: калькулятор під адресою кабінету (/calc/ → проксі на avalon-calculator).
// Vercel зіставляє `source` бібліотекою path-to-regexp у СУВОРОМУ режимі (strict: true):
//   • "/calc/:path*" НЕ збігається з "/calc/" (потрібен непорожній сегмент) — саме цю адресу
//     відкривають кнопки кабінету, і вона падала б у загальне правило → 404;
//   • "/calc/(.*)" збігається і з "/calc/", і з усіма вкладеними шляхами.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));

// Суворе зіставлення для шаблонів, які ми використовуємо: літерали + групи "(.*)".
function toRegex(source) {
  assert.ok(!/:[a-zA-Z]/.test(source), "іменовані сегменти (:path*) тут не використовуємо: " + source);
  const escaped = source.split("(.*)").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("(.*)");
  return new RegExp("^" + escaped + "$");
}
function resolve(url) {
  for (const rule of config.redirects || []) {
    if (toRegex(rule.source).test(url)) return { redirect: rule.destination };
  }
  for (const rule of config.rewrites || []) {
    const m = url.match(toRegex(rule.source));
    if (m) return { rewrite: rule.destination.replace("$1", m[1] == null ? "" : m[1]) };
  }
  return {};
}

const CALC = "https://avalon-calculator.vercel.app/";
assert.deepEqual(resolve("/calc/"), { rewrite: CALC }, "кнопка «Калькулятор» відкриває саме /calc/");
assert.deepEqual(resolve("/calc/assets/index-abc.js"), { rewrite: CALC + "assets/index-abc.js" });
assert.deepEqual(resolve("/calc/img/model-solid.png"), { rewrite: CALC + "img/model-solid.png" });
assert.deepEqual(resolve("/calc"), { redirect: "/calc/" }, "без слеша — переадресація (інакше відносні шляхи файлів зламаються)");
assert.deepEqual(resolve("/calculator"), { rewrite: "/public/calculator" }, "схожі адреси під правило не підпадають");
assert.deepEqual(resolve("/admin/"), { rewrite: "/public/admin/" });
assert.deepEqual(resolve("/"), { rewrite: "/public/" });
// Проксі — перед загальним правилом, і переадресація не може зациклитись.
assert.equal(config.rewrites[0].source, "/calc/(.*)");
assert.equal(config.rewrites[config.rewrites.length - 1].source, "/(.*)");
assert.ok(!toRegex("/calc").test("/calc/"));

console.log("vercel-routes tests: OK");
