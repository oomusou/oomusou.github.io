// 手機・摺疊機的內文頁:左右滑動像電子書一樣翻頁
// 翻頁的樣子 (與 style.css 的 page-flip-* 動畫相同):頁面以「右緣」為軸,左側朝自己翻起來,
// 同時整頁往左移;右緣一路移到畫面左緣時頁面變成側面看不見。
//   進度 p (0 ~ 1):translateX(-p * 寬) + 以右緣為軸 rotateY(p * 90deg),透視中心在畫面正中央
// - 由右往左滑 (往後翻):目前頁面 p 0 → 1 翻走,底下露出「次の記事」
// - 由左往右滑 (往回翻):「前の記事」p 1 → 0 翻回來,蓋住目前頁面
// - 拖曳中:用 iframe 先顯示前後兩篇 (第一次觸控時才載入),手指放開時就是真正的頁面
// - 放開後:在本頁翻完 (此時畫面上已經是前一篇/下一篇的 iframe) 再換頁;換頁時不再播動畫,
//   畫面直接換成內容相同的真正頁面 (head.html 的 pagereveal)
(function () {
  var mq = window.matchMedia('(max-width: 899px)');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var page = document.querySelector('.post-container');
  if (!page) return;

  var PERSPECTIVE = 2.5;    // 透視距離 = 畫面寬 × 2.5 (與 style.css 的 250vw 一致)

  var start = null;         // { x, y, t, canLeft, canRight }
  var mode = null;          // null: 尚未判斷 / 'flip' / 'ignore'
  var dir = null;           // 'next' / 'prev'
  var prog = 0;             // 翻頁進度 (0 ~ 1,往翻頁方向)
  var flipping = false;     // 已決定翻頁 (pageswap 用來分辨是不是滑動翻頁)
  var frames = {};          // { next: iframe, prev: iframe }

  function urlOf(d) {
    var a = document.querySelector(d === 'next' ? 'a.post-hnav-next' : 'a.post-hnav-prev');
    return a ? a.href : null;
  }

  // 手指按下的位置在橫向捲動區塊 (表格、程式碼) 內時,該區塊還能往哪邊捲
  function hScroll(el) {
    var r = { left: false, right: false };
    for (; el && el !== document.body; el = el.parentElement) {
      if (el.scrollWidth > el.clientWidth + 1) {
        var ox = getComputedStyle(el).overflowX;
        if (ox === 'auto' || ox === 'scroll') {
          if (el.scrollLeft > 0) r.left = true;
          if (el.scrollLeft + el.clientWidth < el.scrollWidth - 1) r.right = true;
        }
      }
    }
    return r;
  }

  // 頁面在進度 p 時的 transform (transform-origin 必須在畫面正中央)
  function flipTransform(p) {
    var w = window.innerWidth;
    var half = w / 2;
    p = Math.round(Math.min(Math.max(p, 0), 1) * 10000) / 10000; // 避免 1e-14 這種科學記號
    return 'perspective(' + (w * PERSPECTIVE) + 'px) translateX(' + (-p * w).toFixed(2) + 'px) ' +
      'translateX(' + half + 'px) rotateY(' + (p * 90).toFixed(2) + 'deg) translateX(' + (-half) + 'px)';
  }

  function pageBg() {
    var c = getComputedStyle(document.body).backgroundColor;
    if (!c || c === 'rgba(0, 0, 0, 0)' || c === 'transparent') c = getComputedStyle(document.documentElement).backgroundColor;
    return (!c || c === 'rgba(0, 0, 0, 0)' || c === 'transparent') ? '#f8f9fa' : c;
  }

  // 前後兩篇的 iframe:往後翻時墊在底下,往回翻時當成翻進來的那一頁
  function frameOf(d) {
    var url = urlOf(d);
    if (!url) return null;
    var f = frames[d];
    if (!f) {
      f = frames[d] = document.createElement('iframe');
      f.className = 'page-flip-frame page-flip-frame--' + d;
      f.setAttribute('aria-hidden', 'true');
      f.setAttribute('tabindex', '-1');
      f.style.backgroundColor = pageBg();
      f.src = url;
    }
    if (!f.parentNode) document.body.appendChild(f);
    return f;
  }

  function preload() {
    frameOf('next');
    frameOf('prev');
  }

  function begin() {
    var f = frameOf(dir);
    if (dir === 'next') {
      // .post-container 的 transform-origin 設在畫面正中央 (與整個畫面翻轉時一致)
      var r = page.getBoundingClientRect();
      page.style.transformOrigin = (window.innerWidth / 2 - r.left) + 'px ' + (window.innerHeight / 2 - r.top) + 'px';
      page.classList.add('is-flipping');
      if (f) f.classList.add('is-under');
    } else if (f) {
      f.classList.add('is-over');
    }
  }

  function apply(p) {
    prog = p;
    if (dir === 'next') {
      page.style.transform = p ? flipTransform(p) : '';
    } else if (frames.prev) {
      frames.prev.style.transform = flipTransform(1 - p);
    }
  }

  function reset() {
    page.classList.remove('is-flipping');
    page.style.transform = '';
    page.style.transformOrigin = '';
    ['next', 'prev'].forEach(function (d) {
      var f = frames[d];
      if (!f) return;
      f.classList.remove('is-under', 'is-over');
      f.style.transform = '';
    });
    prog = 0;
  }

  // 放開後以 rAF 轉到目標進度 (隨時知道目前進度,跳頁時新頁面才能從這裡接著翻)
  var anim = 0;
  function settle(to, ms, done) {
    cancelAnimationFrame(anim);
    var from = prog, t0 = null;
    function step(now) {
      if (t0 === null) t0 = now;
      var k = Math.min((now - t0) / ms, 1);
      var e = 1 - Math.pow(1 - k, 3); // easeOutCubic
      apply(from + (to - from) * e);
      if (k < 1) anim = requestAnimationFrame(step);
      else if (done) done();
    }
    anim = requestAnimationFrame(step);
  }

  // 在本頁翻完再換頁。不能在換頁瞬間把頁面轉回平面交給新頁接著翻,
  // 否則轉回平面的那一格會被畫出來,看起來像抖一下
  function go(url) {
    flipping = true;
    if (reduce.matches) { reset(); location.href = url; return; }
    settle(1, 260 * (1 - prog) + 60, function () { location.href = url; });
  }

  document.addEventListener('touchstart', function (e) {
    start = null;
    mode = null;
    if (!mq.matches || flipping || e.touches.length !== 1) return;
    var t = e.target;
    if (t.closest && t.closest('header, input, textarea, select, [contenteditable]')) return;
    if (!reduce.matches) preload();
    var p = e.touches[0];
    var s = hScroll(t);
    start = { x: p.clientX, y: p.clientY, t: e.timeStamp, canLeft: s.left, canRight: s.right };
  }, { passive: true });

  document.addEventListener('touchmove', function (e) {
    if (!start || mode === 'ignore') return;
    if (e.touches.length !== 1) { cancel(); return; }
    var p = e.touches[0];
    var dx = p.clientX - start.x;
    var dy = p.clientY - start.y;
    if (!mode) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      var d = dx < 0 ? 'next' : 'prev';
      // 只處理以水平為主的滑動;上下捲動、橫向捲動區塊還能捲的方向交給瀏覽器;
      // 沒有前一篇時往右滑不處理 (沒有下一篇時往左滑仍可翻一點點再彈回)
      var horizontal = Math.abs(dx) > Math.abs(dy) * 1.2;
      var scroller = d === 'next' ? start.canRight : start.canLeft;
      if (!horizontal || scroller || (d === 'prev' && !urlOf('prev'))) {
        mode = 'ignore';
        return;
      }
      mode = 'flip';
      cancelAnimationFrame(anim);
      reset();
      dir = d;
      begin();
    }
    e.preventDefault();
    // 手指移動畫面寬的 1.3 倍才翻完 (與影片中頁緣比手指慢一些的感覺相同)
    var q = Math.min(Math.max((dir === 'next' ? -dx : dx) / (window.innerWidth * 1.3), 0), 1);
    // 沒有下一篇時只能翻一點點,像拉不動的書頁
    apply(urlOf(dir) ? q : q * 0.12);
  }, { passive: false });

  function cancel() {
    if (mode === 'flip') settle(0, 220, reset);
    start = null;
    mode = null;
  }

  document.addEventListener('touchend', function (e) {
    if (!start || mode !== 'flip') { start = null; mode = null; return; }
    var p = e.changedTouches[0];
    var dist = (p.clientX - start.x) * (dir === 'next' ? -1 : 1); // 往翻頁方向為正
    var v = dist / Math.max(e.timeStamp - start.t, 1);            // px/ms
    var url = urlOf(dir);
    start = null;
    mode = null;
    if (url && (dist > window.innerWidth * 0.25 || (v > 0.5 && dist > 40))) {
      go(url);
    } else {
      settle(0, 220, reset);
    }
  }, { passive: true });

  document.addEventListener('touchcancel', cancel, { passive: true });

  // 跨頁 View Transition:只有滑動翻頁才使用,而且不播動畫 ── 舊畫面 (已翻完、顯示 iframe 裡的新頁) 與
  // 新頁面內容相同,直接換上去;其他換頁 (點連結、返回) 一律跳過 (head.html 的 pagereveal 讀取 sessionStorage)
  window.addEventListener('pageswap', function (e) {
    if (!e.viewTransition) return;
    e.viewTransition.ready.catch(function () {});
    if (!flipping) { e.viewTransition.skipTransition(); return; }
    try { sessionStorage.setItem('pageflip', '1'); } catch (err) {}
  });

  // 從別頁按「返回」回到這頁 (bfcache) 時,恢復原狀
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) { cancelAnimationFrame(anim); flipping = false; reset(); }
  });
})();
