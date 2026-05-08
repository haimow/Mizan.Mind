// retention-cleanup.mjs — KVKK Madde 4 (veri minimizasyonu) saklama TTL temizleyicisi
// Cron: günlük 03:00 UTC (netlify.toml'da yapılandırılmış)
//
// İki geçiş:
//   (1) UYARI: süresi 7 gün içinde dolacak analizleri belirle, kullanıcıya e-posta gönder, warning_sent_at işaretle
//   (2) SİL  : süresi geçmiş analizleri Storage'dan + DB'den sil, deletion_log'a denetim kaydı düş
//
// Uzatma mantığı: extended_until NULL ise olusturma_tarihi + 180 gün; doluysa onu kullan.
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY, URL (siteUrl)

const TTL_DAYS = 180;          // 6 ay
const WARN_DAYS = 7;           // 7 gün önceden uyarı
const FROM_ADDR = 'Mizan Mind <onboarding@resend.dev>'; // TODO: doğrulanmış domain alındığında güncellenecek

export const handler = async () => {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_KEY   = process.env.RESEND_API_KEY;
  const SITE_URL     = process.env.URL || 'https://mizanmind.netlify.app';

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('[retention-cleanup] eksik SUPABASE env');
    return { statusCode: 500, body: 'Config error' };
  }

  const sb = (path, method = 'GET', body = null, extra = {}) =>
    fetch(`${SUPABASE_URL}/rest/v1${path}`, {
      method,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        ...extra,
      },
      body: body ? JSON.stringify(body) : null,
    });

  const storageDelete = (path) =>
    fetch(`${SUPABASE_URL}/storage/v1/object/analizler/${path}`, {
      method: 'DELETE',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });

  const now = Date.now();
  const cutoffDelete = new Date(now - TTL_DAYS * 86400000).toISOString();
  const cutoffWarn   = new Date(now - (TTL_DAYS - WARN_DAYS) * 86400000).toISOString();

  let warned = 0, warnEmails = 0, deletedRows = 0, deletedFiles = 0, errors = 0;

  // ─── (1) UYARI GEÇİŞİ ─────────────────────────────────────────────────────
  // Süresi 7 gün içinde dolacak (extended_until ihmaliyle ham yaş kontrolü), uyarı henüz gönderilmemiş
  // PostgREST: olusturma_tarihi <= cutoffWarn AND olusturma_tarihi > cutoffDelete AND warning_sent_at IS NULL AND (extended_until IS NULL OR extended_until <= now+7d)
  // Pratik: önce warning_sent_at IS NULL olanları çekip JS'de süzelim.
  try {
    const wRes = await sb(
      `/analizler?warning_sent_at=is.null&olusturma_tarihi=lte.${encodeURIComponent(cutoffWarn)}&olusturma_tarihi=gt.${encodeURIComponent(cutoffDelete)}&select=id,user_email,sirket_adi,donem,olusturma_tarihi,extended_until&limit=500`,
      'GET'
    );
    const expiringRows = (await wRes.json()) || [];
    // extended_until ile süresi uzatılmışsa atla
    const reallyExpiring = expiringRows.filter(r => {
      if (!r.extended_until) return true;
      return new Date(r.extended_until).getTime() < now + WARN_DAYS * 86400000;
    });

    // Kullanıcı bazında grupla
    const byUser = {};
    for (const r of reallyExpiring) {
      if (!byUser[r.user_email]) byUser[r.user_email] = [];
      byUser[r.user_email].push(r);
    }

    if (RESEND_KEY) {
      for (const [email, rows] of Object.entries(byUser)) {
        const itemsHtml = rows.map(r => {
          const exp = new Date(new Date(r.olusturma_tarihi).getTime() + TTL_DAYS * 86400000).toLocaleDateString('tr-TR');
          return `<li><strong>${escapeHtml(r.sirket_adi || '(adsız)')}</strong> · ${escapeHtml(r.donem || '—')} → ${exp} tarihinde silinecek</li>`;
        }).join('');
        const html = `
          <div style="font-family:-apple-system,Inter,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1d1d1f">
            <h2 style="margin:0 0 12px">📁 Mizan Mind — Saklama Süresi Hatırlatması</h2>
            <p style="line-height:1.6;color:#424245">Aşağıdaki kayıtlı analizleriniz <strong>${WARN_DAYS} gün içinde otomatik olarak silinecek</strong> (KVKK Madde 4 — veri minimizasyonu kapsamında, varsayılan saklama süresi 6 aydır).</p>
            <ul style="line-height:1.7;color:#1d1d1f">${itemsHtml}</ul>
            <p style="line-height:1.6;color:#424245">Saklamak isterseniz <a href="${SITE_URL}/app/" style="color:#0071e3">Mizan Mind'e giriş yapın</a> → Kayıtlı sekmesinden ilgili analize tıklayın → <strong>"⏱ 6 ay uzat"</strong> butonunu kullanın.</p>
            <p style="line-height:1.6;color:#6e6e73;font-size:13px">İşlem yapmazsanız belirtilen tarihte tüm dosyalar ve özet veriler kalıcı olarak silinir.</p>
            <p style="margin-top:20px;color:#8e8e93;font-size:12px">Mizan Mind · Yapay Zeka Destekli Finansal Analiz</p>
          </div>`;
        try {
          const sendRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${RESEND_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: FROM_ADDR,
              to: [email],
              subject: `[Mizan Mind] ${rows.length} analiziniz ${WARN_DAYS} gün içinde silinecek`,
              html,
            }),
          });
          if (sendRes.ok) {
            warnEmails++;
            // İlgili tüm satırları warning_sent_at ile işaretle
            const ids = rows.map(r => r.id);
            const patchRes = await sb(
              `/analizler?id=in.(${ids.join(',')})`,
              'PATCH',
              { warning_sent_at: new Date().toISOString() }
            );
            if (patchRes.ok) warned += rows.length;
          } else {
            errors++;
            console.warn('[retention-cleanup] resend failed for', email, await sendRes.text());
          }
        } catch (e) {
          errors++;
          console.warn('[retention-cleanup] email send error', email, e.message);
        }
      }
    } else {
      console.warn('[retention-cleanup] RESEND_API_KEY yok — uyarı e-postası gönderilmiyor, yine de warning_sent_at işaretlenecek');
      const allIds = reallyExpiring.map(r => r.id);
      if (allIds.length) {
        await sb(
          `/analizler?id=in.(${allIds.join(',')})`,
          'PATCH',
          { warning_sent_at: new Date().toISOString() }
        );
        warned += allIds.length;
      }
    }
  } catch (e) {
    errors++;
    console.warn('[retention-cleanup] warning pass error', e.message);
  }

  // ─── (2) SİLME GEÇİŞİ ────────────────────────────────────────────────────
  // olusturma_tarihi < cutoffDelete AND (extended_until IS NULL OR extended_until < now)
  try {
    const dRes = await sb(
      `/analizler?olusturma_tarihi=lt.${encodeURIComponent(cutoffDelete)}&select=id,user_email,dosya_path,extended_until&limit=500`,
      'GET'
    );
    const expiredRows = (await dRes.json()) || [];
    const reallyExpired = expiredRows.filter(r =>
      !r.extended_until || new Date(r.extended_until).getTime() < now
    );

    // Kullanıcı bazında metrikler topla (deletion_log için)
    const userMetrics = {};
    for (const r of reallyExpired) {
      if (!userMetrics[r.user_email]) {
        userMetrics[r.user_email] = { rows: 0, files: 0 };
      }
      // Storage dosyası sil
      if (r.dosya_path) {
        try {
          const ds = await storageDelete(r.dosya_path);
          if (ds.ok) {
            deletedFiles++;
            userMetrics[r.user_email].files++;
          }
        } catch (e) {
          console.warn('[retention-cleanup] storage delete failed', r.dosya_path, e.message);
        }
      }
      userMetrics[r.user_email].rows++;
    }

    // Tek seferde DB satırlarını sil
    const expiredIds = reallyExpired.map(r => r.id);
    if (expiredIds.length) {
      const delRes = await sb(`/analizler?id=in.(${expiredIds.join(',')})`, 'DELETE');
      if (delRes.ok) deletedRows = expiredIds.length;
    }

    // deletion_log'a denetim kaydı (kullanıcı başına bir satır)
    for (const [email, m] of Object.entries(userMetrics)) {
      try {
        await sb('/deletion_log', 'POST', {
          user_email: email,
          analizler_deleted: m.rows,
          defter_raporlari_deleted: 0,
          files_deleted: m.files,
        });
      } catch (e) {
        console.warn('[retention-cleanup] audit log failed for', email, e.message);
      }
    }
  } catch (e) {
    errors++;
    console.warn('[retention-cleanup] delete pass error', e.message);
  }

  console.log(`[retention-cleanup] warned=${warned} emails=${warnEmails} deletedRows=${deletedRows} deletedFiles=${deletedFiles} errors=${errors}`);
  return {
    statusCode: 200,
    body: JSON.stringify({ warned, warnEmails, deletedRows, deletedFiles, errors }),
  };
};

function escapeHtml(s) {
  return String(s || '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}
