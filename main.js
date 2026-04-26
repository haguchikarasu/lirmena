(function () {
  'use strict';

  const isVertical   = document.body.classList.contains('vertical');
  const isHorizontal = document.body.classList.contains('horizontal');

  if (!(isVertical || isHorizontal)) return;

  const loadingEl  = document.getElementById('loading');
  const storyBody  = document.getElementById('story-body');
  const titleTextEl = document.querySelector('.title-card__text');
  const scroller   = document.getElementById('scroll-container');

  // Chrome/Edge では scrollLeft が正値、Firefox では負値になる
  let invertScroll      = null;
  let restorationState  = { el: null, ratio: 0 };

  // イベントリスナーは一度だけ設定
  if (isVertical) initWheelScroll();
  initProgressBar();
  initResizeHandler();

  // 初回読み込み + ハッシュ変更で再読み込み
  loadContent();
  window.addEventListener('hashchange', loadContent);

  // ── コンテンツ読み込み ────────────────────────────────────────
  async function loadContent() {
    const hash  = location.hash.slice(1);
    const match = /^(\d{2})-(\d{2})$/.exec(hash);

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

      // スクロール位置を先頭にリセット（初回のみ invertScroll を確定）
      requestAnimationFrame(() => {
        scroller.scrollLeft = isVertical ? scroller.scrollWidth : 0;
        scroller.scrollTop  = 0;
        if (isVertical && invertScroll === null) {
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

  // ── レンダラー ────────────────────────────────────────────────
  // \n  → </p><p>（段落区切り、CSS で margin 調整可能）
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
      } else if (tok.type === 'tcy') {
        const span = document.createElement('span');
        span.className = 'tcy';
        span.textContent = tok.value;
        currentP.appendChild(span);
      } else if (tok.type === 'tag') {
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

  // ── スクロール比率の取得・設定 ────────────────────────────────
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

  // ── リサイズ時のスクロール位置保持（画面中央の要素基準）────────
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

  function initResizeHandler() {
    let timer = null;

    window.addEventListener('resize', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
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
      scroller.scrollBy({ left: -e.deltaY, behavior: 'auto' });
    }, { passive: false });
  }

})();
