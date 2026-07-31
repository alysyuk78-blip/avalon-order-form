import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';

    const STATUSES = ["Нове","В роботі","Готове","Відправлено","Завершено","Скасовано"];
    const STATUS_CLASS = {
      "Нове": "st-new",
      "В роботі": "st-work",
      "Готове": "st-ready",
      "Відправлено": "st-ship",
      "Завершено": "st-done",
      "Скасовано": "st-cancel",
    };
    const EXPENSE_CATS = ["Реклама / маркетинг","Доставка","Пакування / матеріали","Підряд / зарплати","Інше"];
    // Каталог для ручного внесення (дзеркалить CATALOG_MODELS у public/index.html).
    const CATALOG_MODELS_CRM = [
      { id: "AVL-01", name: "Суцільний", construction: "Суцільний" },
      { id: "AVL-02", name: "Екран під утеплювач", construction: "Розбірна", coverAllowed: false },
      { id: "AVL-03", name: "Універсальний", construction: "Суцільний" },
      { id: "AVL-04", name: "Зі знімною боковиною", construction: "Суцільний" },
      { id: "AVL-05", name: "Розбірний", construction: "Розбірний (з 3-х частин)" },
      { id: "AVL-06", name: "Ламель з кришкою", construction: "Суцільний", defaultCover: true },
      { id: "AVL-06/1", name: "Ламельний", construction: "Суцільний" },
      { id: "AVL-07", name: "Закритий на підставці", construction: "Суцільний", defaultCover: true },
      { id: "AVL-08", name: "Горизонтальний монтаж", construction: "Суцільний", defaultCover: true },
      { id: "AVL-K-01", name: "Кронштейни декоративні (компл.)", construction: "Комплект кронштейнів", bracket: true },
      { id: "AVL-SK-01", name: "Кронштейна система (компл.)", construction: "Комплект системи", bracket: true },
    ];
    // Звідки прийшло замовлення, внесене вручну (пише в колонку «Джерело»).
    const MANUAL_SOURCES = ["Телефон","Instagram","Facebook","Viber / WhatsApp","Telegram","Повторний клієнт","Рекомендація","ОСББ","Партнер / підрядник","Візит в офіс","Інше"];
    const BRACKET_LENGTHS = ["450 мм","500 мм","600 мм","700 мм"];
    const TOKEN_KEY = "avalon_admin_token";

    function money(v) {
      if (v == null || v === "") return "—";
      return Number(v).toLocaleString("uk-UA") + " ₴";
    }
    function pct(v) {
      if (v == null || v === "") return "—";
      return Number(v).toLocaleString("uk-UA", { maximumFractionDigits: 1 }) + "%";
    }
    /** Парсить дати з таблиці: dd.MM.yyyy[ HH:mm] */
    function parseUaDateTime(v) {
      if (v == null || v === "") return null;
      if (v instanceof Date && !isNaN(v.getTime())) return v;
      const s = String(v).trim();
      const ua = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
      if (ua) {
        return new Date(
          Number(ua[3]),
          Number(ua[2]) - 1,
          Number(ua[1]),
          Number(ua[4] || 0),
          Number(ua[5] || 0),
          Number(ua[6] || 0)
        );
      }
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        const d = new Date(s);
        if (!isNaN(d.getTime())) return d;
      }
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    }
    /** Коротка дата для таблиць: 23.06.2026 09:04 */
    function formatDateShort(v) {
      if (v == null || v === "") return "—";
      const d = parseUaDateTime(v);
      if (!d) {
        const s = String(v).trim();
        return s.length > 22 ? s.slice(0, 22) + "…" : s;
      }
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yyyy = d.getFullYear();
      const hh = String(d.getHours()).padStart(2, "0");
      const mi = String(d.getMinutes()).padStart(2, "0");
      const hasTime = !(d.getHours() === 0 && d.getMinutes() === 0 && String(v).indexOf(":") < 0);
      return hasTime ? `${dd}.${mm}.${yyyy} ${hh}:${mi}` : `${dd}.${mm}.${yyyy}`;
    }
    function statusClass(status) {
      return STATUS_CLASS[status] || "";
    }
    /** Дата замовлення: created_at (UA/ISO) або номер ORD-DDMMYY-NNN */
    function orderDate(g) {
      if (!g) return null;
      const fromCreated = parseUaDateTime(g.created_at);
      if (fromCreated) return fromCreated;
      const m = String(g.order_number || "").match(/^ORD-(\d{2})(\d{2})(\d{2})-/);
      if (m) {
        const d = new Date(2000 + Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        if (!isNaN(d.getTime())) return d;
      }
      return null;
    }
    function startOfDay(d) {
      const x = new Date(d);
      x.setHours(0, 0, 0, 0);
      return x;
    }
    function periodRange(period) {
      const now = new Date();
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      if (period === "all") return null;
      if (period === "7d") {
        const start = startOfDay(now);
        start.setDate(start.getDate() - 6);
        return { start, end };
      }
      if (period === "30d") {
        const start = startOfDay(now);
        start.setDate(start.getDate() - 29);
        return { start, end };
      }
      if (period === "month") {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        return { start, end };
      }
      return null;
    }
    function inPeriod(g, period) {
      const range = periodRange(period);
      if (!range) return true;
      const d = orderDate(g);
      if (!d) return false;
      return d >= range.start && d <= range.end;
    }
    function monthKeyFromDate(d) {
      if (!d || isNaN(d.getTime())) return "";
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      return mm + "." + d.getFullYear();
    }
    function compareMonthKeyDesc(a, b) {
      const [am, ay] = String(a).split(".").map(Number);
      const [bm, by] = String(b).split(".").map(Number);
      return (by - ay) || (bm - am);
    }
    /** Одне нагадування на замовлення; пріоритет: борг маржі → в роботі → без дати. */
    function buildReminders(groups) {
      const active = ["Нове", "В роботі", "Готове", "Відправлено"];
      const byOrder = {};
      (groups || []).forEach(g => {
        if (g.status === "Скасовано") return;
        const profit = Number(g.profit) || 0;
        const reasons = [];
        let priority = 99;
        let tag = "";
        let tagClass = "";
        if (g.client_paid && !g.margin_paid && profit > 0) {
          reasons.push("Маржа до отримання: " + money(profit));
          priority = Math.min(priority, 1);
          tag = "Борг маржі";
          tagClass = "debt";
        }
        if (g.status === "В роботі") {
          reasons.push("Статус «В роботі» · " + money(g.revenue));
          if (priority > 2) { priority = 2; tag = "В роботі"; tagClass = "stuck"; }
        }
        if (active.indexOf(g.status) >= 0 && !String(g.delivery_date || "").trim()) {
          reasons.push("Немає дати доставки");
          if (priority > 3) { priority = 3; tag = "Дата"; tagClass = "ship"; }
        }
        if (!reasons.length) return;
        byOrder[g.order_number] = {
          key: "rem-" + g.order_number,
          order_number: g.order_number,
          title: g.order_number + " · " + (g.client || "Клієнт"),
          desc: reasons.join(" · "),
          tag: tag || "Увага",
          tagClass: tagClass || "",
          priority,
        };
      });
      return Object.keys(byOrder)
        .map(k => byOrder[k])
        .sort((a, b) => a.priority - b.priority || String(b.order_number).localeCompare(String(a.order_number)))
        .slice(0, 12);
    }
    function totalsFromGroups(groups, expensesTotal) {
      const by_status = {};
      STATUSES.forEach(s => { by_status[s] = 0; });
      let revenue = 0, cost = 0, profit = 0, commission = 0;
      let margin_ready = 0, margin_received = 0, margin_debt = 0;
      (groups || []).forEach(g => {
        const st = g.status || "";
        if (by_status[st] != null) by_status[st] += 1;
        if (st === "Скасовано") return;
        const rev = Number(g.revenue) || 0;
        const cst = Number(g.cost_total) || 0;
        const pr = Number(g.profit) || 0;
        const com = Number(g.commission) || 0;
        revenue += rev;
        cost += cst;
        profit += pr;
        commission += com;
        if (g.client_paid) margin_ready += pr;
        if (g.margin_paid) margin_received += pr;
        if (g.client_paid && !g.margin_paid) margin_debt += pr;
      });
      const expenses = Number(expensesTotal) || 0;
      return {
        revenue, cost, profit, commission, expenses,
        margin_ready, margin_received, margin_debt,
        margin_pct: revenue ? Math.round((profit / revenue) * 1000) / 10 : 0,
        net_fact: margin_received - commission - expenses,
        by_status,
      };
    }
    function monthlyFromGroups(groups, expenses) {
      const map = {};
      (groups || []).forEach(g => {
        if (g.status === "Скасовано") return;
        const d = orderDate(g);
        const key = monthKeyFromDate(d);
        if (!key) return;
        if (!map[key]) {
          map[key] = { month: key, revenue: 0, cost: 0, profit: 0, commission: 0, margin_received: 0, margin_debt: 0, expenses: 0 };
        }
        const m = map[key];
        m.revenue += Number(g.revenue) || 0;
        m.cost += Number(g.cost_total) || 0;
        m.profit += Number(g.profit) || 0;
        m.commission += Number(g.commission) || 0;
        if (g.margin_paid) m.margin_received += Number(g.profit) || 0;
        if (g.client_paid && !g.margin_paid) m.margin_debt += Number(g.profit) || 0;
      });
      (expenses || []).forEach(ex => {
        const d = parseUaDateTime(ex.date) || (ex.date ? new Date(ex.date) : null);
        const key = monthKeyFromDate(d);
        if (!key) return;
        if (!map[key]) {
          map[key] = { month: key, revenue: 0, cost: 0, profit: 0, commission: 0, margin_received: 0, margin_debt: 0, expenses: 0 };
        }
        map[key].expenses += Number(ex.amount) || 0;
      });
      return Object.keys(map).map(k => {
        const row = map[k];
        row.margin_pct = row.revenue ? Math.round((row.profit / row.revenue) * 1000) / 10 : 0;
        row.net_fact = row.margin_received - row.commission - row.expenses;
        return row;
      }).sort((a, b) => compareMonthKeyDesc(a.month, b.month)).slice(0, 6);
    }
    /** Нормалізація телефону: ключ для довідника клієнтів. */
    function normalizePhone(phone) {
      let d = String(phone || "").replace(/\D/g, "");
      if (!d) return "";
      if (d.indexOf("380") === 0 && d.length >= 12) return d.slice(0, 12);
      if (d.length === 10 && d.charAt(0) === "0") return "38" + d;
      if (d.length === 9) return "380" + d;
      if (d.length > 12) return d.slice(-12);
      return d;
    }
    function formatPhoneDisplay(key, raw) {
      if (raw && String(raw).trim()) return String(raw).trim();
      if (!key) return "—";
      if (key.length === 12 && key.indexOf("380") === 0) {
        return "+" + key.slice(0, 3) + " " + key.slice(3, 5) + " " + key.slice(5, 8) + " " + key.slice(8);
      }
      return key;
    }
    function telegramHandle(v) {
      return String(v || "").trim().replace(/^https?:\/\/(?:www\.)?t\.me\//i, "").replace(/^@/, "").replace(/\?.*$/, "");
    }
    function telHref(phone) {
      const d = normalizePhone(phone);
      return d ? "tel:+" + d : "";
    }
    function resolveContactMethod(order) {
      const allowed = ["phone", "telegram", "viber", "whatsapp", "email"];
      const m = String(order?.contact_method || "").trim();
      if (allowed.includes(m)) return m;
      if (order?.contact_telegram) return "telegram";
      if (order?.contact_email) return "email";
      if (order?.phone) return "phone";
      return "";
    }
    function buildContactActions(order) {
      const method = resolveContactMethod(order);
      const phone = String(order?.phone || "").trim();
      const dial = telHref(phone);
      const tg = telegramHandle(order?.contact_telegram);
      const email = String(order?.contact_email || "").trim();
      const actions = [];
      const push = (href, label, external) => {
        if (href && label) actions.push({ href, label, external: !!external });
      };
      if (method === "telegram" && tg) push("https://t.me/" + encodeURIComponent(tg), "@" + tg, true);
      else if (method === "email" && email) push("mailto:" + email, email, false);
      else if (method === "viber" && dial) push("viber://chat?number=%2B" + normalizePhone(phone), phone || "Viber", false);
      else if (method === "whatsapp" && dial) push("https://wa.me/" + normalizePhone(phone), phone || "WhatsApp", true);
      else if (dial) push(dial, phone || "Дзвінок", false);
      if (dial && method && !["phone", "viber", "whatsapp"].includes(method)) {
        push(dial, phone || "Телефон", false);
      }
      return actions;
    }
    function ContactLinks({ order, stack, onClickStop }) {
      const actions = buildContactActions(order);
      if (!actions.length) return <span className="contact-muted">—</span>;
      const stop = onClickStop ? (e) => e.stopPropagation() : undefined;
      const cls = "contact-links" + (stack ? " contact-links--stack" : "");
      return (
        <span className={cls} onClick={stop}>
          {actions.map((a, i) => (
            <a
              key={a.href + i}
              className="contact-link"
              href={a.href}
              target={a.external ? "_blank" : undefined}
              rel={a.external ? "noopener noreferrer" : undefined}
            >{a.label}</a>
          ))}
        </span>
      );
    }
    function QuickContact({ order }) {
      const actions = buildContactActions(order);
      if (!actions.length) return null;
      return (
        <div className="quick-contact">
          {actions.map((a, i) => (
            <a
              key={a.href + i}
              href={a.href}
              target={a.external ? "_blank" : undefined}
              rel={a.external ? "noopener noreferrer" : undefined}
            >{a.label}</a>
          ))}
        </div>
      );
    }
    /** Збирає довідник: 1 телефон → основне імʼя (з найранішого замовлення) + інші варіанти. */
    function buildClientsDirectory(groups) {
      const byPhone = {};
      (groups || []).forEach((g) => {
        const key = normalizePhone(g.phone);
        if (!key) return;
        if (!byPhone[key]) {
          byPhone[key] = {
            phone_key: key,
            phone_display: formatPhoneDisplay(key, g.phone),
            names: [],
            name_set: {},
            orders: [],
            revenue: 0,
            profit: 0,
          };
        }
        const c = byPhone[key];
        const name = String(g.client || "").trim();
        if (name) {
          const nk = name.toLowerCase();
          if (!c.name_set[nk]) {
            c.name_set[nk] = true;
            c.names.push({ name, first_seen: g.created_at || "", order_number: g.order_number });
          }
        }
        c.orders.push(g);
        if (g.status !== "Скасовано") {
          c.revenue += Number(g.revenue) || 0;
          c.profit += Number(g.profit) || 0;
        }
        if (g.phone && String(g.phone).trim().length > String(c.phone_display || "").length) {
          c.phone_display = String(g.phone).trim();
        }
      });
      return Object.keys(byPhone).map((key) => {
        const c = byPhone[key];
        c.names.sort((a, b) => parseUaDateTime(a.first_seen) - parseUaDateTime(b.first_seen));
        c.primary_name = c.names.length ? c.names[0].name : "Без імені";
        c.aliases = c.names.slice(1).map((n) => n.name);
        c.phone = c.phone_display;
        c.orders_count = c.orders.filter((o) => o.status !== "Скасовано").length;
        c.orders.sort((a, b) => parseUaDateTime(b.created_at) - parseUaDateTime(a.created_at));
        c.last_order_at = c.orders.length ? c.orders[0].created_at : "";
        const latest = c.orders[0];
        if (latest) {
          c.contact_method = latest.contact_method;
          c.contact_telegram = latest.contact_telegram;
          c.contact_email = latest.contact_email;
        }
        c.cities = Array.from(new Set(c.orders.map((o) => o.city).filter(Boolean)));
        delete c.name_set;
        return c;
      }).sort((a, b) => b.orders_count - a.orders_count || String(a.primary_name).localeCompare(String(b.primary_name), "uk"));
    }

    async function api(path, { method = "GET", body, token } = {}) {
      const headers = { "Content-Type": "application/json" };
      if (token) headers.Authorization = "Bearer " + token;
      const res = await fetch(path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        sessionStorage.removeItem(TOKEN_KEY);
        window.dispatchEvent(new Event("admin-unauthorized"));
      }
      if (!res.ok) {
        const err = new Error(data.error || data.message || ("HTTP " + res.status));
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data;
    }

    function confirmStatusChange(fromStatus, toStatus) {
      if (toStatus === "Скасовано") {
        return window.confirm("Скасувати замовлення?");
      }
      if (toStatus === "В роботі" && fromStatus === "Нове") {
        return window.confirm("Перевести в роботу? Підряднику може надійти повідомлення в Telegram.");
      }
      return true;
    }

    function Login({ onLogin }) {
      const [password, setPassword] = useState("");
      const [error, setError] = useState("");
      const [loading, setLoading] = useState(false);
      async function submit(e) {
        e.preventDefault();
        setLoading(true); setError("");
        try {
          const data = await api("/api/admin/login", { method: "POST", body: { password } });
          onLogin(data.token);
        } catch (err) {
          setError(err.message || "Помилка входу");
        } finally {
          setLoading(false);
        }
      }
      return (
        <div className="login-wrap">
          <form className="login-card" onSubmit={submit}>
            <img src="/images/avalon-logo-7016.svg" alt="Avalon" style={{ height: 56, marginBottom: 16 }} />
            <h1>Кабінет CRM</h1>
            <p>Внутрішній доступ до заявок, маржі, партнерів і витрат. Клієнти сюди не потрапляють.</p>
            <div className="field">
              <label>Пароль</label>
              <input type="password" autoFocus value={password} onChange={e => setPassword(e.target.value)} placeholder="ADMIN_PASSWORD" />
            </div>
            {error && <div className="error">{error}</div>}
            <button className="btn" style={{ width: "100%", marginTop: 12 }} disabled={loading || !password}>
              {loading ? "Перевірка…" : "Увійти"}
            </button>
          </form>
        </div>
      );
    }

    function InfoTip({ text, desktopText, mobileText }) {
      const [open, setOpen] = useState(false);
      const wrapRef = useRef(null);
      useEffect(() => {
        if (!open) return;
        function onKey(e) { if (e.key === "Escape") setOpen(false); }
        function onMouseDown(e) {
          if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
        }
        document.addEventListener("keydown", onKey);
        document.addEventListener("mousedown", onMouseDown);
        return () => {
          document.removeEventListener("keydown", onKey);
          document.removeEventListener("mousedown", onMouseDown);
        };
      }, [open]);
      return (
        <span className="info-wrap" ref={wrapRef}>
          <button
            type="button"
            className="info-btn"
            aria-label="Підказка"
            aria-expanded={open}
            title="Підказка"
            onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
          >i</button>
          {open && (
            <div className="info-tip" role="note" onClick={e => e.stopPropagation()}>
              {text ? text : (
                <>
                  {desktopText && <span className="desktop-only">{desktopText}</span>}
                  {mobileText && <span className="mobile-only">{mobileText}</span>}
                </>
              )}
            </div>
          )}
        </span>
      );
    }

    function StatusChip({ status }) {
      return <span className={"badge " + statusClass(status)}>{status}</span>;
    }

    function OrderDrawer({ token, orderNumber, onClose, onChanged }) {
      const [data, setData] = useState(null);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState("");
      const [form, setForm] = useState(null);
      const [itemIdx, setItemIdx] = useState(0);

      function applyItemToForm(res, idx) {
        const item = (res.items && res.items[idx]) || {};
        setForm({
          row: item.row,
          status: (res.order && res.order.status) || item.status || "Нове",
          cost_total: item.cost_total ?? "",
          list_price: item.list_price ?? "",
          discount_pct: item.discount_pct ?? "",
          discount_uah: item.discount_uah ?? "",
          revenue: item.revenue ?? "",
          client_paid: !!(res.order && res.order.client_paid),
          margin_paid: !!(res.order && res.order.margin_paid),
          notes: item.notes || "",
          delivery_date: (res.order && res.order.delivery_date) || item.delivery_date || "",
          payment_method: item.payment_method || "",
        });
      }

      async function load() {
        setError("");
        setItemIdx(0);
        const res = await api("/api/admin/order?order_number=" + encodeURIComponent(orderNumber), { token });
        setData(res);
        applyItemToForm(res, 0);
      }

      useEffect(() => { load().catch(e => setError(e.message)); }, [orderNumber]);

      async function save(patch) {
        setBusy(true); setError("");
        try {
          const res = await api("/api/admin/order", {
            method: "PATCH",
            token,
            body: { order_number: orderNumber, row: form.row, patch },
          });
          setData(res);
          applyItemToForm(res, itemIdx);
          onChanged && onChanged();
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }

      if (!form) {
        return (
          <div className="drawer-backdrop" onClick={onClose}>
            <div className="drawer" onClick={e => e.stopPropagation()}>
              <p className="empty">{error || "Завантаження…"}</p>
            </div>
          </div>
        );
      }

      async function changeStatus(newStatus) {
        if (!confirmStatusChange(form.status, newStatus)) return;
        setForm({ ...form, status: newStatus });
        await save({ status: newStatus });
      }

      const order = data.order || {};
      const items = data.items || [];

      function selectItem(idx) {
        setItemIdx(idx);
        const item = items[idx] || {};
        setForm(f => ({
          ...f,
          row: item.row,
          cost_total: item.cost_total ?? "",
          list_price: item.list_price ?? "",
          discount_pct: item.discount_pct ?? "",
          discount_uah: item.discount_uah ?? "",
          revenue: item.revenue ?? "",
          notes: item.notes || "",
          payment_method: item.payment_method || "",
        }));
      }

      const profit = (Number(form.revenue) || 0) - (Number(form.cost_total) || 0);
      const marginPct = Number(form.revenue) ? Math.round((profit / Number(form.revenue)) * 1000) / 10 : 0;

      return (
        <div className="drawer-backdrop" onClick={onClose}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <header>
              <div>
                <h2>{orderNumber}</h2>
                <div className="meta" style={{ color: "var(--muted)", marginTop: 4 }}>
                  {order.client}
                  {order.city ? <> · {order.city}</> : null}
                </div>
              </div>
              <button className="btn ghost" onClick={onClose}>Закрити</button>
            </header>

            <QuickContact order={order} />

            <div className="section-title" style={{ marginTop: 0 }}>Швидкі дії</div>
            <div className="quick-actions">
              {STATUSES.filter(s => s !== "Скасовано").map(s => (
                <button
                  key={s}
                  type="button"
                  className={form.status === s ? "active" : ""}
                  disabled={busy}
                  onClick={() => changeStatus(s)}
                >{s}</button>
              ))}
            </div>
            <div className="quick-actions">
              <button
                type="button"
                className={form.client_paid ? "ok" : ""}
                disabled={busy}
                onClick={() => { const v = !form.client_paid; setForm({ ...form, client_paid: v }); save({ client_paid: v }); }}
              >{form.client_paid ? "✓ Клієнт заплатив" : "Клієнт заплатив"}</button>
              <button
                type="button"
                className={form.margin_paid ? "ok" : ""}
                disabled={busy}
                onClick={() => { const v = !form.margin_paid; setForm({ ...form, margin_paid: v }); save({ margin_paid: v }); }}
              >{form.margin_paid ? "✓ Маржу отримано" : "Маржу отримано"}</button>
              <button
                type="button"
                className="warn"
                disabled={busy || form.status === "Скасовано"}
                onClick={() => changeStatus("Скасовано")}
              >Скасувати</button>
            </div>

            <div className="field">
              <label>Статус</label>
              <select value={form.status} onChange={e => changeStatus(e.target.value)}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div className="section-title">Фінанси{items.length > 1 ? " (позиція " + (itemIdx + 1) + " з " + items.length + ")" : ""}</div>
            {items.length > 1 && (
              <>
                <div className="field">
                  <label>Позиція для редагування</label>
                  <select value={itemIdx} onChange={e => selectItem(Number(e.target.value))}>
                    {items.map((it, i) => (
                      <option key={it.row} value={i}>
                        {(it.basket_model || it.basket_type || "Кошик") + " · " + money(it.revenue)}
                      </option>
                    ))}
                  </select>
                </div>
                <p style={{ margin: "0 0 10px", color: "var(--muted)", fontSize: 13, lineHeight: 1.4 }}>
                  Разом по замовленню: {money(order.revenue)} · маржа {money(order.profit)}.
                </p>
              </>
            )}
            <div className="grid2">
              <div className="field"><label>Собівартість</label>
                <input type="number" value={form.cost_total} onChange={e => setForm({ ...form, cost_total: e.target.value })} /></div>
              <div className="field"><label>Роздрібна ціна</label>
                <input type="number" value={form.list_price} onChange={e => setForm({ ...form, list_price: e.target.value })} /></div>
              <div className="field"><label>Знижка %</label>
                <input type="number" step="0.1" value={form.discount_pct} onChange={e => setForm({ ...form, discount_pct: e.target.value })} /></div>
              <div className="field"><label>Знижка ₴</label>
                <input type="number" value={form.discount_uah} onChange={e => setForm({ ...form, discount_uah: e.target.value })} /></div>
              <div className="field"><label>Ціна продажу / виручка</label>
                <input type="number" value={form.revenue} onChange={e => setForm({ ...form, revenue: e.target.value })} /></div>
              <div className="field"><label>Маржа (авто)</label>
                <input disabled value={money(profit) + " · " + pct(marginPct)} /></div>
            </div>
            <div className="grid2" style={{ marginTop: 8 }}>
              <div className="field"><label>Комісія партнера</label><input disabled value={money(items.reduce((s, it) => s + (Number(it.commission) || 0), 0))} /></div>
              <div className="field"><label>Чистий по позиції</label><input disabled value={money(items.reduce((s, it) => s + (Number(it.net_profit) || 0), 0))} /></div>
            </div>
            <button className="btn" style={{ marginTop: 8 }} disabled={busy} onClick={() => save({
              cost_total: form.cost_total === "" ? null : Number(form.cost_total),
              list_price: form.list_price === "" ? null : Number(form.list_price),
              discount_pct: form.discount_pct === "" ? null : Number(form.discount_pct),
              discount_uah: form.discount_uah === "" ? null : Number(form.discount_uah),
              revenue: form.revenue === "" ? null : Number(form.revenue),
            })}>Зберегти фінанси</button>

            <div className="section-title">Оплата / маржа</div>
            <div className="grid2">
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={form.client_paid} onChange={e => { const v = e.target.checked; setForm({ ...form, client_paid: v }); save({ client_paid: v }); }} />
                Оплата клієнта ✓
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={form.margin_paid} onChange={e => { const v = e.target.checked; setForm({ ...form, margin_paid: v }); save({ margin_paid: v }); }} />
                Маржу отримано ✓
              </label>
            </div>

            <div className="section-title">Доставка та нотатки</div>
            <div className="grid2">
              <div className="field"><label>Дата доставки</label>
                <input type="date" value={(form.delivery_date || "").slice(0, 10)} onChange={e => setForm({ ...form, delivery_date: e.target.value })} /></div>
              <div className="field"><label>Оплата</label>
                <input value={form.payment_method} onChange={e => setForm({ ...form, payment_method: e.target.value })} /></div>
            </div>
            <div className="field"><label>Примітки</label>
              <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
            <button className="btn secondary" disabled={busy} onClick={() => save({
              delivery_date: form.delivery_date,
              payment_method: form.payment_method,
              notes: form.notes,
            })}>Зберегти деталі</button>

            <div className="section-title">Позиції ({items.length})</div>
            {items.map(it => (
              <div key={it.row} className="panel" style={{ boxShadow: "none", padding: 12 }}>
                <div style={{ fontWeight: 700 }}>{it.basket_model ? it.basket_model + " · " : ""}{it.basket_type || "Кошик"} · {it.construction}</div>
                <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
                  {it.size_w || "—"}×{it.size_h || "—"}×{it.size_d || "—"} мм · {it.quantity} шт · {it.color} · {it.pattern}
                </div>
                <div style={{ marginTop: 6, fontSize: 13 }}>{money(it.revenue)} · маржа {pct(it.margin_pct)}</div>
              </div>
            ))}
            {error && <div className="error">{error}</div>}
          </div>
        </div>
      );
    }

    // Ручне внесення замовлення: телефон, Instagram, повторний клієнт — усе, що не
    // прийшло через онлайн-форму. Пише той самий рядок таблиці, що й форма.
    function NewOrderDrawer({ token, onClose, onCreated }) {
      const [form, setForm] = useState({
        client: "", phone: "", contact_method: "phone", contact_telegram: "", contact_email: "",
        city: "", source: "Телефон",
        basket_model: "", basket_type: "", construction_type: "", color: "", pattern: "",
        has_cover: false, bracket_length: "", vibro_pads: false,
        size_w: "", size_h: "", size_d: "", quantity: "1",
        cost_total: "", price_total: "",
        transport: "", delivery_address: "", delivery_date: "", payment_method: "", notes: "",
      });
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState("");

      const model = CATALOG_MODELS_CRM.find(m => m.id === form.basket_model);
      const isBracket = !!(model && model.bracket);
      const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

      function pickModel(id) {
        const m = CATALOG_MODELS_CRM.find(x => x.id === id);
        setForm(f => ({
          ...f,
          basket_model: id,
          construction_type: m ? m.construction + " · " + m.id : "",
          // Кришка підставляється з каталогу: у AVL-06/07/08 вона передбачена конструкцією,
          // у AVL-02 — неможлива. Інакше ціна порахувалась би без неї.
          has_cover: !!(m && m.defaultCover),
          ...(m && m.bracket
            ? { size_w: "", size_h: "", size_d: "", pattern: "", has_cover: false }
            : { bracket_length: "", vibro_pads: false }),
        }));
      }

      const revenue = Number(form.price_total) || 0;
      const profit = revenue - (Number(form.cost_total) || 0);
      const marginPct = revenue ? Math.round((profit / revenue) * 1000) / 10 : 0;

      async function submit() {
        setError("");
        if (!form.client.trim()) return setError("Вкажіть імʼя клієнта");
        if (!form.phone.trim() && !form.contact_telegram.trim() && !form.contact_email.trim()) {
          return setError("Вкажіть телефон, Telegram або e-mail");
        }
        setBusy(true);
        try {
          const res = await api("/api/admin/orders", {
            method: "POST",
            token,
            body: {
              order: {
                ...form,
                product_type: isBracket ? "bracket" : "basket",
                basket_model_name: model ? model.name : form.basket_model,
                quantity: Number(form.quantity) || 1,
              },
            },
          });
          onCreated(res.order_number || "");
        } catch (e) {
          setError(e.message || "Не вдалося створити замовлення");
        } finally {
          setBusy(false);
        }
      }

      return (
        <div className="drawer-backdrop" onClick={onClose}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <header>
              <div>
                <h2>Нове замовлення</h2>
                <div className="meta" style={{ color: "var(--muted)", marginTop: 4 }}>
                  Ручне внесення — номер ORD присвоїться автоматично
                </div>
              </div>
              <button className="btn ghost" onClick={onClose}>Закрити</button>
            </header>

            <div className="section-title" style={{ marginTop: 0 }}>Клієнт</div>
            <div className="grid2">
              <div className="field"><label>Імʼя та прізвище *</label>
                <input value={form.client} onChange={e => set("client", e.target.value)} placeholder="Напр. Олег Петренко" /></div>
              <div className="field"><label>Місто</label>
                <input value={form.city} onChange={e => set("city", e.target.value)} /></div>
              <div className="field"><label>Телефон</label>
                <input value={form.phone} onChange={e => set("phone", e.target.value)} placeholder="+380 __ ___ __ __" /></div>
              <div className="field"><label>Спосіб зв'язку</label>
                <select value={form.contact_method} onChange={e => set("contact_method", e.target.value)}>
                  <option value="phone">Телефон</option>
                  <option value="viber">Viber</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="telegram">Telegram</option>
                  <option value="email">E-mail</option>
                </select>
              </div>
              <div className="field"><label>Telegram</label>
                <input value={form.contact_telegram} onChange={e => set("contact_telegram", e.target.value)} placeholder="@username" /></div>
              <div className="field"><label>E-mail</label>
                <input value={form.contact_email} onChange={e => set("contact_email", e.target.value)} /></div>
              <div className="field"><label>Джерело замовлення</label>
                <select value={form.source} onChange={e => set("source", e.target.value)}>
                  {MANUAL_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div className="section-title">Товар</div>
            <div className="grid2">
              <div className="field"><label>Модель</label>
                <select value={form.basket_model} onChange={e => pickModel(e.target.value)}>
                  <option value="">— оберіть модель —</option>
                  {CATALOG_MODELS_CRM.map(m => <option key={m.id} value={m.id}>{m.id} · {m.name}</option>)}
                </select>
              </div>
              <div className="field"><label>Конструкція</label>
                <input value={form.construction_type} onChange={e => set("construction_type", e.target.value)} /></div>
              <div className="field"><label>Колір</label>
                <input value={form.color} onChange={e => set("color", e.target.value)} placeholder="RAL 7016" /></div>
              {!isBracket && (
                <div className="field"><label>Візерунок</label>
                  <input value={form.pattern} onChange={e => set("pattern", e.target.value)} placeholder="K1 … K10" /></div>
              )}
              {isBracket && (
                <div className="field"><label>Довжина кронштейнів</label>
                  <input list="bracket-lengths" value={form.bracket_length} onChange={e => set("bracket_length", e.target.value)} placeholder="600 мм" />
                  <datalist id="bracket-lengths">{BRACKET_LENGTHS.map(l => <option key={l} value={l} />)}</datalist>
                </div>
              )}
              <div className="field"><label>Тип (за потреби)</label>
                <input value={form.basket_type} onChange={e => set("basket_type", e.target.value)} placeholder="Стандарт / Антивандальний" /></div>
              <div className="field"><label>{isBracket ? "Кількість, компл." : "Кількість, шт."}</label>
                <input type="number" min="1" value={form.quantity} onChange={e => set("quantity", e.target.value)} /></div>
            </div>
            {!isBracket && (
              <div className="grid2" style={{ marginTop: 8 }}>
                <div className="field"><label>Ширина, мм</label>
                  <input type="number" value={form.size_w} onChange={e => set("size_w", e.target.value)} /></div>
                <div className="field"><label>Висота, мм</label>
                  <input type="number" value={form.size_h} onChange={e => set("size_h", e.target.value)} /></div>
                <div className="field"><label>Глибина, мм</label>
                  <input type="number" value={form.size_d} onChange={e => set("size_d", e.target.value)} /></div>
              </div>
            )}
            <div className="quick-actions" style={{ marginTop: 8 }}>
              {!isBracket && model && model.coverAllowed === false && (
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Для цієї моделі верхня кришка не передбачена.</span>
              )}
              {!isBracket && !(model && model.coverAllowed === false) && (
                <button type="button" className={form.has_cover ? "active" : ""} onClick={() => set("has_cover", !form.has_cover)}>
                  {form.has_cover ? "✓ З верхньою кришкою" : "Верхня кришка"}
                </button>
              )}
              {isBracket && (
                <button type="button" className={form.vibro_pads ? "active" : ""} onClick={() => set("vibro_pads", !form.vibro_pads)}>
                  {form.vibro_pads ? "✓ З віброподушками" : "Віброподушки"}
                </button>
              )}
            </div>

            <div className="section-title">Гроші</div>
            <p style={{ margin: "0 0 10px", color: "var(--muted)", fontSize: 13, lineHeight: 1.4 }}>
              Порожні поля + вказані розміри = ціна порахується тією ж формулою, що для онлайн-заявок.
            </p>
            <div className="grid2">
              <div className="field"><label>Собівартість, ₴</label>
                <input type="number" value={form.cost_total} onChange={e => set("cost_total", e.target.value)} /></div>
              <div className="field"><label>Ціна продажу (виручка), ₴</label>
                <input type="number" value={form.price_total} onChange={e => set("price_total", e.target.value)} /></div>
              <div className="field"><label>Маржа (авто)</label>
                <input disabled value={money(profit) + " · " + pct(marginPct)} /></div>
            </div>

            <div className="section-title">Доставка та оплата</div>
            <div className="grid2">
              <div className="field"><label>Спосіб доставки</label>
                <input value={form.transport} onChange={e => set("transport", e.target.value)} placeholder="Нова пошта / Самовивіз / Адресна" /></div>
              <div className="field"><label>Адреса / відділення</label>
                <input value={form.delivery_address} onChange={e => set("delivery_address", e.target.value)} /></div>
              <div className="field"><label>Дата доставки</label>
                <input type="date" value={form.delivery_date} onChange={e => set("delivery_date", e.target.value)} /></div>
              <div className="field"><label>Оплата</label>
                <select value={form.payment_method} onChange={e => set("payment_method", e.target.value)}>
                  <option value="">— не вказано —</option>
                  <option value="На карту">На карту</option>
                  <option value="На рахунок ФО-П">На рахунок ФО-П</option>
                  <option value="На рахунок ТОВ">На рахунок ТОВ</option>
                  <option value="Готівка">Готівка</option>
                  <option value="Уточнити з менеджером">Уточнити з менеджером</option>
                </select>
              </div>
            </div>
            <div className="field"><label>Примітки</label>
              <textarea value={form.notes} onChange={e => set("notes", e.target.value)} /></div>

            {error && <div className="error">{error}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btn" disabled={busy} onClick={submit}>
                {busy ? "Створення…" : "Створити замовлення"}
              </button>
              <button className="btn ghost" disabled={busy} onClick={onClose}>Скасувати</button>
            </div>
          </div>
        </div>
      );
    }

    function OrdersView({ token, groups, setGroups, loading, error, setError, refreshOrders, onOpenOrder }) {
      const [q, setQ] = useState("");
      const [status, setStatus] = useState("");
      const [view, setView] = useState("kanban");
      const [dragOver, setDragOver] = useState("");
      const [moving, setMoving] = useState("");
      const [creating, setCreating] = useState(false);
      const dragOrderRef = useRef("");
      const skipClickRef = useRef(false);

      async function load() {
        setError("");
        try {
          await refreshOrders({ q, status });
        } catch (e) {
          setError(e.message);
        }
      }

      useEffect(() => {
        const t = setTimeout(() => load(), 300);
        return () => clearTimeout(t);
      }, [token, q, status]);

      async function moveToStatus(orderNumber, newStatus) {
        const current = groups.find(g => g.order_number === orderNumber);
        if (!current || current.status === newStatus) return;
        if (!confirmStatusChange(current.status, newStatus)) return;
        const prev = groups;
        setMoving(orderNumber);
        setGroups(list => list.map(g => g.order_number === orderNumber ? { ...g, status: newStatus } : g));
        try {
          await api("/api/admin/order", {
            method: "PATCH",
            token,
            body: { order_number: orderNumber, patch: { status: newStatus } },
          });
        } catch (e) {
          setGroups(prev);
          setError(e.message || "Не вдалося змінити статус");
        } finally {
          setMoving("");
        }
      }

      const byStatus = useMemo(() => {
        const map = {};
        STATUSES.forEach(s => { map[s] = { items: [], revenue: 0, profit: 0 }; });
        groups.forEach(g => {
          if (!map[g.status]) map[g.status] = { items: [], revenue: 0, profit: 0 };
          map[g.status].items.push(g);
          if (g.status !== "Скасовано") {
            map[g.status].revenue += Number(g.revenue) || 0;
            map[g.status].profit += Number(g.profit) || 0;
          }
        });
        return map;
      }, [groups]);

      const grand = useMemo(() => {
        let revenue = 0, profit = 0, count = 0;
        groups.forEach(g => {
          if (g.status === "Скасовано") return;
          count += 1;
          revenue += Number(g.revenue) || 0;
          profit += Number(g.profit) || 0;
        });
        return { revenue, profit, count };
      }, [groups]);

      return (
        <div>
          <div className="toolbar">
            <input type="search" placeholder="Пошук: імʼя, телефон, ORD-…" value={q} onChange={e => setQ(e.target.value)} />
            <select value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">Усі статуси</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className="btn secondary" onClick={load} disabled={!!moving}>Оновити</button>
            <button className="btn" onClick={() => setCreating(true)}>+ Нове замовлення</button>
            <div className="view-toggle" style={{ marginLeft: "auto" }}>
              <button className={view === "kanban" ? "active" : ""} onClick={() => setView("kanban")}>Воронка</button>
              <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>Список</button>
            </div>
          </div>
          {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
          {creating && (
            <NewOrderDrawer
              token={token}
              onClose={() => setCreating(false)}
              onCreated={async (num) => {
                setCreating(false);
                await load();
                if (num) onOpenOrder(num);
              }}
            />
          )}
          {loading && <div className="empty">Завантаження замовлень…</div>}
          {!loading && !groups.length && <div className="empty">Замовлень не знайдено</div>}

          {!loading && groups.length > 0 && (
            <div className="orders-totals">
              <div className="ot-item">
                <div className="ot-label">Замовлень (без скасованих)</div>
                <div className="ot-value">{grand.count}</div>
              </div>
              <div className="ot-item">
                <div className="ot-label">Загальна сума замовлень</div>
                <div className="ot-value">{money(grand.revenue)}</div>
                <div className="ot-sub">Маржа: {money(grand.profit)}</div>
              </div>
              {view === "kanban" && (
                <div style={{ marginLeft: "auto", alignSelf: "flex-start" }}>
                  <InfoTip
                    desktopText="Перетягніть картку в інший стовпчик, щоб змінити статус."
                    mobileText="Гортайте стовпчики вбік. Статус змінюйте списком на картці."
                  />
                </div>
              )}
            </div>
          )}

          {!loading && view === "kanban" && (
            <div className="kanban">
              {STATUSES.map(s => (
                <div
                  className={"col " + statusClass(s) + (dragOver === s ? " drag-over" : "")}
                  key={s}
                  onDragOver={e => { e.preventDefault(); setDragOver(s); }}
                  onDragLeave={() => setDragOver(cur => cur === s ? "" : cur)}
                  onDrop={e => {
                    e.preventDefault();
                    setDragOver("");
                    const num = e.dataTransfer.getData("text/order") || dragOrderRef.current;
                    if (num) moveToStatus(num, s);
                  }}
                >
                  <h3>
                    <div className="col-title">
                      <span>{s}</span>
                      <span>{byStatus[s].items.length}</span>
                    </div>
                    <div className="col-sum">{s === "Скасовано" ? "—" : money(byStatus[s].revenue)}</div>
                    <div className="col-margin">{s === "Скасовано" ? "" : ("Маржа: " + money(byStatus[s].profit))}</div>
                  </h3>
                  <div className={"col-body" + (dragOver === s ? " drag-over" : "")}>
                    {byStatus[s].items.map(g => (
                      <div
                        key={g.order_number}
                        role="button"
                        tabIndex={0}
                        draggable
                        className={"card " + statusClass(g.status) + (moving === g.order_number ? " dragging" : "")}
                        onDragStart={e => {
                          dragOrderRef.current = g.order_number;
                          e.dataTransfer.setData("text/order", g.order_number);
                          e.dataTransfer.effectAllowed = "move";
                          skipClickRef.current = false;
                        }}
                        onDragEnd={() => {
                          dragOrderRef.current = "";
                          setDragOver("");
                          skipClickRef.current = true;
                          setTimeout(() => { skipClickRef.current = false; }, 120);
                        }}
                        onKeyDown={e => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onOpenOrder(g.order_number);
                          }
                        }}
                        onClick={() => {
                          if (skipClickRef.current || moving) return;
                          onOpenOrder(g.order_number);
                        }}
                      >
                        <div className="num">{g.order_number}</div>
                        <div className="meta">{g.client}<br /><ContactLinks order={g} onClickStop /><br />{g.city || "—"}</div>
                        <div className="money">{money(g.revenue)}</div>
                        <div className="meta">Маржа: {money(g.profit)}</div>
                        <select
                          className="card-status mobile-only"
                          value={g.status}
                          disabled={moving === g.order_number}
                          onClick={e => e.stopPropagation()}
                          onMouseDown={e => e.stopPropagation()}
                          onTouchStart={e => e.stopPropagation()}
                          onChange={e => {
                            e.stopPropagation();
                            moveToStatus(g.order_number, e.target.value);
                          }}
                        >
                          {STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && view === "list" && (
            <div className="list">
              {groups.map(g => (
                <div key={g.order_number} className="row-card" onClick={() => onOpenOrder(g.order_number)}>
                  <div><strong>{g.order_number}</strong><div style={{ color: "var(--muted)", fontSize: 12 }}>{formatDateShort(g.created_at)}</div></div>
                  <div>{g.client}<div style={{ marginTop: 4 }}><ContactLinks order={g} onClickStop /></div></div>
                  <div><StatusChip status={g.status} /></div>
                  <div>{money(g.revenue)}</div>
                  <div>{money(g.profit)}</div>
                  <div>{pct(g.margin_pct)}</div>
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>{g.source}</div>
                </div>
              ))}
            </div>
          )}

        </div>
      );
    }

    function shortMoney(v) {
      const n = Number(v) || 0;
      if (Math.abs(n) >= 1000) {
        const k = n / 1000;
        return (Math.abs(k) >= 10 ? Math.round(k) : Math.round(k * 10) / 10) + " тис.";
      }
      return money(n);
    }

    const STATUS_CHART_COLORS = {
      "Нове": "#c9a227",
      "В роботі": "#3b82f6",
      "Готове": "#14b8a6",
      "Відправлено": "#a855f7",
      "Завершено": "#22c55e",
      "Скасовано": "#9ca3af",
    };

    function MonthlyBarsChart({ monthly }) {
      const rows = (monthly || []).slice().reverse();
      const max = Math.max(1, ...rows.map(m => Math.max(Number(m.revenue) || 0, Number(m.profit) || 0)));
      if (!rows.length) return <div className="empty">Немає помісячних даних</div>;
      return (
        <div className="chart-wrap">
          <div className="dual-bars" data-count={rows.length}>
            {rows.map(m => {
              const rev = Number(m.revenue) || 0;
              const mar = Number(m.profit) || 0;
              const hRev = Math.max(3, Math.round((rev / max) * 100));
              const hMar = Math.max(3, Math.round((mar / max) * 100));
              return (
                <div className="dual-col" key={m.month} title={"Виручка " + money(rev) + " · Маржа " + money(mar)}>
                  <div className="dual-tip">{shortMoney(rev)}</div>
                  <div className="dual-pair">
                    <div className="dual-stem rev" style={{ height: hRev }} />
                    <div className="dual-stem mar" style={{ height: hMar }} />
                  </div>
                  <div className="dual-lbl">{m.month}</div>
                </div>
              );
            })}
          </div>
          <div className="chart-legend">
            <span><span className="chart-swatch" style={{ background: "#526058" }} />Виручка</span>
            <span><span className="chart-swatch" style={{ background: "#1b7a4a" }} />Маржа</span>
          </div>
        </div>
      );
    }

    function StatusBarsChart({ byStatus }) {
      const max = Math.max(1, ...STATUSES.map(s => (byStatus && byStatus[s]) || 0));
      const total = STATUSES.reduce((s, name) => s + ((byStatus && byStatus[name]) || 0), 0);
      return (
        <div className="chart-wrap status-chart">
          <div className="status-list">
            {STATUSES.map(s => {
              const n = (byStatus && byStatus[s]) || 0;
              const pct = n ? Math.max(6, Math.round((n / max) * 100)) : 0;
              return (
                <div className="status-row" key={s}>
                  <div className="name">{s}</div>
                  <div className="track">
                    <div className="fill" style={{
                      width: pct + "%",
                      background: n ? STATUS_CHART_COLORS[s] : "transparent",
                    }} />
                  </div>
                  <div className="count">{n}</div>
                </div>
              );
            })}
          </div>
          <div className="chart-legend">
            <span>Усього карток: <strong style={{ color: "var(--ink)" }}>{total}</strong></span>
          </div>
        </div>
      );
    }

    function FinanceBarsChart({ revenue, cost, profit, commission, expenses }) {
      const rev = Number(revenue) || 0;
      const cst = Number(cost) || 0;
      const mar = Number(profit) || 0;
      const com = Number(commission) || 0;
      const exp = Number(expenses) || 0;
      const base = rev > 0 ? rev : Math.max(cst + mar, 1);
      const costPct = Math.min(100, Math.round((cst / base) * 1000) / 10);
      const marPct = Math.min(100 - costPct, Math.round((mar / base) * 1000) / 10);
      return (
        <div className="chart-wrap stack-block">
          <div className="stack-bar" title={"Виручка " + money(rev)}>
              {cst > 0 && (
                <div className="stack-seg" style={{ width: costPct + "%", background: "#6b7280" }}>
                  {costPct >= 18 ? "Собівартість" : ""}
                </div>
              )}
              {mar > 0 && (
                <div className="stack-seg" style={{ width: marPct + "%", background: "#1b7a4a" }}>
                  {marPct >= 14 ? "Маржа" : ""}
                </div>
              )}
              {rev <= 0 && <div className="stack-seg" style={{ width: "100%", background: "#d1d5db", color: "var(--muted)" }}>Немає даних</div>}
          </div>
          <div className="stack-meta">
            <div className="stack-row">
              <span className="chart-swatch" style={{ background: "#526058" }} />
              <span>Виручка</span>
              <span className="val">{money(rev)}</span>
            </div>
            <div className="stack-row">
              <span className="chart-swatch" style={{ background: "#6b7280" }} />
              <span>Собівартість ({costPct}%)</span>
              <span className="val">{money(cst)}</span>
            </div>
            <div className="stack-row">
              <span className="chart-swatch" style={{ background: "#1b7a4a" }} />
              <span>Маржа ({marPct}%)</span>
              <span className="val">{money(mar)}</span>
            </div>
            <div className="stack-row">
              <span className="chart-swatch" style={{ background: "#8f7340" }} />
              <span>Комісії</span>
              <span className="val">{money(com)}</span>
            </div>
            <div className="stack-row">
              <span className="chart-swatch" style={{ background: "#b42318" }} />
              <span>Витрати</span>
              <span className="val">{money(exp)}</span>
            </div>
          </div>
        </div>
      );
    }

    function MarginSplitChart({ received, debt }) {
      const a = Math.max(0, Number(received) || 0);
      const b = Math.max(0, Number(debt) || 0);
      const total = a + b;
      const pctReceived = total ? Math.round((a / total) * 100) : 0;
      const r = 54;
      const c = 2 * Math.PI * r;
      const aLen = total ? (a / total) * c : 0;
      const bLen = total ? (b / total) * c : 0;
      return (
        <div className="chart-wrap donut-wrap">
          <div className="donut">
            <svg viewBox="0 0 140 140" aria-hidden="true">
              <circle cx="70" cy="70" r={r} fill="none" stroke="#e8ebed" strokeWidth="16" />
              {total > 0 && a > 0 && (
                <circle
                  cx="70" cy="70" r={r} fill="none" stroke="#1b7a4a" strokeWidth="16"
                  strokeDasharray={`${aLen} ${c - aLen}`}
                  strokeDashoffset="0"
                  strokeLinecap="butt"
                />
              )}
              {total > 0 && b > 0 && (
                <circle
                  cx="70" cy="70" r={r} fill="none" stroke="#9a6700" strokeWidth="16"
                  strokeDasharray={`${bLen} ${c - bLen}`}
                  strokeDashoffset={-aLen}
                  strokeLinecap="butt"
                />
              )}
            </svg>
            <div className="donut-center">
              <strong>{total ? pctReceived + "%" : "—"}</strong>
              <span>отримано</span>
            </div>
          </div>
          <div className="donut-stats">
            <div className="donut-stat">
              <div className="lab" style={{ color: "#1b7a4a" }}>Отримано</div>
              <div className="num">{money(a)}</div>
            </div>
            <div className="donut-stat">
              <div className="lab" style={{ color: "#9a6700" }}>До отримання</div>
              <div className="num">{money(b)}</div>
            </div>
            <div className="donut-stat">
              <div className="lab">Разом</div>
              <div className="num">{money(total)}</div>
            </div>
          </div>
        </div>
      );
    }

    function DashboardView({ token, groups, expenses, loading, error, refreshData, onOpenOrder }) {
      const [period, setPeriod] = useState("all");

      const filteredGroups = useMemo(
        () => (groups || []).filter(g => inPeriod(g, period)),
        [groups, period]
      );
      const filteredExpenses = useMemo(() => {
        if (period === "all") return expenses || [];
        const range = periodRange(period);
        return (expenses || []).filter(ex => {
          const d = parseUaDateTime(ex.date);
          if (!d) return false;
          return d >= range.start && d <= range.end;
        });
      }, [expenses, period]);

      const t = useMemo(() => {
        const expSum = filteredExpenses.reduce((s, ex) => s + (Number(ex.amount) || 0), 0);
        return totalsFromGroups(filteredGroups, expSum);
      }, [filteredGroups, filteredExpenses]);

      const monthly = useMemo(
        () => monthlyFromGroups(filteredGroups, filteredExpenses),
        [filteredGroups, filteredExpenses]
      );

      const reminders = useMemo(() => buildReminders(groups), [groups]);

      if (error) return <div className="error">{error}</div>;
      if (loading) return <div className="empty">Завантаження зведення…</div>;

      const periodLabels = [
        { id: "all", label: "Увесь час" },
        { id: "month", label: "Цей місяць" },
        { id: "30d", label: "30 днів" },
        { id: "7d", label: "7 днів" },
      ];

      return (
        <div>
          <div className="toolbar" style={{ marginBottom: 14 }}>
            <div className="period-toggle">
              {periodLabels.map(p => (
                <button key={p.id} type="button" className={period === p.id ? "active" : ""} onClick={() => setPeriod(p.id)}>
                  {p.label}
                </button>
              ))}
            </div>
            <button className="btn secondary" onClick={refreshData}>Оновити</button>
          </div>

          {reminders.length > 0 && (
            <div className="panel">
              <h2>Що зробити сьогодні</h2>
              <div className="remind-list">
                {reminders.map(r => (
                  <button key={r.key} type="button" className="remind-item" onClick={() => onOpenOrder(r.order_number)}>
                    <div>
                      <div className="title">{r.title}</div>
                      <div className="desc">{r.desc}</div>
                    </div>
                    <span className={"tag " + r.tagClass}>{r.tag}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="kpi-grid">
            <div className="kpi">
              <div className="label">Виручка</div>
              <div className="value">{money(t.revenue)}</div>
              <div className="sub">Маржа: {money(t.profit)}</div>
            </div>
            <div className="kpi"><div className="label">Собівартість</div><div className="value">{money(t.cost)}</div></div>
            <div className="kpi"><div className="label">Валовий прибуток</div><div className="value">{money(t.profit)}</div></div>
            <div className="kpi"><div className="label">Маржа %</div><div className="value">{pct(t.margin_pct)}</div></div>
            <div className="kpi"><div className="label">Маржа до отримання</div><div className="value">{money(t.margin_debt)}</div></div>
            <div className="kpi"><div className="label">Маржу отримано</div><div className="value">{money(t.margin_received)}</div></div>
            <div className="kpi"><div className="label">Комісії + витрати</div><div className="value">{money((t.commission || 0) + (t.expenses || 0))}</div></div>
            <div className="kpi"><div className="label">Чистий факт</div><div className="value">{money(t.net_fact)}</div></div>
          </div>

          <div className="charts-grid">
            <div className="panel">
              <div className="panel-head">
                <h2>Виручка і маржа по місяцях</h2>
                <InfoTip text="Сірий стовпчик — виручка, зелений — маржа за місяць." />
              </div>
              <MonthlyBarsChart monthly={monthly} />
            </div>
            <div className="panel">
              <div className="panel-head">
                <h2>Замовлення по статусах</h2>
                <InfoTip text="Скільки замовлень у кожному статусі. Довша смужка — більше замовлень." />
              </div>
              <StatusBarsChart byStatus={t.by_status} />
            </div>
            <div className="panel">
              <div className="panel-head">
                <h2>Структура фінансів</h2>
                <InfoTip text="Як виручка ділиться на собівартість і маржу, плюс комісії та витрати." />
              </div>
              <FinanceBarsChart
                revenue={t.revenue}
                cost={t.cost}
                profit={t.profit}
                commission={t.commission}
                expenses={t.expenses}
              />
            </div>
            <div className="panel">
              <div className="panel-head">
                <h2>Маржа: отримано / борг</h2>
                <InfoTip text="Скільки маржі вже отримано і скільки ще має надійти від підрядника." />
              </div>
              <MarginSplitChart received={t.margin_received} debt={t.margin_debt} />
            </div>
          </div>

          <div className="panel">
            <h2>Помісячно</h2>
            <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Місяць</th><th>Виручка</th><th>Собівартість</th><th>Валовий</th><th>Маржа %</th>
                  <th>Отримано</th><th>Борг</th><th>Комісії</th><th>Витрати</th><th>Чистий</th>
                </tr>
              </thead>
              <tbody>
                {(monthly || []).map(m => (
                  <tr key={m.month}>
                    <td>{m.month}</td>
                    <td>{money(m.revenue)}</td>
                    <td>{money(m.cost)}</td>
                    <td>{money(m.profit)}</td>
                    <td>{pct(m.margin_pct)}</td>
                    <td>{money(m.margin_received)}</td>
                    <td>{money(m.margin_debt)}</td>
                    <td>{money(m.commission)}</td>
                    <td>{money(m.expenses)}</td>
                    <td>{money(m.net_fact)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      );
    }

    function PartnersView({ token }) {
      const [partners, setPartners] = useState([]);
      const [payouts, setPayouts] = useState([]);
      const [error, setError] = useState("");
      const [form, setForm] = useState({ code: "", name: "", type: "ОСББ", contact: "", rate: 150 });
      const [payout, setPayout] = useState({ code: "", amount: "", method: "Переказ", note: "" });

      async function load() {
        const [p, pay] = await Promise.all([
          api("/api/admin/partners", { token }),
          api("/api/admin/payouts", { token }),
        ]);
        setPartners(p.partners || []);
        setPayouts(pay.payouts || []);
      }
      useEffect(() => { load().catch(e => setError(e.message)); }, [token]);

      return (
        <div>
          {error && <div className="error">{error}</div>}
          <div className="panel">
            <h2>Партнери / дропшипери</h2>
            <div className="grid2">
              <div className="field"><label>КОД</label><input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="OSBB-Lvivska12" /></div>
              <div className="field"><label>Назва</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <div className="field"><label>Тип</label><input value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} /></div>
              <div className="field"><label>Контакт</label><input value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} /></div>
              <div className="field"><label>Ставка за кошик, ₴</label><input type="number" value={form.rate} onChange={e => setForm({ ...form, rate: e.target.value })} /></div>
            </div>
            <button className="btn" onClick={async () => {
              try {
                await api("/api/admin/partners", { method: "POST", token, body: { ...form, rate: Number(form.rate) || 0 } });
                setForm({ code: "", name: "", type: "ОСББ", contact: "", rate: 150 });
                await load();
              } catch (e) { setError(e.message); }
            }}>Зберегти партнера</button>
            <div className="table-scroll">
            <table style={{ marginTop: 16 }}>
              <thead><tr><th>КОД</th><th>Назва</th><th>Ставка</th><th>Продано</th><th>Нараховано</th><th>Виплачено</th><th>Залишок</th></tr></thead>
              <tbody>
                {partners.map(p => (
                  <tr key={p.code}>
                    <td>{p.code}</td><td>{p.name}<div style={{ color: "var(--muted)", fontSize: 12 }}>{p.contact}</div></td>
                    <td>{money(p.rate)}</td><td>{p.sold}</td><td>{money(p.accrued)}</td><td>{money(p.paid)}</td><td>{money(p.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>

          <div className="panel">
            <h2>Виплата партнеру</h2>
            <div className="grid2">
              <div className="field"><label>КОД</label>
                <select value={payout.code} onChange={e => setPayout({ ...payout, code: e.target.value })}>
                  <option value="">Оберіть</option>
                  {partners.map(p => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}
                </select>
              </div>
              <div className="field"><label>Сума, ₴</label><input type="number" value={payout.amount} onChange={e => setPayout({ ...payout, amount: e.target.value })} /></div>
              <div className="field"><label>Спосіб</label><input value={payout.method} onChange={e => setPayout({ ...payout, method: e.target.value })} /></div>
              <div className="field"><label>Примітка</label><input value={payout.note} onChange={e => setPayout({ ...payout, note: e.target.value })} /></div>
            </div>
            <button className="btn secondary" onClick={async () => {
              try {
                await api("/api/admin/payouts", { method: "POST", token, body: { ...payout, amount: Number(payout.amount) } });
                setPayout({ code: "", amount: "", method: "Переказ", note: "" });
                await load();
              } catch (e) { setError(e.message); }
            }}>Записати виплату</button>
            <div className="table-scroll">
            <table style={{ marginTop: 16 }}>
              <thead><tr><th>Дата</th><th>КОД</th><th>Назва</th><th>Сума</th><th>Спосіб</th><th>Примітка</th></tr></thead>
              <tbody>
                {payouts.slice(0, 30).map(p => (
                  <tr key={p.row}><td>{formatDateShort(p.date)}</td><td>{p.code}</td><td>{p.name}</td><td>{money(p.amount)}</td><td>{p.method}</td><td>{p.note}</td></tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      );
    }

    function ExpensesView({ token, expenses, refreshExpenses }) {
      const [error, setError] = useState("");
      const [editRow, setEditRow] = useState(null);
      const [editForm, setEditForm] = useState(null);
      const [form, setForm] = useState({
        date: new Date().toISOString().slice(0, 10),
        category: "Реклама / маркетинг",
        description: "",
        amount: "",
        note: "",
      });

      async function load() {
        await refreshExpenses();
      }

      function startEdit(ex) {
        setEditRow(ex.row);
        setEditForm({
          date: String(ex.date || "").slice(0, 10),
          category: ex.category || "",
          description: ex.description || "",
          amount: ex.amount ?? "",
          note: ex.note || "",
        });
      }

      return (
        <div className="panel">
          <h2>Витрати (реклама та інше)</h2>
          {error && <div className="error">{error}</div>}
          <div className="grid2">
            <div className="field"><label>Дата</label><input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
            <div className="field"><label>Категорія</label>
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                {EXPENSE_CATS.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="field"><label>Опис</label><input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
            <div className="field"><label>Сума, ₴</label><input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
            <div className="field"><label>Примітка</label><input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></div>
          </div>
          <button className="btn" onClick={async () => {
            try {
              await api("/api/admin/expenses", { method: "POST", token, body: { ...form, amount: Number(form.amount) } });
              setForm(f => ({ ...f, description: "", amount: "", note: "" }));
              await load();
            } catch (e) { setError(e.message); }
          }}>Додати витрату</button>
          <div className="table-scroll">
          <table style={{ marginTop: 16 }}>
            <thead><tr><th>Дата</th><th>Категорія</th><th>Опис</th><th>Сума</th><th>Примітка</th></tr></thead>
            <tbody>
              {expenses.map(ex => (
                <tr key={ex.row}>
                  {editRow === ex.row ? (
                    <>
                      <td><input type="date" value={editForm.date} onChange={e => setEditForm({ ...editForm, date: e.target.value })} /></td>
                      <td>
                        <select value={editForm.category} onChange={e => setEditForm({ ...editForm, category: e.target.value })}>
                          {EXPENSE_CATS.map(c => <option key={c}>{c}</option>)}
                        </select>
                      </td>
                      <td><input value={editForm.description} onChange={e => setEditForm({ ...editForm, description: e.target.value })} /></td>
                      <td><input type="number" value={editForm.amount} onChange={e => setEditForm({ ...editForm, amount: e.target.value })} /></td>
                      <td>
                        <input value={editForm.note} onChange={e => setEditForm({ ...editForm, note: e.target.value })} />
                        <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                          <button className="btn" type="button" onClick={async () => {
                            try {
                              await api("/api/admin/expenses", {
                                method: "PATCH",
                                token,
                                body: { row: ex.row, ...editForm, amount: Number(editForm.amount) },
                              });
                              setEditRow(null);
                              await load();
                            } catch (e) { setError(e.message); }
                          }}>Зберегти</button>
                          <button className="btn secondary" type="button" onClick={() => setEditRow(null)}>Скасувати</button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{formatDateShort(ex.date)}</td>
                      <td>{ex.category}</td>
                      <td>{ex.description}</td>
                      <td>{money(ex.amount)}</td>
                      <td>
                        {ex.note || "—"}
                        <button className="btn secondary" type="button" style={{ marginLeft: 8, padding: "4px 8px" }} onClick={() => startEdit(ex)}>Редагувати</button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      );
    }


    function ClientsView({ token, groups, loading, error, refreshOrders, onOpenOrder }) {
      const [q, setQ] = useState("");
      const [selected, setSelected] = useState(null);
      const clients = useMemo(() => buildClientsDirectory(groups), [groups]);
      const filtered = useMemo(() => {
        const needle = q.trim().toLowerCase();
        if (!needle) return clients;
        return clients.filter((c) => {
          const hay = (
            c.phone_key + " " + c.phone_display + " " + c.primary_name + " " +
            (c.aliases || []).join(" ") + " " + (c.cities || []).join(" ")
          ).toLowerCase();
          return hay.indexOf(needle) >= 0;
        });
      }, [clients, q]);

      return (
        <div>
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-head">
              <h2>Довідник клієнтів за телефоном</h2>
              <InfoTip text="Один номер = один клієнт. Основне імʼя — з найранішого замовлення. Якщо є інші написання, показується « / …» — наведіть, щоб побачити повний список." />
            </div>
            <div className="toolbar" style={{ marginBottom: 0 }}>
              <input type="search" placeholder="Пошук: телефон або імʼя…" value={q} onChange={e => setQ(e.target.value)} />
              <button className="btn secondary" onClick={() => refreshOrders({})}>Оновити</button>
              <span style={{ color: "var(--muted)", fontSize: 13 }}>{filtered.length} клієнтів</span>
            </div>
          </div>
          {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
          {loading && <div className="empty">Завантаження довідника…</div>}
          {!loading && !filtered.length && <div className="empty">Клієнтів не знайдено</div>}
          {!loading && !!filtered.length && (
            <div className="panel">
              <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Телефон</th>
                    <th>Імʼя (основне / інші)</th>
                    <th>Замовлень</th>
                    <th>Виручка</th>
                    <th>Міста</th>
                    <th>Останнє</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.phone_key} style={{ cursor: "pointer" }} onClick={() => setSelected(selected === c.phone_key ? null : c.phone_key)}>
                      <td className="phone-key" onClick={(e) => e.stopPropagation()}>
                        <ContactLinks order={c} />
                      </td>
                      <td>
                        <strong>{c.primary_name}</strong>
                        {!!c.aliases.length && (
                          <span
                            className="alias-more"
                            title={c.aliases.join(" / ")}
                            onClick={(e) => { e.stopPropagation(); alert(c.aliases.join(" / ")); }}
                          > / …</span>
                        )}
                      </td>
                      <td>{c.orders_count}</td>
                      <td>{money(c.revenue)}</td>
                      <td>{(c.cities || []).join(", ") || "—"}</td>
                      <td style={{ color: "var(--muted)", fontSize: 12 }}>{formatDateShort(c.last_order_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
          {selected && (() => {
            const c = clients.find((x) => x.phone_key === selected);
            if (!c) return null;
            return (
              <div className="panel">
                <h2>Замовлення · {c.primary_name}</h2>
                <p style={{ marginTop: 0, color: "var(--muted)", fontSize: 13 }}>
                  Контакт: <ContactLinks order={c} />
                  {!!c.aliases.length && <> · також: {c.aliases.join(" / ")}</>}
                </p>
                <div className="list">
                  {c.orders.map((g) => (
                    <div
                      key={g.order_number}
                      className="row-card"
                      style={{ gridTemplateColumns: "1.1fr 1fr 0.8fr 0.7fr", cursor: "pointer" }}
                      onClick={() => onOpenOrder(g.order_number)}
                    >
                      <div><strong>{g.order_number}</strong><div style={{ color: "var(--muted)", fontSize: 12 }}>{formatDateShort(g.created_at)}</div></div>
                      <div>{g.client || "—"}</div>
                      <div><StatusChip status={g.status} /></div>
                      <div>{money(g.revenue)}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      );
    }

    function App() {
      const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || "");
      const [tab, setTab] = useState("orders");
      const [groups, setGroups] = useState([]);
      const [expenses, setExpenses] = useState([]);
      const [dataLoading, setDataLoading] = useState(false);
      const [ordersError, setOrdersError] = useState("");
      const [sessionMsg, setSessionMsg] = useState("");
      const [selectedOrder, setSelectedOrder] = useState(null);

      function login(t) {
        sessionStorage.setItem(TOKEN_KEY, t);
        setToken(t);
        setSessionMsg("");
      }
      function logout(msg) {
        sessionStorage.removeItem(TOKEN_KEY);
        setToken("");
        setGroups([]);
        setExpenses([]);
        setSelectedOrder(null);
        if (msg) setSessionMsg(msg);
      }

      useEffect(() => {
        function onUnauthorized() { logout("Сесія закінчилась — увійдіть знову"); }
        window.addEventListener("admin-unauthorized", onUnauthorized);
        return () => window.removeEventListener("admin-unauthorized", onUnauthorized);
      }, []);

      async function refreshOrders(filters = {}) {
        if (!token) return;
        setDataLoading(true);
        setOrdersError("");
        try {
          const qs = new URLSearchParams();
          if (filters.q) qs.set("q", filters.q);
          if (filters.status) qs.set("status", filters.status);
          const suffix = qs.toString() ? ("?" + qs.toString()) : "";
          const data = await api("/api/admin/orders" + suffix, { token });
          setGroups(data.groups || []);
        } catch (e) {
          setOrdersError(e.message);
          throw e;
        } finally {
          setDataLoading(false);
        }
      }

      async function refreshExpenses() {
        if (!token) return;
        const data = await api("/api/admin/expenses", { token });
        setExpenses(data.expenses || []);
      }

      async function refreshData() {
        await Promise.all([refreshOrders({}), refreshExpenses()]);
      }

      function openOrder(num) {
        setSelectedOrder(num);
        window.location.hash = "order/" + encodeURIComponent(num);
      }
      function closeOrder() {
        setSelectedOrder(null);
        if (window.location.hash.startsWith("#order/")) {
          history.replaceState(null, "", window.location.pathname + window.location.search);
        }
      }

      useEffect(() => {
        if (!token) return;
        refreshData().catch(() => {});
        const m = window.location.hash.match(/^#order\/(.+)$/);
        if (m) {
          setSelectedOrder(decodeURIComponent(m[1]));
          setTab("orders");
        }
      }, [token]);

      if (!token) return (
        <>
          {sessionMsg && <div className="error" style={{ textAlign: "center", padding: 12 }}>{sessionMsg}</div>}
          <Login onLogin={login} />
        </>
      );

      return (
        <div className="app">
          <div className="top">
            <div className="brand">
              <img src="/images/avalon-logo-7016.svg" alt="Avalon" />
              <div>
                <strong>CRM</strong>
                <span>внутрішній кабінет</span>
              </div>
            </div>
            <nav className="nav">
              <button className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}>Замовлення</button>
              <button className={tab === "clients" ? "active" : ""} onClick={() => setTab("clients")}>Клієнти</button>
              <button className={tab === "dash" ? "active" : ""} onClick={() => setTab("dash")}>Зведення</button>
              <button className={tab === "partners" ? "active" : ""} onClick={() => setTab("partners")}>Партнери</button>
              <button className={tab === "expenses" ? "active" : ""} onClick={() => setTab("expenses")}>Витрати</button>
            </nav>
            <div className="top-actions">
              <a className="btn ghost" href="/" style={{ textDecoration: "none" }}>Форма</a>
              <button className="btn secondary" onClick={() => logout()}>Вийти</button>
            </div>
          </div>
          <main className="main">
            <div style={{ display: tab === "orders" ? "block" : "none" }}>
              <OrdersView
                token={token}
                groups={groups}
                setGroups={setGroups}
                loading={dataLoading}
                error={ordersError}
                setError={setOrdersError}
                refreshOrders={refreshOrders}
                onOpenOrder={openOrder}
              />
            </div>
            <div style={{ display: tab === "clients" ? "block" : "none" }}>
              <ClientsView
                token={token}
                groups={groups}
                loading={dataLoading}
                error={ordersError}
                refreshOrders={refreshOrders}
                onOpenOrder={openOrder}
              />
            </div>
            <div style={{ display: tab === "dash" ? "block" : "none" }}>
              <DashboardView
                token={token}
                groups={groups}
                expenses={expenses}
                loading={dataLoading}
                error={ordersError}
                refreshData={refreshData}
                onOpenOrder={openOrder}
              />
            </div>
            <div style={{ display: tab === "partners" ? "block" : "none" }}>
              <PartnersView token={token} />
            </div>
            <div style={{ display: tab === "expenses" ? "block" : "none" }}>
              <ExpensesView token={token} expenses={expenses} refreshExpenses={refreshExpenses} />
            </div>
          </main>
          {selectedOrder && (
            <OrderDrawer
              token={token}
              orderNumber={selectedOrder}
              onClose={closeOrder}
              onChanged={refreshData}
            />
          )}
        </div>
      );
    }

    createRoot(document.getElementById("root")).render(<App />);
