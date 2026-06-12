/* ============================================================
   CHAOS GLYPHS — Bootstrap
   ============================================================ */
(function (root) {
  'use strict';

  // ---- asset manifest: every image + audio file the game references ----
  function assetManifest() {
    const imgs = [];
    const seen = {};
    const addImg = u => { if (u && !seen[u]) { seen[u] = 1; imgs.push(u); } };
    // static art (backdrops, logo, shared rune frame)
    [
      'assets/game logo.png',
      'assets/empty glyph.png',
      'assets/map backdrop.png',
      'assets/test battle backdrop.png',
      'assets/Base Rune.png',
      'assets/Happy Devil.png',
      'assets/Impatient Devil.png',
      'assets/Angry Devil.png',
      'assets/Frustrated Devil.png',
      'assets/Devil Finger.png',
      // status / socket icons (rendered from battle.js, not the DATA harvest)
      'assets/Strength.png',
      'assets/Sheild.png',
      'assets/Thorns.png',
      'assets/Cursed.png',
      'assets/Banished.png',
      // Soulhunter forms (built dynamically in game.js, not in DATA)
      'assets/Soulhunter I.png',
      'assets/Soulhunter II.png',
      'assets/Soulhunter III.png',
      // bespoke UI button art
      'assets/Back Button.png',
      'assets/Descend Button.png',
      'assets/Character Button.png',
      'assets/Options Gear Button.png',
      'assets/Act Button.png',
      'assets/Skip Button.png',
      // illustrated map node medallions
      'assets/Battle Node.png',
      'assets/Elite Node.png',
      'assets/Event Node.png',
      'assets/Cache Node.png',
      'assets/Soulstone Node.png',
      'assets/Floor Boss Node.png',
      'assets/Soulhunter Node.png',
      'assets/Bazaar Node.png',
      'assets/Rest Node.png',
      // combat: deck/discard piles + soulstone slot & stone
      'assets/Deck Icon.png',
      'assets/Discard Icon.png',
      'assets/Soulstone Slot.png',
      'assets/Soulstone Stone.png',
      // combo letter emblems (rendered via CSS background on glyph chips)
      'assets/A Combo Emblem.png',
      'assets/B Combo Emblem.png',
      'assets/C Combo Emblem.png',
      'assets/Wild Combo Emblem.png',
      // Lost Woods hub backdrop + POI structures (outside the DATA harvest)
      'assets/Progress Background.jpg',
      'assets/Star Charts.png',
      'assets/Gravemarkers.png',
      'assets/Monster Library.png',
      'assets/Enchanted Well.png',
      'assets/Stone Tablets.png'
    ].forEach(addImg);
    // every art reference declared in the data, harvested generically so new
    // collections (blessings, items, souls, …) and new `img`/`selectBg` fields
    // are picked up automatically — nothing has to be reloaded mid-run.
    const D = (root.CG && root.CG.DATA) || {};
    try {
      Object.keys(D).forEach(coll => {
        const map = D[coll];
        if (!map || typeof map !== 'object') return;        // skip helpers like formatDesc
        Object.keys(map).forEach(k => {
          const entry = map[k];
          if (entry && typeof entry === 'object') { addImg(entry.img); addImg(entry.selectBg); }
        });
      });
    } catch (e) {}
    // evolution form portraits live two levels deeper than the generic harvest
    // reaches, so gather them explicitly (a not-yet-added PNG simply errors out
    // during preload and is skipped — it never stalls the boot)
    try {
      const M = D.MONSTERS || {};
      Object.keys(M).forEach(id => {
        const ev = M[id] && M[id].evolution;
        if (!ev) return;
        (ev.tier1 || []).forEach(f => addImg(f && f.img));
        Object.keys(ev.tier2 || {}).forEach(key => (ev.tier2[key] || []).forEach(f => addImg(f && f.img)));
      });
    } catch (e) {}

    let audio = [];
    try { if (root.CG.Audio && root.CG.Audio.assetUrls) audio = root.CG.Audio.assetUrls(); } catch (e) {}
    return { images: imgs, audio: audio };
  }

  function loadImage(url) {
    return new Promise(resolve => {
      const img = new Image();
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      img.onload = finish;
      img.onerror = finish;     // a missing asset must never stall the boot
      img.src = url;
      if (img.complete) finish();
    });
  }

  // Audio buffering can be flaky (canplaythrough may never fire for big files),
  // so resolve on the first "enough to start" signal OR a generous timeout.
  function loadAudio(url) {
    return new Promise(resolve => {
      let done = false;
      const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
      const timer = setTimeout(finish, 9000);
      let a;
      try { a = new Audio(); } catch (e) { return finish(); }
      a.preload = 'auto';
      a.addEventListener('canplaythrough', finish, { once: true });
      a.addEventListener('loadeddata', finish, { once: true });
      a.addEventListener('error', finish, { once: true });
      try { a.src = url; a.load(); } catch (e) { finish(); }
    });
  }

  function setProgress(done, total, label) {
    const fill = document.getElementById('loading-fill');
    const pct = document.getElementById('loading-pct');
    const status = document.getElementById('loading-status');
    const p = total ? Math.round((done / total) * 100) : 100;
    if (fill) fill.style.width = p + '%';
    if (pct) pct.textContent = p + '%';
    if (status && label) status.textContent = label;
  }

  function preloadAssets() {
    const man = assetManifest();
    const tasks = man.images.map(u => ({ url: u, load: loadImage }))
      .concat(man.audio.map(u => ({ url: u, load: loadAudio })));
    const total = tasks.length;
    if (!total) { setProgress(1, 1); return Promise.resolve(); }

    let done = 0;
    setProgress(0, total, 'Stoking the forge…');
    // hard ceiling so the player is never stranded on the loader
    const safety = new Promise(res => setTimeout(res, 15000));

    const all = Promise.all(tasks.map(t => t.load(t.url).then(() => {
      done++;
      setProgress(done, total, done >= total ? 'Igniting the runes…' : 'Forging glyphs…');
    })));

    return Promise.race([all, safety]).then(() => setProgress(total, total, 'Igniting the runes…'));
  }

  function revealGame() {
    const ls = document.getElementById('loading-screen');
    root.CG.Game.show('screen-home');
    if (ls) {
      ls.classList.add('loading-done');
      setTimeout(() => { if (ls.parentNode) ls.parentNode.removeChild(ls); }, 700);
    }
  }

  function boot() {
    root.CG.Scale.fit();
    root.CG.Game.init();
    root.CG.Battle.init();
    // keep the loader up until art + audio are warm, then unveil the menu
    preloadAssets().then(revealGame).catch(revealGame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
