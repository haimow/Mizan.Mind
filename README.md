# FinAnaliz Pro — Finansal Analiz Platformu

Türk şirketleri için profesyonel finansal analiz dashboard'u.

## Özellikler

- 📊 **20+ Finansal Rasyo** — Otomatik hesaplama, renk kodlu değerlendirme
- 📂 **Akıllı Dosya Okuma** — Netsis/Logo/Luca detay mizan (THP bazlı), gelir tablosu, PDF beyanname
- 🤖 **Claude AI Yorum** — Profesyonel finansal değerlendirme raporu
- ⚖️ **Dönemler Arası Karşılaştırma** — Trend analizi
- 📈 **Grafikler & Marjlar** — Sidebar'da anlık görselleştirme

## Netlify Deploy

### 1. GitHub'a Push Et

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/KULLANICI/finanaliz-pro.git
git push -u origin main
```

### 2. Netlify'a Bağla

1. [app.netlify.com](https://app.netlify.com) → **Add new site** → **Import an existing project**
2. GitHub'ı seç → Bu repo'yu seç
3. Build settings:
   - **Build command:** _(boş bırak)_
   - **Publish directory:** `public`
4. **Deploy site** tıkla

### 3. API Key Ayarla

1. Netlify Dashboard → **Site configuration** → **Environment variables**
2. **Add a variable:**
   - Key: `ANTHROPIC_API_KEY`
   - Value: `sk-ant-...` (Anthropic API key'iniz)
3. **Deploys** → **Trigger deploy** → **Deploy site**

## Proje Yapısı

```
├── public/
│   └── index.html          # Ana uygulama (tek dosya)
├── netlify/
│   └── functions/
│       └── claude-proxy.mjs # Anthropic API proxy (serverless)
├── netlify.toml             # Netlify build & redirect config
└── README.md
```

## Desteklenen Dosya Formatları

| Format | Kaynak | Parse Yöntemi |
|--------|--------|---------------|
| Detay Mizan (.xls/.xlsx) | Netsis, Logo, Luca, Mikro | THP hesap kodu eşleştirme |
| Gelir Tablosu (.xlsx) | Netsis | Hesap kodu + dönem algılama |
| Kurumlar Beyannamesi (.pdf) | e-Beyanname (GİB) | Claude AI ile veri çıkarma |
| Geçici Vergi Beyannamesi (.pdf) | e-Beyanname (GİB) | Claude AI ile veri çıkarma |
| Bilanço (.xlsx/.pdf) | Çeşitli | Hibrit (şablon + AI) |
