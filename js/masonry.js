/* 首頁 masonry：每張卡片放進當下最短的一欄，短卡下方自動補位、不留空白。
   相容無限捲動（MutationObserver）與圖片延後載入（capture load）。 */
(function () {
  var grid = document.querySelector('.post-stream-container.post-grid');
  if (!grid) return;
  grid.classList.add('is-masonry');

  var GAP = 16; // 1rem

  function colCount() {
    var v = parseInt(getComputedStyle(grid).getPropertyValue('--cols'), 10);
    return (v && v > 0) ? v : 1;
  }

  function layout() {
    var items = grid.querySelectorAll(':scope > .post-entry');
    if (!items.length) { grid.style.height = ''; return; }
    var n = colCount();
    var cw = (grid.clientWidth - GAP * (n - 1)) / n;
    var colH = new Array(n).fill(0);

    // 先統一寬度，讓瀏覽器依內容算出各卡高度
    for (var i = 0; i < items.length; i++) items[i].style.width = cw + 'px';

    for (var j = 0; j < items.length; j++) {
      var it = items[j];
      var min = 0;
      for (var k = 1; k < n; k++) if (colH[k] < colH[min]) min = k;
      var x = min * (cw + GAP);
      var y = colH[min];
      it.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      colH[min] += it.offsetHeight + GAP;
    }
    grid.style.height = Math.max.apply(null, colH) + 'px';
  }

  var raf, timer;
  function schedule() {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(layout);
    // 後備：分頁在背景時 rAF 會暫停，用 timer 確保仍會重排
    clearTimeout(timer);
    timer = setTimeout(layout, 120);
  }

  // 初次、視窗改變、資源載入完成都重排
  window.addEventListener('resize', schedule);
  window.addEventListener('load', schedule);
  // 捕捉階段接住卡片內圖片（含延後載入 / 無限捲動新增）的 load
  grid.addEventListener('load', schedule, true);
  // 無限捲動把新卡 append 進來時重排
  new MutationObserver(schedule).observe(grid, { childList: true });
  // 回到前景時補排一次
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) schedule();
  });

  schedule();
})();
