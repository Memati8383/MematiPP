const express = require('express');
const axios = require('axios');
const app = express();

// ── Proxy API ──
app.get('/api/proxy', (req, res) => {
    const src = req.query.src;
    if (!src) return res.status(400).json({ error: 'Kaynak eksik' });
    res.redirect(`https://wsrv.nl/?url=${encodeURIComponent(src)}`);
});

// ── Yardımcı: URL'den benzersiz dosya adı çıkar (aynı fotoğrafın farklı çözünürlüklerini tespit etmek için) ──
function extractImageId(url) {
    try {
        const pathname = new URL(url).pathname;
        // /v/t51.2885-19/s150x150/123456_789_n.jpg → 123456_789_n.jpg
        const filename = pathname.split('/').pop();
        return filename || url;
    } catch {
        return url;
    }
}

// ── Search API ──
app.get('/api/search', async (req, res) => {
    const username = (req.query.username || '').replace(/[^a-zA-Z0-9._]/g, '');
    if (!username) return res.status(400).json({ error: 'Username gerekli' });

    const commonHeaders = {
        'x-ig-app-id': '936619743392459',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    };

    try {
        // ══════ 1. ADIM: web_profile_info ile temel bilgileri çek ══════
        const targetUrl = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${username}`;
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;

        const response = await axios.get(proxyUrl, {
            headers: commonHeaders,
            timeout: 15000 
        });

        const userData = response.data?.data?.user;

        if (!userData) {
            return res.status(403).json({ success: false, error: 'Instagram erişimi reddetti (Giriş gerekli olabilir)' });
        }

        const userId = userData.id;
        const hdUrl = userData.hd_profile_pic_url_info?.url || userData.profile_pic_url_hd || userData.profile_pic_url;

        // ══════ 2. ADIM: /users/{id}/info/ ile çoklu profil fotoğraflarını çek ══════
        let detailedUser = null;
        if (userId) {
            try {
                const detailUrl = `https://i.instagram.com/api/v1/users/${userId}/info/`;
                const detailProxy = `https://corsproxy.io/?${encodeURIComponent(detailUrl)}`;
                const detailRes = await axios.get(detailProxy, {
                    headers: commonHeaders,
                    timeout: 10000
                });
                detailedUser = detailRes.data?.user;
            } catch (detailErr) {
                console.log('Detaylı kullanıcı bilgisi alınamadı:', detailErr.message);
                // Hata olursa sessizce devam et, sadece web_profile_info verisi kullanılır
            }
        }

        // ══════ 3. ADIM: Tüm profil fotoğraflarını topla & deduplike et ══════
        const profilePics = [];
        const seenImageIds = new Set(); // Dosya adına göre deduplikasyon

        function addPic(url, width, height) {
            if (!url) return;
            const imgId = extractImageId(url);
            if (seenImageIds.has(imgId)) return;
            seenImageIds.add(imgId);
            profilePics.push({
                url: `/api/proxy?src=${encodeURIComponent(url)}`,
                original: url,
                width: width || 0,
                height: height || 0
            });
        }

        // Önce detaylı endpoint verilerini kullan (daha fazla bilgi içerebilir)
        if (detailedUser) {
            // hd_profile_pic_url_info
            if (detailedUser.hd_profile_pic_url_info?.url) {
                addPic(detailedUser.hd_profile_pic_url_info.url, 
                       detailedUser.hd_profile_pic_url_info.width, 
                       detailedUser.hd_profile_pic_url_info.height);
            }
            // hd_profile_pic_versions (çoklu profil fotoğrafları burada olabilir)
            if (Array.isArray(detailedUser.hd_profile_pic_versions)) {
                for (const pic of detailedUser.hd_profile_pic_versions) {
                    if (pic?.url) addPic(pic.url, pic.width, pic.height);
                }
            }
            // profile_pic_url_hd
            if (detailedUser.profile_pic_url_hd) {
                addPic(detailedUser.profile_pic_url_hd, 0, 0);
            }
        }

        // web_profile_info verilerini de ekle (detaylı endpoint başarısız olmuşsa)
        if (userData.hd_profile_pic_url_info?.url) {
            addPic(userData.hd_profile_pic_url_info.url, 
                   userData.hd_profile_pic_url_info.width, 
                   userData.hd_profile_pic_url_info.height);
        }
        if (Array.isArray(userData.hd_profile_pic_versions)) {
            for (const pic of userData.hd_profile_pic_versions) {
                if (pic?.url) addPic(pic.url, pic.width, pic.height);
            }
        }
        if (userData.profile_pic_url_hd) {
            addPic(userData.profile_pic_url_hd, 0, 0);
        }

        // Fallback: en az 1 fotoğraf olsun
        if (profilePics.length === 0) {
            addPic(hdUrl, 0, 0);
        }

        // Büyükten küçüğe sırala
        profilePics.sort((a, b) => (b.width * b.height) - (a.width * a.height));

        res.json({
            success: true,
            data: {
                full_name: userData.full_name || username,
                username: userData.username,
                biography: userData.biography || '',
                is_verified: userData.is_verified || false,
                is_private: userData.is_private || false,
                profile_pic_url_hd: `/api/proxy?src=${encodeURIComponent(hdUrl)}`,
                profile_pic_original: hdUrl,
                profile_pics: profilePics,
                followers: userData.edge_followed_by?.count || 0,
                following: userData.edge_follow?.count || 0,
                posts: userData.edge_owner_to_timeline_media?.count || 0
            }
        });

    } catch (e) {
        console.error('Proxy Hatası:', e.message);
        const status = e.response?.status || 500;
        let errorMessage = 'Instagram sunucularına şu an ulaşılamıyor. Lütfen daha sonra deneyin.';
        
        if (status === 404) errorMessage = 'Kullanıcı bulunamadı';
        if (status === 429) errorMessage = 'Instagram hız sınırı uyguluyor (Lütfen 5 dk bekleyin)';
        if (status === 403) errorMessage = 'Instagram erişimi engelledi (IP Bloğu)';

        res.status(status).json({ success: false, error: errorMessage });
    }
});

module.exports = app;
