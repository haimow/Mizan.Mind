// functions/supabase-proxy.mjs
// Netlify Function — Supabase CRUD + Storage proxy
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY

import { createHash, randomBytes } from 'crypto';

// ─── Rate limiting (in-memory, per serverless instance) ──────────────────────
const rateLimitMap = new Map();
function checkRateLimit(ip, maxReq = 60, windowMs = 60000) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > windowMs) { entry.count = 1; entry.start = now; }
  else entry.count++;
  rateLimitMap.set(ip, entry);
  return entry.count <= maxReq;
}

// ─── Güvenli dosya path üretimi ──────────────────────────────────────────────
// Email'i hiçbir zaman path'de kullanma.
// Path: sha256(userId+secret)[0:16] / randomUUID / randomToken.ext
// Bu yapı: tahmin edilemez, listeleme yapılamaz, email sızdırmaz.
function generateSecurePath(userId, analizId, originalExt) {
  const secret = process.env.PATH_SECRET || 'dijitalmizan-path-secret-change-me';
  // Kullanıcı prefix'i: userId + secret hash'inin ilk 16 karakteri
  const userHash = createHash('sha256').update(userId + secret).digest('hex').substring(0, 16);
  // Dosya adı: tamamen rastgele 32 karakter + orijinal uzantı
  const fileToken = randomBytes(16).toString('hex');
  const safeExt = ['xlsx','xls','csv','pdf'].includes(originalExt) ? originalExt : 'bin';
  return `${userHash}/${analizId}/${fileToken}.${safeExt}`;
}

