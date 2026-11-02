// Службові значення з таблиці не потрапляють людині: «false» у коментарі, «direct» у джерелі.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ctx = vm.createContext({ console, Date });
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "google-apps-script-v2.js"), "utf8"), ctx);

assert.equal(ctx.itemComment_(false, ""), "", "галочка без позначки — не коментар");
assert.equal(ctx.itemComment_(true, ""), "");
assert.equal(ctx.itemComment_("FALSE", ""), "");
assert.equal(ctx.itemComment_(" false ", "Коментар до моделі: синій"), "синій", "порожня клітинка — беремо зі старих приміток");
assert.equal(ctx.itemComment_("без кришки", ""), "без кришки");
assert.equal(ctx.itemComment_("", ""), "");

assert.equal(ctx.sourceLabel_("direct"), "сайт (без реклами)");
assert.equal(ctx.sourceLabel_(""), "сайт (без реклами)");
assert.equal(ctx.sourceLabel_("manual"), "внесено вручну");
assert.equal(ctx.sourceLabel_("osbb_kp"), "osbb_kp");

console.log("labels tests: OK");
