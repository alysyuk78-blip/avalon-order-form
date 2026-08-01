import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  ChartNoAxesColumnIncreasing,
  Check,
  ClipboardList,
  Columns3,
  FilePenLine,
  Handshake,
  Info,
  List,
  ListFilter,
  LogOut,
  PanelTopClose,
  PanelTopOpen,
  Plus,
  RefreshCw,
  Search,
  UsersRound,
  WalletCards,
  X,
} from 'lucide-react';
import finance from '../../lib/admin-finance.js';

    const { groupPaymentMetrics } = finance;

    const STATUSES = ["Нове","В роботі","Готове","Відправлено","Завершено","Скасовано"];
    const MISSING_STATUS = "Без статусу";
    const DISPLAY_STATUSES = [...STATUSES, MISSING_STATUS];
    const STATUS_CLASS = {
      "Нове": "st-new",
      "В роботі": "st-work",
      "Готове": "st-ready",
      "Відправлено": "st-ship",
      "Завершено": "st-done",
      "Скасовано": "st-cancel",
      [MISSING_STATUS]: "st-missing",
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
    const UNIT_SUGGESTIONS = ["шт.", "комп."];
    // Платежі: оплати клієнта та надходження маржі від підрядника.
    const PAYMENT_TYPES = ["Передоплата","Доплата","Оплата повністю","Маржа від підрядника","Повернення клієнту"];
    const PAYMENT_METHODS = ["Готівка","На карту","На рахунок ФО-П","На рахунок ТОВ","Накладений платіж","Інше"];
    const TOKEN_KEY = "avalon_admin_token";
    const CARDS_COLLAPSED_KEY = "avalon_admin_cards_collapsed_v1";
    const ORDERS_CACHE_KEY = "avalon_admin_orders_cache_v1";
    const ICON_COMPONENTS = {
      search: Search,
      filter: ListFilter,
      refresh: RefreshCw,
      plus: Plus,
      board: Columns3,
      list: List,
      orders: ClipboardList,
      clients: UsersRound,
      dashboard: ChartNoAxesColumnIncreasing,
      partners: Handshake,
      expenses: WalletCards,
      form: FilePenLine,
      logout: LogOut,
      info: Info,
      close: X,
      check: Check,
      collapseCards: PanelTopClose,
      expandCards: PanelTopOpen,
    };
    const NAV_ITEMS = [
      { id: "orders", label: "Замовлення", icon: "orders" },
      { id: "clients", label: "Клієнти", icon: "clients" },
      { id: "dash", label: "Зведення", icon: "dashboard" },
      { id: "partners", label: "Партнери", icon: "partners" },
      { id: "expenses", label: "Витрати", icon: "expenses" },
    ];

    function Icon({ name, size = 20 }) {
      const IconComponent = ICON_COMPONENTS[name];
      return IconComponent ? <IconComponent className="ui-icon" size={size} strokeWidth={1.75} aria-hidden="true" /> : null;
    }

    function IconButton({ icon, label, active = false, className = "", ...props }) {
      return (
        <button
          type="button"
          className={"icon-button" + (active ? " active" : "") + (className ? " " + className : "")}
          aria-label={label}
          data-tooltip={label}
          {...props}
        >
          <Icon name={icon} />
        </button>
      );
    }

    function IconLink({ icon, label, className = "", ...props }) {
      return (
        <a
          className={"icon-button" + (className ? " " + className : "")}
          aria-label={label}
          data-tooltip={label}
          {...props}
        >
          <Icon name={icon} />
        </a>
      );
    }

    function TooltipLayer() {
      const [tooltip, setTooltip] = useState(null);

      useEffect(() => {
        function findAnchor(node) {
          return node instanceof Element ? node.closest("[data-tooltip]") : null;
        }
        function show(e) {
          if (e.type === "pointerover" && e.pointerType === "touch") return;
          if (e.type === "focusin" && window.matchMedia("(hover: none)").matches) return;
          const anchor = findAnchor(e.target);
          if (!anchor || anchor.getAttribute("aria-expanded") === "true") return;
          const label = anchor.dataset.tooltip;
          if (!label) return;
          const rect = anchor.getBoundingClientRect();
          const estimatedWidth = Math.min(280, Math.max(76, label.length * 7.2 + 24));
          const half = estimatedWidth / 2;
          const left = Math.max(half + 10, Math.min(window.innerWidth - half - 10, rect.left + rect.width / 2));
          const showBelow = rect.bottom + 52 < window.innerHeight;
          setTooltip({
            label,
            left,
            top: showBelow ? rect.bottom + 9 : rect.top - 9,
            placement: showBelow ? "below" : "above",
          });
        }
        function hide(e) {
          const anchor = findAnchor(e.target);
          if (e.type === "pointerout" && anchor?.contains(e.relatedTarget)) return;
          setTooltip(null);
        }
        function onKeyDown(e) {
          if (e.key === "Escape") setTooltip(null);
        }

        document.addEventListener("pointerover", show);
        document.addEventListener("pointerout", hide);
        document.addEventListener("focusin", show);
        document.addEventListener("focusout", hide);
        document.addEventListener("pointerdown", hide);
        document.addEventListener("keydown", onKeyDown);
        window.addEventListener("scroll", hide, true);
        window.addEventListener("resize", hide);
        return () => {
          document.removeEventListener("pointerover", show);
          document.removeEventListener("pointerout", hide);
          document.removeEventListener("focusin", show);
          document.removeEventListener("focusout", hide);
          document.removeEventListener("pointerdown", hide);
          document.removeEventListener("keydown", onKeyDown);
          window.removeEventListener("scroll", hide, true);
          window.removeEventListener("resize", hide);
        };
      }, []);

      if (!tooltip) return null;
      return createPortal(
        <div
          className={"app-tooltip " + tooltip.placement}
          role="tooltip"
          style={{ left: tooltip.left, top: tooltip.top }}
        >
          {tooltip.label}
        </div>,
        document.body
      );
    }

    function useDismissablePopover(open, setOpen, wrapRef) {
      useEffect(() => {
        if (!open) return;
        function dismiss(e) {
          if (e.type === "keydown" && e.key !== "Escape") return;
          if (e.type === "mousedown" && wrapRef.current?.contains(e.target)) return;
          setOpen(false);
        }
        document.addEventListener("keydown", dismiss);
        document.addEventListener("mousedown", dismiss);
        return () => {
          document.removeEventListener("keydown", dismiss);
          document.removeEventListener("mousedown", dismiss);
        };
      }, [open, setOpen, wrapRef]);
    }

    function SearchControl({ value, onChange }) {
      const [open, setOpen] = useState(false);
      const wrapRef = useRef(null);
      const inputRef = useRef(null);
      useDismissablePopover(open, setOpen, wrapRef);
      useEffect(() => {
        if (open) inputRef.current?.focus();
      }, [open]);
      const label = value ? "Пошук: " + value : "Пошук за імʼям, телефоном або номером";
      return (
        <div className="tool-control" ref={wrapRef}>
          <IconButton icon="search" label={label} active={open || !!value} aria-expanded={open} onClick={() => setOpen(v => !v)} />
          {open && (
            <div className="tool-popover search-popover">
              <Icon name="search" size={18} />
              <input
                ref={inputRef}
                type="search"
                aria-label="Пошук замовлень"
                placeholder="Імʼя, телефон або ORD-…"
                value={value}
                onChange={e => onChange(e.target.value)}
              />
              {value && <IconButton icon="close" label="Очистити пошук" className="popover-clear" onClick={() => { onChange(""); inputRef.current?.focus(); }} />}
            </div>
          )}
        </div>
      );
    }

    function StatusControl({ value, onChange, includeMissing }) {
      const [open, setOpen] = useState(false);
      const wrapRef = useRef(null);
      useDismissablePopover(open, setOpen, wrapRef);
      const options = includeMissing ? [...STATUSES, MISSING_STATUS] : STATUSES;
      const label = value ? "Статус: " + value : "Фільтр за статусом";
      return (
        <div className="tool-control" ref={wrapRef}>
          <IconButton icon="filter" label={label} active={open || !!value} aria-expanded={open} onClick={() => setOpen(v => !v)} />
          {open && (
            <div className="tool-popover status-popover" role="menu" aria-label="Фільтр за статусом">
              {[{ value: "", label: "Усі статуси" }, ...options.map(s => ({ value: s, label: s }))].map(option => (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={value === option.value}
                  className={value === option.value ? "selected" : ""}
                  key={option.value || "all"}
                  onClick={() => { onChange(option.value); setOpen(false); }}
                >
                  <span>{option.label}</span>
                  {value === option.value && <Icon name="check" size={17} />}
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }

    function money(v) {
      if (v == null || v === "") return "—";
      return Number(v).toLocaleString("uk-UA") + "\u00A0₴";
    }
    function pct(v) {
      if (v == null || v === "") return "—";
      return Number(v).toLocaleString("uk-UA", { maximumFractionDigits: 1 }) + "%";
    }
    function itemMarginPct(item) {
      const source = item || {};
      const revenue = Number(source.revenue);
      const profit = Number(source.profit);
      if (revenue > 0 && source.profit != null && source.profit !== "" && Number.isFinite(profit)) {
        return Math.round((profit / revenue) * 1000) / 10;
      }
      const stored = Number(source.margin_pct);
      if (!Number.isFinite(stored)) return null;
      return stored;
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
    // Порожній, нестандартний або різний у рядках одного замовлення статус не можна
    // мовчки вважати «Новим»: це окремий стан якості даних, який менеджер виправляє явно.
    function resolveOrderStatus(values) {
      const raw = [...new Set((values || []).map(v => String(v || "").trim()))];
      if (raw.length === 1 && STATUSES.includes(raw[0])) {
        return { status: raw[0], raw_statuses: raw, status_issue: "" };
      }
      return {
        status: MISSING_STATUS,
        raw_statuses: raw,
        status_issue: raw.length > 1 ? "У позицій замовлення різні статуси" : "У замовлення не вказано коректний статус",
      };
    }
    function normalizeOrderGroups(data) {
      const statusesByOrder = {};
      (data.orders || []).forEach(item => {
        const key = String(item.order_number || "");
        if (!statusesByOrder[key]) statusesByOrder[key] = [];
        statusesByOrder[key].push(item.status);
      });
      return (data.groups || []).map(group => ({
        ...group,
        ...resolveOrderStatus(statusesByOrder[group.order_number] || [group.status]),
      }));
    }
    function readAdminCache() {
      try {
        const cached = JSON.parse(sessionStorage.getItem(ORDERS_CACHE_KEY) || "null");
        return cached && typeof cached === "object" ? cached : {};
      } catch (_) {
        return {};
      }
    }
    function writeAdminCache(patch) {
      try {
        sessionStorage.setItem(ORDERS_CACHE_KEY, JSON.stringify({
          ...readAdminCache(),
          ...patch,
          savedAt: Date.now(),
        }));
      } catch (_) {}
    }
    function orderDetailFromSnapshot(orderNumber, groups, orderItems, payments) {
      if (!orderNumber) return null;
      const order = (groups || []).find(g => g.order_number === orderNumber);
      const items = (orderItems || []).filter(item => item.order_number === orderNumber);
      if (!order || !items.length) return null;
      const orderPayments = (payments || []).filter(payment => payment.order_number === orderNumber);
      return {
        status: "ok",
        order,
        items,
        payments: orderPayments,
        payment_summary: {
          revenue: Number(order.revenue) || 0,
          profit: Number(order.profit) || 0,
          client_paid: Number(order.client_paid_sum) || 0,
          client_left: Number(order.client_left) || 0,
          margin_received: Number(order.margin_received) || 0,
          margin_left: Number(order.margin_left) || 0,
          legacy: !(Number(order.payments_count) > 0),
        },
      };
    }
    function newRequestId() {
      if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
        return globalThis.crypto.randomUUID();
      }
      return "pay-" + Date.now() + "-" + Math.random().toString(36).slice(2);
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
    function dateInPeriod(value, period) {
      const range = periodRange(period);
      if (!range) return true;
      const d = parseUaDateTime(value) || (value ? new Date(value) : null);
      if (!d || isNaN(d.getTime())) return false;
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
        const payment = groupPaymentMetrics(g);
        const reasons = [];
        let priority = 99;
        let tag = "";
        let tagClass = "";
        if (g.status === MISSING_STATUS) {
          reasons.push(g.status_issue || "Потрібно вказати статус");
          priority = 0;
          tag = "Статус";
          tagClass = "data";
        }
        if (payment.marginDebt > 0) {
          reasons.push("Маржа до отримання: " + money(payment.marginDebt));
          if (priority > 1) {
            priority = 1;
            tag = "Борг маржі";
            tagClass = "debt";
          }
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
    function totalsFromGroups(groups, expensesTotal, payoutsTotal, marginCashReceived) {
      const by_status = {};
      DISPLAY_STATUSES.forEach(s => { by_status[s] = 0; });
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
        const payment = groupPaymentMetrics(g);
        revenue += rev;
        cost += cst;
        profit += pr;
        commission += com;
        margin_ready += payment.marginReady;
        margin_received += payment.marginReceived;
        margin_debt += payment.marginDebt;
      });
      const expenses = Number(expensesTotal) || 0;
      const payouts_paid = Number(payoutsTotal) || 0;
      const margin_cash_received = Number.isFinite(Number(marginCashReceived))
        ? Number(marginCashReceived)
        : margin_received;
      return {
        revenue, cost, profit, commission, expenses,
        margin_ready, margin_received, margin_debt,
        margin_pending: Math.max(0, profit - margin_received - margin_debt),
        margin_cash_received, payouts_paid,
        margin_pct: revenue ? Math.round((profit / revenue) * 1000) / 10 : 0,
        net_fact: margin_cash_received - payouts_paid - expenses,
        by_status,
      };
    }
    function monthlyFromGroups(groups, expenses, payments, payouts, eligibleOrderNumbers) {
      const map = {};
      const ensureMonth = key => {
        if (!map[key]) {
          map[key] = {
            month: key, revenue: 0, cost: 0, profit: 0, commission: 0,
            margin_received: 0, margin_debt: 0, payouts: 0, expenses: 0,
          };
        }
        return map[key];
      };
      (groups || []).forEach(g => {
        if (g.status === "Скасовано") return;
        const d = orderDate(g);
        const key = monthKeyFromDate(d);
        if (!key) return;
        const m = ensureMonth(key);
        m.revenue += Number(g.revenue) || 0;
        m.cost += Number(g.cost_total) || 0;
        m.profit += Number(g.profit) || 0;
        m.commission += Number(g.commission) || 0;
        const payment = groupPaymentMetrics(g);
        m.margin_debt += payment.marginDebt;
        // Для старих замовлень без журналу точна дата надходження невідома.
        // Зберігаємо сумісність і відносимо їхню отриману маржу до місяця замовлення.
        if (!(Number(g.payments_count) > 0)) m.margin_received += payment.marginReceived;
      });
      (payments || []).forEach(payment => {
        if (payment.type !== "Маржа від підрядника") return;
        if (eligibleOrderNumbers && !eligibleOrderNumbers.has(String(payment.order_number || ""))) return;
        const d = parseUaDateTime(payment.date) || (payment.date ? new Date(payment.date) : null);
        const key = monthKeyFromDate(d);
        if (!key) return;
        ensureMonth(key).margin_received += Number(payment.amount) || 0;
      });
      (expenses || []).forEach(ex => {
        const d = parseUaDateTime(ex.date) || (ex.date ? new Date(ex.date) : null);
        const key = monthKeyFromDate(d);
        if (!key) return;
        ensureMonth(key).expenses += Number(ex.amount) || 0;
      });
      (payouts || []).forEach(payout => {
        const d = parseUaDateTime(payout.date) || (payout.date ? new Date(payout.date) : null);
        const key = monthKeyFromDate(d);
        if (!key) return;
        ensureMonth(key).payouts += Number(payout.amount) || 0;
      });
      return Object.keys(map).map(k => {
        const row = map[k];
        row.margin_pct = row.revenue ? Math.round((row.profit / row.revenue) * 1000) / 10 : 0;
        row.net_fact = row.margin_received - row.payouts - row.expenses;
        return row;
      }).filter(row => [
        row.revenue, row.cost, row.profit, row.commission, row.margin_received,
        row.margin_debt, row.payouts, row.expenses,
      ].some(value => Number(value) !== 0))
        .sort((a, b) => compareMonthKeyDesc(a.month, b.month)).slice(0, 6);
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
      const normalized = normalizePhone(key || raw);
      if (!normalized) return "—";
      if (normalized.length === 12 && normalized.indexOf("380") === 0) {
        return "+380 " + normalized.slice(3, 5) + " " + normalized.slice(5, 8) + " "
          + normalized.slice(8, 10) + " " + normalized.slice(10, 12);
      }
      return String(raw || key || normalized).trim();
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
      const phoneLabel = formatPhoneDisplay(normalizePhone(phone), phone);
      const tg = telegramHandle(order?.contact_telegram);
      const email = String(order?.contact_email || "").trim();
      const actions = [];
      const push = (href, label, external) => {
        if (href && label) actions.push({ href, label, external: !!external });
      };
      if (method === "telegram" && tg) push("https://t.me/" + encodeURIComponent(tg), "@" + tg, true);
      else if (method === "email" && email) push("mailto:" + email, email, false);
      else if (method === "viber" && dial) push("viber://chat?number=%2B" + normalizePhone(phone), phoneLabel, false);
      else if (method === "whatsapp" && dial) push("https://wa.me/" + normalizePhone(phone), phoneLabel, true);
      else if (dial) push(dial, phoneLabel, false);
      if (dial && method && !["phone", "viber", "whatsapp"].includes(method)) {
        push(dial, phoneLabel, false);
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
            data-tooltip="Підказка"
            onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
          ><Icon name="info" size={17} /></button>
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

    // Платежі замовлення: передоплати/доплати клієнта і виплати маржі підрядником.
    function PaymentsSection({ token, orderNumber, payments, summary, onChanged }) {
      const [form, setForm] = useState({ type: "Передоплата", amount: "", method: "Готівка", date: "", note: "" });
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState("");
      const pendingRef = useRef({ fingerprint: "", requestId: "" });
      const list = payments || [];
      const s = summary || {};
      const clientOverpaid = Math.max(0, (Number(s.client_paid) || 0) - (Number(s.revenue) || 0));
      const marginOverreceived = Math.max(0, (Number(s.margin_received) || 0) - (Number(s.profit) || 0));

      async function add() {
        setError("");
        if (!(Number(form.amount) > 0)) return setError("Вкажіть суму більшу за нуль");
        const payment = { order_number: orderNumber, ...form, amount: Number(form.amount) };
        const fingerprint = JSON.stringify(payment);
        if (pendingRef.current.fingerprint !== fingerprint) {
          pendingRef.current = { fingerprint, requestId: newRequestId() };
        }
        setBusy(true);
        try {
          const result = await api("/api/admin/payments", {
            method: "POST", token,
            body: { payment: { ...payment, request_id: pendingRef.current.requestId } },
          });
          pendingRef.current = { fingerprint: "", requestId: "" };
          setForm(f => ({ ...f, amount: "", note: "" }));
          onChanged && onChanged(result);
        } catch (e) { setError(e.message || "Не вдалося внести платіж"); }
        finally { setBusy(false); }
      }

      async function remove(payment) {
        if (!window.confirm("Видалити цей платіж?")) return;
        setBusy(true); setError("");
        try {
          const qs = new URLSearchParams({
            row: String(payment.row),
            order_number: orderNumber,
            payment_request_id: payment.request_id || "",
            payment_type: payment.type || "",
            payment_amount: String(payment.amount || 0),
          });
          const result = await api("/api/admin/payments?" + qs.toString(), { method: "DELETE", token });
          onChanged && onChanged(result);
        } catch (e) { setError(e.message || "Не вдалося видалити платіж"); }
        finally { setBusy(false); }
      }

      return (
        <section className="payments-section" aria-labelledby="payments-section-title">
          <div className="section-title section-title--first" id="payments-section-title">Платежі</div>
          <div className="grid2">
            <div className="field"><label htmlFor="payment-client-summary">Клієнт сплатив</label>
              <input id="payment-client-summary" disabled value={money(s.client_paid || 0) + " / " + money(s.revenue || 0)
                + ((s.client_left || 0) > 0 ? " · борг " + money(s.client_left)
                  : clientOverpaid > 0 ? " · переплата " + money(clientOverpaid) : " · повністю")} /></div>
            <div className="field"><label htmlFor="payment-margin-summary">Маржа отримана</label>
              <input id="payment-margin-summary" disabled value={money(s.margin_received || 0) + " / " + money(s.profit || 0)
                + ((s.margin_left || 0) > 0 ? " · до отримання " + money(s.margin_left)
                  : marginOverreceived > 0 ? " · понад нову маржу " + money(marginOverreceived) : " · повністю")} /></div>
          </div>

          {s.legacy && (
            <div style={{ margin: "8px 0 10px", padding: "10px 12px", borderRadius: 10, background: "#fff7e6", color: "#7a5410", fontSize: 12, lineHeight: 1.45 }}>
              У журналі ще немає платежів. Якщо клієнт уже платив, спочатку внесіть фактичну отриману суму — тоді доплата після зміни ціни порахується точно.
            </div>
          )}

          {list.length > 0 && (
            <div className="table-scroll" style={{ marginTop: 8 }}>
              <table>
                <thead><tr><th>Дата</th><th>Тип</th><th>Сума</th><th>Спосіб</th><th>Примітка</th><th /></tr></thead>
                <tbody>
                  {list.map(p => (
                    <tr key={p.row}>
                      <td>{(p.date || "").slice(0, 10)}</td>
                      <td>{p.type}</td>
                      <td><b>{money(p.amount)}</b></td>
                      <td>{p.method || "—"}</td>
                      <td>{p.note || "—"}</td>
                      <td><button className="btn ghost" disabled={busy} onClick={() => remove(p)}>Видалити</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="grid2" style={{ marginTop: 8 }}>
            <div className="field"><label htmlFor="payment-type">Тип платежу</label>
              <select id="payment-type" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                {PAYMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="payment-amount">Сума, ₴</label>
              <input id="payment-amount" type="number" inputMode="decimal" min="0" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
            <div className="field"><label htmlFor="payment-method">Спосіб</label>
              <select id="payment-method" value={form.method} onChange={e => setForm({ ...form, method: e.target.value })}>
                {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="payment-date">Дата (порожньо = сьогодні)</label>
              <input id="payment-date" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
          </div>
          <div className="field"><label htmlFor="payment-note">Примітка</label>
            <input id="payment-note" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="Напр. квитанція №, хто передав" /></div>
          {error && <div className="error">{error}</div>}
          <button className="btn" disabled={busy} onClick={add}>{busy ? "Внесення…" : "Внести платіж"}</button>
        </section>
      );
    }

    function OrderDrawer({ token, orderNumber, initialData, snapshotLoading, onClose, onChanged }) {
      const [data, setData] = useState(initialData || null);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState("");
      const [form, setForm] = useState(null);
      const [itemIdx, setItemIdx] = useState(0);

      function applyItemToForm(res, idx) {
        const item = (res.items && res.items[idx]) || {};
        const resolvedStatus = resolveOrderStatus((res.items || []).map(x => x.status));
        setForm({
          row: item.row,
          status: resolvedStatus.status,
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
          // Дані клієнта й товару — щоб усе правилось у CRM, а не в таблиці.
          client: (res.order && res.order.client) || item.client || "",
          phone: (res.order && res.order.phone) || item.phone || "",
          city: (res.order && res.order.city) || item.city || "",
          contact_method: (res.order && res.order.contact_method) || item.contact_method || "",
          contact_telegram: (res.order && res.order.contact_telegram) || item.contact_telegram || "",
          contact_email: (res.order && res.order.contact_email) || item.contact_email || "",
          source: (res.order && res.order.source) || item.source || "",
          transport: (res.order && res.order.transport) || item.transport || "",
          address: (res.order && res.order.address) || item.address || "",
          basket_model: item.basket_model || "",
          basket_type: item.basket_type || "",
          construction: item.construction || "",
          color: item.color || "",
          pattern: item.pattern || "",
          size_w: item.size_w ?? "",
          size_h: item.size_h ?? "",
          size_d: item.size_d ?? "",
          quantity: item.quantity ?? 1,
          unit: item.unit || (item.product_kind === "Кронштейни" ? "комп." : "шт."),
          product_kind: item.product_kind || "",
          specs: item.specs || "",
        });
      }

      async function load() {
        setError("");
        setItemIdx(0);
        const res = await api("/api/admin/order?order_number=" + encodeURIComponent(orderNumber), { token });
        setData(res);
        applyItemToForm(res, 0);
      }

      useEffect(() => {
        if (initialData) {
          setData(initialData);
          applyItemToForm(initialData, 0);
          setItemIdx(0);
          setError("");
          return;
        }
        if (snapshotLoading) return;
        load().catch(e => setError(e.message));
      }, [orderNumber, initialData, snapshotLoading]);

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
          onChanged && onChanged(res);
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
          basket_model: item.basket_model || "",
          basket_type: item.basket_type || "",
          construction: item.construction || "",
          color: item.color || "",
          pattern: item.pattern || "",
          size_w: item.size_w ?? "",
          size_h: item.size_h ?? "",
          size_d: item.size_d ?? "",
          quantity: item.quantity ?? 1,
          unit: item.unit || (item.product_kind === "Кронштейни" ? "комп." : "шт."),
          product_kind: item.product_kind || "",
          specs: item.specs || "",
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

            <PaymentsSection
              token={token}
              orderNumber={orderNumber}
              payments={data.payments}
              summary={data.payment_summary}
              onChanged={(result) => {
                const next = {
                  ...data,
                  payments: result?.payments || data.payments || [],
                  payment_summary: result?.summary || data.payment_summary,
                };
                setData(next);
                onChanged && onChanged(next);
              }}
            />

            <div className="section-title">Швидкі дії</div>
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
              <button
                type="button"
                className="warn"
                disabled={busy || form.status === "Скасовано"}
                onClick={() => changeStatus("Скасовано")}
              >Скасувати</button>
            </div>

            {form.status === MISSING_STATUS && (
              <div className="error" style={{ marginBottom: 10 }}>
                У таблиці не задано коректний статус. Оберіть фактичний статус замовлення.
              </div>
            )}

            <div className="section-title">Клієнт і контакти</div>
            <div className="grid2">
              <div className="field"><label>Клієнт</label>
                <input value={form.client} onChange={e => setForm({ ...form, client: e.target.value })} /></div>
              <div className="field"><label>Телефон</label>
                <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
              <div className="field"><label>Місто</label>
                <input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} /></div>
              <div className="field"><label>Спосіб зв'язку</label>
                <select value={form.contact_method} onChange={e => setForm({ ...form, contact_method: e.target.value })}>
                  <option value="">— не вказано —</option>
                  <option value="phone">Телефон</option>
                  <option value="viber">Viber</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="telegram">Telegram</option>
                  <option value="email">E-mail</option>
                </select>
              </div>
              <div className="field"><label>Telegram</label>
                <input value={form.contact_telegram} onChange={e => setForm({ ...form, contact_telegram: e.target.value })} placeholder="@username" /></div>
              <div className="field"><label>E-mail</label>
                <input value={form.contact_email} onChange={e => setForm({ ...form, contact_email: e.target.value })} /></div>
              <div className="field"><label>Джерело</label>
                <input list="manual-sources" value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} />
                <datalist id="manual-sources">{MANUAL_SOURCES.map(s => <option key={s} value={s} />)}</datalist>
              </div>
            </div>
            <button className="btn secondary" style={{ marginTop: 8 }} disabled={busy} onClick={() => save({
              client: form.client, phone: form.phone, city: form.city,
              contact_method: form.contact_method, contact_telegram: form.contact_telegram,
              contact_email: form.contact_email, source: form.source,
            })}>Зберегти клієнта</button>

            <div className="section-title">Товар{items.length > 1 ? " (позиція " + (itemIdx + 1) + " з " + items.length + ")" : ""}</div>
            <p style={{ margin: "0 0 10px", color: "var(--muted)", fontSize: 13, lineHeight: 1.4 }}>
              Зміна розмірів, типу або візерунка перерахує гроші за стандартною формулою.
              Щоб залишити свою ціну — впишіть її нижче в «Фінансах» після збереження.
            </p>
            <div className="grid2">
              <div className="field"><label htmlFor="order-product-model">Модель / виріб</label>
                <input id="order-product-model" list="crm-models" value={form.basket_model} onChange={e => setForm({ ...form, basket_model: e.target.value })} />
                <datalist id="crm-models">{CATALOG_MODELS_CRM.map(m => <option key={m.id} value={m.name} />)}</datalist>
              </div>
              <div className="field"><label htmlFor="order-product-kind">Вид виробу</label>
                <select id="order-product-kind" value={form.product_kind} onChange={e => setForm({ ...form, product_kind: e.target.value })}>
                  <option value="">— не вказано —</option>
                  <option value="Кошик">Кошик</option>
                  <option value="Кронштейни">Кронштейни</option>
                  <option value="Інший виріб">Інший виріб</option>
                </select>
              </div>
              <div className="field"><label>Конструкція</label>
                <input value={form.construction} onChange={e => setForm({ ...form, construction: e.target.value })} /></div>
              <div className="field"><label>Тип</label>
                <input value={form.basket_type} onChange={e => setForm({ ...form, basket_type: e.target.value })} /></div>
              <div className="field"><label>Колір</label>
                <input value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} /></div>
              <div className="field"><label>Візерунок</label>
                <input value={form.pattern} onChange={e => setForm({ ...form, pattern: e.target.value })} /></div>
              <div className="field"><label>Кількість</label>
                <input type="number" min="1" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} /></div>
              <div className="field"><label>Одиниця виміру</label>
                <input list="crm-units-edit" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder="шт. / комп. / інше" />
                <datalist id="crm-units-edit">{UNIT_SUGGESTIONS.map(u => <option key={u} value={u} />)}</datalist>
              </div>
              <div className="field"><label>Ширина, мм</label>
                <input type="number" value={form.size_w} onChange={e => setForm({ ...form, size_w: e.target.value })} /></div>
              <div className="field"><label>Висота, мм</label>
                <input type="number" value={form.size_h} onChange={e => setForm({ ...form, size_h: e.target.value })} /></div>
              <div className="field"><label>Глибина, мм</label>
                <input type="number" value={form.size_d} onChange={e => setForm({ ...form, size_d: e.target.value })} /></div>
            </div>
            <div className="field"><label>Характеристики (для виробів не з каталогу)</label>
              <textarea value={form.specs} onChange={e => setForm({ ...form, specs: e.target.value })} rows="3"
                placeholder="Розміри, матеріал, комплектація — по рядку на пункт" /></div>
            <button className="btn secondary" style={{ marginTop: 8 }} disabled={busy} onClick={() => save({
              basket_model: form.basket_model, product_kind: form.product_kind, specs: form.specs,
              construction: form.construction,
              basket_type: form.basket_type, color: form.color, pattern: form.pattern,
              quantity: Number(form.quantity) || 1,
              unit: form.unit.trim() || "шт.",
              size_w: form.size_w === "" ? 0 : Number(form.size_w),
              size_h: form.size_h === "" ? 0 : Number(form.size_h),
              size_d: form.size_d === "" ? 0 : Number(form.size_d),
            })}>Зберегти товар</button>

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
              <div className="field"><label>Собівартість (разом)</label>
                <input type="number" value={form.cost_total} onChange={e => setForm({ ...form, cost_total: e.target.value })} /></div>
              <div className="field"><label>Роздрібна ціна (разом)</label>
                <input type="number" value={form.list_price} onChange={e => {
                  const raw = e.target.value;
                  const list = Number(raw) || 0;
                  const pctValue = Number(form.discount_pct) || 0;
                  const uahValue = Number(form.discount_uah) || 0;
                  const revenue = pctValue > 0 ? Math.round(list * (1 - pctValue / 100)) : Math.max(0, Math.round(list - uahValue));
                  setForm({ ...form, list_price: raw, revenue: raw === "" ? form.revenue : String(revenue) });
                }} /></div>
              <div className="field"><label>Знижка %</label>
                <input type="number" step="0.1" value={form.discount_pct} onChange={e => {
                  const pctValue = Number(e.target.value) || 0;
                  const list = Number(form.list_price) || 0;
                  setForm({ ...form, discount_pct: e.target.value, discount_uah: "", revenue: list ? String(Math.max(0, Math.round(list * (1 - pctValue / 100)))) : form.revenue });
                }} /></div>
              <div className="field"><label>Знижка ₴</label>
                <input type="number" value={form.discount_uah} onChange={e => {
                  const discount = Number(e.target.value) || 0;
                  const list = Number(form.list_price) || 0;
                  setForm({ ...form, discount_uah: e.target.value, discount_pct: "", revenue: list ? String(Math.max(0, Math.round(list - discount))) : form.revenue });
                }} /></div>
              <div className="field"><label>Ціна продажу / виручка (разом)</label>
                <input type="number" value={form.revenue} onChange={e => setForm({ ...form, revenue: e.target.value, discount_pct: "", discount_uah: "" })} /></div>
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
              discount_pct: form.discount_pct === "" ? 0 : Number(form.discount_pct),
              discount_uah: form.discount_uah === "" ? 0 : Number(form.discount_uah),
              revenue: form.revenue === "" ? null : Number(form.revenue),
            })}>Зберегти фінанси</button>
            <div className="section-title">Доставка та нотатки</div>
            <div className="grid2">
              <div className="field"><label>Дата доставки</label>
                <input type="date" value={(form.delivery_date || "").slice(0, 10)} onChange={e => setForm({ ...form, delivery_date: e.target.value })} /></div>
              <div className="field"><label>Оплата</label>
                <input value={form.payment_method} onChange={e => setForm({ ...form, payment_method: e.target.value })} /></div>
              <div className="field"><label>Спосіб доставки</label>
                <input value={form.transport} onChange={e => setForm({ ...form, transport: e.target.value })} placeholder="Нова пошта / Самовивіз" /></div>
              <div className="field"><label>Адреса / відділення</label>
                <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
            </div>
            <div className="field"><label>Примітки</label>
              <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
            <button className="btn secondary" disabled={busy} onClick={() => save({
              delivery_date: form.delivery_date,
              payment_method: form.payment_method,
              transport: form.transport,
              address: form.address,
              notes: form.notes,
            })}>Зберегти деталі</button>

            <div className="section-title">Позиції ({items.length})</div>
            <div className="order-items-list">
              {items.map(it => (
                <div key={it.row} className="order-item-card">
                  <div className="order-item-title">{it.basket_model ? it.basket_model + " · " : ""}{it.basket_type || "Кошик"} · {it.construction}</div>
                  <div className="order-item-meta">
                    {it.size_w || "—"}×{it.size_h || "—"}×{it.size_d || "—"} мм · {it.quantity} {it.unit || (it.product_kind === "Кронштейни" ? "комп." : "шт.")} · {it.color} · {it.pattern}
                  </div>
                  <div className="order-item-finance">
                    <span>{money(it.revenue)}</span>
                    <span>Маржа {money(it.profit)} · {pct(itemMarginPct(it))}</span>
                  </div>
                </div>
              ))}
            </div>
            {error && <div className="error">{error}</div>}
          </div>
        </div>
      );
    }

    // Ручне внесення замовлення: телефон, Instagram, повторний клієнт — усе, що не
    // прийшло через онлайн-форму. Пише той самий рядок таблиці, що й форма.
    function NewOrderDrawer({ token, onClose, onCreated }) {
      const [kind, setKind] = useState("basket"); // basket | bracket | other
      const [form, setForm] = useState({
        client: "", phone: "", contact_method: "phone", contact_telegram: "", contact_email: "",
        city: "", source: "Телефон",
        basket_model: "", basket_type: "", construction_type: "", color: "", pattern: "",
        has_cover: false, bracket_length: "", vibro_pads: false,
        product_name: "", specs: "",
        size_w: "", size_h: "", size_d: "", quantity: "1", unit: "шт.",
        cost_total: "", price_total: "", list_price: "", discount_pct: "", discount_uah: "",
        transport: "", delivery_address: "", delivery_date: "", payment_method: "", notes: "",
      });
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState("");
      const pendingCreateRef = useRef({ fingerprint: "", requestId: "" });

      const model = CATALOG_MODELS_CRM.find(m => m.id === form.basket_model);
      const isOther = kind === "other";
      const isBracket = kind === "bracket" || !!(model && model.bracket);
      const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

      // Виріб не з каталогу: моделі/візерунка немає, ціну веде менеджер.
      const bracketModels = CATALOG_MODELS_CRM.filter(m => m.bracket);
      const basketModels = CATALOG_MODELS_CRM.filter(m => !m.bracket);
      const shownModels = kind === "bracket" ? bracketModels : basketModels;

      function changeKind(next) {
        setKind(next);
        setForm(f => ({
          ...f,
          basket_model: "", construction_type: "", pattern: "", has_cover: false,
          bracket_length: "", vibro_pads: false, product_name: "", specs: "",
          unit: next === "bracket" ? "комп." : "шт.",
        }));
      }

      // Гроші вводяться ЗА ОДИНИЦЮ, у таблицю йдуть підсумки (× кількість).
      const qtyNum = Math.max(1, Number(form.quantity) || 1);
      const costUnit = Number(form.cost_total) || 0;
      const listUnit = Number(form.list_price) || 0;
      const priceUnitOverride = Number(form.price_total) || 0;
      const costTotalCalc = Math.round(costUnit * qtyNum);
      const listTotal = Math.round(listUnit * qtyNum);
      const discountTotal = Number(form.discount_uah) || (listTotal && Number(form.discount_pct)
        ? Math.round(listTotal * Number(form.discount_pct) / 100) : 0);
      const revenueTotal = priceUnitOverride
        ? Math.round(priceUnitOverride * qtyNum)
        : (listTotal ? listTotal - discountTotal : 0);

      function pickModel(id) {
        const m = CATALOG_MODELS_CRM.find(x => x.id === id);
        setForm(f => ({
          ...f,
          basket_model: id,
          construction_type: m ? m.construction + " · " + m.id : "",
          unit: m && m.bracket ? "комп." : "шт.",
          // Кришка підставляється з каталогу: у AVL-06/07/08 вона передбачена конструкцією,
          // у AVL-02 — неможлива. Інакше ціна порахувалась би без неї.
          has_cover: !!(m && m.defaultCover),
          ...(m && m.bracket
            ? { size_w: "", size_h: "", size_d: "", pattern: "", has_cover: false }
            : { bracket_length: "", vibro_pads: false }),
        }));
      }

      const profit = revenueTotal - costTotalCalc;
      const marginPct = revenueTotal ? Math.round((profit / revenueTotal) * 1000) / 10 : 0;

      async function submit() {
        setError("");
        if (!form.client.trim()) return setError("Вкажіть імʼя клієнта");
        if (!form.phone.trim() && !form.contact_telegram.trim() && !form.contact_email.trim()) {
          return setError("Вкажіть телефон, Telegram або e-mail");
        }
        if (isOther && !form.product_name.trim()) return setError("Вкажіть назву виробу");
        if (!form.unit.trim()) return setError("Вкажіть одиницю виміру");
        const order = {
          ...form,
          product_type: isOther ? "other" : (isBracket ? "bracket" : "basket"),
          basket_model_name: isOther ? form.product_name : (model ? model.name : form.basket_model),
          construction_type: isOther ? form.product_name : form.construction_type,
          quantity: qtyNum,
          unit: form.unit.trim(),
          // Колонки таблиці зберігають ПІДСУМКИ по позиції, тож множимо на кількість.
          cost_total: costTotalCalc || "",
          list_price: priceUnitOverride ? "" : (listTotal || ""),
          discount_pct: priceUnitOverride ? "" : (form.discount_pct || ""),
          discount_uah: priceUnitOverride ? "" : (discountTotal || ""),
          price_total: revenueTotal || "",
        };
        const fingerprint = JSON.stringify(order);
        if (pendingCreateRef.current.fingerprint !== fingerprint) {
          pendingCreateRef.current = { fingerprint, requestId: newRequestId() };
        }
        order.request_id = pendingCreateRef.current.requestId;
        setBusy(true);
        try {
          const res = await api("/api/admin/orders", {
            method: "POST",
            token,
            body: { order },
          });
          pendingCreateRef.current = { fingerprint: "", requestId: "" };
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

            <div className="section-title section-title--first">Клієнт</div>
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
            <div className="quick-actions" style={{ marginBottom: 10 }}>
              {[{ v: "basket", l: "Кошик з каталогу" }, { v: "bracket", l: "Кронштейни" }, { v: "other", l: "Інший виріб" }].map(o => (
                <button key={o.v} type="button" className={kind === o.v ? "active" : ""} onClick={() => changeKind(o.v)}>{o.l}</button>
              ))}
            </div>
            {isOther && (
              <div className="grid2">
                <div className="field"><label>Назва виробу *</label>
                  <input value={form.product_name} onChange={e => set("product_name", e.target.value)} placeholder="Пергола / Виставковий стенд / Навіс…" /></div>
                <div className="field"><label>Кількість</label>
                  <input type="number" min="1" value={form.quantity} onChange={e => set("quantity", e.target.value)} /></div>
                <div className="field"><label>Одиниця виміру</label>
                  <input list="crm-units-new" value={form.unit} onChange={e => set("unit", e.target.value)} placeholder="шт. / комп. / інше" />
                  <datalist id="crm-units-new">{UNIT_SUGGESTIONS.map(u => <option key={u} value={u} />)}</datalist>
                </div>
                <div className="field"><label>Колір</label>
                  <input value={form.color} onChange={e => set("color", e.target.value)} placeholder="RAL 7016" /></div>
              </div>
            )}
            {isOther && (
              <div className="field"><label>Характеристики</label>
                <textarea value={form.specs} onChange={e => set("specs", e.target.value)} rows="4"
                  placeholder={"Розміри, матеріал, комплектація — по рядку на пункт. Напр.:\nРозмір 3000×4000 мм\nПрофіль 40×40, порошкове фарбування\nПоліуглинка + монтаж"} /></div>
            )}
            {!isOther && <div className="grid2">
              <div className="field"><label>Модель</label>
                <select value={form.basket_model} onChange={e => pickModel(e.target.value)}>
                  <option value="">— оберіть модель —</option>
                  {shownModels.map(m => <option key={m.id} value={m.id}>{m.id} · {m.name}</option>)}
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
              <div className="field"><label>Кількість</label>
                <input type="number" min="1" value={form.quantity} onChange={e => set("quantity", e.target.value)} /></div>
              <div className="field"><label>Одиниця виміру</label>
                <input list="crm-units-new" value={form.unit} onChange={e => set("unit", e.target.value)} placeholder="шт. / комп. / інше" />
                <datalist id="crm-units-new">{UNIT_SUGGESTIONS.map(u => <option key={u} value={u} />)}</datalist>
              </div>
            </div>}
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
              {!isBracket && !isOther && model && model.coverAllowed === false && (
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Для цієї моделі верхня кришка не передбачена.</span>
              )}
              {!isBracket && !isOther && !(model && model.coverAllowed === false) && (
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
              {isOther || isBracket
                ? "Ціни вказуються ЗА ОДИНИЦЮ — підсумок з урахуванням кількості порахується нижче."
                : "Ціни вказуються за одиницю. Для кошика можна залишити гроші порожніми — ціна порахується за розмірами тією ж формулою, що для онлайн-заявок."}
            </p>
            <div className="grid2">
              <div className="field"><label>Собівартість за од., ₴</label>
                <input type="number" value={form.cost_total} onChange={e => set("cost_total", e.target.value)} /></div>
              <div className="field"><label>Роздрібна ціна за од., ₴</label>
                <input type="number" value={form.list_price} onChange={e => set("list_price", e.target.value)} /></div>
              <div className="field"><label>Знижка, % (на позицію)</label>
                <input type="number" step="0.1" value={form.discount_pct} onChange={e => setForm(f => ({ ...f, discount_pct: e.target.value, discount_uah: "" }))} /></div>
              <div className="field"><label>Знижка, ₴ (разом)</label>
                <input type="number" value={form.discount_uah} onChange={e => setForm(f => ({ ...f, discount_uah: e.target.value, discount_pct: "" }))} /></div>
              <div className="field"><label>Ціна продажу за од., ₴</label>
                <input type="number" value={form.price_total} onChange={e => set("price_total", e.target.value)}
                  placeholder={listUnit ? "заповнено прайсом" : ""} /></div>
              <div className="field"><label>Маржа разом (авто)</label>
                <input disabled value={money(profit) + " · " + pct(marginPct)} /></div>
            </div>
            {(revenueTotal > 0 || costTotalCalc > 0) && (
              <div className="panel" style={{ boxShadow: "none", padding: 12, marginTop: 10 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Разом за позицію ({qtyNum} {form.unit.trim() || "шт."})</div>
                <div style={{ fontSize: 13, lineHeight: 1.7, color: "var(--muted)" }}>
                  {listTotal > 0 && !priceUnitOverride && (
                    <div>Роздрібна: {money(listUnit)} × {qtyNum} = <b>{money(listTotal)}</b>
                      {discountTotal > 0 ? <> − знижка {money(discountTotal)}</> : null}</div>
                  )}
                  {priceUnitOverride > 0 && (
                    <div>Ціна продажу: {money(priceUnitOverride)} × {qtyNum} = <b>{money(revenueTotal)}</b></div>
                  )}
                  <div>Виручка: <b style={{ color: "var(--text)" }}>{money(revenueTotal)}</b></div>
                  <div>Собівартість: {money(costUnit)} × {qtyNum} = <b>{money(costTotalCalc)}</b></div>
                  <div>Маржа: <b style={{ color: "var(--text)" }}>{money(profit)}</b> · {pct(marginPct)}</div>
                </div>
              </div>
            )}

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

    function OrdersView({ token, groups, setGroups, loading, error, setError, refreshOrders, onOrderChanged, onOpenOrder }) {
      const [q, setQ] = useState("");
      const [status, setStatus] = useState("");
      const [view, setView] = useState("kanban");
      const [dragOver, setDragOver] = useState("");
      const [moving, setMoving] = useState("");
      const [creating, setCreating] = useState(false);
      const [cardsCollapsed, setCardsCollapsed] = useState(() => {
        try {
          return localStorage.getItem(CARDS_COLLAPSED_KEY) === "1";
        } catch (_) {
          return false;
        }
      });
      const dragOrderRef = useRef("");
      const skipClickRef = useRef(false);

      function toggleCardsCollapsed() {
        setCardsCollapsed(current => {
          const next = !current;
          try {
            localStorage.setItem(CARDS_COLLAPSED_KEY, next ? "1" : "0");
          } catch (_) {}
          return next;
        });
      }

      async function load() {
        setError("");
        try {
          await refreshOrders();
        } catch (e) {
          setError(e.message);
        }
      }

      const hasMissingStatus = groups.some(g => g.status === MISSING_STATUS);
      const funnelStatuses = hasMissingStatus ? DISPLAY_STATUSES : STATUSES;
      const filteredGroups = useMemo(() => {
        const needle = q.trim().toLowerCase();
        return groups.filter(g => {
          if (status && g.status !== status) return false;
          if (!needle) return true;
          const phoneKey = normalizePhone(g.phone);
          const haystack = [
            g.order_number, g.client, g.phone, phoneKey, formatPhoneDisplay(phoneKey, g.phone),
            g.city, g.contact_telegram, g.contact_email, g.source,
          ]
            .map(v => String(v || "").toLowerCase()).join(" ");
          return haystack.includes(needle);
        });
      }, [groups, q, status]);

      async function moveToStatus(orderNumber, newStatus) {
        const current = groups.find(g => g.order_number === orderNumber);
        if (!current || current.status === newStatus) return;
        if (!confirmStatusChange(current.status, newStatus)) return;
        const prev = groups;
        setMoving(orderNumber);
        setGroups(list => list.map(g => g.order_number === orderNumber
          ? { ...g, status: newStatus, raw_statuses: [newStatus], status_issue: "" }
          : g));
        try {
          const result = await api("/api/admin/order", {
            method: "PATCH",
            token,
            body: { order_number: orderNumber, patch: { status: newStatus } },
          });
          onOrderChanged && onOrderChanged(result);
        } catch (e) {
          setGroups(prev);
          setError(e.message || "Не вдалося змінити статус");
        } finally {
          setMoving("");
        }
      }

      const byStatus = useMemo(() => {
        const map = {};
        const blank = () => ({ items: [], revenue: 0, profit: 0, client_left: 0, margin_left: 0 });
        funnelStatuses.forEach(s => { map[s] = blank(); });
        filteredGroups.forEach(g => {
          if (!map[g.status]) map[g.status] = blank();
          map[g.status].items.push(g);
          if (g.status !== "Скасовано") {
            map[g.status].revenue += Number(g.revenue) || 0;
            map[g.status].profit += Number(g.profit) || 0;
            map[g.status].client_left += Number(g.client_left) || 0;
            map[g.status].margin_left += Number(g.margin_left) || 0;
          }
        });
        return map;
      }, [filteredGroups, funnelStatuses]);

      const grand = useMemo(() => {
        let revenue = 0, profit = 0, count = 0, clientLeft = 0, marginLeft = 0;
        filteredGroups.forEach(g => {
          if (g.status === "Скасовано") return;
          count += 1;
          revenue += Number(g.revenue) || 0;
          profit += Number(g.profit) || 0;
          clientLeft += Number(g.client_left) || 0;
          marginLeft += Number(g.margin_left) || 0;
        });
        return { revenue, profit, count, clientLeft, marginLeft };
      }, [filteredGroups]);

      return (
        <div>
          <div className="toolbar orders-toolbar">
            <div className="toolbar-primary">
              <SearchControl value={q} onChange={setQ} />
              <StatusControl value={status} onChange={setStatus} includeMissing={hasMissingStatus} />
              <IconButton
                icon="refresh"
                label="Оновити замовлення"
                className={loading ? "is-spinning" : ""}
                onClick={load}
                disabled={loading || !!moving}
              />
              <button className="btn new-order-button" onClick={() => setCreating(true)}>
                <Icon name="plus" size={18} />
                <span>Нове замовлення</span>
              </button>
            </div>
            <div className="orders-view-actions">
              {view === "kanban" && (
                <IconButton
                  icon={cardsCollapsed ? "expandCards" : "collapseCards"}
                  label={cardsCollapsed ? "Розгорнути картки" : "Згорнути картки"}
                  active={cardsCollapsed}
                  aria-pressed={cardsCollapsed}
                  onClick={toggleCardsCollapsed}
                />
              )}
              <div className="view-toggle icon-toggle" aria-label="Вигляд замовлень">
                <IconButton icon="board" label="Воронка" active={view === "kanban"} aria-pressed={view === "kanban"} onClick={() => setView("kanban")} />
                <IconButton icon="list" label="Список" active={view === "list"} aria-pressed={view === "list"} onClick={() => setView("list")} />
              </div>
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
          {!loading && !error && !filteredGroups.length && <div className="empty">Замовлень не знайдено</div>}

          {(!loading || filteredGroups.length > 0) && filteredGroups.length > 0 && (
            <div className="orders-totals" role="group" aria-label="Підсумок замовлень">
              <div className="summary-metric summary-count" title="Кількість замовлень без скасованих">
                <span>Замовлень</span>
                <strong>{grand.count}</strong>
              </div>
              <div className="summary-metric summary-total">
                <span>Загальна сума</span>
                <strong>{money(grand.revenue)}</strong>
              </div>
              <div className="summary-stat"><span>Маржа</span><strong>{money(grand.profit)}</strong></div>
              <div className="summary-stat debt"><span>Борг клієнтів</span><strong>{money(grand.clientLeft)}</strong></div>
              <div className="summary-stat margin"><span>Маржа до отримання</span><strong>{money(grand.marginLeft)}</strong></div>
              {view === "kanban" && (
                <div className="summary-info">
                  <InfoTip
                    desktopText="Перетягніть картку в інший стовпчик, щоб змінити статус."
                    mobileText="Гортайте стовпчики вбік. Статус змінюйте списком на картці."
                  />
                </div>
              )}
            </div>
          )}

          {filteredGroups.length > 0 && view === "kanban" && (
            <div className="kanban">
              {funnelStatuses.map(s => (
                <div
                  className={"col " + statusClass(s) + (dragOver === s ? " drag-over" : "")}
                  key={s}
                  onDragOver={e => {
                    if (s === MISSING_STATUS) return;
                    e.preventDefault();
                    setDragOver(s);
                  }}
                  onDragLeave={() => setDragOver(cur => cur === s ? "" : cur)}
                  onDrop={e => {
                    e.preventDefault();
                    setDragOver("");
                    const num = e.dataTransfer.getData("text/order") || dragOrderRef.current;
                    if (num && s !== MISSING_STATUS) moveToStatus(num, s);
                  }}
                >
                  <h3>
                    <div className="col-title">
                      <span>{s}</span>
                      <span>{byStatus[s].items.length}</span>
                    </div>
                    <div className={"col-metrics" + (s === "Скасовано" ? " is-cancelled" : "")}>
                      <div className="col-metric">
                        <span>Сума</span>
                        <strong>{s === "Скасовано" ? "—" : money(byStatus[s].revenue)}</strong>
                      </div>
                      <div className="col-metric profit">
                        <span>Маржа</span>
                        <strong>{s === "Скасовано" ? "—" : money(byStatus[s].profit)}</strong>
                      </div>
                      <div className="col-metric debt">
                        <span>Борг клієнта</span>
                        <strong>{s === "Скасовано" ? "—" : money(byStatus[s].client_left)}</strong>
                      </div>
                      <div className="col-metric margin">
                        <span>До отримання</span>
                        <strong>{s === "Скасовано" ? "—" : money(byStatus[s].margin_left)}</strong>
                      </div>
                    </div>
                  </h3>
                  <div className={"col-body" + (dragOver === s ? " drag-over" : "")}>
                    {byStatus[s].items.map(g => (
                      <div
                        key={g.order_number}
                        role="button"
                        tabIndex={0}
                        draggable
                        className={"card " + statusClass(g.status)
                          + (cardsCollapsed ? " is-collapsed" : "")
                          + (moving === g.order_number ? " dragging" : "")}
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
                        <div className="card-head">
                          <div className="num">{g.order_number}</div>
                          <span>{formatDateShort(g.created_at).split(" ")[0]}</span>
                        </div>
                        {g.status === MISSING_STATUS && <div className="meta" style={{ color: "#b54842" }}>{g.status_issue}</div>}
                        <div className="card-client">{g.client || "Клієнт не вказаний"}</div>
                        <div className="card-contact">
                          <ContactLinks order={g} onClickStop />
                          {g.city && <span className="card-city">{g.city}</span>}
                        </div>
                        <div className="card-collapse-divider" aria-hidden="true" />
                        {!cardsCollapsed && (
                          <div className="card-details">
                            <div className="card-finance">
                              <div><span>Сума</span><strong>{money(g.revenue)}</strong></div>
                              <div><span>Маржа</span><strong>{money(g.profit)}</strong></div>
                            </div>
                            {/* Оплати клієнта: видно борг просто на картці, без відкриття замовлення. */}
                            {(g.client_paid_sum > 0 || g.client_left > 0) && (
                              <div className={"card-payment " + (g.client_left > 0 ? "debt" : "paid")}>
                                {g.client_left > 0
                                  ? "Сплачено " + money(g.client_paid_sum) + " · борг " + money(g.client_left)
                                  : "Сплачено повністю"}
                              </div>
                            )}
                            {g.margin_left > 0 && g.client_left === 0 && (
                              <div className="card-payment margin">Маржа до отримання: {money(g.margin_left)}</div>
                            )}
                            <select
                              className="card-status mobile-only"
                              value={g.status}
                              aria-label={"Змінити статус " + g.order_number}
                              disabled={moving === g.order_number}
                              onClick={e => e.stopPropagation()}
                              onMouseDown={e => e.stopPropagation()}
                              onTouchStart={e => e.stopPropagation()}
                              onChange={e => {
                                e.stopPropagation();
                                moveToStatus(g.order_number, e.target.value);
                              }}
                            >
                              {g.status === MISSING_STATUS && <option value={MISSING_STATUS} disabled>{MISSING_STATUS}</option>}
                              {STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
                            </select>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {filteredGroups.length > 0 && view === "list" && (
            <div className="list">
              {filteredGroups.map(g => (
                <div
                  key={g.order_number}
                  className="row-card"
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenOrder(g.order_number);
                    }
                  }}
                  onClick={() => onOpenOrder(g.order_number)}
                >
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
      [MISSING_STATUS]: "#dc2626",
    };

    function MonthlyBarsChart({ monthly }) {
      const rows = (monthly || []).filter(m => (Number(m.revenue) || 0) !== 0 || (Number(m.profit) || 0) !== 0).slice().reverse();
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
                <div
                  className="dual-col"
                  key={m.month}
                  title={"Виручка " + money(rev) + " · Маржа " + money(mar)}
                  aria-label={m.month + ": виручка " + money(rev) + ", маржа " + money(mar)}
                >
                  <div className="dual-tip">
                    <span className="rev">{shortMoney(rev)}</span>
                    <span className="mar">{shortMoney(mar)}</span>
                  </div>
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
      const statuses = (byStatus && byStatus[MISSING_STATUS]) ? DISPLAY_STATUSES : STATUSES;
      const total = statuses.reduce((s, name) => s + ((byStatus && byStatus[name]) || 0), 0);
      const cancelled = (byStatus && byStatus["Скасовано"]) || 0;
      const financialOrders = Math.max(0, total - cancelled);
      return (
        <div className="chart-wrap status-chart">
          <div className="status-list">
            {statuses.map(s => {
              const n = (byStatus && byStatus[s]) || 0;
              const share = total ? Math.round((n / total) * 100) : 0;
              return (
                <div className="status-row" key={s}>
                  <div className="name">{s}</div>
                  <div className="track" aria-hidden="true">
                    <div className="fill" style={{
                      width: share + "%",
                      background: n ? STATUS_CHART_COLORS[s] : "transparent",
                    }} />
                  </div>
                  <div className="count" aria-label={n + " замовлень, " + share + "%"}>
                    <strong>{n}</strong><span>{share}%</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="chart-legend">
            <span>Усього карток: <strong style={{ color: "var(--ink)" }}>{total}</strong></span>
            <span>У фінансах: <strong style={{ color: "var(--ink)" }}>{financialOrders}</strong> без скасованих</span>
          </div>
        </div>
      );
    }

    function FinanceBarsChart({ revenue, cost, profit, commission, payouts, expenses }) {
      const rev = Number(revenue) || 0;
      const cst = Number(cost) || 0;
      const mar = Number(profit) || 0;
      const com = Number(commission) || 0;
      const paid = Number(payouts) || 0;
      const exp = Number(expenses) || 0;
      const base = Math.max(rev, cst + mar, 1);
      const costPct = Math.min(100, Math.round((cst / base) * 1000) / 10);
      const marPct = Math.min(100, Math.round((mar / base) * 1000) / 10);
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
              <span>Комісії нараховано</span>
              <span className="val">{money(com)}</span>
            </div>
            <div className="stack-row">
              <span className="chart-swatch" style={{ background: "#b18a48" }} />
              <span>Виплачено партнерам</span>
              <span className="val">{money(paid)}</span>
            </div>
            <div className="stack-row">
              <span className="chart-swatch" style={{ background: "#b42318" }} />
              <span>Інші витрати</span>
              <span className="val">{money(exp)}</span>
            </div>
          </div>
        </div>
      );
    }

    function MarginSplitChart({ profit, received, debt }) {
      const gross = Math.max(0, Number(profit) || 0);
      const a = Math.max(0, Number(received) || 0);
      const b = Math.max(0, Number(debt) || 0);
      const pending = Math.max(0, gross - a - b);
      const total = Math.max(gross, a + b);
      const pctReceived = total ? Math.round((a / total) * 100) : 0;
      const r = 54;
      const c = 2 * Math.PI * r;
      const aLen = total ? (a / total) * c : 0;
      const bLen = total ? (b / total) * c : 0;
      const pendingLen = total ? (pending / total) * c : 0;
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
              {total > 0 && pending > 0 && (
                <circle
                  cx="70" cy="70" r={r} fill="none" stroke="#9ca3af" strokeWidth="16"
                  strokeDasharray={`${pendingLen} ${c - pendingLen}`}
                  strokeDashoffset={-(aLen + bLen)}
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
              <div className="lab">Очікує оплати клієнта</div>
              <div className="num">{money(pending)}</div>
            </div>
            <div className="donut-stat total">
              <div className="lab">Валова маржа</div>
              <div className="num">{money(gross)}</div>
            </div>
          </div>
        </div>
      );
    }

    function DashboardView({ token, groups, expenses, payments, payouts, loading, error, refreshData, onOpenOrder }) {
      const [period, setPeriod] = useState("all");

      const filteredGroups = useMemo(
        () => (groups || []).filter(g => inPeriod(g, period)),
        [groups, period]
      );
      const filteredExpenses = useMemo(() => {
        return (expenses || []).filter(ex => dateInPeriod(ex.date, period));
      }, [expenses, period]);
      const filteredPayments = useMemo(
        () => (payments || []).filter(payment => dateInPeriod(payment.date, period)),
        [payments, period]
      );
      const filteredPayouts = useMemo(
        () => (payouts || []).filter(payout => dateInPeriod(payout.date, period)),
        [payouts, period]
      );
      const eligibleOrderNumbers = useMemo(
        () => new Set((groups || []).filter(g => g.status !== "Скасовано").map(g => String(g.order_number || ""))),
        [groups]
      );
      const marginCashReceived = useMemo(() => {
        let total = (filteredPayments || []).reduce((sum, payment) => {
          if (payment.type !== "Маржа від підрядника") return sum;
          if (!eligibleOrderNumbers.has(String(payment.order_number || ""))) return sum;
          return sum + (Number(payment.amount) || 0);
        }, 0);
        // У старих записів без журналу немає дати платежу: використовуємо дату замовлення.
        (filteredGroups || []).forEach(group => {
          if (group.status === "Скасовано" || Number(group.payments_count) > 0) return;
          total += groupPaymentMetrics(group).marginReceived;
        });
        return total;
      }, [filteredPayments, filteredGroups, eligibleOrderNumbers]);

      const t = useMemo(() => {
        const expSum = filteredExpenses.reduce((s, ex) => s + (Number(ex.amount) || 0), 0);
        const payoutSum = filteredPayouts.reduce((s, payout) => s + (Number(payout.amount) || 0), 0);
        return totalsFromGroups(filteredGroups, expSum, payoutSum, marginCashReceived);
      }, [filteredGroups, filteredExpenses, filteredPayouts, marginCashReceived]);

      const monthly = useMemo(
        () => monthlyFromGroups(
          filteredGroups,
          filteredExpenses,
          filteredPayments,
          filteredPayouts,
          eligibleOrderNumbers
        ),
        [filteredGroups, filteredExpenses, filteredPayments, filteredPayouts, eligibleOrderNumbers]
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
            <IconButton
              icon="refresh"
              label="Оновити зведення"
              className={loading ? "is-spinning" : ""}
              onClick={refreshData}
              disabled={loading}
            />
          </div>
          <div className="dashboard-basis">
            Виручка, собівартість і валова маржа — за датою замовлення. Надходження, виплати та витрати — за датою операції.
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
            <div className="kpi"><div className="label">Борг підрядника</div><div className="value">{money(t.margin_debt)}</div></div>
            <div className="kpi"><div className="label">Маржа надійшла</div><div className="value">{money(t.margin_cash_received)}</div><div className="sub">За датами платежів</div></div>
            <div className="kpi"><div className="label">Виплати + витрати</div><div className="value">{money((t.payouts_paid || 0) + (t.expenses || 0))}</div><div className="sub">Комісій нараховано: {money(t.commission)}</div></div>
            <div className="kpi"><div className="label">Чистий факт</div><div className="value">{money(t.net_fact)}</div></div>
          </div>

          <div className="charts-grid">
            <div className="panel">
              <div className="panel-head">
                <h2>Виручка і маржа по місяцях</h2>
                <InfoTip text="Сірий стовпчик — виручка, зелений — валова маржа замовлень за місяць їх створення." />
              </div>
              <MonthlyBarsChart monthly={monthly} />
            </div>
            <div className="panel">
              <div className="panel-head">
                <h2>Замовлення по статусах</h2>
                <InfoTip text="Кількість і частка від усіх карток. Фінансові показники не враховують скасовані замовлення." />
              </div>
              <StatusBarsChart byStatus={t.by_status} />
            </div>
            <div className="panel">
              <div className="panel-head">
                <h2>Структура фінансів</h2>
                <InfoTip text="Смуга показує структуру виручки: собівартість і валову маржу. Нижче окремо наведені нараховані комісії, фактичні виплати партнерам та інші витрати." />
              </div>
              <FinanceBarsChart
                revenue={t.revenue}
                cost={t.cost}
                profit={t.profit}
                commission={t.commission}
                payouts={t.payouts_paid}
                expenses={t.expenses}
              />
            </div>
            <div className="panel">
              <div className="panel-head">
                <h2>Стан маржі замовлень</h2>
                <InfoTip text="Повна валова маржа замовлень вибраного періоду: вже отримана, борг підрядника та сума, яка очікує повної оплати клієнта." />
              </div>
              <MarginSplitChart profit={t.profit} received={t.margin_received} debt={t.margin_debt} />
            </div>
          </div>

          <div className="panel">
            <h2>Помісячно</h2>
            <div className="panel-subtitle">Нарахування — за місяцем замовлення; рух коштів — за фактичною датою операції.</div>
            <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Місяць</th><th>Виручка</th><th>Собівартість</th><th>Валовий</th><th>Маржа %</th>
                  <th>Надійшло маржі</th><th>Борг підрядника</th><th>Комісії нараховано</th><th>Виплати партнерам</th><th>Витрати</th><th>Чистий факт</th>
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
                    <td>{money(m.payouts)}</td>
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

    function PartnersView({ token, payouts, refreshPayouts }) {
      const [partners, setPartners] = useState([]);
      const [error, setError] = useState("");
      const [form, setForm] = useState({ code: "", name: "", type: "ОСББ", contact: "", rate: 150 });
      const [payout, setPayout] = useState({ code: "", amount: "", method: "Переказ", note: "" });

      async function loadPartners() {
        const p = await api("/api/admin/partners", { token });
        setPartners(p.partners || []);
      }
      useEffect(() => { loadPartners().catch(e => setError(e.message)); }, [token]);

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
                await loadPartners();
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
                await refreshPayouts();
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
              <IconButton
                icon="refresh"
                label="Оновити клієнтів"
                className={loading ? "is-spinning" : ""}
                onClick={refreshOrders}
                disabled={loading}
              />
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
      const [groups, setGroups] = useState(() => {
        const cached = readAdminCache();
        return Array.isArray(cached.groups) ? cached.groups : [];
      });
      const [orderItems, setOrderItems] = useState(() => {
        const cached = readAdminCache();
        return Array.isArray(cached.orders) ? cached.orders : [];
      });
      const [expenses, setExpenses] = useState(() => {
        const cached = readAdminCache();
        return Array.isArray(cached.expenses) ? cached.expenses : [];
      });
      const [payments, setPayments] = useState(() => {
        const cached = readAdminCache();
        return Array.isArray(cached.payments) ? cached.payments : [];
      });
      const [payouts, setPayouts] = useState(() => {
        const cached = readAdminCache();
        return Array.isArray(cached.payouts) ? cached.payouts : [];
      });
      const [dataLoading, setDataLoading] = useState(false);
      const [ordersError, setOrdersError] = useState("");
      const [sessionMsg, setSessionMsg] = useState("");
      const [selectedOrder, setSelectedOrder] = useState(null);
      const topRef = useRef(null);
      const ordersRefreshRef = useRef(null);
      const dataRefreshRef = useRef(null);
      // Запит, розпочатий до успішної зміни, не має права повернути старий snapshot
      // поверх щойно збереженого замовлення.
      const mutationRevisionRef = useRef(0);

      function login(t) {
        sessionStorage.setItem(TOKEN_KEY, t);
        setToken(t);
        setSessionMsg("");
      }
      function logout(msg) {
        sessionStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(ORDERS_CACHE_KEY);
        setToken("");
        setGroups([]);
        setOrderItems([]);
        setExpenses([]);
        setPayments([]);
        setPayouts([]);
        setSelectedOrder(null);
        if (msg) setSessionMsg(msg);
      }

      useEffect(() => {
        function onUnauthorized() { logout("Сесія закінчилась — увійдіть знову"); }
        window.addEventListener("admin-unauthorized", onUnauthorized);
        return () => window.removeEventListener("admin-unauthorized", onUnauthorized);
      }, []);

      async function refreshOrders() {
        if (!token) return;
        if (ordersRefreshRef.current) return ordersRefreshRef.current;
        const request = (async () => {
          const requestRevision = mutationRevisionRef.current;
          setDataLoading(true);
          setOrdersError("");
          try {
            const data = await api("/api/admin/orders", { token });
            if (requestRevision !== mutationRevisionRef.current) return data;
            const nextGroups = normalizeOrderGroups(data);
            setGroups(nextGroups);
            const nextOrders = Array.isArray(data.orders) ? data.orders : [];
            setOrderItems(nextOrders);
            writeAdminCache({ groups: nextGroups, orders: nextOrders });
          } catch (e) {
            if (requestRevision !== mutationRevisionRef.current) return;
            const cached = readAdminCache();
            if (Array.isArray(cached?.groups) && cached.groups.length) {
              const savedAt = Number(cached.savedAt) || 0;
              const cacheLabel = savedAt
                ? new Date(savedAt).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })
                : "попереднього оновлення";
              setOrdersError(`${e.message}. Показано останні дані станом на ${cacheLabel}.`);
            } else {
              setOrdersError(e.message);
            }
            throw e;
          } finally {
            setDataLoading(false);
          }
        })();
        ordersRefreshRef.current = request;
        try {
          return await request;
        } finally {
          if (ordersRefreshRef.current === request) ordersRefreshRef.current = null;
        }
      }

      async function refreshExpenses() {
        if (!token) return;
        const data = await api("/api/admin/expenses", { token });
        const next = data.expenses || [];
        setExpenses(next);
        writeAdminCache({ expenses: next });
      }

      async function refreshPayments() {
        if (!token) return;
        const data = await api("/api/admin/payments", { token });
        const next = data.payments || [];
        setPayments(next);
        writeAdminCache({ payments: next });
      }

      async function refreshPayouts() {
        if (!token) return;
        const data = await api("/api/admin/payouts", { token });
        const next = data.payouts || [];
        setPayouts(next);
        writeAdminCache({ payouts: next });
      }

      async function refreshData() {
        if (!token) return;
        if (dataRefreshRef.current) return dataRefreshRef.current;
        const request = (async () => {
          const requestRevision = mutationRevisionRef.current;
          setDataLoading(true);
          setOrdersError("");
          try {
            // Один запуск Apps Script замість чотирьох послідовних: замовлення,
            // позиції, платежі, витрати й виплати повертаються одним snapshot.
            const data = await api("/api/admin/bootstrap", { token });
            if (requestRevision !== mutationRevisionRef.current) return data;
            const nextGroups = normalizeOrderGroups(data);
            const nextOrders = Array.isArray(data.orders) ? data.orders : [];
            const nextExpenses = Array.isArray(data.expenses) ? data.expenses : [];
            const nextPayments = Array.isArray(data.payments) ? data.payments : [];
            const nextPayouts = Array.isArray(data.payouts) ? data.payouts : [];
            setGroups(nextGroups);
            setOrderItems(nextOrders);
            setExpenses(nextExpenses);
            setPayments(nextPayments);
            setPayouts(nextPayouts);
            writeAdminCache({
              groups: nextGroups,
              orders: nextOrders,
              expenses: nextExpenses,
              payments: nextPayments,
              payouts: nextPayouts,
            });
          } catch (e) {
            if (requestRevision !== mutationRevisionRef.current) return;
            const cached = readAdminCache();
            if (Array.isArray(cached.groups) && cached.groups.length) {
              const savedAt = Number(cached.savedAt) || 0;
              const cacheLabel = savedAt
                ? new Date(savedAt).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })
                : "попереднього оновлення";
              setOrdersError(`${e.message}. Показано останні дані станом на ${cacheLabel}.`);
            } else {
              setOrdersError(e.message || "Не вдалося оновити дані CRM");
            }
            throw e;
          } finally {
            setDataLoading(false);
          }
        })();
        dataRefreshRef.current = request;
        try {
          return await request;
        } finally {
          if (dataRefreshRef.current === request) dataRefreshRef.current = null;
        }
      }

      function applyOrderUpdate(detail) {
        const orderNumber = String(
          detail?.order?.order_number || detail?.items?.[0]?.order_number || ""
        ).trim();
        if (!orderNumber || !detail?.order) return;

        mutationRevisionRef.current += 1;
        const nextItems = Array.isArray(detail.items) ? detail.items : [];
        const resolved = resolveOrderStatus(
          nextItems.length ? nextItems.map(item => item.status) : [detail.order.status]
        );
        const summary = detail.payment_summary || {};
        const nextOrder = {
          ...detail.order,
          ...resolved,
          client_paid_sum: summary.client_paid ?? detail.order.client_paid_sum,
          client_left: summary.client_left ?? detail.order.client_left,
          margin_received: summary.margin_received ?? detail.order.margin_received,
          margin_left: summary.margin_left ?? detail.order.margin_left,
        };

        setGroups(current => {
          const found = current.some(group => group.order_number === orderNumber);
          const next = found
            ? current.map(group => group.order_number === orderNumber ? nextOrder : group)
            : [nextOrder, ...current];
          writeAdminCache({ groups: next });
          return next;
        });

        if (nextItems.length) {
          setOrderItems(current => {
            const next = [];
            let inserted = false;
            current.forEach(item => {
              if (item.order_number === orderNumber) {
                if (!inserted) {
                  next.push(...nextItems);
                  inserted = true;
                }
              } else {
                next.push(item);
              }
            });
            if (!inserted) next.push(...nextItems);
            writeAdminCache({ orders: next });
            return next;
          });
        }

        if (Array.isArray(detail.payments)) {
          setPayments(current => {
            const next = current.filter(payment => payment.order_number !== orderNumber)
              .concat(detail.payments);
            writeAdminCache({ payments: next });
            return next;
          });
        }
        setOrdersError("");
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

      const selectedOrderData = useMemo(
        () => orderDetailFromSnapshot(selectedOrder, groups, orderItems, payments),
        [selectedOrder, groups, orderItems, payments]
      );

      useEffect(() => {
        if (!token) return;
        refreshData().catch(() => {});
        const m = window.location.hash.match(/^#order\/(.+)$/);
        if (m) {
          setSelectedOrder(decodeURIComponent(m[1]));
          setTab("orders");
        }
      }, [token]);

      useEffect(() => {
        const header = topRef.current;
        if (!token || !header) return;
        const syncStickyOffset = () => {
          document.documentElement.style.setProperty("--app-header-height", Math.ceil(header.getBoundingClientRect().height) + "px");
        };
        syncStickyOffset();
        const observer = window.ResizeObserver ? new ResizeObserver(syncStickyOffset) : null;
        observer?.observe(header);
        window.addEventListener("resize", syncStickyOffset);
        return () => {
          observer?.disconnect();
          window.removeEventListener("resize", syncStickyOffset);
        };
      }, [token]);

      if (!token) return (
        <>
          {sessionMsg && <div className="error" style={{ textAlign: "center", padding: 12 }}>{sessionMsg}</div>}
          <Login onLogin={login} />
        </>
      );

      return (
        <>
        <TooltipLayer />
        <div className="app">
          <div className="top" ref={topRef}>
            <div className="brand">
              <img src="/images/avalon-logo-7016.svg" alt="Avalon" />
              <div>
                <strong>CRM</strong>
                <span>внутрішній кабінет</span>
              </div>
            </div>
            <nav className="nav" aria-label="Розділи CRM">
              {NAV_ITEMS.map(item => (
                <IconButton
                  key={item.id}
                  icon={item.icon}
                  label={item.label}
                  active={tab === item.id}
                  aria-current={tab === item.id ? "page" : undefined}
                  onClick={() => setTab(item.id)}
                />
              ))}
            </nav>
            <div className="top-actions">
              <IconLink icon="form" label="Форма замовлення" href="/" />
              <IconButton icon="logout" label="Вийти" onClick={() => logout()} />
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
                onOrderChanged={applyOrderUpdate}
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
                payments={payments}
                payouts={payouts}
                loading={dataLoading}
                error={ordersError}
                refreshData={refreshData}
                onOpenOrder={openOrder}
              />
            </div>
            {tab === "partners" && (
              <div>
                <PartnersView token={token} payouts={payouts} refreshPayouts={refreshPayouts} />
              </div>
            )}
            <div style={{ display: tab === "expenses" ? "block" : "none" }}>
              <ExpensesView token={token} expenses={expenses} refreshExpenses={refreshExpenses} />
            </div>
          </main>
          {selectedOrder && (
            <OrderDrawer
              token={token}
              orderNumber={selectedOrder}
              initialData={selectedOrderData}
              snapshotLoading={dataLoading}
              onClose={closeOrder}
              onChanged={applyOrderUpdate}
            />
          )}
        </div>
        </>
      );
    }

    createRoot(document.getElementById("root")).render(<App />);
