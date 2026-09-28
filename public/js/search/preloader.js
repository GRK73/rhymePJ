(function(root) {
    'use strict';
    const overlay = document.getElementById('appPreloader');
    const panel = document.getElementById('preloaderPanel');
    const title = document.getElementById('preloaderTitle');
    const description = document.getElementById('preloaderDescription');
    const step = document.getElementById('preloaderStep');
    const count = document.getElementById('preloaderCount');
    const bar = document.getElementById('preloaderBar');
    const retry = document.getElementById('preloaderRetry');
    const hint = document.getElementById('preloaderHint');
    let state = 'loading';
    let timer;
    document.body.classList.add('preloading');
    document.body.setAttribute('aria-busy','true');
    panel.focus({preventScroll:true});

    function fail() {
        if (state !== 'loading') return;
        state = 'error';
        clearTimeout(timer);
        overlay.classList.add('has-error');
        title.textContent = '검색기를 불러오지 못했어요';
        description.textContent = '인터넷 연결을 확인한 뒤 다시 시도해 주세요.';
        step.textContent = '준비 중 문제가 발생했습니다';
        count.textContent = '';
        bar.hidden = true;
        hint.textContent = '문제가 계속되면 잠시 후 다시 방문해 주세요.';
        retry.hidden = false;
        document.body.setAttribute('aria-busy','false');
        retry.focus({preventScroll:true});
    }
    // A stalled script/request must not leave an endless modal. Reload retries
    // the whole bootstrap, including any script that failed before app.js ran.
    timer = setTimeout(fail,45000);
    retry.addEventListener('click',()=>root.location.reload());
    root.addEventListener('error',event=>{
        if (state === 'loading' && (event.target?.tagName === 'SCRIPT' || event.error)) fail();
    },true);
    overlay.addEventListener('keydown',event=>{
        if (event.key !== 'Tab') return;
        event.preventDefault();
        (retry.hidden ? panel : retry).focus({preventScroll:true});
    });

    root.RhymePreloader = Object.freeze({
        get state() { return state; },
        update(completed,total) {
            if (state !== 'loading') return;
            bar.value = total ? completed / total * 100 : 0;
            step.textContent = completed === total ? '검색 준비 완료' : '기본 검색 자료 준비 중';
            count.textContent = `${completed} / ${total}`;
            bar.setAttribute('aria-valuetext',`기본 자료 ${total}개 중 ${completed}개 준비 완료`);
        },
        async finish() {
            if (state !== 'loading') return false;
            clearTimeout(timer);
            // Let the real completion state paint, with no artificial delay. A hidden tab
            // runs no animation frames, so the timer finishes it there (and starts the prefetch).
            await new Promise(resolve=>{ requestAnimationFrame(()=>requestAnimationFrame(resolve)); setTimeout(resolve,100); });
            if (state !== 'loading') return false;
            state = 'ready';
            overlay.hidden = true;
            document.body.classList.remove('preloading');
            document.body.setAttribute('aria-busy','false');
            document.querySelectorAll('[data-preload-inert]').forEach(element=>element.inert=false);
            const focusTarget = root.matchMedia('(pointer:fine)').matches ? 'searchInput' : 'searchBtn';
            document.getElementById(focusTarget)?.focus({preventScroll:true});
            return true;
        },
        fail
    });
})(window);
