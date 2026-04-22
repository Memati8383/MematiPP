require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

// ── Vercel / Proxy Support ──
app.set('trust proxy', 1);

// ── Security Headers ──
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://*.rapidapi.com"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            imgSrc: ["'self'", "data:", "https://*.cdninstagram.com", "https://*.fbcdn.net", "https://wsrv.nl", "https://*.corsproxy.io"],
            videoSrc: ["'self'", "https://*.cdninstagram.com", "https://*.fbcdn.net"],
            frameSrc: ["'self'", "https://www.instagram.com"],
            connectSrc: ["'self'", "https://*.instagram.com", "https://*.rapidapi.com", "https://corsproxy.io", "https://*.corsproxy.io"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            upgradeInsecureRequests: [],
        }
    },
    crossOriginEmbedderPolicy: false
}));

// ── Rate Limiting ──
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: { success: false, error: 'Çok fazla istek gönderdiniz. Lütfen 15 dakika bekleyin.' }
});
app.use('/api/', limiter);

app.use(express.json());

// Ana sayfayı servis et
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ── SSRF Protection Helper ──
function isValidInstagramUrl(urlStr) {
    try {
        const url = new URL(urlStr);
        const allowedHosts = [
            'cdninstagram.com',
            'fbcdn.net',
            'instagram.com'
        ];
        return allowedHosts.some(host => url.hostname.endsWith(host));
    } catch (e) {
        return false;
    }
}

// ── Proxy API ──
app.get('/api/proxy', (req, res) => {
    const src = req.query.src;
    const type = req.query.type || 'image';
    
    if (!src) return res.status(400).json({ error: 'Kaynak eksik' });
    if (!isValidInstagramUrl(src)) return res.status(403).json({ error: 'Geçersiz kaynak adresi' });

    if (type === 'video') {
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': 'https://www.instagram.com/',
            'Accept': '*/*'
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
            console.error('Proxy video error:', err.message);
            res.status(500).json({ error: 'Video yüklenemedi' });
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
    if (!isValidInstagramUrl(src)) return res.status(403).send('Geçersiz kaynak adresi');

    try {
        const response = await axios({
            url: src,
            method: 'GET',
            responseType: 'stream',
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
            }
        });

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
        res.status(500).send('Dosya indirilemedi');
    }
});

// ── Common RapidAPI Headers ──
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST;
const RAPIDAPI_HEADERS = {
    'x-rapidapi-key': RAPIDAPI_KEY,
    'x-rapidapi-host': RAPIDAPI_HOST,
    'Content-Type': 'application/json'
};
const RAPIDAPI_BASE = `https://${RAPIDAPI_HOST}/api/instagram`;

// ── Search API ──
app.get('/api/search', async (req, res) => {
    const username = (req.query.username || '').replace(/[^a-zA-Z0-9._]/g, '');
    if (!username) return res.status(400).json({ error: 'Username gerekli' });

    try {
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
                    timestamp: node.taken_at_timestamp
                };
            });

            res.json({
                success: true,
                data: {
                    id: userData.id || null,
                    username: userData.username,
                    full_name: userData.full_name || username,
                    biography: userData.biography || '',
                    is_verified: userData.is_verified || false,
                    is_private: userData.is_private || false,
                    profile_pic_url_hd: `/api/proxy?src=${encodeURIComponent(hdUrl)}`,
                    profile_pic_original: hdUrl,
                    followers: userData.edge_followed_by?.count || 0,
                    following: userData.edge_follow?.count || 0,
                    posts: userData.edge_owner_to_timeline_media?.count || 0,
                    recent_posts: recentPosts
                }
            });
        } else {
            res.status(403).json({ success: false, error: 'Instagram erişimi reddetti' });
        }
    } catch (e) {
        console.error('Search Proxy Hatası:', e.message);
        const status = e.response?.status || 500;
        let errorMessage = 'Instagram sunucularına şu an ulaşılamıyor.';
        
        if (status === 404) errorMessage = 'Kullanıcı bulunamadı';
        if (status === 429) errorMessage = 'Instagram hız sınırı uyguluyor (Lütfen bekleyin)';
        if (status === 403) errorMessage = 'Instagram erişimi engelledi';

        res.status(status).json({ success: false, error: errorMessage });
    }
});

