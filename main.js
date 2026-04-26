(function () {
  'use strict';

  const isVertical   = document.body.classList.contains('vertical');
  const isHorizontal = document.body.classList.contains('horizontal');

  if (!(isVertical || isHorizontal)) return;

  const loadingEl = document.getElementById('loading');
  const storyEl   = document.getElementById('story');
  const scroller  = document.getElementById('scroll-container');

  // イベントリスナーは一度だけ設定
  if (isVertical) initWheelScroll();
  initProgressBar();

  // 初回読み込み + ハッシュ変更で再読み込み
  loadContent();
  window.addEventListener('hashchange', loadContent);

  // ── コンテンツ読み込み ────────────────────────────────────────
  async function loadContent() {
    const hash  = location.hash.slice(1);
    const match = /^(\d{2})-(\d{2})$/.exec(hash);

    storyEl.innerHTML = '';
    loadingEl.style.display = 'flex';

    if (!match) {
      loadingEl.style.display = 'none';
      storyEl.textContent = 'URLが正しくありません。例: contents-v.html#01-01';
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

      let cardContent;
      if (secNum === 1) {
        const epData = episodes.find(e => e.id === epNum);
        cardContent = epData ? epData.title : `section ${secStr}`;
      } else {
        cardContent = `section ${secStr}`;
      }

      render(tokenize(text), cardContent, storyEl);

      // スクロール位置を先頭にリセット
      requestAnimationFrame(() => {
        scroller.scrollLeft = isVertical ? scroller.scrollWidth : 0;
        scroller.scrollTop  = 0;
      });

    } catch (err) {
      storyEl.textContent = 'テキストの読み込みに失敗しました。';
      console.error(err);
    } finally {
      loadingEl.style.display = 'none';
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
  function tokenize(raw) {
    const text   = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const tokens = [];
    const re     = /@@([A-Z]+):([^@]*)@@|\|([^《\n]+)《([^》]*)》/g;
    let last = 0, m;

    while ((m = re.exec(text)) !== null) {
      if (m.index > last) tokens.push({ type: 'text', value: text.slice(last, m.index) });
      if (m[1] !== undefined) {
        tokens.push({ type: 'tag', tagType: m[1], value: m[2] });
      } else {
        tokens.push({ type: 'ruby', base: m[3], reading: m[4] });
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
  // \n  → </p><p>（段落区切り、CSS で margin 調整可能）
  // \n\n → </p><br><p>（演出的な空行）
  function render(tokens, cardContent, container) {
    const frag    = document.createDocumentFragment();

    // タイトルカード（本文の右／上）
    const titleCard = document.createElement('div');
    titleCard.className = 'title-card';
    const titleText = document.createElement('p');
    titleText.className = 'title-card__text';
    titleText.textContent = cardContent;
    titleCard.appendChild(titleText);
    frag.appendChild(titleCard);

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
              content.appendChild(document.createElement('br'));
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
      } else if (tok.type === 'tag') {
        const span = document.createElement('span');
        span.className = 'story-tag';
        span.dataset.tagType = tok.tagType;
        span.dataset.value   = tok.value;
        currentP.appendChild(span);
      }
    }

    closeParagraph();
    frag.appendChild(content);

    // ナビゲーションカード（本文の左／下）フェーズ6で実装
    const navCard = document.createElement('div');
    navCard.className = 'nav-card';
    frag.appendChild(navCard);

    container.appendChild(frag);
  }

  // ── 進捗バー ──────────────────────────────────────────────────
  function initProgressBar() {
    const bar        = document.getElementById('progress-bar');
    let invertScroll = null;

    function update() {
      let ratio;
      if (isVertical) {
        const total = scroller.scrollWidth - scroller.clientWidth;
        if (total <= 0) { ratio = 0; }
        else {
          if (invertScroll === null) invertScroll = scroller.scrollLeft > 0;
          ratio = invertScroll
            ? 1 - scroller.scrollLeft / total        // Chrome/Edge
            : Math.abs(scroller.scrollLeft) / total; // Firefox
        }
      } else {
        const total = scroller.scrollHeight - scroller.clientHeight;
        ratio = total > 0 ? scroller.scrollTop / total : 0;
      }
      bar.style.width = `${Math.min(Math.max(ratio, 0), 1) * 100}%`;
    }

    scroller.addEventListener('scroll', update, { passive: true });
    requestAnimationFrame(update);
  }

  // ── ホイール → 横スクロール（縦書き・PC用）──────────────────
  function initWheelScroll() {
    scroller.addEventListener('wheel', e => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      scroller.scrollBy({ left: -e.deltaY, behavior: 'auto' });
    }, { passive: false });
  }

})();
