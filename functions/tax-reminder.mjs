// functions/tax-reminder.mjs
// Netlify Scheduled Function — Vergi Takvimi E-posta Bildirimi
// Çalışma zamanı: Her gün 09:00 TSI
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY

// ─── Türkiye Vergi Takvimi ────────────────────────────────────────────────────
// Her ay sabit tarihleri olan beyannameler + yıllık olanlar
function getTaxDeadlines(year, month) {
  const deadlines = [];

  // ── AYLIK BEYANNAMELEr ──
  // KDV Beyannamesi — her ayın 24'ü (önceki ay için)
  deadlines.push({
    tip: 'KDV Beyannamesi',
    emoji: '🧾',
    aciklama: `${month === 1 ? year - 1 : year} yılı ${getMonthName(month === 1 ? 12 : month - 1)} dönemi`,
    tarih: new Date(year, month - 1, 24),
    renk: '#4f8ef7',
  });

  // Muhtasar ve Prim Hizmet Beyannamesi — her ayın 26'sı
  deadlines.push({
    tip: 'Muhtasar & Prim Hizmet Beyannamesi',
    emoji: '👷',
    aciklama: `${getMonthName(month === 1 ? 12 : month - 1)} dönemi SGK + stopaj`,
    tarih: new Date(year, month - 1, 26),
    renk: '#22c897',
  });

  // ── GEÇİCİ VERGİ (yılda 4 kez) ──
  const geciciVergiler = [
    { ay: 5,  gun: 17, donem: '1. Dönem (Ocak-Mart)' },
    { ay: 8,  gun: 17, donem: '2. Dönem (Nisan-Haziran)' },
    { ay: 11, gun: 17, donem: '3. Dönem (Temmuz-Eylül)' },
    { ay: 2,  gun: 17, donem: '4. Dönem (Ekim-Aralık)', nextYear: true },
  ];
  geciciVergiler.forEach(gv => {
    const gvYear = gv.nextYear ? year + 1 : year;
    if (gv.ay === month) {
      deadlines.push({
        tip: 'Geçici Vergi Beyannamesi',
        emoji: '📊',
        aciklama: `${gv.donem}`,
        tarih: new Date(gvYear, gv.ay - 1, gv.gun),
        renk: '#f5a623',
      });
    }
  });

  // ── BA / BS FORMLARI — her ayın 31'i (önceki ay) ──
  const lastDay = new Date(year, month, 0).getDate(); // ayın son günü
  deadlines.push({
    tip: 'BA-BS Formu',
    emoji: '📋',
    aciklama: `${getMonthName(month === 1 ? 12 : month - 1)} dönemi bildirim formu`,
    tarih: new Date(year, month - 1, Math.min(31, lastDay)),
    renk: '#7b5cf0',
  });

  // ── YILLIK BEYANNAMELER ──
  if (month === 4) {
    // Kurumlar Vergisi — 30 Nisan
    deadlines.push({
      tip: 'Kurumlar Vergisi Beyannamesi',
      emoji: '🏢',
      aciklama: `${year - 1} hesap dönemi — son başvuru tarihi`,
      tarih: new Date(year, 3, 30),
      renk: '#ef4444',
      onemli: true,
    });
  }
  if (month === 3) {
    // Gelir Vergisi — 31 Mart
    deadlines.push({
      tip: 'Gelir Vergisi Beyannamesi',
      emoji: '💰',
      aciklama: `${year - 1} takvim yılı gelir beyanı`,
      tarih: new Date(year, 2, 31),
      renk: '#ef4444',
      onemli: true,
    });
  }

  return deadlines;
}

function getMonthName(month) {
  const names = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
  return names[(month - 1 + 12) % 12];
}

// ─── Kaç gün kaldığını hesapla ───────────────────────────────────────────────
function daysUntil(targetDate) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(targetDate);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - now) / (1000 * 60 * 60 * 24));
}

