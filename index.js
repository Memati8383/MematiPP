require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const fs = require('fs');

const app = express();

// ── Vercel / Proxy Support ──
app.set('trust proxy', 1);

// ── Security Headers ──
app.use((req, res, next) => {
    res.locals.nonce = crypto.randomBytes(16).toString('base64');
    next();
});

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

app.use((req, res, next) => {
    const csp = [
        "default-src 'self'",
        `script-src 'self' 'nonce-${res.locals.nonce}' https://*.rapidapi.com`,
        "script-src-attr 'none'",
        `style-src 'self' 'nonce-${res.locals.nonce}' https://fonts.googleapis.com`,
        "img-src 'self' data: https://*.cdninstagram.com https://*.fbcdn.net",
        "media-src 'self' https://*.cdninstagram.com https://*.fbcdn.net",
        "frame-src 'self' https://www.instagram.com",
        "connect-src 'self' https://*.instagram.com https://*.rapidapi.com",
        "font-src 'self' https://fonts.gstatic.com",
        "upgrade-insecure-requests",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'self'",
        "object-src 'none'"
    ];
    res.setHeader('Content-Security-Policy', csp.join('; '));
    next();
});

// ── Rate Limiting ──
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: { success: false, error: 'Çok fazla istek gönderdiniz. Lütfen 15 dakika bekleyin.' }
});
app.use('/api/', limiter);

app.use(express.json());

// Ana sayfayı servis et
const htmlTemplate = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');

app.get('/', (req, res) => {
    const nonce = res.locals.nonce;
    const html = htmlTemplate
        .replace(/<script(?![^>]*src=)/g, `<script nonce="${nonce}"`)
        .replace(/<style(?![^>]*nonce)/g, `<style nonce="${nonce}"`);
    res.type('html').send(html);
});

// ── SSRF Protection Helper ──
function isValidInstagramUrl(urlStr) {
    try {
        const url = new URL(urlStr);
        const allowedHosts = [
            'cdninstagram.com',
            'fbcdn.net',
            'fna.fbcdn.net'
        ];
        const hostname = url.hostname.toLowerCase();
        return allowedHosts.some(host => {
            return hostname === host || hostname.endsWith('.' + host);
        });
    } catch (e) {
        return false;
    }
}

// ── Proxy API ──
app.get('/api/proxy', (req, res) => {
    const src = req.query.src;
    const type = req.query.type || 'image';
    
    if (!src) return res.status(400).json({ error: 'Kaynak eksik' });
    if (!isValidInstagramUrl(src)) {
        return res.status(403).json({ error: 'Geçersiz kaynak adresi' });
    }

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://www.instagram.com/',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
    };
    if (req.headers.range) headers.range = req.headers.range;

    axios({
        url: src,
        method: 'GET',
        responseType: 'stream',
        headers: headers,
        timeout: 20000
    }).then(response => {
        res.status(response.status);
        ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'].forEach(h => {
            if (response.headers[h]) res.setHeader(h, response.headers[h]);
        });
        // Ensure content-type is set if missing
        if (!res.getHeader('content-type')) {
            res.setHeader('content-type', type === 'video' ? 'video/mp4' : 'image/jpeg');
        }
        response.data.pipe(res);
    }).catch(err => {
        console.error('Proxy error:', err.message);
        res.status(500).json({ error: 'Medya yüklenemedi' });
    });
});