// ── Stories API ──
app.get('/api/stories', async (req, res) => {
    const username = (req.query.username || '').replace(/[^a-zA-Z0-9._]/g, '');
    if (!username) return res.status(400).json({ success: false, error: 'Username gerekli' });

    try {
        const response = await axios.post(`${RAPIDAPI_BASE}/stories`, {
            username: username,
            maxId: ""
        }, {
            headers: RAPIDAPI_HEADERS,
            timeout: 15000
        });

        const rawData = response.data;
        let storesPool = [];
        
        if (rawData.reels && Array.isArray(rawData.reels)) {
            storesPool = rawData.reels.flatMap(r => r.items || [r]);
        } else if (rawData.data?.reels && Array.isArray(rawData.data.reels)) {
            storesPool = rawData.data.reels.flatMap(r => r.items || [r]);
        } else if (rawData.items && Array.isArray(rawData.items)) {
            storesPool = rawData.items;
        } else if (Array.isArray(rawData.data)) {
            storesPool = rawData.data;
        }

        const formattedStories = storesPool.map((item, idx) => {
            try {
                const story = Array.isArray(item) ? item[0] : item;
                if (!story || typeof story !== 'object') return null;

                const isVideo = story.media_type === 2 || !!story.video_versions || !!story.video_url;
                
                let rawUrl = '';
                if (isVideo) {
                    const v = story.video_versions || [];
                    rawUrl = (v[0]?.url || v[0]) || story.video_url || story.url || '';
                } else {
                    const c = (story.image_versions2?.candidates) || story.image_versions || story.candidates || [];
                    rawUrl = (c[0]?.url || c[0]) || story.image_url || story.display_url || story.url || '';
                }

                if (!rawUrl) return null;

                const c = (story.image_versions2?.candidates) || story.image_versions || story.candidates || [];
                const thumbUrl = c[c.length - 1]?.url || story.thumbnail_url || story.display_url || rawUrl;

                return {
                    id: story.id || story.pk || `s_${idx}`,
                    url: `/api/proxy?src=${encodeURIComponent(rawUrl)}&type=${isVideo ? 'video' : 'image'}`,
                    original_url: rawUrl,
                    thumbnail_url: `/api/proxy?src=${encodeURIComponent(thumbUrl)}&type=image`,
                    taken_at: story.taken_at || Math.floor(Date.now() / 1000),
                    media_type: isVideo ? 'video' : 'image'
                };
            } catch (err) {
                return null;
            }
        }).filter(Boolean);

        res.json({ success: true, data: formattedStories });

    } catch (e) {
        console.error('Stories Error:', e.message);
        res.status(500).json({ success: false, error: 'Instagram hikayelerine şu an erişilemiyor.' });
    }
});

// ── Other RapidAPI Endpoints (Secured) ──
app.get('/api/instagram/get', async (req, res) => {
    try {
        const response = await axios.get(`${RAPIDAPI_BASE}/get`, { headers: RAPIDAPI_HEADERS });
        res.json({ success: true, data: response.data });
    } catch (e) {
        res.status(e.response?.status || 500).json({ success: false, error: 'İşlem başarısız oldu' });
    }
});

app.post('/api/instagram/links', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'URL gerekli' });
        const response = await axios.post(`${RAPIDAPI_BASE}/links`, { url }, { headers: RAPIDAPI_HEADERS });
        res.json({ success: true, data: response.data });
    } catch (e) {
        res.status(e.response?.status || 500).json({ success: false, error: 'İşlem başarısız oldu' });
    }
});

