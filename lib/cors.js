const allowedOriginsEnv = process.env.ALLOWED_ORIGIN;
const ALLOWED_ORIGINS = allowedOriginsEnv
    ? allowedOriginsEnv.split(',').map(origin => origin.trim()).filter(Boolean)
    : [];

function handleCors(req, res) {
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
        res.status(200).end();
        return true;
    }

    const origin = req.headers.origin;

    if (ALLOWED_ORIGINS.length === 0) {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    else if (ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    return false;
}

module.exports = { cors: handleCors, applyCors: handleCors };