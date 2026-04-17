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
            
            // Gönderileri çek (Instagram başlangıçta yaklaşık 12-50 arası gönderi döner)
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

// ── Stories API ──
app.get('/api/stories', async (req, res) => {
    const username = (req.query.username || '').replace(/[^a-zA-Z0-9._]/g, '');
    if (!username) return res.status(400).json({ success: false, error: 'Username gerekli' });

    try {
        // Kullanıcının sağladığı RapidAPI bilgilerini kullanıyoruz
        const response = await axios.post('https://instagram120.p.rapidapi.com/api/instagram/stories', {
            username: username,
            maxId: ""
        }, {
            headers: {
                'x-rapidapi-key': '559e13debcmsha87285859697ed6p1f2ea7jsn8e5af5d51f55',
                'x-rapidapi-host': 'instagram120.p.rapidapi.com',
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });

        const stories = response.data?.data || [];
        
        // Veriyi frontend formatına dönüştür
        const formattedStories = stories.map(story => {
            try {
                const isVideo = story.media_type === 2 || !!story.video_versions;
                
                // Medya URL'sini belirle
                let rawUrl = '';
                if (isVideo) {
                    const versions = story.video_versions || [];
                    rawUrl = versions[0]?.url || versions[0] || '';
                } else {
                    const candidates = story.image_versions2?.candidates || [];
                    rawUrl = candidates[0]?.url || candidates[0] || '';
                }

                if (!rawUrl) rawUrl = story.url || '';

                const candidates = story.image_versions2?.candidates || [];
                const thumbUrl = candidates[candidates.length - 1]?.url || story.thumbnail_url || rawUrl;

                return {
                    id: story.id,
                    url: `/api/proxy?src=${encodeURIComponent(rawUrl)}`,
                    original_url: rawUrl,
                    thumbnail_url: `/api/proxy?src=${encodeURIComponent(thumbUrl)}`,
                    taken_at: story.taken_at || story.created_at || Math.floor(Date.now() / 1000),
                    media_type: isVideo ? 'video' : 'image',
                    duration: story.video_duration || 15,
                    mentions: (story.reel_mentions || []).map(m => (m.user?.username || m.username || '')).filter(Boolean),
                    hashtags: (story.story_hashtags || []).map(h => (h.hashtag?.name || h.name || '')).filter(Boolean)
                };
            } catch (err) {
                console.error('Story map error:', err);
                return null;
            }
        }).filter(Boolean);

        res.json({
            success: true,
            data: formattedStories
        });

    } catch (e) {
        console.error('Stories RapidAPI Hatası:', e.message);
        // Eğer 404 ise muhtemelen hikaye yok veya kullanıcı bulunamadı
        if (e.response?.status === 404) {
            return res.json({ success: true, data: [] });
        }
        res.status(500).json({ success: false, error: 'Hikayeler şu an alınamıyor.' });
    }
});

module.exports = app;