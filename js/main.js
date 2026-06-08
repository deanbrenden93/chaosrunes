/* ============================================================
   CHAOS GLYPHS — Bootstrap
   ============================================================ */
(function (root) {
  'use strict';
  function boot() {
    root.CG.Scale.fit();
    root.CG.Game.init();
    root.CG.Battle.init();
    root.CG.Game.show('screen-home');
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
