const express = require('express');
const axios = require('axios');
const app = express();

// ── Proxy API ──
app.get('/api/proxy', (req, res) => {
    const src = req.query.src;
    if (!src) return res.status(400).json({ error: 'Kaynak eksik' });
    res.redirect(`https://wsrv.nl/?url=${encodeURIComponent(src)}`);
});

// ── Search API ──
app.get('/api/search', async (req, res) => {
    const username = (req.query.username || '').replace(/[^a-zA-Z0-9._]/g, '');
    if (!username) return res.status(400).json({ error: 'Username gerekli' });

    try {
        // AllOrigins yerine daha stabil olan corsproxy.io kullanıyoruz
        const targetUrl = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${username}`;
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;

        const response = await axios.get(proxyUrl, {
            headers: {
                'x-ig-app-id': '936619743392459',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
            },
            timeout: 15000 
        });

        const userData = response.data?.data?.user;

        if (userData) {
            const hdUrl = userData.hd_profile_pic_url_info?.url || userData.profile_pic_url_hd || userData.profile_pic_url;
            
            // ── Çoklu profil fotoğrafları ──
            // Instagram API'den gelen tüm profil fotoğrafı versiyonlarını topla
            const profilePics = [];
            const seenUrls = new Set();

            // 1) hd_profile_pic_url_info (en yüksek çözünürlük)
            if (userData.hd_profile_pic_url_info?.url) {
                const u = userData.hd_profile_pic_url_info.url;
                if (!seenUrls.has(u)) {
                    seenUrls.add(u);
                    profilePics.push({
                        url: `/api/proxy?src=${encodeURIComponent(u)}`,
                        original: u,
                        width: userData.hd_profile_pic_url_info.width || 0,
                        height: userData.hd_profile_pic_url_info.height || 0
                    });
                }
            }

            // 2) hd_profile_pic_versions (çoklu versiyonlar dizisi)
            if (Array.isArray(userData.hd_profile_pic_versions)) {
                for (const pic of userData.hd_profile_pic_versions) {
                    if (pic?.url && !seenUrls.has(pic.url)) {
                        seenUrls.add(pic.url);
                        profilePics.push({
                            url: `/api/proxy?src=${encodeURIComponent(pic.url)}`,
                            original: pic.url,
                            width: pic.width || 0,
                            height: pic.height || 0
                        });
                    }
                }
            }

            // 3) profile_pic_url_hd
            if (userData.profile_pic_url_hd && !seenUrls.has(userData.profile_pic_url_hd)) {
                seenUrls.add(userData.profile_pic_url_hd);
                profilePics.push({
                    url: `/api/proxy?src=${encodeURIComponent(userData.profile_pic_url_hd)}`,
                    original: userData.profile_pic_url_hd,
                    width: 0,
                    height: 0
                });
            }

            // 4) profile_pic_url (standart çözünürlük - yedek)
            if (userData.profile_pic_url && !seenUrls.has(userData.profile_pic_url)) {
                seenUrls.add(userData.profile_pic_url);
                profilePics.push({
                    url: `/api/proxy?src=${encodeURIComponent(userData.profile_pic_url)}`,
                    original: userData.profile_pic_url,
                    width: 150,
                    height: 150
                });
            }

            // En az 1 fotoğraf olsun (fallback)
            if (profilePics.length === 0) {
                profilePics.push({
                    url: `/api/proxy?src=${encodeURIComponent(hdUrl)}`,
                    original: hdUrl,
                    width: 0,
                    height: 0
                });
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
        } else {
            // Eğer veri gelmediyse Instagram bizi login sayfasına yönlendirmiş olabilir
            res.status(403).json({ success: false, error: 'Instagram erişimi reddetti (Giriş gerekli olabilir)' });
        }
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
