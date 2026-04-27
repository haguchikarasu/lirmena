(function () {
  'use strict';

  const isVertical   = document.body.classList.contains('vertical');
  const isHorizontal = document.body.classList.contains('horizontal');

  if (!(isVertical || isHorizontal)) return;

  // ── DOM参照 ──────────────────────────────────────────────────
  const loadingEl   = document.getElementById('loading');
  const storyBody   = document.getElementById('story-body');
  const titleTextEl = document.querySelector('.title-card__text');
  const scroller    = document.getElementById('scroll-container');
  const bgContainer = document.getElementById('bg-container');
  const fadeOverlay = document.getElementById('fade-overlay');
  const advanceBtn  = document.getElementById('btn-advance');
  const backBtn     = document.getElementById('btn-back');

  // Chrome/Edge では scrollLeft が正値、Firefox では負値になる
  let invertScroll     = null;
  let restorationState = { el: null, ratio: 0 };

  // ── Phase 2.5 状態 ───────────────────────────────────────────
  const bgLayers = new Map(); // bgKey → div.bg-layer
  let currentBg      = null;
  let sections       = [];   // [{ bgKey, triggerEl, firstEl }]
  let currentSection = 0;
  let transitioning  = false;

  advanceBtn.textContent = isVertical ? '←' : '↓';
  backBtn.textContent    = isVertical ? '→' : '↑';


  // ── イベントリスナー（一度だけ設定） ─────────────────────────
  if (isVertical) initWheelScroll();
  initProgressBar();
  initResizeHandler();
  scroller.addEventListener('scroll', checkTriggerPosition, { passive: true });
  advanceBtn.addEventListener('click', advance);
  backBtn.addEventListener('click', back);

  // 初回読み込み + ハッシュ変更で再読み込み
  loadContent();
  window.addEventListener('hashchange', loadContent);

  // ── コンテンツ読み込み ────────────────────────────────────────
  async function loadContent() {
    const hash  = location.hash.slice(1);
    const match = /^(\d{2})-(\d{2})$/.exec(hash);

    // BG状態リセット
    sections       = [];
    currentSection = 0;
    transitioning  = false;
    hideButton(advanceBtn);
    hideButton(backBtn);
    bgLayers.forEach(layer => layer.remove());
    bgLayers.clear();
    currentBg = null;

    storyBody.innerHTML = '';
    loadingEl.style.display = 'flex';

    if (!match) {
      loadingEl.style.display = 'none';
      storyBody.textContent = 'URLが正しくありません。例: contents-v.html#01-01';
      return;
    }

    const [, epStr, secStr] = match;
    const epNum  = parseInt(epStr, 10);
    const secNum = parseInt(secStr, 10);

    try {
      const [text, episodes] = await Promise.all([
        fetchText(epStr, secStr),
        fetchEpisodes(),
      ]);

      const epData   = episodes.find(e => e.id === epNum);
      const cardInfo = secNum === 1
        ? { isEpTitle: true,  text: epData ? epData.title : null }
        : { isEpTitle: false, num: secStr };

      updateTitleCard(cardInfo);
      render(tokenize(text), storyBody);

      const contentEl = storyBody.querySelector('.story-content');
      if (contentEl) {
        initSections(contentEl);
        await preloadBackgrounds();
      }

      // スクロール位置を先頭にリセット（初回のみ invertScroll を確定）
      requestAnimationFrame(() => {
        scroller.scrollLeft = isVertical ? scroller.scrollWidth : 0;
        scroller.scrollTop  = 0;
        if (isVertical && invertScroll === null) {
          invertScroll = scroller.scrollLeft > 0;
        }
        restorationState = { el: null, ratio: getScrollRatio() };
        positionButtons();
        checkTriggerPosition();
      });

    } catch (err) {
      storyBody.textContent = 'テキストの読み込みに失敗しました。';
      console.error(err);
    } finally {
      loadingEl.style.display = 'none';
    }
  }

  // ── タイトルカード更新 ────────────────────────────────────────
  function updateTitleCard(cardInfo) {
    titleTextEl.innerHTML = '';
    titleTextEl.classList.toggle('title-card__text--ep',  cardInfo.isEpTitle);
    titleTextEl.classList.toggle('title-card__text--sec', !cardInfo.isEpTitle);
    if (cardInfo.isEpTitle) {
      titleTextEl.textContent = cardInfo.text ?? '';
    } else {
      const tcySpan = document.createElement('span');
      tcySpan.className = 'tcy';
      tcySpan.textContent = cardInfo.num;
      titleTextEl.appendChild(tcySpan);
    }
  }

  // ── フェッチ ──────────────────────────────────────────────────
  async function fetchText(epStr, secStr) {
    const res = await fetch(`txt/${epStr}-${secStr}.txt`);
    if (!res.ok) throw new Error(`${res.status} ${res.url}`);
    return res.text();
  }

  async function fetchEpisodes() {
    const res = await fetch('episodes.json');
    if (!res.ok) throw new Error(`${res.status} ${res.url}`);
    return res.json();
  }

  // ── トークナイザー ────────────────────────────────────────────
  // token: { type:'text', value }
  //      | { type:'tag',  tagType, value }
  //      | { type:'ruby', base, reading }
  //      | { type:'tcy',  value }
  function tokenize(raw) {
    const text   = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const tokens = [];
    const re     = /@@([A-Z]+):([^@]*)@@|\|([^《\n]+)《([^》]*)》|\^([^^]+)\^/g;
    let last = 0, m;

    while ((m = re.exec(text)) !== null) {
      if (m.index > last) tokens.push({ type: 'text', value: text.slice(last, m.index) });
      if (m[1] !== undefined) {
        tokens.push({ type: 'tag', tagType: m[1], value: m[2] });
      } else if (m[3] !== undefined) {
        tokens.push({ type: 'ruby', base: m[3], reading: m[4] });
      } else {
        tokens.push({ type: 'tcy', value: m[5] });
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) tokens.push({ type: 'text', value: text.slice(last) });

    // タグ直後の改行1つを除去
    for (let i = 1; i < tokens.length; i++) {
      if (tokens[i - 1].type === 'tag' && tokens[i].type === 'text') {
        tokens[i].value = tokens[i].value.replace(/^\n/, '');
      }
    }

    return tokens;
  }

  // ── レンダラー ────────────────────────────────────────────────
  // \n  → </p><p>（段落区切り）
  // \n\n → </p><br><p>（演出的な空行）
  // BG タグ → <p> を閉じて .story-content の直下にブロックとして挿入
  function render(tokens, container) {
    const content = document.createElement('div');
    content.className = 'story-content';

    let currentP = document.createElement('p');

    function closeParagraph() {
      if (currentP.hasChildNodes()) content.appendChild(currentP);
      currentP = document.createElement('p');
    }

    for (const tok of tokens) {
      if (tok.type === 'text') {
        const parts = tok.value.split('\n');
        parts.forEach((part, i) => {
          if (i > 0) {
            if (part === '') {
              closeParagraph();
              if (i < parts.length - 1) {
                content.appendChild(document.createElement('br'));
              }
              return;
            }
            closeParagraph();
          }
          if (part) currentP.appendChild(document.createTextNode(part));
        });
      } else if (tok.type === 'ruby') {
        const ruby = document.createElement('ruby');
        ruby.appendChild(document.createTextNode(tok.base));
        const rt = document.createElement('rt');
        rt.textContent = tok.reading;
        ruby.appendChild(rt);
        currentP.appendChild(ruby);
      } else if (tok.type === 'tcy') {
        const span = document.createElement('span');
        span.className = 'tcy';
        span.textContent = tok.value;
        currentP.appendChild(span);
      } else if (tok.type === 'tag') {
        if (tok.tagType === 'BG') {
          // BG タグはブロックレベルのセクション境界として <p> の外に配置
          closeParagraph();
          const span = document.createElement('span');
          span.className = 'bg-trigger';
          span.dataset.tagType = 'BG';
          span.dataset.value   = tok.value;
          content.appendChild(span);
        } else {
          const span = document.createElement('span');
          span.className = 'story-tag';
          span.dataset.tagType = tok.tagType;
          span.dataset.value   = tok.value;
          currentP.appendChild(span);
        }
      }
    }

    closeParagraph();
    container.appendChild(content);
  }

  // ── セクション初期化 ──────────────────────────────────────────
  // sections[0] = { bgKey: null, triggerEl: null, firstEl: null }  ← タイトルカード～最初のBGタグ前
  // sections[N] = { bgKey: '...', triggerEl: <span>, firstEl: <p> }
  //
  // triggerEl の可視ルール：
  //   trigger[1]     → 常時表示（初期フロンティア）
  //   trigger[N≥2]   → sections[N-1] が開示されるまで section-hidden
  function initSections(contentEl) {
    sections = [{ bgKey: null, triggerEl: null, firstEl: null }];
    let secIdx = 0;

    for (const child of Array.from(contentEl.children)) {
      if (child.classList.contains('bg-trigger')) {
        secIdx++;
        sections.push({ bgKey: child.dataset.value, triggerEl: child, firstEl: null });

        if (secIdx > 1) {
          // trigger[N≥2] は前のセクションが開示されるまで隠す
          child.classList.add('section-hidden');
          child.dataset.section = String(secIdx - 1);
        }
      } else {
        child.dataset.section = String(secIdx);
        if (secIdx > 0) {
          child.classList.add('section-hidden');
          if (!sections[secIdx].firstEl) sections[secIdx].firstEl = child;
        }
      }
    }
  }

  // ── セクション表示・非表示 ────────────────────────────────────
  function showSection(n) {
    storyBody.querySelectorAll(`[data-section="${n}"]`).forEach(el => {
      el.classList.remove('section-hidden');
    });
  }

  function hideSection(n) {
    storyBody.querySelectorAll(`[data-section="${n}"]`).forEach(el => {
      el.classList.add('section-hidden');
    });
  }

  // ── 背景画像プリロード ────────────────────────────────────────
  async function preloadBackgrounds() {
    const keys = [...new Set(sections.slice(1).map(s => s.bgKey).filter(Boolean))];
    await Promise.all(keys.map(async key => {
      if (bgLayers.has(key)) return;
      const path = await resolveImagePath(key);
      const layer = document.createElement('div');
      layer.className = 'bg-layer';
      if (path) layer.style.backgroundImage = `url('${path}')`;
      bgContainer.appendChild(layer);
      bgLayers.set(key, layer);
    }));
  }

  async function resolveImagePath(filename) {
    const path = `img/${filename}`;
    return new Promise(resolve => {
      const img = new Image();
      img.onload  = () => resolve(path);
      img.onerror = () => resolve(null);
      img.src = path;
    });
  }

  // ── 背景切り替え ──────────────────────────────────────────────
  function switchBackground(key) {
    if (currentBg && bgLayers.has(currentBg)) {
      bgLayers.get(currentBg).classList.remove('active');
    }
    if (key && bgLayers.has(key)) {
      bgLayers.get(key).classList.add('active');
    }
    currentBg = key;
  }

  // ── フェード ──────────────────────────────────────────────────
  function fadeOut() {
    return new Promise(resolve => {
      fadeOverlay.classList.add('fading');
      setTimeout(resolve, 400);
    });
  }

  function fadeIn() {
    return new Promise(resolve => {
      fadeOverlay.classList.remove('fading');
      setTimeout(resolve, 400);
    });
  }

  // ── ボタン表示制御 ────────────────────────────────────────────
  function showButton(btn) { btn.classList.add('visible'); }
  function hideButton(btn) { btn.classList.remove('visible'); }

  // ── ボタン位置計算（本文表示エリアの左右/上下1/4点に配置）────
  function positionButtons() {
    const r = scroller.getBoundingClientRect();
    if (isVertical) {
      const leftCx  = r.left + r.width * 0.25;
      const rightCx = r.left + r.width * 0.75;
      const midY    = r.top  + r.height * 0.5;
      advanceBtn.style.left = `${leftCx}px`;  advanceBtn.style.top = `${midY}px`;
      advanceBtn.style.right = 'auto';        advanceBtn.style.bottom = 'auto';
      advanceBtn.style.transform = 'translate(-50%, -50%)';
      backBtn.style.left = `${rightCx}px`;    backBtn.style.top = `${midY}px`;
      backBtn.style.right = 'auto';           backBtn.style.bottom = 'auto';
      backBtn.style.transform = 'translate(-50%, -50%)';
    } else {
      const midX     = r.left + r.width  * 0.5;
      const topCx    = r.top  + r.height * 0.25;
      const bottomCx = r.top  + r.height * 0.75;
      backBtn.style.left = `${midX}px`;    backBtn.style.top = `${topCx}px`;
      backBtn.style.right = 'auto';        backBtn.style.bottom = 'auto';
      backBtn.style.transform = 'translate(-50%, -50%)';
      advanceBtn.style.left = `${midX}px`; advanceBtn.style.top = `${bottomCx}px`;
      advanceBtn.style.right = 'auto';     advanceBtn.style.bottom = 'auto';
      advanceBtn.style.transform = 'translate(-50%, -50%)';
    }
  }

  // ── トリガー位置監視 ──────────────────────────────────────────
  const TRIGGER_THRESHOLD = 80; // px

  function checkTriggerPosition() {
    if (transitioning || sections.length === 0) return;

    const sr = scroller.getBoundingClientRect();

    // 進行ボタン：次のフロンティアトリガーが画面中央付近に来たら表示
    const nextSec = sections[currentSection + 1];
    if (nextSec) {
      const r    = nextSec.triggerEl.getBoundingClientRect();
      const dist = isVertical
        ? Math.abs((r.left + r.right) / 2 - (sr.left + sr.width  / 2))
        : Math.abs((r.top  + r.bottom) / 2 - (sr.top  + sr.height / 2));
      dist < TRIGGER_THRESHOLD ? showButton(advanceBtn) : hideButton(advanceBtn);
    } else {
      hideButton(advanceBtn);
    }

    // 戻るボタン：現在セクションのトリガーが画面中央付近に来たら表示
    if (currentSection > 0) {
      const r    = sections[currentSection].triggerEl.getBoundingClientRect();
      const dist = isVertical
        ? Math.abs((r.left + r.right) / 2 - (sr.left + sr.width  / 2))
        : Math.abs((r.top  + r.bottom) / 2 - (sr.top  + sr.height / 2));
      dist < TRIGGER_THRESHOLD ? showButton(backBtn) : hideButton(backBtn);
    } else {
      hideButton(backBtn);
    }
  }

  // ── 進行処理 ──────────────────────────────────────────────────
  async function advance() {
    if (transitioning) return;
    const nextIdx = currentSection + 1;
    if (!sections[nextIdx]) return;

    transitioning = true;
    hideButton(advanceBtn);
    hideButton(backBtn);

    await fadeOut();

    hideSection(currentSection);
    showSection(nextIdx);
    // hideSection で trigger[N].triggerEl (data-section="N-1") も非表示になるため明示的に復元
    if (sections[nextIdx].triggerEl) {
      sections[nextIdx].triggerEl.classList.remove('section-hidden');
    }
    switchBackground(sections[nextIdx].bgKey);
    currentSection = nextIdx;

    const firstEl = sections[nextIdx].firstEl;
    if (firstEl) {
      await twoFrames();
      scrollToCenter(firstEl);
    }

    await fadeIn();
    transitioning = false;
  }

  // ── 戻り処理 ──────────────────────────────────────────────────
  async function back() {
    if (transitioning || currentSection <= 0) return;

    transitioning = true;
    hideButton(advanceBtn);
    hideButton(backBtn);

    await fadeOut();

    hideSection(currentSection);
    const prevIdx = currentSection - 1;
    showSection(prevIdx);
    switchBackground(sections[prevIdx].bgKey);
    currentSection = prevIdx;

    // フロンティアトリガーを画面中央に戻す
    const trigger = sections[currentSection + 1].triggerEl;
    if (trigger) {
      await twoFrames();
      scrollToCenter(trigger);
    }

    await fadeIn();
    transitioning = false;
    checkTriggerPosition();
  }

  // ── ユーティリティ ────────────────────────────────────────────
  function twoFrames() {
    return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  }

  // ── スクロール比率 ────────────────────────────────────────────
  function getScrollRatio() {
    if (isVertical) {
      if (invertScroll === null) return 0;
      const total = scroller.scrollWidth - scroller.clientWidth;
      if (total <= 0) return 0;
      return invertScroll
        ? 1 - scroller.scrollLeft / total
        : Math.abs(scroller.scrollLeft) / total;
    }
    const total = scroller.scrollHeight - scroller.clientHeight;
    return total > 0 ? scroller.scrollTop / total : 0;
  }

  // ── 進捗バー ──────────────────────────────────────────────────
  function initProgressBar() {
    const bar = document.getElementById('progress-bar');

    function update() {
      const ratio = getScrollRatio();
      bar.style.width = `${Math.min(Math.max(ratio, 0), 1) * 100}%`;
      const rect = scroller.getBoundingClientRect();
      const raw  = document.elementFromPoint(
        rect.left + rect.width  / 2,
        rect.top  + rect.height / 2
      );
      restorationState = { el: raw ? (raw.closest('p') || raw) : null, ratio };
    }

    scroller.addEventListener('scroll', update, { passive: true });
  }

  // ── 画面中央へスクロール ──────────────────────────────────────
  function scrollToCenter(el) {
    const elRect     = el.getBoundingClientRect();
    const scrollRect = scroller.getBoundingClientRect();
    if (isVertical) {
      scroller.scrollLeft += (elRect.left + elRect.width  / 2)
                           - (scrollRect.left + scrollRect.width  / 2);
    } else {
      scroller.scrollTop  += (elRect.top  + elRect.height / 2)
                           - (scrollRect.top  + scrollRect.height / 2);
    }
  }

  // ── リサイズ時スクロール位置保持 ─────────────────────────────
  function initResizeHandler() {
    let timer = null;

    window.addEventListener('resize', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        positionButtons();
        const { el, ratio } = restorationState;
        if (el && el.closest('.story-content')) {
          scrollToCenter(el);
        } else if (ratio < 0.5) {
          scroller.scrollLeft = isVertical ? scroller.scrollWidth : 0;
          scroller.scrollTop  = 0;
        } else {
          if (isVertical) scroller.scrollLeft = 0;
          else scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight;
        }
      }, 100);
    });
  }

  // ── ホイール → 横スクロール（縦書き・PC用）──────────────────
  function initWheelScroll() {
    scroller.addEventListener('wheel', e => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      // 進行方向（手前→新コンテンツ）のロック
      const isForward = e.deltaY > 0;
      if (isForward  && advanceBtn.classList.contains('visible')) return;
      if (!isForward && backBtn.classList.contains('visible'))    return;
      scroller.scrollBy({ left: -e.deltaY, behavior: 'auto' });
    }, { passive: false });
  }

})();
