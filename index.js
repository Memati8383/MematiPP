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
        const response = await axios.get(`https://i.instagram.com/api/v1/users/web_profile_info/?username=${username}`, {
            headers: {
                'x-ig-app-id': '936619743392459',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
                'Referer': `https://www.instagram.com/${username}/`,
                'X-Requested-With': 'XMLHttpRequest'
            },
            timeout: 10000 // 10 saniye zaman aşımı
        });

        if (response.data?.data?.user) {
            const user = response.data.data.user;
            const hdUrl = user.hd_profile_pic_url_info?.url || user.profile_pic_url_hd || user.profile_pic_url;
            
            res.json({
                success: true,
                data: {
                    full_name: user.full_name || username,
                    username: user.username,
                    biography: user.biography || '',
                    is_verified: user.is_verified || false,
                    is_private: user.is_private || false,
                    profile_pic_url_hd: `/api/proxy?src=${encodeURIComponent(hdUrl)}`,
                    profile_pic_original: hdUrl,
                    followers: user.edge_followed_by?.count || 0,
                    following: user.edge_follow?.count || 0,
                    posts: user.edge_owner_to_timeline_media?.count || 0
                }
            });
        } else {
            res.status(404).json({ success: false, error: 'Kullanıcı bulunamadı' });
        }
    } catch (e) {
        console.error('Instagram API Hatası:', e.message);
        const status = e.response?.status || 500;
        let errorMessage = 'Instagram verisi alınamadı (IP Engeli olabilir)';
        
        if (status === 404) errorMessage = 'Kullanıcı bulunamadı';
        if (status === 429) errorMessage = 'Hız sınırı aşıldı, lütfen biraz bekleyin';

        res.status(status).json({ success: false, error: errorMessage });
    }
});

module.exports = app;
