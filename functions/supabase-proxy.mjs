// functions/supabase-proxy.mjs
// Netlify Function — Supabase CRUD proxy
// Env vars gerekli: SUPABASE_URL, SUPABASE_SERVICE_KEY

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Supabase env vars not set." }) };
  }

  try {
    const { action, userEmail, data } = JSON.parse(event.body);

    if (!userEmail) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "userEmail required" }) };

    const sbFetch = (path, method = "GET", body = null) =>
      fetch(`${SUPABASE_URL}/rest/v1${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Prefer": method === "POST" ? "return=representation" : "",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });

    // KAYDET
    if (action === "save") {
      const { sirketAdi, sektor, donem, rasyoJson, aiYorum } = data;
      const res = await sbFetch("/analizler", "POST", {
        user_email: userEmail,
        sirket_adi: sirketAdi || "",
        sektor: sektor || "",
        donem: donem || "",
        rasyo_json: rasyoJson || {},
        ai_yorum: aiYorum || "",
      });
      const result = await res.json();
      if (!res.ok) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: result.message || "Kayıt hatası" }) };
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, id: result[0]?.id }) };
    }

    // LİSTELE
    if (action === "list") {
      const res = await sbFetch(
        `/analizler?user_email=eq.${encodeURIComponent(userEmail)}&order=olusturma_tarihi.desc&limit=50`,
        "GET"
      );
      const rows = await res.json();
      if (!res.ok) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Liste hatası" }) };
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rows) };
    }

    // SİL
    if (action === "delete") {
      const { id } = data;
      const res = await sbFetch(
        `/analizler?id=eq.${id}&user_email=eq.${encodeURIComponent(userEmail)}`,
        "DELETE"
      );
      if (!res.ok) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Silme hatası" }) };
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Geçersiz action" }) };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Proxy: " + err.message }) };
  }
};
