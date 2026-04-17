const express = require('express');
const axios = require('axios');
const app = express();

const path = require('path');
app.use(express.json()); // POST body ayrıştırması için

// Ana sayfayı servis et
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Proxy API ──
app.get('/api/proxy', (req, res) => {
    const src = req.query.src;
    const type = req.query.type || 'image';
    if (!src) return res.status(400).json({ error: 'Kaynak eksik' });

    if (type === 'video') {
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        };
        if (req.headers.range) headers.range = req.headers.range;

        axios({
            url: src,
            method: 'GET',
            responseType: 'stream',
            headers: headers,
            timeout: 15000
        }).then(response => {
            res.status(response.status);
            ['content-type', 'content-length', 'content-range', 'accept-ranges'].forEach(h => {
                if (response.headers[h]) res.setHeader(h, response.headers[h]);
            });
            response.data.pipe(res);
        }).catch(err => {
            res.redirect(src);
        });
    } else {
        res.redirect(`https://wsrv.nl/?url=${encodeURIComponent(src)}`);
    }
});

// ── Download API (Forcing download) ──
app.get('/api/download', async (req, res) => {
    const src = req.query.src;
    const filename = req.query.filename || 'instagram_media';
    if (!src) return res.status(400).send('Kaynak eksik');

    try {
        const axios = require('axios');
        const response = await axios({
            url: src,
            method: 'GET',
            responseType: 'stream',
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        // Uzantıyı belirle
        const contentType = response.headers['content-type'];
        let ext = 'jpg';
        if (contentType?.includes('video/mp4')) ext = 'mp4';
        else if (contentType?.includes('image/png')) ext = 'png';
        
        const finalFilename = filename.includes('.') ? filename : `${filename}.${ext}`;

        res.setHeader('Content-Disposition', `attachment; filename="${finalFilename}"`);
        res.setHeader('Content-Type', contentType || 'application/octet-stream');
        
        response.data.pipe(res);
    } catch (e) {
        console.error('Download hatası:', e.message);
        res.redirect(src); // Hata durumunda direkt linke yönlendir
    }
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

        // Veri yapısını esnek bir şekilde algıla ve TÜM hikayeleri topla
        const rawData = response.data;
        let storesPool = [];
        
        // Tüm hiyerarşik yapıları derinlemesine tarıyoruz (FlatMap kullanarak)
        if (rawData.reels && Array.isArray(rawData.reels)) {
            storesPool = rawData.reels.flatMap(r => r.items || [r]);
        } else if (rawData.data?.reels && Array.isArray(rawData.data.reels)) {
            storesPool = rawData.data.reels.flatMap(r => r.items || [r]);
        } else if (rawData.data?.reels_media && Array.isArray(rawData.data.reels_media)) {
            storesPool = rawData.data.reels_media.flatMap(r => r.items || [r]);
        } else if (rawData.items && Array.isArray(rawData.items)) {
            storesPool = rawData.items;
        } else if (rawData.data?.items && Array.isArray(rawData.data.items)) {
            storesPool = rawData.data.items;
        } else if (Array.isArray(rawData.data)) {
            storesPool = rawData.data;
        } else if (Array.isArray(rawData.result)) {
            storesPool = rawData.result;
        } else if (Array.isArray(rawData)) {
            storesPool = rawData;
        }

        // Eğer hala boşsa ama tek bir reel varsa (dizi değilse)
        if (storesPool.length === 0 && rawData.reels?.items) {
            storesPool = rawData.reels.items;
        }

        const formattedStories = storesPool.map((item, idx) => {
            try {
                const story = Array.isArray(item) ? item[0] : item;
                if (!story || typeof story !== 'object') return null;

                const isVideo = story.media_type === 2 || 
                              story.media_type === 'video' || 
                              !!story.video_versions || 
                              !!story.video_url;
                
                let rawUrl = '';
                if (isVideo) {
                    const v = story.video_versions || [];
                    rawUrl = (v[0]?.url || v[0]) || story.video_url || story.url || '';
                } else {
                    const c = (story.image_versions2?.candidates) || story.image_versions || story.candidates || [];
                    rawUrl = (c[0]?.url || c[0]) || story.image_url || story.display_url || story.url || '';
                }

                if (!rawUrl) {
                    rawUrl = [story.url, story.download_url, story.thumbnail_url, story.display_url]
                             .find(u => u && typeof u === 'string' && (u.startsWith('http') || u.includes('cdninstagram'))) || '';
                }

                if (!rawUrl) return null;

                const c = (story.image_versions2?.candidates) || story.image_versions || story.candidates || [];
                const thumbUrl = c[c.length - 1]?.url || story.thumbnail_url || story.display_url || rawUrl;

                return {
                    id: story.id || story.pk || `s_${idx}_${Date.now()}`,
                    url: `/api/proxy?src=${encodeURIComponent(rawUrl)}&type=${isVideo ? 'video' : 'image'}`,
                    original_url: rawUrl,
                    thumbnail_url: `/api/proxy?src=${encodeURIComponent(thumbUrl)}&type=image`,
                    taken_at: story.taken_at || story.created_at || Math.floor(Date.now() / 1000),
                    media_type: isVideo ? 'video' : 'image',
                    duration: story.video_duration || 15,
                    mentions: (story.reel_mentions || story.mentions || []).map(m => m.user?.username || m.username || m).filter(Boolean),
                    hashtags: (story.story_hashtags || story.hashtags || []).map(h => h.hashtag?.name || h.name || h).filter(Boolean)
                };
            } catch (err) {
                return null;
            }
        }).filter(Boolean);

        console.log(`Sonuçlanan hikaye sayısı: ${formattedStories.length}`);

        res.json({
            success: true,
            data: formattedStories
        });

    } catch (e) {
        console.error('Stories RapidAPI Hatası:', e.message);
        if (e.response) {
            console.error('Hata Yanıtı:', JSON.stringify(e.response.data));
        }
        
        if (e.response?.status === 404) {
            return res.json({ success: true, data: [] });
        }
        res.status(500).json({ success: false, error: 'Instagram hikayelerine şu an erişilemiyor.' });
    }
});

// ── EKSİK OLAN RAPIDAPI ENDPOINTLERİ (Kullanıcı Talebi Üzerine Eklendi) ──
app.use(express.json());
const RAPIDAPI_HEADERS = {
    'x-rapidapi-key': '559e13debcmsha87285859697ed6p1f2ea7jsn8e5af5d51f55',
    'x-rapidapi-host': 'instagram120.p.rapidapi.com',
    'Content-Type': 'application/json'
};
const RAPIDAPI_BASE = 'https://instagram120.p.rapidapi.com/api/instagram';

app.get('/api/instagram/get', async (req, res) => {
    try {
        const response = await axios.get(`${RAPIDAPI_BASE}/get`, { headers: RAPIDAPI_HEADERS });
        res.json({ success: true, data: response.data });
    } catch (e) {
        res.status(e.response?.status || 500).json({ success: false, error: e.message, details: e.response?.data });
    }
});

app.get('/api/instagram/hls', async (req, res) => {
    try {
        const response = await axios.get(`${RAPIDAPI_BASE}/hls`, { headers: RAPIDAPI_HEADERS });
        res.json({ success: true, data: response.data });
    } catch (e) {
        res.status(e.response?.status || 500).json({ success: false, error: e.message, details: e.response?.data });
    }
});

app.post('/api/instagram/links', async (req, res) => {
    try {
        const response = await axios.post(`${RAPIDAPI_BASE}/links`, { url: req.body.url }, { headers: RAPIDAPI_HEADERS });
        res.json({ success: true, data: response.data });
    } catch (e) {
        res.status(e.response?.status || 500).json({ success: false, error: e.message, details: e.response?.data });
    }
});

app.post('/api/instagram/profile', async (req, res) => {
    try {
        const response = await axios.post(`${RAPIDAPI_BASE}/profile`, { username: req.body.username }, { headers: RAPIDAPI_HEADERS });
        res.json({ success: true, data: response.data });
    } catch (e) {
        res.status(e.response?.status || 500).json({ success: false, error: e.message, details: e.response?.data });
    }
});

app.post('/api/instagram/story', async (req, res) => {
    try {
        const response = await axios.post(`${RAPIDAPI_BASE}/story`, { username: req.body.username, storyId: req.body.storyId }, { headers: RAPIDAPI_HEADERS });
        res.json({ success: true, data: response.data });
    } catch (e) {
        res.status(e.response?.status || 500).json({ success: false, error: e.message, details: e.response?.data });
    }
});

app.post('/api/instagram/highlights', async (req, res) => {
    try {
        const response = await axios.post(`${RAPIDAPI_BASE}/highlights`, { username: req.body.username }, { headers: RAPIDAPI_HEADERS });
        res.json({ success: true, data: response.data });
    } catch (e) {
        res.status(e.response?.status || 500).json({ success: false, error: e.message, details: e.response?.data });
    }
});

app.post('/api/instagram/highlightStories', async (req, res) => {
    try {
        let hId = req.body.highlightId;
        if (hId && !hId.startsWith('highlight:')) {
            hId = 'highlight:' + hId;
        }
        const response = await axios.post(`${RAPIDAPI_BASE}/highlightStories`, { highlightId: hId }, { headers: RAPIDAPI_HEADERS });
        res.json({ success: true, data: response.data });
    } catch (e) {
        console.error('HighlightStories Error:', e.message);
        res.status(e.response?.status || 500).json({ success: false, error: e.message, details: e.response?.data });
    }
});

app.post('/api/instagram/userInfo', async (req, res) => {
    try {
        const response = await axios.post(`${RAPIDAPI_BASE}/userInfo`, { username: req.body.username }, { headers: RAPIDAPI_HEADERS });
        res.json({ success: true, data: response.data });
    } catch (e) {
        res.status(e.response?.status || 500).json({ success: false, error: e.message, details: e.response?.data });
    }
});

app.post('/api/instagram/mediaByShortcode', async (req, res) => {
    try {
        // mediaByShortcode standard but some RapidAPI configs use mediaByShortcode
        const response = await axios.post(`${RAPIDAPI_BASE}/mediaByShortcode`, { shortcode: req.body.shortcode }, { headers: RAPIDAPI_HEADERS });
        res.json({ success: true, data: response.data });
    } catch (e) {
        res.status(e.response?.status || 500).json({ success: false, error: e.message, details: e.response?.data });
    }
});

app.post('/api/instagram/reels', async (req, res) => {
    try {
        const response = await axios.post(`${RAPIDAPI_BASE}/reels`, { username: req.body.username, maxId: req.body.maxId || "" }, { headers: RAPIDAPI_HEADERS });
        res.json({ success: true, data: response.data });
    } catch (e) {
        res.status(e.response?.status || 500).json({ success: false, error: e.message, details: e.response?.data });
    }
});

app.post('/api/instagram/posts', async (req, res) => {
    try {
        const response = await axios.post(`${RAPIDAPI_BASE}/posts`, { username: req.body.username, maxId: req.body.maxId || "" }, { headers: RAPIDAPI_HEADERS });
        res.json({ success: true, data: response.data });
    } catch (e) {
        res.status(e.response?.status || 500).json({ success: false, error: e.message, details: e.response?.data });
    }
});

module.exports = app;

// Local development support
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Server is running locally at http://localhost:${PORT}`);
    });
}