// ─── Input validation ────────────────────────────────────────────────────────
function isValidEmail(email) {
  return typeof email === 'string' &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    email.length < 256;
}
function isValidPath(path) {
  if (!path || typeof path !== 'string') return false;
  if (path.includes('..') || path.includes('%2e') || path.includes('%2E')) return false;
  if (path.includes('//') || path.startsWith('/')) return false;
  if (!/^[a-f0-9]{16}\/[0-9a-f-]{36}\/[a-f0-9]{32}\.[a-z]{2,4}$/.test(path)) return false;
  if (path.length > 200) return false;
  return true;
}
function isValidUUID(id) {
  return typeof id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

// JWT doğrulama Netlify'ın context.clientContext.user üzerinden yapılır —
// imza doğrulaması Netlify altyapısı tarafından garanti edilir.

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://mizanmind.netlify.app';

const CORS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

export const handler = async (event, context) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };

  // ─── Rate limiting
  const clientIP = event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (!checkRateLimit(clientIP)) {
    return { statusCode: 429, headers: CORS, body: JSON.stringify({ error: "Too many requests" }) };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Server config error" }) };
  }

  try {
    let body;
    try { body = JSON.parse(event.body); }
    catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid JSON" }) }; }

    const { action, data = {} } = body;

    // ─── CONFIG — sadece anon key, kimlik doğrulamasız OK
    if (action === "config") {
      return {
        statusCode: 200, headers: CORS,
        body: JSON.stringify({ url: SUPABASE_URL, anonKey: process.env.SUPABASE_ANON_KEY || "" })
      };
    }

    // ─── Diğer tüm işlemler için JWT zorunlu
    // Netlify, Authorization header'daki Identity token'ı doğrulayarak
    // context.clientContext.user'ı doldurur — imza sunucu tarafında garanti edilir.
    const netlifyUser = context.clientContext?.user;
    if (!netlifyUser?.email || !netlifyUser?.sub) {
      return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: "Kimlik doğrulama gerekli" }) };
    }

    const verifiedEmail = netlifyUser.email;
    const verifiedSub = netlifyUser.sub; // Netlify Identity UUID

    if (!isValidEmail(verifiedEmail)) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Geçersiz hesap" }) };
    }

    const sbFetch = (path, method = "GET", body = null, extraHeaders = {}) =>
      fetch(`${SUPABASE_URL}/rest/v1${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Prefer": method === "POST" ? "return=representation" : "",
          ...extraHeaders,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });

    const storageFetch = (path, method = "GET", body = null, contentType = "application/json") =>
      fetch(`${SUPABASE_URL}/storage/v1${path}`, {
        method,
        headers: {
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          ...(contentType ? { "Content-Type": contentType } : {}),
        },
        ...(body !== null ? { body } : {}),
      });

    // ─── PATH GÜNCELLE
    if (action === "updatePath") {
      const { id, dosyaPath, dosyaAdi } = data;
      if (!isValidUUID(id)) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Geçersiz ID" }) };
      if (!isValidPath(dosyaPath)) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Geçersiz path" }) };
      // Path'in bu kullanıcıya ait userHash prefix'iyle başladığını doğrula
      const secret = process.env.PATH_SECRET || 'dijitalmizan-path-secret-change-me';
      const expectedHash = createHash('sha256').update(verifiedSub + secret).digest('hex').substring(0, 16);
      if (!dosyaPath.startsWith(expectedHash + '/')) {
        return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: "Yetkisiz path" }) };
      }
      const res = await sbFetch(
        `/analizler?id=eq.${id}&user_email=eq.${encodeURIComponent(verifiedEmail)}`,
        "PATCH",
        { dosya_path: dosyaPath, dosya_adi: String(dosyaAdi).substring(0, 255) },
        { "Prefer": "" }
      );
      if (!res.ok) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Güncelleme hatası" }) };
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
    }

    // ─── KAYDET
    if (action === "save") {
      const { sirketAdi, sektor, donem, rasyoJson, aiYorum, dosyaAdi } = data;
      const res = await sbFetch("/analizler", "POST", {
        user_email: verifiedEmail,
        sirket_adi: String(sirketAdi || '').substring(0, 255),
        sektor: String(sektor || '').substring(0, 50),
        donem: String(donem || '').substring(0, 100),
        rasyo_json: (typeof rasyoJson === 'object' && rasyoJson !== null) ? rasyoJson : {},
        ai_yorum: String(aiYorum || '').substring(0, 10000),
        dosya_adi: String(dosyaAdi || '').substring(0, 255),
      });
      const result = await res.json();
      if (!res.ok) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Kayıt hatası" }) };
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, id: result[0]?.id }) };
    }

    // ─── LİSTELE
    if (action === "list") {
      const res = await sbFetch(
        `/analizler?user_email=eq.${encodeURIComponent(verifiedEmail)}&order=olusturma_tarihi.desc&limit=50`,
        "GET"
      );
      const rows = await res.json();
      if (!res.ok) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Liste hatası" }) };
      // Strip dosya_path — clients never need the raw storage path.
      // Replace with has_file boolean so the UI can still show the download button.
      const sanitized = rows.map(({ dosya_path, ...rest }) => ({ ...rest, has_file: !!dosya_path }));
      return { statusCode: 200, headers: CORS, body: JSON.stringify(sanitized) };
    }

    // ─── SİL
    if (action === "delete") {
      const { id } = data;
      if (!isValidUUID(id)) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Geçersiz ID" }) };
      // Sahiplik doğrula — path'i client'tan alma, DB'den al
      const checkRes = await sbFetch(
        `/analizler?id=eq.${id}&user_email=eq.${encodeURIComponent(verifiedEmail)}&select=id,dosya_path`,
        "GET"
      );
      const checkRows = await checkRes.json();
      if (!checkRows || checkRows.length === 0) {
        return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: "Bu kayıt size ait değil" }) };
      }
      const dbPath = checkRows[0]?.dosya_path;
      if (dbPath && isValidPath(dbPath)) {
        await storageFetch(`/object/analizler/${dbPath}`, "DELETE", null, null);
      }
      const res = await sbFetch(
        `/analizler?id=eq.${id}&user_email=eq.${encodeURIComponent(verifiedEmail)}`,
        "DELETE"
      );
      if (!res.ok) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Silme hatası" }) };
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
    }

    // ─── DOSYA YÜKLE — güvenli path üretimi
    if (action === "uploadFile") {
      const { analizId, dosyaAdi, base64Data, mimeType } = data;
      if (!isValidUUID(analizId)) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Geçersiz ID" }) };

      // MIME tipi whitelist
      const allowedMime = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'application/vnd.ms-excel.sheet.binary.macroenabled.12',
        'text/csv',
        'application/pdf',
        'application/xml',
        'text/xml'
      ];
      if (!allowedMime.includes(mimeType)) {
        return { statusCode: 415, headers: CORS, body: JSON.stringify({ error: "Desteklenmeyen dosya tipi" }) };
      }

      // Dosya boyutu kontrolü (base64 → gerçek boyut)
      const estimatedSize = (base64Data.length * 3) / 4;
      if (estimatedSize > 20 * 1024 * 1024) {
        return { statusCode: 413, headers: CORS, body: JSON.stringify({ error: "Dosya 20MB sınırını aşıyor" }) };
      }

      // Orijinal uzantıyı al — ama orijinal adı path'de KULLANMA
      const origExt = String(dosyaAdi || '').split('.').pop().toLowerCase();

      // GÜVENLİ PATH: email/ad değil, hash/uuid/random-token
      // Örnek: a1b2c3d4e5f6a7b8 / 3f7a1234-... / ff00aa11bb22cc33dd44ee55ff66.xlsx
      const securePath = generateSecurePath(verifiedSub, analizId, origExt);

      const fileBuffer = Buffer.from(base64Data, "base64");

      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/analizler/${securePath}`, {
        method: "POST",
        headers: {
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Content-Type": mimeType,
          "x-upsert": "false", // Üzerine yazma engeli
        },
        body: fileBuffer,
      });

      if (!res.ok) {
        const err = await res.text();
        console.error('Storage upload error:', err);
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Dosya kaydedilemedi" }) };
      }

      // Orijinal adı DB'de sakla (kullanıcı görmesi için), ama path gizli
      const patchRes = await sbFetch(
        `/analizler?id=eq.${analizId}&user_email=eq.${encodeURIComponent(verifiedEmail)}`,
        "PATCH",
        { dosya_path: securePath, dosya_adi: String(dosyaAdi || '').substring(0, 255) },
        { "Prefer": "" }
      );
      if (!patchRes.ok) {
        const err = await patchRes.text();
        console.error('DB patch error after upload:', err);
        // Storage'a yüklendi ama DB güncellenemedi — hata döndür
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Dosya kaydedildi ama kayıt güncellenemedi" }) };
      }

      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
      // NOT: securePath client'a döndürülmüyor — sadece DB'de
    }

    // ─── DOSYA İNDİR — sahiplik doğrulama + kısa süreli signed URL
    if (action === "getFileUrl") {
      const { id } = data; // dosyaPath değil, analiz ID'si
      if (!isValidUUID(id)) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Geçersiz ID" }) };

      // Path'i DB'den al — client asla path'i bilmez
      const checkRes = await sbFetch(
        `/analizler?id=eq.${id}&user_email=eq.${encodeURIComponent(verifiedEmail)}&select=dosya_path,dosya_adi`,
        "GET"
      );
      const checkRows = await checkRes.json();
      if (!checkRows || checkRows.length === 0 || !checkRows[0]?.dosya_path) {
        return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: "Dosya bulunamadı" }) };
      }

      const dbPath = checkRows[0].dosya_path;
      const dosyaAdi = checkRows[0].dosya_adi || 'dosya';

      if (!isValidPath(dbPath)) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Geçersiz kayıt" }) };
      }

      // 5 dakikalık tek seferlik signed URL
      const signRes = await storageFetch(
        `/object/sign/analizler/${dbPath}`,
        "POST",
        JSON.stringify({ expiresIn: 300 })
      );
      const signResult = await signRes.json();
      if (!signRes.ok) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Bağlantı oluşturulamadı" }) };

      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({
          url: `${SUPABASE_URL}/storage/v1${signResult.signedURL}`,
          dosyaAdi // Orijinal adı indirme için client'a ver ama path'i verme
        })
      };
    }

    // ─── E-DEFTER ANOMALİ RAPORU — KAYDET
    if (action === "defterSave") {
      const { dosyaAdi, donem, entriesCount, riskScore, summaryJson, anomaliesJson } = data;
      const res = await sbFetch("/defter_raporlari", "POST", {
        user_email: verifiedEmail,
        dosya_adi: String(dosyaAdi || '').substring(0, 255),
        donem: String(donem || '').substring(0, 100),
        entries_count: Number.isFinite(+entriesCount) ? +entriesCount : 0,
        risk_score: Number.isFinite(+riskScore) ? Math.max(0, Math.min(100, Math.round(+riskScore))) : 0,
        summary_json: (typeof summaryJson === 'object' && summaryJson !== null) ? summaryJson : {},
        anomalies_json: (typeof anomaliesJson === 'object' && anomaliesJson !== null) ? anomaliesJson : [],
      });
      const result = await res.json();
      if (!res.ok) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Kayıt hatası" }) };
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, id: result[0]?.id }) };
    }

    // ─── E-DEFTER LİSTELE
    if (action === "defterList") {
      const res = await sbFetch(
        `/defter_raporlari?user_email=eq.${encodeURIComponent(verifiedEmail)}&order=olusturma_tarihi.desc&limit=50&select=id,dosya_adi,donem,entries_count,risk_score,summary_json,olusturma_tarihi`,
        "GET"
      );
      const rows = await res.json();
      if (!res.ok) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Liste hatası" }) };
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rows) };
    }

    // ─── E-DEFTER GETİR (tam rapor — anomalies_json dahil)
    if (action === "defterGet") {
      const { id } = data;
      if (!isValidUUID(id)) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Geçersiz ID" }) };
      const res = await sbFetch(
        `/defter_raporlari?id=eq.${id}&user_email=eq.${encodeURIComponent(verifiedEmail)}`,
        "GET"
      );
      const rows = await res.json();
      if (!res.ok || !rows || rows.length === 0) {
        return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: "Rapor bulunamadı" }) };
      }
      return { statusCode: 200, headers: CORS, body: JSON.stringify(rows[0]) };
    }

    // ─── E-DEFTER SİL
    if (action === "defterDelete") {
      const { id } = data;
      if (!isValidUUID(id)) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Geçersiz ID" }) };
      const res = await sbFetch(
        `/defter_raporlari?id=eq.${id}&user_email=eq.${encodeURIComponent(verifiedEmail)}`,
        "DELETE"
      );
      if (!res.ok) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Silme hatası" }) };
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Geçersiz istek" }) };

  } catch (err) {
    console.error('Proxy error:', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Sunucu hatası" }) };
  }
};
