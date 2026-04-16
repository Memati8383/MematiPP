const express = require('express');
const axios = require('axios');
const app = express();

// ── Görsel Proxy ──
app.get('/api/proxy', (req, res) => {
    const src = req.query.src;
    if (!src) return res.status(400).json({ error: 'Kaynak parametresi eksik' });
    const wsrvUrl = `https://wsrv.nl/?url=${encodeURIComponent(src)}`;
    res.redirect(wsrvUrl);
});

// ── Instagram Profil Arama API'si ──
app.get('/api/search', async (req, res) => {
    const username = (req.query.username || '').replace(/[^a-zA-Z0-9._]/g, '');
    if (!username) return res.status(400).json({ success: false, error: 'Kullanıcı adı gerekli' });

    try {
        const apiUrl = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${username}`;
        const response = await axios.get(apiUrl, {
            headers: {
                'Accept': 'application/json',
                'x-ig-app-id': '936619743392459',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Referer': `https://www.instagram.com/${username}/`
            }
        });

        if (response.data?.data?.user) {
            const user = response.data.data.user;
            const hdUrl = user.hd_profile_pic_url_info?.url || user.profile_pic_url_hd || user.profile_pic_url;
            const proxiedUrl = `/api/proxy?src=${encodeURIComponent(hdUrl)}`;

            res.json({
                success: true,
                data: {
                    full_name: user.full_name || username,
                    username: user.username,
                    biography: user.biography || '',
                    is_verified: user.is_verified || false,
                    is_private: user.is_private || false,
                    profile_pic_url_hd: proxiedUrl,
                    profile_pic_original: hdUrl,
                    followers: user.edge_followed_by?.count || 0,
                    following: user.edge_follow?.count || 0,
                    posts: user.edge_owner_to_timeline_media?.count || 0
                }
            });
        } else {
            res.status(404).json({ success: false, error: 'Kullanıcı bulunamadı' });
        }
    } catch (error) {
        const status = error.response?.status || 500;
        const msg = status === 404 ? 'Kullanıcı bulunamadı' : 'Instagram verisi alınamadı.';
        res.status(status).json({ success: false, error: msg });
    }
});

// ── Statik Dosyalar ──
// Vercel'de Express üzerinden sunmak yerine Vercel'in kendi static serving özelliğini kullanması daha iyidir.
// Ancak Express çakışmasın diye bu satırı kapattık.

module.exports = app;
