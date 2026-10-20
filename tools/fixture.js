// Local-only fixtures: there are no external requests or real HR recipients.
(() => {
    const params = new URLSearchParams(location.search);
    const host = document.querySelector('#fixture');
    const fixture = window.fixture = { selected: [], clicks: [], stays: 0, sent: [], resumes: 0, confirmations: 0 };
    if (location.pathname.includes('/chat')) {
        host.className = 'mock-chat';
        host.innerHTML = '<ul class="chat-list"><li role="listitem" class="selected"><div class="figure">模拟头像</div><div class="name-box"><span class="name-text">HR Demo</span><span>示例公司</span></div></li></ul><div class="chat-message"><ul class="im-list"><li class="message-item item-friend"><div class="text"><span>可以介绍一下你的项目吗？</span></div></li></ul></div><div id="chat-input" contenteditable="true"></div><button class="btn-send">发送</button><button class="toolbar-btn">发简历</button>';
        if (params.has('resumeBlocked')) host.querySelector('.toolbar-btn').classList.add('unable');
        if (params.has('draft')) host.querySelector('#chat-input').textContent = '保留我的手动草稿';
        host.querySelector('.btn-send').addEventListener('click', () => {
            const input = host.querySelector('#chat-input');
            if (!input.textContent.trim()) return;
            const text = input.textContent; input.textContent = ''; fixture.sent.push(text);
            if (!params.has('noEcho')) {
                const message = document.createElement('li'); message.className = 'message-item item-myself';
                const content = document.createElement('div'); content.className = 'text'; content.textContent = text;
                message.append(content); host.querySelector('.im-list').append(message);
            }
        });
        host.querySelector('.toolbar-btn').addEventListener('click', () => {
            if (host.querySelector('.toolbar-btn').classList.contains('unable')) return;
            fixture.resumes++;
            const button = document.createElement('span'); button.className = 'btn-sure-v2'; button.textContent = '确认发送简历';
            button.addEventListener('click', () => { fixture.confirmations++; button.remove(); }); host.append(button);
        });
        return;
    }
    host.innerHTML = '<ul class="jobs"></ul><div class="detail">点击卡片查看本地模拟岗位操作。</div>';
    const rows = [
        ['intern', '前端实习', '广州', '星河科技', '在校 · 本科', '150–200/天', '立即沟通'],
        ['old', 'Vue 实习', '广州', '轻舟软件', '经验不限 · 大专', '120–180/天', '继续沟通'],
        ['senior', '前端开发工程师', '广州', '远山科技', '3–5年 · 本科', '12–18K', '立即沟通'],
        ['training', '前端实习培训生', '广州', '培训中心', '在校 · 本科', '100/天', '立即沟通'],
        ['other-city', '前端实习', '上海', '北岸科技', '应届 · 本科', '180/天', '立即沟通'],
        ['ai', 'AI 应用开发实习', '广州', '原点智能', '在校 · 本科', '180–240/天', '立即沟通'],
        ['closed', 'Web 全栈实习', '广州', '山海网络', '在校 · 大专', '150/天', '暂不可沟通'],
        ['other-role', '销售顾问', '广州', '风帆科技', '经验不限 · 大专', '8–12K', '立即沟通']
    ];
    for (const [id, title, city, company, tags, salary, label] of rows) {
        const card = document.createElement('li'); card.className = 'job-card-box'; card.dataset.jobId = id;
        card.innerHTML = `<div><span class="salary">${salary}</span><span class="job-name">${title}</span></div><span class="tags">${tags}</span><span class="company-name">${company}</span><span class="company-location">${city}</span>`;
        card.addEventListener('click', () => {
            fixture.selected.push(id);
            host.querySelectorAll('.job-card-box').forEach(row => row.classList.toggle('selected', row === card));
            const detail = host.querySelector('.detail'); detail.replaceChildren();
            const text = document.createElement('p'); text.textContent = `${company} · ${title}`;
            const button = document.createElement('a'); button.className = 'op-btn-chat'; button.href = '#'; button.textContent = label;
            button.addEventListener('click', event => {
                event.preventDefault(); fixture.clicks.push([id, label]);
                if (params.has('redirect')) { history.pushState({}, '', '/web/geek/chat?test=1'); return; }
                setTimeout(() => {
                    const dialog = document.createElement('div'); dialog.className = 'fixture-dialog'; dialog.setAttribute('role', 'dialog');
                    const stay = document.createElement('button'); stay.className = 'default-btn cancel-btn'; stay.textContent = '留在此页';
                    stay.addEventListener('click', () => { fixture.stays++; dialog.remove(); }); dialog.append(stay); document.body.append(dialog);
                }, Number(params.get('modalDelay')) || 100);
            });
            detail.append(text, button);
            history.replaceState({}, '', location.pathname + location.search + (location.search ? '&' : '?') + 'selected=' + id);
        });
        host.querySelector('.jobs').append(card);
    }
})();
