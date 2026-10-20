const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'node_modules/@playwright/cli/playwright-cli.js');
if (!fs.existsSync(cli)) { console.error('Run npm ci first.'); process.exit(1); }
const browserIndex = process.argv.indexOf('--browser');
const browser = browserIndex >= 0 ? process.argv[browserIndex + 1] : process.platform === 'win32' ? 'msedge' : 'chrome';
const session = 'boss-public-' + process.pid;
// Tests deliberately use one fixed localhost origin for isolated storage.
const port = 4180;
function run(args, expectedPasses) {
    const result = spawnSync(process.execPath, [cli, '-s=' + session, ...args], { cwd: root, encoding: 'utf8', timeout: 180000, windowsHide: true });
    if (result.status !== 0 || result.error || result.stdout.includes('### Error')) throw new Error(result.error?.message || result.stderr || result.stdout);
    if (expectedPasses) {
        const raw = result.stdout.match(/### Result\s*\n([^\n]+)/)?.[1];
        const data = raw && JSON.parse(raw);
        if (!data || data.passed !== expectedPasses || data.errors?.length || data.externalRequests) throw new Error(result.stdout);
        console.log(JSON.stringify({ suite: args.at(-1), ...data }));
    }
}
async function main() {
    const server = spawn(process.execPath, ['tools/preview-server.cjs'], { cwd: root, env: { ...process.env, BOSS_PREVIEW_PORT: String(port) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let opened = false;
    try {
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Preview server startup timed out')), 10000);
            server.once('error', error => { clearTimeout(timer); reject(error); });
            server.once('exit', code => { clearTimeout(timer); reject(new Error('Preview server exited: ' + code)); });
            server.stderr.on('data', data => { clearTimeout(timer); reject(new Error(String(data))); });
            server.stdout.on('data', data => { if (String(data).includes('Preview:')) { clearTimeout(timer); resolve(); } });
        });
        fs.mkdirSync(path.join(root, 'output/playwright'), { recursive: true });
        run(['open', `http://127.0.0.1:${port}/web/geek/jobs?test=1`, '--browser', browser]); opened = true;
        run(['run-code', '--filename', 'tests/ui-checks.js'], 16);
        run(['run-code', '--filename', 'tests/flow-checks.js'], 16);
        console.log('Browser checks passed: 32. All actions used localhost fixtures.');
    } finally {
        if (opened) {
            try { run(['close']); } catch (error) { console.error(error.message); }
        }
        server.kill();
    }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
