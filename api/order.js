// /api/order.js — Vercel Serverless Function
// Приймає замовлення з форми і відправляє в Telegram + Google Sheets

import { IncomingForm } from 'formidable';
import fs from 'fs';
import fetch from 'node-fetch';

export const config = {
  api: { bodyParser: false }
};

// Parse multipart form data
function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = new IncomingForm({ keepExtensions: true, maxFileSize: 10 * 1024 * 1024 });
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

// Format Telegram message
function formatTelegramMessage(order) {
  return `🆕 *Нове замовлення кошика*

👤 *${order.first_name} ${order.last_name || ""}*
📞 ${order.phone}
🏙 ${order.city || "—"}

📦 Конструкція: ${order.construction_type}
🧱 Тип: ${order.basket_type}
🔢 Кількість: ${order.quantity} шт.
🎨 Колір: ${order.color || "—"}${order.color_custom ? " (" + order.color_custom + ")" : ""}
🔲 Візерунок: ${order.pattern || "—"}${order.pattern_custom ? " (" + order.pattern_custom + ")" : ""}
📐 Розміри: W=${order.size_w}, H=${order.size_h}, D=${order.size_d} мм
🚚 Доставка: ${order.transport || "—"}${order.transport_custom ? " (" + order.transport_custom + ")" : ""}
📍 Адреса: ${order.delivery_address || "—"}
📅 Дата: ${order.delivery_date || "—"}
💳 Оплата: ${order.payment_method}
📣 Як дізнались: ${order.how_found || "—"}${order.how_found_custom ? " (" + order.how_found_custom + ")" : ""}
💬 Примітки: ${order.notes || "—"}`;
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { fields, files } = await parseForm(req);
    
    // Parse order data
    const orderRaw = fields.order;
    const orderStr = Array.isArray(orderRaw) ? orderRaw[0] : orderRaw;
    const order = JSON.parse(orderStr);
    
    // Get env vars
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    const GOOGLE_SHEET_URL = process.env.GOOGLE_SHEET_URL;

    const results = { telegram: null, google_sheets: null };

    // ---- TELEGRAM ----
    if (BOT_TOKEN && CHAT_ID) {
      try {
        // Send text message
        const text = formatTelegramMessage(order);
        const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'Markdown' })
        });
        results.telegram = tgRes.ok ? 'sent' : 'error';

        // Send file if attached
        const file = files.file;
        const fileObj = Array.isArray(file) ? file[0] : file;
        if (fileObj) {
          const FormData = (await import('form-data')).default;
          const fd = new FormData();
          fd.append('chat_id', CHAT_ID);
          fd.append('document', fs.createReadStream(fileObj.filepath), fileObj.originalFilename);
          fd.append('caption', `📎 Файл візерунку: ${order.first_name} ${order.last_name || ""}`);
          
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
            method: 'POST',
            body: fd,
            headers: fd.getHeaders()
          });
        }
      } catch (err) {
        console.error('Telegram error:', err);
        results.telegram = 'error';
      }
    }

    // ---- GOOGLE SHEETS ----
    if (GOOGLE_SHEET_URL) {
      try {
        const gsRes = await fetch(GOOGLE_SHEET_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            timestamp: new Date().toISOString(),
            ...order
          })
        });
        results.google_sheets = gsRes.ok ? 'sent' : 'error';
      } catch (err) {
        console.error('Google Sheets error:', err);
        results.google_sheets = 'error';
      }
    }

    return res.status(200).json({ ok: true, results });

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
