// Serves only local preview files; no external requests or BOSS credentials.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const port = Number(process.env.BOSS_PREVIEW_PORT || 4180);
http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/boss-helper.user.js') {
        let source = fs.readFileSync(path.join(root, 'boss-helper.user.js'), 'utf8');
        if (url.searchParams.has('test')) {
            source = source.replace("    if (document.readyState === 'complete'", "    window.__bossTest = { UI, Core, refs, state, Filters, setPhase, startProcess, stopProcess, isAiEnabled };\n    if (document.readyState === 'complete'");
        }
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(source);
    } else if (url.pathname === '/fixture.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(fs.readFileSync(path.join(root, 'tools/fixture.js')));
    } else if (['/', '/preview.html', '/web/geek/jobs', '/web/geek/chat'].includes(url.pathname)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(fs.readFileSync(path.join(root, 'preview.html')));
    } else if (url.pathname === '/favicon.ico') {
        res.writeHead(204); res.end();
    } else {
        res.writeHead(404); res.end('Not found');
    }
}).listen(port, '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${port}`));