// ─── E-posta HTML şablonu ────────────────────────────────────────────────────
function buildEmailHTML(user, urgentItems) {
  const itemsHTML = urgentItems.map(item => {
    const days = item.daysLeft;
    const urgencyColor = days <= 1 ? '#ef4444' : days <= 3 ? '#f5a623' : '#4f8ef7';
    const urgencyText = days === 0 ? 'BUGÜN son gün!' : days === 1 ? 'Yarın son gün!' : `${days} gün kaldı`;
    return `
      <div style="background:#1a1a24;border-left:3px solid ${urgencyColor};border-radius:8px;padding:16px 20px;margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <div style="font-size:16px;color:#f0f0f5;font-weight:500;margin-bottom:4px">${item.emoji} ${item.tip}</div>
            <div style="font-size:13px;color:#8888a0">${item.aciklama}</div>
          </div>
          <div style="text-align:right;flex-shrink:0;margin-left:16px">
            <div style="color:${urgencyColor};font-weight:600;font-size:14px">${urgencyText}</div>
            <div style="color:#555568;font-size:11px;font-family:monospace;margin-top:2px">
              ${item.tarih.toLocaleDateString('tr-TR', {day:'numeric',month:'long',year:'numeric'})}
            </div>
          </div>
        </div>
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="tr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:'Segoe UI',Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:40px 20px">
    <div style="margin-bottom:32px">
      <div style="display:inline-flex;align-items:center;gap:8px;background:#111118;border:1px solid rgba(79,142,247,.2);border-radius:8px;padding:8px 16px">
        <div style="width:22px;height:22px;background:#4f8ef7;border-radius:5px;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;color:#fff">F</div>
        <span style="color:#8888a0;font-size:13px">FinAnaliz Pro</span>
      </div>
    </div>
    <h1 style="color:#f0f0f5;font-size:24px;font-weight:600;margin-bottom:8px;letter-spacing:-0.5px">
      📅 Beyanname Hatırlatması
    </h1>
    <p style="color:#8888a0;font-size:14px;margin-bottom:28px">
      Merhaba, yaklaşan vergi beyanname tarihlerinizi aşağıda bulabilirsiniz.
    </p>
    ${itemsHTML}
    <div style="margin-top:28px;text-align:center">
      <a href="https://finanaliz.netlify.app/app" 
         style="display:inline-block;background:#4f8ef7;color:#fff;text-decoration:none;padding:12px 28px;border-radius:9px;font-size:14px;font-weight:500">
        Takvimi Aç →
      </a>
    </div>
    <div style="margin-top:32px;padding-top:20px;border-top:1px solid rgba(255,255,255,.06);font-size:11px;color:#555568;text-align:center">
      Bu bildirimi almak istemiyorsanız hesap ayarlarınızdan kapatabilirsiniz.<br>
      © 2025 FinAnaliz Pro
    </div>
  </div>
</body>
</html>`;
}

// ─── Ana handler ─────────────────────────────────────────────────────────────
export const handler = async () => {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_KEY   = process.env.RESEND_API_KEY; // resend.com — ücretsiz 3K/ay

  if (!SUPABASE_URL || !SUPABASE_KEY || !RESEND_KEY) {
    console.error('Eksik env var');
    return { statusCode: 500, body: 'Config error' };
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  // Bu ay + gelecek ay deadline'larını al
  const thisMonth  = getTaxDeadlines(year, month);
  const nextMonth  = getTaxDeadlines(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1);
  const allDeadlines = [...thisMonth, ...nextMonth];

  // Bugün, 1 gün, 3 gün kalan deadline'ları filtrele
  const urgentDeadlines = allDeadlines
    .map(d => ({ ...d, daysLeft: daysUntil(d.tarih) }))
    .filter(d => d.daysLeft >= 0 && d.daysLeft <= 3)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  if (urgentDeadlines.length === 0) {
    console.log('Bugün gönderilecek hatırlatma yok');
    return { statusCode: 200, body: 'No reminders today' };
  }

  // Pro/Büro kullanıcılarını Supabase'den çek
  const usersRes = await fetch(
    `${SUPABASE_URL}/rest/v1/analizler?select=user_email&order=user_email`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  const usersRaw = await usersRes.json();

  // Unique email'leri al (plan kontrolü için users tablosu eklenebilir)
  const emails = [...new Set(usersRaw.map(u => u.user_email).filter(Boolean))];

  let sentCount = 0;
  const errors = [];

  for (const email of emails) {
    try {
      const html = buildEmailHTML({ email }, urgentDeadlines);
      const subject = urgentDeadlines.some(d => d.daysLeft <= 1)
        ? `🚨 Beyanname Son Gün! — ${urgentDeadlines.find(d => d.daysLeft <= 1).tip}`
        : `📅 ${urgentDeadlines.length} Beyanname Yaklaşıyor — FinAnaliz Pro`;

      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'FinAnaliz Pro <bildirim@finanaliz.net>',
          to: [email],
          subject,
          html,
        }),
      });

      if (emailRes.ok) {
        sentCount++;
      } else {
        const err = await emailRes.text();
        errors.push({ email, err });
      }
    } catch (e) {
      errors.push({ email, err: e.message });
    }
  }

  console.log(`Gönderildi: ${sentCount}/${emails.length}, Hata: ${errors.length}`);
  return {
    statusCode: 200,
    body: JSON.stringify({ sent: sentCount, errors: errors.length, urgentCount: urgentDeadlines.length })
  };
};