// ── Download API (Forcing download) ──
app.get('/api/download', async (req, res) => {
    const src = req.query.src;
    const filename = req.query.filename || 'instagram_media';
    
    if (!src) return res.status(400).send('Kaynak eksik');
    if (!isValidInstagramUrl(src)) return res.status(403).send('Geçersiz kaynak adresi');

    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/__+/g, '_').replace(/^[_\.]+|[_\.]+$/g, '');

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
        
        const finalFilename = safeFilename.includes('.') ? safeFilename : `${safeFilename}.${ext}`;

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
        let userData = null;
        let lastError = null;

        // Try /profile then /userInfo as fallback
        const endpoints = ['/profile', '/userInfo'];
        
        for (const endpoint of endpoints) {
            try {
                const response = await axios.post(`${RAPIDAPI_BASE}${endpoint}`, { username }, {
                    headers: RAPIDAPI_HEADERS,
                    timeout: 20000 
                });

                const raw = response.data;
                // Comprehensive extraction logic
                const candidate = raw?.data?.user || raw?.user || raw?.data || raw?.result || 
                                 (raw?.username || raw?.id || raw?.pk ? raw : null);
                
                const finalCandidate = Array.isArray(candidate) ? candidate[0] : candidate;

                if (finalCandidate && (finalCandidate.username || finalCandidate.id || finalCandidate.pk)) {
                    userData = finalCandidate;
                    break; 
                }
            } catch (e) {
                lastError = e;
                continue;
            }
        }

        if (userData) {
            const hdUrl = userData.hd_profile_pic_url_info?.url || 
                          userData.profile_pic_url_hd || 
                          userData.profile_pic_url || 
                          userData.hd_profile_pic_url || 
                          userData.profile_pic_original ||
                          "";
            
            const timelineEdges = userData.edge_owner_to_timeline_media?.edges || 
                                 userData.edge_owner_to_timeline_media || 
                                 userData.recent_posts || 
                                 userData.posts || [];
            
            const recentPosts = (Array.isArray(timelineEdges) ? timelineEdges : []).map(edge => {
                const node = edge.node || edge;
                if (!node || typeof node !== 'object') return null;
                return {
                    id: node.id || node.pk,
                    shortcode: node.shortcode || node.code || '',
                    display_url: `/api/proxy?src=${encodeURIComponent(node.display_url || node.thumbnail_src || node.image_url || node.display_src || '')}`,
                    likes: node.edge_liked_by?.count || node.like_count || node.likes || 0,
                    comments: node.edge_media_to_comment?.count || node.comment_count || node.comments || 0,
                    is_video: node.is_video || node.media_type === 2 || false,
                    caption: node.edge_media_to_caption?.edges?.[0]?.node?.text || node.caption?.text || (typeof node.caption === 'string' ? node.caption : ''),
                    timestamp: node.taken_at_timestamp || node.taken_at
                };
            }).filter(Boolean);

            res.json({
                success: true,
                data: {
                    id: userData.id || userData.pk || null,
                    fbid: userData.fbid || null,
                    username: userData.username || userData.user_name || username,
                    full_name: userData.full_name || userData.fullName || username,
                    biography: userData.biography || userData.bio || '',
                    is_verified: userData.is_verified || userData.isVerified || false,
                    is_private: userData.is_private || userData.isPrivate || false,
                    profile_pic_url_hd: `/api/proxy?src=${encodeURIComponent(hdUrl)}`,
                    profile_pic_original: hdUrl,
                    followers: userData.edge_followed_by?.count || userData.follower_count || userData.followers || 0,
                    following: userData.edge_follow?.count || userData.following_count || userData.following || 0,
                    posts: userData.edge_owner_to_timeline_media?.count || userData.media_count || userData.posts_count || recentPosts.length || 0,
                    highlight_reel_count: userData.highlight_reel_count || userData.highlights_count || 0,
                    is_joined_recently: userData.is_joined_recently || false,
                    is_professional_account: userData.is_professional_account || false,
                    category_name: userData.category_name || userData.business_category_name || '',
                    external_url: userData.external_url || userData.external_link || '',
                    recent_posts: recentPosts
                }
            });
        } else {
            const status = lastError?.response?.status || 404;
            let msg = 'Kullanıcı bulunamadı veya veri alınamadı.';
            if (status === 429) msg = 'Aşırı istek! Lütfen biraz bekleyip tekrar deneyin (Hız sınırı aşıldı).';
            if (status === 403) msg = 'Erişim yetkiniz yok veya engellendiniz (API hatası).';
            if (status === 500) msg = 'Instagram sunucuları yanıt vermiyor, birazdan tekrar deneyin.';
            res.status(status).json({ success: false, error: msg });
        }
    } catch (e) {
        console.error('Search API Critical Error:', e.message);
        res.status(500).json({ success: false, error: 'Sunucu hatası oluştu' });
    }
});

