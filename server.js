const http = require('http');
const fs = require('fs');
const path = require('path');

let PORT = 3050;
const ROOT = __dirname;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.bin': 'application/octet-stream',
    '.ico': 'image/x-icon'
};

const https = require('https');

const server = http.createServer((req, res) => {
    // CORS headers for all requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    let reqPath = decodeURI(req.url.split('?')[0]);

    // Endpoint informacyjny o dostępności API serwera
    if (reqPath === '/api/ai-status' && req.method === 'GET') {
        const hasKey = !!process.env.STABILITY_API_KEY;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', hasEnvKey: hasKey }));
        return;
    }

    // Bezpieczne serwerowe proxy do Stability AI (jeśli podano klucz w env)
    if (reqPath === '/api/generate-texture' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const payload = JSON.parse(body);
                const apiKey = process.env.STABILITY_API_KEY || payload.apiKey;

                if (!apiKey) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Brak klucza API po stronie serwera.' }));
                    return;
                }

                const postData = JSON.stringify({
                    text_prompts: payload.text_prompts,
                    cfg_scale: payload.cfg_scale || 7.5,
                    height: payload.height || 640,
                    width: payload.width || 1536,
                    samples: 1,
                    steps: payload.steps || 30
                });

                const options = {
                    hostname: 'api.stability.ai',
                    path: '/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Length': Buffer.byteLength(postData)
                    }
                };

                const apiReq = https.request(options, (apiRes) => {
                    let apiBody = '';
                    apiRes.on('data', d => { apiBody += d; });
                    apiRes.on('end', () => {
                        res.writeHead(apiRes.statusCode, { 'Content-Type': 'application/json' });
                        res.end(apiBody);
                    });
                });

                apiReq.on('error', (e) => {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                });

                apiReq.write(postData);
                apiReq.end();
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Nieprawidłowy format JSON.' }));
            }
        });
        return;
    }

    // Transparentne proxy dla lokalnego ComfyUI (http://127.0.0.1:8188) bez problemów z CORS
    if (reqPath.startsWith('/api/comfyui/')) {
        const subPath = req.url.replace(/^\/api\/comfyui\//, '');
        const targetUrl = new URL(`http://127.0.0.1:8188/${subPath}`);

        const proxyReq = http.request({
            hostname: targetUrl.hostname,
            port: targetUrl.port,
            path: targetUrl.pathname + targetUrl.search,
            method: req.method,
            headers: {
                ...req.headers,
                host: `${targetUrl.hostname}:${targetUrl.port}`
            }
        }, (proxyRes) => {
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            proxyRes.pipe(res);
        });

        proxyReq.on('error', (err) => {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `ComfyUI nie odpowiada na ${targetUrl.origin}: ${err.message}` }));
        });

        req.pipe(proxyReq);
        return;
    }

    // Transparentne proxy dla lokalnego AUTOMATIC1111 (http://127.0.0.1:7860) bez problemów z CORS
    if (reqPath.startsWith('/api/sd/')) {
        const subPath = req.url.replace(/^\/api\/sd\//, '');
        const targetUrl = new URL(`http://127.0.0.1:7860/${subPath}`);

        const proxyReq = http.request({
            hostname: targetUrl.hostname,
            port: targetUrl.port,
            path: targetUrl.pathname + targetUrl.search,
            method: req.method,
            headers: {
                ...req.headers,
                host: `${targetUrl.hostname}:${targetUrl.port}`
            }
        }, (proxyRes) => {
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            proxyRes.pipe(res);
        });

        proxyReq.on('error', (err) => {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `AUTOMATIC1111 nie odpowiada na ${targetUrl.origin}: ${err.message}` }));
        });

        req.pipe(proxyReq);
        return;
    }

    if (reqPath === '/') reqPath = '/index.html';
    
    const filePath = path.join(ROOT, reqPath);
    
    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 Not Found: ' + reqPath);
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.writeHead(200, {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache'
        });

        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
    });
});

function startServer(p) {
    server.listen(p, () => {
        console.log(`[ARTBAR KONFIGURATOR] Serwer uruchomiony: http://localhost:${p}`);
    }).on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`Port ${p} zajęty, próba portu ${p + 1}...`);
            startServer(p + 1);
        } else {
            console.error('Błąd serwera:', err);
        }
    });
}

startServer(PORT);
