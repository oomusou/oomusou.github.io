// 手機單欄、摺疊機左側一欄時,小卡往上捲動會層層堆疊 (仿 Samsung 瀏覽器的分頁切換畫面)
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
  var SAMPLE = 20;   // 以前幾張卡片的平均間距換算斜率

  // 手機 (< 600px) 與摺疊機 (600–899px,右側顯示內容,見 split-view.js)
  var mq = window.matchMedia('(max-width: 899px)');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  // 支援 ScrollTimeline 時交給瀏覽器的合成執行緒,跟捲動同步更新;
  // 否則手機捲動時 JS 會慢一個 frame 才更新 transform,卡片會抖動
  var compositor = supportsRange();
  var timeline = null;
  var grids = [];
  var ticking = false;
  var syncing = false;
  var params = null;   // 堆疊參數,同一個視窗寬度只算一次
  var items = [];      // 會堆疊的卡片,依開始堆疊的捲動位置排序
  var running = [];    // 目前有動畫的卡片
  var reach = 0;       // 卡片開始到結束堆疊的最長捲動距離

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

  // 排序好的數列中第一個 >= x 的位置
  function firstAtLeast(list, x, at) {
    var lo = 0, hi = list.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if ((at ? at(list[mid]) : list[mid]) < x) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  // 堆疊參數:堆疊線、堆疊高度、斜率。同一個視窗寬度只算一次:
  // 手機網址列收合會改變視窗高度、無限捲動載入卡片會改變平均間距,
  // 每次重算會讓整疊卡片跳一下
  function measure(cards) {
    var n = Math.min(cards.length, SAMPLE);
    if (params && params.width === window.innerWidth && params.count >= n) return params;
    var header = document.querySelector('header');
    var top = (header ? header.getBoundingClientRect().bottom : 0) + GAP;
    var zone = Math.max(window.innerHeight * ZONE, top + 1);
    var range = zone - top;
    // 依卡片平均間距換算斜率,讓單字、会話等較矮的卡片也露出相同高度
    var pitch = n > 1 ? (cards[n - 1].offsetTop - cards[0].offsetTop) / (n - 1) : cards[0].offsetHeight;
    var slope = Math.min(STRIP / Math.max(pitch, 1), 0.5);
    params = { width: window.innerWidth, count: n, top: top, zone: zone, range: range, slope: slope, ease: range * EASE };
    return params;
  }

  // 卡片的堆疊線 (畫面上的位置)。卡片在頁面頂端時就已高於堆疊線 (手機不顯示輪播,第一張卡片緊接在
  // header 下方),照常計算會一開始就被推到堆疊線附近、上方留下空白;改以卡片原本的位置當作它的堆疊線,
  // 從頁面頂端開始堆疊。這種卡片往上收的空間較小,只收到堆疊頂端為止 (見 frame 的 cap)
  function line(p, natural) {
    return Math.min(p.zone, natural);
  }

  // 卡片越過堆疊線 d px 時往上移動的量:先快速壓縮,之後以固定斜率緩慢上移;
  // 起點斜率為 1,進入堆疊時不會突然變速
  function lift(p, d) {
    return Math.min(p.ease * (1 - Math.exp(-d * (1 - p.slope) / p.ease)) + p.slope * d, p.range);
  }

  // cap:卡片最多往上移動的距離 (堆疊線到堆疊頂端)。位置到頂端就停住,縮小、淡出仍照一般卡片的進度,
  // 第一張卡片因此會停在 header 下方慢慢縮小,被下一張蓋上,而不是直接捲進 header 後面
  function frame(p, d, cap) {
    var f = lift(p, d);
    return {
      transform: 'translateY(' + (d - Math.min(f, cap)).toFixed(1) + 'px) scale(' + (1 - SCALE * f / p.range).toFixed(4) + ')',
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

  // 合成執行緒版:記下每張卡片開始、結束堆疊的捲動位置,動畫由 sync() 依捲動位置建立。
  // 載入新卡片時只更新位置改變的卡片,不重設所有卡片
  function build() {
    ticking = false;
    var active = mq.matches && !reduceMotion.matches;
    items = [];

    grids.forEach(function (grid) {
      grid.classList.toggle('is-stack', active);
      var cards = grid.querySelectorAll(':scope > .post-entry');
      if (!active || !cards.length) {
        Array.prototype.forEach.call(cards, function (card) {
          if (card._stack) reset(card);
          card._range = null;
        });
        return;
      }

      var p = measure(cards);
      var full = depth(p);
      reach = full;
      var gridTop = grid.getBoundingClientRect().top + window.scrollY;
      var last = cards[cards.length - 1].offsetTop;

      Array.prototype.forEach.call(cards, function (card) {
        // 最後一張也越過堆疊線時,整疊跟著往上捲走,不蓋住下方內容
        var end = Math.min(full, last - card.offsetTop);
        var natural = gridTop + card.offsetTop;
        var at = line(p, natural);
        // 卡片頂端到達堆疊線時的捲動位置
        var start = natural - at;
        var cap = at - p.top;
        var r = card._range;
        if (end <= 0) {
          if (card._stack) reset(card);
          card._range = null;
          return;
        }
        if (!r || r.p !== p || Math.abs(r.start - start) > 0.5 || Math.abs(r.end - end) > 0.5 || Math.abs(r.cap - cap) > 0.5) {
          // 位置改變:取消舊動畫,由 sync() 重新建立
          if (card._stack) reset(card);
          card._range = { p: p, start: start, end: end, cap: cap };
        }
        items.push(card);
      });
    });
    items.sort(function (a, b) { return a._range.start - b._range.start; });
    sync();
  }

  function animate(card) {
    var r = card._range;
    var frames = [];
    for (var i = 0; i <= STEPS; i++) {
      // 剛進入堆疊時曲線變化大,關鍵影格取密一點
      var t = Math.pow(i / STEPS, 2);
      var k = frame(r.p, r.end * t, r.cap);
      k.offset = t;
      frames.push(k);
    }
    // 往上捲時卡片由小放大,Chrome 會為了清晰逐 frame 重新點陣化,手機 GPU 跟不上而抖動;
    // 標記 will-change 讓瀏覽器沿用既有的點陣,不重畫 (往下捲是縮小,本來就不會重畫)
    card.style.willChange = 'transform';
    return card.animate(frames, {
      timeline: timeline,
      // 用字串指定捲動位置;Chrome 會忽略 CSS.px() 物件
      rangeStart: r.start.toFixed(1) + 'px',
      rangeEnd: (r.start + r.end).toFixed(1) + 'px',
      fill: 'both'
    });
  }

  // 只替畫面附近的卡片建立動畫:每個動畫都是一個合成圖層,
  // 數百張卡片同時建立會耗盡手機的 GPU 記憶體,快速捲動時畫面變黑。
  // 其他卡片維持原本位置:上方的已捲出畫面,下方的還沒到,都看不到。
  // 以二分搜尋找出附近的卡片,載入再多卡片,每次捲動的工作量都一樣
  function sync() {
    syncing = false;
    var y = window.scrollY;
    var buffer = window.innerHeight * BUFFER;
    var near = [];
    var i = firstAtLeast(items, y - buffer - reach, function (card) { return card._range.start; });
    for (; i < items.length && items[i]._range.start <= y + buffer; i++) {
      var card = items[i];
      var r = card._range;
      if (r.start + r.end < y - buffer) continue;
      if (!card._stack) card._stack = animate(card);
      near.push(card);
    }
    running.forEach(function (card) {
      if (card._stack && near.indexOf(card) < 0) reset(card);
    });
    running = near;
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
      var shift = Math.min(0, base + cards[cards.length - 1].offsetTop - p.zone);

      Array.prototype.forEach.call(cards, function (card) {
        var at = line(p, gridTop + card.offsetTop);
        var d = at + shift - (base + card.offsetTop);
        if (d <= 0) {
          reset(card);
          return;
        }
        var k = frame(p, d, at - p.top);
        settle(card, k);
        // 只有移動中的卡片提升為圖層
        card.style.willChange = card.style.visibility ? '' : 'transform';
      });
    });
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
