/* ============================================================
   CHAOS GLYPHS — Procedural audio (no external files).
   A tiny WebAudio synth for clicks, placements, hits, detonation.
   ============================================================ */
(function (root) {
  'use strict';

  let ctx = null;
  let master = null;
  let muted = false;
  let sfxVol = 0.9;            // multiplier applied to sample SFX + synth master
  let masterVol = 1.0;        // overall ceiling applied to BOTH music and SFX
  const SFX_MASTER_BASE = 0.5; // synth master gain at 100% sfx
  function sfxGain() { return SFX_MASTER_BASE * sfxVol * masterVol; }

  function ensure() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = sfxGain();
      master.connect(ctx.destination);
    } catch (e) { ctx = null; }
  }
  // Browsers require a user gesture to start audio.
  function resume() {
    ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume();
    primeSamples();   // bless the pooled <audio> one-shots (hover/click/…) on this gesture
    // if music was requested but autoplay was blocked, kick it off now
    ensureCurrentPlaying();
  }

  function tone(freq, dur, type, vol, opts) {
    ensure(); if (!ctx || muted) return;
    opts = opts || {};
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.glide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, opts.glide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  function noise(dur, vol, filterFreq) {
    ensure(); if (!ctx || muted) return;
    const t0 = ctx.currentTime;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterFreq || 1800;
    const g = ctx.createGain(); g.gain.value = vol || 0.3;
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0);
  }

  // ---- recorded one-shots (assets/*.mp3) ----
  // these play through plain <audio> so they work even when opened from file://.
  // Each returns true when it actually fired, so callers can fall back to the
  // procedural synth if a sample is missing or blocked.
  const SAMPLE_SRC = {
    hover:  'assets/hover.mp3',
    click:  'assets/click.mp3',
    place:  'assets/place-2.mp3',   // using place-2 for now
    recall: 'assets/recall.mp3',
    error:  'assets/error.mp3',
    reward: 'assets/claim.mp3',                  // reward / claim / confirm
    mapAppear: 'assets/node screen appear.mp3'   // paper/map unfurl
  };
  const SAMPLE_VOL = { hover: 0.4, click: 0.55, place: 0.6, recall: 0.55, error: 0.6, reward: 0.6, mapAppear: 0.7 };
  // How many reusable voices to keep per sample. A small ROUND-ROBIN POOL lets
  // rapid one-shots (like hover) overlap without ever creating new <audio>
  // elements on the fly — cloning a fresh element per hover eventually exhausts
  // the browser's media-decoder pool and the sound silently dies.
  const SAMPLE_POOL_SIZE = { hover: 6, click: 4, place: 4, recall: 3, error: 3, reward: 2, mapAppear: 1 };
  const samplePool = {};   // name -> [Audio, ...]
  const sampleIdx = {};    // name -> round-robin cursor
  (function preloadSamples() {
    if (typeof Audio === 'undefined') return;
    for (const k in SAMPLE_SRC) {
      const n = SAMPLE_POOL_SIZE[k] || 3;
      const arr = [];
      for (let i = 0; i < n; i++) {
        try {
          const a = new Audio(SAMPLE_SRC[k]);
          a.preload = 'auto';
          a.volume = (SAMPLE_VOL[k] != null ? SAMPLE_VOL[k] : 0.6) * 0.9;
          arr.push(a);
        } catch (e) { /* ignore */ }
      }
      samplePool[k] = arr;
      sampleIdx[k] = 0;
    }
  })();

  // Unlock the pooled <audio> elements on the first user gesture. A WebAudio
  // ctx.resume() alone does NOT bless plain <audio>, so without this the hover
  // sound stays mute until the player happens to click something. Playing each
  // voice muted during a real gesture grants it sticky autoplay permission.
  let samplesPrimed = false;
  function primeSamples() {
    if (samplesPrimed || typeof Audio === 'undefined') return;
    samplesPrimed = true;
    for (const k in samplePool) {
      samplePool[k].forEach(a => {
        try {
          a.muted = true;
          const p = a.play();
          const reset = () => { try { a.pause(); a.currentTime = 0; } catch (e) {} a.muted = false; };
          if (p && p.then) p.then(reset).catch(() => { a.muted = false; });
          else reset();
        } catch (e) { a.muted = false; }
      });
    }
  }

  function playSample(name) {
    if (muted) return false;
    const pool = samplePool[name];
    if (!pool || !pool.length) return false;
    // prefer a voice that's free; otherwise steal the oldest (round-robin) so a
    // burst of hovers can't pile up unbounded elements
    let a = null;
    for (let i = 0; i < pool.length; i++) {
      const cand = pool[(sampleIdx[name] + i) % pool.length];
      if (cand.paused || cand.ended) { a = cand; break; }
    }
    if (!a) a = pool[sampleIdx[name]];
    sampleIdx[name] = (sampleIdx[name] + 1) % pool.length;
    try {
      a.muted = false;
      a.volume = (SAMPLE_VOL[name] != null ? SAMPLE_VOL[name] : 0.6) * sfxVol * masterVol;
      try { a.currentTime = 0; } catch (e) { /* not seekable yet */ }
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
      return true;
    } catch (e) { return false; }
  }

  // ============================================================
  //  MUSIC — looped background tracks with industry-standard
  //  fade-in / fade-out and crossfades.
  //
  //  Looping is hand-rolled: ~10s before a track ends we start a
  //  fresh copy of the SAME track and equal-power crossfade the tail
  //  into the head, so the loop seam is inaudible (instead of the hard
  //  cut a native loop can leave). Each track is a "voice"; two voices
  //  of one track briefly overlap during the loop crossfade.
  // ============================================================
  const MUSIC_SRC = {
    node: 'assets/node screen.mp3',
    battle: 'assets/normal battle.mp3',
    elite: 'assets/elite battle.mp3',
    boss: 'assets/Floor Boss.mp3'
  };
  const FADE_MS = 900;          // gentle fade-in / track-to-track crossfade
  const LOOP_XFADE_MS = 10000;  // default: crossfade the loop 10s before the end
  // per-track loop-seam crossfade length. The normal battle theme loops on itself
  // constantly, so a long 10s tail-into-head overlap muddies it — keep it tight (~3s).
  const LOOP_XFADE_BY_TRACK = { battle: 3000 };
  function loopXfadeFor(name) { return LOOP_XFADE_BY_TRACK[name] || LOOP_XFADE_MS; }
  // tracks that should REMEMBER their playhead and resume where they left off
  // (the ambient node bed + the normal battle theme, both heard constantly), vs.
  // tracks that restart fresh each time for impact (the elite/boss theme)
  const MUSIC_RESUME = { node: true, battle: true };
  let musicGain = 0.42;         // target headroom so SFX always read over the bed
  let currentTrack = null;      // the track we *want* playing (desired state)
  let voices = [];              // live audio voices: { name, el, _dying, _looped }
  const trackPos = {};          // remembered playhead per resumable track (seconds)

  function nowMs() { return (root.performance || Date).now(); }
  function targetVol() { return muted ? 0 : musicGain * masterVol; }

  // ramp an element's volume; `eq` uses an equal-power curve (no mid-fade dip)
  function fadeEl(el, target, ms, opts) {
    if (!el) return;
    opts = opts || {};
    if (el._fadeRAF) cancelAnimationFrame(el._fadeRAF);
    const from = el.volume;
    const t0 = nowMs();
    const dur = Math.max(1, ms);
    function curve(t) {
      if (!opts.eq) return from + (target - from) * t;
      return (target >= from)
        ? from + (target - from) * Math.sin(t * Math.PI / 2)
        : target + (from - target) * Math.cos(t * Math.PI / 2);
    }
    function step() {
      const t = Math.min(1, (nowMs() - t0) / dur);
      el.volume = Math.max(0, Math.min(1, curve(t)));
      if (t < 1) { el._fadeRAF = requestAnimationFrame(step); }
      else { el._fadeRAF = null; if (opts.onDone) opts.onDone(); }
    }
    el._fadeRAF = requestAnimationFrame(step);
  }

  // start a fresh voice of `name`, fading in over `ms`. `atStart` forces the
  // playhead to 0 (used by the loop crossfade, whose loop point is the top of
  // the track); otherwise a resumable track picks up where it left off.
  function spawnVoice(name, ms, atStart) {
    if (!MUSIC_SRC[name] || typeof Audio === 'undefined') return null;
    let el;
    try { el = new Audio(MUSIC_SRC[name]); } catch (e) { return null; }
    el.loop = false;            // the loop is hand-rolled via crossfade
    el.preload = 'auto';
    el.volume = 0;
    const voice = { name: name, el: el, _dying: false, _looped: false };
    voices.push(voice);
    // resume from the remembered playhead so the player doesn't keep hearing
    // the song's intro every time they return from a battle
    const seekTo = (!atStart && trackPos[name]) ? trackPos[name] : 0;
    if (seekTo > 0) {
      const applySeek = function () { try { if (el.duration && seekTo < el.duration) el.currentTime = seekTo; } catch (e) {} };
      if (el.readyState >= 1) applySeek();
      else el.addEventListener('loadedmetadata', applySeek, { once: true });
    }
    el.addEventListener('timeupdate', () => loopWatch(voice));
    // Background tabs throttle timeupdate + pause requestAnimationFrame, so the
    // hand-rolled loop crossfade can be missed and the track just ENDS. This is
    // the safety net: if a live track ends un-looped, respawn it from the top.
    el.addEventListener('ended', () => {
      const i = voices.indexOf(voice); if (i !== -1) voices.splice(i, 1);
      if (!voice._dying && voice.name === currentTrack &&
          !voices.some(v => v.name === currentTrack && !v._dying)) {
        spawnVoice(currentTrack, 300, true);
      }
    });
    const p = el.play();
    if (p && p.catch) p.catch(() => {});   // blocked until gesture; resume() retries
    fadeEl(el, targetVol(), ms == null ? FADE_MS : ms, { eq: true });
    return voice;
  }

  // fade a voice out and dispose of it
  function killVoice(voice, ms) {
    if (!voice || voice._dying) return;
    voice._dying = true;
    fadeEl(voice.el, 0, ms == null ? FADE_MS : ms, { eq: true, onDone: function () {
      try { voice.el.pause(); } catch (e) {}
      const i = voices.indexOf(voice);
      if (i !== -1) voices.splice(i, 1);
    } });
  }

  // ~LOOP_XFADE_MS before a track ends, crossfade it back into a fresh copy
  function loopWatch(voice) {
    if (voice._looped || voice._dying) return;
    if (voice.name !== currentTrack) return;     // it's already on its way out
    const el = voice.el;
    const dur = el.duration;
    if (!dur || !isFinite(dur)) return;
    // never let the crossfade exceed half the track length
    const x = Math.min(loopXfadeFor(voice.name), Math.max(1000, (dur * 1000) / 2));
    const remain = (dur - el.currentTime) * 1000;
    if (remain <= x) {
      voice._looped = true;
      spawnVoice(voice.name, x, true);   // head fades in FROM THE TOP
      killVoice(voice, x);               // tail fades out
    }
  }

  // make sure the desired track has a live, playing voice (used by resume/unmute)
  function ensureCurrentPlaying() {
    if (!currentTrack) return;
    const live = voices.find(function (v) { return v.name === currentTrack && !v._dying; });
    if (!live) { spawnVoice(currentTrack, FADE_MS); return; }
    if (!muted) { const p = live.el.play(); if (p && p.catch) p.catch(() => {}); }
  }

  const Music = {
    // crossfade to a track (or null to fade everything out). Re-requesting the
    // current track is a no-op, so it plays continuously across related screens.
    to(name, opts) {
      opts = opts || {};
      name = name || null;
      const fade = opts.fade == null ? FADE_MS : opts.fade;
      if (name === currentTrack) { ensureCurrentPlaying(); return; }
      const prev = currentTrack;
      // remember the outgoing track's playhead (if it's a resumable one) so it
      // picks back up later instead of restarting from the intro
      if (prev && MUSIC_RESUME[prev]) {
        const prim = voices.find(function (v) { return v.name === prev && !v._dying; })
          || voices.find(function (v) { return v.name === prev; });
        if (prim) trackPos[prev] = prim.el.currentTime || 0;
      }
      currentTrack = name;
      voices.slice().forEach(function (v) { if (v.name !== name) killVoice(v, fade); });
      if (name) {
        const existing = voices.find(function (v) { return v.name === name && !v._dying; });
        if (existing) fadeEl(existing.el, targetVol(), fade, { eq: true });
        else spawnVoice(name, fade);
      }
    },
    stop(opts) { this.to(null, opts); },
    setVolume(v) {
      musicGain = Math.max(0, Math.min(1, v));
      if (!muted) voices.forEach(function (vo) { if (vo.name === currentTrack && !vo._dying) fadeEl(vo.el, targetVol(), 200); });
    }
  };

  const SFX = {
    hover() { if (!playSample('hover')) tone(880, 0.05, 'sine', 0.05); },
    click() { if (!playSample('click')) tone(420, 0.08, 'triangle', 0.18, { glide: 620 }); },
    place(i) { if (!playSample('place')) tone(300 + (i || 0) * 90, 0.12, 'square', 0.12, { glide: 520 + (i || 0) * 90 }); },
    recall() { if (!playSample('recall')) tone(600, 0.12, 'sine', 0.15, { glide: 300 }); },
    error() { if (!playSample('error')) tone(220, 0.18, 'square', 0.2, { glide: 110 }); },
    mapAppear() { if (!playSample('mapAppear')) { noise(0.5, 0.12, 3200); tone(300, 0.4, 'sine', 0.08, { glide: 520 }); } },
    fireRed(step) { tone(160 + step * 30, 0.18, 'sawtooth', 0.2, { glide: 90 }); noise(0.12, 0.18, 2200); },
    fireBlue(step) { tone(520 + step * 40, 0.2, 'sine', 0.18, { glide: 760 }); },
    fireGreen(step) { tone(440 + step * 40, 0.25, 'triangle', 0.16, { glide: 700 }); },
    firePurple(step) { tone(300, 0.25, 'sine', 0.16, { glide: 150 }); },
    hit() { noise(0.18, 0.4, 1400); tone(110, 0.16, 'sawtooth', 0.18, { glide: 60 }); },
    detonate() {
      tone(80, 0.5, 'sawtooth', 0.3, { glide: 40 });
      noise(0.4, 0.35, 900);
      tone(220, 0.4, 'square', 0.12, { glide: 60 });
    },
    // committing the chain — a rising forge "ignite", not a damage thud
    act() {
      tone(180, 0.3, 'sine', 0.16, { glide: 560 });
      tone(360, 0.24, 'triangle', 0.10, { glide: 760 });
      noise(0.28, 0.06, 3200);
    },
    enemyHit() { noise(0.2, 0.35, 1100); tone(90, 0.2, 'sawtooth', 0.2, { glide: 50 }); },
    victory() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.4, 'triangle', 0.2), i * 110)); },
    defeat() { [392, 330, 262, 196].forEach((f, i) => setTimeout(() => tone(f, 0.5, 'sine', 0.2, { glide: f * 0.7 }), i * 160)); },
    reward() { if (!playSample('reward')) [659, 988].forEach((f, i) => setTimeout(() => tone(f, 0.3, 'triangle', 0.18), i * 100)); },
    // a wishing stone plunking into the well — a soft watery plip that brightens as they stack
    wellDrop(i) {
      const f = 300 + (Math.min(i || 0, 10) * 26);
      tone(f, 0.14, 'sine', 0.17, { glide: f * 0.5 });
      tone(f * 2.3, 0.07, 'sine', 0.05);
      noise(0.07, 0.06, 2400);
    },
    // souls / coins — a warm treasure shimmer; richer the bigger the haul
    coins(n) {
      const v = Math.min(1, 0.55 + (n || 0) / 70);
      [0, 7, 12].forEach((s, i) => setTimeout(() => tone(880 * Math.pow(2, s / 12), 0.5, 'triangle', 0.15 * v), i * 70));
      tone(1760, 0.35, 'sine', 0.06 * v);
      noise(0.5, 0.11 * v, 6500);
    },
    // a single coin landing in the purse — bright metallic ping, climbs as they stack
    coinTick(i) {
      const f = 1500 * Math.pow(2, (Math.min(i || 0, 12) % 5) / 12);
      tone(f, 0.10, 'triangle', 0.13);
      tone(f * 1.5, 0.06, 'sine', 0.06);
      noise(0.04, 0.05, 9000);
    },
    death() { tone(200, 0.5, 'sawtooth', 0.25, { glide: 40 }); noise(0.4, 0.3, 700); },
    // alphabet combo — a bright bell that climbs a major scale with each link
    combo(step) {
      const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
      const semis = SCALE[Math.min(step, SCALE.length - 1)];
      const f = 523.25 * Math.pow(2, semis / 12);
      tone(f, 0.26, 'triangle', 0.22);
      tone(f * 2, 0.18, 'sine', 0.12);
      setTimeout(() => tone(f * 3, 0.14, 'sine', 0.07), 45);
      noise(0.1, 0.1, 5200);
    },
    // the satisfying capstone when a chain finishes long
    comboFinish(step) {
      [0, 4, 7, 12].forEach((s, i) => setTimeout(() =>
        tone(523.25 * Math.pow(2, (step + s) / 12), 0.4, 'triangle', 0.2), i * 60));
      noise(0.5, 0.22, 3200);
    }
  };

  // When a tab is backgrounded, rAF-driven fades freeze (a fade can be stranded
  // at volume 0) and the loop crossfade may be skipped. On return to the page,
  // re-assert the live voice's volume and make sure music is actually playing.
  function resyncMusic() {
    if (muted || !currentTrack) return;
    ensureCurrentPlaying();
    const live = voices.find(function (v) { return v.name === currentTrack && !v._dying; });
    if (live) {
      if (live.el._fadeRAF) { cancelAnimationFrame(live.el._fadeRAF); live.el._fadeRAF = null; }
      live.el.volume = targetVol();
      const p = live.el.play(); if (p && p.catch) p.catch(() => {});
    }
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', function () { if (!document.hidden) resyncMusic(); });
    if (root.addEventListener) { root.addEventListener('focus', resyncMusic); root.addEventListener('pageshow', resyncMusic); }
  }

  root.CG = root.CG || {};
  root.CG.Audio = {
    SFX, Music, resume,
    mute(v) {
      muted = v;
      // fade the whole bed down/up with the mute toggle instead of cutting it dead
      if (v) {
        voices.forEach(function (vo) { fadeEl(vo.el, 0, 250, { eq: true }); });
      } else {
        ensureCurrentPlaying();
        voices.forEach(function (vo) { if (vo.name === currentTrack && !vo._dying) fadeEl(vo.el, targetVol(), 300, { eq: true }); });
      }
    },
    isMuted() { return muted; },
    // ---- music volume (0..1) ----
    setMusicVolume(v) { Music.setVolume(v); },
    getMusicVolume() { return musicGain; },
    // ---- sfx volume (0..1): scales synth master + sampled one-shots ----
    setSfxVolume(v) {
      sfxVol = Math.max(0, Math.min(1, v));
      if (master) master.gain.value = sfxGain();
    },
    getSfxVolume() { return sfxVol; },
    // ---- master volume (0..1): overall ceiling on music AND sfx ----
    setMasterVolume(v) {
      masterVol = Math.max(0, Math.min(1, v));
      if (master) master.gain.value = sfxGain();
      if (!muted) voices.forEach(function (vo) { if (vo.name === currentTrack && !vo._dying) fadeEl(vo.el, targetVol(), 200); });
    },
    getMasterVolume() { return masterVol; },
    // every audio file the game ships, so the boot loader can prewarm them
    assetUrls() {
      const out = [];
      for (const k in SAMPLE_SRC) out.push(SAMPLE_SRC[k]);
      for (const k in MUSIC_SRC) out.push(MUSIC_SRC[k]);
      return out;
    }
  };

})(window);
