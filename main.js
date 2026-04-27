(function () {
  'use strict';

  if (!document.body.classList.contains('vertical')) return;

  // ── DOM参照 ──────────────────────────────────────────────────
  const loadingEl   = document.getElementById('loading');
  const storyBody   = document.getElementById('story-body');
  const titleTextEl = document.querySelector('.title-card__text');
  const titleCard   = document.querySelector('.title-card');
  const backCard    = document.getElementById('back-card');
  const advanceCard = document.getElementById('advance-card');
  const navCard     = document.getElementById('nav-card');
  const scroller    = document.getElementById('scroll-container');
  const bgContainer = document.getElementById('bg-container');
  const fadeOverlay = document.getElementById('fade-overlay');
  const advanceBtn  = document.getElementById('btn-advance');
  const backBtn     = document.getElementById('btn-back');

  advanceBtn.textContent = '←';
  backBtn.textContent    = '→';

  // ── 状態 ─────────────────────────────────────────────────────
  const bgLayers = new Map(); // bgKey → div.bg-layer
  let currentBg      = null;
  let sections       = [];   // [{ bgKey, tokens }]
  let currentSection = 0;
  let transitioning  = false;
  let invertScroll   = null;
  let restorationState = { el: null, ratio: 0 };

  // ── イベントリスナー ──────────────────────────────────────────
  initWheelScroll();
  initProgressBar();
  initResizeHandler();
  advanceBtn.addEventListener('click', advance);
  backBtn.addEventListener('click', back);

  loadContent();
  window.addEventListener('hashchange', loadContent);

  // ── コンテンツ読み込み ────────────────────────────────────────
  async function loadContent() {
    const hash  = location.hash.slice(1);
    const match = /^(\d{2})-(\d{2})$/.exec(hash);

    sections       = [];
    currentSection = 0;
    transitioning  = false;
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
      sections = parseIntoSections(tokenize(text));
      await preloadBackgrounds();
      renderSection(0);
      updateCards();

      requestAnimationFrame(() => {
        scroller.scrollLeft = scroller.scrollWidth;
        scroller.scrollTop  = 0;
        if (invertScroll === null) {
          invertScroll = scroller.scrollLeft > 0;
        }
        restorationState = { el: null, ratio: getScrollRatio() };
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

  // ── セクション分割 ────────────────────────────────────────────
  // BG タグを区切りに [{bgKey, tokens}] へ分割する
  // sections[0].bgKey は null（最初のBGタグ前）
  function parseIntoSections(tokens) {
    const result = [{ bgKey: null, tokens: [] }];
    for (const tok of tokens) {
      if (tok.type === 'tag' && tok.tagType === 'BG') {
        result.push({ bgKey: tok.value, tokens: [] });
      } else {
        result[result.length - 1].tokens.push(tok);
      }
    }
    return result;
  }

  // ── レンダラー ────────────────────────────────────────────────
  // \n  → </p><p>（段落区切り）
  // \n\n → </p><br><p>（演出的な空行）
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
      } else if (tok.type === 'tag' && tok.tagType !== 'BG') {
        const span = document.createElement('span');
        span.className = 'story-tag';
        span.dataset.tagType = tok.tagType;
        span.dataset.value   = tok.value;
        currentP.appendChild(span);
      }
    }

    closeParagraph();
    container.appendChild(content);
  }

  function renderSection(n) {
    storyBody.innerHTML = '';
    render(sections[n].tokens, storyBody);
  }

  // ── カード表示制御 ────────────────────────────────────────────
  function updateCards() {
    const isFirst = currentSection === 0;
    const isLast  = currentSection === sections.length - 1;

    titleCard.hidden   = !isFirst;
    backCard.hidden    = isFirst;
    advanceCard.hidden = isLast;
    navCard.hidden     = !isLast;
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

  // ── スクロール先頭へ ──────────────────────────────────────────
  function scrollToStart() {
    scroller.scrollLeft = scroller.scrollWidth;
    scroller.scrollTop  = 0;
  }

  // ── 進行処理 ──────────────────────────────────────────────────
  async function advance() {
    if (transitioning || currentSection >= sections.length - 1) return;
    transitioning = true;

    await fadeOut();

    currentSection++;
    renderSection(currentSection);
    switchBackground(sections[currentSection].bgKey);
    updateCards();
    scrollToStart();

    await fadeIn();
    transitioning = false;
  }

  // ── 戻り処理 ──────────────────────────────────────────────────
  async function back() {
    if (transitioning || currentSection <= 0) return;
    transitioning = true;

    await fadeOut();

    currentSection--;
    renderSection(currentSection);
    switchBackground(sections[currentSection].bgKey);
    updateCards();
    scrollToStart();

    await fadeIn();
    transitioning = false;
  }

  // ── スクロール比率 ────────────────────────────────────────────
  function getScrollRatio() {
    if (invertScroll === null) return 0;
    const total = scroller.scrollWidth - scroller.clientWidth;
    if (total <= 0) return 0;
    return invertScroll
      ? 1 - scroller.scrollLeft / total
      : Math.abs(scroller.scrollLeft) / total;
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

  // ── リサイズ時スクロール位置保持 ─────────────────────────────
  function initResizeHandler() {
    let timer = null;

    window.addEventListener('resize', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const { el, ratio } = restorationState;
        if (el && el.closest('.story-content')) {
          const elRect     = el.getBoundingClientRect();
          const scrollRect = scroller.getBoundingClientRect();
          scroller.scrollLeft += (elRect.left + elRect.width  / 2)
                               - (scrollRect.left + scrollRect.width  / 2);
        } else if (ratio < 0.5) {
          scrollToStart();
        } else {
          scroller.scrollLeft = 0;
        }
      }, 100);
    });
  }

  // ── ホイール → 横スクロール（PC縦書き用）─────────────────────
  function initWheelScroll() {
    scroller.addEventListener('wheel', e => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      scroller.scrollBy({ left: -e.deltaY, behavior: 'auto' });
    }, { passive: false });
  }

})();
