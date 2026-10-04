// 首頁輪播:自動切換、箭頭、圓點、滑動
(function () {
  var INTERVAL = 5000;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function init(root) {
    if (root.dataset.carouselInit) return;
    root.dataset.carouselInit = '1';

    var track = root.querySelector('.home-carousel-track');
    var slides = root.querySelectorAll('.home-carousel-slide');
    var dots = root.querySelectorAll('.home-carousel-dot');
    var viewport = root.querySelector('.home-carousel-viewport');
    var count = slides.length;
    if (!track || count < 2) return;

    var index = 0;
    var timer = null;

    function go(i) {
      index = (i + count) % count;
      track.style.transform = 'translateX(' + (-100 * index) + '%)';
      for (var d = 0; d < dots.length; d++) {
        dots[d].classList.toggle('is-active', d === index);
      }
      for (var s = 0; s < count; s++) {
        slides[s].setAttribute('aria-hidden', s === index ? 'false' : 'true');
      }
    }

    // 接続浮層展開、滑鼠停留、取得焦點時暫停
    function paused() {
      return root.matches(':hover') || root.contains(document.activeElement) ||
        !!root.querySelector('.gcard-conn.is-open');
    }

    function start() {
      if (reduceMotion) return;
      stop();
      timer = setInterval(function () {
        if (!document.hidden && !paused()) go(index + 1);
      }, INTERVAL);
    }

    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }

    root.querySelector('.home-carousel-prev').addEventListener('click', function () { go(index - 1); start(); });
    root.querySelector('.home-carousel-next').addEventListener('click', function () { go(index + 1); start(); });
    Array.prototype.forEach.call(dots, function (dot, i) {
      dot.addEventListener('click', function () { go(i); start(); });
    });

    viewport.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { go(index - 1); start(); }
      else if (e.key === 'ArrowRight') { go(index + 1); start(); }
    });

    // 觸控滑動
    var startX = 0, startY = 0, tracking = false;
    viewport.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
    }, { passive: true });
    viewport.addEventListener('touchend', function (e) {
      if (!tracking) return;
      tracking = false;
      var dx = e.changedTouches[0].clientX - startX;
      var dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
        go(dx < 0 ? index + 1 : index - 1);
        start();
      }
    }, { passive: true });

    go(0);
    start();
  }

  function initAll() {
    document.querySelectorAll('.home-carousel').forEach(init);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
})();
