const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const ignored = new Set(['node_modules', 'output', 'dist', '.git', '.playwright-cli', '.playwright']);
const errors = [];
function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        if (ignored.has(entry.name)) return [];
        const file = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(file) : [file];
    });
}
const required = ['boss-helper.user.js', 'README.md', 'LICENSE', 'NOTICE.md', 'CHANGELOG.md', 'AGENTS.md', 'package.json', 'package-lock.json',
    'docs/INSTALL.md', 'docs/CONFIGURATION.md', 'docs/FAQ.md', 'docs/DEVELOPMENT.md', 'docs/PUBLISHING.md', 'docs/TEST-REPORT.md',
    'docs/images/allow-user-scripts.png', 'docs/images/floating-button.png', 'docs/images/filter-settings.png', 'docs/images/running-panel.png',
    '.github/workflows/check.yml', '.github/workflows/release.yml'];
for (const file of required) if (!fs.existsSync(path.join(root, file))) errors.push('Missing: ' + file);
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const source = fs.readFileSync(path.join(root, 'boss-helper.user.js'), 'utf8');
if (source.match(/^\/\/ @version\s+(\S+)/m)?.[1] !== pkg.version || !source.includes(`VERSION: '${pkg.version}'`)) errors.push('Script/package version mismatch');
if (!source.includes('// @license      AGPL-3.0-or-later')) errors.push('Script license metadata missing');
if (!source.includes('https://github.com/huazhounb')) errors.push('Author URL missing');
if (source.includes('__bossTest') || source.includes('LOCAL_TEST_ONLY') || source.includes('example.invalid')) errors.push('Test-only content in delivery script');
const profileLiteral = source.match(/const DEFAULT_PROFILE = (\{[\s\S]*?\n    \});/)?.[1];
if (!profileLiteral) errors.push('DEFAULT_PROFILE missing');
else {
    const profile = vm.runInNewContext('(' + profileLiteral + ')', {}, { timeout: 100 });
    if (['name', 'email', 'github'].some(key => key in profile)) errors.push('Personal identity fields in applicant defaults');
    if (!profile.greeting.includes('[目标岗位]') || !profile.aiRole.includes('不得自行推测或编造')) errors.push('Generic templates missing');
}
if (fs.existsSync(path.join(root, 'LICENSE')) && !fs.readFileSync(path.join(root, 'LICENSE'), 'utf8').includes('GNU AFFERO GENERAL PUBLIC LICENSE')) errors.push('License body incorrect');
if (fs.existsSync(path.join(root, 'package-lock.json'))) {
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) errors.push('Lockfile version mismatch');
}
const files = walk(root);
for (const file of files) {
    const rel = path.relative(root, file);
    if (/\.(?:js|cjs)$/.test(file)) {
        const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
        if (result.status !== 0) errors.push('Syntax: ' + rel + '\n' + result.stderr);
    }
    if (!/\.(?:js|cjs|json|md|html|yml|ps1)$/.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (/\b[A-Z0-9._%+-]+@(?:gmail|qq|163|126|outlook)\.com\b/i.test(text)) errors.push('Personal email in: ' + rel);
    if (/\bsk-[A-Za-z0-9_-]{20,}\b/.test(text)) errors.push('Potential API secret in: ' + rel);
    if (!file.endsWith('.md')) continue;
    for (const match of text.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
        const target = match[1].split('#')[0];
        if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
        const absolute = path.resolve(path.dirname(file), decodeURIComponent(target));
        const fromRoot = path.relative(root, absolute);
        if (fromRoot.startsWith('..') || path.isAbsolute(fromRoot) || !fs.existsSync(absolute)) errors.push(`Broken/local link in ${rel}: ${target}`);
    }
}
if (errors.length) {
    console.error(errors.join('\n')); process.exitCode = 1;
} else console.log(`Release checks passed: v${pkg.version}, ${files.length} public files, syntax/templates/links/privacy/license.`);
