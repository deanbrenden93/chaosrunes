/* ============================================================
   CHAOS GLYPHS — Uniform 16:9 stage scaling.
   The #stage is a fixed 1920x1080 reference. We scale it
   uniformly to fit the window and center it (letterbox).
   ============================================================ */
(function (root) {
  'use strict';

  const REF_W = 1920;
  const REF_H = 1080;
  let stage, scale = 1, offX = 0, offY = 0;

  function fit() {
    if (!stage) stage = document.getElementById('stage');
    if (!stage) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    scale = Math.min(w / REF_W, h / REF_H);
    offX = Math.round((w - REF_W * scale) / 2);
    offY = Math.round((h - REF_H * scale) / 2);
    // Letterbox via the INDEPENDENT translate/scale properties (not `transform`).
    // This frees the `transform` property for the screen-shake, so the shake can
    // be a pure compositor-thread animation (no CSS-var keyframes, no nesting) —
    // which fixes mobile tearing/black-boxes AND the zoom-to-top-left glitch.
    stage.style.translate = offX + 'px ' + offY + 'px';
    stage.style.scale = String(scale);
    // keep a base transform var around for any legacy consumers (harmless)
    stage.style.setProperty('--stage-tf', `translate(${offX}px, ${offY}px) scale(${scale})`);
  }

  // Convert a client (mouse/window) point into stage-space coordinates.
  function toStage(clientX, clientY) {
    return { x: (clientX - offX) / scale, y: (clientY - offY) / scale };
  }

  function getScale() { return scale; }

  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', fit);
  document.addEventListener('DOMContentLoaded', fit);
  fit();

  root.CG = root.CG || {};
  root.CG.Scale = { fit, toStage, getScale, REF_W, REF_H };

})(window);
