(() => {
  const status = document.getElementById('status');
  const script = document.createElement('script');
  script.src = 'https://unpkg.com/oh-my-live2d@0.19.3/dist/index.min.js';
  const fail = () => { status.textContent = '小伙伴暂时没能赶来，请收起后重试。'; };
  script.onerror = fail;
  script.onload = () => {
    try {
      OML2D.loadOml2d({
        models: [{
          path: '/live2d_models/Cirno/object_live2d_005_101.asset.model3.json',
          scale: 0.11,
          position: [0, 35],
          stageStyle: { width: 250, height: 370 },
          mobileScale: 0.11,
          mobilePosition: [0, 35],
          mobileStageStyle: { width: 250, height: 370 },
          motionPreloadStrategy: 'IDLE'
        }],
        dockedPosition: 'left',
        sayHello: false,
        mobileDisplay: true,
        menus: { disable: true },
        tips: { idleTips: { wordTheDay: false } },
        statusBar: { loadingMessage: '少女祈祷中…', loadSuccessMessage: '今天也要元气满满！', loadFailMessage: '加载失败，请收起后重试。' }
      });
      status.textContent = '';
    } catch (_) { fail(); }
  };
  document.head.append(script);
})();
