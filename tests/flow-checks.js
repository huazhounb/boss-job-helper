async (page) => {
    const results = [], errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => { if (!req.url().startsWith('http://127.0.0.1:4180/')) external.push(req.url()); });
    const reset = async (route = '/web/geek/jobs', query = '') => {
        await page.goto('http://127.0.0.1:4180/web/geek/jobs?test=1');
        await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
        await page.goto(`http://127.0.0.1:4180${route}?test=1${query}`);
        await page.waitForFunction(() => window.__bossTest?.refs.startButton);
        await page.evaluate(() => {
            const { Core, refs } = window.__bossTest;
            const delay = Core.delay, humanDelay = Core.humanDelay;
            window.originalDelay = delay; window.originalHumanDelay = humanDelay;
            Core.delay = ms => delay.call(Core, Math.min(ms, 20));
            window.restCount = 0;
            Core.humanDelay = async (_min, _max, reason = '') => {
                if (reason.includes('批次休息')) window.restCount++;
                await humanDelay.call(Core, 15, 15, reason);
            };
            refs.inputs.targetJobs.value = '前端,Vue,AI,Web'; refs.inputs.targetCities.value = '广州';
            refs.inputs.excludeWords.value = '培训'; refs.inputs.greeting.value = '本地流程检查话术';
            refs.inputs.maxApplyPerRun.value = '3'; refs.inputs.batchSize.value = '1';
            // Save the configured test profile before opening another settings section.
            // The public default intentionally contains placeholders and cannot start chat.
            if (!window.__bossTest.UI.saveSettings()) throw new Error('Fixture settings failed validation');
        });
    };
    const start = () => page.evaluate(() => window.__bossTest.refs.startButton.click());
    const stop = () => page.evaluate(() => { if (window.__bossTest.state.running) window.__bossTest.stopProcess(); });
    await reset(); await start();
    await page.waitForFunction(() => !window.__bossTest.state.running && window.__bossTest.state.appliedThisRun === 3);
    let actual = await page.evaluate(() => ({ clicks: fixture.clicks, selected: fixture.selected, stays: fixture.stays, rests: restCount,
        scanned: __bossTest.state.scannedThisRun, added: __bossTest.state.newChatsThisRun, old: __bossTest.state.existingChatsThisRun,
        skipped: __bossTest.state.skippedThisRun, failed: __bossTest.state.failedThisRun, text: __bossTest.refs.panel.querySelector('[data-counters]').textContent }));
    if (actual.clicks.length !== 3 || JSON.stringify(actual.selected) !== JSON.stringify(['intern','old','senior']) || actual.stays !== 3 || actual.rests !== 2 || actual.scanned !== 8 || actual.added !== 2 || actual.old !== 1 || actual.skipped !== 3 || actual.failed) throw new Error(JSON.stringify(actual));
    results.push('筛选实际执行、新旧沟通分类、已扫描去重及跳过统计准确');
    results.push('批次休息不重复、同页 query 更新不中断、每轮上限停止');
    await reset('/web/geek/jobs', '&modalDelay=1100');
    await page.evaluate(() => { __bossTest.refs.inputs.maxApplyPerRun.value = '1'; }); await start();
    await page.waitForFunction(() => !__bossTest.state.running && fixture.stays === 1);
    results.push('1100ms 延迟弹窗被等待并关闭');
    await reset();
    await page.evaluate(() => {
        __bossTest.refs.inputs.maxApplyPerRun.value = '8';
        const hidden = document.createElement('a'); hidden.className = 'op-btn-chat'; hidden.style.display = 'none'; hidden.textContent = '继续沟通'; document.body.prepend(hidden);
    });
    await start();
    await page.waitForFunction(() => __bossTest.state.skippedThisRun === 4 && __bossTest.state.appliedThisRun === 4);
    actual = await page.evaluate(() => ({ clicks: fixture.clicks, unique: new Set(fixture.selected).size, count: fixture.selected.length }));
    if (actual.clicks.length !== 4 || actual.unique !== 5 || actual.count !== 5) throw new Error(JSON.stringify(actual));
    await stop(); results.push('不可沟通按钮跳过、隐藏按钮不误点、同轮岗位不重复处理');
    await reset();
    await page.evaluate(() => {
        __bossTest.refs.inputs.maxApplyPerRun.value = '1';
        document.querySelector('[data-job-id=intern]').addEventListener('click', () => document.querySelector('.detail').replaceChildren());
    }); await start();
    await page.waitForFunction(() => !__bossTest.state.running && __bossTest.state.appliedThisRun === 1);
    actual = await page.evaluate(() => ({ fail: __bossTest.state.failedThisRun, added: __bossTest.state.newChatsThisRun, old: __bossTest.state.existingChatsThisRun }));
    if (actual.fail !== 1 || actual.added || actual.old !== 1) throw new Error(JSON.stringify(actual));
    results.push('缺少按钮计入失败，不虚增沟通点击');
    await reset();
    await page.evaluate(() => {
        const { Core, refs, startProcess } = __bossTest;
        Core.start = async () => {}; startProcess();
        window.pendingWait = Core.delay(60000);
        __bossTest.setPhase('批次休息', 1500);
        window.UI_LOCK_CHECK = refs.inputs.targetJobs.disabled && refs.settings.querySelector('[data-action=saveSettings]').disabled && !refs.panel.querySelector('[data-filters]').open;
    });
    actual = await page.evaluate(() => ({ countdown: __bossTest.refs.panel.querySelector('[data-countdown]').textContent, locked: window.UI_LOCK_CHECK }));
    if (!actual.countdown || !actual.locked) throw new Error(JSON.stringify(actual));
    await page.waitForFunction(() => __bossTest.refs.panel.querySelector('[data-countdown]').textContent === '1s', null, { timeout: 1400 });
    await page.evaluate(async () => { __bossTest.stopProcess(); await window.pendingWait; });
    if (await page.evaluate(() => __bossTest.state.waiters.size || __bossTest.refs.panel.querySelector('[data-countdown]').textContent || __bossTest.refs.inputs.targetJobs.disabled)) throw new Error('Stop did not unlock/cancel wait');
    results.push('实时倒计时、运行锁定/折叠、停止取消长等待并解锁');
    await reset();
    await page.evaluate(() => {
        const { Core, startProcess, stopProcess } = __bossTest;
        Core.start = async () => {}; startProcess();
        const card = document.querySelector('[data-job-id=intern]');
        card.addEventListener('mouseover', () => { stopProcess(); startProcess(); }, { once: true });
        window.pendingClick = Core.simulateClick(card);
    });
    await page.evaluate(async () => { await window.pendingClick; });
    if (await page.evaluate(() => fixture.selected.length)) throw new Error('Old click survived stop/start');
    await stop(); results.push('鼠标事件中停止再启动，旧任务不继续点击');
    await reset();
    await page.evaluate(() => {
        const { refs } = __bossTest; refs.inputs.maxApplyPerRun.value = '5';
        document.querySelector('[data-job-id=old]').addEventListener('click', () => {
            const card = document.createElement('li'); card.className = 'job-card-box'; card.dataset.jobId = 'late';
            card.innerHTML = '<span class="job-name">前端实习</span><span class="company-name">后来科技</span><span class="company-location">广州</span>';
            card.addEventListener('click', () => {
                fixture.selected.push('late'); const detail = document.querySelector('.detail'); detail.innerHTML = '<a class="op-btn-chat">立即沟通</a>';
                detail.querySelector('a').addEventListener('click', () => { fixture.clicks.push(['late','立即沟通']); });
            });
            document.querySelector('.jobs').append(card);
        }, {once:true});
    }); await start();
    await page.waitForFunction(() => !__bossTest.state.running && __bossTest.state.appliedThisRun === 5);
    actual = await page.evaluate(() => ({ count:fixture.clicks.length, scanned:__bossTest.state.scannedThisRun, late:fixture.selected.filter(id=>id==='late').length }));
    if (actual.count !== 5 || actual.scanned !== 9 || actual.late !== 1) throw new Error(JSON.stringify(actual));
    results.push('列表新增岗位继续处理一次，已扫描统计随新增增长');
    await reset('/web/geek/jobs', '&redirect=1'); await start();
    await page.waitForFunction(() => location.pathname.includes('/chat') && !__bossTest.state.running);
    if (await page.evaluate(() => !!__bossTest.state.chatObserver || __aiRequestCount)) throw new Error('Redirect auto-started chat');
    results.push('跨页面停止并提示手动启动，不自动进入私信流程');
    await reset('/web/geek/chat'); await start();
    await page.waitForFunction(() => __bossTest.state.processedHRs.has('hr demo-示例公司'));
    actual = await page.evaluate(() => ({ sent: fixture.sent, resumes: fixture.resumes, confirmations: fixture.confirmations, progress: __bossTest.state.chatProgress['hr demo-示例公司'], ai: __aiRequestCount }));
    if (actual.sent.length !== 1 || actual.resumes !== 1 || actual.confirmations !== 1 || !actual.progress.greetingSent || !actual.progress.resumeSent || actual.ai) throw new Error(JSON.stringify(actual));
    await stop(); await start(); await page.waitForTimeout(200);
    if (await page.evaluate(() => fixture.sent.length !== 1)) throw new Error('Greeting repeated');
    await stop(); results.push('手动启动聊天保留原流程，确认话术回显和简历点击，重新启动不重发');
    await reset('/web/geek/chat', '&resumeBlocked=1'); await start();
    await page.waitForFunction(() => __bossTest.state.chatProgress['hr demo-示例公司']?.greetingSent);
    await page.waitForFunction(() => __bossTest.state.phase.includes('等待对方回复'));
    await stop();
    await page.evaluate(() => { document.querySelector('.toolbar-btn').classList.remove('unable'); });
    await start(); await page.waitForFunction(() => __bossTest.state.processedHRs.has('hr demo-示例公司'));
    if (await page.evaluate(() => fixture.sent.length !== 1 || fixture.confirmations !== 1)) throw new Error('Partial progress repeated greeting');
    await stop(); results.push('简历暂不可用时保存话术进度，恢复只补简历');
    await reset('/web/geek/chat', '&draft=1'); await start(); await page.waitForTimeout(400);
    if (await page.evaluate(() => fixture.sent.length || document.querySelector('#chat-input').textContent !== '保留我的手动草稿')) throw new Error('Draft overwritten');
    await stop(); results.push('已有手动草稿不覆盖、不自动发送');
    await reset('/web/geek/chat', '&noEcho=1'); await start();
    await page.waitForFunction(() => __bossTest.state.chatProgress['hr demo-示例公司']?.greetingPending);
    await stop(); await start(); await page.waitForTimeout(300);
    if (await page.evaluate(() => fixture.sent.length !== 1 || __bossTest.state.chatProgress['hr demo-示例公司'].greetingSent)) throw new Error('Uncertain greeting resent');
    await stop(); results.push('无消息回显保留待核对状态，重新启动不反复发送');
    await reset('/web/geek/chat');
    await page.evaluate(() => {
        const { refs, UI } = __bossTest; UI.openSettings(); refs.inputs.aiEnabled.checked = true; UI.syncAiFields();
        refs.inputs.apiEndpoint.value = 'https://example.invalid/v1/chat/completions'; refs.inputs.aiKey.value = 'LOCAL_TEST_ONLY'; UI.saveSettings();
        __bossTest.state.processedHRs.add('hr demo-示例公司');
    }); await start();
    await page.waitForFunction(() => __bossTest.state.aiReplyCount === 1);
    await page.evaluate(async () => { await __bossTest.Core.clickLatestChat(); });
    if (await page.evaluate(() => fixture.sent.length !== 1 || __aiRequestCount !== 1)) throw new Error('AI duplicated HR reply');
    await stop(); results.push('显式启用 AI 后本地模拟回复，同一条 HR 消息不重复请求或发送');
    await reset('/web/geek/chat');
    await page.evaluate(() => {
        const { refs, UI } = __bossTest; UI.openSettings(); refs.inputs.aiEnabled.checked = true; UI.syncAiFields();
        refs.inputs.apiEndpoint.value = 'https://example.invalid/v1/chat/completions'; refs.inputs.aiKey.value = 'LOCAL_TEST_ONLY'; UI.saveSettings();
        __bossTest.state.processedHRs.add('hr demo-示例公司');
        window.GM_xmlhttpRequest = options => { window.__aiRequestCount++; window.replyLater = options.onload; };
    }); await start();
    await page.waitForFunction(() => window.replyLater);
    await stop();
    await page.evaluate(() => { window.replyLater({ status:200, responseText:JSON.stringify({choices:[{message:{content:'不能发送的旧回复'}}]}) }); });
    await page.waitForTimeout(200);
    if (await page.evaluate(() => fixture.sent.length || __bossTest.state.aiReplyCount)) throw new Error('Late AI reply survived stop');
    results.push('停止后迟到的 AI 响应不发送、不计数');
    await reset('/web/geek/chat');
    await page.evaluate(() => {
        const { refs, UI } = __bossTest; UI.openSettings(); refs.inputs.aiEnabled.checked = true; UI.syncAiFields();
        refs.inputs.apiEndpoint.value = 'https://example.invalid/v1/chat/completions'; refs.inputs.aiKey.value = 'LOCAL_TEST_ONLY'; UI.saveSettings();
        __bossTest.state.processedHRs.add('hr demo-示例公司');
        window.GM_xmlhttpRequest = options => { window.__aiRequestCount++; setTimeout(() => options.onload({status:401,responseText:'{"error":"unauthorized"}'}),10); };
    }); await start();
    await page.waitForFunction(() => __bossTest.state.logItems.some(item => item.message.includes('HTTP 401')));
    if (await page.evaluate(() => fixture.sent.length || __bossTest.state.aiReplyCount)) throw new Error('HTTP error counted as AI reply');
    await stop(); results.push('AI HTTP 错误可见且不发送、不增加回复计数');
    await reset();
    await page.evaluate(() => {
        const { Core, startProcess, UI } = __bossTest;
        Core.delay = ms => originalDelay.call(Core, ms > 40000 ? ms : Math.min(ms, 20));
        Core.humanDelay = (_min, _max, reason = '') => originalHumanDelay.call(Core, reason.includes('批次休息') ? 45000 : 15, reason.includes('批次休息') ? 45000 : 15, reason);
        startProcess(); UI.toggleCompact();
    });
    await page.waitForFunction(() => __bossTest.state.phase.includes('批次休息') && __bossTest.state.appliedThisRun === 1);
    await page.setViewportSize({ width:1440, height:1000 });
    await page.waitForTimeout(200);
    await page.screenshot({ path:'output/playwright/running-final.png' });
    await page.locator('.panel').screenshot({ path:'output/playwright/running-panel.png' }); await stop();
    if (errors.length || external.length) throw new Error(JSON.stringify({ errors, external }));
    return { passed:results.length, results, errors, externalRequests:external.length };
}
