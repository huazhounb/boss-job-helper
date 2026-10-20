async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const results = [], errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => { if (!req.url().startsWith('http://127.0.0.1:4180/')) external.push(req.url()); });
    const check = async (name, fn) => {
        const result = await page.evaluate(fn);
        if (result !== true) throw new Error(name + ': ' + JSON.stringify(result));
        results.push(name);
    };
    await page.goto('http://127.0.0.1:4180/web/geek/jobs?test=1');
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload(); await page.waitForFunction(() => window.__bossTest?.refs.startButton);
    await check('公开版首次安装加载通用话术和人设，作者链接正确，不含个人邮箱', () => {
        const { refs, isAiEnabled } = window.__bossTest;
        return refs.inputs.greeting.value.includes('[目标岗位]') && refs.inputs.greeting.value.includes('[相关技能/经验]')
            && refs.inputs.aiRole.value.includes('不得自行推测或编造') && !refs.root.textContent.includes('@gmail.com')
            && refs.root.querySelector('.creator a').href === 'https://github.com/huazhounb' && !isAiEnabled();
    });
    await page.goto('http://127.0.0.1:4180/web/geek/chat?test=1');
    await page.waitForFunction(() => window.__bossTest?.refs.startButton);
    await check('未改默认占位符时阻止聊天启动，打开编辑窗口且零发送', () => {
        const { refs, state } = window.__bossTest; refs.startButton.click();
        return !state.running && !refs.settings.hidden && !window.fixture.sent.length
            && state.logItems.some(item => item.message.includes('替换为自己的真实资料'));
    });
    await page.goto('http://127.0.0.1:4180/web/geek/jobs?test=1');
    await page.evaluate(() => {
        localStorage.clear(); sessionStorage.clear();
        const old = { targetJobs: '前端,Vue,AI', targetCities: '广州', greeting: '保留我的原话术', processedHRs: '["legacy-hr"]',
            apiEndpoint: 'https://example.invalid/v1/chat/completions', aiKey: 'LOCAL_TEST_ONLY', aiModel: 'local-model', applyWaitMin: '5500' };
        Object.entries(old).forEach(([key, value]) => localStorage.setItem('hz_boss_helper_v2_' + key, value));
    });
    await page.reload(); await page.waitForFunction(() => window.__bossTest?.refs.startButton);
    await check('旧筛选、话术、HR 记录和接口配置保留，已有 Key 不自动打开 AI', () => {
        const { refs, state, isAiEnabled } = window.__bossTest;
        return refs.inputs.greeting.value === '保留我的原话术' && state.processedHRs.has('legacy-hr') && !isAiEnabled()
            && refs.inputs.experienceMode.value === 'any' && refs.inputs.educationMode.value === 'any'
            && localStorage.getItem('hz_boss_helper_v2_aiKey') === 'LOCAL_TEST_ONLY';
    });
    await check('预览与执行使用相同筛选结果、理由可见，预览不点击也不记本轮统计', () => {
        const { refs, Filters, UI, state } = window.__bossTest;
        refs.inputs.excludeWords.value = '培训；销售'; refs.inputs.experienceMode.value = 'intern'; refs.inputs.educationMode.value = '本科';
        UI.previewMatches();
        const rows = Filters.scan(), matched = rows.filter(row => row.matched).map(row => row.card.dataset.jobId);
        return JSON.stringify(matched) === JSON.stringify(['intern', 'ai']) && rows.length === 8
            && refs.panel.querySelector('[data-preview-count]').textContent.includes('匹配 2')
            && refs.panel.querySelector('[data-preview-list]').textContent.includes('排除词：培训')
            && !window.fixture.clicks.length && !state.scannedThisRun;
    });
    await check('关键词拼写只在主动点击后修正，不修改其他词', () => {
        const { refs, UI } = window.__bossTest;
        refs.inputs.targetJobs.value = 'web,angent,devangent'; UI.syncKeywordHint();
        if (refs.panel.querySelector('[data-keyword-hint]').hidden) return false;
        refs.panel.querySelector('[data-action=fixKeyword]').click();
        return refs.inputs.targetJobs.value === 'web,agent,devangent' && refs.panel.querySelector('[data-keyword-hint]').hidden;
    });
    await check('打开设置保留尚未保存筛选，秒数换算及取消编辑正确', () => {
        const { refs, UI } = window.__bossTest;
        refs.inputs.targetJobs.value = '前端,Vue,AI'; refs.inputs.targetCities.value = '深圳';
        UI.openSettings();
        if (refs.inputs.targetCities.value !== '深圳' || refs.inputs.applyWaitMin.value !== '5.5') return false;
        refs.inputs.greeting.value = '不应保留'; UI.closeSettings();
        UI.openSettings(); refs.inputs.applyWaitMin.value = '6.25'; UI.saveSettings();
        return refs.inputs.greeting.value === '保留我的原话术' && localStorage.getItem('hz_boss_helper_v2_applyWaitMin') === '6250';
    });
    await check('等待区间反转与零批次阻止保存', () => {
        const { refs, UI } = window.__bossTest;
        UI.openSettings(); refs.inputs.applyWaitMin.value = '20'; refs.inputs.applyWaitMax.value = '10';
        if (UI.saveSettings() !== false || refs.settings.hidden) return false;
        refs.inputs.applyWaitMin.value = '5'; refs.inputs.batchSize.value = '0';
        if (UI.saveSettings() !== false) return false;
        refs.inputs.batchSize.value = '8'; return UI.saveSettings();
    });
    for (const [width, height] of [[360, 740], [768, 1024], [1440, 1000]]) {
        await page.setViewportSize({ width, height });
        await check(`${width}px 标准/紧凑面板及全部展开设置无横向溢出，保存按钮可见`, () => {
            const { refs, UI, state } = window.__bossTest;
            const fits = () => {
                const box = refs.panel.getBoundingClientRect();
                const filters = refs.panel.querySelector('[data-filters]');
                return box.left >= 0 && box.right <= innerWidth && refs.panel.querySelector('.body').scrollWidth <= refs.panel.querySelector('.body').clientWidth + 1
                    && filters.scrollHeight <= filters.clientHeight + 1;
            };
            state.compact = false; UI.syncStatus(); if (!fits()) return 'normal overflow';
            UI.toggleCompact(); if (!fits()) return 'compact overflow';
            UI.openSettings(); refs.settings.querySelectorAll('details').forEach(el => { el.open = true; });
            refs.inputs.aiEnabled.checked = true; UI.syncAiFields();
            const card = refs.settings.querySelector('.settings-card').getBoundingClientRect();
            const save = refs.settings.querySelector('[data-action=saveSettings]').getBoundingClientRect();
            const body = refs.settings.querySelector('.settings-body');
            return card.left >= 15 && card.right <= innerWidth - 15 && save.bottom <= innerHeight - 15 && body.scrollWidth <= body.clientWidth + 1;
        });
        await page.screenshot({ path: `output/playwright/settings-${width}.png` });
        await page.evaluate(() => window.__bossTest.UI.closeSettings());
        await page.screenshot({ path: `output/playwright/panel-${width}.png` });
    }
    await check('AI 开关及配置显示正确，关闭不删除旧 Key', () => {
        const { UI, refs, isAiEnabled } = window.__bossTest;
        UI.openSettings(); refs.inputs.aiEnabled.checked = true; UI.syncAiFields();
        if (refs.settings.querySelector('[data-ai-fields]').hidden || !UI.saveSettings() || !isAiEnabled()) return false;
        UI.openSettings(); refs.inputs.aiEnabled.checked = false; UI.syncAiFields(); UI.saveSettings();
        return !isAiEnabled() && localStorage.getItem('hz_boss_helper_v2_aiKey') === 'LOCAL_TEST_ONLY';
    });
    await check('最小化恢复及 Escape 返回设置按钮焦点', () => {
        const { refs, UI } = window.__bossTest;
        UI.openSettings(); refs.settings.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        if (!refs.settings.hidden || refs.root.activeElement !== refs.panel.querySelector('[data-action=settings]')) return false;
        UI.minimize(); if (!refs.panel.classList.contains('hidden')) return false;
        refs.mini.click(); return !refs.panel.classList.contains('hidden');
    });
    await check('空筛选可保存为不限，紧凑模式保存', () => {
        const { refs, state, UI } = window.__bossTest;
        refs.inputs.targetJobs.value = ''; refs.inputs.targetCities.value = ''; refs.inputs.excludeWords.value = '';
        state.compact = false; UI.toggleCompact();
        return UI.saveSettings() && localStorage.getItem('hz_boss_helper_v2_targetJobs') === '';
    });
    await page.reload(); await page.waitForFunction(() => window.__bossTest?.refs.startButton);
    await check('刷新恢复紧凑模式及空筛选，不自行启动', () => {
        const { refs, state } = window.__bossTest;
        return state.compact && !state.running && refs.inputs.targetJobs.value === '' && refs.inputs.targetCities.value === '';
    });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.bringToFront();
    await check('复制日志包含正文，未含接口 Key', async () => {
        const { UI } = window.__bossTest; UI.log('用于复制与导出的检查日志');
        await UI.copyLog(); const text = await navigator.clipboard.readText();
        return text.includes('用于复制与导出的检查日志') && !text.includes('LOCAL_TEST_ONLY');
    });
    const downloadPromise = page.waitForEvent('download');
    await page.evaluate(() => window.__bossTest.UI.downloadLog());
    const download = await downloadPromise;
    await download.saveAs('output/playwright/exported-log.txt');
    results.push('日志导出产生 TXT 下载');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => { const { refs, UI } = window.__bossTest; refs.inputs.targetJobs.value = '前端,Vue,AI'; refs.inputs.targetCities.value = '广州'; refs.inputs.excludeWords.value = '培训'; refs.inputs.experienceMode.value = 'intern'; refs.inputs.educationMode.value = 'any'; UI.previewMatches(); refs.panel.querySelector('[data-preview]').scrollIntoView({block:'center'}); });
    await page.screenshot({ path: 'output/playwright/preview-final.png' });
    if (errors.length || external.length) throw new Error(JSON.stringify({ errors, external }));
    return { passed: results.length, results, errors, externalRequests: external.length };
}
