// Знімок даних CRM у Vercel Blob: шифрування, читання, економний запис і шлях bootstrap.
const assert = require("assert");

process.env.ADMIN_API_SECRET = "test-secret";
process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";

const snapshot = require("../lib/admin-snapshot");
const { seal, unseal, memo, MIN_SAVE_INTERVAL_MS, setBlobModule } = snapshot._internal;

// Сховище в памʼяті замість Vercel Blob.
function fakeBlob() {
  const store = new Map();
  const calls = { get: 0, put: 0 };
  return {
    store, calls,
    async get(pathname, opts) {
      calls.get += 1;
      assert.equal(opts.access, "private", "знімок лише приватний");
      assert.equal(opts.useCache, false, "читаємо повз кеш, щоб бачити перезапис одразу");
      if (!store.has(pathname)) return null;
      return { statusCode: 200, stream: new Response(store.get(pathname)).body, headers: new Headers(), blob: {} };
    },
    async put(pathname, body, opts) {
      calls.put += 1;
      assert.equal(opts.access, "private");
      assert.equal(opts.allowOverwrite, true);
      assert.equal(opts.addRandomSuffix, false);
      store.set(pathname, Buffer.from(body));
      return { pathname };
    },
  };
}
function resetMemo() { memo.hash = ""; memo.savedAt = 0; }

async function run() {
  // ── Шифрування ──
  const sealed = seal({ v: 1, saved_at: 1, hash: "h", data: { client: "Сергій", phone: "+380671112233" } });
  assert.ok(!sealed.toString("utf8").includes("380671112233"), "у сховищі немає відкритих персональних даних");
  assert.equal(unseal(sealed).data.client, "Сергій");
  const tampered = Buffer.from(sealed); tampered[tampered.length - 1] ^= 1;
  assert.throws(() => unseal(tampered), "підмінений знімок не читається");
  process.env.ADMIN_API_SECRET = "other-secret";
  assert.throws(() => unseal(sealed), "інший ключ — знімок не розшифрувати");
  process.env.ADMIN_API_SECRET = "test-secret";

  // ── Економний запис ──
  const blob = fakeBlob();
  setBlobModule(blob);
  resetMemo();
  const t0 = Date.now() - 60 * 60 * 1000;
  const v1 = { status: "ok", groups: [{ order_number: "ORD-150926-012", status: "Нове" }] };
  assert.equal(await snapshot.saveSnapshot(v1, t0), "saved", "перший знімок записується");
  assert.equal(blob.calls.put, 1);
  assert.equal(await snapshot.saveSnapshot(v1, t0 + 10 * 60 * 1000), "unchanged", "ті самі дані — без запису");
  const v2 = { status: "ok", groups: [{ order_number: "ORD-150926-012", status: "В опрацюванні підрядником" }] };
  assert.equal(await snapshot.saveSnapshot(v2, t0 + 60 * 1000), "throttled", "не частіше ніж раз на 3 хвилини");
  assert.equal(await snapshot.saveSnapshot(v2, t0 - 1000), "older", "старіші дані не перезаписують новіші");
  assert.equal(await snapshot.saveSnapshot(v2, t0 + MIN_SAVE_INTERVAL_MS + 1000), "saved");
  assert.equal(blob.calls.put, 2, "за всі ці виклики — лише два записи");

  // Холодний екземпляр функції: спершу дізнається, що вже лежить, і не пише те саме.
  resetMemo();
  const getsBefore = blob.calls.get;
  assert.equal(await snapshot.saveSnapshot(v2, t0 + MIN_SAVE_INTERVAL_MS + 5000), "unchanged");
  assert.equal(blob.calls.get, getsBefore + 1);
  assert.equal(blob.calls.put, 2);

  // ── Читання ──
  resetMemo();
  const snap = await snapshot.readSnapshot();
  assert.equal(snap.data.groups[0].status, "В опрацюванні підрядником");
  assert.equal(snap.saved_at, t0 + MIN_SAVE_INTERVAL_MS + 1000);

  blob.store.set(snapshot._internal.PATHNAME, seal({ v: 1, saved_at: Date.now() - 8 * 24 * 3600 * 1000, hash: "x", data: v1 }));
  assert.equal(await snapshot.readSnapshot(), null, "знімок старший за тиждень не показуємо");

  blob.store.set(snapshot._internal.PATHNAME, Buffer.from("зіпсовано"));
  assert.equal(await snapshot.readSnapshot(), null, "пошкоджений знімок — не збій, просто немає");

  setBlobModule({ get: async () => { throw new Error("Blob недоступний (ліміт)"); }, put: async () => { throw new Error("ліміт"); } });
  assert.equal(await snapshot.readSnapshot(), null, "сховище недоступне — кабінет іде в таблицю");
  resetMemo();
  assert.equal(await snapshot.saveSnapshot(v1, Date.now()), "error", "помилка запису не ламає відповідь");

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  let touched = false;
  setBlobModule({ get: async () => { touched = true; }, put: async () => { touched = true; } });
  assert.equal(await snapshot.readSnapshot(), null);
  assert.equal(await snapshot.saveSnapshot(v1, Date.now()), "disabled");
  assert.equal(touched, false, "без ключа сховища нічого не викликаємо");
  process.env.BLOB_READ_WRITE_TOKEN = token;

  // ── Шлях /api/admin/bootstrap ──
  const sheetsPath = require.resolve("../lib/admin-sheets");
  const authPath = require.resolve("../lib/admin-auth");
  const snapPath = require.resolve("../lib/admin-snapshot");
  let sheetsCalls = 0, saved = [], snapToReturn = null;
  require.cache[sheetsPath] = { id: sheetsPath, filename: sheetsPath, loaded: true, exports: {
    callAdminSheets: async () => { sheetsCalls += 1; return { status: "ok", groups: ["свіжі"] }; },
    sendError: (res, err) => res.status(err.status || 500).json({ error: err.message }),
  } };
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
    requireAdmin: () => true, setAdminCors: () => {}, handleOptions: (req, res) => res.status(204).end(),
  } };
  require.cache[snapPath] = { id: snapPath, filename: snapPath, loaded: true, exports: {
    readSnapshot: async () => snapToReturn,
    saveSnapshot: async (data, readAt) => { saved.push({ data, readAt }); return "saved"; },
  } };
  const handler = require("../api/admin/bootstrap");
  const call = async (query) => {
    const res = { statusCode: 200, body: null, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
    await handler({ method: "GET", headers: {}, query }, res);
    return res;
  };

  snapToReturn = { saved_at: Date.now() - 90 * 1000, data: { status: "ok", groups: ["знімок"] } };
  let r = await call({});
  assert.deepEqual(r.body.groups, ["знімок"], "відкриття — зі знімка, без очікування таблиці");
  assert.equal(r.body.snapshot.source, "snapshot");
  assert.ok(r.body.snapshot.age_ms >= 90 * 1000);
  assert.equal(sheetsCalls, 0, "таблицю при відкритті не чекаємо");

  r = await call({ fresh: "1" });
  assert.deepEqual(r.body.groups, ["свіжі"]);
  assert.equal(r.body.snapshot.source, "sheets");
  assert.equal(sheetsCalls, 1);
  assert.equal(saved.length, 1, "свіжі дані оновлюють знімок");

  snapToReturn = null;
  r = await call({});
  assert.equal(r.body.snapshot.source, "sheets", "знімка немає — одразу таблиця");
  assert.equal(sheetsCalls, 2);

  console.log("admin-snapshot tests: OK");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
