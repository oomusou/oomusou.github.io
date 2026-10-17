// 手機單欄時,小卡往上捲動會層層堆疊 (仿 Samsung 瀏覽器的分頁切換畫面)
// 卡片頂端越過畫面上方的堆疊線後,逐漸往上壓縮、縮小,疊在 header 下方
(function () {
  var ZONE = 0.6;    // 堆疊線:視窗高度的比例,卡片頂端超過此線開始堆疊
  var GAP = 8;       // 堆疊頂端與 header 的距離
  var EASE = 0.45;   // 剛進入堆疊時快速壓縮的部分 (佔堆疊高度的比例)
  var STRIP = 64;    // 深處每張卡片露出的高度 (px),可看到完整的單字;不受卡片高度影響
  var SCALE = 0.12;  // 到達頂端時縮小的比例
  var FADE = 30;     // 接近頂端最後幾 px 淡出
  var STEPS = 40;    // 捲動動畫的關鍵影格數
  var BUFFER = 3;    // 畫面上下幾個視窗高度內的卡片才建立動畫
  var SNAP = 120;    // 滑動停在卡片上:卡片頂端越過堆疊線這麼多 px 時停下,整張卡片剛好完整露出
  var SWIPE = 3;     // 一次長滑動最多捲過幾張卡片

  var mq = window.matchMedia('(max-width: 599px)');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  // 支援 ScrollTimeline 時交給瀏覽器的合成執行緒,跟捲動同步更新;
  // 否則手機捲動時 JS 會慢一個 frame 才更新 transform,卡片會抖動
  var compositor = supportsRange();
  var timeline = null;
  var grids = [];
  var ticking = false;
  var syncing = false;
  var snapBox = null;
  var settling = null;

  // 確認瀏覽器支援 ScrollTimeline 並能以 px 指定動畫的捲動範圍
  function supportsRange() {
    if (typeof window.ScrollTimeline !== 'function') return false;
    try {
      var a = document.documentElement.animate({ opacity: [1, 1] }, {
        timeline: new ScrollTimeline({ source: document.scrollingElement }),
        rangeStart: '100px'
      });
      var ok = a.rangeStart && String(a.rangeStart.offset) === '100px';
      a.cancel();
      return ok;
    } catch (e) {
      return false;
    }
  }

  function reset(card) {
    if (card._stack) {
      card._stack.cancel();
      card._stack = null;
    }
    card.style.transform = '';
    card.style.opacity = '';
    card.style.visibility = '';
    card.style.willChange = '';
  }

  // 每次滑動停在下一張卡片的捲動位置。卡片本身有 transform,瀏覽器會以變形後的位置計算停止點,
  // 所以另外在頁面上放不會變形的標記當作停止點
  function placeSnaps(tops) {
    if (!snapBox) {
      snapBox = document.createElement('div');
      snapBox.className = 'card-stack-snaps';
      snapBox.setAttribute('aria-hidden', 'true');
      document.body.appendChild(snapBox);
    }
    var origin = snapBox.getBoundingClientRect().top + window.scrollY;
    var key = tops.map(function (t) { return Math.max(t - origin, 0).toFixed(0); });
    if (snapBox._key === key.join()) return;
    snapBox._key = key.join();
    while (snapBox.children.length > key.length) snapBox.removeChild(snapBox.lastChild);
    while (snapBox.children.length < key.length) snapBox.appendChild(document.createElement('div'));
    key.forEach(function (t, i) { snapBox.children[i].style.top = t + 'px'; });
    snapBox._origin = origin;
    snapBox._tops = key.map(Number);
    limitSwipe();
  }

  // 每個停止點都可以停,但只有目前卡片前後第 SWIPE 張的停止點一定要停 (scroll-snap-stop: always),
  // 長滑動最多捲過 SWIPE 張;捲動停下後再依新的位置重設
  function limitSwipe() {
    settling = null;
    var marks = snapBox && snapBox.children;
    if (!marks || !marks.length) return;
    var y = window.scrollY - snapBox._origin;
    var tops = snapBox._tops;
    var near = 0;
    for (var i = 1; i < tops.length; i++) {
      if (Math.abs(tops[i] - y) < Math.abs(tops[near] - y)) near = i;
    }
    for (var j = 0; j < marks.length; j++) {
      marks[j].classList.toggle('is-stop', Math.abs(j - near) === SWIPE);
    }
  }

  // 不支援 scrollend 的瀏覽器:捲動停止一段時間後視為停下
  function scrollIdle() {
    clearTimeout(settling);
    settling = setTimeout(limitSwipe, 150);
  }

  // 堆疊參數:堆疊線、堆疊高度、斜率
  function measure(cards) {
    var header = document.querySelector('header');
    var top = (header ? header.getBoundingClientRect().bottom : 0) + GAP;
    var zone = Math.max(window.innerHeight * ZONE, top + 1);
    var range = zone - top;
    // 依卡片平均間距換算斜率,讓單字、会話等較矮的卡片也露出相同高度
    var last = cards[cards.length - 1].offsetTop;
    var pitch = cards.length > 1 ? (last - cards[0].offsetTop) / (cards.length - 1) : cards[0].offsetHeight;
    var slope = Math.min(STRIP / Math.max(pitch, 1), 0.5);
    return { zone: zone, range: range, slope: slope, ease: range * EASE, last: last };
  }

  // 卡片越過堆疊線 d px 時往上移動的量:先快速壓縮,之後以固定斜率緩慢上移;
  // 起點斜率為 1,進入堆疊時不會突然變速
  function lift(p, d) {
    return Math.min(p.ease * (1 - Math.exp(-d * (1 - p.slope) / p.ease)) + p.slope * d, p.range);
  }

  function frame(p, d) {
    var f = lift(p, d);
    return {
      transform: 'translateY(' + (d - f).toFixed(1) + 'px) scale(' + (1 - SCALE * f / p.range).toFixed(4) + ')',
      opacity: f > p.range - FADE ? Math.max(0, (p.range - f) / FADE).toFixed(3) : '1'
    };
  }

  // 到達頂端 (完全淡出) 時越過堆疊線的距離
  function depth(p) {
    var lo = 0, hi = p.range / p.slope;
    for (var i = 0; i < 40; i++) {
      var mid = (lo + hi) / 2;
      if (lift(p, mid) >= p.range) hi = mid; else lo = mid;
    }
    return hi;
  }

  // 卡片停在動畫的某個位置 (不建立動畫);完全淡出時隱藏,不需要繪製
  function settle(card, k) {
    card.style.transform = k.transform;
    card.style.opacity = k.opacity === '1' ? '' : k.opacity;
    card.style.visibility = k.opacity === '0.000' ? 'hidden' : '';
  }

  // 合成執行緒版:記下每張卡片開始、結束堆疊的捲動位置,動畫由 sync() 依捲動位置建立
  function build() {
    ticking = false;
    var active = mq.matches && !reduceMotion.matches;
    document.documentElement.classList.toggle('is-stack-snap', active);
    var tops = [];

    grids.forEach(function (grid) {
      grid.classList.toggle('is-stack', active);
      var cards = grid.querySelectorAll(':scope > .post-entry');
      Array.prototype.forEach.call(cards, function (card) {
        reset(card);
        card._range = null;
      });
      if (!active || !cards.length) return;

      var p = measure(cards);
      var full = depth(p);
      // 先取得版面位置再讀 scrollY:版面改變時瀏覽器可能重新對齊停止點而改變捲動位置
      var gridTop = grid.getBoundingClientRect().top + window.scrollY;

      Array.prototype.forEach.call(cards, function (card) {
        tops.push(gridTop + card.offsetTop - p.zone + SNAP);
        // 最後一張也越過堆疊線時,整疊跟著往上捲走,不蓋住下方內容
        var end = Math.min(full, p.last - card.offsetTop);
        if (end <= 0) return;
        // 卡片頂端到達堆疊線時的捲動位置
        card._range = { p: p, start: gridTop + card.offsetTop - p.zone, end: end };
      });
    });
    placeSnaps(tops);
    sync();
  }

  function animate(card) {
    var r = card._range;
    var frames = [];
    for (var i = 0; i <= STEPS; i++) {
      // 剛進入堆疊時曲線變化大,關鍵影格取密一點
      var t = Math.pow(i / STEPS, 2);
      var k = frame(r.p, r.end * t);
      k.offset = t;
      frames.push(k);
    }
    return card.animate(frames, {
      timeline: timeline,
      // 用字串指定捲動位置;Chrome 會忽略 CSS.px() 物件
      rangeStart: r.start.toFixed(1) + 'px',
      rangeEnd: (r.start + r.end).toFixed(1) + 'px',
      fill: 'both'
    });
  }

  // 只替畫面附近的卡片建立動畫:每個動畫都是一個合成圖層,
  // 數百張卡片同時建立會耗盡手機的 GPU 記憶體,快速捲動時畫面變黑
  function sync() {
    syncing = false;
    var y = window.scrollY;
    var buffer = window.innerHeight * BUFFER;

    grids.forEach(function (grid) {
      var cards = grid.querySelectorAll(':scope > .post-entry');
      Array.prototype.forEach.call(cards, function (card) {
        var r = card._range;
        if (!r) return;
        if (r.start > y + buffer) {
          // 還在下方,維持原本位置
          if (card._stack || card.style.transform) reset(card);
        } else if (r.start + r.end < y - buffer) {
          // 已經堆疊完畢,停在最後的樣子
          if (card._stack || !card.style.transform) {
            reset(card);
            settle(card, frame(r.p, r.end));
          }
        } else if (!card._stack) {
          reset(card);
          card._stack = animate(card);
        }
      });
    });
  }

  function scrolled() {
    if (!syncing) {
      syncing = true;
      requestAnimationFrame(sync);
    }
  }

  // 不支援 ScrollTimeline 時,捲動時用 JS 逐 frame 計算
  function update() {
    ticking = false;
    var active = mq.matches && !reduceMotion.matches;
    document.documentElement.classList.toggle('is-stack-snap', active);
    var tops = [];

    grids.forEach(function (grid) {
      grid.classList.toggle('is-stack', active);
      var cards = grid.querySelectorAll(':scope > .post-entry');
      if (!active) {
        Array.prototype.forEach.call(cards, reset);
        return;
      }
      if (!cards.length) return;

      var p = measure(cards);
      // offsetTop 不受 transform 影響,可取得卡片原本的位置
      var base = grid.getBoundingClientRect().top;
      var gridTop = base + window.scrollY;
      // 最後一張也越過堆疊線時,整疊跟著往上捲走,不蓋住下方內容
      var shift = Math.min(0, base + p.last - p.zone);

      Array.prototype.forEach.call(cards, function (card) {
        tops.push(gridTop + card.offsetTop - p.zone + SNAP);
        var d = p.zone + shift - (base + card.offsetTop);
        if (d <= 0) {
          reset(card);
          return;
        }
        var k = frame(p, d);
        settle(card, k);
        // 只有移動中的卡片提升為圖層
        card.style.willChange = card.style.visibility ? '' : 'transform';
      });
    });
    placeSnaps(tops);
  }

  function schedule() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(compositor ? build : update);
    }
  }

  function init() {
    grids = Array.prototype.slice.call(document.querySelectorAll('.post-grid--grid'));
    if (!grids.length) return;
    // 無限捲動載入新卡片時重新計算
    var observer = new MutationObserver(schedule);
    grids.forEach(function (grid) { observer.observe(grid, { childList: true }); });
    if (mq.addEventListener) {
      mq.addEventListener('change', schedule);
      reduceMotion.addEventListener('change', schedule);
    }
    if ('onscrollend' in window) {
      window.addEventListener('scrollend', limitSwipe);
    } else {
      window.addEventListener('scroll', scrollIdle, { passive: true });
    }

    if (compositor) {
      timeline = new ScrollTimeline({ source: document.scrollingElement, axis: 'block' });
      // 圖片、字型載入或旋轉畫面使卡片高度、位置改變時重新計算 (卡片上方的輪播變高也會讓卡片位置改變);
      // 不監聽 resize,避免手機網址列收合造成視窗高度改變時整疊跳動
      if (window.ResizeObserver) {
        new ResizeObserver(schedule).observe(document.body);
      }
      window.addEventListener('scroll', scrolled, { passive: true });
      build();
    } else {
      window.addEventListener('scroll', schedule, { passive: true });
      window.addEventListener('resize', schedule);
      update();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
