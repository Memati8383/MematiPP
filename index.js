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
                'User-Agent': 'Mozilla/5.0'
            }
        });

        if (response.data?.data?.user) {
            const user = response.data.data.user;
            const hdUrl = user.hd_profile_pic_url_info?.url || user.profile_pic_url_hd || user.profile_pic_url;
            res.json({
                success: true,
                data: {
                    full_name: user.full_name,
                    username: user.username,
                    biography: user.biography,
                    profile_pic_url_hd: `/api/proxy?src=${encodeURIComponent(hdUrl)}`,
                    followers: user.edge_followed_by?.count || 0,
                    following: user.edge_follow?.count || 0,
                    posts: user.edge_owner_to_timeline_media?.count || 0
                }
            });
        } else {
            res.status(404).json({ success: false, error: 'Bulunamadı' });
        }
    } catch (e) {
        res.status(500).json({ success: false, error: 'Instagram Hatası' });
    }
});

module.exports = app;