// ── Stories API ──
app.get('/api/stories', async (req, res) => {
    const username = (req.query.username || '').replace(/[^a-zA-Z0-9._]/g, '');
    if (!username) return res.status(400).json({ success: false, error: 'Username gerekli' });

    try {
        const response = await fetchWithRetry(`${RAPIDAPI_BASE}/stories`, {
            username: username,
            maxId: ""
        }, {
            headers: RAPIDAPI_HEADERS,
            timeout: 30000
        });

        const rawData = response.data;
        
        // Graceful handling of RapidAPI "not found" 200 OK responses
        if (rawData && rawData.success === false && rawData.message && rawData.message.toLowerCase().includes('not found')) {
            return res.json({ success: true, data: [] });
        }
        let storesPool = [];
        
        // Helper to find stories in nested objects
        const extractStories = (obj) => {
            if (!obj || typeof obj !== 'object') return [];
            
            // Common keys for story arrays
            if (Array.isArray(obj.items)) return obj.items;
            if (Array.isArray(obj.stories)) return obj.stories;
            if (Array.isArray(obj.reels)) return obj.reels.flatMap(r => r.items || [r]);
            if (Array.isArray(obj.reels_media)) return obj.reels_media.flatMap(r => r.items || [r]);
            if (obj.data) return extractStories(obj.data);
            if (obj.result) return extractStories(obj.result);
            if (Array.isArray(obj)) return obj;
            
            return [];
        };

        storesPool = extractStories(rawData);

        // Map items to standard format
        const formattedStories = (Array.isArray(storesPool) ? storesPool : []).map((item, idx) => {
            try {
                // Handle cases where item is an array [storyObj]
                const story = Array.isArray(item) ? item[0] : item;
                if (!story || typeof story !== 'object') return null;

                const isVideo = story.media_type === 2 || !!story.video_versions || !!story.video_url;
                
                let rawUrl = '';
                if (isVideo) {
                    const v = story.video_versions || [];
                    rawUrl = (v[0]?.url || v[0]) || story.video_url || story.url || '';
                } else {
                    const c = (story.image_versions2?.candidates || story.image_versions?.candidates) || 
                              story.image_versions || story.candidates || [];
                    rawUrl = (c[0]?.url || c[0]) || story.image_url || story.display_url || story.url || '';
                }

                if (!rawUrl) return null;

                const c = (story.image_versions2?.candidates || story.image_versions?.candidates) || 
                          story.image_versions || story.candidates || [];
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
        const errMsg = e.response?.data?.message || e.response?.data?.error || e.message || '';
        if (errMsg.toLowerCase().includes('not found')) {
            return res.json({ success: true, data: [] });
        }
        res.status(500).json({ success: false, error: 'Instagram hikayelerine şu an erişilemiyor. Lütfen daha sonra tekrar deneyin.' });
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

// Helper for robust API calls
const fetchWithRetry = async (url, data, config, retries = 3) => {
    let lastError;
    for (let i = 0; i < retries; i++) {
        try {
            return await axios.post(url, data, config);
        } catch (err) {
            lastError = err;
            // 404 (Not Found) or 400 (Bad Request) shouldn't be retried
            if (err.response && (err.response.status === 404 || err.response.status === 400)) {
                throw err;
            }
            // Wait 1.5 seconds before retrying
            await new Promise(r => setTimeout(r, 1500));
        }
    }
    throw lastError;
};

app.post('/api/instagram/reels', async (req, res) => {
    try {
        const { username, maxId } = req.body;
        const response = await fetchWithRetry(`${RAPIDAPI_BASE}/reels`, { username, maxId: maxId || "" }, { 
            headers: RAPIDAPI_HEADERS,
            timeout: 25000
        });
        
        if (response.data && response.data.success === false && response.data.message && response.data.message.toLowerCase().includes('not found')) {
            return res.json({ success: true, data: { result: { edges: [] } } });
        }
        
        res.json({ success: true, data: response.data });
    } catch (e) {
        console.error('Reels API Error:', e.response?.data || e.message);
        const errMsg = e.response?.data?.message || e.response?.data?.error || e.message || '';
        if (errMsg.toLowerCase().includes('not found')) {
            return res.json({ success: true, data: { result: { edges: [] } } });
        }
        res.status(e.response?.status || 500).json({ 
            success: false, 
            error: errMsg || 'Reels çekilemedi, lütfen tekrar deneyin.' 
        });
    }
});

app.post('/api/instagram/posts', async (req, res) => {
    try {
        const { username, maxId } = req.body;
        const response = await fetchWithRetry(`${RAPIDAPI_BASE}/posts`, { username, maxId: maxId || "" }, { 
            headers: RAPIDAPI_HEADERS,
            timeout: 25000
        });
        
        if (response.data && response.data.success === false && response.data.message && response.data.message.toLowerCase().includes('not found')) {
            return res.json({ success: true, data: { result: { edges: [] } } });
        }

        res.json({ success: true, data: response.data });
    } catch (e) {
        console.error('Posts API Error:', e.response?.data || e.message);
        const errMsg = e.response?.data?.message || e.response?.data?.error || e.message || '';
        if (errMsg.toLowerCase().includes('not found')) {
            return res.json({ success: true, data: { result: { edges: [] } } });
        }
        res.status(e.response?.status || 500).json({ success: false, error: 'Gönderiler çekilemedi' });
    }
});

// ── Additional Instagram120 Endpoints ──

app.post('/api/instagram/comments', async (req, res) => {
    try {
        const { shortcode, maxId } = req.body;
        if (!shortcode) return res.status(400).json({ error: 'Shortcode gerekli' });
        const response = await axios.post(`${RAPIDAPI_BASE}/comments`, { shortcode, maxId: maxId || "" }, { headers: RAPIDAPI_HEADERS });
        res.json({ success: true, data: response.data });
    } catch (e) {
        res.status(e.response?.status || 500).json({ success: false, error: 'Yorumlar çekilemedi' });
    }
});

app.post('/api/instagram/tagged', async (req, res) => {
    try {
        const { username, maxId } = req.body;
        if (!username) return res.status(400).json({ error: 'Username gerekli' });
        const response = await fetchWithRetry(`${RAPIDAPI_BASE}/tagged`, { username, maxId: maxId || "" }, { 
            headers: RAPIDAPI_HEADERS,
            timeout: 25000
        });
        
        if (response.data && response.data.success === false && response.data.message && response.data.message.toLowerCase().includes('not found')) {
            return res.json({ success: true, data: { result: { edges: [] } } });
        }
        
        res.json({ success: true, data: response.data });
    } catch (e) {
        console.error('Tagged API Error:', e.response?.data || e.message);
        const errMsg = e.response?.data?.message || e.response?.data?.error || e.message || '';
        if (errMsg.toLowerCase().includes('not found')) {
            return res.json({ success: true, data: { result: { edges: [] } } });
        }
        res.status(e.response?.status || 500).json({ success: false, error: 'Etiketlenen gönderiler çekilemedi' });
    }
});

app.post('/api/instagram/followers', async (req, res) => {
    try {
        const { username, maxId } = req.body;
        if (!username) return res.status(400).json({ error: 'Username gerekli' });
        const response = await axios.post(`${RAPIDAPI_BASE}/followers`, { username, maxId: maxId || "" }, { headers: RAPIDAPI_HEADERS });
        res.json({ success: true, data: response.data });
    } catch (e) {
        res.status(e.response?.status || 500).json({ success: false, error: 'Takipçiler çekilemedi' });
    }
});

app.post('/api/instagram/following', async (req, res) => {
    try {
        const { username, maxId } = req.body;
        if (!username) return res.status(400).json({ error: 'Username gerekli' });
        const response = await axios.post(`${RAPIDAPI_BASE}/following`, { username, maxId: maxId || "" }, { headers: RAPIDAPI_HEADERS });
        res.json({ success: true, data: response.data });
    } catch (e) {
        res.status(e.response?.status || 500).json({ success: false, error: 'Takip edilenler çekilemedi' });
    }
});

app.post('/api/instagram/search', async (req, res) => {
    try {
        const { query } = req.body;
        if (!query) return res.status(400).json({ error: 'Arama terimi gerekli' });
        const response = await axios.post(`${RAPIDAPI_BASE}/search`, { query }, { headers: RAPIDAPI_HEADERS });
        res.json({ success: true, data: response.data });
    } catch (e) {
        res.status(e.response?.status || 500).json({ success: false, error: 'Arama yapılamadı' });
    }
});

app.post('/api/instagram/location', async (req, res) => {
    try {
        const { locationId, maxId } = req.body;
        if (!locationId) return res.status(400).json({ error: 'Location ID gerekli' });
        const response = await axios.post(`${RAPIDAPI_BASE}/location`, { locationId, maxId: maxId || "" }, { headers: RAPIDAPI_HEADERS });
        res.json({ success: true, data: response.data });
    } catch (e) {
        res.status(e.response?.status || 500).json({ success: false, error: 'Konum verileri çekilemedi' });
    }
});

app.post('/api/instagram/hashtag', async (req, res) => {
    try {
        const { hashtag, maxId } = req.body;
        if (!hashtag) return res.status(400).json({ error: 'Hashtag gerekli' });
        const response = await axios.post(`${RAPIDAPI_BASE}/hashtag`, { hashtag, maxId: maxId || "" }, { headers: RAPIDAPI_HEADERS });
        res.json({ success: true, data: response.data });
    } catch (e) {
        res.status(e.response?.status || 500).json({ success: false, error: 'Hashtag verileri çekilemedi' });
    }
});

app.post('/api/instagram/similar', async (req, res) => {
    try {
        const { username } = req.body;
        if (!username) return res.status(400).json({ error: 'Username gerekli' });
        const response = await axios.post(`${RAPIDAPI_BASE}/similar`, { username }, { headers: RAPIDAPI_HEADERS });
        res.json({ success: true, data: response.data });
    } catch (e) {
        res.status(e.response?.status || 500).json({ success: false, error: 'Benzer hesaplar çekilemedi' });
    }
});

app.post('/api/instagram/about', async (req, res) => {
    try {
        const { username } = req.body;
        if (!username) return res.status(400).json({ error: 'Username gerekli' });
        const response = await axios.post(`${RAPIDAPI_BASE}/about`, { username }, { headers: RAPIDAPI_HEADERS });
        res.json({ success: true, data: response.data });
    } catch (e) {
        res.status(e.response?.status || 500).json({ success: false, error: 'Hesap bilgileri çekilemedi' });
    }
});

app.post('/api/instagram/likers', async (req, res) => {
    try {
        const { shortcode } = req.body;
        if (!shortcode) return res.status(400).json({ error: 'Shortcode gerekli' });
        const response = await axios.post(`${RAPIDAPI_BASE}/likers`, { shortcode }, { headers: RAPIDAPI_HEADERS });
        res.json({ success: true, data: response.data });
    } catch (e) {
        res.status(e.response?.status || 500).json({ success: false, error: 'Beğenenler çekilemedi' });
    }
});

app.post('/api/instagram/mediaById', async (req, res) => {
    try {
        const { mediaId } = req.body;
        if (!mediaId) return res.status(400).json({ error: 'Media ID gerekli' });
        const response = await axios.post(`${RAPIDAPI_BASE}/mediaById`, { mediaId }, { headers: RAPIDAPI_HEADERS });
        res.json({ success: true, data: response.data });
    } catch (e) {
        res.status(e.response?.status || 500).json({ success: false, error: 'Medya çekilemedi' });
    }
});

module.exports = app;

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Server is running at http://localhost:${PORT}`);
    });
}