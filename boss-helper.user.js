// ==UserScript==
// @name         BOSS 岗位投递助手
// @namespace    https://github.com/huazhounb
// @version      2.2.1
// @description  BOSS 投递助手：筛选预览、排除词、步骤倒计时、分类统计、紧凑面板与日志导出，AI 默认关闭。
// @author       huazhou
// @match        https://www.zhipin.com/*
// @match        https://*.zhipin.com/*
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// @connect      zhipin.com
// @connect      *
// @noframes
// @license      AGPL-3.0-or-later
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_PREFIX = 'hz_boss_helper_v2_';
    const storeKey = key => STORAGE_PREFIX + key;

    const CONFIG = {
        VERSION: '2.2.1',
        DEFAULT_LIMITS: {
            maxApplyPerRun: 30,
            batchSize: 8,
            dailyAiLimit: 20,
            detailWaitMin: 1800,
            detailWaitMax: 3600,
            applyWaitMin: 5000,
            applyWaitMax: 9000,
            breakWaitMin: 45000,
            breakWaitMax: 90000
        },
        SELECTORS: {
            jobCard: 'li.job-card-box',
            jobName: '.job-name',
            jobLocation: '.company-location',
            chatButton: 'a.op-btn-chat',
            chatList: 'ul',
            chatInput: '#chat-input',
            sendButton: '.btn-send',
            toolbarButton: '.toolbar-btn',
            resumeConfirmButton: 'span.btn-sure-v2',
            messageList: '.chat-message .im-list'
        }
    };

    const DEFAULT_PROFILE = {
        targetJobs: '前端开发,Web,AI,Agent',
        targetCities: '',
        greeting:
            '您好，我想应聘贵公司的[目标岗位]。我具备[相关技能/经验]，预计[到岗时间]可以到岗。方便进一步了解岗位要求吗？',
        aiRole:
            '你是求职沟通助手，仅根据求职者明确提供的真实资料回复 HR。回复应自然、礼貌、简洁。未提供或无法确定的学历、技能、工作经历、项目、到岗时间和薪资预期，应说明需要求职者进一步确认，不得自行推测或编造。'
    };

    // Creator identity is separate from editable applicant settings.
    const AUTHOR = Object.freeze({
        name: 'huazhou',
        github: 'https://github.com/huazhounb'
    });

    const state = {
        running: false,
        runToken: 0,
        runPath: '',
        waiters: new Set(),
        seenJobs: new Set(),
        handledJobs: new Set(),
        scannedThisRun: 0,
        newChatsThisRun: 0,
        existingChatsThisRun: 0,
        failedThisRun: 0,
        phase: '等待启动',
        waitUntil: 0,
        currentJob: '',
        runFilters: null,
        filtersOpen: true,
        compact: getSetting('compactMode', 'false') === 'true',
        lastAiMessages: new Map(),
        chatBusy: false,
        chatTimer: null,
        chatProgress: readJSON('chatProgress', {}),
        currentIndex: 0,
        jobList: [],
        minimized: false,
        appliedThisRun: 0,
        skippedThisRun: 0,
        lastBreakAt: 0,
        lastCardCount: 0,
        idleScanRounds: 0,
        currentTopHRKey: '',
        chatObserver: null,
        autoScrollTimer: null,
        processedHRs: new Set(readJSON('processedHRs', [])),
        aiReplyCount: Number(readJSON('aiReplyCount', 0)) || 0,
        lastAiDate: localStorage.getItem(storeKey('lastAiDate')) || '',
        logItems: []
    };

    const refs = {
        host: null,
        root: null,
        panel: null,
        settings: null,
        mini: null,
        status: null,
        startButton: null,
        log: null,
        inputs: {}
    };

    function readJSON(key, fallback) {
        try {
            const raw = localStorage.getItem(storeKey(key));
            return raw ? JSON.parse(raw) : fallback;
        } catch (_) {
            return fallback;
        }
    }

    function writeJSON(key, value) {
        localStorage.setItem(storeKey(key), JSON.stringify(value));
    }

    function getSetting(key, fallback = '') {
        const value = localStorage.getItem(storeKey(key));
        return value === null ? fallback : value;
    }

    function setSetting(key, value) {
        localStorage.setItem(storeKey(key), String(value ?? ''));
    }

    function getNumberSetting(key, fallback) {
        const value = Number(getSetting(key, fallback));
        return Number.isFinite(value) && value >= 0 ? value : fallback;
    }

    // Existing credentials never implicitly enable automatic replies.
    function isAiEnabled() {
        return getSetting('aiEnabled', 'false') === 'true';
    }

    function todayKey() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    function resetDailyCountersIfNeeded() {
        const today = todayKey();
        if (state.lastAiDate !== today) {
            state.lastAiDate = today;
            state.aiReplyCount = 0;
            writeJSON('aiReplyCount', 0);
            setSetting('lastAiDate', today);
        }
    }

    function normalizeList(value) {
        return String(value || '')
            .split(/[,，;；\n]/)
            .map(item => item.trim().toLowerCase())
            .filter(Boolean);
    }

    function randomBetween(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function isJobListPage() {
        return location.pathname.includes('/jobs');
    }

    function isChatPage() {
        return location.pathname.includes('/chat');
    }

    function formatSeconds(ms) {
        return `${Math.max(1, Math.round(ms / 1000))} 秒`;
    }

    function escapeHTML(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[char]));
    }

    function isRunCurrent(token = state.runToken) {
        return state.running && token === state.runToken && location.pathname === state.runPath;
    }

    function setPhase(phase, waitMs = 0) {
        state.phase = phase;
        state.waitUntil = waitMs > 0 ? Date.now() + waitMs : 0;
        UI.syncProgress();
    }

    const Filters = {
        read() {
            const value = (key, fallback = '') => refs.inputs[key]?.value ?? getSetting(key, fallback);
            return {
                jobs: normalizeList(value('targetJobs', DEFAULT_PROFILE.targetJobs)),
                cities: normalizeList(value('targetCities', DEFAULT_PROFILE.targetCities)),
                excludes: normalizeList(value('excludeWords')),
                experience: value('experienceMode', 'any'), education: value('educationMode', 'any')
            };
        },
        inspect(card, filters = this.read()) {
            const title = card.querySelector(CONFIG.SELECTORS.jobName)?.textContent?.trim() || '';
            const city = card.querySelector(CONFIG.SELECTORS.jobLocation)?.textContent?.trim() || '';
            const company = card.querySelector('.company-name, .boss-name, .company-title')?.textContent?.trim() || '';
            const text = (card.textContent || '').replace(/\s+/g, ' ').trim();
            const lower = text.toLowerCase();
            const reasons = [];
            if (filters.jobs.length && !filters.jobs.some(word => title.toLowerCase().includes(word))) reasons.push('岗位关键词不符');
            if (filters.cities.length && !filters.cities.some(word => city.toLowerCase().includes(word))) reasons.push('城市不符');
            const excluded = filters.excludes.find(word => lower.includes(word));
            if (excluded) reasons.push(`排除词：${excluded}`);
            if (filters.experience === 'intern' && !/实习|在校/.test(text)) reasons.push('未见实习/在校标签');
            if (filters.experience === 'entry' && !/实习|在校|应届|经验不限|无需经验|无经验/.test(text)) reasons.push('未见应届/经验不限标签');
            if (filters.education !== 'any' && !text.includes(filters.education)) reasons.push(`未见${filters.education}标签`);
            const link = card.querySelector('a[href*="job_detail"]')?.getAttribute('href')?.split('?')[0];
            const identity = card.dataset.jobId || card.dataset.encryptJobId || link;
            const salary = card.querySelector('.salary')?.textContent?.trim() || '';
            const tags = card.querySelector('.tag-list, .tags, .job-info')?.textContent?.trim() || '';
            const key = identity ? `job:${identity}` : `text:${title}|${city}|${company}|${salary}|${tags}`;
            return { card, title, city, company, key, reasons, matched: !reasons.length };
        },
        scan(filters = this.read()) {
            const unique = new Map();
            document.querySelectorAll(CONFIG.SELECTORS.jobCard).forEach(card => {
                const item = this.inspect(card, filters);
                if (!unique.has(item.key)) unique.set(item.key, item);
            });
            return [...unique.values()];
        }
    };

    // ===================== UI（v2.1.1 新界面） =====================

    const UI_CSS = `
:host { all: initial; --blue: #4568e8; --ink: #242936; --muted: #727e95; --line: #e1e6ef; --soft: #f3f5f9;
    font: 13px/1.55 "Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif; color: var(--ink); }
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
button, input, textarea { font: inherit; }
button, a, summary, input { -webkit-tap-highlight-color: transparent; }
button { cursor: pointer; }
button, a, input, textarea, summary { outline-offset: 3px; }
:focus-visible { outline: 2px solid var(--blue); }
svg { display: block; width: 20px; height: 20px; flex: 0 0 auto; pointer-events: none; }
a { color: var(--blue); text-decoration: none; }
a:hover { text-decoration: underline; }
.panel { position: fixed; top: 28px; right: 24px; width: 408px; max-width: calc(100vw - 32px);
    max-height: calc(100vh - 48px); max-height: calc(100dvh - 48px); display: flex; flex-direction: column;
    overflow: hidden; background: #fdfdfe; color: var(--ink); border: 1px solid #dce2ed; border-radius: 14px;
    box-shadow: 0 16px 48px #28395722, 0 2px 6px #28395708; z-index: 2147483645; }
.panel.hidden { display: none; }
.topbar { display: flex; align-items: center; gap: 10px; padding: 20px 20px 14px; cursor: move; user-select: none; }
.brand-icon { display: grid; place-items: center; width: 38px; height: 38px; flex: 0 0 auto; border-radius: 10px; background: #edf1ff; color: var(--blue); }
.brand-icon svg { width: 25px; height: 25px; }
.brand { min-width: 0; flex: 1; }
.title { margin: 0; font-size: 17px; font-weight: 750; letter-spacing: -.4px; }
.subtitle { color: var(--muted); font-size: 10px; margin-top: 2px; }
.actions { display: flex; gap: 2px; }
.icon-btn { display: grid; place-items: center; width: 30px; height: 32px; border: 0; border-radius: 7px; color: #525f75; background: transparent; }
.icon-btn:hover { color: var(--blue); background: #edf1ff; }
.body { min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 0 20px 12px; display: flex; flex-direction: column; gap: 18px; }
.status-row { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px 12px; background: var(--soft); border-radius: 8px; padding: 12px; font-size: 12px; }
.status-text { display: inline-flex; align-items: center; gap: 7px; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; background: #a1a8b4; }
.status-dot.on { background: var(--blue); }
.metric { white-space: nowrap; color: #5e6980; }
.metric strong { color: var(--blue); font-size: 17px; margin-left: 5px; }
.ai-metric { flex-basis: 100%; padding-top: 6px; border-top: 1px solid var(--line); }
.field { display: flex; flex-direction: column; gap: 7px; min-width: 0; font-size: 12px; font-weight: 600; }
.field > span { overflow-wrap: anywhere; }
input:not([type=checkbox]), textarea { display: block; width: 100%; min-width: 0; border: 1px solid #d4dce9; border-radius: 7px;
    background: #fff; color: var(--ink); padding: 10px 12px; font-size: 13px; font-weight: 400; transition: border-color 140ms, box-shadow 140ms; }
input:not([type=checkbox]):focus, textarea:focus { outline: none; border-color: var(--blue); box-shadow: 0 0 0 3px #4568e812; }
textarea { resize: vertical; min-height: 142px; max-height: 320px; line-height: 1.8; overflow-wrap: anywhere; }
.primary, .secondary { min-height: 42px; border-radius: 8px; font-size: 13px; font-weight: 600; padding: 10px 18px; transition: background 140ms, transform 140ms; }
.primary { border: 1px solid var(--blue); background: var(--blue); color: white; }
.primary:hover { background: #3658d6; }
.primary:active, .secondary:active { transform: translateY(1px); }
.primary.stop { background: #b84956; border-color: #b84956; }
.secondary { border: 1px solid #d4dce9; background: white; color: #45516a; }
.secondary:hover { border-color: var(--blue); color: var(--blue); background: #f7f9ff; }
.start { width: 100%; min-height: 48px; font-size: 15px; }
.command { display: grid; gap: 8px; }
.text-button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; border: 0; padding: 3px 0; background: transparent; color: #707c93; font-size: 12px; }
.text-button:hover { color: var(--blue); }
.text-button svg { width: 15px; height: 15px; }
.clear-records { justify-self: end; }
.console { border-top: 1px solid var(--line); padding-top: 14px; }
.console-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 9px; }
.console-head h3 { font-size: 13px; margin: 0; }
.console-head .text-button { color: var(--blue); }
.log { height: 150px; padding: 12px; background: var(--soft); border-radius: 8px; overflow-y: auto; overflow-x: hidden; color: #677289; font: 11px/1.9 Consolas, "Microsoft YaHei", monospace; user-select: text; }
.log-line { white-space: pre-wrap; overflow-wrap: anywhere; }
.log-line.warn { color: #93612f; } .log-line.error { color: #b84956; } .log-line.success { color: #4568c4; }
.creator { flex-shrink: 0; color: #7b879d; font-size: 10px; text-align: center; padding: 9px 12px 14px; overflow-wrap: anywhere; }
.creator a { margin-left: 6px; }
.settings { position: fixed; inset: 0; z-index: 2147483647; display: flex; align-items: center; justify-content: center;
    padding: 16px; background: #25324d35; color: var(--ink); }
.settings-card { display: flex; flex-direction: column; width: 640px; max-width: 100%; max-height: calc(100vh - 32px); max-height: calc(100dvh - 32px);
    min-height: 0; overflow: hidden; border: 1px solid #dce2ed; border-radius: 14px; background: #fdfdfe; box-shadow: 0 24px 80px #28395730; }
.settings:not([hidden]) .settings-card { animation: dialog-in 150ms ease-out; }
.settings-head { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--line); padding: 18px 22px; }
.settings-title { margin: 0; font-size: 20px; letter-spacing: -.4px; }
.settings-body { min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 18px 22px; overscroll-behavior: contain; }
details { min-width: 0; border: 1px solid var(--line); border-radius: 9px; overflow: hidden; }
details + details { margin-top: 12px; }
summary { min-width: 0; cursor: pointer; display: flex; align-items: center; flex-wrap: wrap; gap: 9px; padding: 15px; background: #f4f6fa; list-style: none; }
summary::-webkit-details-marker { display: none; }
summary > svg { width: 17px; height: 17px; transition: transform 150ms; }
details[open] > summary > svg { transform: rotate(90deg); }
summary strong { font-size: 13px; }
.summary-hint { font-size: 11px; font-weight: 400; color: var(--muted); overflow-wrap: anywhere; }
.section-content { padding: 16px; display: grid; gap: 14px; min-width: 0; border-top: 1px solid var(--line); }
.grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; min-width: 0; }
.help { margin: 0; font-size: 11px; color: var(--muted); line-height: 1.6; overflow-wrap: anywhere; }
.switch-label { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 12px; font-weight: 600; }
.switch { appearance: none; -webkit-appearance: none; flex: 0 0 auto; width: 35px; height: 21px; border: 0; border-radius: 20px; background: #abb1be; cursor: pointer; position: relative; transition: background 150ms; }
.switch::after { content: ''; position: absolute; width: 15px; height: 15px; top: 3px; left: 3px; background: white; border-radius: 50%; transition: transform 150ms; }
.switch:checked { background: var(--blue); }
.switch:checked::after { transform: translateX(14px); }
.ai-fields { display: grid; gap: 14px; min-width: 0; }
.settings-footer { flex-shrink: 0; border-top: 1px solid var(--line); padding: 14px 22px 0; }
.footer-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 10px; }
.settings-footer .creator { padding-top: 11px; line-height: 1.7; }
.settings-footer .creator > span { display: block; }
.mini { display: none; position: fixed; right: 20px; bottom: 24px; z-index: 2147483645; width: 48px; height: 48px;
    border: 1px solid #dce2ed; border-radius: 13px; background: #fdfdfe; color: var(--blue); box-shadow: 0 6px 24px #28395722; }
.mini svg { margin: auto; width: 25px; height: 25px; }
.body, .settings-body, .log, textarea { scrollbar-width: thin; scrollbar-color: #d8dde8 transparent; }
.body:hover, .settings-body:hover, .log:hover, textarea:hover { scrollbar-color: #aeb8cc transparent; }
::-webkit-scrollbar { width: 4px; height: 0; } ::-webkit-scrollbar-thumb { background: #d8dde8; border-radius: 8px; }
::-webkit-scrollbar-thumb:hover { background: #aeb8cc; }
@keyframes dialog-in { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
@media (max-width: 520px) {
    .panel { top: 16px; right: 16px; max-height: calc(100dvh - 32px); }
    .topbar { padding: 16px 14px 12px; gap: 7px; } .body { padding-left: 14px; padding-right: 14px; gap: 14px; }
    .title { font-size: 15px; } .subtitle { font-size: 9px; } .brand-icon { width: 32px; height: 32px; }
    .settings-head { padding: 14px 16px; } .settings-title { font-size: 18px; }
    .settings-body { padding: 14px; } .settings-footer { padding: 12px 14px 0; }
    .grid-2 { grid-template-columns: minmax(0, 1fr); } summary { padding: 12px; } .section-content { padding: 12px; }
    .summary-hint { flex-basis: 100%; padding-left: 26px; } .log { height: 120px; }
}
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
.panel.compact { width: 352px; }
.panel.compact .topbar { padding: 16px 14px 12px; gap: 7px; }
.panel.compact .body { padding-left: 14px; padding-right: 14px; gap: 12px; }
.panel.compact .title { font-size: 15px; }
.panel.compact .brand-icon { width: 30px; height: 30px; }
.panel.compact .subtitle { font-size: 9px; }
.progress { border-left: 3px solid var(--blue); background: #f7f9ff; padding: 10px 12px; border-radius: 0 7px 7px 0; min-width: 0; }
.progress-line { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.progress-phase { font-size: 12px; font-weight: 650; overflow-wrap: anywhere; }
.countdown { white-space: nowrap; font: 700 18px/1.4 Consolas, monospace; color: var(--blue); }
.current-job { margin-top: 4px; font-size: 11px; color: var(--muted); overflow-wrap: anywhere; }
.stat-grid { display: grid; grid-template-columns: repeat(5,minmax(0,1fr)); gap: 5px; }
.stat-cell { padding: 7px 2px; border: 1px solid var(--line); border-radius: 7px; text-align: center; min-width: 0; }
.stat-cell span { display: block; font-size: 10px; color: var(--muted); }
.stat-cell strong { font-size: 18px; font-weight: 700; }
.stats-note { margin: 0; font-size: 10px; line-height: 1.6; color: var(--muted); }
.filter-box > summary { padding: 10px 12px; }
.filter-box .section-content { padding: 12px; gap: 12px; }
.filter-box > summary .summary-hint { padding-left: 0; }
.filter-box .grid-2 { gap: 10px; }
select { width: 100%; min-width: 0; padding: 9px 7px; border: 1px solid #d4dce9; border-radius: 7px; background: white; color: var(--ink); font: inherit; }
input:disabled, textarea:disabled, select:disabled { opacity: .65; cursor: not-allowed; }
button:disabled { opacity: .5; cursor: not-allowed; }
.match-preview { border-top: 1px solid var(--line); padding-top: 10px; }
.preview-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 12px; }
.preview-list { max-height: 170px; overflow-y: auto; padding: 0; margin: 8px 0 0; list-style: none; }
.preview-list li { padding: 7px 0; border-top: 1px solid var(--line); overflow-wrap: anywhere; }
.preview-list strong { display: block; font-size: 11px; }
.preview-list small { color: var(--muted); font-size: 10px; }
.preview-list .reject small { color: #93612f; }
.keyword-hint { margin: 0; color: #93612f; font-size: 11px; }
.log-actions { display: flex; gap: 12px; }
.compact-button { width: auto; padding: 0 5px; font-size: 10px; white-space: nowrap; }
.panel.compact .log { height: 125px; }
.body > * { flex-shrink: 0; }
`;

    const ICONS = {
        plane: '<path d="m21 3-7 18-4-7-7-4 18-7Z"/><path d="m10 14 6-6"/>',
        settings: '<path d="m9 3-.5 2-2 1-2-.5-2 3 1.5 1.5v3L2.5 15l2 3 2-.5 2 1L9 21h4l.5-2.5 2-1 2 .5 2-3-1.5-2v-3L20 8.5l-2-3-2 .5-2-1-.5-2H9Z"/><circle cx="11.3" cy="12" r="3"/>',
        minus: '<path d="M5 12h14"/>',
        close: '<path d="m6 6 12 12M6 18 18 6"/>',
        chevron: '<path d="m9 5 7 7-7 7"/>',
        trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>'
    };

    function icon(name) {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
    }

    const UI = {
        init() {
            if (!document.body) {
                window.setTimeout(() => this.init(), 200);
                return;
            }
            if (document.getElementById('hz-boss-helper-root')) return;

            refs.host = document.createElement('div');
            refs.host.id = 'hz-boss-helper-root';
            refs.root = refs.host.attachShadow({ mode: 'open' });
            document.body.appendChild(refs.host);

            refs.root.append(this.createStyle(), this.createPanel(), this.createSettings(), this.createMiniButton());
            refs.root.querySelectorAll('[data-input]').forEach(input => {
                refs.inputs[input.dataset.input] = input;
            });
            this.loadInputs();
            this.bindPanelEvents();
            this.makeDraggable(refs.panel);
            window.setInterval(() => this.syncProgress(), 250);
            this.syncStatus();
            this.log('助手已加载。请确认筛选词、城市和设置后再启动。', 'info');
        },

        createStyle() {
            const style = document.createElement('style');
            style.textContent = UI_CSS;
            return style;
        },

        creatorMarkup(withEmail = false) {
            return `<div class="creator"><span>${withEmail ? '作者' : 'Created by'} ${AUTHOR.name} · <a href="${AUTHOR.github}" target="_blank" rel="noopener noreferrer">GitHub ↗</a></span></div>`;
        },

        createPanel() {
            refs.panel = document.createElement('section');
            refs.panel.className = 'panel';
            refs.panel.setAttribute('aria-label', 'BOSS 岗位投递助手');
            refs.panel.innerHTML = `
                <header class="topbar" data-drag-handle>
                    <span class="brand-icon">${icon('plane')}</span>
                    <div class="brand"><h2 class="title">BOSS 投递助手</h2><div class="subtitle">v${CONFIG.VERSION} · 岗位沟通助手</div></div>
                    <div class="actions">
                        <button class="icon-btn compact-button" type="button" data-action="compact" title="切换面板宽度" aria-label="切换紧凑面板">紧凑</button>
                        <button class="icon-btn" type="button" data-action="settings" title="设置" aria-label="打开设置">${icon('settings')}</button>
                        <button class="icon-btn" type="button" data-action="minimize" title="最小化" aria-label="最小化">${icon('minus')}</button>
                    </div>
                </header>
                <div class="body">
                    <div class="status-row" data-stats aria-live="polite"></div>
                    <div class="progress"><div class="progress-line"><span class="progress-phase" data-phase></span><span class="countdown" data-countdown aria-label="剩余等待时间"></span></div><div class="current-job" data-current-job></div></div>
                    <div class="stat-grid" data-counters aria-label="本轮分类统计"></div>
                    <p class="stats-note">新沟通与旧会话按按钮点击统计，不代表消息已送达。已扫描包含被筛选跳过的岗位。</p>
                    <details class="filter-box" data-filters open><summary>${icon('chevron')}<strong>筛选条件</strong><span class="summary-hint" data-filter-hint>启动后自动收起</span></summary><div class="section-content">
                        <label class="field"><span>岗位关键词</span><input data-input="targetJobs" placeholder="前端, Web, AI 应用, agent" /></label>
                        <p class="keyword-hint" data-keyword-hint hidden>检测到 angent，是否想输入 agent？<button class="text-button" type="button" data-action="fixKeyword">改为 agent</button></p>
                        <label class="field"><span>城市关键词</span><input data-input="targetCities" placeholder="广州, 深圳；留空则不限" /></label>
                        <label class="field"><span>排除词</span><input data-input="excludeWords" placeholder="例如：销售, 培训；留空则不排除" /></label>
                        <div class="grid-2">
                            <label class="field"><span>经验 / 求职类型</span><select data-input="experienceMode"><option value="any">不限</option><option value="intern">实习 / 在校</option><option value="entry">应届 / 经验不限</option></select></label>
                            <label class="field"><span>学历标签</span><select data-input="educationMode"><option value="any">不限</option><option value="大专">包含“大专”</option><option value="本科">包含“本科”</option><option value="硕士">包含“硕士”</option><option value="博士">包含“博士”</option></select></label>
                        </div>
                        <p class="help">逗号、分号或换行分隔；岗位与城市各自任一词匹配。排除词、经验和学历按卡片文本筛选，不读取岗位详情。</p>
                        <button class="secondary" type="button" data-action="preview">预览当前列表匹配</button>
                        <section class="match-preview" data-preview hidden><div class="preview-head"><strong data-preview-count></strong><button class="text-button" type="button" data-action="closePreview">收起预览</button></div><ol class="preview-list" data-preview-list></ol></section>
                    </div></details>
                    <div class="command">
                        <button class="primary start" type="button" data-action="toggle">启动投递</button>
                        <button class="text-button clear-records" type="button" data-action="clearRecords">${icon('trash')}清记录</button>
                    </div>
                    <section class="console"><div class="console-head"><h3>运行日志</h3><div class="log-actions"><button class="text-button" type="button" data-action="copyLog">复制</button><button class="text-button" type="button" data-action="downloadLog">导出</button><button class="text-button" type="button" data-action="clearLog">清空</button></div></div><div class="log" data-log role="log" aria-label="运行日志"></div></section>
                </div>
                ${this.creatorMarkup()}`;
            refs.status = refs.panel.querySelector('[data-stats]');
            refs.startButton = refs.panel.querySelector('[data-action="toggle"]');
            refs.log = refs.panel.querySelector('[data-log]');
            return refs.panel;
        },

        createSettings() {
            refs.settings = document.createElement('div');
            refs.settings.className = 'settings';
            refs.settings.hidden = true;
            refs.settings.innerHTML = `
                <section class="settings-card" role="dialog" aria-modal="true" aria-labelledby="hz-settings-title">
                    <header class="settings-head"><h3 class="settings-title" id="hz-settings-title">助手设置</h3><button class="icon-btn" type="button" data-action="closeSettings" aria-label="关闭设置">${icon('close')}</button></header>
                    <div class="settings-body">
                        <p class="help" data-settings-lock hidden>本轮运行中，设置已锁定；停止后可修改。</p>
                        <details open><summary>${icon('chevron')}<strong>沟通话术</strong></summary><div class="section-content">
                            <label class="field"><span>默认沟通话术（聊天页）</span><textarea data-input="greeting" rows="5"></textarea></label><p class="help">先将模板方括号替换为自己的真实资料。此话术用于聊天页；岗位列表的“立即沟通”使用 BOSS 中设置的默认招呼语。</p>
                        </div></details>
                        <details><summary>${icon('chevron')}<strong>投递参数</strong><span class="summary-hint" data-limit-hint></span></summary><div class="section-content">
                            <div class="grid-2">
                                <label class="field"><span>每轮最多投递</span><input data-input="maxApplyPerRun" type="number" min="1" step="1" required /></label>
                                <label class="field"><span>每批投递数</span><input data-input="batchSize" type="number" min="1" step="1" required /></label>
                                <label class="field"><span>沟通后等待最少（秒）</span><input data-input="applyWaitMin" data-seconds type="number" min="1" step="0.001" required /></label>
                                <label class="field"><span>沟通后等待最多（秒）</span><input data-input="applyWaitMax" data-seconds type="number" min="1" step="0.001" required /></label>
                                <label class="field"><span>批次休息最少（秒）</span><input data-input="breakWaitMin" data-seconds type="number" min="1" step="0.001" required /></label>
                                <label class="field"><span>批次休息最多（秒）</span><input data-input="breakWaitMax" data-seconds type="number" min="1" step="0.001" required /></label>
                            </div>
                        </div></details>
                        <details data-ai-section><summary>${icon('chevron')}<strong>AI 自动回复</strong><span class="summary-hint" data-ai-hint>默认关闭，开启后配置接口</span></summary><div class="section-content">
                            <label class="switch-label">启用 AI 自动回复<input class="switch" type="checkbox" role="switch" data-input="aiEnabled" aria-label="启用 AI 自动回复" aria-controls="hz-ai-fields" /></label>
                            <div class="ai-fields" id="hz-ai-fields" data-ai-fields hidden>
                                <label class="field"><span>接口地址（Endpoint）</span><input data-input="apiEndpoint" type="url" placeholder="https://example.com/v1/chat/completions" /></label>
                                <div class="grid-2"><label class="field"><span>模型（Model）</span><input data-input="aiModel" /></label><label class="field"><span>每日回复上限</span><input data-input="dailyAiLimit" type="number" min="0" step="1" required /></label></div>
                                <label class="field"><span>API Key</span><input data-input="aiKey" type="password" autocomplete="off" placeholder="仅保存在当前浏览器" /></label>
                                <label class="field"><span>AI 回复人设</span><textarea data-input="aiRole" rows="4"></textarea></label>
                            </div>
                        </div></details>
                    </div>
                    <footer class="settings-footer"><div class="footer-actions"><button class="secondary" type="button" data-action="closeSettings">返回面板</button><button class="primary" type="button" data-action="saveSettings">保存设置</button></div>${this.creatorMarkup(true)}</footer>
                </section>`;
            return refs.settings;
        },

        createMiniButton() {
            refs.mini = document.createElement('button');
            refs.mini.className = 'mini';
            refs.mini.type = 'button';
            refs.mini.innerHTML = icon('plane');
            refs.mini.title = '打开 BOSS 投递助手';
            refs.mini.setAttribute('aria-label', refs.mini.title);
            refs.mini.addEventListener('click', () => this.restore());
            return refs.mini;
        },

        bindPanelEvents() {
            refs.root.addEventListener('click', event => {
                const action = event.target.closest?.('[data-action]')?.dataset.action;
                const actions = {
                    toggle: () => toggleProcess(),
                    settings: () => this.openSettings(),
                    closeSettings: () => this.closeSettings(),
                    saveSettings: () => this.saveSettings(),
                    minimize: () => this.minimize(),
                    clearLog: () => this.clearLog(),
                    compact: () => this.toggleCompact(),
                    preview: () => this.previewMatches(),
                    closePreview: () => { refs.panel.querySelector('[data-preview]').hidden = true; },
                    fixKeyword: () => this.fixKeyword(),
                    copyLog: () => this.copyLog(),
                    downloadLog: () => this.downloadLog(),
                    clearRecords: () => this.clearProcessedHRs()
                };
                actions[action]?.();
                if (event.target === refs.settings) this.closeSettings();
            });
            refs.inputs.aiEnabled.addEventListener('change', () => this.syncAiFields());
            refs.inputs.targetJobs.addEventListener('input', () => this.syncKeywordHint());
            refs.settings.addEventListener('keydown', event => {
                if (event.key === 'Escape') { event.preventDefault(); this.closeSettings(); }
                if (event.key !== 'Tab') return;
                const focusable = Array.from(refs.settings.querySelectorAll('button, input, textarea, a, summary')).filter(el => !el.disabled && el.getClientRects().length);
                const first = focusable[0];
                const last = focusable.at(-1);
                if (event.shiftKey && refs.root.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && refs.root.activeElement === last) { event.preventDefault(); first?.focus(); }
            });
        },

        loadInputs(includeFilters = true) {
            const defaults = {
                ...DEFAULT_PROFILE,
                ...CONFIG.DEFAULT_LIMITS,
                aiModel: 'gpt-4o-mini',
                aiEnabled: String(isAiEnabled()), excludeWords: '', experienceMode: 'any', educationMode: 'any'
            };
            Object.entries(refs.inputs).forEach(([key, input]) => {
                if (!includeFilters && ['targetJobs', 'targetCities', 'excludeWords', 'experienceMode', 'educationMode'].includes(key)) return;
                const value = getSetting(key, defaults[key] ?? '');
                if (input.type === 'checkbox') input.checked = value === 'true';
                else input.value = input.hasAttribute('data-seconds') ? Number(value) / 1000 : value;
            });
            this.syncAiFields();
            this.syncKeywordHint();
        },

        syncAiFields() {
            const enabled = refs.inputs.aiEnabled.checked;
            refs.settings.querySelector('[data-ai-fields]').hidden = !enabled;
            refs.settings.querySelectorAll('[data-ai-fields] input, [data-ai-fields] textarea').forEach(input => { input.disabled = !enabled || state.running; });
            refs.settings.querySelector('[data-ai-hint]').textContent = enabled ? '已开启 · 保存后生效' : '默认关闭，开启后配置接口';
        },

        saveSettings() {
            if (state.running) { this.log('请先停止，再修改设置。', 'warn'); return false; }
            for (const input of Object.values(refs.inputs)) {
                if (!input.disabled && !input.checkValidity()) {
                    if (refs.settings.contains(input)) {
                        refs.settings.hidden = false;
                        const details = input.closest('details');
                        if (details) details.open = true;
                    }
                    input.reportValidity();
                    return false;
                }
            }
            for (const [minKey, maxKey] of [['applyWaitMin', 'applyWaitMax'], ['breakWaitMin', 'breakWaitMax']]) {
                if (Number(refs.inputs[minKey].value) > Number(refs.inputs[maxKey].value)) {
                    refs.settings.hidden = false;
                    refs.inputs[minKey].closest('details').open = true;
                    this.log('最少等待时间不能大于最多等待时间。', 'warn');
                    refs.inputs[minKey].focus();
                    return false;
                }
            }
            Object.entries(refs.inputs).forEach(([key, input]) => {
                if (input.disabled) return;
                const value = input.type === 'checkbox' ? String(input.checked)
                    : input.hasAttribute('data-seconds') ? String(Math.round(Number(input.value) * 1000))
                    : input.value.trim();
                setSetting(key, value);
            });
            this.closeSettings();
            this.log('设置已保存。下次启动会使用新的筛选词、话术和限速。', 'success');
            this.syncStatus();
            return true;
        },

        openSettings() {
            this.loadInputs(false);
            refs.settings.hidden = false;
            this.syncStatus();
            refs.settings.querySelector('[data-action="closeSettings"]').focus();
        },

        closeSettings() {
            if (refs.settings.hidden) return;
            refs.settings.hidden = true;
            this.loadInputs(false);
            refs.panel.querySelector('[data-action="settings"]').focus();
        },

        minimize() {
            state.minimized = true;
            this.closeSettings();
            refs.panel.classList.add('hidden');
            refs.mini.style.display = 'block';
            refs.mini.focus();
        },

        restore() {
            state.minimized = false;
            refs.panel.classList.remove('hidden');
            refs.mini.style.display = 'none';
            refs.panel.querySelector('[data-action="settings"]').focus();
        },

        syncStatus() {
            if (!refs.status) return;
            const aiLimit = getNumberSetting('dailyAiLimit', CONFIG.DEFAULT_LIMITS.dailyAiLimit);
            refs.status.innerHTML = `<span class="status-text"><i class="status-dot ${state.running ? 'on' : ''}"></i>${state.running ? '运行中' : '已停止'}</span><span class="metric">本轮点击<strong>${state.appliedThisRun}</strong></span>${isAiEnabled() ? `<span class="metric ai-metric">AI 回复<strong>${state.aiReplyCount}/${aiLimit}</strong></span>` : ''}`;
            const counters = [['已扫描', state.scannedThisRun], ['新沟通', state.newChatsThisRun], ['旧会话', state.existingChatsThisRun], ['跳过', state.skippedThisRun], ['失败', state.failedThisRun]];
            refs.panel.querySelector('[data-counters]').innerHTML = counters.map(([label, value]) => `<div class="stat-cell"><span>${label}</span><strong>${value}</strong></div>`).join('');
            refs.panel.classList.toggle('compact', state.compact);
            const compactButton = refs.panel.querySelector('[data-action=compact]');
            compactButton.textContent = state.compact ? '展开' : '紧凑';
            compactButton.setAttribute('aria-pressed', String(state.compact));
            refs.root.querySelectorAll('[data-input]').forEach(input => { input.disabled = state.running; });
            this.syncAiFields();
            refs.settings.querySelector('[data-action=saveSettings]').disabled = state.running;
            refs.settings.querySelector('[data-settings-lock]').hidden = !state.running;
            refs.panel.querySelector('[data-action=clearRecords]').disabled = state.running;
            refs.panel.querySelector('[data-action=fixKeyword]').disabled = state.running;
            refs.panel.querySelector('[data-filter-hint]').textContent = state.running ? '本轮已锁定 · 可展开查看' : '启动后自动收起';
            this.syncProgress();
            if (refs.startButton) {
                refs.startButton.textContent = state.running ? '立即停止' : '启动投递';
                refs.startButton.classList.toggle('stop', state.running);
            }
            const hint = refs.settings?.querySelector('[data-limit-hint]');
            if (hint) {
                hint.textContent = `每轮 ${getNumberSetting('maxApplyPerRun', CONFIG.DEFAULT_LIMITS.maxApplyPerRun)} 次 · 每批 ${getNumberSetting('batchSize', CONFIG.DEFAULT_LIMITS.batchSize)} 次`;
            }
        },

        syncProgress() {
            if (!refs.panel) return;
            refs.panel.querySelector('[data-phase]').textContent = state.phase;
            refs.panel.querySelector('[data-countdown]').textContent = state.running && state.waitUntil > Date.now() ? `${Math.ceil((state.waitUntil - Date.now()) / 1000)}s` : '';
            refs.panel.querySelector('[data-current-job]').textContent = state.currentJob
                ? `${state.currentJob}${state.running && isJobListPage() && state.currentIndex ? ` · ${state.currentIndex}/${state.jobList.length}` : ''}`
                : '当前未选择岗位';
        },

        toggleCompact() {
            state.compact = !state.compact;
            setSetting('compactMode', state.compact);
            this.syncStatus();
            window.dispatchEvent(new Event('resize'));
        },

        syncKeywordHint() {
            refs.panel.querySelector('[data-keyword-hint]').hidden = !normalizeList(refs.inputs.targetJobs?.value).includes('angent');
        },

        fixKeyword() {
            if (state.running) return;
            refs.inputs.targetJobs.value = refs.inputs.targetJobs.value.replace(/(^|[,，;；\n]\s*)angent(?=\s*(?:[,，;；\n]|$))/gi, '$1agent');
            this.syncKeywordHint();
            this.log('已将独立关键词 angent 改为 agent；保存或启动后生效。');
        },

        previewMatches() {
            const items = Filters.scan(state.running ? state.runFilters : Filters.read());
            const matched = items.filter(item => item.matched).length;
            refs.panel.querySelector('[data-preview]').hidden = false;
            refs.panel.querySelector('[data-preview-count]').textContent = `已加载 ${items.length} · 匹配 ${matched} · 排除 ${items.length - matched}`;
            refs.panel.querySelector('[data-preview-list]').innerHTML = items.length ? items.map(item => `<li class="${item.matched ? 'match' : 'reject'}"><strong>${escapeHTML(item.title || '未知岗位')}</strong><small>${escapeHTML([item.company, item.city, item.matched ? '匹配' : item.reasons.join('；')].filter(Boolean).join(' · '))}</small></li>`).join('') : '<li><small>未找到岗位卡片，请进入岗位列表或等待列表加载后重试。</small></li>';
        },

        logText() {
            return state.logItems.map(item => `[${item.time}] [${item.type}] ${item.message}`).join('\n');
        },

        async copyLog() {
            try {
                if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
                await navigator.clipboard.writeText(this.logText());
                this.log('日志已复制。', 'success');
            } catch (_) {
                this.log('复制不可用，已改为导出日志文件。', 'warn');
                this.downloadLog();
            }
        },

        downloadLog() {
            const url = URL.createObjectURL(new Blob([this.logText()], { type: 'text/plain;charset=utf-8' }));
            const link = document.createElement('a');
            link.href = url; link.download = `boss-helper-${todayKey()}.txt`;
            refs.root.append(link); link.click(); link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        },

        log(message, type = 'info') {
            const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
            state.logItems.push({ time, message, type });
            state.logItems = state.logItems.slice(-120);
            if (!refs.log) return;
            refs.log.innerHTML = state.logItems
                .map(item => `<div class="log-line ${item.type}">[${item.time}] ${escapeHTML(item.message)}</div>`)
                .join('');
            refs.log.scrollTop = refs.log.scrollHeight;
        },

        clearLog() {
            state.logItems = [];
            refs.log.innerHTML = '';
            this.log('日志已清空。', 'success');
        },

        clearProcessedHRs() {
            if (state.running) return;
            state.processedHRs = new Set();
            state.chatProgress = {};
            writeJSON('chatProgress', {});
            writeJSON('processedHRs', []);
            this.log('已清空本机 HR 处理记录。', 'success');
        },

        makeDraggable(panel) {
            const handle = panel.querySelector('[data-drag-handle]');
            let origin = null;
            const clamp = () => {
                if (!panel.style.left || state.minimized) return;
                panel.style.left = `${Math.max(8, Math.min(window.innerWidth - panel.offsetWidth - 8, parseFloat(panel.style.left)))}px`;
                panel.style.top = `${Math.max(8, Math.min(window.innerHeight - panel.offsetHeight - 8, parseFloat(panel.style.top)))}px`;
            };
            handle.addEventListener('pointerdown', event => {
                if (event.button !== 0 || event.target.closest('button')) return;
                const rect = panel.getBoundingClientRect();
                origin = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
                handle.setPointerCapture(event.pointerId);
                event.preventDefault();
            });
            handle.addEventListener('pointermove', event => {
                if (!origin) return;
                panel.style.right = 'auto';
                panel.style.left = `${origin.left + event.clientX - origin.x}px`;
                panel.style.top = `${origin.top + event.clientY - origin.y}px`;
                clamp();
            });
            const endDrag = () => { origin = null; };
            handle.addEventListener('pointerup', endDrag);
            handle.addEventListener('pointercancel', endDrag);
            handle.style.touchAction = 'none';
            window.addEventListener('resize', clamp);
        }
    };

    // Keep the supplied list/chat workflow; add observable, cancellable steps.

    const Core = {
        async start(token = state.runToken) {
            if (!isRunCurrent(token)) return;
            resetDailyCountersIfNeeded();
            if (isJobListPage()) {
                UI.log('当前在岗位列表页，开始筛选并自动沟通。');
                await this.processJobLoop(token);
                return;
            }
            if (isChatPage()) {
                UI.log('当前在聊天页，开始监听最新 HR 消息并自动处理。');
                setPhase('等待聊天列表');
                await this.handleChatPage(token);
                return;
            }
            UI.log('请进入 BOSS 岗位列表页或聊天页后再启动。', 'warn');
            stopProcess();
        },

        async processJobLoop(token = state.runToken) {
            while (isRunCurrent(token) && isJobListPage()) {
                try {
                    const maxApplyPerRun = getNumberSetting('maxApplyPerRun', CONFIG.DEFAULT_LIMITS.maxApplyPerRun);
                    if (state.appliedThisRun >= maxApplyPerRun) {
                        UI.log(`本轮已达到最多 ${maxApplyPerRun} 次投递，已自动停止。`, 'success');
                        stopProcess();
                        return;
                    }

                    await this.processJobList(token);
                    if (!isRunCurrent(token)) return;
                    await this.delay(350);
                } catch (error) {
                    if (!isRunCurrent(token)) return;
                    state.failedThisRun += 1;
                    UI.log(`${state.currentJob || '当前岗位'} → 处理失败：${error.message}`, 'error');
                    await this.delay(900);
                } finally {
                    UI.syncStatus();
                }
            }
        },

        async processJobList(token = state.runToken) {
            if (!isRunCurrent(token)) return;
            const items = Filters.scan(state.runFilters);
            for (const item of items) {
                if (state.seenJobs.has(item.key)) continue;
                state.seenJobs.add(item.key);
                state.scannedThisRun++;
                if (!item.matched) {
                    state.skippedThisRun++;
                    UI.log(`${[item.company, item.title].filter(Boolean).join(' · ')} → 跳过：${item.reasons.join('；')}`, 'info');
                }
            }
            const matched = items.filter(item => item.matched);
            state.jobList = matched.map(item => item.card);
            const item = matched.find(item => !state.handledJobs.has(item.key));
            UI.syncStatus();
            if (!item) {
                setPhase(matched.length ? '等待加载更多岗位' : '暂无匹配，加载更多岗位');
                await this.keepJobListLoading(token);
                return;
            }

            const batchSize = getNumberSetting('batchSize', CONFIG.DEFAULT_LIMITS.batchSize);
            if (state.appliedThisRun > 0 && state.appliedThisRun % batchSize === 0 && state.lastBreakAt !== state.appliedThisRun) {
                state.lastBreakAt = state.appliedThisRun;
                await this.humanDelay(
                    getNumberSetting('breakWaitMin', CONFIG.DEFAULT_LIMITS.breakWaitMin),
                    getNumberSetting('breakWaitMax', CONFIG.DEFAULT_LIMITS.breakWaitMax),
                    `批次休息（已处理 ${state.appliedThisRun} 次点击）`
                );
                return;
            }

            const currentCard = item.card;
            state.handledJobs.add(item.key);
            state.currentIndex = matched.findIndex(row => row.key === item.key) + 1;
            state.currentJob = [item.company, item.title].filter(Boolean).join(' · ') || '未知岗位';
            setPhase(`选择岗位 ${state.currentIndex}/${matched.length}`);
            currentCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await this.humanDelay(900, 1800, '等待选择岗位');
            if (!isRunCurrent(token)) return;
            if (!await this.simulateClick(currentCard, token)) return;

            UI.log(`${state.currentJob} → 正在处理 ${state.currentIndex}/${matched.length}`);
            await this.humanDelay(
                getNumberSetting('detailWaitMin', CONFIG.DEFAULT_LIMITS.detailWaitMin),
                getNumberSetting('detailWaitMax', CONFIG.DEFAULT_LIMITS.detailWaitMax), '等待岗位详情'
            );

            if (!isRunCurrent(token)) return;
            const chatBtn = this.findVisible(CONFIG.SELECTORS.chatButton);
            if (!chatBtn) {
                state.failedThisRun += 1;
                UI.log(`${state.currentJob} → 未找到可见的沟通按钮。`, 'error');
                return;
            }

            const btnText = chatBtn.textContent.trim();
            if (!['立即沟通', '继续沟通'].some(text => btnText.includes(text))) {
                state.skippedThisRun += 1;
                UI.log(`${state.currentJob} → 按钮为“${btnText || '未知'}”，跳过。`, 'warn');
                return;
            }

            setPhase(btnText.includes('立即沟通') ? '点击立即沟通' : '打开已有会话');
            if (!await this.simulateClick(chatBtn, token)) return;
            if (token !== state.runToken || !state.running) return;
            state.appliedThisRun += 1;
            if (btnText.includes('立即沟通')) state.newChatsThisRun++;
            else state.existingChatsThisRun++;
            UI.log(`${state.currentJob} → 已点击${btnText}（未确认送达）`, 'success');
            UI.syncStatus();
            if (!isRunCurrent(token)) return;
            await this.handleGreetingModal(token);
            if (!isRunCurrent(token)) return;

            await this.humanDelay(
                getNumberSetting('applyWaitMin', CONFIG.DEFAULT_LIMITS.applyWaitMin),
                getNumberSetting('applyWaitMax', CONFIG.DEFAULT_LIMITS.applyWaitMax),
                '本次沟通后等待'
            );
        },

        findVisible(selector) {
            return Array.from(document.querySelectorAll(selector)).find(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.disabled);
        },

        async keepJobListLoading(token = state.runToken) {
            const beforeCount = document.querySelectorAll(CONFIG.SELECTORS.jobCard).length;
            window.scrollBy({ top: Math.round(window.innerHeight * 0.75), behavior: 'smooth' });
            await this.humanDelay(1200, 2600, '等待列表加载');
            if (!isRunCurrent(token)) return;
            const afterCount = document.querySelectorAll(CONFIG.SELECTORS.jobCard).length;

            if (afterCount > beforeCount || afterCount > state.lastCardCount) {
                state.lastCardCount = afterCount;
                state.idleScanRounds = 0;
                UI.log(`已加载岗位卡片 ${afterCount} 个，继续扫描。`);
                return;
            }

            state.idleScanRounds += 1;
            if (state.idleScanRounds % 4 === 0) {
                UI.log(`暂时没有新岗位，当前卡片 ${afterCount} 个。`, 'warn');
            }
        },

        async handleGreetingModal(token = state.runToken) {
            setPhase('检查沟通弹窗', 3000);
            const stayBtn = await this.waitForElement(() => Array.from(document.querySelectorAll('.default-btn.cancel-btn, [role="dialog"] button, .dialog-container button'))
                .find(button => button.getClientRects().length && button.textContent.trim().includes('留在此页')), 3000);
            if (!isRunCurrent(token)) return;
            if (stayBtn && await this.simulateClick(stayBtn, token)) UI.log(`${state.currentJob} → 已选择留在此页。`);
            state.waitUntil = 0;
        },

        async handleChatPage(token = state.runToken) {
            if (!isRunCurrent(token)) return;
            if (state.chatObserver) {
                await this.clickLatestChat(token);
                return;
            }

            const chatList = await this.waitForElement(() => this.getLatestChatItem()?.closest('ul, [role="list"]'), 5000);
            if (!isRunCurrent(token)) return;
            if (!chatList) {
                UI.log('没有找到聊天列表。', 'warn');
                return;
            }

            state.chatObserver = new MutationObserver(async () => {
                if (isRunCurrent(token)) await this.clickLatestChat(token);
            });
            state.chatObserver.observe(chatList, { childList: true, subtree: true });
            clearInterval(state.chatTimer);
            state.chatTimer = setInterval(() => this.clickLatestChat(token), 2000);
            await this.clickLatestChat(token);
        },

        getLatestChatItem() {
            return Array.from(document.querySelectorAll('li[role="listitem"][class]')).find(item => item.querySelector('.name-text'));
        },

        chatKey(item) {
            const name = item?.querySelector('.name-text')?.textContent?.trim().replace(/\s+/g, ' ') || '';
            const company = item?.querySelector('.name-box span:nth-child(2)')?.textContent?.trim().replace(/\s+/g, ' ') || '';
            return `${name}-${company}`.toLowerCase();
        },

        chatCurrent(key, token) {
            const selected = Array.from(document.querySelectorAll('li[role="listitem"].selected, li[role="listitem"].active')).find(item => item.querySelector('.name-text'));
            return isRunCurrent(token) && this.chatKey(selected || this.getLatestChatItem()) === key;
        },

        async clickLatestChat(token = state.runToken) {
            if (!isRunCurrent(token) || state.chatBusy) return;
            state.chatBusy = true;
            try {
                const latestLi = await this.waitForElement(() => this.getLatestChatItem(), 5000);
                if (!latestLi || !isRunCurrent(token)) return;

                const name = (latestLi.querySelector('.name-text')?.textContent || '未知 HR').trim().replace(/\s+/g, ' ');
                const company = (latestLi.querySelector('.name-box span:nth-child(2)')?.textContent || '').trim().replace(/\s+/g, ' ');
                const hrKey = `${name}-${company}`.toLowerCase();

                const progress = state.chatProgress[hrKey] || {};
                if (state.currentTopHRKey === hrKey && (!isAiEnabled() && state.processedHRs.has(hrKey) || progress.greetingPending || progress.resumeRetryAt > Date.now())) return;
                state.currentTopHRKey = hrKey;

                if (!await this.simulateClick(latestLi.querySelector('.figure') || latestLi, token)) return;
                if (!this.chatCurrent(hrKey, token)) return;
                latestLi.classList.add('hz-last-clicked');
                state.currentJob = `${name}${company ? ` · ${company}` : ''}`;

                if (state.processedHRs.has(hrKey)) {
                    await this.aiReply(hrKey, token);
                    return;
                }

                UI.log(`开始沟通：${name}${company ? ` - ${company}` : ''}`);
                const sent = await this.processChatContent(hrKey, token);
                if (sent && this.chatCurrent(hrKey, token)) {
                    state.processedHRs.add(hrKey);
                    writeJSON('processedHRs', Array.from(state.processedHRs));
                }
            } catch (error) {
                if (!isRunCurrent(token)) return;
                state.failedThisRun++;
                UI.log(`聊天处理出错：${error.message}`, 'error');
                UI.syncStatus();
            } finally {
                // A previous run must not unlock a new run's chat worker.
                if (token === state.runToken) state.chatBusy = false;
            }
        },

        async processChatContent(key, token = state.runToken) {
            if (!this.chatCurrent(key, token)) return false;
            const progress = state.chatProgress[key] ||= {};
            const greeting = getSetting('greeting', DEFAULT_PROFILE.greeting);
            if (!progress.greetingSent) {
                if (progress.greetingPending) { setPhase('话术发送待核对，请人工检查'); return false; }
                setPhase('填写并发送沟通话术');
                const messageSent = await this.sendTextMessage(greeting, key, token, () => {
                    progress.greetingPending = true;
                    writeJSON('chatProgress', state.chatProgress);
                }, true);
                if (!this.chatCurrent(key, token)) return false;
                if (!messageSent) {
                    progress.resumeRetryAt = Date.now() + 8000;
                    setPhase(progress.greetingPending ? '话术发送待核对，请人工检查' : '输入框未就绪或已有草稿');
                    UI.log(`${state.currentJob} → 话术未确认；已有草稿不会覆盖。`, 'warn');
                    return false;
                }
                progress.greetingPending = false;
                progress.greetingSent = true;
                writeJSON('chatProgress', state.chatProgress);
                UI.log(`${state.currentJob} → 已确认话术回显。`, 'success');
            }
            if (progress.resumeSent) return true;
            setPhase('检查简历发送入口');
            await this.delay(300);
            if (!this.chatCurrent(key, token)) return false;
            const resumeBtn = await this.waitForElement(() => {
                return Array.from(document.querySelectorAll(CONFIG.SELECTORS.toolbarButton))
                    .find(el => el.textContent.trim().includes('发简历'));
            }, 3500);
            if (!this.chatCurrent(key, token)) return false;

            if (!resumeBtn) {
                UI.log('未找到“发简历”按钮。', 'warn');
                progress.resumeRetryAt = Date.now() + 8000;
                setPhase('等待简历入口');
                return false;
            }

            if (resumeBtn.classList.contains('unable') || resumeBtn.disabled) {
                UI.log('当前还不能发送简历，可能需要对方先回复。', 'warn');
                progress.resumeRetryAt = Date.now() + 8000;
                setPhase('等待对方回复后发送简历');
                return false;
            }

            if (!await this.simulateClick(resumeBtn, token)) return false;
            await this.delay(300);
            if (!this.chatCurrent(key, token)) return false;

            const confirmBtn = await this.waitForElement(CONFIG.SELECTORS.resumeConfirmButton, 3500);
            if (!confirmBtn || !this.chatCurrent(key, token)) {
                UI.log('未找到简历发送确认按钮。', 'warn');
                return false;
            }

            if (!await this.simulateClick(confirmBtn, token)) return false;
            progress.resumeSent = true;
            writeJSON('chatProgress', state.chatProgress);
            setPhase('等待新 HR 消息');
            UI.log('已点击发送简历。', 'success');
            return true;
        },

        async aiReply(key, token = state.runToken) {
            if (!isAiEnabled() || !this.chatCurrent(key, token)) return false;

            resetDailyCountersIfNeeded();
            const dailyLimit = getNumberSetting('dailyAiLimit', CONFIG.DEFAULT_LIMITS.dailyAiLimit);
            if (dailyLimit <= 0 || state.aiReplyCount >= dailyLimit) {
                UI.log(`今日 AI 回复已达到上限 ${dailyLimit}。`, 'warn');
                return false;
            }

            const lastMessage = await this.getLastFriendMessageText();
            if (!lastMessage || !this.chatCurrent(key, token) || state.lastAiMessages.get(key) === lastMessage) return false;

            setPhase('等待 AI 回复');
            UI.log(`对方：${lastMessage}`);
            const aiReplyText = await this.requestAi(lastMessage, token);
            if (!aiReplyText || !isAiEnabled() || !this.chatCurrent(key, token)) return false;

            // Reserve this HR message before dispatch so an uncertain send is not retried.
            state.lastAiMessages.set(key, lastMessage);
            if (!await this.sendTextMessage(aiReplyText, key, token)) {
                if (isRunCurrent(token)) UI.log('AI 消息未确认送达，请人工核对，不会对同一条 HR 消息重试。', 'warn');
                return false;
            }
            if (!this.chatCurrent(key, token)) return false;
            state.aiReplyCount += 1;
            writeJSON('aiReplyCount', state.aiReplyCount);
            setSetting('lastAiDate', state.lastAiDate);
            UI.syncStatus();
            setPhase('等待新 HR 消息');
            UI.log(`AI 已回复：${aiReplyText.slice(0, 32)}${aiReplyText.length > 32 ? '...' : ''}`, 'success');
            return true;
        },

        async requestAi(userMessage, token = state.runToken) {
            if (!isAiEnabled() || !isRunCurrent(token)) return '';
            const endpoint = getSetting('apiEndpoint', '');
            const apiKey = getSetting('aiKey', '');
            const model = getSetting('aiModel', 'gpt-4o-mini');

            if (!endpoint || !apiKey) {
                UI.log('尚未配置 AI Endpoint 或 API Key，已跳过 AI 回复。', 'warn');
                return '';
            }

            const body = {
                model,
                messages: [
                    { role: 'system', content: getSetting('aiRole', DEFAULT_PROFILE.aiRole) },
                    { role: 'user', content: userMessage }
                ],
                temperature: 0.7,
                max_tokens: 360
            };

            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: endpoint,
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${apiKey}`
                    },
                    data: JSON.stringify(body),
                    timeout: 15000,
                    onload: response => {
                        if (!isAiEnabled() || !isRunCurrent(token)) { resolve(''); return; }
                        if (response.status < 200 || response.status >= 300) { reject(new Error(`AI 接口返回 HTTP ${response.status}`)); return; }
                        try {
                            const parsed = JSON.parse(response.responseText);
                            const content = parsed.choices?.[0]?.message?.content
                                || parsed.data?.choices?.[0]?.message?.content
                                || parsed.result
                                || parsed.content
                                || '';
                            resolve(String(content).trim());
                        } catch (error) {
                            reject(new Error(`AI 响应解析失败：${error.message}`));
                        }
                    },
                    ontimeout: () => reject(new Error('AI 请求超时')),
                    onerror: () => reject(new Error('AI 网络请求失败'))
                });
            }).catch(error => {
                UI.log(error.message, 'error');
                return '';
            });
        },

        ownTextCount(text) {
            const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
            return Array.from(document.querySelectorAll('.chat-message .im-list li.item-myself, .chat-message .im-list li.item-self'))
                .filter(item => normalize(item.querySelector('.text')?.textContent || item.textContent) === normalize(text)).length;
        },

        hasOwnText(text) {
            return this.ownTextCount(text) > 0;
        },

        async sendTextMessage(text, key, token = state.runToken, onDispatch = () => {}, acceptExisting = false) {
            if (!text.trim() || !this.chatCurrent(key, token)) return false;
            if (acceptExisting && this.hasOwnText(text)) return true;
            const previousEchoCount = this.ownTextCount(text);
            const inputBox = await this.waitForElement(CONFIG.SELECTORS.chatInput, 4500);
            if (!inputBox || !this.chatCurrent(key, token)) return false;
            const read = () => 'value' in inputBox ? inputBox.value : inputBox.textContent;
            if (read().trim()) return false;
            inputBox.focus();
            if ('value' in inputBox) {
                const prototype = inputBox instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                Object.getOwnPropertyDescriptor(prototype, 'value').set.call(inputBox, text);
            } else {
                const selection = window.getSelection(), range = document.createRange();
                range.selectNodeContents(inputBox); selection.removeAllRanges(); selection.addRange(range);
                document.execCommand('insertText', false, text);
                if (read() !== text) inputBox.textContent = text;
            }
            inputBox.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
            await this.delay(180);
            if (!this.chatCurrent(key, token) || read() !== text) return false;

            const sendButton = this.findVisible(CONFIG.SELECTORS.sendButton);
            if (sendButton) {
                if (sendButton.getAttribute('aria-disabled') === 'true' || sendButton.classList.contains('disabled')) return false;
                if (!await this.simulateClick(sendButton, token, () => this.chatCurrent(key, token), onDispatch)) return false;
            } else {
                // Do not bypass a present disabled Send button with Enter.
                if (document.querySelector(CONFIG.SELECTORS.sendButton)) return false;
                if (!this.chatCurrent(key, token)) return false;
                onDispatch();
                inputBox.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    bubbles: true
                }));
            }
            const confirmed = await this.waitForElement(() => this.chatCurrent(key, token) && this.ownTextCount(text) > previousEchoCount, 5000);
            return !!confirmed && this.chatCurrent(key, token);
        },

        async getLastFriendMessageText() {
            await this.delay(180);
            const chatContainer = document.querySelector(CONFIG.SELECTORS.messageList);
            if (!chatContainer) return null;

            const friendMessages = Array.from(chatContainer.querySelectorAll('li.message-item.item-friend'));
            const lastFriendMessage = friendMessages.at(-1);
            return lastFriendMessage?.querySelector('.text span')?.textContent?.trim() || null;
        },

        async simulateClick(element, token = state.runToken, guard = () => true, beforeClick = () => {}) {
            if (!element || !isRunCurrent(token) || !guard()) return false;
            const rect = element.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;

            for (const type of ['mouseover', 'mousemove', 'mousedown', 'mouseup', 'click']) {
                if (!isRunCurrent(token) || !guard() || !element.isConnected) return false;
                if (type === 'click') beforeClick();
                element.dispatchEvent(new MouseEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    view: document.defaultView,
                    clientX: x,
                    clientY: y,
                    button: 0
                }));
                await this.delay(type === 'click' ? 0 : randomBetween(35, 220));
            }
            return true;
        },

        async waitForElement(selectorOrFunction, timeout = 5000) {
            const token = state.runToken;
            return new Promise(resolve => {
                const getElement = () => typeof selectorOrFunction === 'function'
                    ? selectorOrFunction()
                    : document.querySelector(selectorOrFunction);

                if (!isRunCurrent(token)) return resolve(null);
                const existing = getElement();
                if (existing) return resolve(existing);
                let timeoutId;
                const finish = value => {
                    clearTimeout(timeoutId); observer.disconnect(); state.waiters.delete(cancel); resolve(value);
                };
                const cancel = () => finish(null);
                const observer = new MutationObserver(() => {
                    if (!isRunCurrent(token)) return finish(null);
                    const element = getElement();
                    if (element) finish(element);
                });
                state.waiters.add(cancel);
                timeoutId = setTimeout(() => finish(null), timeout);
                observer.observe(document.body, { childList: true, subtree: true });
            });
        },

        delay(ms) {
            return new Promise(resolve => {
                const finish = () => { clearTimeout(timer); state.waiters.delete(finish); resolve(); };
                const timer = setTimeout(finish, ms);
                state.waiters.add(finish);
            });
        },

        async humanDelay(min, max, reason = '') {
            if (!state.running) return;
            const safeMin = Math.min(Number(min), Number(max));
            const safeMax = Math.max(Number(min), Number(max));
            const ms = randomBetween(safeMin, safeMax);
            if (reason) UI.log(`${reason}：${formatSeconds(ms)}`);
            setPhase(reason || state.phase, ms);
            const token = state.runToken;
            await this.delay(ms);
            if (isRunCurrent(token)) { state.waitUntil = 0; UI.syncProgress(); }
        }
    };

    function toggleProcess(forceValue) {
        const nextValue = typeof forceValue === 'boolean' ? forceValue : !state.running;
        if (nextValue) startProcess();
        else stopProcess();
    }

    function startProcess() {
        if (state.running) return;
        if (!UI.saveSettings()) return; // 新界面带表单校验，不通过则不启动
        if (isChatPage() && /\[(?:目标岗位|相关技能\/经验|到岗时间)\]/.test(getSetting('greeting', DEFAULT_PROFILE.greeting))) {
            UI.openSettings();
            UI.log('请先在设置中将话术模板的方括号内容替换为自己的真实资料，再启动聊天。', 'warn');
            return;
        }
        state.runToken++;
        state.runPath = location.pathname;
        state.runFilters = Filters.read();
        state.filtersOpen = refs.panel.querySelector('[data-filters]').open;
        refs.panel.querySelector('[data-filters]').open = false;
        refs.panel.querySelector('.body').scrollTop = 0;
        refs.panel.querySelector('[data-preview]').hidden = true;
        state.seenJobs.clear();
        state.handledJobs.clear();
        state.scannedThisRun = 0;
        state.newChatsThisRun = 0;
        state.existingChatsThisRun = 0;
        state.failedThisRun = 0;
        state.currentJob = '';
        state.lastCardCount = 0;
        state.idleScanRounds = 0;
        state.chatBusy = false;
        state.running = true;
        state.currentIndex = 0;
        state.appliedThisRun = 0;
        state.skippedThisRun = 0;
        state.lastBreakAt = 0;
        state.currentTopHRKey = '';
        setPhase('准备开始');
        UI.syncStatus();
        const token = state.runToken;
        Core.start(token).catch(error => {
            if (!isRunCurrent(token)) return;
            state.failedThisRun++;
            UI.log(`启动失败：${error.message}`, 'error');
            stopProcess('启动失败');
        });
    }

    function stopProcess(reason = '已停止') {
        state.running = false;
        state.runToken++;
        state.chatBusy = false;
        clearInterval(state.chatTimer);
        state.chatTimer = null;
        for (const cancel of [...state.waiters]) cancel();
        state.waiters.clear();
        if (state.chatObserver) {
            state.chatObserver.disconnect();
            state.chatObserver = null;
        }
        if (state.autoScrollTimer) {
            clearTimeout(state.autoScrollTimer);
            state.autoScrollTimer = null;
        }
        refs.panel.querySelector('[data-filters]').open = state.filtersOpen;
        setPhase(reason);
        UI.syncStatus();
        UI.log('已停止。HR 处理记录会保留，避免重复发送。', 'warn');
    }

    function showWelcomeOncePerDay() {
        const today = todayKey();
        if (localStorage.getItem(storeKey('welcomeShown')) === today) return;

        localStorage.setItem(storeKey('welcomeShown'), today);
        UI.log('建议先确认筛选词、默认话术和 AI 设置，再开始批量沟通。', 'info');
    }

    function init() {
        console.info('[huazhou BOSS helper] userscript loaded:', location.href);
        resetDailyCountersIfNeeded();
        UI.init();
        installRouteWatcher();
        showWelcomeOncePerDay();
        logCurrentPageHint();
    }

    function logCurrentPageHint() {
        if (!refs.log) return;
        if (isJobListPage()) {
            UI.log('检测到岗位列表页：设置筛选条件后可启动全自动投递。');
        } else if (isChatPage()) {
            UI.log('检测到聊天页：启动后会监听最新 HR 消息并处理回复。');
        } else {
            UI.log('请进入 BOSS 岗位列表页或聊天页使用。', 'warn');
        }
    }

    function installRouteWatcher() {
        if (window.__hzBossHelperRouteWatcher) return;
        window.__hzBossHelperRouteWatcher = true;
        let lastHref = location.href;
        let lastPath = location.pathname;
        window.setInterval(() => {
            if (location.href === lastHref) return;
            lastHref = location.href;
            if (location.pathname !== lastPath) {
                lastPath = location.pathname;
                if (state.running) {
                    stopProcess('页面已切换，请在新页面手动启动');
                    UI.log('保留原版手动启动方式：页面类型切换后已停止，不自动发送聊天内容。', 'warn');
                }
            }
            console.info('[huazhou BOSS helper] route changed:', lastHref);
            logCurrentPageHint();
        }, 1200);
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        init();
    } else {
        window.addEventListener('load', init, { once: true });
    }
})();
