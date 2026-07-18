const { checkPassword, issueToken, setAdminCors, handleOptions } = require("../../lib/admin-auth");

module.exports = async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === "OPTIONS") return handleOptions(req, res);
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.ADMIN_PASSWORD) {
    return res.status(503).json({
      error: "ADMIN_PASSWORD is not configured. Add it in Vercel Environment Variables.",
    });
  }

  const password = req.body && req.body.password;
  if (!checkPassword(password)) {
    return res.status(401).json({ error: "Невірний пароль" });
  }

  const token = issueToken();
  const maxAge = 12 * 60 * 60;
  const secure = process.env.NODE_ENV === "production" || process.env.VERCEL ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `avalon_admin=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`
  );
  return res.status(200).json({ ok: true, token, expires_in: maxAge });
};
