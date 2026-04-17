const express = require('express');
const axios = require('axios');
const app = express();

// Ortak Instagram istek başlıkları
const igHeaders = {
    'x-ig-app-id': '936619743392459',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
};

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
        const targetUrl = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${username}`;
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;

        const response = await axios.get(proxyUrl, {
            headers: igHeaders,
            timeout: 15000
        });

        const userData = response.data?.data?.user;

        if (userData) {
            const hdUrl = userData.hd_profile_pic_url_info?.url || userData.profile_pic_url_hd || userData.profile_pic_url;

            const timelineEdges = userData.edge_owner_to_timeline_media?.edges || [];
            const recentPosts = timelineEdges.map(edge => {
                const node = edge.node;
                return {
                    id: node.id,
                    shortcode: node.shortcode || '',
                    display_url: `/api/proxy?src=${encodeURIComponent(node.display_url || node.thumbnail_src || '')}`,
                    likes: node.edge_liked_by?.count || node.edge_media_preview_like?.count || 0,
                    comments: node.edge_media_to_comment?.count || 0,
                    is_video: node.is_video || false,
                    caption: node.edge_media_to_caption?.edges[0]?.node?.text || '',
                    timestamp: node.taken_at_timestamp,
                    location: node.location ? { id: node.location.id, name: node.location.name } : null,
                    owner: node.owner ? { id: node.owner.id, username: node.owner.username } : null,
                    dimensions: node.dimensions || null,
                    accessibility_caption: node.accessibility_caption || null
                };
            });

            res.json({
                success: true,
                data: {
                    id: userData.id || null,
                    fbid: userData.fbid || null,
                    username: userData.username,
                    full_name: userData.full_name || username,
                    biography: userData.biography || '',
                    pronouns: userData.pronouns || [],
                    is_verified: userData.is_verified || false,
                    is_private: userData.is_private || false,
                    is_business_account: userData.is_business_account || false,
                    is_professional_account: userData.is_professional_account || false,
                    is_joined_recently: userData.is_joined_recently || false,
                    profile_pic_url_hd: `/api/proxy?src=${encodeURIComponent(hdUrl)}`,
                    profile_pic_original: hdUrl,
                    followers: userData.edge_followed_by?.count || 0,
                    following: userData.edge_follow?.count || 0,
                    posts: userData.edge_owner_to_timeline_media?.count || 0,
                    highlight_reel_count: userData.highlight_reel_count || 0,
                    external_url: userData.external_url || null,
                    bio_links: userData.bio_links || [],
                    category_name: userData.category_name || null,
                    business_category_name: userData.business_category_name || null,
                    overall_category_name: userData.overall_category_name || null,
                    recent_posts: recentPosts
                }
            });
        } else {
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

// ── Stories API ──
// Kullanım: /api/stories?userId=<instagram_user_id>
// userId'yi önce /api/search ile alın (data.id alanı)
app.get('/api/stories', async (req, res) => {
    const userId = (req.query.userId || '').replace(/[^0-9]/g, '');
    if (!userId) return res.status(400).json({ error: 'userId gerekli (sayısal Instagram ID)' });

    try {
        const targetUrl = `https://i.instagram.com/api/v1/feed/reels_media/?reel_ids=${userId}`;
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;

        const response = await axios.get(proxyUrl, {
            headers: igHeaders,
            timeout: 15000
        });

        const reels = response.data?.reels || response.data?.reels_media;

        // API bazen reels_media dizisi, bazen reels objesi döner
        let items = [];

        if (Array.isArray(reels)) {
            // reels_media formatı: [{ id, items: [...] }]
            const reel = reels.find(r => String(r.id) === String(userId) || String(r.user?.pk) === String(userId));
            items = reel?.items || reels[0]?.items || [];
        } else if (reels && typeof reels === 'object') {
            // reels formatı: { "userId": { items: [...] } }
            const reel = reels[userId] || Object.values(reels)[0];
            items = reel?.items || [];
        }

        if (!items.length) {
            return res.status(404).json({
                success: false,
                error: 'Story bulunamadı. Hesap private olabilir veya aktif story yok.'
            });
        }

        const stories = items.map(item => {
            const isVideo = item.media_type === 2;

            // Video için en yüksek kaliteli versiyonu seç
            const videoUrl = item.video_versions
                ?.sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || '';

            // Fotoğraf için en yüksek kaliteli versiyonu seç
            const imageUrl = item.image_versions2?.candidates
                ?.sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || '';

            const mediaUrl = isVideo ? videoUrl : imageUrl;

            return {
                id: item.id || item.pk,
                media_type: isVideo ? 'video' : 'image',
                url: `/api/proxy?src=${encodeURIComponent(mediaUrl)}`,
                original_url: mediaUrl,
                thumbnail_url: imageUrl
                    ? `/api/proxy?src=${encodeURIComponent(imageUrl)}`
                    : null,
                taken_at: item.taken_at,
                expiring_at: item.expiring_at,
                duration: item.video_duration || null,
                width: item.original_width || null,
                height: item.original_height || null,
                has_audio: item.has_audio || false,
                // Sticker / mention bilgileri varsa ekle
                mentions: item.reel_mentions?.map(m => m.user?.username).filter(Boolean) || [],
                hashtags: item.story_hashtags?.map(h => h.hashtag?.name).filter(Boolean) || []
            };
        });

        res.json({
            success: true,
            count: stories.length,
            data: stories
        });

    } catch (e) {
        console.error('Stories Hatası:', e.message);
        const status = e.response?.status || 500;
        let errorMessage = 'Story yüklenemedi. Lütfen daha sonra deneyin.';

        if (status === 404) errorMessage = 'Kullanıcı bulunamadı';
        if (status === 401) errorMessage = 'Instagram oturum açmayı gerektiriyor';
        if (status === 403) errorMessage = 'Erişim engellendi (Hesap private veya IP bloğu)';
        if (status === 429) errorMessage = 'Instagram hız sınırı uyguluyor (Lütfen 5 dk bekleyin)';

        res.status(status).json({ success: false, error: errorMessage });
    }
});

module.exports = app;