// Знімок даних CRM у приватному сховищі Vercel Blob.
//
// Навіщо: веб-застосунок Apps Script випадково тримає ~40% відповідей 6–35 с, а часом
// «хвилею» ~40 с не відповідає зовсім (заміри 15.09.2026). Щоб кабінет відкривався
// одразу, сервер спершу віддає останній знімок зі сховища (частки секунди), а свіжі
// дані з таблиці кабінет підтягує у фоні — і вони ж оновлюють знімок.
//
// Безпека: сховище приватне (доступ лише з ключем проєкту), а сам знімок ще й
// зашифрований AES-256-GCM ключем, похідним від ADMIN_API_SECRET.
//
// Ліміти Hobby: 2 000 записів (put) і 10 000 читань на місяць; перевищення вимикає
// сховище на 30 днів. Тому запис — лише коли дані змінились і не частіше ніж раз на
// 3 хвилини. Будь-яка помилка сховища — не збій: кабінет просто йде в таблицю, як раніше.

const crypto = require("crypto");

const PATHNAME = "crm/bootstrap.v1.bin";
const MAGIC = Buffer.from("AVS1");
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;   // старіший знімок не показуємо
const MIN_SAVE_INTERVAL_MS = 3 * 60 * 1000;
const READ_TIMEOUT_MS = 4000;

// Пакет підвантажуємо ліниво: тести підміняють його, а без ключа він не потрібен.
let blobModule = null;
function blob() {
  if (!blobModule) blobModule = require("@vercel/blob");
  return blobModule;
}

// Що відомо цьому екземпляру функції про останній знімок (між викликами fluid compute).
const memo = { hash: "", savedAt: 0 };

function enabled() {
  return !!(process.env.BLOB_READ_WRITE_TOKEN && process.env.ADMIN_API_SECRET);
}

function key() {
  return crypto.createHash("sha256").update("avalon-crm-snapshot:v1:" + process.env.ADMIN_API_SECRET).digest();
}

function hashOf(data) {
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

function seal(envelope) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(envelope), "utf8"), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

function unseal(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < MAGIC.length + 28 || !buf.subarray(0, 4).equals(MAGIC)) return null;
  const iv = buf.subarray(4, 16);
  const tag = buf.subarray(16, 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  const json = Buffer.concat([decipher.update(buf.subarray(32)), decipher.final()]).toString("utf8");
  return JSON.parse(json);
}

const SAVE_BUDGET_MS = 4000;

// Поточний вміст сховища: розшифрований конверт (або null) і його ETag — ним захищаємо
// запис від одночасного оновлення іншим екземпляром функції.
async function fetchCurrent(signal) {
  const result = await blob().get(PATHNAME, {
    access: "private",
    useCache: false,            // перезапис видно одразу, а не через хвилину з кешу
    abortSignal: signal,
  });
  if (!result || result.statusCode !== 200 || !result.stream) return { exists: false, etag: "", envelope: null };
  const etag = (result.blob && result.blob.etag) || "";
  const buf = Buffer.from(await new Response(result.stream).arrayBuffer());
  let envelope = null;
  try {
    envelope = unseal(buf);
  } catch (_) {
    envelope = null;            // пошкоджений або зашифрований іншим ключем
  }
  if (envelope && (!envelope.data || !Number(envelope.saved_at))) envelope = null;
  return { exists: true, etag, envelope };
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

/** Останній знімок або null (немає, застарий, пошкоджений, сховище недоступне). */
async function readSnapshot() {
  if (!enabled()) return null;
  const t = withTimeout(READ_TIMEOUT_MS);
  try {
    const { envelope } = await fetchCurrent(t.signal);
    if (!envelope) return null;
    memo.hash = String(envelope.hash || "");
    memo.savedAt = Number(envelope.saved_at);
    if (Date.now() - envelope.saved_at > MAX_AGE_MS) return null;
    return envelope;
  } catch (err) {
    console.error("snapshot read:", err && err.message);
    return null;
  } finally {
    t.done();
  }
}

/**
 * Зберегти свіжі дані з таблиці (найкраще зусилля, до 4 с). readAt — коли почалося
 * читання таблиці. Повертає: saved / unchanged / throttled / older / conflict / disabled / error.
 *
 * Запис умовний: перед ним читаємо поточну версію, вирішуємо за нею й пишемо лише поверх
 * САМЕ неї (ifMatch; якщо знімка ще немає — без перезапису). Якщо інший екземпляр встиг
 * записати раніше — отримуємо «conflict» і нічого не затираємо, тож порядок завершення
 * одночасних запитів не може повернути знімок назад у часі.
 */
async function saveSnapshot(data, readAt) {
  if (!enabled()) return "disabled";
  const t = withTimeout(SAVE_BUDGET_MS);
  try {
    const hash = hashOf(data);
    // Швидкі відмови без жодної операції сховища (памʼять лише пропускає запис — це безпечно).
    if (memo.hash === hash) return "unchanged";
    if (memo.savedAt && readAt <= memo.savedAt) return "older";
    if (memo.savedAt && readAt - memo.savedAt < MIN_SAVE_INTERVAL_MS) return "throttled";

    const current = await fetchCurrent(t.signal);
    const env = current.envelope;
    if (env) {
      memo.hash = String(env.hash || "");
      memo.savedAt = Number(env.saved_at);
      if (env.hash === hash) return "unchanged";
      if (readAt <= env.saved_at) return "older";
      if (readAt - env.saved_at < MIN_SAVE_INTERVAL_MS) return "throttled";
    }
    const options = {
      access: "private",
      addRandomSuffix: false,
      contentType: "application/octet-stream",
      abortSignal: t.signal,
    };
    if (current.exists) {
      options.allowOverwrite = true;
      if (current.etag) options.ifMatch = current.etag;
    } else {
      options.allowOverwrite = false;      // хтось щойно створив — не затираємо
    }
    await blob().put(PATHNAME, seal({ v: 1, saved_at: readAt, hash, data }), options);
    memo.hash = hash;
    memo.savedAt = readAt;
    return "saved";
  } catch (err) {
    const name = String((err && err.name) || "");
    const message = String((err && err.message) || "");
    if (/PreconditionFailed/i.test(name) || /precondition|already exists/i.test(message)) {
      memo.savedAt = 0;                    // у сховищі новіша версія — наступного разу перечитаємо
      return "conflict";
    }
    console.error("snapshot save:", message);
    return "error";
  } finally {
    t.done();
  }
}

module.exports = {
  readSnapshot,
  saveSnapshot,
  _internal: { seal, unseal, memo, PATHNAME, MIN_SAVE_INTERVAL_MS, SAVE_BUDGET_MS, setBlobModule: (m) => { blobModule = m; } },
};
