# 🔍 MematiPP – Instagram HD Profil Görüntüleyici

**MematiPP**, Instagram kullanıcılarının profil fotoğraflarını tam çözünürlükte (HD) görüntülemenizi, indirmenizi ve hesap istatistiklerini takip etmenizi sağlayan modern, hızlı ve kullanıcı dostu bir web uygulamasıdır.

---

## ✨ Özellikler

- 🖼️ **Ultra HD Kalite:** Profil fotoğraflarını Instagram'ın sunduğu en yüksek çözünürlükte (1080x1080px) görün.
- 🔒 **Gizli Profil Desteği:** Gizli hesapların ve sizi engelleyenlerin bile profil fotoğrafına erişebilir.
- 📊 **Detaylı İstatistikler:** Gönderi sayısı, Takipçi ve Takip edilen sayılarını anında görün.
- ✅ **Doğrulanmış Hesap Desteği:** Instagram onaylı hesaplar için özel verified rozet gösterimi.
- 🌑 **Premium Karanlık Tema:** Göz yormayan, modern ve şık Glassmorphism tasarımı.
- 🛡️ **Gelişmiş Güvenlik:** SSRF, XSS ve Rate Limit korumalarıyla güçlendirilmiş altyapı.
- 📱 **Tam Mobil Uyumluluk:** Telefon, tablet ve masaüstünde kusursuz deneyim.
- ⚡ **Hızlı ve Dinamik:** Sayfa yenilemeden anlık sonuçlar.
- 🔗 **Sosyal Medya Entegrasyonu:** Şık ve animasyonlu Instagram & GitHub bağlantıları.

---

## 🛡️ Güvenlik Özellikleri

Bu proje, güvenli bir deneyim sunmak için modern güvenlik standartlarıyla donatılmıştır:

- **SSRF Koruması:** Sunucu üzerinden sadece güvenilir Instagram CDN adreslerine erişim sağlanır.
- **XSS Koruması:** Tüm kullanıcı verileri ekrana yazdırılmadan önce HTML kaçış işlemlerinden (escaping) geçirilir.
- **Hız Sınırı (Rate Limiting):** Bot saldırılarını ve suistimalleri önlemek için IP tabanlı istek sınırlaması uygulanır.
- **Güvenlik Başlıkları:** `helmet` entegrasyonu ile CSP, HSTS ve diğer kritik HTTP başlıkları otomatik olarak ayarlanır.

---

## 🚀 Kurulum ve Çalıştırma

### Gereksinimler
- [Node.js](https://nodejs.org/) (v18 veya üzeri önerilir)

### Adımlar

1. Projeyi bilgisayarınıza indirin veya klonlayın.
2. Proje klasöründe terminali açarak bağımlılıkları yükleyin:
   ```bash
   npm install
   ```
3. Proje ana dizininde bir `.env` dosyası oluşturun ve şu bilgileri ekleyin:
   ```env
   RAPIDAPI_KEY=api_anahtariniz
   RAPIDAPI_HOST=instagram120.p.rapidapi.com
   PORT=3000
   ```
4. Sunucuyu başlatın:
   ```bash
   node index.js
   ```
5. Tarayıcınızdan şu adrese gidin: `http://localhost:3000`.

---

## ☁️ Vercel ile Yayınlama

Projeyi Vercel üzerinde sorunsuz çalıştırmak için şu adımları izleyin:

1. Projeyi GitHub hesabınıza yükleyin.
2. Vercel Dashboard üzerinden projeyi içe aktarın (Import).
3. **Environment Variables** (Ortam Değişkenleri) kısmına şunları ekleyin:
   - `RAPIDAPI_KEY`: Sizin RapidAPI anahtarınız.
   - `RAPIDAPI_HOST`: `instagram120.p.rapidapi.com`
4. "Deploy" butonuna basın.

_Not: `vercel.json` dosyası projenin serverless mimaride çalışması için optimize edilmiştir._

---

## 📂 Proje Yapısı

```
├── index.html     # Ana arayüz ve stil dosyaları (Frontend)
├── index.js       # Sunucu ve API proxy mantığı (Node.js/Express)
├── .env           # Hassas yapılandırma ve API anahtarları (Gizli)
├── vercel.json    # Deployment konfigürasyonu
└── package.json   # Bağımlılıklar ve scriptler
```

---

## 🛠️ Kullanılan Teknolojiler

- **Backend:** Node.js, Express.js
- **Güvenlik:** Helmet, Express-Rate-Limit, Dotenv
- **API:** Instagram Public & RapidAPI
- **Görsel Proxy:** wsrv.nl & Dahili Secure Proxy
- **Tasarım:** Modern Glassmorphism & UIverse Components

---

## 📜 Lisans

Bu proje **MIT** lisansı altında lisanslanmıştır. Dilediğiniz gibi kullanabilir, değiştirebilir ve kendi projelerinizde referans göstererek dağıtabilirsiniz.

---

### İletişim & Geliştirici
Geliştirici: **Memati8383**  
GitHub: [@Memati8383](https://github.com/Memati8383)  
Instagram: [@ferit22901](https://instagram.com/ferit22901)

_© 2026 MematiPP. Tüm hakları saklıdır._