app.post('/api/instagram/profile', async (req, res) => {
    try {
        const { username } = req.body;
        if (!username) return res.status(400).json({ error: 'Username gerekli' });
        const response = await axios.post(`${RAPIDAPI_BASE}/profile`, { username }, { headers: RAPIDAPI_HEADERS });
        res.json({ success: true, data: response.data });
    } catch (e) {
        res.status(e.response?.status || 500).json({ success: false, error: 'İşlem başarısız oldu' });
    }
});

app.post('/api/instagram/story', async (req, res) => {
    try {
        const { username, storyId } = req.body;
        const response = await axios.post(`${RAPIDAPI_BASE}/story`, { username, storyId }, { headers: RAPIDAPI_HEADERS });
        res.json({ success: true, data: response.data });
    } catch (e) {
        res.status(e.response?.status || 500).json({ success: false, error: 'İşlem başarısız oldu' });
    }
});

app.post('/api/instagram/highlights', async (req, res) => {
    try {
        const { username } = req.body;
        const response = await axios.post(`${RAPIDAPI_BASE}/highlights`, { username }, { headers: RAPIDAPI_HEADERS });
        res.json({ success: true, data: response.data });
    } catch (e) {
        res.status(e.response?.status || 500).json({ success: false, error: 'İşlem başarısız oldu' });
    }
});

app.post('/api/instagram/highlightStories', async (req, res) => {
    try {
        let hId = req.body.highlightId;
        if (hId && !hId.startsWith('highlight:')) hId = 'highlight:' + hId;
        const response = await axios.post(`${RAPIDAPI_BASE}/highlightStories`, { highlightId: hId }, { headers: RAPIDAPI_HEADERS });
        res.json({ success: true, data: response.data });
    } catch (e) {
        res.status(e.response?.status || 500).json({ success: false, error: 'İşlem başarısız oldu' });
    }
});

app.post('/api/instagram/userInfo', async (req, res) => {
    try {
        const { username } = req.body;
        const response = await axios.post(`${RAPIDAPI_BASE}/userInfo`, { username }, { headers: RAPIDAPI_HEADERS });
        res.json({ success: true, data: response.data });
    } catch (e) {
        res.status(e.response?.status || 500).json({ success: false, error: 'İşlem başarısız oldu' });
    }
});

app.post('/api/instagram/mediaByShortcode', async (req, res) => {
    const { shortcode } = req.body;
    if (!shortcode) return res.status(400).json({ error: 'Shortcode gerekli' });
    
    try {
        const response = await axios.post(`${RAPIDAPI_BASE}/mediaByshortcode`, { shortcode }, { headers: RAPIDAPI_HEADERS });
        res.json({ success: true, data: response.data });
    } catch (e) {
        res.status(e.response?.status || 500).json({ success: false, error: 'İşlem başarısız oldu' });
    }
});

app.post('/api/instagram/reels', async (req, res) => {
    try {
        const { username, maxId } = req.body;
        const response = await axios.post(`${RAPIDAPI_BASE}/reels`, { username, maxId: maxId || "" }, { headers: RAPIDAPI_HEADERS });
        res.json({ success: true, data: response.data });
    } catch (e) {
        res.status(e.response?.status || 500).json({ success: false, error: 'İşlem başarısız oldu' });
    }
});

app.post('/api/instagram/posts', async (req, res) => {
    try {
        const { username, maxId } = req.body;
        const response = await axios.post(`${RAPIDAPI_BASE}/posts`, { username, maxId: maxId || "" }, { headers: RAPIDAPI_HEADERS });
        res.json({ success: true, data: response.data });
    } catch (e) {
        res.status(e.response?.status || 500).json({ success: false, error: 'İşlem başarısız oldu' });
    }
});

module.exports = app;

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Server is running at http://localhost:${PORT}`);
    });
}