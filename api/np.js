   // api/np.js — Vercel Serverless Function
// Proxy for Nova Poshta API — hides the API key from client code

const NP_API_URL = "https://api.novaposhta.ua/v2.0/json/";

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const NP_API_KEY = process.env.NP_API_KEY;
  if (!NP_API_KEY) {
    return res.status(500).json({ error: "NP_API_KEY not configured" });
  }

  try {
    const { modelName, calledMethod, methodProperties } = req.body;

    // Whitelist allowed methods to prevent API abuse
    const allowedMethods = {
      "Address": ["searchSettlements", "getWarehouses"],
    };

    if (!allowedMethods[modelName] || !allowedMethods[modelName].includes(calledMethod)) {
      return res.status(403).json({ error: "Method not allowed" });
    }

    const npRes = await fetch(NP_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: NP_API_KEY,
        modelName,
        calledMethod,
        methodProperties: methodProperties || {},
      }),
    });

    const data = await npRes.json();
    return res.status(200).json(data);
  } catch (err) {
    console.error("NP proxy error:", err);
    return res.status(500).json({ error: "NP API request failed" });
  }
}
