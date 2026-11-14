// 摺疊機 (原本兩欄的寬度):左邊一欄卡片 (維持 card-stack.js 的堆疊效果),
// 點選卡片時不跳頁,改在右側顯示文章內容;一開始顯示第一張卡片
(function () {
  var mq = window.matchMedia('(min-width: 600px) and (max-width: 899px)');
  var pane = document.querySelector('.split-detail');
  var frame = pane && pane.querySelector('.split-detail-frame');
  if (!frame) return;
  var selected = null;

  // 右側內容從 header 下方開始 (header 高度隨寬度改變)
  function place() {
    var header = document.querySelector('header');
    var top = header ? header.getBoundingClientRect().bottom : 0;
    document.documentElement.style.setProperty('--split-top', Math.round(top) + 'px');
  }

  function cardUrl(card, target) {
    var link = (target && target.closest('a[href]')) || card.querySelector('a[href]');
    return link ? link.getAttribute('href') : null;
  }

  function show(card, url) {
    if (!url) return;
    if (selected) selected.classList.remove('is-selected');
    selected = card;
    if (card) card.classList.add('is-selected');
    if (frame.getAttribute('data-url') !== url) {
      frame.setAttribute('data-url', url);
      frame.src = url;
    }
  }

  // 進入摺疊機寬度時才載入內容,手機與桌機不會多載入一頁
  function init() {
    if (!mq.matches) return;
    place();
    if (!frame.getAttribute('data-url')) {
      var first = document.querySelector('.post-grid--grid > .post-entry');
      if (first) show(first, cardUrl(first));
    }
  }

  // 用捕捉階段攔截,卡片圖片區塊的 onclick 也不會跳頁;
  // 句型卡的「接続」區塊由 footer 的處理展開公式 (已 preventDefault),這裡不處理
  document.addEventListener('click', function (e) {
    if (!mq.matches || e.defaultPrevented) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var card = e.target.closest('.post-grid--grid > .post-entry');
    if (!card) return;
    var url = cardUrl(card, e.target);
    if (!url) return;
    e.preventDefault();
    e.stopPropagation();
    show(card, url);
  }, true);

  if (mq.addEventListener) mq.addEventListener('change', init);
  window.addEventListener('resize', function () {
    if (mq.matches) place();
  });
  init();
})();
