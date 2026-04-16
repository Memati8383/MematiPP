module.exports = (req, res) => {
    const src = req.query.src;
    if (!src) return res.status(400).json({ error: 'Kaynak parametresi eksik' });

    // wsrv.nl üzerinden yönlendir
    const wsrvUrl = `https://wsrv.nl/?url=${encodeURIComponent(src)}`;
    res.redirect(wsrvUrl);
};
