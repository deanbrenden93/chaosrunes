/* ============================================================
   CHAOS GLYPHS — Run flow & meta screens
   State, navigation, start screen, branching map, reward,
   rest, collection, game-over. Battle lives in battle.js.
   ============================================================ */
(function (root) {
  'use strict';

  const DATA = root.CG.DATA;
  const { GLYPHS, BLESSINGS, POWER_BLESSINGS, SOUL_BLESSINGS, EVENT_BLESSINGS, MONSTERS, ENEMIES, ITEMS } = DATA;
  const SFX = root.CG.Audio.SFX;

  // neutral preview env for meta screens: no chain/strength, only run-wide buffs
  function emberBonusVal() {
    if (!State) return 0;
    const b = State.blessings;
    return (b.emberstorm ? 1 : 0) + (b.pyreheart ? 2 : 0);
  }
  // Cards are individuals: a pool entry can carry an instance suffix ("strike#i7").
  // baseOf strips it back to the glyph-definition key.
  function baseOf(id) { const i = id.indexOf('#'); return i < 0 ? id : id.slice(0, i); }
  function gdef(id) { return GLYPHS[baseOf(id)]; }
  // mint a unique instance id for a base glyph
  function mintInstance(baseId) { State.instSeq = (State.instSeq || 0) + 1; return baseId + '#i' + State.instSeq; }
  // ensure pool[index] is an addressable instance (so upgrades hit ONE copy); returns its id
  function ensureInstance(index) {
    const cur = State.pool[index];
    if (cur == null) return null;
    if (cur.indexOf('#') >= 0) return cur;     // already an instance
    const inst = mintInstance(cur);
    State.pool[index] = inst;
    return inst;
  }
  function empowerOf(id) {
    if (!State) return 0;
    const inst = (State.empower && State.empower[id]) || 0;
    const run = (State.runEmpower && State.runEmpower[baseOf(id)]) || 0;   // shared across every copy of the type
    return inst + run;
  }
  function comboUpOf(id) { return !!(State && State.comboUp && State.comboUp[id]); }
  // forge-applied Power on a specific instance (the run-wide Everflame ramp is excluded).
  // Power forging is capped at 1 per glyph.
  function forgePowerOf(id) { return (State && State.empower && State.empower[id]) || 0; }

  // Mobile-only: kick into fullscreen when the run begins. Must be called from a
  // user gesture (the Begin click). We aren't designing for mobile, but this at
  // least reclaims the browser chrome so the layout has room to breathe.
  function isMobileDevice() {
    try {
      const coarse = root.matchMedia && root.matchMedia('(pointer: coarse)').matches;
      const ua = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent || '');
      return !!(coarse || ua);
    } catch (e) { return false; }
  }
  function goFullscreenOnMobile() {
    if (!isMobileDevice()) return;
    const elx = document.documentElement;
    const req = elx.requestFullscreen || elx.webkitRequestFullscreen || elx.mozRequestFullScreen || elx.msRequestFullscreen;
    if (!req) return;
    try { const p = req.call(elx); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
  }
  function neutralDescEnv() { return { ember: emberBonusVal() }; }
  // run-accurate env for a specific glyph id (folds in permanent empower)
  function metaEnv(id) {
    const e = neutralDescEnv();
    if (id) { e.cloneEmpower = empowerOf(id); e.strUp = empowerOf(id); }
    const m = (State && (State.monsters[firstAlive()] || activeMonster())) || null;
    e.devoured = (m && m.devoured) || 0;
    return e;
  }
  // the A/B/C/Wild combo badge as an HTML string
  function letterChipHTML(gl) {
    if (!gl.letter) return '';
    const cls = gl.letter === 'wild' ? 'wild' : 'l-' + gl.letter;
    const sym = gl.letter === 'wild' ? '✦' : gl.letter;
    return '<div class="letter-chip ' + cls + '">' + sym + '</div>';
  }

  // universal hard cap on how many sockets any beast can ever hold
  const MAX_SOCKETS = 9;

  // ---- Run state (rebuilt each run) ----
  let State = null;
  let pendingMonsterPick = null;
  let pendingMode = 'classic';           // chosen on the Mode Select screen
  let pendingDescensionLevel = 0;        // Descension level to attempt (0 in Classic)
  let pendingVictory = false;    // FINAL boss cleared -> victory after the reward screen
  let pendingNextFloor = false;  // floor boss cleared -> climb to the next act after rewards

  // ---- The Spire is climbed in 3 floors (acts), each barred by its own boss.
  // Floors 1 and 2 roll one of three bosses; floor 3 is always the end-boss.
  const SPIRE_FLOORS = 3;
  // Descension: a 13-level meta-gauntlet. Each level is one full 3-floor run with
  // one more stacking modifier than the last. Level 13's final floor swaps in the
  // unique final-FINAL boss.
  const MAX_DESCENSION = 13;
  const FLOOR_BOSSES = {
    1: ['starveling'],
    2: ['gravetideColossus', 'cinderQueen', 'hollowShepherd'],
    3: ['chaosIncarnate']
  };
  // each boss brings its own court into the arena
  const BOSS_ESCORTS = {
    voidIdol: ['cinderling'],
    hollowChoir: ['hexweaver'],
    mawMother: ['cinderling'],
    gravetideColossus: ['gravewarden'],
    cinderQueen: ['cinderling', 'cinderling'],
    hollowShepherd: ['gravewarden'],
    chaosIncarnate: ['maledict', 'hexweaver'],
    starveling: [],   // the floor-1 boss fights alone — its three phases ARE the fight
    theUnmaking: []   // the Ultimate Form fights alone — only the Doom Clock matters
  };
  function pickFloorBoss(act) {
    // Descension's deepest level replaces the final-floor boss with the
    // unique final-FINAL horror.
    if (act >= SPIRE_FLOORS && descensionEffects().finalBoss && ENEMIES.theUnmaking) {
      return 'theUnmaking';
    }
    const pool = FLOOR_BOSSES[act] || FLOOR_BOSSES[1];
    return pool[Math.floor(Math.random() * pool.length)];
  }
  function currentBoss() {
    return (State && State.bossId && ENEMIES[State.bossId]) || ENEMIES.voidIdol;
  }

  // ---- Descension difficulty knobs (no-op outside a Descension run) ----
  function descensionLevel() {
    return (State && State.mode === 'descension') ? (State.descension || 0) : 0;
  }
  function descensionEffects() {
    return DATA.descensionStack(descensionLevel());
  }

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  // ---------------- Screen navigation ----------------
  // which looping track belongs to each screen. Related "between-run" screens
  // share the node track so it plays continuously; battle/start/end fade it out.
  const SCREEN_MUSIC = {
    'screen-map': 'node',
    'screen-reward': 'node',
    'screen-rest': 'node',
    'screen-event': 'node',
    'screen-shop': 'node',
    'screen-soulstone': 'node',
    'screen-blessing': 'node',
    'screen-collection': 'node',
    'screen-evolve': 'node',
    'screen-lostwoods': 'node',
    'screen-gravemarker': 'node',
    'screen-stonetable': 'node',
    'screen-glyphcodex': 'node',
    'screen-monsterbook': 'node',
    'screen-well': 'node'
  };
  // fight themes by node type (null = no dedicated track yet)
  function battleMusic(node) {
    if (node.type === 'elite' || node.type === 'shadow') return 'elite';
    if (node.type === 'boss') return 'boss';  // floor + final boss theme
    return 'battle';                          // normal battles & regular fights
  }
  let lastScreen = null;
  let collectionReturn = 'screen-map';   // where the Collection screen's Back returns to
  function show(screenId) {
    const prev = document.querySelector('.screen.is-active');
    // clear any stale fade-outs, then deactivate everything but the target
    document.querySelectorAll('.screen.screen-leaving').forEach(s => s.classList.remove('screen-leaving'));
    document.querySelectorAll('.screen').forEach(s => { if (s.id !== screenId) s.classList.remove('is-active'); });
    // fade the outgoing screen out (crossfade) instead of cutting it away
    if (prev && prev.id !== screenId) {
      prev.classList.add('screen-leaving');
      setTimeout(() => prev.classList.remove('screen-leaving'), 420);
    }
    $(screenId).classList.add('is-active');
    setHud(screenId);
    // the small options gear rides along on every screen except the main menu.
    // It sits in line with the Character button on the map (and is fine as-is on
    // beast/mode select); everywhere else it jumps to the top-right corner,
    // mirroring the usual top-left back button.
    const gear = $('btn-options-gear');
    if (gear) {
      gear.classList.toggle('hidden', screenId === 'screen-home');
      const gearInline = (screenId === 'screen-map' || screenId === 'screen-start' || screenId === 'screen-mode');
      gear.classList.toggle('gear-corner', !gearInline);
      // on the combat screen, keep the corner's horizontal spot but drop it down
      // to the map's height (just below the top toolbar)
      gear.classList.toggle('gear-combat', screenId === 'screen-battle');
    }
    // checkpoint the run whenever we settle on the map (between nodes)
    if (screenId === 'screen-map' && State) saveGame();
    if (root.CG.Audio && root.CG.Audio.Music) root.CG.Audio.Music.to(SCREEN_MUSIC[screenId] || null);
    // the node map "unfurls" like a scroll whenever you arrive from elsewhere
    // (but not when simply returning from the Collection overlay)
    if (screenId === 'screen-map' && lastScreen !== 'screen-map' && lastScreen !== 'screen-collection') {
      playMapUnfurl();
    }
    lastScreen = screenId;
  }

  // reveal the map as an unrolling parchment scroll: a wooden rod sweeps down
  // while the map is clip-revealed behind it, paired with the paper SFX.
  function playMapUnfurl() {
    const scr = $('screen-map');
    const ms = scr && scr.querySelector('.map-scroll');
    if (!scr || !ms) return;
    if (SFX.mapAppear) SFX.mapAppear();
    let layer = scr.querySelector('.unfurl-rod-layer');
    if (!layer) { layer = el('div', 'unfurl-rod-layer'); layer.innerHTML = '<div class="unfurl-rod-shadow"></div><div class="unfurl-rod"></div>'; scr.appendChild(layer); }
    // match the scroll viewport so the rod tracks exactly with the reveal edge
    layer.style.left = ms.offsetLeft + 'px';
    layer.style.top = ms.offsetTop + 'px';
    layer.style.width = ms.offsetWidth + 'px';
    layer.style.height = ms.offsetHeight + 'px';
    scr.classList.remove('unfurling'); void scr.offsetWidth; scr.classList.add('unfurling');
    setTimeout(() => scr.classList.remove('unfurling'), 1250);
  }

  // ============================================================
  // START SCREEN
  // ============================================================
  // the signature special socket each beast brings to the forge (icon + name + blurb)
  const SLOT_SIGNATURE = {
    empower:  { icon: '⊕', name: 'Empower', blurb: 'Bolsters the glyphs resolved just before & after it by +1.', color: '#ffe6a8' },
    devil:    { icon: '<img class="devil-emote" src="assets/Happy Devil.png" alt="">', name: 'Devil', blurb: 'Each turn it craves one of your glyphs and hides a boon. Feed it what it wants to claim the boon — the hungrier it gets, the better the prize.', color: '#ff8aa0' },
    hold:     { icon: '⏸', name: 'Hold', blurb: 'Keeps its glyph for next turn as a bonus card — no discard.', color: '#9fd6c0' },
    clone:    { icon: '⧉', name: 'Clone', blurb: 'Copies its glyph into your next hand, empowered +1.', color: '#aee0ff' },
    catalyst: { icon: '✦', name: 'Catalyst', blurb: 'Infuses the next glyph by color — damage, block, or heal.', color: 'var(--gold)' },
    repeat:   { icon: '×2', name: 'Repeat', blurb: 'The glyph placed here resolves twice.', color: '#c9a3ff' },
    combo:    { icon: '⛓', name: 'Combo', blurb: 'The glyph placed here doubles your running combo (a fresh chain starts at 2).', color: '#ffb347' }
  };
  // pull out a beast's distinctive (non-normal) socket type(s) for its card
  // (hybrid sockets store arrays — flatten them into unique types)
  function signatureSockets(m) {
    const seen = [];
    (m.slotTypes || []).forEach(t => {
      slotListOf(t).forEach(x => { if (seen.indexOf(x) === -1) seen.push(x); });
    });
    return seen;
  }

  // per-beast presentation flair for the bestiary: a roman numeral watermark
  // and an honest 1-3 skull challenge rating
  const BEAST_FLAIR = {
    troll:   { numeral: 'I',   challenge: 1, challengeWord: 'Forgiving' },
    ghoul:   { numeral: 'II',  challenge: 2, challengeWord: 'Tactical' },
    kitsune: { numeral: 'III', challenge: 3, challengeWord: 'Brutal' }
  };

  // ---- Choose Your Beast: a bestiary with one full-page spread per beast.
  // The open page IS the selection; arrows / tabs / ← → keys turn the pages.
  let beastIds = [];
  let beastIdx = 0;

  function buildStart() {
    beastIds = Object.keys(MONSTERS);
    beastIdx = 0;
    const prev = $('beast-prev'), next = $('beast-next');
    if (prev) prev.onclick = () => flipBeast(-1);
    if (next) next.onclick = () => flipBeast(1);
    buildBeastTabs();
    renderBeastPage(1);
  }

  function flipBeast(dir) {
    SFX.click();
    beastIdx = (beastIdx + dir + beastIds.length) % beastIds.length;
    renderBeastPage(dir);
  }

  // ---- Mode Select (New Game -> Classic / Descension) ----
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII'];
  function roman(n) { return ROMAN[n] || String(n); }
  function nextDescensionLevel() {
    return Math.max(1, Math.min(MAX_DESCENSION, (META.descension.cleared || 0) + 1));
  }
  function buildModeSelect() {
    const lvl = nextDescensionLevel();
    const cleared = META.descension.cleared || 0;
    const mastered = cleared >= MAX_DESCENSION;
    const sigil = $('mode-desc-sigil');
    if (sigil) sigil.textContent = roman(lvl);
    const depth = $('mode-desc-depth');
    if (depth) {
      depth.innerHTML = mastered
        ? 'Descent <b>' + roman(MAX_DESCENSION) + '</b> &middot; <span class="mode-mastered">All Depths Mastered</span>'
        : 'Descent <b>' + roman(lvl) + '</b> of ' + MAX_DESCENSION +
          (cleared > 0 ? ' &middot; ' + cleared + ' cleared' : ' &middot; the first plunge');
    }
    // ---- the 13-rung depth ladder: cleared / next / locked ----
    const track = $('mode-desc-track');
    if (track) {
      let html = '';
      for (let i = 1; i <= MAX_DESCENSION; i++) {
        const done = i <= cleared;
        const here = !mastered && i === lvl;
        const cls = 'mt-rung' + (done ? ' done' : '') + (here ? ' here' : '') + (i > lvl && !mastered ? ' locked' : '');
        html += '<span class="' + cls + '"><span class="mt-n">' + (done ? '✓' : i) + '</span></span>';
      }
      track.innerHTML = html;
    }
    // ---- the NEW curse this plunge adds, revealed front-and-centre ----
    const next = $('mode-desc-next');
    if (next) {
      const all = DATA.DESCENSION_MODS || [];
      const m = all[lvl - 1];
      if (mastered) {
        next.innerHTML = '<div class="mn-tag">Conquered</div>' +
          '<div class="mn-name">The Spire holds nothing deeper</div>' +
          '<div class="mn-desc">You have unmade all ' + MAX_DESCENSION + ' descents. Descend again to test your mastery.</div>';
      } else if (m) {
        next.innerHTML = '<div class="mn-tag">This plunge adds</div>' +
          '<div class="mn-name"><b>' + roman(m.level) + '</b> ' + m.name + '</div>' +
          '<div class="mn-desc">' + m.desc + '</div>';
      } else { next.innerHTML = ''; }
    }
    // ---- the full stack of curses already in effect ----
    const mods = $('mode-desc-mods');
    const active = DATA.descensionModsUpTo(lvl);
    if (mods) {
      mods.innerHTML = active.length
        ? active.map(m => '<span class="mode-mod' + (m.level === lvl ? ' mode-mod-new' : '') +
            '"><b>' + roman(m.level) + '</b> ' + m.name + '<em>' + m.desc + '</em></span>').join('')
        : '<span class="mode-mod mode-mod-none">No curses yet — the first plunge is the gentlest.</span>';
    }
    const count = $('mode-desc-count');
    if (count) count.textContent = 'Curses in Effect · ' + active.length;
    const stones = $('mode-stones-val');
    if (stones) stones.textContent = META.wishingStones || 0;
  }
  function chooseMode(mode) {
    pendingMode = mode === 'descension' ? 'descension' : 'classic';
    pendingDescensionLevel = pendingMode === 'descension' ? nextDescensionLevel() : 0;
    buildStart();
    show('screen-start');
  }

  function buildBeastTabs() {
    const tabs = $('beast-tabs');
    if (!tabs) return;
    tabs.innerHTML = '';
    beastIds.forEach((id, i) => {
      const m = MONSTERS[id];
      const t = el('button', 'beast-tab');
      t.style.setProperty('--beast', m.color);
      t.title = m.name;
      t.innerHTML = m.img ? '<img src="' + m.img + '" alt="' + m.name + '">' : '<span>' + m.emoji + '</span>';
      t.addEventListener('mouseenter', () => SFX.hover());
      t.addEventListener('click', () => {
        if (i === beastIdx) return;
        SFX.click();
        const dir = i > beastIdx ? 1 : -1;
        beastIdx = i;
        renderBeastPage(dir);
      });
      tabs.appendChild(t);
    });
  }

  function renderBeastPage(dir) {
    const m = MONSTERS[beastIds[beastIdx]];
    const flair = BEAST_FLAIR[m.id] || { numeral: '✦', challenge: 2, challengeWord: 'Tactical' };
    const page = $('beast-page');
    if (!page || !m) return;
    // re-arm the 3D page-turn stage for this incoming spread (see settle below)
    page.classList.remove('settled');
    page.style.setProperty('--beast', m.color);
    page.style.setProperty('--dir', dir >= 0 ? 1 : -1);

    // glanceable gauges: a vitality bar, the actual socket chain (special
    // slots show their icon), and a 3-skull challenge rating
    const maxHpAcross = Math.max.apply(null, Object.values(MONSTERS).map(x => x.maxHp));
    const hpPct = Math.round((m.maxHp / maxHpAcross) * 100);
    const pips = (m.slotTypes || []).map(t => {
      const list = slotListOf(t);
      if (!list.length) return '<span class="bc-pip">⬡</span>';
      const info = SLOT_INFO[list[0]];
      return '<span class="bc-pip special">' + (info ? info.icon : '◇') + '</span>';
    }).join('');
    const skulls = [0, 1, 2].map(i =>
      '<span class="bc-skull' + (i < flair.challenge ? ' lit' : '') + '">☠</span>').join('');

    // split "Stonehide: reduce all incoming damage…" into name + meaning
    // (the sliced half starts mid-sentence, so re-capitalize it)
    const pf = m.passiveText || '';
    const ci = pf.indexOf(':');
    const pName = ci > 0 ? pf.slice(0, ci).trim() : 'Passive';
    let pDesc = ci > 0 ? pf.slice(ci + 1).trim() : pf;
    pDesc = pDesc.charAt(0).toUpperCase() + pDesc.slice(1);

    // signature socket(s) — the beast's headline trick
    const sigHTML = signatureSockets(m).map(t => {
      const s = SLOT_SIGNATURE[t] || { icon: '◇', name: t, blurb: '', color: 'var(--gold)' };
      return `<div class="bc-feature bc-sig" style="--sig:${s.color}">
          <span class="bcf-badge">${s.icon}</span>
          <span class="bcf-text"><b>${s.name} Socket</b>${s.blurb}</span>
        </div>`;
    }).join('');

    // the opening deck, told in glyph-color runestones
    const dots = (m.deck || []).map(id =>
      '<span class="bc-dot" style="--c:var(--' + ((GLYPHS[id] && GLYPHS[id].color) || 'gold') + ')"></span>').join('');

    // some beasts ship a bespoke select-screen backdrop that stands in for the
    // floating sprite — applied to the panel, with the sprite hidden (but its
    // layout space preserved so nothing else shifts).
    const bgCls = m.selectBg ? ' has-select-bg' : '';
    const bgVar = m.selectBg ? ` style="background-image:url('${m.selectBg}')"` : '';
    // a fresh .bp-content node each turn — its entrance animation IS the page turn
    page.innerHTML = `
      <div class="bp-content${bgCls}"${bgVar}>
        <div class="bc-aura" aria-hidden="true"></div>
        <div class="bc-numeral" aria-hidden="true">${flair.numeral}</div>
        <div class="bp-art-col">
          ${m.img ? `<img class="bp-art" src="${m.img}" alt="">` : `<span class="bp-art bp-art-emoji">${m.emoji}</span>`}
          <div class="bc-role">${m.role}</div>
          <h3 class="bc-name">${m.name}</h3>
        </div>
        <div class="bp-info-col">
          <div class="bc-gauges">
            <div class="bc-gauge">
              <span class="bcg-label">Vitality</span>
              <span class="bcg-bar"><span class="bcg-fill" style="width:${hpPct}%"></span></span>
              <span class="bcg-val">${m.maxHp} HP</span>
            </div>
            <div class="bc-gauge">
              <span class="bcg-label">Sockets</span>
              <span class="bcg-pips">${pips}</span>
            </div>
            <div class="bc-gauge">
              <span class="bcg-label">Challenge</span>
              <span class="bcg-skulls">${skulls}</span>
              <span class="bcg-word">${flair.challengeWord}</span>
            </div>
          </div>
          <div class="bc-feature bc-passive">
            <span class="bcf-badge">✦</span>
            <span class="bcf-text"><b>${pName}</b>${pDesc}</span>
          </div>
          ${sigHTML}
          <p class="bc-tactic">${m.desc}</p>
          <div class="bc-deck">
            <span class="bcg-label">Opening deck</span>
            <span class="bc-dots">${dots}</span>
            <span class="bcg-val">${(m.deck || []).length} glyphs</span>
          </div>
        </div>
      </div>`;

    // Once the page-turn finishes, flatten the 3D stage so the resting panel is no
    // longer rasterized as a perspective texture — that GPU layer is what leaves the
    // dossier text looking blurry. A fresh turn re-arms it (see classList.remove above).
    const content = page.querySelector('.bp-content');
    if (content) content.addEventListener('animationend', () => page.classList.add('settled'), { once: true });

    // tab states + the open page is the live choice
    const tabs = $('beast-tabs');
    if (tabs) Array.from(tabs.children).forEach((t, i) => t.classList.toggle('active', i === beastIdx));
    pendingMonsterPick = m.id;
    const begin = $('btn-begin');
    begin.disabled = false;
    begin.classList.add('armed');
  }

  // ============================================================
  // RUN SETUP
  // ============================================================
  function makeMonster(id) {
    const b = MONSTERS[id];
    const m = {
      id: b.id, name: b.name, emoji: b.emoji, img: b.img || null, role: b.role, color: b.color,
      maxHp: b.maxHp, hp: b.maxHp, sockets: b.sockets, baseSockets: b.sockets,
      passive: b.passive, passiveVal: b.passiveVal, passiveText: b.passiveText,
      evolveName: b.evolveName || null,
      evolution: b.evolution || null,   // branching evolution tree (null = simple bump)
      evolveLevel: 0,                    // 0 = base, 1 = first evo, 2 = final form
      evoChoices: [],                    // form ids chosen at each tier, in order
      evoPassives: [],                   // stacked {id,name,text} from each evolution
      slotTypes: (b.slotTypes || []).slice(),
      runStrength: 0, runTurnShield: 0, runResilience: 0,   // permanent buffs gained from Devil slots / unlocks
      alive: true
    };
    reorderDevilsLast(m);   // no-op now (Devils may live on any socket); kept for callers
    return m;
  }

  // ---- per-run statistics (Character screen "This Run" + Gravemarker cards) ----
  function freshRunStats() {
    return {
      killsNormal: 0, killsElite: 0, killsBoss: 0,
      soulsGained: 0, itemsObtained: 0, itemsUsed: 0,
      bestCombo: 0, bestTurnDmg: 0, bestHit: 0
    };
  }
  function ensureRunStats() {
    if (!State) return null;
    if (!State.stats) State.stats = freshRunStats();
    return State.stats;
  }
  function runTotalKills(s) { s = s || {}; return (s.killsNormal || 0) + (s.killsElite || 0) + (s.killsBoss || 0); }
  // battle.js funnels every foe death here, bucketed by tier
  function recordKill(tier) {
    const s = ensureRunStats(); if (!s) return;
    if (tier === 'elite') s.killsElite = (s.killsElite || 0) + 1;
    else if (tier === 'floorboss' || tier === 'finalboss' || tier === 'boss') s.killsBoss = (s.killsBoss || 0) + 1;
    else s.killsNormal = (s.killsNormal || 0) + 1;
  }
  function recordSingleHit(dmg) { const s = ensureRunStats(); if (s && dmg > (s.bestHit || 0)) s.bestHit = dmg; }
  function recordTurnDamage(dmg) { const s = ensureRunStats(); if (s && dmg > (s.bestTurnDmg || 0)) s.bestTurnDmg = dmg; }
  function recordCombo(n) { const s = ensureRunStats(); if (s && n > (s.bestCombo || 0)) s.bestCombo = n; }
  function runBlessingCount() {
    if (!State || !State.blessings) return 0;
    return Object.keys(State.blessings).filter(k => State.blessings[k]).length;
  }
  // active run time, banked across saves so a closed-then-resumed run doesn't
  // count the offline gap; the live segment is excluded while the tab is hidden
  function bankRunTime() {
    if (!State) return;
    const now = Date.now();
    let d = now - (State.runClock || now);
    State.runClock = now;
    if (d < 0 || d > 12 * 60 * 60 * 1000) d = 0;   // ignore absurd gaps only (hidden time is excluded on visibility)
    State.playMs = (State.playMs || 0) + d;
  }
  function runElapsedMs() {
    if (!State) return 0;
    const base = State.playMs || 0;
    const hidden = (typeof document !== 'undefined' && document.hidden);
    const since = hidden ? 0 : Math.max(0, Date.now() - (State.runClock || State.startedAt || Date.now()));
    return base + since;
  }
  // dd:hh:mm:ss display (drops leading day field when zero for a tighter read)
  function formatDuration(ms, forceDays) {
    let s = Math.max(0, Math.floor((ms || 0) / 1000));
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    const pad = n => (n < 10 ? '0' + n : '' + n);
    if (d > 0 || forceDays) return pad(d) + ':' + pad(h) + ':' + pad(m) + ':' + pad(s);
    if (h > 0) return pad(h) + ':' + pad(m) + ':' + pad(s);
    return pad(m) + ':' + pad(s);
  }

  function startRun(monsterId, opts) {
    opts = opts || {};
    pendingVictory = false;
    pendingNextFloor = false;
    const mode = opts.mode === 'descension' ? 'descension' : 'classic';
    const descension = mode === 'descension'
      ? Math.max(1, Math.min(MAX_DESCENSION, opts.descension || 1)) : 0;
    State = {
      mode: mode,                // 'classic' | 'descension'
      descension: descension,    // Descension level being attempted (0 in Classic)
      monsters: [ makeMonster(monsterId) ],
      activeIndex: 0,
      pool: (MONSTERS[monsterId].deck || []).slice(),
      souls: 0,
      act: 1,                    // which Spire floor (act) we're climbing
      bossId: pickFloorBoss(1),  // the boss barring this floor
      blessings: {},
      empower: {},               // per-CARD +N power (keyed by instance id)
      runEmpower: {},            // per-TYPE +N power that ALL copies share (keyed by base id; e.g. Everflame)
      comboUp: {},               // per-CARD Combo-up upgrade (keyed by instance id)
      instSeq: 0,                // serial for minting unique card instance ids
      map: null,                 // generated below, once mode/descension are live
      pos: { floor: -1, idx: null },   // -1 = before the first floor
      cleared: 0,
      items: ['blood_phial'],    // carried consumables (top-HUD tray); start with one
      lastEvent: null,           // avoid repeating the same event back-to-back
      soulstones: 0,             // collected at Soulstone nodes; 5 evolves the beast
      soulhunterKills: 0,        // Soulhunter forms cleared this run (0 → next is A, etc.)
      feastKills: [],            // Ghoul Feast: foes slain this run (for Skinwalker trophies)
      feastBoons: [],            // Ghoul Feast: kill-boons waiting to manifest next encounter
      unlocks: Object.assign({}, META.unlocks),  // seeded from the meta-profile (granting is Pass 2)
      stats: freshRunStats(),    // live per-run tally (Character screen "This Run")
      startedAt: Date.now(),     // wall-clock the run began
      runClock: Date.now(),      // last point active run-time was banked
      playMs: 0                  // accumulated ACTIVE run time (offline gaps excluded)
    };
    root.CG.State = State;
    // Map composition can read Descension effects, so generate it AFTER State is live.
    State.map = genMap();
    // Descension "Frailty" and friends trim the beast's starting max HP.
    const hpMul = descensionEffects().playerHpMul || 1;
    if (hpMul !== 1) {
      State.monsters.forEach(m => {
        m.maxHp = Math.max(1, Math.round(m.maxHp * hpMul));
        m.hp = Math.min(m.hp, m.maxHp);
      });
    }
    // the run opens on the blessing draft — the start of the "story"
    buildBlessingDraft();
    show('screen-blessing');
  }

  function activeMonster() {
    return State.monsters[State.activeIndex];
  }
  function firstAlive() {
    return State.monsters.findIndex(m => m.alive && m.hp > 0);
  }

  // ============================================================
  // MAP GENERATION  (Spire-style branching)
  // ============================================================
  // 15 rows. Row 1 (floor 0) is the opening skirmish; row 15 (floor 14) is the
  // floor boss. The three regions referenced by the placement rules:
  //   lower  = rows 1-5   (floors 0-4)
  //   middle = rows 6-10  (floors 5-9)
  //   upper  = rows 11-15 (floors 10-14)
  const FLOORS = 15;

  function shuffleArr(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function genMap() {
    const floors = [];
    for (let f = 0; f < FLOORS; f++) {
      let count = f === 0 ? 3 : (f === FLOORS - 1 ? 1 : 2 + Math.floor(Math.random() * 3));
      const nodes = [];
      for (let i = 0; i < count; i++) {
        nodes.push({
          id: f + '-' + i, floor: f, idx: i,
          x: (i + 1) / (count + 1),
          type: 'battle',     // everything starts as a battle; specials are seeded below
          enemies: null,
          children: [], parents: [],
          visited: false
        });
      }
      floors.push(nodes);
    }
    // connect adjacent floors by proximity
    for (let f = 0; f < FLOORS - 1; f++) {
      const cur = floors[f], nxt = floors[f + 1];
      cur.forEach(node => {
        const sorted = nxt.slice().sort((a, b) => Math.abs(a.x - node.x) - Math.abs(b.x - node.x));
        const k = 1 + (Math.random() < 0.45 ? 1 : 0);
        for (let j = 0; j < Math.min(k, sorted.length); j++) {
          if (node.children.indexOf(sorted[j].id) === -1) {
            node.children.push(sorted[j].id);
            sorted[j].parents.push(node.id);
          }
        }
      });
      nxt.forEach(n => {
        if (n.parents.length === 0) {
          const sorted = cur.slice().sort((a, b) => Math.abs(a.x - n.x) - Math.abs(b.x - n.x));
          sorted[0].children.push(n.id);
          n.parents.push(sorted[0].id);
        }
      });
    }
    seedNodeTypes(floors);
    return { floors: floors };
  }

  // Constraint-driven placement of every special node type onto the skeleton.
  function seedNodeTypes(floors) {
    const act = (State && State.act) || 1;
    const LAST = FLOORS - 1;            // boss row
    const PREBOSS = FLOORS - 2;         // guaranteed rest row

    const floorHasType = (f, type) => f >= 0 && f < FLOORS && floors[f].some(n => n.type === type);
    const adjHasType = (f, type) => floorHasType(f - 1, type) || floorHasType(f + 1, type);
    // drop `type` onto an open (still-battle) slot of floor f; returns success
    const placeOn = (f, type) => {
      const open = floors[f].filter(n => n.type === 'battle');
      if (!open.length) return false;
      open[Math.floor(Math.random() * open.length)].type = type;
      return true;
    };
    // place `type` once somewhere in [lo,hi], honoring options
    const placeInRange = (lo, hi, type, opt) => {
      opt = opt || {};
      const order = shuffleArr(rangeFloors(lo, hi));
      for (const f of order) {
        if (f <= 0 || f >= LAST) continue;                 // never the intro or boss row
        if (opt.freshFloor && floors[f].some(n => n.type !== 'battle')) continue;
        if (opt.uniqueRow && floorHasType(f, type)) continue;   // one of this type per row
        if (opt.noAdjacent && adjHasType(f, type)) continue;
        if (opt.notRows && opt.notRows.indexOf(f) !== -1) continue;
        if (placeOn(f, type)) return f;
      }
      return -1;
    };

    // --- fixed rows ---
    floors[LAST][0].type = 'boss';
    // the entire last traversable row is a wall of rests — a guaranteed full
    // breather to mend and prepare before every floor boss
    floors[PREBOSS].forEach(n => { n.type = 'rest'; });

    // --- Soulhunter: the shadow elite, exactly one per floor (act). Sits in the
    // back half of the climb (middle/final third), never the opening rows — the
    // player must deliberately path toward the hunt. Falls back wider if the
    // narrower band can't host it.
    const shadowLo = Math.max(2, Math.floor(LAST / 3));
    if (placeInRange(shadowLo, LAST - 2, 'shadow', { freshFloor: true }) === -1) {
      placeInRange(2, LAST - 2, 'shadow', { freshFloor: true });
    }

    // --- Elites: 3-5 distinct rows, anywhere (Descension "Swarm" adds more) ---
    const dz = descensionEffects();
    const eliteRows = 3 + Math.floor(Math.random() * 3) + (dz.eliteBias || 0);   // 3,4,5 (+bias)
    let elitesPlaced = 0;
    for (const f of shuffleArr(rangeFloors(1, LAST - 1))) {
      if (elitesPlaced >= eliteRows) break;
      if (floorHasType(f, 'elite')) continue;
      if (placeOn(f, 'elite')) elitesPlaced++;
    }

    // --- Shops ---
    if (act === 1) {
      placeInRange(5, 9, 'shop', { noAdjacent: true });               // one in the middle
      placeInRange(10, LAST - 1, 'shop', { noAdjacent: true, notRows: [PREBOSS] }); // one in the upper
    } else {
      const nShops = 2 + Math.floor(Math.random() * 2);               // 2-3, never more than 3
      for (let s = 0; s < nShops; s++) placeInRange(1, LAST - 1, 'shop', { noAdjacent: true, notRows: [PREBOSS] });
    }

    // --- A second rest, allowed in the middle region only (Scarcity removes it) ---
    if (!dz.fewerRests && Math.random() < 0.75) placeInRange(5, 9, 'rest', { noAdjacent: true });

    // --- Soulstones: two per floor so evolution stays reachable ---
    placeInRange(2, 9, 'soulstone', {});
    placeInRange(8, LAST - 1, 'soulstone', { notRows: [PREBOSS] });

    // --- Events: the map's spice, and the antidote to long battle streaks.
    //     Each five-row block seeds two event rows, with a small chance of a
    //     third, so no vertical region is wall-to-wall combat. ---
    const blocks = [[1, 4], [5, 9], [10, LAST - 1]];
    for (const blk of blocks) {
      const want = 2 + (Math.random() < 0.35 ? 1 : 0);
      for (let e = 0; e < want; e++) placeInRange(blk[0], blk[1], 'event', { uniqueRow: true });
    }
    // --- A couple of treasure caches for texture ---
    placeInRange(2, LAST - 2, 'reward', { uniqueRow: true });
    placeInRange(2, LAST - 2, 'reward', { uniqueRow: true });

    // --- Pacing guarantee: no ROUTE may chain more than 3 plain battles ---
    breakBattleStreaks(floors);
  }

  // Row-level seeding spreads specials around, but a player only ever walks ONE
  // path — and that path can still thread through a wall of battles. This pass
  // walks top-down (parents are always resolved first) tracking each node's
  // running streak of consecutive battles along its worst incoming route, and
  // reforges any battle that would become the 4th-in-a-row into a breather.
  function breakBattleStreaks(floors) {
    const MAX_STREAK = 3;               // at most this many plain battles in a row
    const LAST = FLOORS - 1;
    const streak = {};                  // node id -> consecutive battles ending here
    for (let f = 0; f < FLOORS; f++) {
      floors[f].forEach(node => {
        if (node.type !== 'battle') { streak[node.id] = 0; return; }
        let worst = 0;
        node.parents.forEach(pid => { worst = Math.max(worst, streak[pid] || 0); });
        let s = worst + 1;
        // the overrunning battle becomes a breather (mostly an event, sometimes a
        // cache); never touch the intro row or the boss row.
        if (s > MAX_STREAK && f > 0 && f < LAST) {
          node.type = Math.random() < 0.3 ? 'reward' : 'event';
          s = 0;
        }
        streak[node.id] = s;
      });
    }
  }

  function rangeFloors(lo, hi) {
    const out = [];
    for (let f = lo; f <= hi; f++) out.push(f);
    return out;
  }

  function nodeById(id) {
    for (const fl of State.map.floors) for (const n of fl) if (n.id === id) return n;
    return null;
  }

  function reachableNodes() {
    if (State.pos.floor === -1) return State.map.floors[0];
    const cur = nodeById(State.pos.floor + '-' + State.pos.idx);
    return cur ? cur.children.map(nodeById) : [];
  }

  // ============================================================
  // MAP RENDER
  // ============================================================
  const NODE_ICON = { battle: '⚔️', elite: '☠️', reward: '🎁', rest: '🔥', boss: '👑', event: '❔', shop: '🛒', soulstone: '💠', shadow: '💀' };
  const NODE_NAME = { battle: 'Battle', elite: 'Elite', reward: 'Cache', rest: 'Rest', boss: 'Boss', event: 'Event', shop: 'Bazaar', soulstone: 'Soulstone', shadow: 'Soulhunter' };
  // hand-illustrated medallion tokens (name baked in) for the node types that have art
  const NODE_ART = {
    battle:    'assets/Battle Node.png',
    elite:     'assets/Elite Node.png',
    event:     'assets/Event Node.png',
    reward:    'assets/Cache Node.png',
    soulstone: 'assets/Soulstone Node.png',
    boss:      'assets/Floor Boss Node.png',
    shadow:    'assets/Soulhunter Node.png',
    shop:      'assets/Bazaar Node.png',
    rest:      'assets/Rest Node.png'
  };
  // boss nodes are named after the boss actually waiting on this floor
  function nodeLabel(node) {
    if (node.type === 'boss') {
      const b = currentBoss();
      return b ? b.name.replace(/^The /, '') : NODE_NAME.boss;
    }
    return NODE_NAME[node.type];
  }

  function mapLayout() {
    const W = 1920, H = 200 + FLOORS * 170;   // grows with floor count so a long run never crowds
    const topM = 110, botM = 120, sideM = 360;
    const span = (H - topM - botM);
    return { W, H, topM, botM, sideM, span };
  }
  function nodePos(node) {
    const L = mapLayout();
    // floor 0 at bottom, boss at top
    const y = L.topM + (FLOORS - 1 - node.floor) / (FLOORS - 1) * L.span;
    const x = L.sideM + node.x * (L.W - 2 * L.sideM);
    return { x, y };
  }

  function renderMap() {
    const nodesC = $('map-nodes');
    const edges = $('map-edges');
    const title = $('map-title');
    if (title) {
      const depthTag = (State.mode === 'descension')
        ? '<span class="map-descent">⮟ Descent ' + roman(State.descension || 1) + '</span> '
        : '';
      title.innerHTML = depthTag + 'The Spire of Chaos — Floor ' + (State.act || 1);
    }
    nodesC.innerHTML = '';
    const L = mapLayout();
    edges.setAttribute('viewBox', `0 0 ${L.W} ${L.H}`);
    $('map-canvas').style.height = L.H + 'px';
    let edgeSvg = '';

    const reach = reachableNodes();
    const reachIds = reach.map(n => n.id);
    const curId = State.pos.floor === -1 ? null : State.pos.floor + '-' + State.pos.idx;

    // edges
    State.map.floors.forEach(fl => fl.forEach(node => {
      const p = nodePos(node);
      node.children.forEach(cid => {
        const c = nodeById(cid); const cp = nodePos(c);
        const active = node.id === curId && reachIds.indexOf(cid) !== -1;
        const w = active ? 5 : 3;
        const dash = (node.visited || active) ? '0' : '7 9';
        const stroke = active ? 'rgba(250,210,120,0.95)' : 'rgba(196,182,235,0.55)';
        // a solid dark casing beneath each edge so the trail stands off the textured map
        edgeSvg += `<line x1="${p.x}" y1="${p.y}" x2="${cp.x}" y2="${cp.y}"
          stroke="rgba(0,0,0,0.5)" stroke-width="${w + 4}" stroke-linecap="round"/>`;
        edgeSvg += `<line x1="${p.x}" y1="${p.y}" x2="${cp.x}" y2="${cp.y}"
          stroke="${stroke}" stroke-width="${w}" stroke-dasharray="${dash}" stroke-linecap="round"/>`;
      });
    }));
    edges.innerHTML = edgeSvg;

    // nodes
    State.map.floors.forEach(fl => fl.forEach(node => {
      const p = nodePos(node);
      const n = el('div', 'mapnode type-' + node.type);
      n.style.left = p.x + 'px';
      n.style.top = p.y + 'px';
      // the Soulhunter node smolders with cold black flame
      const flames = node.type === 'shadow'
        ? '<span class="shadowflames">' +
            Array.from({ length: 6 }, (_, k) =>
              '<span class="bflame" style="--i:' + k + '"></span>').join('') +
          '</span>'
        : '';
      const art = NODE_ART[node.type];
      if (art) n.classList.add('has-art');
      // width is also set as an HTML attribute so the medallion is always
      // constrained to token-size even if the stylesheet is momentarily stale.
      const artW = node.type === 'boss' ? 152 : 118;
      const icon = art
        ? `<img class="node-art-img" src="${art}" width="${artW}" alt="" draggable="false">`
        : `<span>${NODE_ICON[node.type]}</span>`;
      // the idle "bob" lives on an inner wrapper so it never fights the hover
      // scale (which sits on the outer node); a per-node seed desyncs the float
      n.style.setProperty('--seed', (node.floor * 7 + node.idx * 3) % 19);
      n.innerHTML = '<span class="mapnode-inner">' + flames + icon + '</span>' +
        `<span class="node-label">${nodeLabel(node)}</span>`;
      if (node.id === curId) n.classList.add('current');
      else if (node.visited) n.classList.add('visited');
      // debug "any node" lets every node (except the one we're standing on) be entered
      const normallyReachable = reachIds.indexOf(node.id) !== -1;
      const clickable = normallyReachable || (dbgAnyNode && node.id !== curId);
      if (clickable) {
        n.classList.add('reachable');
        if (dbgAnyNode && !normallyReachable) n.classList.add('dbg-anynode');
        n.addEventListener('mouseenter', () => { if (!mapLocked) SFX.hover(); });
        n.addEventListener('click', () => { if (mapLocked) return; enterNode(node); });
      }
      nodesC.appendChild(n);
    }));
    refreshNodeLock();

    // run stats now live in the global top HUD
    updateTopbar();

    // auto-scroll so reachable row is comfortably in view
    setTimeout(() => {
      const scroll = document.querySelector('.map-scroll');
      if (reach.length) {
        const p = nodePos(reach[0]);
        scroll.scrollTop = Math.max(0, p.y - 500);
      } else {
        scroll.scrollTop = scroll.scrollHeight;
      }
    }, 30);
  }

  // ============================================================
  // ENTER A NODE
  // ============================================================
  // Difficulty is doled out by depth, and disruptors are rationed so a single
  // fight never piles on too many tricks at once.
  // Encounters are now CURATED: hand-built groups that pair threats so each fight
  // poses a small puzzle (kill-order, burst windows, hit discipline) rather than a
  // bag of random foes. Tuned spicy — a real step up, still fair with good play.
  function enemyFormation(node) {
    // effective depth folds in the current act, so floor 2/3 reuse the meaner
    // group compositions (their stat scaling rides on Battle's depth knob)
    const f = node.floor + ((State.act || 1) - 1) * 4;
    const E = ENEMIES;

    if (node.type === 'boss') {
      const boss = currentBoss();
      const escort = (BOSS_ESCORTS[boss.id] || []).map(id => E[id]).filter(Boolean);
      return [ boss ].concat(escort);
    }

    if (node.type === 'elite') {
      // The three elites fight SOLO — their own mechanics (summons, drum, gorge)
      // ARE the encounter. (The Starveling is a boss node, not an elite.)
      const soloLeads = [ E.bonepiper, E.warchanter, E.clogfiend ];
      if ((State.act || 1) === 1) return [ rng(soloLeads) ];
      const lead = f >= 4 ? rng([ E.warchanter, E.clogfiend, E.bonepiper ])
                 : f >= 2 ? rng([ E.bonepiper, E.gloommaw ])
                          : E.gloommaw;
      if (soloLeads.indexOf(lead) !== -1) return [ lead ];
      // Gloommaw (floor boss) hits plenty hard on its own — keep its escort lighter.
      if (lead === E.gloommaw) return [ lead, rng([ E.cinderling, E.thornback ]) ];
      // other leads get a depth-scaled escort; nastier support shows up deeper in
      const escort = f >= 3 ? rng([ E.thornback, E.maledict, E.sapfiend, E.gravewarden ])
                   : f >= 1 ? rng([ E.thornback, E.hexweaver, E.cinderling ])
                            : rng([ E.cinderling, E.thornback ]);
      return [ lead, escort ];
    }

    // ---- FLOOR 1 (act 1): seven hand-authored encounters that teach the new
    // mechanics one at a time. Cloned defs let the same foe carry encounter-
    // specific HP / intent rotations without bloating the ENEMIES table.
    if ((State.act || 1) === 1) {
      const clone = (base, ov) => Object.assign({}, base, ov);
      const A5 = { type: 'attack', value: 5 };
      const STR1 = { type: 'buffStat', stat: 'strength', value: 1 };
      const RES1 = { type: 'buffStat', stat: 'resilience', value: 1 };
      const A2x3 = { type: 'attack', value: 3, hits: 2 };
      const cindBuild = [ A5, STR1, A2x3 ];        // enc 3 L/R, enc 5
      const cindBuildOff = [ STR1, A2x3, A5 ];     // enc 3 center (staggered rotation)
      const cindIntro = [ A5, RES1, STR1 ];        // enc 1
      const cind = (hp, intents) => clone(E.cinderling, { maxHp: hp, intents: intents });
      const ENCOUNTERS = [
        [ cind(20, cindIntro), clone(E.thornback, { maxHp: 30 }) ],                       // 1: thorns timing
        [ clone(E.maledict, { maxHp: 45 }) ],                                             // 2: curse clock (Malice)
        [ cind(20, cindBuild), cind(20, cindBuildOff), cind(20, cindBuild) ],             // 3: focus-fire snowball
        [ clone(E.gravewarden, { maxHp: 40 }) ],                                          // 4: bury + telegraphed Crushing Blow
        [ cind(20, cindBuild), clone(E.hexweaver, { maxHp: 30 }), cind(20, cindBuild) ],  // 5: kill-order puzzle
        [ clone(E.sapfiend, { maxHp: 60 }) ],                                             // 6: brood + sap drain
        [ clone(E.hexwitch, { maxHp: 45 }) ]                                              // 7: combo-hex
      ];
      return rng(ENCOUNTERS).slice();
    }

    // ---- normal battles: pick a hand-designed group available at this depth ----
    // (Floors 2-3 reuse the reworked foes above under depth/Descension scaling.)
    const groups = [
      // floor 0-1 — spicy intros
      { min: 0, max: 1, members: [ E.cinderling, E.thornback ] },     // thorns: pick your hits
      { min: 0,         members: [ E.thornback, E.cinderling ] },
      { min: 0,         members: [ E.cinderling ] },                  // a lighter breather
      { min: 1,         members: [ E.hexweaver, E.cinderling ] },     // cursed slot + pressure
      { min: 1,         members: [ E.gravewarden, E.cinderling ] },   // ward: break the warden first
      // floor 2+ — combine a control trick with a threat
      { min: 2,         members: [ E.hexweaver, E.thornback ] },      // cursed slot + thornmail
      { min: 2,         members: [ E.gravewarden, E.thornback ] },    // warded thornwall
      { min: 2,         members: [ E.maledict, E.cinderling ] },      // siphon: spend, don't hoard
      // floor 3+ — meaner stacks
      { min: 3,         members: [ E.sapfiend, E.maledict ] },        // seal a slot + drain might
      { min: 3,         members: [ E.gravewarden, E.maledict ] },     // warded siphoner
      { min: 3,         members: [ E.hexweaver, E.sapfiend, E.cinderling ] } // curse + seal + body
    ];
    const pool = groups.filter(g => f >= g.min && (g.max == null || f <= g.max));
    const pick = rng(pool.length ? pool : groups);
    return pick.members.slice();
  }

  // ---- Soulhunter: the recurring shadow elite ----
  // Its form is fixed by how many times you've already cut it down this run
  // (0 → A, 1 → B, 2 → C). Each form is roughly twice as fierce as a regular
  // floor elite, and every form is a major step up from the last.
  function soulhunterForm() {
    const k = State.soulhunterKills || 0;
    return k <= 0 ? 'A' : (k === 1 ? 'B' : 'C');
  }
  function soulhunterFormation() {
    const form = soulhunterForm();
    const act = State.act || 1;
    const actMul = 1 + (act - 1) * 0.55;          // the floor's own difficulty rides on top
    // The Hunt: Soulbrand morphs your special sockets into Soul sockets that feed
    // Quarry; when Quarry crosses the threshold the Hunter unleashes Soul Reap.
    const FORMS = {
      A: { hp: 130, soulForm: 1, startQuarry: 1, reapAt: 4, mark: 1, markHit: 6, scare: 2, stalkHit: 5 },
      B: { hp: 170, soulForm: 2, startQuarry: 2, reapAt: 6, mark: 2, markHit: 8, scare: 3, stalkHit: 6 },
      C: { hp: 210, soulForm: 3, startQuarry: 3, reapAt: 8, mark: 3, markHit: 10, scare: 4, stalkHit: 7 }
    };
    const spec = FORMS[form];
    const atk = v => Math.round(v * actMul);
    const intents = [
      [ { type: 'quarry', value: spec.mark }, { type: 'attack', value: atk(spec.markHit) } ],   // Mark
      [ { type: 'scare', value: spec.scare }, { type: 'attack', value: atk(spec.stalkHit) } ],   // Stalk
      { type: 'thinking' },
      { type: 'soulReap', big: true }   // conditional — the brain fires it when Quarry >= reapAt
    ];
    const FORM_IMG = { A: 'assets/Soulhunter I.png', B: 'assets/Soulhunter II.png', C: 'assets/Soulhunter III.png' };
    const def = {
      id: 'soulhunter', name: 'Soul Hunter \u2014 Form ' + form, emoji: '\u2620\uFE0F',
      img: FORM_IMG[form] || null,
      maxHp: Math.round(spec.hp * actMul),
      boss: true, shadow: true, form: form, ranged: true,
      brain: 'soulhunter', reapAt: spec.reapAt, soulForm: spec.soulForm, startQuarry: spec.startQuarry,
      intents: intents
    };
    return [ def ];
  }

  function enterNode(node) {
    SFX.click();
    State.pos = { floor: node.floor, idx: node.idx };
    node.visited = true;
    State.activeIndex = firstAlive();

    if (node.type === 'reward') {
      buildReward('cache');
      show('screen-reward');
    } else if (node.type === 'rest') {
      buildRest();
      show('screen-rest');
    } else if (node.type === 'event') {
      buildEvent();
      show('screen-event');
    } else if (node.type === 'shop') {
      buildShop();
      show('screen-shop');
    } else if (node.type === 'soulstone') {
      buildSoulstone(node);
      show('screen-soulstone');
    } else {
      // battle / elite / boss / shadow(Soulhunter)
      const isShadow = node.type === 'shadow';
      const enemies = isShadow ? soulhunterFormation() : enemyFormation(node);
      root.CG.Battle.start({
        enemies: enemies,
        isBoss: node.type === 'boss',
        shadow: isShadow,
        // acts stack on top of node depth so floor 2/3 enemies hit and soak harder
        depth: ((State.act || 1) - 1) * 10 + (node.floor || 0),
        descension: descensionEffects(),   // null-safe: identity effects outside Descension
        onWin: () => onBattleWin(node),
        onLose: () => gameOver(false)
      });
      // Battle.start fades the node bed out; swap in a fight theme where we have one.
      // (Reward/Game-over screens restore the right track on the way out.)
      if (root.CG.Audio && root.CG.Audio.Music) {
        const track = battleMusic(node);
        if (track) root.CG.Audio.Music.to(track);
      }
    }
  }

  function onBattleWin(node) {
    State.cleared++;
    if (node.type === 'boss') {
      if ((State.act || 1) >= SPIRE_FLOORS) {
        pendingVictory = true;     // the end-boss falls — claim spoils, then the run is won
      } else {
        pendingNextFloor = true;   // floor boss down — climb to the next act after rewards
      }
      buildReward('boss');
    } else if (node.type === 'shadow') {
      buildReward('shadow');
    } else {
      buildReward(node.type === 'elite' ? 'elite' : 'normal');
    }
    show('screen-reward');
  }

  // the floor boss is beaten: roll the next act's boss and unfurl a fresh map
  function advanceFloor() {
    State.act = (State.act || 1) + 1;
    State.bossId = pickFloorBoss(State.act);
    State.map = genMap();
    State.pos = { floor: -1, idx: null };
    saveGame();
  }

  // ============================================================
  // REWARD SCREEN — tiered.
  // The ONLY choice is the glyph-of-three; everything else is
  // claimed by clicking (or auto-collected on Continue).
  // ============================================================
  function rng(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  let pendingClaims = [];   // unclaimed click-rewards, auto-collected on Continue
  let pendingGlyphPick = null;   // chosen glyph reward, committed on Continue
  let pendingUpgrade = null;     // chosen glyph upgrade (elite alt to taking a card)
  let pendingNodeSouls = 0;      // souls owed by the cleared node, paid out on the map
  let mapLocked = false;         // blocks node entry while the node's gold is flying in
  let dbgAnyNode = false;        // debug: let the player jump to ANY node on the map

  function soulsFor(tier) {
    if (tier === 'boss') return 60 + Math.floor(Math.random() * 21);   // 60-80
    if (tier === 'shadow') return 44 + Math.floor(Math.random() * 17); // 44-60
    if (tier === 'elite') return 28 + Math.floor(Math.random() * 9);   // 28-36
    if (tier === 'cache') return 8 + Math.floor(Math.random() * 7);    // 8-14
    return 12 + Math.floor(Math.random() * 7);                          // 12-18
  }

  // glyphs the active beast may be offered (its own + neutral, but NOT the
  // colorless soul-glyphs — those only come from Soulstone nodes).
  // `unlock` glyphs stay out of the pool until earned.
  function eligibleGlyphs() {
    const m = State.monsters[firstAlive()] || activeMonster();
    return Object.values(GLYPHS).filter(g =>
      !g.junk && !g.token && !g.colorless &&
      (!g.character || g.character === m.id) &&
      (!g.unlock || (State.unlocks && State.unlocks[g.unlock])));
  }
  // the white, beast-agnostic glyphs offered at Soulstone nodes
  function eligibleColorless() {
    return Object.values(GLYPHS).filter(g =>
      g.colorless && !g.junk && !g.token &&
      (!g.unlock || (State.unlocks && State.unlocks[g.unlock])));
  }
  function offerColorless(n) {
    const pool = eligibleColorless().slice();
    const out = [];
    while (out.length < n && pool.length) {
      out.push(pool.splice(weightedGlyphIndex(pool), 1)[0]);
    }
    return out;
  }
  // meta-unlock gate: blessings/items tagged with an `unlock` key stay out of run
  // pools until that key is granted at the Enchanted Well. Untagged = always in.
  function contentUnlocked(entry) {
    return !entry || !entry.unlock || !!(State && State.unlocks && State.unlocks[entry.unlock]);
  }
  function unlockedItems() { return Object.values(ITEMS).filter(contentUnlocked); }

  // ---- helpers the combat engine borrows (e.g. Devil socket boons) ----
  // add souls straight to the purse (no reward animation; used mid-combat)
  function gainSouls(n) {
    if (!State) return;
    State.souls = Math.max(0, (State.souls || 0) + (n || 0));
    setSoulCounters(State.souls);
    updateTopbar();
  }
  // permanently add a random glyph (this beast's pool + the colorless souls) to
  // the run deck; returns the glyph id added (or null if none eligible)
  function grantRandomGlyph() {
    if (!State) return null;
    const pool = eligibleGlyphs().concat(eligibleColorless());
    if (!pool.length) return null;
    const g = pool[Math.floor(Math.random() * pool.length)];
    State.pool.push(g.id);
    return g.id;
  }
  // permanently upgrade ONE copy of a base glyph in the run deck (+1 empower)
  function permEmpowerBase(baseId) {
    if (!State || !Array.isArray(State.pool)) return false;
    const idx = State.pool.findIndex(id => baseOf(id) === baseId);
    if (idx === -1) return false;
    const inst = ensureInstance(idx);
    if (!inst) return false;
    State.empower[inst] = (State.empower[inst] || 0) + 1;
    return true;
  }

  // ============================================================
  // SOULSTONE NODE — a soul fragment (5 → evolution) plus a colorless glyph.
  // Both are offered; both are optional. Reuses the reward commit flow.
  // ============================================================
  function soulstoneMeterHTML() {
    const have = State.soulstones || 0;
    let pips = '';
    for (let i = 0; i < 5; i++) {
      const lit = i < have;
      pips += '<span class="ss-pip' + (lit ? ' lit' : '') + '">' +
        '<img class="ss-pip-img" src="assets/' + (lit ? 'Soulstone Stone' : 'Soulstone Slot') + '.png" alt="" draggable="false"></span>';
    }
    return '<div class="ss-pips">' + pips + '</div>' +
      '<div class="ss-meter-label">' + have + ' / 5 — five Soulstones evolve your beast</div>';
  }
  function gainSoulstone() {
    State.soulstones = (State.soulstones || 0) + 1;
    const meter = $('soulstone-meter');
    if (meter) meter.innerHTML = soulstoneMeterHTML();
    if (State.soulstones >= 5) {
      State.soulstones -= 5;
      const m = State.monsters[firstAlive()] || activeMonster();
      if (meter) meter.innerHTML = soulstoneMeterHTML();
      // Beasts with a defined tree get the full cinematic choice; others keep
      // the old quiet stat bump so nothing breaks.
      if (m && m.evolution && (m.evolveLevel || 0) < 2) {
        updateRunUI();
        openEvolution(m);
        return;
      }
      evolveMonster();
      const sub = $('soulstone-sub');
      if (sub) sub.innerHTML = '<b>The fragments fuse — ' + activeMonster().name + ' EVOLVES!</b>';
      SFX.reward();
      updateRunUI();
      return;
    }
    updateRunUI();
    // a satisfying "stone snaps into the chain" beat for the 1st–4th fragment
    showSoulstoneModal(State.soulstones);
  }

  // The 5-stone evolution chain, with `count` stones gathered and `newIdx` the one
  // that just materialized.
  function ssChainHTML(count, newIdx) {
    let h = '';
    for (let i = 0; i < 5; i++) {
      if (i > 0) h += '<span class="ss-link' + (i < count ? ' lit' : '') + (i === newIdx ? ' new' : '') + '"></span>';
      const lit = i < count;
      h += '<span class="ss-gem' + (lit ? ' lit' : '') + (i === newIdx ? ' new' : '') +
        '"><img class="ss-gem-core" src="assets/' + (lit ? 'Soulstone Stone' : 'Soulstone Slot') + '.png" alt="" draggable="false"></span>';
    }
    return h;
  }
  function showSoulstoneModal(count) {
    const modal = $('soulstone-modal'), row = $('soulstone-modal-row');
    if (!modal || !row) return;
    const newIdx = count - 1;
    row.innerHTML = ssChainHTML(count, newIdx);
    const t = $('soulstone-modal-title'); if (t) t.textContent = 'A Soulstone Gathered';
    const sub = $('soulstone-modal-sub');
    if (sub) sub.innerHTML = '<b>' + count + ' / 5</b> — gather <b>5</b> to evolve <b>' + activeMonster().name + '</b>.';
    modal.classList.remove('hidden', 'closing');
    SFX.reward();
    requestAnimationFrame(() => {
      const gem = row.querySelector('.ss-gem.new');
      if (gem) {
        gem.classList.add('ss-pop');
        const ring = document.createElement('span'); ring.className = 'ss-ring'; gem.appendChild(ring);
        setTimeout(() => ring.remove(), 820);
      }
    });
  }
  function hideSoulstoneModal() {
    const modal = $('soulstone-modal');
    if (!modal || modal.classList.contains('hidden')) return;
    modal.classList.add('closing');
    setTimeout(() => { modal.classList.remove('closing'); modal.classList.add('hidden'); }, 320);
  }
  function buildSoulstone(node) {
    pendingClaims = [];
    pendingGlyphPick = null;
    pendingUpgrade = null;
    pendingNodeSouls = 0;
    const meter = $('soulstone-meter');
    if (meter) meter.innerHTML = soulstoneMeterHTML();
    const sub = $('soulstone-sub');
    if (sub) sub.textContent = 'Claim the stone, and take a colorless Soul-glyph if you wish.';

    const claims = $('soulstone-claims');
    claims.innerHTML = '';
    claims.appendChild(claimCard('<img class="cc-icon-img" src="assets/Soulstone Stone.png" alt="" draggable="false">', 'Soulstone',
      'A shard of raw soul. Gather <b>5</b> to evolve <b>' + activeMonster().name + '</b>.',
      'var(--blue)', () => gainSoulstone()));

    const row = $('soulstone-glyphs');
    row.innerHTML = '';
    const offers = offerColorless(3);
    if (!offers.length && sub) sub.textContent = 'Claim the stone — no Soul-glyphs remain to offer.';
    // Conjoined Soul: one offered Soul-glyph comes pre-empowered +2 here too.
    const conjoined = !!State.blessings.conjoined;
    const blessedIdx = (conjoined && offers.length) ? Math.floor(Math.random() * offers.length) : -1;
    offers.forEach((g, gi) => {
      const bonus = (gi === blessedIdx) ? 2 : 0;
      const c = glyphRewardCard(g, 1, () => {
        pendingGlyphPick = { id: g.id, copies: 1, empower: bonus };
        pendingUpgrade = null;
        row.querySelectorAll('.reward-card').forEach(x => x.classList.remove('chosen'));
        c.classList.add('chosen');
        SFX.reward();
      }, bonus);
      row.appendChild(c);
    });
  }
  // Wild-letter glyphs slot into ANY chain, so they're deliberately scarce: a wild
  // is offered at 1/3 the weight of a lettered glyph (non-wild 3 · wild 1).
  function glyphOfferWeight(g) { return (g && g.letter === 'wild') ? 1 : 3; }
  // pull one index from `pool` weighted by glyphOfferWeight
  function weightedGlyphIndex(pool) {
    let total = 0;
    for (const g of pool) total += glyphOfferWeight(g);
    let r = Math.random() * total;
    for (let i = 0; i < pool.length; i++) {
      r -= glyphOfferWeight(pool[i]);
      if (r < 0) return i;
    }
    return pool.length - 1;
  }
  function offerGlyphs(n) {
    const pool = eligibleGlyphs().slice();
    const out = [];
    while (out.length < n) {
      if (pool.length) out.push(pool.splice(weightedGlyphIndex(pool), 1)[0]);
      else out.push(rng(eligibleGlyphs()));   // fall back to repeats if the set is tiny
    }
    return out;
  }

  function buildReward(tier) {
    const titles = { normal: 'Victory', cache: 'A Hidden Cache', elite: 'Elite Vanquished', boss: 'Boss Vanquished', shadow: 'The Soulhunter Falls' };
    $('reward-head').textContent = titles[tier] || 'Victory';
    $('reward-sub').textContent = 'Collect your spoils, then choose a glyph.';
    pendingClaims = [];
    $('reward-souls-val').textContent = State.souls;

    const claims = $('reward-claims');
    claims.innerHTML = '';

    // --- Souls (always) ---
    const souls = soulsFor(tier);
    const soulKind = tier === 'boss' ? 'Abundant Souls' : (tier === 'elite' || tier === 'shadow') ? 'Greater Souls' : 'Souls';
    // Souls don't pour out here — they ride home from the node you just cleared,
    // bursting onto the map when you set out again (see finishReward).
    // Show the post-bonus total (Greed etc.) so the card matches what actually lands.
    const soulsShown = soulsGainPreview(souls);
    const soulsLabel = '+' + soulsShown + ' souls' + (soulsShown > souls ? ' <span class="cc-bonus">(Greed)</span>' : '');
    claims.appendChild(claimCard('🪙', soulKind, soulsLabel, 'var(--gold)', () => {
      pendingNodeSouls += souls;
    }));

    // --- Item drop (non-boss tiers, when there's room to carry one) ---
    if (tier !== 'boss' && !itemsFull() && Math.random() < 0.5) {
      const it = rng(unlockedItems());
      if (it) claims.appendChild(claimCard(itemArtHTML(it), 'Item',
        '<b>' + it.name + '</b> — ' + it.desc, 'var(--gold)', () => addItem(it.id)));
    }

    // --- Blessing (elite + boss) ---
    if (tier === 'elite' || tier === 'boss') {
      const bless = pickBlessing(tier);
      claims.appendChild(claimCard(blessArtHTML(bless), tier === 'boss' ? 'Powerful Blessing' : 'Blessing',
        '<b>' + bless.name + '</b> — ' + bless.desc, 'var(--purple)', () => applyBlessing(bless)));
    }

    // --- Rare socket find (elites only): sockets otherwise come from bosses.
    // 15% for one, an exceedingly rare 3% for two. ---
    if (tier === 'elite') {
      const roll = Math.random();
      if (roll < 0.03) {
        claims.appendChild(claimCard('🜨', 'Twin Sockets',
          'An exceedingly rare find — <b>TWO</b> extra glyph sockets for <b>' + activeMonster().name + '</b>.',
          'var(--blue)', () => gainSocket(2)));
      } else if (roll < 0.18) {
        claims.appendChild(claimCard('🜨', 'Extra Socket',
          'A rare find — one extra glyph socket for <b>' + activeMonster().name + '</b>.',
          'var(--blue)', () => gainSocket(1)));
      }
    }

    // --- Guaranteed socket (boss only). Evolution is no longer a boss spoil —
    // it now comes from gathering Soulstones. ---
    if (tier === 'boss') {
      claims.appendChild(claimCard('🜨', 'Extra Socket',
        'Permanently grant <b>' + activeMonster().name + '</b> one more glyph socket.',
        'var(--blue)', () => gainSocket(1)));
    }

    // --- Soulhunter spoils: a soulstone (always), plus the soul blessing for the form slain ---
    if (tier === 'shadow') {
      claims.appendChild(claimCard('<img class="cc-icon-img" src="assets/Soulstone Stone.png" alt="" draggable="false">', 'Soulstone',
        'Wrenched from the Soulhunter — a shard of raw soul. Gather <b>5</b> to evolve <b>' + activeMonster().name + '</b>.',
        'var(--blue)', () => gainSoulstone()));
      const form = soulhunterForm();
      const sbId = { A: 'conjoined', B: 'conniving', C: 'calamitous' }[form];
      const sb = SOUL_BLESSINGS[sbId];
      if (sb && !State.blessings[sb.id]) {
        claims.appendChild(claimCard(blessArtHTML(sb), 'Soul Blessing \u2014 Form ' + form,
          '<b>' + sb.name + '</b> \u2014 ' + sb.desc, 'var(--purple)', () => applyBlessing(sb)));
      }
      // this form is spent — the next Soulhunter you face rises one form stronger
      State.soulhunterKills = (State.soulhunterKills || 0) + 1;
    }

    // --- Glyph of three (the only real choice) ---
    $('reward-choose-head').textContent = tier === 'boss' ? 'Choose a Powerful Glyph' : 'Choose a Glyph';
    const copies = tier === 'boss' ? 2 : 1;
    const glyphRow = $('reward-glyphs');
    glyphRow.innerHTML = '';
    // selection is a preview only — it's committed in finishReward (Continue),
    // so the player can freely change their pick until then.
    pendingGlyphPick = null;
    pendingUpgrade = null;
    // Conjoined Soul: one of the three offered glyphs comes pre-empowered +2.
    const conjoined = !!State.blessings.conjoined;
    const blessedIdx = conjoined ? Math.floor(Math.random() * 3) : -1;
    offerGlyphs(3).forEach((g, gi) => {
      const bonus = (gi === blessedIdx) ? 2 : 0;
      const c = glyphRewardCard(g, copies, () => {
        pendingGlyphPick = { id: g.id, copies: copies, empower: bonus };
        pendingUpgrade = null;
        glyphRow.querySelectorAll('.reward-card').forEach(x => x.classList.remove('chosen'));
        c.classList.add('chosen');
        SFX.reward();
      }, bonus);
      glyphRow.appendChild(c);
    });

    // Elites (and bosses) let you forgo a new glyph to forge an existing one
    // instead — and Chicken Charm extends that same option to normal battles.
    if (tier === 'elite' || tier === 'boss' || (tier === 'normal' && State.blessings.chickencharm)) {
      $('reward-choose-head').textContent = 'Choose a Glyph — or upgrade one you own';
      const up = el('div', 'reward-card upgrade-choice');
      up.innerHTML =
        '<div class="rc-kind">forge</div>' +
        '<div class="rc-icon" style="color:var(--gold)">⬆</div>' +
        '<div class="rc-name">Upgrade a Glyph</div>' +
        '<div class="uc-pick rc-desc">Reforge a glyph you already own — make it stronger or weave it deeper into your combo.</div>';
      up.addEventListener('mouseenter', () => SFX.hover());
      up.addEventListener('click', () => {
        openUpgradeModal((choice) => {
          pendingUpgrade = choice;             // { index, type } applied on Continue
          pendingGlyphPick = null;
          // the forge was chosen — lock the new-glyph options out, spotlight the upgrade
          glyphRow.querySelectorAll('.glyph-reward').forEach(x => { x.classList.remove('chosen'); x.classList.add('locked'); });
          up.classList.add('chosen');
          const g = gdef(State.pool[choice.index]);
          up.querySelector('.uc-pick').innerHTML =
            'Forged: <b>' + g.name + '</b> — ' + (choice.type === 'combo' ? 'Combo&nbsp;up' : 'Power&nbsp;up') +
            '. <span class="uc-redo">click to re-forge</span>';
        });
      });
      glyphRow.appendChild(up);
    }
  }

  // a click-to-collect reward chip
  function claimCard(icon, kind, desc, color, onClaim) {
    const c = el('div', 'claim-card');
    c.innerHTML = `
      <div class="cc-icon" style="color:${color}">${icon}</div>
      <div class="cc-body"><div class="cc-kind">${kind}</div><div class="cc-desc">${desc}</div></div>
      <div class="cc-check">✓</div>`;
    const claim = () => { if (c.classList.contains('claimed')) return; c.classList.add('claimed'); onClaim(c); };
    pendingClaims.push(() => { if (!c.classList.contains('claimed')) { c.classList.add('claimed'); onClaim(c); } });
    c.addEventListener('mouseenter', () => SFX.hover());
    c.addEventListener('click', () => { if (!c.classList.contains('claimed')) { SFX.reward(); } claim(); });
    return c;
  }

  // ============================================================
  // SOULS GAIN — count-up, flying coins, and a satisfying chime.
  // Reusable for any soul reward (claims, caches, future sources).
  // ============================================================
  function setSoulCounters(v) {
    const a = $('reward-souls-val'); if (a) a.textContent = v;
    const b = $('tb-souls'); if (b) b.textContent = v;
  }
  function pulseSoul(elm) {
    if (!elm) return;
    const host = (elm.closest && elm.closest('.reward-souls-badge')) || elm;
    host.classList.remove('soul-pop'); void host.offsetWidth; host.classList.add('soul-pop');
  }
  // the visible souls counter the player is currently looking at
  function soulTargetEl() {
    const rs = $('screen-reward');
    const onReward = rs && rs.classList.contains('is-active');
    return (onReward && $('reward-souls-val')) ? $('reward-souls-val') : $('tb-souls');
  }
  // --- coin-flight "busy" tracking so a screen can wait for the gold to land ---
  let coinsActive = 0;
  const coinIdleCbs = [];
  function coinsBegin() { coinsActive++; }
  function coinsEnd() {
    coinsActive = Math.max(0, coinsActive - 1);
    if (coinsActive === 0) { const cbs = coinIdleCbs.splice(0); cbs.forEach(f => f()); }
  }
  function whenCoinsIdle(cb) { if (coinsActive === 0) cb(); else coinIdleCbs.push(cb); }

  // what a raw soul reward actually becomes after run bonuses (Greed, etc.).
  // single source of truth so UI labels match what gainSouls will grant.
  function soulsGainPreview(amount) {
    amount = Math.max(0, Math.round(amount || 0));
    if (State && State.blessings && State.blessings.greed) amount = Math.round(amount * 1.5);
    return amount;
  }
  function gainSouls(amount, fromEl, onDone) {
    amount = soulsGainPreview(amount);   // applies Greed + any future soul bonuses
    if (amount > 0) { const s = ensureRunStats(); if (s) s.soulsGained = (s.soulsGained || 0) + amount; }
    const start = State.souls;
    State.souls += amount;
    const target = soulTargetEl();
    if (amount <= 0) { setSoulCounters(State.souls); if (onDone) onDone(); return; }
    SFX.coins(amount);
    const coins = Math.max(6, Math.min(18, amount));
    spawnCoins(fromEl, target, coins, start, start + amount, onDone);
  }
  // Souls promised on a reward screen ride home from the cleared map node:
  // burst from the node, fly to the HUD counter, and hold map navigation until paid.
  function awardSoulsFromNode(amount) {
    if (amount <= 0) { mapLocked = false; return; }
    mapLocked = true;
    refreshNodeLock();
    let released = false;
    const release = () => { if (released) return; released = true; mapLocked = false; refreshNodeLock(); };
    // wait a beat for the map to lay out + auto-scroll before measuring the node
    setTimeout(() => {
      const node = document.querySelector('#map-nodes .mapnode.current')
                || document.querySelector('#map-nodes .mapnode.reachable');
      gainSouls(amount, node, release);
      // safety net: never strand the player if an animation frame is dropped
      setTimeout(release, 3000);
    }, 90);
  }
  // grey out reachable nodes while gold is in flight
  function refreshNodeLock() {
    const nc = $('map-nodes'); if (!nc) return;
    nc.classList.toggle('locked', !!mapLocked);
  }
  // spend souls (shop) — quick debit with a little counter pop
  function spendSouls(amount) {
    State.souls = Math.max(0, State.souls - Math.round(amount || 0));
    setSoulCounters(State.souls);
    pulseSoul($('tb-souls'));
  }

  function spawnCoins(fromEl, toEl, count, fromVal, toVal, onDone) {
    const stage = $('stage'), Scale = root.CG.Scale;
    if (!stage || !fromEl || !toEl || !Scale) { setSoulCounters(toVal); pulseSoul(toEl); if (onDone) onDone(); return; }
    const fr = fromEl.getBoundingClientRect(), tr = toEl.getBoundingClientRect();
    // a not-yet-laid-out source (e.g. a node whose screen just became active) has no box
    if ((fr.width === 0 && fr.height === 0) || (tr.width === 0 && tr.height === 0)) {
      setSoulCounters(toVal); pulseSoul(toEl); if (onDone) onDone(); return;
    }
    const from = Scale.toStage(fr.left + fr.width / 2, fr.top + fr.height / 2);
    const to = Scale.toStage(tr.left + tr.width / 2, tr.top + tr.height / 2);
    const dx = to.x - from.x, dy = to.y - from.y;
    let landed = 0;
    coinsBegin();
    for (let i = 0; i < count; i++) {
      const coin = el('div', 'soul-coin', '🪙');
      coin.style.left = from.x + 'px';
      coin.style.top = from.y + 'px';
      stage.appendChild(coin);
      const sx = (Math.random() * 2 - 1) * 90;           // burst outward...
      const sy = -(45 + Math.random() * 80);             // ...and up first
      const delay = i * 42 + Math.random() * 50;
      const dur = 560 + Math.random() * 220;
      const spin = (Math.random() * 420 - 210) | 0;
      // fill:'both' holds the first frame (opacity 0) during the stagger delay, so
      // coins fade IN one by one from the source instead of piling up there visibly
      const anim = coin.animate([
        { transform: 'translate(-50%,-50%) scale(.55) rotate(0deg)', opacity: 0 },
        { transform: `translate(-50%,-50%) translate(${sx}px,${sy}px) scale(1) rotate(${spin / 2 | 0}deg)`, opacity: 1, offset: 0.3 },
        // nearly home, still bright...
        { transform: `translate(-50%,-50%) translate(${dx * 0.95 | 0}px,${dy * 0.95 | 0}px) scale(.62) rotate(${spin * 0.9 | 0}deg)`, opacity: 1, offset: 0.82 },
        // ...then dissolve into the counter as it lands
        { transform: `translate(-50%,-50%) translate(${dx}px,${dy}px) scale(.32) rotate(${spin}deg)`, opacity: 0 }
      ], { duration: dur, delay: delay, easing: 'cubic-bezier(.3,.6,.3,1)', fill: 'both' });
      anim.onfinish = () => {
        coin.remove();
        landed++;
        setSoulCounters(Math.round(fromVal + (toVal - fromVal) * (landed / count)));
        pulseSoul(toEl);
        SFX.coinTick(landed);
        if (landed === count) { setSoulCounters(toVal); coinsEnd(); if (onDone) onDone(); }
      };
    }
  }

  // a glyph's rune art, stacked diagonally for multi-socket glyphs (matches hand)
  function glyphArtInner(g) {
    return g.img
      ? '<img class="g-img" src="' + g.img + '" alt="" draggable="false">'
      : '<div class="g-hex"><span class="g-rune">' + g.rune + '</span></div>';
  }
  function glyphArtHTML(g) {
    const n = g.slots || 1;
    if (n <= 1) return glyphArtInner(g);
    let layers = '';
    for (let i = 0; i < n; i++) layers += '<div class="g-layer" style="--i:' + i + '">' + glyphArtInner(g) + '</div>';
    return '<div class="g-stack" style="--n:' + n + '">' + layers + '</div>';
  }

  function glyphRewardCard(g, copies, onPick, bonus) {
    bonus = bonus || 0;
    const c = el('div', 'reward-card glyph-reward' + (bonus ? ' blessed-glyph' : ''));
    c.style.setProperty('--g-color', 'var(--' + g.color + ')');
    const slots = g.slots || 1;
    const env = bonus ? upgradeEnv(bonus) : metaEnv(g.id);
    c.innerHTML = `
      ${letterChipHTML(g)}
      <div class="rc-kind">${g.color} glyph${copies > 1 ? ' &times;' + copies : ''}</div>
      <div class="gr-art">${glyphArtHTML(g)}</div>
      <div class="rc-name">${g.name}</div>
      ${slots > 1 ? '<div class="rc-slots">⬡ Takes ' + slots + ' sockets</div>' : ''}
      <div class="rc-desc">${DATA.formatDesc(g, env)}</div>`;
    c.addEventListener('mouseenter', () => SFX.hover());
    c.addEventListener('click', () => onPick());
    return c;
  }

  function pickBlessing(tier) {
    if (tier === 'boss') {
      const power = Object.values(POWER_BLESSINGS).filter(b => contentUnlocked(b) && !(b.scope === 'run' && State.blessings[b.id]));
      if (power.length) return rng(power);
      // power pool exhausted (multi-floor runs) — fall back to the standard pool
    }
    const choices = Object.values(BLESSINGS).filter(b => contentUnlocked(b) && (b.scope === 'run' ? !State.blessings[b.id] : true));
    return rng(choices.length ? choices : Object.values(BLESSINGS).filter(contentUnlocked));
  }

  function applyBlessing(bless) {
    if (bless.scope === 'run') {
      State.blessings[bless.id] = true;
      // Calamitous Soul reshapes every eligible socket the moment it's taken
      if (bless.id === 'calamitous') grantCalamitousUpgrade();
      flyBlessingToTopbar(bless);   // flourish mid-screen, then fly into the HUD slot
    } else if (bless.effect === 'twinsocket') {
      gainSocket(2);
    } else { // socket
      gainSocket(1);
    }
  }

  // A gained blessing blooms in the center of the screen, then its emblem streaks
  // up into the top-bar where it finally settles into its chip.
  let flyingBlessId = null;
  function pulseBlessChip(id) {
    const chip = document.querySelector('#tb-blessings [data-bless="' + id + '"]');
    if (!chip) return;
    chip.classList.remove('tb-bless-arrive'); void chip.offsetWidth; chip.classList.add('tb-bless-arrive');
  }
  // Shared "you got it!" flourish: an emblem blooms mid-screen, then streaks up
  // into its HUD slot. Used by both blessings and items.
  // opts: { artHTML, name, accent, getTarget:()=>el|null, reveal:()=>void }
  function flyGetToTopbar(opts) {
    const layer = document.createElement('div');
    layer.className = 'bless-fly-layer';
    if (opts.accent) layer.style.setProperty('--fly-accent', opts.accent);
    layer.innerHTML =
      '<div class="bless-fly">' +
        '<div class="bless-fly-art">' + opts.artHTML + '</div>' +
        '<div class="bless-fly-name">' + opts.name + '</div>' +
      '</div>';
    document.body.appendChild(layer);
    if (SFX && SFX.reward) SFX.reward();

    const target = opts.getTarget();
    const rect = target ? target.getBoundingClientRect() : null;
    // top bar not on screen (or no room) → just bloom, then drop it into place.
    // Revealing the chip WHILE the bloom fades (over .3s) leaves no blank gap.
    if (!rect || rect.width < 2) {
      setTimeout(() => { layer.classList.add('done'); opts.reveal(); setTimeout(() => layer.remove(), 320); }, 1150);
      return;
    }
    // after the bloom, streak the emblem into its HUD slot
    setTimeout(() => {
      const art = layer.querySelector('.bless-fly-art');
      const a = art.getBoundingClientRect();
      const dx = (rect.left + rect.width / 2) - (a.left + a.width / 2);
      const dy = (rect.top + rect.height / 2) - (a.top + a.height / 2);
      const scale = Math.max(0.12, rect.width / a.width);
      layer.classList.add('flying');
      art.style.transition = 'transform .58s cubic-bezier(.55,0,.25,1), filter .58s ease';
      art.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + scale + ')';
      // Reveal the real chip FIRST, then drop the flying clone a frame later so
      // there's never a paint where neither is showing (kills the brief flicker).
      setTimeout(() => {
        opts.reveal();
        requestAnimationFrame(() => requestAnimationFrame(() => layer.remove()));
      }, 560);
    }, 940);
  }

  function flyBlessingToTopbar(bless) {
    flyingBlessId = bless.id;
    updateRunUI();   // the new chip renders, but stays held invisible until it lands
    flyGetToTopbar({
      artHTML: blessArtHTML(bless),
      name: bless.name,
      accent: 'var(--purple)',
      getTarget: () => document.querySelector('#tb-blessings [data-bless="' + bless.id + '"]'),
      reveal: () => { flyingBlessId = null; updateRunUI(); pulseBlessChip(bless.id); }
    });
  }

  // ---- Item gain flourish (mirrors the blessing one, flying into the item tray) ----
  let flyingItemSlot = -1;   // stacks-index of the just-added slot, held invisible until it lands
  function pulseItemChip(idx) {
    const tray = document.querySelector('.tb-items');
    const chip = tray && tray.children[idx];
    if (!chip) return;
    chip.classList.remove('tb-item-arrive'); void chip.offsetWidth; chip.classList.add('tb-item-arrive');
  }
  function flyItemToTopbar(it, slotIdx) {
    flyingItemSlot = slotIdx;
    renderItems();   // the new slot renders, but stays held invisible until it lands
    flyGetToTopbar({
      artHTML: itemArtHTML(it),
      name: it.name,
      accent: 'var(--gold)',
      getTarget: () => { const tray = document.querySelector('.tb-items'); return tray ? tray.children[slotIdx] : null; },
      reveal: () => { flyingItemSlot = -1; renderItems(); pulseItemChip(slotIdx); }
    });
  }

  // Calamitous Soul: stamp 'Upgrade' onto every socket that can carry a glyph.
  // Persists on the beast.
  function grantCalamitousUpgrade() {
    const m = State.monsters[firstAlive()] || activeMonster();
    if (!m.slotTypes) m.slotTypes = [];
    for (let i = 0; i < m.sockets; i++) {
      const v = m.slotTypes[i] || 'normal';
      const list = Array.isArray(v) ? v.slice() : (v === 'normal' ? [] : [v]);
      if (list.length && list.every(t => t === 'loopback')) continue;      // holds no glyph
      if (list.indexOf('upgrade') === -1) list.push('upgrade');
      m.slotTypes[i] = list.length === 1 ? list[0] : list;
    }
  }

  function evolveMonster() {
    const m = State.monsters[firstAlive()] || activeMonster();
    m.maxHp += 20;
    m.hp = Math.min(m.maxHp, m.hp + 20);
    m.passiveVal += 1;
    m.evolveLevel = (m.evolveLevel || 0) + 1;
    if (m.evolveName && m.evolveLevel === 1) m.name = m.evolveName;
    updateRunUI();
  }

  // ============================================================
  // EVOLUTION — the big cinematic moment at the 5th & 10th Soulstone.
  // A branching choice (two forms), then a Pokémon-style transformation.
  // Art is a stylized fallback for now; real PNGs drop straight into the
  // form data later with no code change.
  // ============================================================
  const EVO_ACCENT = {
    emberkin: '#ff7a3c', tricktail: '#b98cff',
    inferna: '#ff4326', cinderdancer: '#ffae3a',
    foxlights: '#5ff0c8', spectralWeaver: '#7cd6ff',
    // Goblin line
    orc: '#7fd06a', troll: '#ff9a3c',
    hornedgolem: '#8fe08f', irongolem: '#bcd2e0',
    berserkcolossus: '#ff5a4a', allknowingcolossus: '#ffce5e',
    // Ghoul line
    undead: '#9fd0a8', crawler: '#b98cff',
    skinwalker: '#c98a5a', vampire: '#e0506a',
    demon: '#ff5a4a', wendigo: '#8fb7ff'
  };
  function evoAccent(form) { return (form && EVO_ACCENT[form.id]) || 'var(--gold)'; }
  // the two forms offered at the beast's current evolution step
  function evoFormsFor(m) {
    const tree = m && m.evolution;
    if (!tree) return null;
    const lvl = m.evolveLevel || 0;
    if (lvl === 0) return tree.tier1 || null;
    if (lvl === 1) {
      const prev = m.evoChoices[0];
      return (tree.tier2 && tree.tier2[prev]) || null;
    }
    return null;
  }
  // the portrait used for a form — its own art when it exists, else the
  // current beast image as a tinted fallback (handled via onerror).
  function evoFormImg(form, m, cls) {
    const fallback = m && m.img ? m.img : '';
    const src = (form && form.img) || fallback;
    if (!src) return '<span class="evo-card-emoji">' + ((m && m.emoji) || '✦') + '</span>';
    const fb = fallback && fallback !== src
      ? ' onerror="this.onerror=null;this.src=\'' + fallback + '\'"' : '';
    return '<img class="' + (cls || 'evo-card-img') + '" src="' + src + '" alt="" draggable="false"' + fb + '>';
  }

  let pendingEvoReturn = 'screen-soulstone';
  function openEvolution(m) {
    const forms = evoFormsFor(m);
    if (!forms || forms.length < 2) { evolveMonster(); return; }
    const active = document.querySelector('.screen.is-active');
    pendingEvoReturn = active ? active.id : 'screen-map';
    const tier = (m.evolveLevel || 0) + 1;
    const host = $('evolve-stage');
    if (!host) { evolveMonster(); return; }

    const cards = forms.map((form, i) => {
      const acc = evoAccent(form);
      const p = form.passive || {};
      const hp = form.hp || 20;
      const socket = (form.socket && m.sockets < 6)
        ? '<div class="evo-card-socket"><span class="ecs-ico">' +
            (SLOT_INFO[form.socket.type] ? SLOT_INFO[form.socket.type].icon : '◆') +
          '</span> New <b>' + (form.socket.label || 'special') + '</b> socket</div>'
        : '';
      return '<button class="evo-card" data-idx="' + i + '" style="--acc:' + acc + '">' +
          '<div class="evo-card-tag">' + (form.tagline || '') + '</div>' +
          '<div class="evo-card-port">' + evoFormImg(form, m) +
            '<span class="evo-card-glow"></span></div>' +
          '<div class="evo-card-name">' + form.name + '</div>' +
          '<div class="evo-card-stats">' +
            '<span class="ecs-hp">+' + hp + ' Max HP</span>' + socket +
          '</div>' +
          '<div class="evo-card-passive">' +
            '<span class="ecp-name">✦ ' + (p.name || '') + '</span>' +
            '<span class="ecp-text">' + (p.text || '') + '</span>' +
          '</div>' +
          '<span class="evo-card-pick">Choose ' + form.name + '</span>' +
        '</button>';
    }).join('<div class="evo-or">OR</div>');

    host.className = 'evo-stage evo-phase-choose';
    host.innerHTML =
      '<div class="evo-burst-bg"></div>' +
      '<div class="evo-choose">' +
        '<div class="evo-banner">' +
          '<span class="evo-banner-spark">✦</span>' +
          '<h1 class="evo-title">' + m.name + ' is <em>EVOLVING!</em></h1>' +
          '<p class="evo-sub">Choose the path your power will take — this cannot be undone.</p>' +
        '</div>' +
        '<div class="evo-cards">' + cards + '</div>' +
      '</div>';

    host.querySelectorAll('.evo-card').forEach(btn => {
      btn.addEventListener('click', () => {
        if (host.dataset.choosing === '1') return;   // guard against double-clicks
        host.dataset.choosing = '1';
        const idx = parseInt(btn.dataset.idx, 10);
        // animate the choice out: chosen card surges forward, the other dismisses,
        // then we hand off to the transformation cinematic
        const choose = host.querySelector('.evo-choose');
        if (choose) choose.classList.add('evo-choosing');
        host.querySelectorAll('.evo-card').forEach(c =>
          c.classList.add(c === btn ? 'chosen' : 'dismissed'));
        if (SFX && SFX.click) SFX.click();
        setTimeout(() => {
          host.removeAttribute('data-choosing');
          chooseEvoForm(m, forms[idx], tier);
        }, 680);
      });
    });
    show('screen-evolve');
    SFX.reward();
  }

  function applyEvoForm(m, form, tier) {
    const hp = form.hp || 20;
    m.maxHp += hp;
    m.hp = Math.min(m.maxHp, m.hp + hp);
    if (form.passive) m.evoPassives.push({ id: form.passive.id, name: form.passive.name, text: form.passive.text });
    m.evoChoices.push(form.id);
    recordEvolved(form.id);   // unveil this form on the Star Chart forever
    m.name = form.name;
    m.evoFormImg = form.img || m.evoFormImg || null;   // remembered for when art lands
    // Swap the run-HUD portrait (topbar / combat / collection) to the form's real
    // art the moment it's available. A form whose PNG isn't in yet simply keeps
    // the base portrait — the probe never fires, so there's never a broken image.
    if (form.img) {
      const probe = new Image();
      probe.onload = () => { m.img = form.img; updateRunUI(); };
      probe.src = form.img;
    }
    let socketAdded = null;
    if (form.socket && m.sockets < 6) {
      if (!m.slotTypes) m.slotTypes = [];
      while (m.slotTypes.length < m.sockets) m.slotTypes.push('normal');
      // `index` pins the new socket to an exact position (0 = new first socket);
      // otherwise `after` inserts just past that slot (after < 0 = append at end).
      const idx = (form.socket.index != null)
        ? Math.max(0, Math.min(m.sockets, form.socket.index))
        : (form.socket.after < 0 ? m.sockets : Math.min(m.sockets, form.socket.after + 1));
      m.sockets += 1;
      m.slotTypes.splice(idx, 0, form.socket.type);
      socketAdded = { index: idx, label: form.socket.label, type: form.socket.type };
    }
    // Skinwalker: retroactively claim trophies from every elite/boss already slain
    // this run (persistent stats + 5% of each one's max HP), then keep doing so live.
    if (form.id === 'skinwalker') {
      m.skin = m.skin || {};
      let hpAdd = 0;
      (State.feastKills || []).forEach(k => {
        if (!k || !k.skin) return;
        DATA.feastTrophyAdd(m.skin, k.id);
        hpAdd += Math.max(1, Math.round((k.maxHp || 0) * 0.05));
      });
      if (hpAdd > 0) { m.maxHp += hpAdd; m.hp = Math.min(m.maxHp, m.hp + hpAdd); }
    }
    m.evolveLevel = (m.evolveLevel || 0) + 1;
    return socketAdded;
  }

  // The transformation cinematic: old portrait flares white, shakes, and
  // explodes into the chosen form, which lands in a burst of its accent color.
  function chooseEvoForm(m, form, tier) {
    const host = $('evolve-stage');
    const acc = evoAccent(form);
    const oldImg = m.img
      ? '<img class="evo-morph-img" src="' + m.img + '" alt="">'
      : '<span class="evo-morph-emoji">' + (m.emoji || '✦') + '</span>';
    const newImg = evoFormImg(form, m, 'evo-morph-img');
    const p = form.passive || {};

    // the final form looms 50% larger as it lands; a per-form class allows
    // targeted size tweaks for individual forms (e.g. Undead +30%)
    host.className = 'evo-stage evo-phase-morph' + (tier >= 2 ? ' evo-final' : '') +
      (tier === 1 ? ' evo-tier1' : '') +
      (form && form.id ? ' evo-form-' + form.id : '');
    host.style.setProperty('--acc', acc);
    host.innerHTML =
      '<div class="evo-burst-bg morphing"></div>' +
      '<div class="evo-rays"></div>' +
      '<div class="evo-morph">' +
        '<div class="evo-morph-old">' + oldImg + '</div>' +
        '<div class="evo-morph-new">' + newImg + '</div>' +
        '<div class="evo-flash"></div>' +
        '<div class="evo-shock"></div>' +
      '</div>' +
      '<div class="evo-reveal">' +
        '<h1 class="evo-reveal-name">' + form.name + '</h1>' +
        '<div class="evo-reveal-passive"><span class="erp-name">✦ ' + (p.name || '') + '</span>' +
          '<span class="erp-text">' + (p.text || '') + '</span></div>' +
        '<button id="evo-continue" class="evo-continue">Continue</button>' +
      '</div>';

    // sound + haptic-feel timing for the explosion
    setTimeout(() => { if (SFX && SFX.reward) SFX.reward(); }, 1500);

    const finish = () => {
      const socketAdded = applyEvoForm(m, form, tier);
      updateRunUI();
      if (socketAdded) {
        // show the freshly granted socket on the way out
        show(pendingEvoReturn);
        setTimeout(() => showSocketModal({ mode: 'gain', count: 1, indices: [socketAdded.index] }), 120);
      } else {
        show(pendingEvoReturn);
      }
    };
    const btn = $('evo-continue');
    if (btn) btn.addEventListener('click', finish);
  }

  const BLESS_ICON = { recall: '↺', emberward: '🜂', overload: '🜳', emberstorm: '⚝' };

  // A blessing's emblem: its real art when it has one (rendered box-free), else
  // its glyph icon. `cls` lets each surface size the image via CSS.
  function blessArtHTML(bl, cls) {
    if (bl && bl.img) {
      return '<img class="bless-art-img ' + (cls || '') + '" src="' + bl.img +
        '" alt="" draggable="false">';
    }
    return (bl && (BLESS_ICON[bl.id] || bl.icon)) || '✦';
  }
  function blessHasImg(bl) { return !!(bl && bl.img); }
  // an item's art: bespoke image when present, else its emoji glyph
  function itemArtHTML(it, cls) {
    if (it && it.img) {
      return '<img class="item-art-img ' + (cls || '') + '" src="' + it.img + '" alt="" draggable="false">';
    }
    return '<span class="item-icon">' + ((it && it.icon) || '✦') + '</span>';
  }

  // The global top HUD is shared by the map and battle screens; it always
  // reflects the active beast + run meta.
  function updateTopbar() {
    if (!State) return;
    const m = activeMonster();
    if (!m) return;
    const port = $('tb-portrait');
    if (port) {
      const key = m.img || m.emoji;
      if (port.dataset.key !== key) {        // only rebuild when the beast actually changes
        port.dataset.key = key;
        if (m.img) port.innerHTML = '<img class="tb-portrait-img" src="' + m.img + '" alt="">';
        else port.textContent = m.emoji;
      }
      port.style.color = m.img ? '' : m.color;
    }
    const nm = $('tb-name'); if (nm) nm.textContent = m.name;
    const hp = $('tb-hp'); if (hp) hp.textContent = Math.max(0, Math.round(m.hp)) + ' / ' + m.maxHp;
    const fill = $('tb-hpfill'); if (fill) fill.style.transform = 'scaleX(' + Math.max(0, m.hp / m.maxHp) + ')';
    const fl = $('tb-floor'); if (fl) fl.textContent = (State.pos.floor < 0 ? 1 : State.pos.floor + 1);
    const fn = $('tb-floornum'); if (fn) fn.textContent = State.act || 1;
    const sv = $('tb-souls'); if (sv) sv.textContent = State.souls;
    const blEl = $('tb-blessings');
    if (blEl) {
      const allBless = Object.assign({}, BLESSINGS, POWER_BLESSINGS, SOUL_BLESSINGS, EVENT_BLESSINGS);
      const owned = Object.keys(State.blessings).filter(k => State.blessings[k] && allBless[k]);
      blEl.innerHTML = owned.length
        ? owned.map(k => {
            const b = allBless[k];
            // a blessing mid-flight is held invisible until its icon lands in the slot
            const pending = (b.id === flyingBlessId) ? ' tb-bless-pending' : '';
            return '<span class="tb-bless' + (b.img ? ' has-img' : '') + pending + '" data-bless="' + b.id + '">' + blessArtHTML(b) +
              '<span class="hud-tip"><b>' + b.name + '</b><br>' + b.desc + '</span></span>';
          }).join('')
        : '<span class="tb-empty">—</span>';
      fitBlessings();
    }
    renderItems();
  }
  // Shrink the blessing chips just enough that a big collection never collides
  // with the items column. Chips stay full-size until they actually need to give.
  function fitBlessings() {
    const wrap = $('tb-blessings');
    if (!wrap) return;
    wrap.style.removeProperty('--bw');
    wrap.style.removeProperty('--bgap');
    const chips = wrap.querySelectorAll('.tb-bless');
    const n = chips.length;
    if (!n) return;
    const avail = wrap.clientWidth;          // flex:1 1 0 → exactly the free gap
    if (avail <= 0) return;                   // not laid out yet; a later update retries
    // chips begin as big as the beast portrait (48px) and only shrink once a
    // growing collection would otherwise crowd the items column.
    const maxS = 48, minS = 16;
    let gap = 6;
    const fits = s => n * s + (n - 1) * gap <= avail;
    let s = maxS;
    while (s > minS && !fits(s)) s--;
    if (s <= minS && !fits(minS)) { gap = 3; wrap.style.setProperty('--bgap', '3px'); }
    wrap.style.setProperty('--bw', s + 'px');
  }
  // back-compat alias used around the reward flow
  function updateRunUI() { updateTopbar(); }

  // ============================================================
  // ITEMS / INVENTORY (top-HUD consumable tray)
  // ============================================================
  const MAX_ITEM_STACKS = 3;   // how many item STACKS you can carry
  const STACK_MAX = 3;         // copies per stack
  const ITEM_SLOTS = MAX_ITEM_STACKS;   // empty slots shown in the HUD
  function itemsArr() { return (State && State.items) || []; }
  function idCount(id) { return itemsArr().filter(x => x === id).length; }
  // group the flat item list into display stacks: chunks of STACK_MAX per id, in
  // first-seen order. Several stacks of the SAME item are allowed (×3 ×3 ×3).
  function itemStacks() {
    const order = [], counts = {};
    itemsArr().forEach(id => { if (!(id in counts)) { counts[id] = 0; order.push(id); } counts[id]++; });
    const stacks = [];
    order.forEach(id => { let c = counts[id]; while (c > 0) { const n = Math.min(STACK_MAX, c); stacks.push({ id: id, count: n }); c -= n; } });
    return stacks;
  }
  // room for one more of THIS item? (top off a partial stack, else open a new one)
  function canAddItem(id) {
    if (!State || !ITEMS[id]) return false;
    if (idCount(id) % STACK_MAX !== 0) return true;     // a partial stack has room
    return itemStacks().length < MAX_ITEM_STACKS;       // otherwise need a fresh stack
  }
  // generic "no free stack slot" gate used when offering items
  function itemsFull() { return itemStacks().length >= MAX_ITEM_STACKS; }

  function addItem(id) {
    if (!State || !ITEMS[id]) return false;
    if (!State.items) State.items = [];
    // no room to carry it: deny with the error sound and NO get-animation
    if (!canAddItem(id)) { (SFX.error || SFX.click)(); return false; }
    State.items.push(id);
    // which display slot did it land in? (the last stack carrying this id)
    const stacks = itemStacks();
    let slotIdx = stacks.length - 1;
    for (let i = stacks.length - 1; i >= 0; i--) { if (stacks[i].id === id) { slotIdx = i; break; } }
    const so = ensureRunStats(); if (so) so.itemsObtained = (so.itemsObtained || 0) + 1;
    saveGame();
    flyItemToTopbar(ITEMS[id], slotIdx);   // also re-renders the tray
    return true;
  }
  function removeFirstItem(id) {
    if (!State || !State.items) return;
    const i = State.items.indexOf(id);
    if (i !== -1) {
      State.items.splice(i, 1);
      const su = ensureRunStats(); if (su) su.itemsUsed = (su.itemsUsed || 0) + 1;
    }
    renderItems();
    // Mid-combat consumption isn't committed to the save until the encounter is
    // actually resolved — so abandoning/continuing a reset encounter keeps the
    // item (the pre-combat save still holds it). saveGame fires on victory/map.
    if (!inCombatNow()) saveGame();
  }
  // Soul Jar death-save: spend one if carried, so a fallen beast revives.
  function consumeRevive() {
    if (!State || !State.items) return false;
    const i = State.items.indexOf('soul_jar');
    if (i === -1) return false;
    State.items.splice(i, 1);
    renderItems();
    if (!inCombatNow()) saveGame();   // committed when the fight is survived
    return true;
  }
  function grantRandomBlessing(rarity) {
    let bless;
    if (rarity === 'rare') {
      const pool = Object.values(POWER_BLESSINGS).filter(b => contentUnlocked(b) && !(b.scope === 'run' && State.blessings[b.id]));
      bless = rng(pool.length ? pool : Object.values(POWER_BLESSINGS).filter(contentUnlocked));
    } else {
      const pool = Object.values(BLESSINGS).filter(b => contentUnlocked(b) && (b.scope === 'run' ? !State.blessings[b.id] : true));
      bless = rng(pool.length ? pool : Object.values(BLESSINGS).filter(contentUnlocked));
    }
    if (bless) { applyBlessing(bless); updateTopbar(); }
    return bless;
  }
  function inCombatNow() {
    return !!(root.CG.Battle && root.CG.Battle.inCombat && root.CG.Battle.inCombat());
  }
  function flashDeny(chip) {
    if (chip) { chip.classList.add('item-deny'); setTimeout(() => chip.classList.remove('item-deny'), 380); }
  }
  // out-of-combat use for the non-combat consumables
  function applyMetaItem(it) {
    const e = it.effect || {};
    const m = activeMonster();
    if (e.kind === 'heal' && m) { m.hp = Math.min(m.maxHp, m.hp + Math.ceil(m.maxHp * e.pct)); SFX.reward(); }
    else if (e.kind === 'soulHeal' && m) { m.hp = m.maxHp; SFX.reward(); }
    else if (e.kind === 'blessing') { grantRandomBlessing(e.rarity); SFX.reward(); }
    updateTopbar();
  }
  function useStack(id, chip) {
    const it = id && ITEMS[id];
    if (!it) return;
    const inB = inCombatNow();
    if (it.combatOnly && !inB) { (SFX.error || SFX.click)(); flashDeny(chip); return; }
    if (inB) {
      if (root.CG.Battle.busy && root.CG.Battle.busy()) { (SFX.error || SFX.click)(); flashDeny(chip); return; }
      // combat effect is animated by the battle engine; consume only if it fired
      root.CG.Battle.useItem(id).then(used => { if (used) removeFirstItem(id); });
      return;
    }
    applyMetaItem(it);
    removeFirstItem(id);
  }
  function renderItems() {
    const tray = document.querySelector('.tb-items');
    if (!tray) return;
    tray.innerHTML = '';
    const stacks = itemStacks();
    const inB = inCombatNow();
    const count = Math.max(ITEM_SLOTS, stacks.length);
    for (let idx = 0; idx < count; idx++) {
      if (idx >= stacks.length) {
        if (idx < ITEM_SLOTS) {
          const slot = el('div', 'item-slot');
          slot.innerHTML = '<span class="hud-tip">Empty item slot</span>';
          tray.appendChild(slot);
        }
        continue;
      }
      const st = stacks[idx];
      const it = ITEMS[st.id];
      if (!it) continue;
      const usableNow = !it.combatOnly || inB;
      const pending = (idx === flyingItemSlot) ? ' tb-item-pending' : '';
      const chip = el('div', 'item-slot filled rarity-' + (it.rarity || 'common') + (it.img ? ' has-img' : '') + (usableNow ? '' : ' item-locked') + pending);
      chip.innerHTML =
        itemArtHTML(it) +
        (st.count > 1 ? '<span class="item-count">' + st.count + '</span>' : '') +
        '<span class="hud-tip"><b>' + it.name + '</b>' + (st.count > 1 ? ' <span class="it-x">×' + st.count + '</span>' : '') + '<br>' + it.desc +
          (it.combatOnly ? '<br><i class="item-hint">Combat only</i>' : '') +
          (it.passive ? '<br><i class="item-hint">Revives a fallen beast while carried</i>' : '') +
          '<br><i class="item-hint">' + (usableNow ? 'Click to use' : 'Use in combat') + '</i></span>';
      chip.addEventListener('mouseenter', () => SFX.hover());
      chip.addEventListener('click', () => useStack(st.id, chip));
      tray.appendChild(chip);
    }
  }

  // show/hide + configure the global HUD per screen
  function setHud(screenId) {
    const bar = $('battle-topbar');
    if (!bar) return;
    const runScreens = ['screen-map', 'screen-battle', 'screen-reward', 'screen-rest', 'screen-event', 'screen-shop', 'screen-soulstone', 'screen-blessing'];
    const on = State && runScreens.indexOf(screenId) !== -1;
    bar.classList.toggle('hidden', !on);
    const turnStat = $('tb-turn-stat');
    if (turnStat) turnStat.style.display = (screenId === 'screen-battle') ? '' : 'none';
    if (on) updateTopbar();
  }

  function finishReward() {
    // Rat Charm: walking away without taking a glyph or a forge doubles the
    // souls from this reward. Note whether a card was taken before we clear it.
    const tookCard = !!(pendingGlyphPick || pendingUpgrade);
    // commit the chosen glyph (if any) now, not on click
    if (pendingGlyphPick) {
      const bonus = pendingGlyphPick.empower || 0;
      for (let k = 0; k < pendingGlyphPick.copies; k++) {
        if (bonus) {
          // Conjoined Soul: bake the +2 into its own instance so it stays empowered
          const inst = mintInstance(baseOf(pendingGlyphPick.id));
          State.empower[inst] = (State.empower[inst] || 0) + bonus;
          State.pool.push(inst);
        } else {
          State.pool.push(pendingGlyphPick.id);
        }
      }
      pendingGlyphPick = null;
    } else if (pendingUpgrade) {
      applyUpgrade(pendingUpgrade.index, pendingUpgrade.type);
      pendingUpgrade = null;
    }
    // auto-collect any spoils the player didn't manually click
    pendingClaims.forEach(fn => fn());
    pendingClaims = [];
    // souls are now tallied — Rat Charm doubles them when no glyph was taken
    if (!tookCard && State.blessings.ratcharm && pendingNodeSouls > 0) pendingNodeSouls *= 2;
    if (pendingVictory) { pendingVictory = false; gameOver(true); return; }
    if (pendingNextFloor) { pendingNextFloor = false; advanceFloor(); }
    renderMap();
    show('screen-map');
    // pay out the souls from the node we just cleared, gating the map until they land
    if (pendingNodeSouls > 0) {
      const owed = pendingNodeSouls; pendingNodeSouls = 0;
      awardSoulsFromNode(owed);
    }
  }

  // ============================================================
  // GLYPH UPGRADE (FORGE) — elite alternative to taking a new card
  // ============================================================
  let upgradeOnConfirm = null;   // callback fired when an upgrade is chosen
  let upgradeIndex = -1;         // the pool index of the card being inspected
  let upgradeType = 'power';     // which temper the toggle is showing

  function applyUpgrade(index, type) {
    const curId = State.pool[index];
    // both upgrade tracks cap at 1: Combo Up is one-time, Power forging maxes at +1
    if (type === 'combo' && comboUpOf(curId)) return;
    if (type === 'power' && forgePowerOf(curId) >= 1) return;
    const inst = ensureInstance(index);   // peel ONE copy out as its own instance
    if (!inst) return;
    if (type === 'combo') State.comboUp[inst] = true;
    else State.empower[inst] = (State.empower[inst] || 0) + 1;   // power, capped at 1
    updateRunUI();
  }

  // env previewing a card at a given power level
  function upgradeEnv(power) { const e = neutralDescEnv(); e.cloneEmpower = power; return e; }

  function openUpgradeModal(onConfirm) {
    upgradeOnConfirm = onConfirm;
    upgradeIndex = -1;
    upgradeType = 'power';
    SFX.click();
    buildUpgradeGallery();
    showUpgradeView('gallery');
    $('upgrade-modal').classList.remove('hidden');
  }
  function closeUpgradeModal() {
    const modal = $('upgrade-modal');
    modal.classList.add('hidden');
    modal.classList.remove('forge-exit');
    const body = $('upgrade-forge-body'); if (body) body.classList.remove('forging');
    upgradeOnConfirm = null;
    upgradeIndex = -1;
  }
  function confirmUpgrade(index, type) {
    const cb = upgradeOnConfirm;
    closeUpgradeModal();
    SFX.reward();
    if (cb) cb({ index: index, type: type });
  }

  // swap between the browse gallery and the forge anvil, with a soft rise-in
  function showUpgradeView(which) {
    const gal = $('upgrade-gallery'), forge = $('upgrade-forge');
    if (!gal || !forge) return;
    const show = which === 'gallery' ? gal : forge, hide = which === 'gallery' ? forge : gal;
    hide.classList.add('hidden');
    show.classList.remove('hidden');
    show.classList.remove('view-rise'); void show.offsetWidth; show.classList.add('view-rise');
  }

  // every forgeable copy in the pool, listed individually (no stacking)
  function forgeableCards() {
    const out = [];
    State.pool.forEach((id, i) => {
      const def = gdef(id);
      if (!def || def.junk) return;
      out.push({ def: def, index: i, empower: empowerOf(id), combo: comboUpOf(id) });
    });
    out.sort((a, b) => a.def.name.localeCompare(b.def.name) || a.index - b.index);
    return out;
  }

  // a full-detail glyph card for the browse gallery (reads like the reward screen)
  function galleryCard(card) {
    const g = card.def;
    const c = el('div', 'forge-gal-card color-' + g.color + ((card.empower > 0 || card.combo) ? ' forged' : ''));
    c.style.setProperty('--g-color', 'var(--' + g.color + ')');
    const slots = g.slots || 1;
    const badges =
      (card.empower > 0 ? '<span class="deck-glyph-emp">✦+' + card.empower + '</span>' : '') +
      (card.combo ? '<span class="deck-glyph-combo">▲▲</span>' : '');
    c.innerHTML =
      badges + letterChipHTML(g) +
      '<div class="rc-kind">' + g.color + ' glyph</div>' +
      '<div class="gr-art">' + glyphArtHTML(g) + '</div>' +
      '<div class="rc-name">' + g.name + '</div>' +
      (slots > 1 ? '<div class="rc-slots">⬡ Takes ' + slots + ' sockets</div>' : '') +
      '<div class="rc-desc">' + DATA.formatDesc(g, upgradeEnv(card.empower)) + '</div>' +
      (card.combo ? '<div class="fpv-note">Advances your combo <b>twice</b>.</div>' : '') +
      '<div class="fgc-cta">Reforge ›</div>';
    return c;
  }

  function buildUpgradeGallery() {
    const grid = $('upgrade-gallery-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const cards = forgeableCards();
    if (!cards.length) { grid.innerHTML = '<span class="upgrade-empty">No forgeable glyphs in your deck.</span>'; return; }
    cards.forEach(card => {
      const c = galleryCard(card);
      c.addEventListener('mouseenter', () => SFX.hover());
      c.addEventListener('click', () => {
        SFX.click();
        upgradeIndex = card.index;
        upgradeType = 'power';
        renderUpgradeDetail();
        showUpgradeView('forge');
      });
      grid.appendChild(c);
    });
  }

  // a full before/after preview card (mirrors the reward-screen glyph card)
  function forgePreviewCard(g, opts) {
    const c = el('div', 'forge-pv color-' + g.color + (opts.after ? ' is-after' : ''));
    c.style.setProperty('--g-color', 'var(--' + g.color + ')');
    const slots = g.slots || 1;
    const badges =
      (opts.empower > 0 ? '<span class="deck-glyph-emp">✦+' + opts.empower + '</span>' : '') +
      (opts.combo ? '<span class="deck-glyph-combo">▲▲</span>' : '');
    c.innerHTML =
      badges + letterChipHTML(g) +
      '<div class="fpv-tag">' + (opts.after ? 'Forged' : 'Now') + '</div>' +
      '<div class="gr-art">' + glyphArtHTML(g) + '</div>' +
      '<div class="rc-name">' + g.name + '</div>' +
      (slots > 1 ? '<div class="rc-slots">⬡ Takes ' + slots + ' sockets</div>' : '') +
      '<div class="rc-desc">' + DATA.formatDesc(g, upgradeEnv(opts.empower)) + '</div>' +
      (opts.comboNote ? '<div class="fpv-note">Advances your combo <b>twice</b>.</div>' : '');
    return c;
  }

  function renderUpgradeDetail() {
    const pane = $('upgrade-forge-body');
    if (!pane || upgradeIndex < 0) return;
    pane.classList.remove('forging');   // clear any leftover strike state
    const id = State.pool[upgradeIndex];
    const g = gdef(id);
    const curEmp = empowerOf(id);
    const hasCombo = comboUpOf(id);
    const powerAvail = forgePowerOf(id) < 1;      // Power forging is capped at 1 per glyph
    const comboAvail = !!g.letter && !hasCombo;   // Combo Up is a one-time upgrade
    if (upgradeType === 'power' && !powerAvail) upgradeType = comboAvail ? 'combo' : 'power';
    if (upgradeType === 'combo' && !comboAvail) upgradeType = powerAvail ? 'power' : 'combo';
    const maxedOut = !powerAvail && !comboAvail;

    pane.innerHTML =
      '<div class="ud-name">' + g.name + '</div>' +
      '<div class="ud-toggle">' +
        '<button class="ud-tab' + (upgradeType === 'power' ? ' active' : '') + (powerAvail ? '' : ' disabled') + '" data-t="power">⬆ Power Up</button>' +
        '<button class="ud-tab' + (upgradeType === 'combo' ? ' active' : '') + (comboAvail ? '' : ' disabled') + '" data-t="combo">▲▲ Combo Up</button>' +
      '</div>' +
      '<div class="ud-hint"></div>' +
      '<div class="ud-cmp"></div>' +
      '<button class="btn btn-primary ud-forge"' + (maxedOut ? ' disabled' : '') + '>' + (maxedOut ? 'Fully Forged' : '⚒ Forge ' + g.name) + '</button>';

    // toggle wiring
    pane.querySelectorAll('.ud-tab').forEach(tab => {
      if (tab.classList.contains('disabled')) return;
      tab.addEventListener('mouseenter', () => SFX.hover());
      tab.addEventListener('click', () => {
        const t = tab.getAttribute('data-t');
        if (t === upgradeType) return;
        upgradeType = t; SFX.click(); renderUpgradeDetail();
      });
    });

    // before -> after comparison
    const cmp = pane.querySelector('.ud-cmp');
    const hint = pane.querySelector('.ud-hint');
    const before = forgePreviewCard(g, { empower: curEmp, combo: hasCombo, after: false, comboNote: hasCombo });
    let after;
    if (maxedOut) {
      hint.innerHTML = 'This glyph is <b>fully forged</b> — Power and Combo are both maxed.';
      after = forgePreviewCard(g, { empower: curEmp, combo: hasCombo, after: true, comboNote: hasCombo });
    } else if (upgradeType === 'power') {
      hint.innerHTML = 'Adds <b>+1</b> to this card\'s effect.';
      after = forgePreviewCard(g, { empower: curEmp + 1, combo: hasCombo, after: true, comboNote: hasCombo });
    } else {
      hint.innerHTML = 'This card advances your combo <b>twice</b> instead of once.';
      after = forgePreviewCard(g, { empower: curEmp, combo: true, after: true, comboNote: true });
    }
    const arrow = el('div', 'ud-arrow', '➜');
    cmp.appendChild(before); cmp.appendChild(arrow); cmp.appendChild(after);

    const forgeBtn = pane.querySelector('.ud-forge');
    forgeBtn.addEventListener('mouseenter', () => SFX.hover());
    forgeBtn.addEventListener('click', () => {
      if (pane.classList.contains('forging')) return;   // already mid-strike
      if (maxedOut) return;                              // nothing left to forge
      const afterEl = pane.querySelector('.forge-pv.is-after');
      const idx = upgradeIndex, type = upgradeType;
      forgeConfirmAnim(afterEl, () => confirmUpgrade(idx, type));
    });
  }

  // the hammer falls: the forged card flares, a gold ring bursts, the rest dims
  function forgeConfirmAnim(afterEl, done) {
    const pane = $('upgrade-forge-body');
    if (!afterEl || !pane) { done(); return; }
    pane.classList.add('forging');
    SFX.act();

    // expanding gold ring around the forged card
    const ring = el('div', 'forge-ring forge-ring-gold');
    afterEl.appendChild(ring);

    // a screen-wide bloom of forge-light
    const bloom = el('div', 'forge-bloom');
    $('upgrade-modal').appendChild(bloom);

    // a few sparks leaping off the anvil
    for (let i = 0; i < 10; i++) {
      const sp = el('div', 'forge-spark');
      const ang = (Math.PI * 2 * i) / 10 + Math.random() * 0.5;
      const dist = 120 + Math.random() * 110;
      sp.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      sp.style.setProperty('--dy', (Math.sin(ang) * dist - 40) + 'px');
      sp.style.animationDelay = (Math.random() * 90) + 'ms';
      afterEl.appendChild(sp);
    }

    if (typeof afterEl.animate === 'function') {
      afterEl.animate(
        [
          { transform: 'scale(1)', filter: 'brightness(1)' },
          { transform: 'scale(1.13)', filter: 'brightness(2.4)', offset: 0.28 },
          { transform: 'scale(0.96)', filter: 'brightness(1.3)', offset: 0.6 },
          { transform: 'scale(1)', filter: 'brightness(1)' }
        ],
        { duration: 760, easing: 'cubic-bezier(.3,1.5,.5,1)' }
      );
    }

    // strike settles, then the whole forge fades away (card lifts & brightens)
    const modal = $('upgrade-modal');
    setTimeout(() => {
      if (bloom.parentNode) bloom.remove();
      if (modal) modal.classList.add('forge-exit');
      setTimeout(done, 480);
    }, 900);
  }

  // generic pick-one card (used by the Rest screen)
  function rewardCard(kind, icon, name, desc, color, onPick) {
    const c = el('div', 'reward-card');
    c.innerHTML = `
      <div class="rc-kind">${kind}</div>
      <div class="rc-icon" style="color:${color}">${icon}</div>
      <div class="rc-name">${name}</div>
      <div class="rc-desc">${desc}</div>`;
    c.addEventListener('mouseenter', () => SFX.hover());
    c.addEventListener('click', () => { SFX.reward(); onPick(); });
    return c;
  }

  // ============================================================
  // REST SCREEN
  // ============================================================
  function buildRest() {
    const row = $('rest-row');
    row.innerHTML = '';
    const am = activeMonster();

    row.appendChild(rewardCard('Recover', '🔥', 'Bank the Fire',
      'Heal your active beast (' + am.name + ') for 60% of its max health.',
      'var(--red)', () => {
        am.hp = Math.min(am.maxHp, am.hp + Math.ceil(am.maxHp * 0.6));
        SFX.reward(); finishReward();
      }));

    row.appendChild(rewardCard('Train', '🌀', 'Hone the Beast',
      'Spin the training wheel for a <b>permanent</b> boon — +1 Block at turn start, +1 Strength, or +5% max HP.',
      'var(--blue)', () => { restTrainRoulette(); }));

    row.appendChild(rewardCard('Forge', '🜲', 'Whet the Glyphs',
      'Permanently empower a random glyph in your deck (+1 to its effect) for the rest of the run.',
      'var(--gold)', () => {
        const r = empowerRandomGlyph();
        if (!r) { SFX.reward(); finishReward(); return; }
        showRevealScene({
          title: 'Glyph Empowered', sub: 'The forge-fire bonds to one of your glyphs…',
          forge: true,
          cards: [glyphRevealCard(r.g, { empower: r.empower, kind: 'Empowered', forge: true })],
          onClaim: finishReward
        });
      }));
  }

  // ---- TRAIN: a case-opening style roulette that lands on a permanent boon ----
  const TRAIN_BOONS = [
    { id: 'block', icon: '🛡', name: 'Iron Discipline', color: '#5ab6ff',
      desc: '+1 Block at the start of every turn — permanently.',
      apply: m => { m.runTurnShield = (m.runTurnShield || 0) + 1; } },
    { id: 'str', icon: '⚔', name: 'Killing Edge', color: '#ff6a4a',
      desc: '+1 Strength — permanently.',
      apply: m => { m.runStrength = (m.runStrength || 0) + 1; } },
    { id: 'hp', icon: '❤', name: 'Hardened Body', color: '#7ee07a',
      desc: m => { const inc = Math.ceil(m.maxHp * 0.05); return '+' + inc + ' max HP (5%) — and heal that much.'; },
      apply: m => { const inc = Math.ceil(m.maxHp * 0.05); m.maxHp += inc; m.hp = Math.min(m.maxHp, m.hp + inc); } }
  ];
  function trainCellHTML(b) {
    return '<div class="train-cell" style="--tc:' + b.color + '">' +
      '<div class="tc-icon">' + b.icon + '</div>' +
      '<div class="tc-name">' + b.name + '</div></div>';
  }
  function restTrainRoulette() {
    const m = activeMonster();
    const CELL = 176, reps = 16;
    const overlay = el('div', 'train-overlay');
    overlay.innerHTML =
      '<div class="train-panel">' +
        '<div class="train-kicker">TRAIN</div>' +
        '<h2 class="train-title">Hone the Beast</h2>' +
        '<div class="train-viewport"><div class="train-strip"></div><div class="train-pointer"></div></div>' +
        '<div class="train-result"></div>' +
        '<button class="btn train-claim" style="visibility:hidden">Claim</button>' +
      '</div>';
    document.body.appendChild(overlay);

    const strip = overlay.querySelector('.train-strip');
    const seq = [];
    for (let r = 0; r < reps; r++) for (let i = 0; i < TRAIN_BOONS.length; i++) seq.push(i);
    strip.innerHTML = seq.map(i => trainCellHTML(TRAIN_BOONS[i])).join('');

    const winner = Math.floor(Math.random() * TRAIN_BOONS.length);
    let landing = (reps - 2) * TRAIN_BOONS.length;
    while (seq[landing] !== winner) landing++;

    requestAnimationFrame(() => {
      const vp = overlay.querySelector('.train-viewport').clientWidth;
      const jitter = (Math.random() * 2 - 1) * (CELL * 0.3);
      const target = landing * CELL + CELL / 2 - vp / 2 + jitter;
      strip.style.transition = 'transform 3.6s cubic-bezier(.12,.74,.16,1)';
      strip.style.transform = 'translateX(' + (-target) + 'px)';
    });
    SFX.click();
    [200, 700, 1300, 1900, 2400, 2800, 3150, 3400, 3560].forEach(t => setTimeout(() => SFX.hover && SFX.hover(), t));

    let settled = false;
    const finish = () => {
      if (settled) return; settled = true;
      const cells = strip.querySelectorAll('.train-cell');
      if (cells[landing]) cells[landing].classList.add('won');
      const b = TRAIN_BOONS[winner];
      const desc = (typeof b.desc === 'function') ? b.desc(m) : b.desc;
      const res = overlay.querySelector('.train-result');
      res.innerHTML = '<div class="tr-name" style="color:' + b.color + '">' + b.icon + ' ' + b.name + '</div>' +
        '<div class="tr-desc">' + desc + '</div>';
      res.classList.add('show');
      SFX.reward();
      const btn = overlay.querySelector('.train-claim');
      btn.style.visibility = 'visible';
      btn.addEventListener('click', () => {
        SFX.click();
        b.apply(m); updateTopbar();
        overlay.classList.add('closing');
        setTimeout(() => overlay.remove(), 320);
        finishReward();
      });
    };
    strip.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 3900);   // guard in case transitionend doesn't fire
  }

  // ============================================================
  // SHARED RUN-EFFECT HELPERS  (used by events, shop, rest)
  // ============================================================
  const SLOT_NAME = { devil: 'Devil', catalyst: 'Catalyst', repeat: 'Repeat', hold: 'Hold', clone: 'Clone', empower: 'Empower', loopback: 'Loop', upgrade: 'Upgrade' };
  // icon + label + hover description per slot type (mirrors battle's SLOT_META)
  // for the forge modal so hovering a special slot explains what it does.
  const SLOT_INFO = {
    normal: null,
    loopback: { icon: '↻', label: 'Loop', tip: 'Holds no glyph. When the chain reaches it, every glyph already played this turn resolves <b>again</b>, then the chain continues.' },
    repeat: { icon: '×2', label: 'Repeat', tip: 'The glyph placed here resolves <b>twice</b>.' },
    hold: { icon: '⏸', label: 'Hold', tip: 'The glyph placed here is <b>not discarded</b> — it returns next turn as a bonus card that doesn\'t reduce your draw.' },
    catalyst: { icon: '✦', label: 'Catalyst', tip: 'Infuses the <b>next</b> glyph by the color placed here — Red: 3 damage to all · Blue: 3 block · Green: heal 6.' },
    devil: { icon: '<img class="devil-emote" src="assets/Happy Devil.png" alt="">', label: 'Devil', tip: 'Each turn it <b>craves a specific glyph</b> (shown on the socket) and hides a random <b>boon</b>. Play that glyph here to claim the boon — any other glyph just resolves as normal, no harm done. <b>Ignore it 3 turns running</b> and it bites you for <b>1/3 of your max HP</b>, then craves anew. The hungrier it gets, the rarer the boons it offers.' },
    clone: { icon: '⧉', label: 'Clone', tip: 'Copies the glyph into your <b>next hand</b>, empowered <b>+1</b>. The copy is one-shot.' },
    empower: { icon: '⊕', label: 'Empower', tip: 'Bolsters the glyphs resolved <b>immediately before and after</b> it by <b>+1</b>.' },
    upgrade: { icon: '⬆', label: 'Upgrade', tip: 'Every glyph resolved here gains <b>+1 empower</b> for the rest of the battle — and it keeps stacking with each play.' },
    combo: { icon: '⛓', label: 'Combo', tip: 'The glyph placed here sets your combo to <b>double</b> the running combo so far (a fresh chain starts at <b>2</b>), then the chain keeps climbing.' }
  };
  // build the hover tooltip body for one or more slot types (forge modal)
  function slotTipHTMLOf(list) {
    const order = [], counts = {};
    list.forEach(t => { if (!counts[t]) { counts[t] = 0; order.push(t); } counts[t]++; });
    return order.map(t => {
      const info = SLOT_INFO[t];
      if (!info) return '';
      return '<b class="st-name">' + info.label + (counts[t] > 1 ? ' ×' + counts[t] : '') + ' Socket</b>' + (info.tip || '');
    }).join('<br>');
  }

  // ---- hybrid sockets: a slotTypes entry is 'normal', a plain special string,
  // or an ARRAY of up to 3 special types (duplicates allowed; Devil never mixes)
  function slotListOf(v) {
    if (Array.isArray(v)) return v;
    if (!v || v === 'normal') return [];
    return [v];
  }
  function slotLabelOf(v) {
    const list = slotListOf(v);
    if (!list.length) return 'Normal';
    const order = [], counts = {};
    list.forEach(t => { if (!counts[t]) { counts[t] = 0; order.push(t); } counts[t]++; });
    return order.map(t => (SLOT_INFO[t] ? SLOT_INFO[t].label : t) + (counts[t] > 1 ? ' ×' + counts[t] : '')).join(' · ');
  }

  // ============================================================
  // SOCKET FORGE MODAL — celebrate a new socket / a reforged slot
  // ============================================================
  function paintSocketTile(t, type, num) {
    const list = slotListOf(type);
    const primary = list.length ? list[0] : 'normal';
    t.className = 'socket modal-socket slot-' + primary + (list.length > 1 ? ' slot-hybrid' : '');
    let badge = '';
    if (list.length) {
      const order = [], counts = {};
      list.forEach(x => { if (!counts[x]) { counts[x] = 0; order.push(x); } counts[x]++; });
      const icons = order.map(x =>
        '<span class="sb-ic">' + SLOT_INFO[x].icon + (counts[x] > 1 ? '<i>×' + counts[x] + '</i>' : '') + '</span>').join('');
      // the slot-tip rides as a direct child of the tile so hovering ANYWHERE on
      // the special slot reveals its description (centered over the tile)
      badge = '<div class="slot-badge' + (order.length > 1 ? ' multi' : '') + '">' + icons + '</div>' +
        '<div class="slot-type-name">' + slotLabelOf(type) + '</div>' +
        '<div class="slot-tip modal-slot-tip">' + slotTipHTMLOf(list) + '</div>';
    }
    t.innerHTML =
      '<img class="slot-img" src="assets/Base Rune.png" alt="">' +
      '<span class="socket-num">' + num + '</span>' + badge;
  }

  function showSocketModal(opts) {
    const m = activeMonster();
    if (!m) return;
    const modal = $('socket-modal'), row = $('socket-modal-row');
    if (!modal || !row) return;
    row.innerHTML = '';
    const tiles = [];
    // a forge-into-Devil renders in the PRE-reorder order so the morph lands on
    // the right tile; the live data is already reordered (devil pinned to back).
    const types = opts.renderTypes || m.slotTypes;
    for (let i = 0; i < m.sockets; i++) {
      const t = el('div', 'socket modal-socket');
      // the slot being reforged shows its OLD shape first, then morphs
      const shown = (opts.mode === 'forge' && i === opts.index) ? opts.fromType : (types[i] || 'normal');
      paintSocketTile(t, shown, i + 1);
      tiles.push(t); row.appendChild(t);
    }

    if (opts.mode === 'gain') {
      $('socket-modal-title').textContent = (opts.count > 1) ? 'New Sockets Forged' : 'A New Socket Forged';
      $('socket-modal-sub').innerHTML = '<b>' + m.name + '</b> gains ' +
        (opts.count > 1 ? '<b>' + opts.count + '</b> new sockets' : 'a new socket') +
        ' — more room to chain glyphs each turn.';
    } else {
      $('socket-modal-title').textContent = 'A Socket Reshapes';
      $('socket-modal-sub').innerHTML = 'Socket <b>' + (opts.index + 1) + '</b> of <b>' + m.name +
        '</b> is reforged into a <b>' + slotLabelOf(opts.toType) + '</b> slot' +
        (opts.reorder ? ' — and is drawn to the <b>back</b> of the chain.' : '.');
    }

    modal.classList.remove('hidden', 'closing');
    SFX.reward();

    requestAnimationFrame(() => {
      if (opts.mode === 'gain') {
        (opts.indices || []).forEach((idx, k) => {
          const t = tiles[idx];
          if (!t) return;
          t.style.animationDelay = (k * 170) + 'ms';
          t.classList.add('socket-incoming');
          const ring = el('div', 'forge-ring'); t.appendChild(ring);
          setTimeout(() => ring.remove(), 800 + k * 170);
        });
      } else {
        const t = tiles[opts.index];
        if (t) morphSocketTile(t, opts.toType, opts.index + 1);
        // once the new Devil shape has set, slide the chain into its final order
        if (opts.reorder) setTimeout(() => flipReorderTiles(row, opts.reorder), 1300);
      }
    });
  }

  // FLIP: reorder the modal's socket tiles to `order` (old indices in their new
  // arrangement) with a smooth slide, renumbering as they settle.
  function flipReorderTiles(row, order) {
    const kids = Array.from(row.children);
    const firstLeft = kids.map(k => k.getBoundingClientRect().left);
    order.forEach(oldIdx => row.appendChild(kids[oldIdx]));   // commit new DOM order
    const moved = order.map(oldIdx => kids[oldIdx]);
    moved.forEach((k, ni) => {
      const dx = firstLeft[order[ni]] - k.getBoundingClientRect().left;
      k.style.transition = 'none';
      k.style.transform = 'translateX(' + dx + 'px)';
      const num = k.querySelector('.socket-num'); if (num) num.textContent = ni + 1;
    });
    requestAnimationFrame(() => moved.forEach(k => {
      k.style.transition = 'transform .55s cubic-bezier(.2,.85,.3,1)';
      k.style.transform = '';
    }));
    // once the slide has settled, a small flourish as the devil lands at the back
    const devilTile = moved[moved.length - 1];
    setTimeout(() => {
      devilTile.style.transition = ''; devilTile.style.transform = '';
      devilTile.classList.remove('forge-shake'); void devilTile.offsetWidth;
      devilTile.classList.add('forge-shake'); SFX.act();
    }, 640);
  }

  function morphSocketTile(t, toType, num) {
    t.classList.add('forge-shake');
    const ring = el('div', 'forge-ring'); t.appendChild(ring);
    setTimeout(() => ring.remove(), 650);
    setTimeout(() => {
      SFX.act();   // the forge "clang" as the new shape sets
      paintSocketTile(t, toType, num);
      t.classList.add('socket-incoming');
      const ring2 = el('div', 'forge-ring forge-ring-gold'); t.appendChild(ring2);
      setTimeout(() => ring2.remove(), 800);
    }, 460);
  }

  function hideSocketModal() {
    const modal = $('socket-modal');
    if (!modal || modal.classList.contains('hidden')) return;
    // fade the overlay out so the screen behind doesn't snap back in
    modal.classList.add('closing');
    setTimeout(() => { modal.classList.remove('closing'); modal.classList.add('hidden'); }, 320);
  }

  // ---- "what you won" reveal scene (animated glyph / blessing / forge) ----
  // spec: { title, sub, forge?, bad?, onClaim?, cards:[ {kind,name,desc,color,art,up,forge,bad,claimKind} ] }
  // onClaim runs AFTER the claim animation finishes — used to queue a follow-up
  // reveal (e.g. card first, then a new socket) instead of stacking them at once.
  let revealClaiming = false;
  function showRevealScene(spec) {
    const modal = $('reveal-modal');
    if (!modal) return;
    revealPending = spec.onClaim || null;
    revealClaiming = false;
    modal.classList.remove('claiming', 'show');
    modal.classList.toggle('bad', !!spec.bad);
    const btn = $('btn-reveal-claim');
    if (btn) btn.textContent = spec.claimLabel || (spec.bad ? 'Move On' : 'Claim');
    $('reveal-title').textContent = spec.title || 'Spoils';
    $('reveal-sub').innerHTML = spec.sub || '';
    const row = $('reveal-cards');
    row.innerHTML = '';
    (spec.cards || []).forEach(card => {
      const c = el('div', 'reveal-card' + (card.forge ? ' forging' : '') + (card.bad ? ' bad' : ''));
      c.style.setProperty('--g-color', card.color || 'var(--gold)');
      c.innerHTML =
        (card.forge ? '<div class="reveal-forge-ring"></div>' : '') +
        (card.up ? '<div class="rv-up">' + card.up + '</div>' : '') +
        '<div class="rv-kind">' + (card.kind || 'Reward') + '</div>' +
        '<div class="rv-art">' + (card.art || (card.icon || '✦')) + '</div>' +
        '<div class="rv-name">' + card.name + '</div>' +
        '<div class="rv-desc">' + (card.desc || '') + '</div>';
      row.appendChild(c);
    });
    modal.classList.remove('hidden');
    requestAnimationFrame(() => modal.classList.add('show'));
    if (spec.bad) { SFX.death && SFX.death(); }
    else if (spec.forge) { SFX.act(); setTimeout(() => SFX.act(), 800); }
    else { SFX.reward(); }
  }
  let revealPending = null;
  // claim = a satisfying "it's yours now" beat: cards pull toward you and vanish,
  // then the scene clears and any queued follow-up reveal fires
  function claimRevealScene() {
    const modal = $('reveal-modal');
    if (!modal || revealClaiming || modal.classList.contains('hidden')) return;
    revealClaiming = true;
    const isBad = modal.classList.contains('bad');
    if (isBad) SFX.click(); else SFX.reward();
    modal.classList.add('claiming');
    const cards = Array.from($('reveal-cards').children);
    cards.forEach((c, i) => { c.style.animationDelay = (i * 80) + 'ms'; });
    const cardsTime = 620 + cards.length * 80;
    // drop 'show' BEFORE hiding so the whole modal (backdrop + glow, incl. the
    // negative scene's red wash) fades out via its opacity transition instead of
    // snapping to display:none. This overlaps the tail of the card animation.
    const fadeAt = Math.max(150, cardsTime - 300);
    setTimeout(() => { modal.classList.remove('show'); }, fadeAt);
    setTimeout(() => {
      modal.classList.remove('claiming');
      modal.classList.add('hidden');
      const follow = revealPending; revealPending = null; revealClaiming = false;
      if (follow) follow();
    }, fadeAt + 420);
  }
  function hideRevealScene() { claimRevealScene(); }
  // build a reveal-card spec from a glyph definition
  function glyphRevealCard(g, opts) {
    opts = opts || {};
    return {
      kind: opts.kind || (g.color + ' glyph'),
      name: g.name,
      color: 'var(--' + g.color + ')',
      art: glyphArtHTML(g),
      desc: DATA.formatDesc(g, metaEnv(g.id)),
      up: opts.empower ? '✦+' + opts.empower : '',
      forge: !!opts.forge,
      bad: !!opts.bad
    };
  }
  // reveal-card specs for the other reward kinds, so event blessings/items get the
  // same "it appears, claim it" beat the reward screen and dice events already use
  function blessRevealCard(b, opts) {
    opts = opts || {};
    return {
      kind: opts.kind || 'Charm', name: b.name, color: 'var(--purple)',
      art: blessArtHTML(b), desc: b.desc
    };
  }
  function itemRevealCard(it, opts) {
    opts = opts || {};
    return {
      kind: opts.kind || 'Item', name: it.name, color: 'var(--gold)',
      art: itemArtHTML(it), desc: it.desc
    };
  }

  function nonJunkPool() {
    const seen = {}; const ids = [];
    State.pool.forEach(id => { const b = baseOf(id); if (!GLYPHS[b].junk && !seen[b]) { seen[b] = 1; ids.push(b); } });
    return ids;
  }
  // permanently empower ONE card in the deck (+1 to its main effect)
  function empowerRandomGlyph() {
    const idxs = [];
    State.pool.forEach((id, i) => { if (!gdef(id).junk) idxs.push(i); });
    if (!idxs.length) return null;
    const index = rng(idxs);
    const inst = ensureInstance(index);
    State.empower[inst] = (State.empower[inst] || 0) + 1;
    return { g: gdef(inst), empower: State.empower[inst] };
  }
  // Devil sockets used to be pinned to the END of the chain. That rule is gone —
  // a Devil can live anywhere now — so this is an identity pass-through that
  // leaves the socket order untouched (kept for the callers' { changed, map, order }).
  function reorderDevilsLast(m) {
    const types = m.slotTypes || [];
    const order = types.map((_, i) => i);
    const map = order.slice();
    return { changed: false, map: map, order: order };
  }
  // forge a special power onto one of the active beast's sockets. A normal
  // socket takes its first type (possibly Devil); already-special sockets can
  // take ANOTHER type on top — hybrids of up to 3, duplicates allowed and they
  // stack. Devil never mixes: it only claims a fully normal socket, whole.
  function forgeRandomSlot() {
    const m = activeMonster();
    while (m.slotTypes.length < m.sockets) m.slotTypes.push('normal');
    const open = [];
    m.slotTypes.forEach((t, i) => {
      if (slotListOf(t).length < 3) open.push(i);   // room for one more type
    });
    if (!open.length) return null;
    const i = rng(open);
    const cur = slotListOf(m.slotTypes[i]);
    // Devil can now share a socket like any other power. (Pure Loop stays a born
    // trait — forging one would eat a glyph slot, which feels like a downgrade.)
    // Avoid stacking a second Devil onto the same socket — one craving per slot.
    const pool = ['catalyst', 'repeat', 'hold', 'clone', 'empower'];
    if (cur.indexOf('devil') === -1) pool.push('devil');
    const nt = rng(pool);
    const fromVal = m.slotTypes[i];
    const next = cur.concat([nt]);
    m.slotTypes[i] = next.length === 1 ? nt : next;
    showSocketModal({ mode: 'forge', index: i, fromType: fromVal, toType: m.slotTypes[i] });
    return { i: i, name: slotLabelOf(m.slotTypes[i]) };
  }
  function healActive(frac) {
    const m = activeMonster();
    const before = m.hp;
    frac = frac * (descensionEffects().healMul || 1);   // Descension: Withering etc.
    m.hp = Math.min(m.maxHp, m.hp + Math.ceil(m.maxHp * frac));
    updateTopbar();
    return m.hp - before;
  }
  function gainSocket(n) {
    const m = activeMonster();
    // hard universal cap: a beast can never exceed 9 sockets, no matter the
    // source (rewards, events, shops, blessings…)
    const add = Math.min(n || 1, Math.max(0, MAX_SOCKETS - m.sockets));
    if (add <= 0) { updateTopbar(); return; }
    const startIdx = m.sockets;
    m.sockets += add;
    while (m.slotTypes.length < m.sockets) m.slotTypes.push('normal');
    const newOld = [];
    for (let k = 0; k < add; k++) newOld.push(startIdx + k);
    // new sockets come in as normals; keep any Devil slot pinned to the back
    const r = reorderDevilsLast(m);
    updateTopbar();
    const indices = newOld.map(oi => r.map[oi]);
    showSocketModal({ mode: 'gain', count: add, indices: indices });
  }
  function harmActive(amount) {
    const m = activeMonster();
    m.hp = Math.max(1, m.hp - amount);   // events never outright kill
    updateTopbar();
  }
  // a free glyph the active beast can actually use. Returns the glyph def, and
  // remembers the pool index of the copy just added (for optional empower).
  let lastGainedIndex = -1;
  function gainRandomGlyph() {
    const g = offerGlyphs(1)[0];
    State.pool.push(g.id);
    lastGainedIndex = State.pool.length - 1;
    return g;
  }
  // empower the most recently gained card (one specific copy)
  function empowerLastGained() {
    if (lastGainedIndex < 0 || lastGainedIndex >= State.pool.length) return;
    const inst = ensureInstance(lastGainedIndex);
    State.empower[inst] = (State.empower[inst] || 0) + 1;
  }

  // ============================================================
  // BLESSING DRAFT  (start-of-run "story" beat: pick 1 of 3)
  // ============================================================
  function blessingCard(bl, onPick) {
    const c = el('div', 'reward-card bless-draft');
    c.style.setProperty('--g-color', 'var(--purple)');
    c.innerHTML = `
      <div class="rc-kind">Blessing</div>
      <div class="rc-icon${blessHasImg(bl) ? ' has-img' : ''}" style="color:var(--purple)">${blessArtHTML(bl)}</div>
      <div class="rc-name">${bl.name}</div>
      <div class="rc-desc">${bl.desc}</div>`;
    c.addEventListener('mouseenter', () => SFX.hover());
    c.addEventListener('click', () => { SFX.reward(); onPick(); });
    return c;
  }
  function buildBlessingDraft() {
    const am = activeMonster();
    $('blessing-head').textContent = 'The First Ember';
    $('blessing-sub').innerHTML = 'Before <b>' + am.name + '</b> sets out, the old fire grants one gift. Choose the blessing that will shape your run.';
    const row = $('blessing-row');
    row.innerHTML = '';
    // 3 distinct blessings from the standard pool, skipping any already owned.
    // Extra-socket blessings are barred from the opening draft — a free starting
    // socket warps early balance (esp. Ghoul's ramp). They still appear at elites/shops.
    const pool = Object.values(BLESSINGS).filter(b =>
      contentUnlocked(b) &&
      b.effect !== 'socket' && b.effect !== 'twinsocket' &&
      !(b.scope === 'run' && State.blessings[b.id]));
    const picks = [];
    const bag = pool.slice();
    while (picks.length < 3 && bag.length) picks.push(bag.splice(Math.floor(Math.random() * bag.length), 1)[0]);
    picks.forEach(bl => {
      row.appendChild(blessingCard(bl, () => {
        applyBlessing(bl);
        renderMap();
        show('screen-map');
      }));
    });
  }

  // ============================================================
  // EVENTS  (boon / optional risk / three-select boon)
  // ============================================================
  // render a generic event: title + blurb + a row of choice cards
  function showEvent(def) {
    $('event-emoji').textContent = def.emoji;
    $('event-head').textContent = def.title;
    $('event-blurb').innerHTML = def.blurb;
    const row = $('event-row');
    row.innerHTML = '';
    def.choices.forEach(ch => {
      const c = el('div', 'reward-card event-choice');
      c.style.setProperty('--g-color', ch.color || 'var(--gold)');
      c.innerHTML = `
        <div class="rc-kind">${ch.tag || 'Choice'}</div>
        <div class="rc-icon" style="color:${ch.color || 'var(--gold)'}">${ch.icon || '✦'}</div>
        <div class="rc-name">${ch.name}</div>
        <div class="rc-desc">${ch.desc}</div>`;
      c.addEventListener('mouseenter', () => SFX.hover());
      c.addEventListener('click', () => {
        SFX.reward();
        const res = ch.resolve(c);   // resolve returns a result line OR { text, reveal }
        // a choice that hands off to combat (or otherwise leaves this screen)
        // returns { skip:true } so we don't paint a stale outcome panel behind it
        if (res && res.skip) return;
        if (res && typeof res === 'object') {
          showEventResult(res.text);
          if (res.reveal) showRevealScene(res.reveal);
        } else {
          showEventResult(res);
        }
      });
      row.appendChild(c);
    });
  }
  // replace the choices with an outcome panel + Continue -> map
  function showEventResult(html) {
    $('event-blurb').innerHTML = html || 'You move on.';
    const row = $('event-row');
    row.innerHTML = '';
    const cont = el('button', 'btn btn-primary', 'Continue');
    // if this choice spilled souls, let the gold finish flying into your counter first
    cont.disabled = true;
    cont.classList.add('is-waiting');
    whenCoinsIdle(() => { cont.disabled = false; cont.classList.remove('is-waiting'); });
    cont.addEventListener('click', () => { if (cont.disabled) return; SFX.click(); renderMap(); show('screen-map'); });
    row.appendChild(cont);
  }

  // The three starter events.
  function eventSpirit() {   // BOON — pure upside, single accept
    const reward = 14;
    showEvent({
      emoji: '🦌', title: 'The Wandering Spirit',
      blurb: 'A pale emberkin drifts from the mist. It presses a glowing hand to your beast and leaves a coil of souls in the ash.',
      choices: [{
        tag: 'Boon', icon: '🌿', name: 'Accept the Blessing', color: 'var(--green)',
        desc: 'Heal your active beast for 45% HP and gain ' + soulsGainPreview(reward) + ' souls.',
        resolve: (card) => {
          const healed = healActive(0.45);
          gainSouls(reward, card ? card.querySelector('.rc-icon') : null);
          return 'The spirit\'s warmth restores <b>' + healed + ' HP</b> and gilds your hands with souls.';
        }
      }]
    });
  }

  function eventGambler() {   // OPTIONAL RISK — gamble or walk away
    const jackpot = 22;
    showEvent({
      emoji: '🎲', title: 'The Gambler\'s Idol',
      blurb: 'A grinning idol rattles a cup of bone dice. <i>"One roll,"</i> it hisses. <i>"Fortune... or folly."</i>',
      choices: [
        {
          tag: 'Risk', icon: '🎲', name: 'Roll the Bones', color: 'var(--red)',
          desc: '55%: gain a free glyph (empowered +1) and ' + soulsGainPreview(jackpot) + ' souls. 45%: take 9 damage and bury 2 Rubble in your deck.',
          resolve: (card) => {
            if (Math.random() < 0.55) {
              const g = gainRandomGlyph();
              empowerLastGained();
              gainSouls(jackpot, card ? card.querySelector('.rc-icon') : null);
              const reveal = {
                title: 'Fortune!', sub: 'The dice blaze gold — the idol coughs up a prize.',
                cards: [ glyphRevealCard(g, { empower: 1, kind: 'New Glyph' }) ]
              };
              // jackpot — the RARE double win also cracks open a socket. Queue the
              // socket forge so it plays AFTER the glyph reveal is claimed.
              if (Math.random() < 0.12) {
                reveal.onClaim = () => gainSocket(1);
                return { text: 'Jackpot! The dice blaze gold — <b>' + g.name + '</b> (empowered), a fistful of souls, <b>and a new socket</b>.', reveal: reveal };
              }
              return { text: 'Fortune! The dice blaze gold — you win <b>' + g.name + '</b> (empowered) and a fistful of souls.', reveal: reveal };
            }
            harmActive(9);
            State.pool.push('rubble', 'rubble');
            return {
              text: 'Folly. The idol cackles as <b>2 Rubble</b> clatter into your deck and the dice bite for <b>9</b>.',
              reveal: {
                title: 'Folly', sub: 'The bones turn against you.', bad: true,
                cards: [
                  glyphRevealCard(gdef('rubble'), { kind: 'Junk ×2', bad: true }),
                  { kind: 'Wound', name: '9 Damage', color: 'var(--red)', icon: '💔', desc: 'The dice bite deep into your beast.', bad: true }
                ]
              }
            };
          }
        },
        {
          tag: 'Safe', icon: '🚶', name: 'Pocket Your Luck', color: 'var(--text-dim)',
          desc: 'Walk away. Nothing ventured, nothing lost.',
          resolve: () => 'You step past the idol. Its laughter fades behind you.'
        }
      ]
    });
  }

  function eventTrial() {   // THREE-SELECT BOON — pick 1 of 3 permanent gifts
    const am = activeMonster();
    // the third path is RARELY an extra socket, usually a slot reforge
    const socketPath = Math.random() < 0.25;
    const third = socketPath
      ? {
          tag: 'Path', icon: '🜨', name: 'Path of the Vessel', color: 'var(--blue)',
          desc: 'Permanently grant your beast one more glyph socket.',
          resolve: () => {
            // an exceedingly rare blessing: the vessel splits open twice
            if (Math.random() < 0.08) {
              gainSocket(2);
              return '<b>' + activeMonster().name + '</b> splits open — and keeps splitting. <b>TWO</b> new sockets!';
            }
            gainSocket(1);
            return '<b>' + activeMonster().name + '</b> splits open a new socket — room for one more glyph.';
          }
        }
      : {
          tag: 'Path', icon: '🜨', name: 'Path of the Forge', color: 'var(--blue)',
          desc: 'Add a random special power to one of your beast\'s sockets — up to three can stack on a single slot.',
          resolve: () => {
            const r = forgeRandomSlot();
            return r ? 'A socket reshapes into a <b>' + r.name + '</b> slot, humming with new purpose.'
                     : 'Every socket already burns with strange power — nothing to reforge.';
          }
        };
    showEvent({
      emoji: '🜲', title: 'The Trial of Three Paths',
      blurb: 'Three braziers flare before <b>' + am.name + '</b>. You may walk only one path — and its mark is permanent.',
      choices: [
        {
          tag: 'Path', icon: '⚔', name: 'Path of Vigor', color: 'var(--red)',
          desc: 'Permanently empower a random glyph in your deck (+1 to its effect).',
          resolve: () => {
            const r = empowerRandomGlyph();
            if (!r) return 'The brazier gutters out — no glyph answered the call.';
            return {
              text: 'The forge-fire bonds to <b>' + r.g.name + '</b> — empowered for the rest of the run.',
              reveal: {
                title: 'Glyph Empowered', sub: 'The forge-fire bonds to one of your glyphs…',
                forge: true,
                cards: [ glyphRevealCard(r.g, { empower: r.empower, kind: 'Empowered', forge: true }) ]
              }
            };
          }
        },
        {
          tag: 'Path', icon: '🜲', name: 'Path of Ascension', color: 'var(--green)',
          desc: 'Evolve your active beast early — enhanced base stats & passive.',
          resolve: () => {
            evolveMonster();
            return '<b>' + activeMonster().name + '</b> rises through the flame, evolved ahead of its time.';
          }
        },
        third
      ]
    });
  }

  // ---- shared helpers for the combat / gift events ----
  // hurt the active beast for a fraction of its MAX hp (never lethal)
  function harmActivePct(frac) {
    const m = activeMonster();
    const before = m.hp;
    harmActive(Math.ceil(m.maxHp * frac));
    return before - m.hp;
  }
  // drop one random carried item; returns its display name (or null if empty-handed)
  function loseRandomItem() {
    const arr = itemsArr();
    if (!arr.length) return null;
    const id = arr[Math.floor(Math.random() * arr.length)];
    removeFirstItem(id);
    updateRunUI();
    return (ITEMS[id] && ITEMS[id].name) || id;
  }
  // grant one of the event-only blessings
  function grantEventBlessing(id) {
    if (State.blessings[id]) { updateRunUI(); return; }
    State.blessings[id] = true;
    // use the SAME flourish as every other reward: bloom mid-screen, then streak
    // up into its top-bar chip (no static "here's a card" panel)
    const b = EVENT_BLESSINGS[id] || allBlessMap()[id];
    if (b) flyBlessingToTopbar(b);
    else updateRunUI();
  }
  // hand an event off to a one-off fight; spec describes the spoils on victory
  function startEventBattle(enemyId, spec) {
    const def = ENEMIES[enemyId];
    if (!def) return;
    root.CG.Battle.start({
      enemies: [def],
      depth: ((State.act || 1) - 1) * 10 + (State.pos.floor || 0),
      onWin: () => onEventBattleWin(spec || {}),
      onLose: () => gameOver(false)
    });
    if (root.CG.Audio && root.CG.Audio.Music) root.CG.Audio.Music.to('battle');
  }
  function onEventBattleWin(spec) {
    State.cleared++;
    buildReward('normal');
    const claims = $('reward-claims');
    if (spec.soulstone) {
      claims.appendChild(claimCard('<img class="cc-icon-img" src="assets/Soulstone Stone.png" alt="" draggable="false">', 'Soulstone',
        'A shard of raw soul. Gather <b>5</b> to evolve <b>' + activeMonster().name + '</b>.',
        'var(--blue)', () => gainSoulstone()));
    }
    if (spec.blessing) {
      const b = EVENT_BLESSINGS[spec.blessing];
      if (b && !State.blessings[b.id]) {
        claims.appendChild(claimCard(blessArtHTML(b), 'Charm',
          '<b>' + b.name + '</b> \u2014 ' + b.desc, 'var(--purple)', () => grantEventBlessing(b.id)));
      }
    }
    show('screen-reward');
  }

  function eventCollector() {   // COMBAT / FLEE / DEAL
    showEvent({
      emoji: '🪤', title: 'The Monster Collector',
      blurb: 'A wiry stranger in a patched coat slips from the trees, uncoiling a net of glittering wire. <i>"Oh, you\'re a fine specimen,"</i> he breathes. <i>"You\'ll fetch a price."</i>',
      choices: [
        {
          tag: 'Fight', icon: '⚔', name: 'Fend Off', color: 'var(--red)',
          desc: 'Battle the collector. Win to claim a <b>Soulstone</b>.',
          resolve: () => { startEventBattle('collector', { soulstone: true }); return { skip: true }; }
        },
        {
          tag: 'Flee', icon: '🏃', name: 'Run', color: 'var(--text-dim)',
          desc: '50% to escape clean. 50% to take <b>20% of max HP</b> in damage.',
          resolve: () => {
            if (Math.random() < 0.5) return 'You bolt through the briar and lose him in the dark.';
            const dmg = harmActivePct(0.20);
            return 'The net snags your hide — you tear free, but it costs you <b>' + dmg + ' HP</b>.';
          }
        },
        {
          tag: 'Deal', icon: '🤝', name: 'Make a Deal', color: 'var(--purple)',
          desc: 'Give up a random item (if you carry one). Gain <b>Fear Braid</b>.',
          resolve: () => {
            const lost = loseRandomItem();
            grantEventBlessing('fearbraid');
            return (lost ? 'You surrender your <b>' + lost + '</b>. ' : 'You carry nothing he wants, so he settles for a pact. ') +
              'He braids a charm of dread into your mane — <b>Fear Braid</b>.';
          }
        }
      ]
    });
  }

  function eventAliens() {   // FORCED COST + BOON
    showEvent({
      emoji: '🛸', title: 'The Shimmering Craft',
      blurb: 'A silent disc of impossible color swallows you in light. You wake strapped to a humming slab as many-hued figures lean close, fascinated by what burns inside you...',
      choices: [{
        tag: 'Abduction', icon: '🔮', name: 'Endure the Experiments', color: 'var(--purple)',
        desc: 'Lose <b>20% of max HP</b>. Gain <b>Shimmering Orb</b>.',
        resolve: () => {
          const dmg = harmActivePct(0.20);
          grantEventBlessing('shimmer');
          return 'They peel something luminous from your soul and seal it in a glass orb. It costs you <b>' + dmg + ' HP</b> — but the orb is yours.';
        }
      }]
    });
  }

  function eventWoman() {   // THREE-SELECT GIFT
    showEvent({
      emoji: '👰', title: 'The Lady in White',
      blurb: 'A woman in flowing white glides between the trees, her feet never touching the earth. She smiles — she finds you <i>darling</i> — and opens a pale hand. Three small things rest there. You may take one.',
      choices: [
        {
          tag: 'Gift', icon: '🪶', name: 'Black Feather', color: 'var(--blue)',
          desc: 'A permanent <b>+3 Resilience</b> at the start of every battle.',
          resolve: () => {
            grantEventBlessing('blackfeather');
            return 'You take the black feather. It sinks into your hide — you feel far harder to break.';
          }
        },
        {
          tag: 'Gift', icon: '💪', name: 'Raw Muscle Fiber', color: 'var(--red)',
          desc: 'A permanent <b>+3 Strength</b> at the start of every battle.',
          resolve: () => {
            grantEventBlessing('rawmuscle');
            return 'You swallow the raw fiber. Strength coils hot through your limbs.';
          }
        },
        {
          tag: 'Gift', icon: '🤍', name: 'Touch Her Hand', color: 'var(--green)',
          desc: 'Refill your active beast to full HP and gain ' + soulsGainPreview(30) + ' souls.',
          resolve: (card) => {
            const m = activeMonster();
            const healed = m.maxHp - m.hp;
            m.hp = m.maxHp;
            updateRunUI();
            gainSouls(30, card ? card.querySelector('.rc-icon') : null);
            return 'You lay your hand in hers. Warmth floods you — <b>' + healed + ' HP</b> knits shut and souls spill from her smile.';
          }
        }
      ]
    });
  }

  function eventHunt() {   // CHOOSE YOUR PREY (two fights)
    showEvent({
      emoji: '🍖', title: 'The Hunt',
      blurb: 'Hunger gnaws at you as you prowl the underbrush. Something fat and slow rustles nearby. What are you craving?',
      choices: [
        {
          tag: 'Prey', icon: '🐀', name: 'Rat', color: 'var(--green)',
          desc: 'Hunt a <b>Giant Rat</b>. Win to gain the <b>Rat Charm</b>.',
          resolve: () => { startEventBattle('giantRat', { blessing: 'ratcharm' }); return { skip: true }; }
        },
        {
          tag: 'Prey', icon: '🐔', name: 'Chicken', color: 'var(--gold)',
          desc: 'Hunt a <b>Giant Chicken</b>. Win to gain the <b>Chicken Charm</b>.',
          resolve: () => { startEventBattle('giantChicken', { blessing: 'chickencharm' }); return { skip: true }; }
        }
      ]
    });
  }

  const EVENTS = [eventSpirit, eventGambler, eventTrial, eventCollector, eventAliens, eventWoman, eventHunt];
  function buildEvent() {
    // pick an event, avoiding an immediate repeat
    let pool = EVENTS.map((fn, i) => i).filter(i => i !== State.lastEvent);
    if (!pool.length) pool = EVENTS.map((_, i) => i);
    const idx = pool[Math.floor(Math.random() * pool.length)];
    State.lastEvent = idx;
    EVENTS[idx]();
  }

  // ============================================================
  // SHOP  (spend souls — glyphs, a blessing, services)
  // ============================================================
  function shopCard(opts) {
    // opts: { kind, icon, name, desc, color, price, soldOut, onBuy, art }
    if (opts.price > 0) {
      const sm = descensionEffects().shopMul || 1;   // Descension: Scarcity
      if (sm !== 1) opts.price = Math.round(opts.price * sm);
    }
    const c = el('div', 'shop-card');
    c.style.setProperty('--g-color', opts.color || 'var(--gold)');
    const art = opts.art || ('<div class="sc-icon" style="color:' + (opts.color || 'var(--gold)') + '">' + opts.icon + '</div>');
    c.innerHTML = `
      ${opts.chip || ''}
      <div class="sc-kind">${opts.kind}</div>
      ${art}
      <div class="sc-name">${opts.name}</div>
      <div class="sc-desc">${opts.desc}</div>
      <div class="sc-price">🪙 <b>${opts.price}</b></div>`;
    const refreshAfford = () => {
      const affordable = State.souls >= opts.price && !c.classList.contains('sold');
      c.classList.toggle('cant-afford', !affordable && !c.classList.contains('sold'));
    };
    refreshAfford();
    c.addEventListener('mouseenter', () => SFX.hover());
    const reject = () => { SFX.error ? SFX.error() : SFX.hover(); c.classList.add('shake-no'); setTimeout(() => c.classList.remove('shake-no'), 350); };
    c.addEventListener('click', () => {
      if (c.classList.contains('sold')) return;
      if (State.souls < opts.price) { reject(); return; }
      // e.g. an item you have no room to carry — block the buy with an error
      if (opts.canBuy && !opts.canBuy()) { reject(); return; }
      SFX.reward();
      spendSouls(opts.price);
      opts.onBuy(c);
      const priceEl = c.querySelector('.sc-price');
      if (opts.repeat) {
        // repeatable purchase (secret-shop stackables): stays buyable, with a
        // running tally, until it actually caps out (e.g. inventory full).
        c._bought = (c._bought || 0) + 1;
        c.classList.add('bought');
        c.classList.remove('just-bought'); void c.offsetWidth; c.classList.add('just-bought');
        if (opts.canBuy && !opts.canBuy()) {
          c.classList.add('sold'); priceEl.innerHTML = 'Full';
        } else {
          priceEl.innerHTML = '✓ \u00D7' + c._bought;
        }
      } else {
        c.classList.add('sold');
        priceEl.innerHTML = 'Sold';
      }
      // re-evaluate affordability of every other card
      $('shop-grid').querySelectorAll('.shop-card').forEach(x => {
        if (!x.classList.contains('sold')) x.classList.toggle('cant-afford', State.souls < (+x.dataset.price || 0));
      });
    });
    c.dataset.price = opts.price;
    return c;
  }

  function buildShop() {
    const am = activeMonster();
    const grid = $('shop-grid');
    grid.innerHTML = '';
    // reset the heading in case the secret-shop debug renamed it
    const sHead = document.querySelector('#screen-shop .reward-head');
    const sSub = document.querySelector('#screen-shop .reward-sub');
    if (sHead) sHead.textContent = 'The Glyph Bazaar';
    if (sSub) sSub.textContent = 'Spend your souls, forger. Click to buy.';

    // --- 3 glyphs for sale ---
    const glyphs = offerGlyphs(3);
    const gPrices = [42, 50, 58];
    glyphs.forEach((g, i) => {
      grid.appendChild(shopCard({
        kind: 'Glyph', name: g.name, color: 'var(--' + g.color + ')',
        art: '<div class="sc-art">' + glyphArtHTML(g) + '</div>', chip: letterChipHTML(g),
        desc: DATA.formatDesc(g, metaEnv(g.id)), price: gPrices[i] || 55,
        onBuy: () => { State.pool.push(g.id); }
      }));
    });

    // --- a blessing (skip ones already owned) ---
    const bless = pickBlessing('cache');
    if (bless) {
      grid.appendChild(shopCard({
        kind: 'Blessing', icon: bless.icon, name: bless.name, color: 'var(--purple)',
        art: '<div class="sc-icon' + (blessHasImg(bless) ? ' has-img' : '') + '" style="color:var(--purple)">' + blessArtHTML(bless) + '</div>',
        desc: bless.desc, price: 88,
        onBuy: () => applyBlessing(bless)
      }));
    }

    // --- a consumable item for sale (only when there's room to carry it) ---
    if (!itemsFull()) {
      const offered = rng(unlockedItems());
      if (offered) {
        grid.appendChild(shopCard({
          kind: 'Item', icon: offered.icon, name: offered.name, color: 'var(--gold)',
          art: '<div class="sc-icon' + (offered.img ? ' has-img' : '') + '" style="color:var(--gold)">' + itemArtHTML(offered) + '</div>',
          desc: offered.desc, price: offered.price,
          canBuy: () => canAddItem(offered.id),
          onBuy: () => { addItem(offered.id); }
        }));
      }
    }

    // --- services ---
    grid.appendChild(shopCard({
      kind: 'Service', icon: '🔥', name: 'Mend Wounds', color: 'var(--red)',
      desc: 'Heal your active beast (' + am.name + ') for 45% of max HP.', price: 28,
      onBuy: () => healActive(0.45)
    }));

    grid.appendChild(shopCard({
      kind: 'Service', icon: '❤', name: 'Reinforce', color: 'var(--green)',
      desc: 'Permanently raise your active beast\'s max HP by 10 (and heal it).', price: 45,
      onBuy: () => { am.maxHp += 10; am.hp += 10; updateTopbar(); }
    }));

    grid.appendChild(shopCard({
      kind: 'Service', icon: '🜨', name: 'Reforge a Slot', color: 'var(--blue)',
      desc: 'Add a random special power to a socket — up to three can stack on one slot (Devil claims a whole socket).', price: 70,
      onBuy: () => forgeRandomSlot()
    }));
    // (whole sockets are no longer for sale — they come from bosses, and
    //  rarely from elites or events, so the chain stays a true reward)

    // --- cleanse (only if there's junk to remove) ---
    const junkCount = State.pool.filter(id => gdef(id).junk).length;
    if (junkCount > 0) {
      grid.appendChild(shopCard({
        kind: 'Service', icon: '🧹', name: 'Cleanse Deck', color: 'var(--gold)',
        desc: 'Remove all junk glyphs (' + junkCount + ') clogging your deck.', price: 40,
        onBuy: () => { State.pool = State.pool.filter(id => !gdef(id).junk); }
      }));
    }
  }

  // ============================================================
  // COLLECTION OVERLAY
  // ============================================================
  const GLYPH_KIND = { red: 'Attack', blue: 'Defense', green: 'Support', purple: 'Hex', gray: 'Junk', white: 'Soul' };
  let deckDetailPinned = null;   // glyph id whose detail card is pinned by a click

  function glyphOwner(gl) {
    if (gl.junk) return 'Forced — clogs your draw';
    if (!gl.character) return 'Neutral';
    const m = (MONSTERS[gl.character] || {});
    return (m.name || gl.character) + ' glyph';
  }

  function showGlyphDetail(gl, count, repId) {
    const d = $('deck-detail');
    if (!d) return;
    repId = repId || gl.id;
    const tags = [];
    if ((gl.slots || 1) > 1) tags.push('Takes ' + gl.slots + ' sockets');
    if (gl.sticky) tags.push('Sticky');
    if (empowerOf(repId) > 0) tags.push('Power +' + empowerOf(repId));
    if (comboUpOf(repId)) tags.push('Combo Up (advances ×2)');
    const art = gl.img
      ? '<img class="dd-img" src="' + gl.img + '" alt="">'
      : '<span class="dd-rune">' + gl.rune + '</span>';
    const letter = gl.letter
      ? '<span class="dd-letter ' + (gl.letter === 'wild' ? 'wild' : 'l-' + gl.letter) + '">' +
        (gl.letter === 'wild' ? '✦ Wild' : gl.letter) + '</span>'
      : '';
    d.className = 'deck-detail deck-detail-panel has-detail color-' + gl.color;
    d.style.setProperty('--g-color', 'var(--' + gl.color + ')');
    d.innerHTML =
      '<div class="dd-inner">' +
        '<div class="dd-art">' + art + '</div>' +
        '<div class="dd-body">' +
          '<div class="dd-name">' + gl.name + (count > 1 ? ' <span class="dd-count">×' + count + '</span>' : '') + '</div>' +
          '<div class="dd-meta"><span class="dd-kind">' + (GLYPH_KIND[gl.color] || gl.color) + '</span>' + letter +
            '<span class="dd-owner">' + glyphOwner(gl) + '</span></div>' +
          '<div class="dd-desc">' + DATA.formatDesc(gl, metaEnv(repId)) + '</div>' +
          (tags.length ? '<div class="dd-tags">' + tags.map(t => '<span>' + t + '</span>').join('') + '</div>' : '') +
        '</div>' +
      '</div>';
  }
  // the panel is always present; "hidden" just swaps to the resting placeholder,
  // which animates in the same way real content does.
  function hideGlyphDetail() {
    const d = $('deck-detail');
    if (!d) return;
    d.className = 'deck-detail deck-detail-panel';
    d.style.removeProperty('--g-color');
    d.innerHTML =
      '<div class="dd-inner dd-empty">' +
        '<span class="dd-empty-rune">❖</span>' +
        '<span class="dd-empty-text">Hover over a Glyph or Socket<br>to Inspect it</span>' +
      '</div>';
  }

  // the evolution ladder: Current → ??? → ??? — future forms stay a mystery to
  // build anticipation, gated by the Soulstone meter (5 → next evolution).
  function evolutionTrackHTML(m) {
    const lvl = m.evolveLevel || 0;
    const have = State.soulstones || 0;
    const base = (typeof MONSTERS !== 'undefined' && MONSTERS[m.id]) || {};
    // each reached stage shows the form actually chosen at that tier — resolved
    // from evoChoices against the tree (NOT m.name, which is only the latest form)
    const tree = m.evolution;
    const choices = m.evoChoices || [];
    const stageName = (i) => {
      if (i === 0) return base.name || m.name;
      if (tree && choices[i - 1]) {
        const pool = i === 1
          ? (tree.tier1 || [])
          : ((tree.tier2 && tree.tier2[choices[0]]) || []);
        const form = pool.find(f => f.id === choices[i - 1]);
        if (form && form.name) return form.name;
      }
      // legacy/linear beasts: their one evolved name lives on m.name (current)
      return i === lvl ? m.name : (m.evolveName || m.name);
    };
    // each reached stage shows the form actually chosen at that tier (base art at
    // tier 0), not the current portrait — resolved from evoChoices against the tree
    const stageImg = (i) => {
      if (i === 0) return base.img || m.img || null;
      if (tree && choices[i - 1]) {
        const pool = i === 1
          ? (tree.tier1 || [])
          : ((tree.tier2 && tree.tier2[choices[0]]) || []);
        const form = pool.find(f => f.id === choices[i - 1]);
        if (form && form.img) return form.img;
      }
      return m.img || null;   // legacy/linear beasts
    };
    const fallbackImg = base.img || m.img || '';
    const stages = [0, 1, 2].map(i => {
      const reached = i <= lvl;
      const isNow = i === lvl;
      const name = reached ? stageName(i) : '???';
      let art;
      if (!reached) {
        art = '<span class="evo-art-q">?</span>';
      } else {
        const src = stageImg(i);
        const fb = (fallbackImg && fallbackImg !== src)
          ? ' onerror="this.onerror=null;this.src=\'' + fallbackImg + '\'"' : '';
        art = src
          ? '<img class="evo-art-img" src="' + src + '"' + fb + ' alt="">'
          : '<span class="evo-art-emoji">' + m.emoji + '</span>';
      }
      return '<div class="evo-rung' + (isNow ? ' now' : reached ? ' done' : ' future') + '">' +
        '<div class="evo-orb">' + art + '</div>' +
        '<div class="evo-stage-name">' + name + '</div></div>';
    });
    const maxed = lvl >= 2;
    // Soulstones read as a glowing gem + big number, with a full-width row of
    // large soul sockets that fill as they're gathered.
    const soulPip = lit => '<span class="soul-pip' + (lit ? ' lit' : '') + '">' +
      '<img class="soul-pip-img" src="assets/' + (lit ? 'Soulstone Stone' : 'Soulstone Slot') + '.png" alt="" draggable="false"></span>';
    const soulGem = '<div class="soul-gem"><img class="soul-gem-img" src="assets/Soulstone Stone.png" alt="" draggable="false"></div>';
    const gems = [0, 1, 2, 3, 4].map(i => soulPip(i < Math.min(5, have))).join('');
    const meter = maxed
      ? '<div class="evo-soul maxed">' +
          '<div class="soul-top">' +
            soulGem +
            '<div class="soul-read"><span class="soul-num">MAX</span><span class="soul-lab">Fully evolved</span></div>' +
          '</div>' +
          '<div class="soul-pips">' +
            [0, 1, 2, 3, 4].map(() => soulPip(true)).join('') +
          '</div>' +
        '</div>'
      : '<div class="evo-soul">' +
          '<div class="soul-top">' +
            soulGem +
            '<div class="soul-read">' +
              '<span class="soul-num"><b>' + have + '</b><i>/ 5</i></span>' +
              '<span class="soul-lab">Soulstones — gather <b>5</b> to evolve</span>' +
            '</div>' +
          '</div>' +
          '<div class="soul-pips">' + gems + '</div>' +
        '</div>';
    return '<div class="evo-block">' +
      '<div class="evo-head">Evolution</div>' +
      '<div class="evo-track">' + stages.join('<span class="evo-arrow">→</span>') + '</div>' +
      meter + '</div>';
  }

  function buildCollectionHero() {
    const host = $('collection-hero');
    if (!host) return;
    const m = activeMonster();
    if (!m) { host.innerHTML = ''; return; }
    host.style.setProperty('--hero', m.color);
    const pcColor = m.color || 'var(--gold)';
    // --- mirror of battle.js renderPlayer(): the exact lower-left combat UI ---
    const face = m.img
      ? '<img class="c-sprite" src="' + m.img + '" alt="">'
      : '<span class="c-sprite"' + (m.color ? ' style="color:' + m.color + '"' : '') + '>' + m.emoji + '</span>';
    const passiveFull = m.passiveText || '';
    const ci = passiveFull.indexOf(':');
    const passiveName = ci > 0 ? passiveFull.slice(0, ci).trim() : (m.passive || '');
    let passiveDesc = ci > 0 ? passiveFull.slice(ci + 1).trim() : passiveFull;
    if (passiveDesc) passiveDesc = passiveDesc.charAt(0).toUpperCase() + passiveDesc.slice(1);
    // beast-select style passive box (instead of the small combat emblem).
    // Evolutions stack additional passives on top of the base one.
    const passiveBox = (nm, desc) =>
      '<div class="bc-feature bc-passive cs-passive-box">' +
        '<span class="bcf-badge">✦</span>' +
        '<span class="bcf-text"><b>' + nm + '</b>' + (desc || '') + '</span>' +
      '</div>';
    let passiveHTML = passiveName ? passiveBox(passiveName, passiveDesc) : '';
    (m.evoPassives || []).forEach(p => { passiveHTML += passiveBox(p.name, p.text); });
    const ratio = Math.max(0, Math.min(1, m.hp / m.maxHp));
    const C = 2 * Math.PI * 66;
    const lvl = m.evolveLevel || 0;
    const lastForm = (m.evoChoices && m.evoChoices.length) ? m.evoChoices[m.evoChoices.length - 1] : '';
    const formCls = (lvl >= 2 ? ' final-form' : lvl === 1 ? ' evo-tier1' : '') +
      (lastForm ? ' evo-form-' + lastForm : '');
    host.innerHTML =
      '<div class="cs-charcard">' +
        '<div class="player-combat cs-player' + formCls + '" style="--pc-color:' + pcColor + '">' +
          '<div class="pc-disc-wrap"><div class="pc-disc">' +
            '<svg class="pc-hp-ring" viewBox="0 0 160 160" aria-hidden="true">' +
              '<circle class="hp-track" cx="80" cy="80" r="66"></circle>' +
              '<circle class="hp-arc' + (ratio <= 0.3 ? ' low' : '') + '" cx="80" cy="80" r="66" ' +
                'style="stroke-dasharray:' + C + ';stroke-dashoffset:' + ((1 - ratio) * C) + '"></circle>' +
            '</svg>' +
            '<div class="pc-gear"></div>' +
            '<div class="pc-rune"></div>' +
            '<div class="pc-portrait">' + face + '</div>' +
            '<div class="shield-pip"><span class="sp-ico">◆</span><span class="sv">0</span></div>' +
            '<div class="pc-hp-num">' + Math.max(0, Math.round(m.hp)) + ' / ' + m.maxHp + '</div>' +
          '</div></div>' +
          '<div class="pc-name">' + m.name + '</div>' +
          '<div class="pc-role">' + (m.role || '') + '</div>' +
          '<div class="statuses"></div>' +
        '</div>' +
      '</div>' +
      passiveHTML +
      evolutionTrackHTML(m) +
      '<div class="cs-items-block">' +
        '<div class="evo-head">Items</div>' +
        '<div id="collection-items" class="cs-items"></div>' +
      '</div>';
    buildCollectionItems();
  }

  // the carried items, shown as item slots (filled + empty) centered in the
  // hero panel so the "Stats So Far" screen reflects the run's loadout.
  function buildCollectionItems() {
    const row = $('collection-items');
    if (!row) return;
    row.innerHTML = '';
    const stacks = itemStacks();
    const total = Math.max(MAX_ITEM_STACKS, stacks.length);
    for (let i = 0; i < total; i++) {
      if (i >= stacks.length) {
        const slot = el('div', 'cs-item-slot empty');
        slot.innerHTML = '<span class="cs-item-empty">✦</span>';
        row.appendChild(slot);
        continue;
      }
      const st = stacks[i];
      const it = ITEMS[st.id];
      if (!it) continue;
      // out-of-combat consumables can be used right here; combat-only ones can't
      const usable = !it.combatOnly;
      const slot = el('div', 'cs-item-slot filled rarity-' + (it.rarity || 'common') + (it.img ? ' has-img' : '') + (usable ? ' cs-item-usable' : ''));
      slot.innerHTML =
        itemArtHTML(it) +
        (st.count > 1 ? '<span class="item-count">' + st.count + '</span>' : '') +
        '<span class="hud-tip"><b>' + it.name + '</b>' + (st.count > 1 ? ' <span class="it-x">×' + st.count + '</span>' : '') +
          '<br>' + it.desc +
          (it.combatOnly ? '<br><i class="item-hint">Combat only</i>' : '<br><i class="item-hint">Click to use</i>') + '</span>';
      slot.addEventListener('mouseenter', () => SFX.hover());
      if (usable) {
        slot.addEventListener('click', () => {
          useStack(st.id, slot);
          // refresh HP ring, item counts, and any blessing the tomes just granted
          buildCollection();
        });
      }
      row.appendChild(slot);
    }
  }

  // the actual socket strip — empty sockets exactly as they read on the forge
  // screen (special-slot tints, badges), built from paintSocketTile. Hovering a
  // socket fills the shared detail panel (same one the glyphs use).
  // clear the pinned-detail highlight from BOTH the glyph pool and the socket row
  function clearCollectionDetailSel() {
    const g = $('collection-glyphs'); if (g) g.querySelectorAll('.glyph.selected').forEach(e => e.classList.remove('selected'));
    const s = $('collection-sockets'); if (s) s.querySelectorAll('.socket.selected').forEach(e => e.classList.remove('selected'));
  }
  function buildCollectionSockets() {
    const row = $('collection-sockets');
    if (!row) return;
    row.innerHTML = '';
    const m = activeMonster();
    const n = (m && m.sockets) || 0;
    // inner block stays left-aligned but is centered within the section so a
    // full 9-socket loadout reads perfectly balanced.
    const inner = el('div', 'cs-sock-inner');
    for (let i = 0; i < n; i++) {
      const idx = i;
      const t = el('div', 'socket');
      paintSocketTile(t, (m.slotTypes && m.slotTypes[i]) || 'normal', i + 1);
      const tip = t.querySelector('.slot-tip'); if (tip) tip.remove();   // panel handles it
      t.addEventListener('mouseenter', () => { if (!deckDetailPinned) showSocketDetail(idx); });
      t.addEventListener('mouseleave', () => { if (!deckDetailPinned) hideGlyphDetail(); });
      // tap-to-pin so the detail panel works on touch (no hover on mobile)
      t.addEventListener('click', () => {
        SFX.click();
        const key = 'socket-' + idx;
        clearCollectionDetailSel();
        if (deckDetailPinned === key) { deckDetailPinned = null; hideGlyphDetail(); }
        else { deckDetailPinned = key; t.classList.add('selected'); showSocketDetail(idx); }
      });
      inner.appendChild(t);
    }
    row.appendChild(inner);
    const sc = $('collection-socket-count'); if (sc) sc.textContent = '· ' + n;
  }

  // just the descriptions for a list of slot types (name handled separately)
  function slotDescHTMLOf(list) {
    const order = [], counts = {};
    list.forEach(t => { if (!(t in counts)) { counts[t] = 0; order.push(t); } counts[t]++; });
    const parts = order.map(t => SLOT_INFO[t] && SLOT_INFO[t].tip ? SLOT_INFO[t].tip : '').filter(Boolean);
    return parts.join('<br><br>');
  }
  // a clean socket tile (no floating tip) for the detail panel art
  function socketArtHTML(type, num) {
    const tmp = el('div', 'socket');
    paintSocketTile(tmp, type, num);
    const tip = tmp.querySelector('.slot-tip'); if (tip) tip.remove();
    return tmp.outerHTML;
  }
  function showSocketDetail(i) {
    const d = $('deck-detail');
    const m = activeMonster();
    if (!d || !m) return;
    const type = (m.slotTypes && m.slotTypes[i]) || 'normal';
    const list = slotListOf(type);
    const label = (list.length ? slotLabelOf(type) : 'Normal') + ' Socket';
    const desc = list.length
      ? slotDescHTMLOf(list)
      : 'A plain socket. It holds one glyph — when the chain reaches it, that glyph resolves.';
    d.className = 'deck-detail deck-detail-panel has-detail socket-detail';
    d.style.setProperty('--g-color', 'var(--gold)');
    d.innerHTML =
      '<div class="dd-inner">' +
        '<div class="dd-art dd-art-socket">' + socketArtHTML(type, i + 1) + '</div>' +
        '<div class="dd-body">' +
          '<div class="dd-name">' + label + '</div>' +
          '<div class="dd-meta"><span class="dd-kind">Socket ' + (i + 1) + '</span></div>' +
          '<div class="dd-desc">' + desc + '</div>' +
        '</div>' +
      '</div>';
  }

  function buildCollection() {
    buildCollectionHero();
    buildCollectionSockets();

    const g = $('collection-glyphs');
    g.innerHTML = '';
    deckDetailPinned = null;
    hideGlyphDetail();   // seat the resting placeholder in the detail panel

    // group cards by glyph AND forge signature, so a single upgraded copy reads
    // as its own stack (cards are individuals) while plain duplicates compress.
    const map = {}, order = [];
    State.pool.forEach(id => {
      const def = gdef(id);
      const key = baseOf(id) + '|' + empowerOf(id) + '|' + (comboUpOf(id) ? 1 : 0);
      if (!map[key]) { map[key] = { key: key, def: def, repId: id, empower: empowerOf(id), combo: comboUpOf(id), count: 0 }; order.push(key); }
      map[key].count++;
    });

    order.forEach(key => {
      const grp = map[key];
      const gl = grp.def;
      // render the EXACT combat hand-card look (.glyph) so the pool stays
      // consistent with the forge screen — no flat squares.
      const t = el('div', 'glyph color-' + gl.color +
        ((gl.slots || 1) > 1 ? ' wide' : '') + (gl.junk ? ' junk' : '') +
        (grp.empower || grp.combo ? ' forged' : ''));
      t.style.setProperty('--g-color', 'var(--' + gl.color + ')');
      t.dataset.color = gl.color;
      const body = el('div', 'g-body');
      body.innerHTML = glyphArtHTML(gl) + letterChipHTML(gl);
      t.appendChild(body);
      t.appendChild(el('span', 'g-name', gl.name));
      if (grp.empower > 0) t.appendChild(el('span', 'g-up g-up-power', '✦+' + grp.empower));
      if (grp.combo) t.appendChild(el('span', 'g-up g-up-combo', '▲▲'));
      if (grp.count > 1) t.appendChild(el('span', 'deck-glyph-count', '×' + grp.count));
      t.addEventListener('mouseenter', () => { if (!deckDetailPinned) showGlyphDetail(gl, grp.count, grp.repId); });
      t.addEventListener('mouseleave', () => { if (!deckDetailPinned) hideGlyphDetail(); });
      t.addEventListener('click', () => {
        SFX.click();
        if (deckDetailPinned === key) { deckDetailPinned = null; hideGlyphDetail(); clearCollectionDetailSel(); }
        else {
          deckDetailPinned = key;
          clearCollectionDetailSel();
          t.classList.add('selected');
          showGlyphDetail(gl, grp.count, grp.repId);
        }
      });
      g.appendChild(t);
    });
    const gc = $('collection-glyph-count'); if (gc) gc.textContent = '· ' + State.pool.length;

    const b = $('collection-blessings');
    b.innerHTML = '';
    const allBless = Object.assign({}, BLESSINGS, POWER_BLESSINGS, SOUL_BLESSINGS, EVENT_BLESSINGS);
    const owned = Object.keys(State.blessings)
      .filter(k => State.blessings[k] && allBless[k])
      .map(k => allBless[k]);
    if (!owned.length) b.innerHTML = '<span class="collection-empty">None yet — claim one from an elite or boss.</span>';
    owned.forEach(bl => {
      const relic = el('div', 'relic' + (blessHasImg(bl) ? ' has-img' : ''));
      relic.dataset.bless = bl.id;
      relic.innerHTML =
        '<div class="relic-art">' + blessArtHTML(bl) + '</div>' +
        '<div class="relic-name">' + bl.name + '</div>' +
        '<span class="hud-tip"><b>' + bl.name + '</b><br>' + bl.desc + '</span>';
      b.appendChild(relic);
    });
    const bc = $('collection-bless-count'); if (bc) bc.textContent = owned.length ? '· ' + owned.length : '';

    buildCollectionRunStats();
  }

  // ---- "This Run" stat board on the Character screen, with a live run timer ----
  let runStatsTimer = null;
  function runStatTile(label, val, opts) {
    opts = opts || {};
    return '<div class="crs-tile' + (opts.hero ? ' crs-hero' : '') + (opts.cls ? ' ' + opts.cls : '') + '">' +
      '<div class="crs-val">' + val + '</div>' +
      '<div class="crs-label">' + label + '</div>' +
    '</div>';
  }
  function buildCollectionRunStats() {
    const host = $('collection-runstats');
    if (!host) return;
    const s = ensureRunStats() || freshRunStats();
    host.innerHTML =
      runStatTile('Run Time', '<span id="crs-timer">' + formatDuration(runElapsedMs()) + '</span>', { hero: true, cls: 'crs-timer-tile' }) +
      runStatTile('Enemies Slain', runTotalKills(s)) +
      runStatTile('Normal', s.killsNormal || 0) +
      runStatTile('Elites', s.killsElite || 0) +
      runStatTile('Bosses', s.killsBoss || 0) +
      runStatTile('Souls Gained', s.soulsGained || 0) +
      runStatTile('Blessings', runBlessingCount()) +
      runStatTile('Items Found', s.itemsObtained || 0) +
      runStatTile('Items Used', s.itemsUsed || 0) +
      runStatTile('Highest Combo', s.bestCombo || 0) +
      runStatTile('Best Turn', s.bestTurnDmg || 0) +
      runStatTile('Biggest Hit', s.bestHit || 0);
    startRunStatsTimer();
  }
  function startRunStatsTimer() {
    stopRunStatsTimer();
    runStatsTimer = setInterval(() => {
      const t = $('crs-timer');
      const screen = $('screen-collection');
      if (!t || !screen || !screen.classList.contains('is-active')) { stopRunStatsTimer(); return; }
      t.textContent = formatDuration(runElapsedMs());
    }, 1000);
  }
  function stopRunStatsTimer() { if (runStatsTimer) { clearInterval(runStatsTimer); runStatsTimer = null; } }

  // ============================================================
  // GAME OVER
  // ============================================================
  // ---- Wishing-stone payout (tunable). Both modes pay by progress; a win and
  // deeper Descension levels pay more. ----
  function awardWishingStones(win) {
    const actsCleared = Math.max(0, (State.act || 1) - 1) + (win ? 1 : 0);
    let n = 1 + actsCleared * 3;            // progress reward
    if (win) n += 5;                        // a finished run pays out
    if (State.mode === 'descension') {
      n += (State.descension || 0) * 2;     // deeper descents are richer
      if (win) n += (State.descension || 0) * 3;   // clearing one pays a level bonus
    }
    return Math.max(1, Math.round(n));
  }
  // A compact end-of-run build snapshot for the Gravemarker (Pass 2 renders these).
  function snapshotRun(win, stones) {
    const m = State.monsters[0] || null;
    return {
      at: Date.now(),
      mode: State.mode || 'classic',
      descension: State.descension || 0,
      win: !!win,
      act: State.act || 1,
      cleared: State.cleared || 0,
      stones: stones,
      beast: m ? m.id : null,
      beastName: m ? m.name : '',
      evoChoices: (m && m.evoChoices) ? m.evoChoices.slice() : [],
      deck: (State.pool || []).slice(),
      blessings: Object.keys(State.blessings || {}),
      items: (State.items || []).slice(),
      durationMs: runElapsedMs(),
      runStats: Object.assign({}, State.stats || freshRunStats())
    };
  }

  function gameOver(win) {
    // ---- META harvest — MUST run before clearSave() wipes the run ----
    bankRunTime();    // finalize this run's active time
    bankPlayTime();   // and the lifetime play-clock
    const isDescension = State.mode === 'descension';
    const lvl = State.descension || 0;
    const stones = awardWishingStones(win);
    const rs = State.stats || freshRunStats();
    META.stats.runs = (META.stats.runs || 0) + 1;
    META.stats.bestAct = Math.max(META.stats.bestAct || 0, State.act || 1);
    // fold the run's tallies into the lifetime records
    META.stats.kills = (META.stats.kills || 0) + runTotalKills(rs);
    META.stats.soulsGained = (META.stats.soulsGained || 0) + (rs.soulsGained || 0);
    META.stats.bestCombo = Math.max(META.stats.bestCombo || 0, rs.bestCombo || 0);
    META.stats.bestHit = Math.max(META.stats.bestHit || 0, rs.bestHit || 0);
    META.stats.bestTurnDmg = Math.max(META.stats.bestTurnDmg || 0, rs.bestTurnDmg || 0);
    if (win) {
      META.stats.wins = (META.stats.wins || 0) + 1;
      if (isDescension) {
        META.stats.descensionWins = (META.stats.descensionWins || 0) + 1;
        META.descension.cleared = Math.max(META.descension.cleared || 0, lvl);
        META.stats.bestDescension = Math.max(META.stats.bestDescension || 0, lvl);
      } else {
        META.stats.classicWins = (META.stats.classicWins || 0) + 1;
      }
    }
    META.runHistory.unshift(snapshotRun(win, stones));
    META.runHistory = META.runHistory.slice(0, RUN_HISTORY_MAX);
    grantWishingStones(stones);   // persists the whole META profile (saveMeta)

    clearSave();   // the run is over either way — no checkpoint to resume
    if (win) { SFX.victory(); } else { SFX.defeat(); }
    $('end-title').textContent = win ? 'Chaos Unmade' : 'Undone';
    $('end-title').style.background = win
      ? 'linear-gradient(180deg,#ffd98a,#57e08f 60%,#4fb6ff)'
      : 'linear-gradient(180deg,#ff7a52,#b07bff)';
    $('end-title').style.webkitBackgroundClip = 'text';
    $('end-title').style.backgroundClip = 'text';
    const bossName = (isDescension && lvl >= MAX_DESCENSION) ? 'The Unmaking' : 'Chaos Incarnate';
    $('end-sub').textContent = win
      ? 'Three floors climbed, ' + bossName + ' unmade. The Chaos Runes are yours.'
      : 'Your beasts have fallen on floor ' + (State.act || 1) + ' of the Spire. Encounters cleared: ' + State.cleared + '.';

    // ---- reward / depth banner ----
    let html = '<div class="er-stones">✦ <b>+' + stones + '</b> Wishing Stones</div>';
    if (isDescension) {
      if (win && lvl >= MAX_DESCENSION) {
        html += '<div class="er-depth er-mastered">You have conquered all ' + MAX_DESCENSION + ' Descents.</div>';
      } else if (win) {
        html += '<div class="er-depth">Descent <b>' + roman(lvl) + '</b> cleared — <span class="er-next">Descent ' + roman(lvl + 1) + '</span> now awaits.</div>';
      } else {
        html += '<div class="er-depth er-fail">Descent <b>' + roman(lvl) + '</b> claimed you. The depths remember.</div>';
      }
    }
    $('end-reward').innerHTML = html;
    show('screen-end');
  }

  // ============================================================
  // META PROFILE  (persists ACROSS runs, separate from the single-run save:
  // wishing stones, meta-unlocks, Descension depth, lifetime stats, and a
  // rolling buffer of recent end-of-run build snapshots for the Gravemarker.)
  // Modeled on the type-guarded loadSettings/saveSettings pattern.
  // ============================================================
  const META_KEY = 'cg_meta_v1';
  // keep (effectively) every run the player has ever finished — the Gravemarker
  // remembers them all. The cap is only a guardrail against unbounded growth /
  // localStorage quota; saveMeta trims oldest entries if a write ever fails.
  const RUN_HISTORY_MAX = 1000;
  function freshMeta() {
    return {
      v: 1,
      wishingStones: 0,
      unlocks: {},                  // meta-granted unlock keys (set by the Enchanted Well)
      wishMeters: {},               // per-category banked meter progress (Enchanted Well)
      descension: { cleared: 0 },   // highest Descension level fully cleared (0..MAX_DESCENSION)
      stats: { runs: 0, wins: 0, classicWins: 0, descensionWins: 0, bestDescension: 0, bestAct: 0,
               playTimeMs: 0, kills: 0, bestCombo: 0, bestHit: 0, bestTurnDmg: 0, soulsGained: 0 },
      runHistory: [],               // every end-of-run build snapshot, newest first (Gravemarker reads these)
      bestiary: { seen: {}, defeated: {} },  // enemy id -> true (Monster Book)
      evolved: {}                   // evolution form id -> true (Star Chart reveals)
    };
  }
  let META = freshMeta();
  function loadMeta() {
    try {
      const raw = localStorage.getItem(META_KEY);
      if (raw) {
        const m = JSON.parse(raw);
        if (m && typeof m === 'object') {
          if (typeof m.wishingStones === 'number') META.wishingStones = m.wishingStones;
          if (m.unlocks && typeof m.unlocks === 'object') META.unlocks = m.unlocks;
          if (m.wishMeters && typeof m.wishMeters === 'object') META.wishMeters = m.wishMeters;
          if (m.descension && typeof m.descension.cleared === 'number') META.descension.cleared = m.descension.cleared;
          if (m.stats && typeof m.stats === 'object') Object.assign(META.stats, m.stats);
          if (Array.isArray(m.runHistory)) META.runHistory = m.runHistory.slice(0, RUN_HISTORY_MAX);
          if (m.bestiary && typeof m.bestiary === 'object') {
            if (m.bestiary.seen && typeof m.bestiary.seen === 'object') META.bestiary.seen = m.bestiary.seen;
            if (m.bestiary.defeated && typeof m.bestiary.defeated === 'object') META.bestiary.defeated = m.bestiary.defeated;
          }
          if (m.evolved && typeof m.evolved === 'object') META.evolved = m.evolved;
        }
      }
    } catch (e) { /* defaults */ }
    root.CG.Meta = META;   // the Lost Woods screens read the profile from here
  }
  function saveMeta() {
    try { localStorage.setItem(META_KEY, JSON.stringify(META)); return; }
    catch (e) { /* likely a quota overflow — fall through and shed old runs */ }
    // If the profile won't fit (huge run history), drop the oldest runs a chunk
    // at a time until it persists, so newer runs and the rest of the profile survive.
    const hist = META.runHistory || [];
    for (let keep = Math.min(hist.length, 200); keep >= 0; keep -= 50) {
      META.runHistory = hist.slice(0, keep);
      try { localStorage.setItem(META_KEY, JSON.stringify(META)); return; }
      catch (e2) { /* still too big — trim further */ }
    }
  }
  // ---- lifetime play-clock: banks ACTIVE wall-time into META.stats.playTimeMs.
  // Hidden/backgrounded time is excluded (the clock resets when the tab returns). ----
  let _playClock = Date.now();
  function bankPlayTime() {
    const now = Date.now();
    let d = now - _playClock;
    _playClock = now;
    if (d < 0 || d > 5 * 60 * 1000) d = 0;   // ignore sleeps / hidden gaps
    if (d > 0) {
      if (!META.stats) META.stats = {};
      META.stats.playTimeMs = (META.stats.playTimeMs || 0) + d;
    }
  }
  function startPlayClock() {
    _playClock = Date.now();
    setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) { _playClock = Date.now(); return; }
      bankPlayTime();
    }, 30000);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) { bankPlayTime(); bankRunTime(); saveMeta(); }
        else { _playClock = Date.now(); if (State) State.runClock = Date.now(); }   // skip the hidden gap
      });
    }
    if (root.addEventListener) root.addEventListener('beforeunload', () => { bankPlayTime(); bankRunTime(); saveMeta(); });
  }
  function grantWishingStones(n) {
    n = Math.max(0, Math.round(n || 0));
    if (n > 0) { META.wishingStones += n; saveMeta(); }
    return n;
  }
  // Monster Book bookkeeping: foes are "seen" the moment they enter an arena,
  // "defeated" when slain. Both persist across runs in the meta profile.
  function recordBestiarySeen(ids) {
    if (!ids) return;
    let dirty = false;
    (Array.isArray(ids) ? ids : [ids]).forEach(id => {
      if (id && !META.bestiary.seen[id]) { META.bestiary.seen[id] = true; dirty = true; }
    });
    if (dirty) saveMeta();
  }
  function recordBestiaryDefeated(id) {
    if (!id) return;
    let dirty = false;
    if (!META.bestiary.seen[id]) { META.bestiary.seen[id] = true; dirty = true; }
    if (!META.bestiary.defeated[id]) { META.bestiary.defeated[id] = true; dirty = true; }
    if (dirty) saveMeta();
  }
  // Star Chart bookkeeping: a form is "discovered" once the player has evolved
  // into it at least once. Until then it shows as an enticing mystery silhouette.
  function recordEvolved(formId) {
    if (!formId || !META.evolved) return;
    if (!META.evolved[formId]) { META.evolved[formId] = true; saveMeta(); }
  }
  function metaEvolved(formId) { return !!(META.evolved && META.evolved[formId]); }

  // ============================================================
  // ENCHANTED WELL — cast wishing stones to permanently unlock locked
  // content (rare glyphs / blessings / items) into the run pools. Each
  // category banks its own meter; every full meter = one random unlock.
  // ============================================================
  const WELL_PER_UNLOCK = 5;   // wishing stones to fill one unlock meter
  const WELL_CATS = [
    { id: 'glyph_kitsune', group: 'monsters',  label: 'Kitsune Glyphs', kind: 'glyph', accent: 'var(--red)',    icon: (MONSTERS.kitsune || {}).img, match: g => g.character === 'kitsune' },
    { id: 'glyph_ghoul',   group: 'monsters',  label: 'Ghoul Glyphs',   kind: 'glyph', accent: 'var(--purple)', icon: (MONSTERS.ghoul || {}).img,   match: g => g.character === 'ghoul' },
    { id: 'glyph_troll',   group: 'monsters',  label: 'Goblin Glyphs',  kind: 'glyph', accent: 'var(--green)',  icon: (MONSTERS.troll || {}).img,   match: g => g.character === 'troll' },
    { id: 'blessing',      group: 'trappings', label: 'Blessings',      kind: 'blessing', accent: 'var(--blue)', icon: '✦' },
    { id: 'glyph_soul',    group: 'trappings', label: 'Soul Glyphs',    kind: 'glyph', accent: '#cdd6ff',       icon: 'assets/Soulstone Stone.png', match: g => g.colorless },
    { id: 'item',          group: 'trappings', label: 'Relics & Items', kind: 'item',  accent: 'var(--gold)',   icon: 'assets/Soul Jar.png' }
  ];
  const WELL_GROUPS = ['monsters', 'trappings'];
  // colorize the glyph plate to its element so locked-glyph reveals read like the
  // real reward cards instead of a flat grey hex
  function wellEntryFromGlyph(g) { return { key: g.unlock, name: g.name, kind: 'glyph', art: '<div class="well-ent-art" style="--g-color:var(--' + g.color + ')">' + glyphArtHTML(g) + '</div>', desc: DATA.formatDesc(g) }; }
  function wellEntryFromBless(b) { return { key: b.unlock, name: b.name, kind: 'blessing', art: '<div class="well-ent-art has-img">' + blessArtHTML(b) + '</div>', desc: b.desc }; }
  function wellEntryFromItem(it) { return { key: it.unlock, name: it.name, kind: 'item', art: '<div class="well-ent-art has-img">' + itemArtHTML(it) + '</div>', desc: it.desc }; }
  function wellCatalog() {
    const cats = WELL_CATS.map(c => Object.assign({ entries: [] }, c));
    const byId = {}; cats.forEach(c => byId[c.id] = c);
    Object.values(GLYPHS).forEach(g => {
      if (!g.unlock) return;
      const cat = cats.find(c => c.kind === 'glyph' && c.match(g));
      if (cat) cat.entries.push(wellEntryFromGlyph(g));
    });
    [BLESSINGS, POWER_BLESSINGS, SOUL_BLESSINGS, EVENT_BLESSINGS].forEach(map =>
      Object.values(map).forEach(b => { if (b.unlock) byId.blessing.entries.push(wellEntryFromBless(b)); }));
    Object.values(ITEMS).forEach(it => { if (it.unlock) byId.item.entries.push(wellEntryFromItem(it)); });
    return cats.filter(c => c.entries.length);
  }
  function wellCatState(cat) {
    const total = cat.entries.length;
    const unlocked = cat.entries.filter(e => META.unlocks[e.key]).length;
    return { total, unlocked, lockedRemaining: total - unlocked, meter: META.wishMeters[cat.id] || 0 };
  }
  // commit a staged offering ({catId: stones}); returns the entries newly unlocked
  function wellCast(staged) {
    const cats = wellCatalog();
    const revealed = [];
    let spent = 0;
    cats.forEach(cat => {
      const add = staged[cat.id] || 0;
      if (add <= 0) return;
      spent += add;
      const st = wellCatState(cat);
      const total = st.meter + add;
      const unlocks = Math.min(Math.floor(total / WELL_PER_UNLOCK), st.lockedRemaining);
      const locked = cat.entries.filter(e => !META.unlocks[e.key]);
      for (let i = 0; i < unlocks && locked.length; i++) {
        const e = locked.splice(Math.floor(Math.random() * locked.length), 1)[0];
        META.unlocks[e.key] = true;
        revealed.push({ catId: cat.id, accent: cat.accent, label: cat.label, entry: e });
      }
      const stillLocked = cat.entries.filter(e => !META.unlocks[e.key]).length;
      META.wishMeters[cat.id] = stillLocked > 0 ? (total - unlocks * WELL_PER_UNLOCK) : 0;
    });
    META.wishingStones = Math.max(0, META.wishingStones - spent);
    saveMeta();
    return revealed;
  }

  // ---- WELL UI ----
  let wellStage = {};   // transient per-category staged stones (pre-cast)
  let wellArcOffsets = {};   // last-rendered dashoffset per meter, so the ring animates from where it was rather than snapping
  let wellTab = 'monsters';   // which meter group is currently in view
  let wellAnimateIn = false;  // one-shot: stagger the cells in after a tab switch
  function wellStaged() { return Object.keys(wellStage).reduce((s, k) => s + (wellStage[k] || 0), 0); }
  function wellAvailable() { return Math.max(0, (META.wishingStones || 0) - wellStaged()); }
  function wellCatIcon(cat) {
    if (cat.icon && /\.(png|jpg)$/i.test(cat.icon)) return '<img class="well-cat-img" src="' + cat.icon + '" alt="" draggable="false">';
    return '<span class="well-cat-emoji">' + (cat.icon || '✦') + '</span>';
  }
  function buildWell() {
    wellStage = {};
    wellArcOffsets = {};   // entering the screen, let each ring fill in from empty
    wellTab = 'monsters';
    wellAnimateIn = true;
    const stones = $('well-stone-count');
    if (stones) stones.textContent = META.wishingStones || 0;
    const cats = wellCatalog();
    const host = $('well-cats');
    if (host && !host.dataset.wired) {
      host.dataset.wired = '1';
      host.addEventListener('click', onWellCatClick);
    }
    wireWellTabs();
    renderWell();
    const castBtn = $('well-cast-btn');
    if (castBtn && !castBtn.dataset.wired) {
      castBtn.dataset.wired = '1';
      castBtn.addEventListener('click', doWellCast);
    }
    const clearBtn = $('well-clear-btn');
    if (clearBtn && !clearBtn.dataset.wired) {
      clearBtn.dataset.wired = '1';
      clearBtn.addEventListener('click', () => { SFX.click(); wellStage = {}; renderWell(); });
    }
    return cats;
  }
  // the meters are now split across two tabs (Monsters / Trappings); wire the
  // segmented control once and let each tab swap the visible discs
  function wireWellTabs() {
    const tabs = $('well-tabs');
    if (!tabs || tabs.dataset.wired) return;
    tabs.dataset.wired = '1';
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.well-tab');
      if (!btn) return;
      switchWellTab(btn.dataset.tab);
    });
  }
  function switchWellTab(group) {
    if (!group || group === wellTab || WELL_GROUPS.indexOf(group) < 0) return;
    wellTab = group;
    wellAnimateIn = true;
    SFX.click();
    const host = $('well-cats');
    updateWellTabUI();
    if (host) {
      // sweep the outgoing discs away, rebuild, then stagger the new set in
      host.classList.add('tab-leaving');
      setTimeout(() => {
        host.classList.remove('tab-leaving');
        renderWell();
      }, 150);
    } else renderWell();
  }
  // light the active flank tab and reflect aria + the staged-stones badge
  function updateWellTabUI() {
    const tabs = $('well-tabs');
    if (!tabs) return;
    const stagedByGroup = {};
    WELL_CATS.forEach(c => { if ((wellStage[c.id] || 0) > 0) stagedByGroup[c.group] = (stagedByGroup[c.group] || 0) + (wellStage[c.id] || 0); });
    tabs.querySelectorAll('.well-tab').forEach(btn => {
      const on = btn.dataset.tab === wellTab;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      const dot = btn.querySelector('.well-tab-dot');
      const cnt = stagedByGroup[btn.dataset.tab] || 0;
      if (dot) { dot.classList.toggle('on', cnt > 0); dot.textContent = cnt > 0 ? cnt : ''; }
    });
  }
  function wellCatPending(cat) {
    const st = wellCatState(cat);
    const staged = wellStage[cat.id] || 0;
    const total = st.meter + staged;
    const cycles = Math.min(Math.floor(total / WELL_PER_UNLOCK), st.lockedRemaining);
    const within = (cycles >= st.lockedRemaining) ? 0 : (total - cycles * WELL_PER_UNLOCK);
    return { st, staged, cycles, within };
  }
  function renderWell() {
    const host = $('well-cats');
    if (!host) return;
    const allCats = wellCatalog();
    const cats = allCats.filter(c => c.group === wellTab);   // only the active tab's meters
    const C = 2 * Math.PI * 66;   // circumference of the radial meter ring
    const prevArc = wellArcOffsets;   // where each ring sat on the last render
    const nextArc = {};
    const enter = wellAnimateIn; wellAnimateIn = false;
    host.classList.toggle('tab-enter', enter);
    host.innerHTML = cats.map((cat, ci) => {
      const p = wellCatPending(cat);
      const done = p.st.lockedRemaining === 0;
      // the ring fills toward the next unlock; a completed cycle reads as a full ring
      const frac = done ? 1 : (p.cycles > 0 && p.within === 0 ? 1 : p.within / WELL_PER_UNLOCK);
      const targetOff = (1 - frac) * C;
      nextArc[cat.id] = targetOff;
      // start the arc where it last was (or empty on first paint) and transition
      // to the target on the next frame so the fill animates smoothly
      const startOff = (cat.id in prevArc) ? prevArc[cat.id] : C;
      const xbadge = '<span class="wd-x' + (p.cycles > 0 ? ' on' : '') + '">+' + (p.cycles > 0 ? p.cycles : '') + '</span>';
      return '<div class="well-meter-cell' + (done ? ' done' : '') + (p.cycles > 0 ? ' charged' : '') +
            (p.staged > 0 ? ' staged' : '') + (enter ? ' cell-enter' : '') + '" data-cat="' + cat.id +
            '" style="--acc:' + cat.accent + ';--ci:' + ci + '">' +
        '<div class="wd-disc-wrap">' +
          '<div class="wd-disc">' +
            '<svg class="wd-ring" viewBox="0 0 160 160" aria-hidden="true">' +
              '<circle class="wd-track" cx="80" cy="80" r="66"></circle>' +
              '<circle class="wd-arc' + (frac >= 1 ? ' full' : '') + '" cx="80" cy="80" r="66" data-arc="' + targetOff + '" ' +
                'style="stroke-dasharray:' + C + ';stroke-dashoffset:' + startOff + '"></circle>' +
            '</svg>' +
            '<div class="wd-gear"></div>' +
            '<div class="wd-rune"></div>' +
            '<div class="wd-portrait">' + wellCatIcon(cat) + '</div>' +
            xbadge +
            (done ? '' : '<span class="wd-staged-bubble' + (p.staged > 0 ? ' on' : '') + '">+' + p.staged + '</span>') +
          '</div>' +
        '</div>' +
        '<div class="wd-name">' + cat.label + '</div>' +
        '<div class="wd-prog">' + (done ? '<b>Complete</b>' : (p.st.unlocked + ' / ' + p.st.total)) + '</div>' +
        (done ? '<div class="wd-done">Fully discovered</div>' :
          '<div class="wd-ctrls">' +
            '<button class="wd-step" data-act="add" data-d="-1" aria-label="Remove a stone">−</button>' +
            '<button class="wd-step" data-act="add" data-d="1" aria-label="Add a stone">+</button>' +
            '<button class="wd-mini" data-act="max">Max</button>' +
            '<button class="wd-mini" data-act="clear">Clear</button>' +
          '</div>') +
      '</div>';
    }).join('');
    wellArcOffsets = nextArc;
    // next frame: ease every ring from its start offset to its real target, so
    // adding/removing stones visibly fills/drains the gauge instead of snapping
    requestAnimationFrame(() => {
      host.querySelectorAll('.wd-arc').forEach(a => {
        const t = a.getAttribute('data-arc');
        if (t != null) a.style.strokeDashoffset = t;
      });
    });
    // keep the tab indicator + per-tab staged dots in sync with the new state
    requestAnimationFrame(updateWellTabUI);
    // balance + pending summary (counts staged stones across BOTH tabs)
    const avail = wellAvailable();
    const staged = wellStaged();
    let unlocks = 0;
    allCats.forEach(cat => { unlocks += wellCatPending(cat).cycles; });
    const stones = $('well-stone-count'); if (stones) stones.textContent = avail;
    const pend = $('well-pending');
    if (pend) {
      pend.innerHTML = staged > 0
        ? 'Offering <b>' + staged + '</b> ✦ → <b class="well-pend-x">' + unlocks + '</b> unlock' + (unlocks === 1 ? '' : 's')
        : 'Choose where the well\'s favor should fall.';
    }
    const castBtn = $('well-cast-btn');
    if (castBtn) { castBtn.disabled = staged <= 0; castBtn.classList.toggle('ready', staged > 0); }
  }
  function onWellCatClick(e) {
    const card = e.target.closest('.well-meter-cell');
    if (!card) return;
    const catId = card.dataset.cat;
    const act = e.target.closest('[data-act]') && e.target.closest('[data-act]').dataset.act;
    const cur = wellStage[catId] || 0;
    if (act === 'clear') {
      if (cur === 0) return;
      wellStage[catId] = 0; SFX.hover(); renderWell(); return;
    }
    const cats = wellCatalog();
    const cat = cats.find(c => c.id === catId);
    if (!cat) return;
    const st = wellCatState(cat);
    const maxUseful = st.lockedRemaining * WELL_PER_UNLOCK - st.meter;
    if (maxUseful <= 0) return;
    const avail = wellAvailable();
    let next = cur;
    if (act === 'max') next = Math.min(maxUseful, cur + avail);
    else if (act === 'add') {
      const d = parseInt(e.target.dataset.d, 10) || 0;
      next = d > 0 ? Math.min(cur + Math.min(d, avail), maxUseful) : Math.max(0, cur + d);
    } else return;
    if (next === cur) return;
    wellStage[catId] = next;
    if (next > cur) SFX.coinTick(next - cur); else SFX.hover();
    renderWell();
  }
  function doWellCast() {
    const staged = wellStaged();
    if (staged <= 0) return;
    const snapshot = Object.assign({}, wellStage);
    const castBtn = $('well-cast-btn'), clearBtn = $('well-clear-btn');
    if (castBtn) castBtn.disabled = true;
    if (clearBtn) clearBtn.disabled = true;
    SFX.act();
    // stones pour from each meter into the well, then it surges and surfaces the prize
    flyStonesToWell(snapshot, () => {
      const revealed = wellCast(snapshot);
      wellStage = {};
      const stage = $('well-stage');
      if (stage) { stage.classList.add('surge'); setTimeout(() => stage.classList.remove('surge'), 1200); }
      renderWell();
      if (clearBtn) clearBtn.disabled = false;
      showWellReveal(revealed, staged);
    });
  }
  // arc the cast stones out of each meter's disc and into the well's pool. Each
  // stone is tinted to the color of the meter it came from and lands with a plip.
  function flyStonesToWell(staged, done) {
    const screen = $('screen-well');
    const pool = screen && screen.querySelector('.well-pool');
    const Scale = root.CG.Scale;
    const stageEl = document.getElementById('stage');
    // the stones live inside the CSS-scaled #stage, so positions must be in
    // STAGE-LOCAL space (via Scale.toStage) — using raw client deltas would be
    // off by the scale factor and drift up-and-left (worse the smaller the stage)
    if (!screen || !pool || !Scale || !stageEl) { if (done) done(); return; }
    const pr = pool.getBoundingClientRect();
    const target = Scale.toStage(pr.left + pr.width / 2, pr.top + pr.height / 2);
    const tx = target.x, ty = target.y;
    // a layer behind the visible discs: stones cast from off-tab meters rise from
    // here so they read as emerging from behind the meters currently in view
    const phantom = screen.querySelector('.well-phantom-layer');
    let phantomOrigin = null;
    if (phantom) { const lr = phantom.getBoundingClientRect(); phantomOrigin = Scale.toStage(lr.left, lr.top); }
    const row = $('well-cats');
    let rowCenter = null;
    if (row) { const rr = row.getBoundingClientRect(); rowCenter = Scale.toStage(rr.left + rr.width / 2, rr.top + rr.height / 2); }
    // gather a flight plan: one source disc per staged category (capped for perf)
    const flights = [];
    Object.keys(staged || {}).forEach(catId => {
      const want = staged[catId] || 0;
      if (want <= 0) return;
      const cell = screen.querySelector('.well-meter-cell[data-cat="' + catId + '"]');
      const cat = WELL_CATS.find(c => c.id === catId);
      const color = resolveColor(cat ? cat.accent : '#c9a6ff');
      const per = Math.max(1, Math.min(want, 8));
      let sx, sy, behind = false;
      const disc = cell && (cell.querySelector('.wd-portrait') || cell.querySelector('.wd-disc'));
      if (disc) {
        const dr = disc.getBoundingClientRect();
        const sp = Scale.toStage(dr.left + dr.width / 2, dr.top + dr.height / 2);
        sx = sp.x; sy = sp.y;
        cell.classList.add('pouring');
      } else if (rowCenter) {
        // this meter lives on the other tab — launch from behind the visible discs
        sx = rowCenter.x; sy = rowCenter.y; behind = true;
      } else return;
      for (let i = 0; i < per; i++) {
        flights.push({ sx, sy, color, cell, behind });
      }
    });
    if (!flights.length) { if (done) done(); return; }
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const clearPouring = () => screen.querySelectorAll('.well-meter-cell.pouring').forEach(c => c.classList.remove('pouring'));
    if (reduce) { setTimeout(() => { clearPouring(); if (done) done(); }, 160); return; }
    // interleave stones from different meters so they cascade together
    flights.sort(() => Math.random() - 0.5);
    const n = flights.length;
    let landed = 0;
    const finish = () => {
      if (++landed >= n) {
        clearPouring();
        setTimeout(() => { if (pool) pool.classList.remove('splash'); }, 460);
        if (done) done();
      }
    };
    flights.forEach((f, i) => {
      const dx = tx - f.sx, dy = ty - f.sy;
      const s = document.createElement('div');
      s.className = 'well-fly-stone' + (f.behind ? ' behind' : '');
      s.textContent = '✦';
      s.style.color = f.color;
      s.style.textShadow = '0 0 12px ' + f.color + ', 0 0 26px ' + f.color;
      // off-tab stones nest in the behind-layer (so the discs occlude them); the
      // flight deltas are identical stage-local px, only the base origin re-bases
      let host = stageEl, baseX = f.sx, baseY = f.sy;
      if (f.behind && phantom && phantomOrigin) {
        host = phantom; baseX = f.sx - phantomOrigin.x; baseY = f.sy - phantomOrigin.y;
      }
      s.style.left = baseX + 'px';
      s.style.top = baseY + 'px';
      host.appendChild(s);
      const arcX = dx * 0.5 + (Math.random() * 70 - 35);
      const arcY = dy * 0.5 - (120 + Math.random() * 80);   // lob upward first
      const dur = 560 + Math.random() * 200;
      const anim = s.animate([
        { transform: 'translate(-50%,-50%) scale(.3)', opacity: 0, offset: 0 },
        { transform: 'translate(calc(-50% + ' + (arcX * 0.4) + 'px), calc(-50% + ' + (arcY * 0.5) + 'px)) scale(1.25)', opacity: 1, offset: 0.18 },
        { transform: 'translate(calc(-50% + ' + arcX + 'px), calc(-50% + ' + arcY + 'px)) scale(1.05)', opacity: 1, offset: 0.55 },
        { transform: 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px)) scale(.3)', opacity: 0.5, offset: 1 }
      ], { duration: dur, delay: i * 70, easing: 'cubic-bezier(.45,0,.55,1)', fill: 'forwards' });
      const onEnd = () => {
        s.remove();
        SFX.wellDrop(landed);
        spawnWellSplash(pool, f.color);
        if (pool) { pool.classList.remove('splash'); void pool.offsetWidth; pool.classList.add('splash'); }
        finish();
      };
      anim.onfinish = onEnd;
      anim.oncancel = onEnd;
    });
  }
  // a quick colored ripple + droplet burst where a stone hits the water
  function spawnWellSplash(pool, color) {
    if (!pool) return;
    const ring = document.createElement('span');
    ring.className = 'well-land-ring';
    ring.style.borderColor = color;
    pool.appendChild(ring);
    ring.addEventListener('animationend', () => ring.remove());
    for (let k = 0; k < 4; k++) {
      const drop = document.createElement('span');
      drop.className = 'well-land-drop';
      drop.style.background = color;
      const ang = (Math.PI * 2 * k) / 4 + Math.random() * 0.8;
      const dist = 16 + Math.random() * 14;
      drop.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      drop.style.setProperty('--dy', (-Math.abs(Math.sin(ang)) * dist - 6) + 'px');
      pool.appendChild(drop);
      drop.addEventListener('animationend', () => drop.remove());
    }
  }
  // ---- the climactic reveal ----
  function showWellReveal(revealed, stonesSpent) {
    const ov = $('well-reveal');
    if (!ov) return;
    const n = revealed.length;
    const lvl = n >= 6 ? 3 : n >= 3 ? 2 : (n >= 1 ? 1 : 0);
    const titles = ['The well drinks your offering…', 'Fate stirs awake', 'The well surges with light', 'A torrent of fate breaks free!'];
    const title = titles[lvl];
    const cards = revealed.map((r, i) => {
      const kindLab = r.label.replace(/s$/, '');
      return '<div class="well-rv-card" style="--acc:' + r.accent + ';animation-delay:' + (220 + i * 140) + 'ms">' +
        '<div class="well-rv-new">Unlocked</div>' +
        '<div class="well-rv-kind">' + kindLab + '</div>' +
        r.entry.art.replace('well-ent-art', 'well-ent-art well-rv-art') +
        '<div class="well-rv-name">' + r.entry.name + '</div>' +
        '<div class="well-rv-desc">' + r.entry.desc + '</div>' +
      '</div>';
    }).join('');
    const body = n
      ? '<div class="well-carousel' + (n > 6 ? ' scrollable' : '') + '">' +
          '<button class="well-car-nav prev" aria-label="Previous">‹</button>' +
          '<div class="well-car-track">' + cards + '</div>' +
          '<button class="well-car-nav next" aria-label="Next">›</button>' +
        '</div>'
      : '<div class="well-rv-none">The offering of <b>' + stonesSpent + '</b> ✦ sinks into the dark. Its power is <b>banked</b> — return with more to draw it out.</div>';
    ov.innerHTML =
      '<div class="well-reveal-veil"></div>' +
      '<div class="well-reveal-inner well-rv-lvl-' + lvl + '">' +
        '<div class="well-reveal-burst" aria-hidden="true"></div>' +
        '<h2 class="well-reveal-title">' + title + '</h2>' +
        body +
        '<button class="btn well-reveal-close">' + (n ? 'Claim your fortune' : 'So be it') + '</button>' +
      '</div>';
    ov.classList.remove('hidden');
    requestAnimationFrame(() => ov.classList.add('show'));
    // wire the carousel: arrows scroll one card-column; fade edges are pure CSS
    const track = ov.querySelector('.well-car-track');
    if (track) {
      const colW = () => {
        const card = track.querySelector('.well-rv-card');
        const cw = card ? card.getBoundingClientRect().width : 240;
        const gap = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap) || 22;
        return cw + gap;
      };
      const syncNav = () => {
        const prev = ov.querySelector('.well-car-nav.prev');
        const next = ov.querySelector('.well-car-nav.next');
        const maxScroll = track.scrollWidth - track.clientWidth - 2;
        const atStart = track.scrollLeft <= 2;
        const atEnd = track.scrollLeft >= maxScroll;
        if (prev) prev.classList.toggle('hide', atStart);
        if (next) next.classList.toggle('hide', atEnd);
        // only fade an edge when there's hidden content beyond it, so the first
        // and last cards are never permanently clipped by the fade mask
        track.classList.toggle('at-start', atStart);
        track.classList.toggle('at-end', atEnd);
      };
      const prev = ov.querySelector('.well-car-nav.prev');
      const next = ov.querySelector('.well-car-nav.next');
      if (prev) prev.addEventListener('click', () => { SFX.click(); track.scrollBy({ left: -colW() * 2, behavior: 'smooth' }); });
      if (next) next.addEventListener('click', () => { SFX.click(); track.scrollBy({ left: colW() * 2, behavior: 'smooth' }); });
      track.addEventListener('scroll', syncNav, { passive: true });
      // a vertical wheel / trackpad swipe drives the horizontal track directly,
      // so it tracks the finger 1:1 instead of relying on the browser's flaky
      // wheel-to-sideways translation (which stalls and stutters)
      track.addEventListener('wheel', (e) => {
        const maxScroll = track.scrollWidth - track.clientWidth;
        if (maxScroll <= 1) return;   // nothing to scroll — let the page have it
        let d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (!d) return;
        if (e.deltaMode === 1) d *= 16;                  // lines → px (mouse wheels)
        else if (e.deltaMode === 2) d *= track.clientWidth;   // pages → px
        const before = track.scrollLeft;
        track.scrollLeft = Math.max(0, Math.min(maxScroll, before + d));
        // only swallow the gesture if we actually consumed some of it, so an
        // over-scroll at either end can still bubble normally
        if (track.scrollLeft !== before) e.preventDefault();
      }, { passive: false });
      requestAnimationFrame(syncNav);
    }
    // escalating chime: one reward ping per unlock, a victory flourish for a big haul
    if (n) {
      revealed.forEach((r, i) => setTimeout(() => SFX.reward(), 240 + i * 180));
      if (n >= 3) setTimeout(() => SFX.victory(), 240 + n * 180);
    }
    const close = ov.querySelector('.well-reveal-close');
    const veil = ov.querySelector('.well-reveal-veil');
    const doClose = () => {
      SFX.click();
      ov.classList.remove('show');
      setTimeout(() => { ov.classList.add('hidden'); ov.innerHTML = ''; }, 320);
      buildWell();   // refresh balances + progress
    };
    if (close) close.addEventListener('click', doClose);
    if (veil) veil.addEventListener('click', doClose);
  }
  // ============================================================
  // LOST WOODS  — the between-runs meta hub and its read-only screens
  // (Gravemarker / Stone Table / Monster Book). All data shown here is
  // already stored in the META profile or the static DATA tables.
  // ============================================================
  const allBlessMap = () => Object.assign({}, BLESSINGS, POWER_BLESSINGS, SOUL_BLESSINGS, EVENT_BLESSINGS);

  // --- shared lightweight detail modal (Stone Table forms + Monster Book) ---
  function openLwModal(html, accent, kind) {
    const m = $('lw-modal'); if (!m) return;
    const panel = m.querySelector('.lw-modal-panel');
    const body = $('lw-modal-body');
    if (body) body.innerHTML = html;
    m.style.setProperty('--lw-acc', accent || 'var(--gold)');
    if (panel) {
      panel.classList.remove('kind-stone', 'kind-book', 'kind-run');
      if (kind) panel.classList.add('kind-' + kind);
      // replay the bloom-in each open
      panel.classList.remove('lwm-pop'); void panel.offsetWidth; panel.classList.add('lwm-pop');
    }
    // Inspector panel (same look as the combat tip) anchored to the RIGHT of the
    // card. It is NOT docked — it animates in while a chip is hovered and slides
    // back out when the cursor leaves, so the card stays centered on its own.
    const side = $('lw-side-tip');
    if (side) { side.classList.remove('show'); side.innerHTML = ''; }
    if (side && body) body.querySelectorAll('[data-tip]').forEach(eln => {
      eln.addEventListener('mouseenter', () => setLwSide(eln));
      eln.addEventListener('mouseleave', hideLwSide);
    });
    if (lwCloseTimer) { clearTimeout(lwCloseTimer); lwCloseTimer = null; }
    m.classList.remove('hidden', 'lwm-closing');
  }
  // populate + animate the inspector in for the hovered chip
  function setLwSide(eln) {
    const side = $('lw-side-tip'); if (!side) return;
    const cat = eln.getAttribute('data-cat') || 'Detail';
    const tip = eln.getAttribute('data-tip') || '';
    side.innerHTML = '<div class="lst-head">' + cat + '</div><div class="lst-body">' + tip + '</div>';
    side.classList.add('show');
  }
  function hideLwSide() { const side = $('lw-side-tip'); if (side) side.classList.remove('show'); }
  // resolve a CSS color token (incl. var(--x)) to a concrete color for SVG fills
  function resolveColor(c) {
    if (!c) return '#f5c969';
    c = String(c).trim();
    const m = c.match(/^var\(\s*(--[\w-]+)\s*\)$/);
    if (m) {
      const v = getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim();
      return v || '#f5c969';
    }
    return c;
  }
  let lwCloseTimer = null;
  // play a brief bloom-out (mirror of the lwmPop entrance) before hiding, so the
  // detail card eases away instead of snapping out of existence
  function closeLwModal() {
    hideLwSide();
    const m = $('lw-modal');
    if (!m || m.classList.contains('hidden') || m.classList.contains('lwm-closing')) return;
    m.classList.add('lwm-closing');
    if (lwCloseTimer) clearTimeout(lwCloseTimer);
    lwCloseTimer = setTimeout(() => {
      m.classList.add('hidden');
      m.classList.remove('lwm-closing');
      lwCloseTimer = null;
    }, 240);
  }

  // ---- HUB ----
  // POIs are scattered across the clearing by percent coordinates (the stage is
  // a fixed 1920×1080 canvas, so these read the same on every device).
  // ordered back-to-front (by y) so nearer landmarks layer over farther ones.
  // x/y are % of the 1920×1080 stage; w is the structure width in stage px.
  const LW_POIS = [
    { id: 'monsterbook', screen: 'screen-monsterbook', icon: '📖', art: 'assets/Monster Library.png', title: 'Monster Library', blurb: 'A bestiary of every foe you have met in the Spire — their intents, their hidden feast boons, and the lore behind them.', x: 58, y: 24, w: 300 },
    { id: 'stonetable',  screen: 'screen-stonetable',  icon: '✶', art: 'assets/Star Charts.png',     title: 'Star Charts',     blurb: 'Trace the constellations of every beast and the branching paths of its evolutions.', x: 37, y: 35, w: 320 },
    { id: 'tablets',     screen: null,                 icon: '📜', art: 'assets/Stone Tablets.png',    title: 'Stone Tablets',   blurb: 'The carved lore and glossary of all things — every keyword, passive, and secret.', x: 75, y: 41, w: 290 },
    { id: 'well',        screen: 'screen-well',        icon: '⛲', art: 'assets/Enchanted Well.png',   title: 'Enchanted Well',  blurb: 'Cast wishing stones into the dark to widen fate and unlock new glyphs, blessings and relics for runs to come.', x: 52, y: 55, w: 240 },
    { id: 'gravemarker', screen: 'screen-gravemarker', icon: '🪦', art: 'assets/Gravemarkers.png',    title: 'Gravemarkers',    blurb: 'Remember the fallen — the builds of past runs and your lifetime deeds in the Spire.', x: 28, y: 61, w: 270 }
  ];
  // the dialogue box is always on: it reads as the hub's intro until a landmark
  // is hovered (desktop) or tapped (touch), then describes that landmark.
  const LW_DEFAULT = {
    title: 'The Lost Woods',
    blurb: 'A dead clearing where the Spire keeps its memories. Choose a landmark to inspect it.',
    screen: 'hub'
  };
  let lwArmed = null;   // id of a touch-selected POI awaiting a confirming second tap
  function lwDiaContent(poi, focused) {
    const t = $('lw-dia-title'), bd = $('lw-dia-body'), box = $('lw-dialogue');
    if (t) t.textContent = poi.title;
    if (bd) bd.innerHTML = poi.blurb + (poi.screen ? '' : ' <span class="lw-dia-seal">Sealed for now.</span>');
    if (box) box.classList.toggle('focused', !!focused);
  }
  function clearLwActive() {
    const h = $('lw-pois');
    if (h) h.querySelectorAll('.lw-poi.is-active').forEach(e => e.classList.remove('is-active'));
  }
  function setLwDialogue(poi) { lwDiaContent(poi, true); }
  function resetLwDialogue() { lwArmed = null; clearLwActive(); lwDiaContent(LW_DEFAULT, false); }
  function enterPoi(poi) {
    if (!poi.screen) { if (SFX.error) SFX.error(); return; }
    SFX.click();
    if (poi.id === 'gravemarker') buildGravemarker();
    else if (poi.id === 'stonetable') buildStoneTable();
    else if (poi.id === 'monsterbook') buildMonsterBook();
    else if (poi.id === 'well') buildWell();
    show(poi.screen);
  }
  // hyperreal fireflies: a scatter of soft glowing motes that wander on looping
  // organic paths and breathe in/out (blink) at their own pace, giving the dead
  // clearing a living shimmer. Pure compositor transforms + opacity = cheap; the
  // count is trimmed on touch devices so phone GPUs stay smooth.
  function spawnFireflies() {
    const layer = $('lw-fireflies');
    if (!layer) return;
    layer.innerHTML = '';
    // Touch GPUs: these animated, glow-shadowed motes force the whole hub onto
    // composited layers, which makes the big background <img> exceed the max
    // texture size and tear into tiles. Skip them entirely on touch — they're
    // imperceptible on a phone anyway — so the backdrop paints cleanly.
    const canHover = !!(window.matchMedia && window.matchMedia('(hover: hover)').matches);
    if (!canHover) return;
    const count = 20;
    const W = 1920, H = 1080;
    for (let i = 0; i < count; i++) {
      const f = document.createElement('span');
      f.className = 'lw-firefly';
      const depth = 0.45 + Math.random() * 0.55;          // back motes are smaller/dimmer
      const size = (2.2 + Math.random() * 3.4) * depth + 1.4;
      f.style.width = f.style.height = size.toFixed(1) + 'px';
      f.style.left = (Math.random() * W).toFixed(0) + 'px';
      f.style.top = (180 + Math.random() * (H - 380)).toFixed(0) + 'px';
      f.style.setProperty('--glow', (size * (2.4 + Math.random())).toFixed(1) + 'px');
      f.style.opacity = '0';
      layer.appendChild(f);
      if (typeof f.animate !== 'function') continue;
      // a closed, looping wander built from a few random waypoints
      const steps = 4, frames = [];
      for (let s = 0; s <= steps; s++) {
        const x = (Math.random() * 2 - 1) * 150;
        const y = (Math.random() * 2 - 1) * 110;
        frames.push({ transform: 'translate(' + x.toFixed(0) + 'px,' + y.toFixed(0) + 'px)' });
      }
      frames.push({ transform: 'translate(0px,0px)' });
      f.animate(frames, {
        duration: 11000 + Math.random() * 12000,
        iterations: Infinity, easing: 'ease-in-out',
        delay: -Math.random() * 12000
      });
      // independent twinkle so the swarm never pulses in unison
      const peak = (0.55 + Math.random() * 0.4) * depth;
      f.animate(
        [{ opacity: 0 }, { opacity: peak, offset: 0.25 }, { opacity: peak * 0.28, offset: 0.55 },
         { opacity: peak, offset: 0.8 }, { opacity: 0 }],
        { duration: 2400 + Math.random() * 3600, iterations: Infinity,
          delay: -Math.random() * 5000, easing: 'ease-in-out' }
      );
    }
  }
  function buildLostWoods() {
    const host = $('lw-pois');
    if (!host) return;
    host.innerHTML = '';
    spawnFireflies();
    resetLwDialogue();
    // tapping empty ground clears any touch selection back to the default blurb
    host.onclick = e => { if (e.target === host) resetLwDialogue(); };
    LW_POIS.forEach(poi => {
      const soon = !poi.screen;
      const b = el('button', 'lw-poi lw-poi-' + poi.id + (poi.art ? ' lw-poi-hasart' : '') + (soon ? ' lw-poi-soon' : ''));
      b.style.left = poi.x + '%';
      b.style.top = poi.y + '%';
      if (poi.w) b.style.setProperty('--poi-w', poi.w + 'px');
      b.setAttribute('aria-label', poi.title);
      // art POIs render the structure itself directly on the forest floor — no
      // carved-stone pin and no ground glow (the painted art carries its own base).
      // Names/details now live in the always-on bottom dialogue box.
      b.innerHTML = poi.art
        ? '<img class="lw-poi-art" src="' + poi.art + '" alt="" draggable="false">'
        : '<span class="lw-poi-pin"><span class="lw-poi-glow"></span><span class="lw-poi-icon">' + poi.icon + '</span></span>';
      // desktop: hover previews in the dialogue, leaving reverts to default
      b.addEventListener('mouseenter', () => { if (!lwArmed) { if (SFX.hover) SFX.hover(); setLwDialogue(poi); } });
      b.addEventListener('focus', () => { if (!lwArmed) setLwDialogue(poi); });
      b.addEventListener('mouseleave', () => { if (!lwArmed) resetLwDialogue(); });
      b.addEventListener('blur', () => { if (!lwArmed) resetLwDialogue(); });
      b.addEventListener('click', () => {
        // on touch (no real hover) the first tap only previews the landmark in
        // the dialogue; a second tap on the same one confirms entry
        const touchMode = !(window.matchMedia && window.matchMedia('(hover: hover)').matches);
        if (touchMode && lwArmed !== poi.id) {
          lwArmed = poi.id;
          clearLwActive();
          b.classList.add('is-active');
          if (SFX.hover) SFX.hover();
          setLwDialogue(poi);
          return;
        }
        enterPoi(poi);
      });
      host.appendChild(b);
    });
  }

  // ---- GRAVEMARKER ----
  function statTile(label, val) {
    return '<div class="gm-stat"><div class="gm-stat-val">' + val + '</div><div class="gm-stat-label">' + label + '</div></div>';
  }
  // a "cool data display" of total time played, split into dd : hh : mm : ss
  function gmPlaytimeBanner(ms) {
    let sec = Math.max(0, Math.floor((ms || 0) / 1000));
    const d = Math.floor(sec / 86400); sec -= d * 86400;
    const h = Math.floor(sec / 3600); sec -= h * 3600;
    const m = Math.floor(sec / 60); sec -= m * 60;
    const pad = n => (n < 10 ? '0' + n : '' + n);
    const seg = (v, lab) => '<div class="gm-clock-seg"><span class="gm-clock-num">' + pad(v) + '</span><span class="gm-clock-lab">' + lab + '</span></div>';
    return '<div class="gm-clock" aria-label="Total time played">' +
      '<div class="gm-clock-title">Time in the Spire</div>' +
      '<div class="gm-clock-digits">' +
        seg(d, 'Days') + '<span class="gm-clock-sep">:</span>' +
        seg(h, 'Hrs') + '<span class="gm-clock-sep">:</span>' +
        seg(m, 'Min') + '<span class="gm-clock-sep">:</span>' +
        seg(sec, 'Sec') +
      '</div>' +
    '</div>';
  }
  // a compact stat strip for each remembered run
  function gmRunStatStrip(snap) {
    const rs = snap.runStats || {};
    const kills = (rs.killsNormal || 0) + (rs.killsElite || 0) + (rs.killsBoss || 0);
    const chip = (lab, val) => '<span class="gm-rs"><b>' + val + '</b> ' + lab + '</span>';
    const bits = [];
    if (snap.durationMs != null) bits.push(chip('time', formatDuration(snap.durationMs)));
    bits.push(chip('slain', kills));
    if (rs.killsElite) bits.push(chip('elites', rs.killsElite));
    if (rs.killsBoss) bits.push(chip('bosses', rs.killsBoss));
    if (rs.bestCombo) bits.push(chip('combo', rs.bestCombo));
    if (rs.bestHit) bits.push(chip('big hit', rs.bestHit));
    if (rs.bestTurnDmg) bits.push(chip('best turn', rs.bestTurnDmg));
    if (rs.soulsGained) bits.push(chip('souls', rs.soulsGained));
    return '<div class="gm-section"><div class="gm-sec-label">This Run</div><div class="gm-rs-row">' + bits.join('') + '</div></div>';
  }
  // ---- detailed chips (used in the run-detail modal): each carries a data-tip
  //      so hovering pops the shared inspector with full rules text. ----
  function gmDeckChipsTip(deck) {
    const counts = {};
    (deck || []).forEach(id => { const b = baseOf(id); counts[b] = (counts[b] || 0) + 1; });
    const ids = Object.keys(counts);
    if (!ids.length) return '<span class="gm-empty">—</span>';
    return ids.map(b => {
      const g = GLYPHS[b];
      if (!g) return '';
      const tip = escAttr('<b>' + g.name + '</b><br>' + DATA.formatDesc(g));
      return '<span class="gm-pill gm-pill-tip" data-cat="Glyph" data-tip="' + tip + '" style="--g-color:var(--' + g.color + ')">' +
        g.name + (counts[b] > 1 ? ' <b>×' + counts[b] + '</b>' : '') + '</span>';
    }).join('');
  }
  function gmBlessChipsTip(ids) {
    const map = allBlessMap();
    const list = (ids || []).map(id => map[id]).filter(Boolean);
    if (!list.length) return '<span class="gm-empty">—</span>';
    return list.map(bl => {
      const tip = escAttr('<b>' + bl.name + '</b><br>' + (bl.desc || ''));
      return '<span class="gm-pill gm-pill-art gm-pill-tip" data-cat="Blessing" data-tip="' + tip + '">' +
        blessArtHTML(bl, 'gm-pill-img') + ' ' + bl.name + '</span>';
    }).join('');
  }
  function gmItemChipsTip(ids) {
    const list = (ids || []).map(id => ITEMS[id]).filter(Boolean);
    if (!list.length) return '<span class="gm-empty">—</span>';
    return list.map(it => {
      const tip = escAttr('<b>' + it.name + '</b><br>' + (it.desc || ''));
      return '<span class="gm-pill gm-pill-art gm-pill-tip" data-cat="Item" data-tip="' + tip + '">' +
        itemArtHTML(it, 'gm-pill-img') + ' ' + it.name + '</span>';
    }).join('');
  }
  // common bits both the summary card and the detail modal need
  function gmRunVisuals(snap) {
    const beast = MONSTERS[snap.beast];
    const finalForm = (snap.evoChoices && snap.evoChoices.length)
      ? evoFormById(snap.beast, snap.evoChoices[snap.evoChoices.length - 1]) : null;
    const img = (finalForm && finalForm.img) || (beast && beast.img) || '';
    const accent = finalForm ? evoAccent(finalForm) : (beast && beast.color) || 'var(--gold)';
    const name = snap.beastName || (beast && beast.name) || 'Unknown Beast';
    const path = (snap.evoChoices || []).map(fid => {
      const f = evoFormById(snap.beast, fid);
      return f ? f.name : fid;
    });
    const portrait = img
      ? '<img class="gm-port-img" src="' + img + '" alt="" draggable="false">'
      : '<span class="gm-port-emoji">' + ((beast && beast.emoji) || '✦') + '</span>';
    const result = snap.win
      ? '<span class="gm-result gm-win">Victory</span>'
      : '<span class="gm-result gm-loss">Fell on Floor ' + (snap.act || 1) + '</span>';
    const modeTag = snap.mode === 'descension'
      ? '<span class="gm-mode gm-mode-desc">⮟ Descent ' + roman(snap.descension || 1) + '</span>'
      : '<span class="gm-mode">Classic</span>';
    return { beast, img, accent, name, path, portrait, result, modeTag };
  }
  // a compact, clickable summary tile — full detail lives in openRunDetail()
  function gmRunCard(snap, idx) {
    const v = gmRunVisuals(snap);
    const when = new Date(snap.at || Date.now());
    const date = when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const nDeck = (snap.deck || []).length;
    const nBless = (snap.blessings || []).length;
    const nItems = (snap.items || []).length;
    const counts = '<span class="gm-foot-count">' + nDeck + ' glyphs</span>' +
      '<span class="gm-foot-count">' + nBless + ' blessings</span>' +
      '<span class="gm-foot-count">' + nItems + ' items</span>';
    return '<div class="gm-card gm-card-click" data-run="' + idx + '" role="button" tabindex="0" ' +
        'aria-label="Inspect run: ' + escAttr(v.name) + '" style="--acc:' + v.accent + '">' +
      '<div class="gm-card-head">' +
        '<div class="gm-port">' + v.portrait + '</div>' +
        '<div class="gm-card-id">' +
          '<div class="gm-card-name">' + v.name + '</div>' +
          '<div class="gm-card-meta">' + v.modeTag + v.result + '<span class="gm-stones">✦ ' + (snap.stones || 0) + '</span></div>' +
          (v.path.length ? '<div class="gm-path">' + v.path.join(' <span class="gm-arrow">›</span> ') + '</div>' : '') +
          '<div class="gm-date">' + date + '</div>' +
        '</div>' +
      '</div>' +
      gmRunStatStrip(snap) +
      '<div class="gm-card-foot"><div class="gm-foot-counts">' + counts + '</div>' +
        '<span class="gm-foot-cta">Inspect <span class="gm-arrow">›</span></span></div>' +
    '</div>';
  }
  // the big, hover-rich run dossier
  function openRunDetail(snap) {
    const v = gmRunVisuals(snap);
    const when = new Date(snap.at || Date.now());
    const date = when.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) +
      ' · ' + when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const rs = snap.runStats || {};
    const kills = (rs.killsNormal || 0) + (rs.killsElite || 0) + (rs.killsBoss || 0);
    const tiles =
      runStatTile('Run Time', formatDuration(snap.durationMs || 0), { hero: true }) +
      runStatTile('Enemies Slain', kills) +
      runStatTile('Normal', rs.killsNormal || 0) +
      runStatTile('Elites', rs.killsElite || 0) +
      runStatTile('Bosses', rs.killsBoss || 0) +
      runStatTile('Souls Gained', rs.soulsGained || 0) +
      runStatTile('Blessings', (snap.blessings || []).length) +
      runStatTile('Items Found', rs.itemsObtained || 0) +
      runStatTile('Items Used', rs.itemsUsed || 0) +
      runStatTile('Highest Combo', rs.bestCombo || 0) +
      runStatTile('Best Turn', rs.bestTurnDmg || 0) +
      runStatTile('Biggest Hit', rs.bestHit || 0);
    const html = '<div class="grm" style="--acc:' + v.accent + '">' +
      '<div class="grm-head">' +
        '<div class="grm-port">' + v.portrait + '</div>' +
        '<div class="grm-id">' +
          '<div class="grm-name">' + v.name + '</div>' +
          '<div class="grm-badges">' + v.modeTag + v.result +
            '<span class="gm-stones">✦ ' + (snap.stones || 0) + ' earned</span></div>' +
          (v.path.length ? '<div class="grm-path">' + v.path.join(' <span class="gm-arrow">›</span> ') + '</div>' : '') +
          '<div class="grm-date">' + date + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="grm-sec"><div class="grm-sec-label">Run Record</div><div class="grm-stats">' + tiles + '</div></div>' +
      '<div class="grm-sec"><div class="grm-sec-label">Deck — ' + (snap.deck || []).length + ' glyphs</div>' +
        '<div class="gm-chips">' + gmDeckChipsTip(snap.deck) + '</div></div>' +
      '<div class="grm-sec"><div class="grm-sec-label">Blessings</div>' +
        '<div class="gm-chips">' + gmBlessChipsTip(snap.blessings) + '</div></div>' +
      '<div class="grm-sec"><div class="grm-sec-label">Items Carried</div>' +
        '<div class="gm-chips">' + gmItemChipsTip(snap.items) + '</div></div>' +
    '</div>';
    openLwModal(html, resolveColor(v.accent), 'run');
  }
  function buildGravemarker() {
    const body = $('gravemarker-body');
    if (!body) return;
    const s = META.stats || {};
    const stats =
      '<div class="gm-stats-panel">' +
        '<h3 class="gm-panel-title">Lifetime Deeds</h3>' +
        gmPlaytimeBanner(s.playTimeMs || 0) +
        '<div class="gm-stats-grid">' +
          statTile('Runs', s.runs || 0) +
          statTile('Wins', s.wins || 0) +
          statTile('Classic Wins', s.classicWins || 0) +
          statTile('Descents Won', s.descensionWins || 0) +
          statTile('Deepest Descent', (META.descension && META.descension.cleared) || 0) +
          statTile('Best Floor', s.bestAct || 0) +
          statTile('Enemies Slain', s.kills || 0) +
          statTile('Souls Gathered', s.soulsGained || 0) +
          statTile('Highest Combo', s.bestCombo || 0) +
          statTile('Biggest Hit', s.bestHit || 0) +
          statTile('Best Turn', s.bestTurnDmg || 0) +
          statTile('Wishing Stones', '✦ ' + (META.wishingStones || 0)) +
        '</div>' +
      '</div>';
    const hist = (META.runHistory || []);
    const runs = hist.length
      ? '<div class="gm-runs">' + hist.map(gmRunCard).join('') + '</div>'
      : '<div class="lw-empty">No runs remembered yet. The Spire awaits its first offering.</div>';
    const runsTitle = hist.length
      ? 'Remembered Runs <em class="gm-recent-count">' + hist.length + '</em>'
      : 'Remembered Runs';
    body.innerHTML = stats + '<h3 class="gm-panel-title gm-recent-title">' + runsTitle + '</h3>' + runs;
    // each summary tile opens the full run dossier (click or keyboard)
    const runsWrap = body.querySelector('.gm-runs');
    if (runsWrap) {
      const openFromEl = (el) => {
        const card = el && el.closest('.gm-card-click');
        if (!card) return;
        const snap = hist[parseInt(card.dataset.run, 10)];
        if (snap) { SFX.click(); openRunDetail(snap); }
      };
      runsWrap.addEventListener('click', (e) => openFromEl(e.target));
      runsWrap.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFromEl(e.target); }
      });
    }
  }

  // ---- STONE TABLE ----
  function evoFormById(beastId, formId) {
    const tree = MONSTERS[beastId] && MONSTERS[beastId].evolution;
    if (!tree) return null;
    let f = (tree.tier1 || []).find(x => x.id === formId);
    if (f) return f;
    const t2 = tree.tier2 || {};
    for (const k in t2) { const hit = (t2[k] || []).find(x => x.id === formId); if (hit) return hit; }
    return null;
  }
  // A bare evolution node (no card box): portrait + name + subtitle, dropped
  // onto the branch canvas at an absolute (x,y) in the 1560×760 viewBox.
  function stNode(beast, form, kind, x, y) {
    const acc = kind === 'base' ? (beast.color || 'var(--gold)') : evoAccent(form);
    const fid = kind === 'base' ? '__base__' : form.id;
    // base form is always known; evo forms stay a mystery until evolved into once
    const locked = kind !== 'base' && !metaEvolved(fid);
    const name = kind === 'base' ? beast.name : (locked ? '? ? ?' : form.name);
    const tag = kind === 'base' ? 'Base Form' : (locked ? 'Undiscovered' : (form.tagline || ''));
    const img = kind === 'base'
      ? (beast.img ? '<img class="st-node-img" src="' + beast.img + '" alt="" draggable="false">' : '<span class="st-beast-emoji">' + (beast.emoji || '✦') + '</span>')
      : evoFormImg(form, beast, 'st-node-img');
    // a second copy of the portrait sits behind the real one wearing a static
    // accent drop-shadow — so the hover glow hugs the monster's exact silhouette.
    const glow = kind === 'base'
      ? (beast.img ? '<img class="st-node-glow" src="' + beast.img + '" alt="" aria-hidden="true" draggable="false">' : '')
      : evoFormImg(form, beast, 'st-node-glow');
    return '<button class="st-node st-node-' + kind + (locked ? ' st-node-locked' : '') + '" data-beast="' + beast.id + '" data-form="' + fid + '" ' +
      'style="--acc:' + acc + ';left:' + x + 'px;top:' + y + 'px">' +
      '<span class="st-node-port">' + glow + img + '</span>' +
      '<span class="st-node-name">' + name + '</span>' +
      (tag ? '<span class="st-node-tag">' + tag + '</span>' : '') +
    '</button>';
  }
  // a glowing organic limb between two points (horizontal S-curve), painted
  // with a gradient that flows from the parent's color into the child's.
  function stBranch(x1, y1, x2, y2, w, delay, gradId) {
    const mx = (x1 + x2) / 2;
    const d = 'M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2;
    return '<path class="st-branch-line" d="' + d + '" stroke="url(#' + gradId + ')" stroke-width="' + w +
      '" filter="url(#stGlow)" style="animation-delay:' + delay + 's"></path>';
  }
  function stGradDef(id, from, to) {
    return '<linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="0">' +
      '<stop offset="0" stop-color="' + from + '"/>' +
      '<stop offset="1" stop-color="' + to + '"/>' +
    '</linearGradient>';
  }
  let stSelectedBeast = null;   // which hero the Star Charts (and Glyph Codex) is focused on
  function buildStoneTable() {
    const roster = $('stonetable-roster');
    if (roster) {
      roster.innerHTML = '';
      Object.values(MONSTERS).forEach((b, i) => {
        const btn = el('button', 'st-beast' + (i === 0 ? ' active' : ''));
        btn.dataset.beast = b.id;
        btn.style.setProperty('--acc', b.color || 'var(--gold)');
        btn.innerHTML = (b.img ? '<img class="st-beast-img" src="' + b.img + '" alt="" draggable="false">' : '<span class="st-beast-emoji">' + (b.emoji || '✦') + '</span>') +
          '<span class="st-beast-name">' + b.name + '</span>';
        btn.addEventListener('click', () => {
          SFX.click();
          roster.querySelectorAll('.st-beast').forEach(x => x.classList.remove('active'));
          btn.classList.add('active');
          stoneTableSelect(b.id);
        });
        roster.appendChild(btn);
      });
    }
    const first = Object.values(MONSTERS)[0];
    if (first) stoneTableSelect(first.id);
  }
  function stoneTableSelect(beastId) {
    stSelectedBeast = beastId;
    const lab = $('st-codex-label');
    const bn = (MONSTERS[beastId] || {}).name;
    if (lab) lab.textContent = bn ? bn + "'s Glyphs" : 'Glyph Codex';
    const tree = $('stonetable-tree');
    const beast = MONSTERS[beastId];
    if (!tree || !beast || !beast.evolution) { if (tree) tree.innerHTML = ''; return; }
    const t1 = beast.evolution.tier1 || [];
    const t2 = beast.evolution.tier2 || {};
    // fixed layout in the 1700×820 branch canvas. The four tier-2 forms are
    // zig-zagged left/right (X.t2 alternates) so their stacked subtitles never
    // collide the way a single vertical column did.
    const X = { base: 130, t1: 770 };
    const baseY = 410;
    const Yt1 = [235, 585];
    // per (branch, child): an explicit {x,y} so we can stagger them
    const T2 = [
      [{ x: 1560, y: 120 }, { x: 1410, y: 330 }],
      [{ x: 1560, y: 490 }, { x: 1410, y: 700 }]
    ];

    const baseColor = resolveColor(beast.color || 'var(--gold)');
    let paths = '', defs = '', gi = 0;
    let nodes = stNode(beast, null, 'base', X.base, baseY);
    t1.forEach((t1form, bi) => {
      const y1 = Yt1[bi] != null ? Yt1[bi] : baseY;
      const c1 = resolveColor(evoAccent(t1form));
      const g1 = 'stG' + (gi++);
      defs += stGradDef(g1, baseColor, c1);
      paths += stBranch(X.base, baseY, X.t1, y1, 10, bi * 0.12, g1);
      nodes += stNode(beast, t1form, 't1', X.t1, y1);
      (t2[t1form.id] || []).forEach((f, ci) => {
        const pos = (T2[bi] && T2[bi][ci]) || { x: 1480, y: y1 };
        const c2 = resolveColor(evoAccent(f));
        const g2 = 'stG' + (gi++);
        defs += stGradDef(g2, c1, c2);
        paths += stBranch(X.t1, y1, pos.x, pos.y, 6, 0.32 + ci * 0.12, g2);
        nodes += stNode(beast, f, 't2', pos.x, pos.y);
      });
    });
    const svg = '<svg class="st-branches-svg" viewBox="0 0 1700 820" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
      '<defs>' + defs +
        '<filter id="stGlow" x="-40%" y="-40%" width="180%" height="180%">' +
          '<feGaussianBlur stdDeviation="3.5" result="b"/>' +
          '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>' +
        '</filter>' +
      '</defs>' + paths + '</svg>';
    tree.innerHTML = '<div class="st-stage">' + svg + nodes + '</div>';
    tree.querySelectorAll('.st-node').forEach(node => {
      node.addEventListener('click', () => {
        SFX.click();
        const fid = node.dataset.form;
        if (fid === '__base__') {
          const acc = beast.color || 'var(--gold)';
          openLwModal(stDetailHTML(beast, {
            name: beast.name, img: beast.img, tagline: 'Base Form',
            passive: { name: beast.role || 'Passive', text: beast.passiveText || beast.desc || '' }
          }, acc), acc, 'stone');
        } else {
          const form = evoFormById(beastId, fid);
          if (!form) return;
          if (!metaEvolved(fid)) openLwModal(stLockedHTML(beast, form, evoAccent(form)), evoAccent(form), 'stone');
          else openLwModal(stDetailHTML(beast, form, evoAccent(form)), evoAccent(form), 'stone');
        }
      });
    });
  }
  // Built to be the twin of the in-run evolution-selection card — same frame,
  // same glow, same big portrait — minus the bits that only matter mid-run
  // (the "Choose" button and the +Max HP pip).
  function stDetailHTML(beast, form, accent) {
    const p = form.passive || {};
    const socket = form.socket
      ? '<div class="evo-card-stats"><span class="evo-card-socket"><span class="ecs-ico">◈</span> ' + (form.socket.label || 'Special') + ' socket</span></div>' : '';
    return '<div class="lw-card evo-card" style="--acc:' + accent + '">' +
      '<div class="evo-card-tag">' + (form.tagline || 'Base Form') + '</div>' +
      '<div class="evo-card-port">' + evoFormImg(form, beast) +
        '<span class="evo-card-glow"></span></div>' +
      '<div class="evo-card-name">' + form.name + '</div>' +
      socket +
      '<div class="evo-card-passive">' +
        (p.name ? '<span class="ecp-name">✦ ' + p.name + '</span>' : '') +
        '<span class="ecp-text">' + (p.text || '') + '</span>' +
      '</div>' +
    '</div>';
  }
  // an undiscovered form: a darkened silhouette of its shape and an enticing
  // prompt — never spoils the name, tagline, or passive.
  function stLockedHTML(beast, form, accent) {
    return '<div class="lw-card evo-card lw-card-locked" style="--acc:' + accent + '">' +
      '<div class="evo-card-tag">Undiscovered</div>' +
      '<div class="evo-card-port lwc-port-silhouette">' + evoFormImg(form, beast) +
        '<span class="evo-card-glow"></span><span class="lwc-rune" aria-hidden="true">?</span></div>' +
      '<div class="evo-card-name">? ? ?</div>' +
      '<div class="evo-card-passive">' +
        '<span class="ecp-text lwc-mystery">This evolution is still hidden among the stars. Guide <b>' + beast.name +
        '</b> down this path at least once and it will be inscribed upon the chart forever.</span>' +
      '</div>' +
    '</div>';
  }
  // ============================================================
  // GLYPH CODEX — every glyph a chosen hero can meet across a run:
  // its signature glyphs, the shared neutral pool, and the soul-glyphs.
  // Well-gated entries show as "locked" until inscribed at the Well.
  // ============================================================
  function codexLocked(g) { return !!(g.unlock && !(META.unlocks && META.unlocks[g.unlock])); }
  function codexGroupsFor(heroId) {
    const sig = [], neutral = [], soul = [];
    Object.values(GLYPHS).forEach(g => {
      if (!g || g.junk || g.token) return;
      if (g.colorless) soul.push(g);
      else if (!g.character) neutral.push(g);
      else if (g.character === heroId) sig.push(g);
    });
    const rank = { common: 0, uncommon: 1, rare: 2 };
    // unlocked first, then by rarity, then alphabetical — a readable wall
    const cmp = (a, b) => {
      const la = codexLocked(a) ? 1 : 0, lb = codexLocked(b) ? 1 : 0;
      if (la !== lb) return la - lb;
      const ra = rank[a.rarity] || 0, rb = rank[b.rarity] || 0;
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    };
    sig.sort(cmp); neutral.sort(cmp); soul.sort(cmp);
    return [
      { id: 'sig', label: 'Signature Glyphs', accent: (MONSTERS[heroId] || {}).color || 'var(--gold)', list: sig },
      { id: 'neutral', label: 'Neutral Glyphs', accent: 'var(--gold)', list: neutral },
      { id: 'soul', label: 'Soul Glyphs', accent: 'var(--white)', list: soul }
    ];
  }
  function codexCard(g, i) {
    const style = ' style="--g-color:var(--' + (g.color || 'gold') + ');--d:' + (i % 14) + '"';
    // locked = a total mystery: blacked-out shape, redacted name, no type leak
    if (codexLocked(g)) {
      return '<button class="gc-card gc-locked" data-glyph="' + g.id + '"' + style + '>' +
        '<span class="gc-lock" aria-hidden="true">🔒</span>' +
        '<span class="gc-art">' + glyphArtHTML(g) + '</span>' +
        '<span class="gc-name">? ? ?</span>' +
        '<span class="gc-kind">Undiscovered</span>' +
      '</button>';
    }
    const slots = g.slots || 1;
    const kind = GLYPH_KIND[g.color] || 'Glyph';
    return '<button class="gc-card" data-glyph="' + g.id + '"' + style + '>' +
      letterChipHTML(g) +
      '<span class="gc-art">' + glyphArtHTML(g) + '</span>' +
      '<span class="gc-name">' + g.name + '</span>' +
      '<span class="gc-kind">' + kind + (slots > 1 ? ' · ⬡' + slots : '') + '</span>' +
    '</button>';
  }
  function buildGlyphCodex(heroId) {
    const body = $('glyphcodex-body');
    const beast = MONSTERS[heroId] || Object.values(MONSTERS)[0];
    if (!body || !beast) return;
    const groups = codexGroupsFor(beast.id);
    let total = 0, unlocked = 0;
    groups.forEach(grp => grp.list.forEach(g => { total++; if (!codexLocked(g)) unlocked++; }));
    const prog = $('gc-progress');
    if (prog) prog.textContent = unlocked + ' / ' + total + ' unlocked';
    const portrait = beast.img
      ? '<img class="gc-hero-img" src="' + beast.img + '" alt="" draggable="false">'
      : '<span class="gc-hero-emoji">' + (beast.emoji || '✦') + '</span>';
    let html = '<div class="gc-hero" style="--acc:' + (beast.color || 'var(--gold)') + '">' +
      '<div class="gc-hero-port">' + portrait + '<span class="gc-hero-glow"></span></div>' +
      '<div class="gc-hero-meta">' +
        '<div class="gc-hero-name">' + beast.name + '</div>' +
        '<div class="gc-hero-sub">Every glyph that can surface in ' + beast.name + '\u2019s runs.</div>' +
      '</div>' +
    '</div>';
    groups.forEach(grp => {
      if (!grp.list.length) return;
      const u = grp.list.filter(g => !codexLocked(g)).length;
      html += '<section class="gc-section" style="--acc:' + grp.accent + '">' +
        '<header class="gc-sec-head">' +
          '<span class="gc-sec-line"></span>' +
          '<h3 class="gc-sec-title">' + grp.label + '</h3>' +
          '<span class="gc-sec-count">' + u + ' / ' + grp.list.length + '</span>' +
          '<span class="gc-sec-line"></span>' +
        '</header>' +
        '<div class="gc-grid">' + grp.list.map(codexCard).join('') + '</div>' +
      '</section>';
    });
    body.innerHTML = html;
    body.scrollTop = 0;
    body.querySelectorAll('.gc-card').forEach(card => {
      card.addEventListener('mouseenter', () => { if (SFX.hover) SFX.hover(); });
      card.addEventListener('click', () => {
        SFX.click();
        const g = GLYPHS[card.dataset.glyph];
        if (g) openLwModal(codexDetailHTML(g), 'var(--' + (g.color || 'gold') + ')', 'stone');
      });
    });
  }
  function codexDetailHTML(g) {
    const acc = 'var(--' + (g.color || 'gold') + ')';
    // locked: reveal nothing — a haloed silhouette, redacted name, no stats or text
    if (codexLocked(g)) {
      return '<div class="lw-card gc-detail gc-detail-locked" style="--acc:' + acc + ';--g-color:' + acc + '">' +
        '<div class="gc-detail-tag">Undiscovered</div>' +
        '<div class="gc-detail-art gc-detail-sil">' + glyphArtHTML(g) +
          '<span class="gc-sil-rune" aria-hidden="true">?</span></div>' +
        '<div class="gc-detail-name">? ? ?</div>' +
        '<div class="gc-detail-desc gc-detail-mystery">A glyph not yet inscribed upon your path. Its shape flickers in the dark, its power hidden until the stars align.</div>' +
        '<div class="gc-detail-state gc-state-locked">🔒 Locked — widen fate at the <b>Enchanted Well</b> to reveal and unlock this glyph.</div>' +
      '</div>';
    }
    const slots = g.slots || 1;
    const kind = GLYPH_KIND[g.color] || 'Glyph';
    // the dedicated ⬡ chip already states the socket cost, so strip the redundant
    // "Takes N sockets" note from the tail of the description
    let desc = DATA.formatDesc(g, metaEnv(g.id));
    if (slots > 1) {
      desc = desc.replace(/Takes\s*\d+\s*sockets\.?\s*/i, '')
                 .replace(/<i>\s*<\/i>/i, '')
                 .replace(/(<br>\s*)+$/i, '');
    }
    const isAtk = g.dyn && g.dyn.some(t => t.kind === 'dmg');
    return '<div class="lw-card gc-detail" style="--acc:' + acc + ';--g-color:' + acc + '">' +
      '<div class="gc-detail-tag">' + glyphOwner(g) + ' · ' + kind + ' · ' + (g.rarity || 'common') + '</div>' +
      '<div class="gc-detail-art">' + letterChipHTML(g) + glyphArtHTML(g) + '</div>' +
      '<div class="gc-detail-name">' + g.name + '</div>' +
      (slots > 1 ? '<div class="gc-detail-slots">⬡ Takes ' + slots + ' sockets</div>' : '') +
      (isAtk ? '<div class="gc-detail-str">⚔ Strength ×' + DATA.strMulOf(g, 0) + '<span class="gcs-note"> added to each hit</span></div>' : '') +
      '<div class="gc-detail-desc">' + desc + '</div>' +
      '<div class="gc-detail-state gc-state-open">✦ Unlocked — this glyph can appear on your path.</div>' +
    '</div>';
  }
  const MB_TIER_ACCENT = { common: '#c9b8a8', elite: '#ffce5e', boss: '#ff7a6a', shadow: '#b98cff' };

  // ---- MONSTER BOOK ----
  function monsterBookRoster() {
    const list = Object.values(ENEMIES).filter(e => e && !e.token);
    // Soulhunter is generated at runtime, so it has no static ENEMIES entry.
    list.push({ id: 'soulhunter', name: 'Soulhunter', emoji: '☠️', img: 'assets/Soulhunter I.png',
      _synthetic: true, boss: true, shadow: true,
      desc: 'A shapeless hunter from beyond the chain — it returns in a deadlier form each time you meet it.' });
    return list;
  }
  function enemyTierLabel(def) {
    if (def.boss || def.floorBoss) return 'Boss';
    if (def.elite) return 'Elite';
    if (def._synthetic) return 'Shadow';
    return 'Common';
  }
  function intentLabel(it) {
    switch (it.type) {
      case 'attack': return '⚔ ' + it.value + (it.hits > 1 ? ' ×' + it.hits : '') + (it.big ? ' (big)' : '');
      case 'defend': return '🛡 ' + it.value;
      case 'curse': return 'Curse' + (it.count > 1 ? ' ×' + it.count : (it.maliceCount ? ' ×Malice' : ''));
      case 'sunder': return 'Seal ' + (it.value || 2);
      case 'debuff': return (it.stat || 'debuff') + ' ' + it.value;
      case 'buff': return 'Empower ' + it.value;
      case 'siphon': return 'Siphon ' + (it.stat || '');
      case 'regen': return 'Regen ' + it.value;
      case 'rally': return 'Rally ' + it.value;
      case 'summon': return 'Summon';
      case 'birthBrood': return it.label || 'Birth Brood';
      case 'dirge': return 'Dirge';
      case 'warcry': return 'Rally +' + (it.value || 4);
      case 'frustration': return 'Frustration';
      case 'gorge': return 'Gorge ×junk';
      case 'quarry': return 'Quarry +' + (it.value || 1);
      case 'soulReap': return 'Soul Reap';
      case 'doom': return '999';
      case 'clog': return 'Dead Weight';
      case 'trash': return 'Bury Rubble';
      case 'thinking': return 'Thinking';
      case 'thornsAll': return 'Thorns ' + (it.value || 3) + ' (all)';
      case 'blockAll': return 'Guard ' + (it.value || 5) + ' (all)';
      case 'buffStat': return (it.stat === 'resilience' ? 'Resilience +' : 'Strength +') + (it.value || 1) + (it.scope === 'self' ? '' : ' (all)');
      case 'banish': return 'Banish socket';
      case 'scare': return 'Scare ' + (it.value || 2);
      case 'sap': return 'Sap ' + (it.value || 4);
      case 'mature': return 'Mature';
      case 'hex': return 'Hex';
      default: return it.type;
    }
  }
  // a plain-language explanation of an intent, shown on hover in the bestiary
  function intentTip(it) {
    const n = it.value;
    switch (it.type) {
      case 'attack': return it.hits > 1
        ? 'Strikes for ' + n + ' damage ' + it.hits + ' times (' + (n * it.hits) + ' total).'
        : (it.big ? 'Winds up a single heavy blow for ' + n + ' damage.' : 'Attacks for ' + n + ' damage.');
      case 'defend': return 'Raises ' + n + ' Block to absorb your hits.';
      case 'curse': return 'Curses a glyph socket — its effect still lands, but is mirrored: your shields & heals also feed the caster, its damage & burns recoil onto you. Lifts only when this foe dies.';
      case 'sunder': return 'Seals ' + (n || 2) + ' of your glyph sockets for the turn.';
      case 'debuff': return 'Afflicts you with ' + (it.stat || 'a debuff') + ' ' + n + '.';
      case 'buff': return 'Empowers itself with +' + n + ' Strength.';
      case 'siphon': return 'Siphons your ' + (it.stat || 'stats') + ', stealing it for itself.';
      case 'regen': return 'Regenerates ' + n + ' HP.';
      case 'rally': return 'Rallies its allies, granting +' + n + ' Strength.';
      case 'summon': return 'Summons reinforcements into the fight.';
      case 'birthBrood': return it.who === 'skeleton' ? 'Pipes Skeletons into the fray; won\'t summon more until they fall.' : 'Tears Wormlings from itself, losing HP that never returns.';
      case 'dirge': return 'Drums every living Skeleton\'s strike multiplier up by 1.';
      case 'warcry': return 'War Drum: gains Strength and Resilience, and the next Rally beats louder.';
      case 'frustration': return 'Stews — every 10 damage you deal it this turn jams a Rubble into your hand.';
      case 'gorge': return 'Attacks once per junk glyph left in your hand when it resolves.';
      case 'quarry': return 'Marks you with Quarry. At its threshold he unleashes Soul Reap.';
      case 'soulReap': return 'Strikes 5 once per Quarry stack, then resets your Quarry to zero.';
      case 'doom': return 'The Doom Clock struck zero — 999 unconditional damage.';
      case 'clog': return 'Jams a 2-socket Dead Weight into your hand (10 damage if you let it discard).';
      case 'trash': return 'Buries useless Rubble in your hand to choke your draws.';
      case 'thinking': return 'Gathers itself — no action this turn (often a wind-up).';
      case 'thornsAll': return 'Grants Thorns to itself and allies for the rest of combat.';
      case 'blockAll': return 'Raises Block on itself and every ally.';
      case 'buffStat': return 'Grants +' + (n || 1) + ' ' + (it.stat === 'resilience' ? 'Resilience' : 'Strength') + (it.scope === 'self' ? ' to itself' : ' to itself and allies') + ' for the rest of combat.';
      case 'banish': return 'Banishes a socket shut while it lives — kill it to reopen.';
      case 'scare': return 'Scares you: each enemy hit deals +' + (n || 2) + ' for a couple of turns.';
      case 'sap': return 'Latches on, bleeding you ' + (n || 4) + ' HP at the start of each of your turns while it lives.';
      case 'mature': return 'Grows stronger — its Sap and bite worsen for the rest of combat.';
      case 'hex': return 'Hexes you: while it lives, your combo bonus recoils onto you as damage.';
      default: return '';
    }
  }
  function feastTip(b) {
    const next = 'In the next encounter, ';
    switch (b && b.t) {
      case 'str': return next + 'begin with +' + b.n + ' Strength.';
      case 'res': return next + 'begin with +' + b.n + ' Resilience.';
      case 'thorn': return next + 'begin with +' + b.n + ' Thorns.';
      case 'guard': return next + 'gain ' + b.n + ' Block at the start of every turn.';
      case 'rampstr': return next + 'gain +' + b.n + ' Strength every turn.';
      case 'weaken': return next + 'all foes start Weakened ' + b.n + '.';
      case 'scare': return next + 'all foes start Scared ' + b.n + '.';
      case 'heal': return 'Heals ' + Math.round((b.pct || 0) * 100) + '% of your max HP when feasted.';
      case 'souls': return 'Grants ' + b.n + ' Souls when feasted.';
      case 'purge': return next + 'purge a debuff from yourself.';
      case 'cleanse': return next + 'cleanse all debuffs from yourself.';
      default: return 'A hidden boon, granted when you feast this foe.';
    }
  }
  // each chip carries its full label AND a hover explanation
  function enemyIntentChips(def) {
    const out = [];
    (def.intents || []).forEach(entry => {
      if (Array.isArray(entry)) {
        out.push({ label: entry.map(intentLabel).join(' + '), tip: entry.map(intentTip).filter(Boolean).join('  •  ') });
      } else {
        out.push({ label: intentLabel(entry), tip: intentTip(entry) });
      }
    });
    return out;
  }
  function gimmickBadges(def) {
    const b = [];
    if (def.thorns) b.push({ label: 'Thornmail', tip: 'Returns damage to you whenever you strike it.' });
    if (def.ward)   b.push({ label: 'Ward',      tip: 'Shrugs off hits until its ward is broken.' });
    if (def.enrage) b.push({ label: 'Enrage',    tip: 'Gains Strength at the end of every turn — end it fast.' });
    return b;
  }
  function escAttr(s) { return String(s == null ? '' : s).replace(/"/g, '&quot;'); }
  function mbState(def) {
    if (def._synthetic) {
      // soulhunter tracked under its dynamic id
      if (META.bestiary.defeated.soulhunter) return 'defeated';
      if (META.bestiary.seen.soulhunter) return 'seen';
      return 'locked';
    }
    if (META.bestiary.defeated[def.id]) return 'defeated';
    if (META.bestiary.seen[def.id]) return 'seen';
    return 'locked';
  }
  function buildMonsterBook() {
    const body = $('monsterbook-body');
    if (!body) return;
    const roster = monsterBookRoster();
    let defeated = 0;
    roster.forEach(d => { if (mbState(d) === 'defeated') defeated++; });
    const prog = $('mb-progress');
    if (prog) prog.textContent = defeated + ' / ' + roster.length + ' slain';
    body.innerHTML = '<div class="mb-grid">' + roster.map(mbCard).join('') + '</div>';
    body.querySelectorAll('.mb-card').forEach(card => {
      if (card.classList.contains('mb-locked')) return;
      card.addEventListener('click', () => {
        SFX.click();
        const def = roster.find(d => d.id === card.dataset.id);
        if (def) openLwModal(mbDetailHTML(def), '#c98a5a', 'book');
      });
    });
  }
  function mbCard(def) {
    const st = mbState(def);
    if (st === 'locked') {
      return '<div class="mb-card mb-locked"><div class="mb-port"><span class="mb-silhouette">?</span></div>' +
        '<div class="mb-name">???</div></div>';
    }
    const portrait = def.img
      ? '<img class="mb-port-img" src="' + def.img + '" alt="" draggable="false">'
      : '<span class="mb-port-emoji">' + (def.emoji || '✦') + '</span>';
    const tier = '<span class="mb-tier mb-tier-' + enemyTierLabel(def).toLowerCase() + '">' + enemyTierLabel(def) + '</span>';
    const sub = (st === 'seen') ? '<div class="mb-sub">??? HP</div>' : '<div class="mb-sub">' + (def.maxHp ? def.maxHp + ' HP' : '???') + '</div>';
    return '<div class="mb-card mb-' + st + '" data-id="' + def.id + '">' +
      tier +
      '<div class="mb-port">' + portrait + '</div>' +
      '<div class="mb-name">' + def.name + '</div>' +
      sub +
    '</div>';
  }
  // Same lavish evolution-card frame, repurposed as a bestiary entry: big
  // portrait, tier+HP banner, lore, then intel blocks for intents & feast boons.
  function mbDetailHTML(def) {
    const st = mbState(def);
    const tier = enemyTierLabel(def);
    const acc = (st === 'seen') ? '#9a8cff' : (MB_TIER_ACCENT[tier.toLowerCase()] || '#c98a5a');
    const hp = (st === 'seen') ? '??? HP' : (def.maxHp ? def.maxHp + ' HP' : 'Unknown');
    const portrait = def.img
      ? '<img class="evo-card-img" src="' + def.img + '" alt="" draggable="false">'
      : '<span class="evo-card-emoji">' + (def.emoji || '✦') + '</span>';
    const head =
      '<div class="evo-card-tag">' + tier + ' · ' + hp + '</div>' +
      '<div class="evo-card-port' + (st === 'seen' ? ' lwc-port-seen' : '') + '">' + portrait +
        '<span class="evo-card-glow"></span></div>' +
      '<div class="evo-card-name">' + def.name + '</div>';
    if (st === 'seen') {
      return '<div class="lw-card evo-card lw-card-book" style="--acc:' + acc + '">' + head +
        '<div class="lwc-quote">You crossed its path but never felled it. Slay it to record its secrets in blood.</div>' +
        '<div class="evo-card-passive"><span class="ecp-name">Intents</span><span class="lwc-redact">??? ?? ????</span></div>' +
        '<div class="evo-card-passive"><span class="ecp-name">Hidden Feast Boons</span><span class="lwc-redact">???? ???</span></div>' +
      '</div>';
    }
    // defeated — full reveal
    const intents = enemyIntentChips(def);
    const gimmicks = gimmickBadges(def);
    const boons = (def._synthetic ? DATA.feastPoolFor({ id: 'soulhunter' }) : DATA.feastPoolFor(def));
    const tipHTML = (label, body) => escAttr('<b>' + label + '</b><br>' + body);
    const intentChip = i => '<span class="lwc-chip" data-cat="Intent" data-tip="' + tipHTML(i.label, i.tip) + '">' + i.label + '</span>';
    const gimChip    = g => '<span class="evo-card-socket" data-cat="Trait" data-tip="' + tipHTML(g.label, g.tip) + '">' + g.label + '</span>';
    const boonChip   = b => '<span class="lwc-chip lwc-chip-boon" data-cat="Feast Boon" data-tip="' + tipHTML(DATA.feastLabel(b), feastTip(b)) + '">' + DATA.feastLabel(b) + '</span>';
    return '<div class="lw-card evo-card lw-card-book" style="--acc:' + acc + '">' + head +
      (def.desc ? '<div class="lwc-quote">' + def.desc + '</div>' : '') +
      (gimmicks.length ? '<div class="evo-card-stats">' + gimmicks.map(gimChip).join('') + '</div>' : '') +
      (intents.length ? '<div class="evo-card-passive"><span class="ecp-name">Intents</span><div class="lwc-chips">' + intents.map(intentChip).join('') + '</div></div>' : '') +
      '<div class="evo-card-passive"><span class="ecp-name">Hidden Feast Boons</span><div class="lwc-chips">' +
        (boons.length ? boons.map(boonChip).join('') : '<span class="gm-empty">None to sap</span>') +
      '</div></div>' +
    '</div>';
  }

  // ============================================================
  // SAVE / CONTINUE  (single-slot checkpoint, written on the map)
  // ============================================================
  const SAVE_KEY = 'cg_save_v1';
  function saveGame() {
    if (!State) return;
    bankRunTime();   // checkpoint active run-time before persisting
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, state: State })); }
    catch (e) { /* storage may be unavailable (private mode / quota) */ }
  }
  function hasSave() {
    try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
  }
  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  }
  // Re-point a saved monster's portrait at its latest reached evolution form's art.
  // A run that evolved BEFORE a form's PNG existed stored the base portrait; once the
  // art lands, this picks it up on load (probed, so a still-missing file is ignored).
  function reconcileMonsterArt(m) {
    if (!m || !Array.isArray(m.evoChoices) || !m.evoChoices.length) return;
    const tree = MONSTERS[m.id] && MONSTERS[m.id].evolution;
    if (!tree) return;
    const choices = m.evoChoices, last = choices.length - 1;
    const pool = last === 0 ? (tree.tier1 || []) : ((tree.tier2 && tree.tier2[choices[0]]) || []);
    const form = pool.find(f => f && f.id === choices[last]);
    if (!form || !form.img || m.img === form.img) return;
    const probe = new Image();
    probe.onload = () => { m.img = form.img; m.evoFormImg = form.img; updateRunUI(); };
    probe.src = form.img;
  }

  function loadGame() {
    let raw = null;
    try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { raw = null; }
    if (!raw) return false;
    try {
      const data = JSON.parse(raw);
      if (!data || !data.state || !data.state.monsters) return false;
      State = data.state;
      (State.monsters || []).forEach(reconcileMonsterArt);
      if (!Array.isArray(State.items)) State.items = [];   // back-compat for pre-items saves
      if (!State.act) State.act = 1;                       // back-compat for pre-multi-floor saves
      if (!State.bossId) State.bossId = pickFloorBoss(State.act);
      if (State.soulstones == null) State.soulstones = 0;  // back-compat for pre-soulstone saves
      if (State.soulhunterKills == null) State.soulhunterKills = 0;
      if (!State.unlocks) State.unlocks = {};
      State.stats = Object.assign(freshRunStats(), State.stats || {});  // back-compat for pre-stats saves
      if (!State.startedAt) State.startedAt = Date.now();
      if (State.playMs == null) State.playMs = 0;
      State.runClock = Date.now();   // resume the run-clock now; offline time isn't counted
      root.CG.State = State;
      renderMap();
      show('screen-map');
      return true;
    } catch (e) { clearSave(); return false; }
  }
  function refreshContinueBtn() {
    const b = $('btn-continue');
    if (b) b.disabled = !hasSave();
  }

  // ---- a small reusable confirm dialog ----
  let confirmCb = null;
  function confirmDialog(opts) {
    opts = opts || {};
    $('confirm-title').textContent = opts.title || 'Are you sure?';
    $('confirm-text').innerHTML = opts.text || '';
    $('btn-confirm-ok').textContent = opts.okLabel || 'Confirm';
    $('btn-confirm-cancel').textContent = opts.cancelLabel || 'Cancel';
    $('btn-confirm-ok').classList.toggle('opt-exit-danger', !!opts.danger);
    confirmCb = opts.onConfirm || null;
    $('confirm-modal').classList.remove('hidden');
  }
  function closeConfirm() { $('confirm-modal').classList.add('hidden'); confirmCb = null; }
  function wireConfirm() {
    $('btn-confirm-cancel').addEventListener('click', () => { SFX.click(); closeConfirm(); });
    $('btn-confirm-ok').addEventListener('click', () => {
      SFX.click();
      const cb = confirmCb; closeConfirm();
      if (cb) cb();
    });
    $('confirm-modal').addEventListener('click', (e) => { if (e.target && e.target.id === 'confirm-modal') closeConfirm(); });
  }

  // ============================================================
  // OPTIONS  (audio settings, persisted)
  // ============================================================
  const SETTINGS_KEY = 'cg_settings_v1';
  let settings = { master: 1.0, music: 0.42, sfx: 0.9, muted: false };
  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && typeof s === 'object') {
          if (typeof s.master === 'number') settings.master = s.master;
          if (typeof s.music === 'number') settings.music = s.music;
          if (typeof s.sfx === 'number') settings.sfx = s.sfx;
          if (typeof s.muted === 'boolean') settings.muted = s.muted;
        }
      }
    } catch (e) { /* defaults */ }
    applySettingsToAudio();
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }
  function applySettingsToAudio() {
    const A = root.CG.Audio;
    if (!A) return;
    if (A.setMasterVolume) A.setMasterVolume(settings.master);
    if (A.setMusicVolume) A.setMusicVolume(settings.music);
    if (A.setSfxVolume) A.setSfxVolume(settings.sfx);
    if (A.mute) A.mute(settings.muted);
  }
  function paintSlider(el) {
    if (!el) return;
    const p = Math.max(0, Math.min(100, Number(el.value)));
    el.style.background = 'linear-gradient(90deg, var(--gold) 0%, var(--gold) ' + p +
      '%, rgba(255,255,255,0.12) ' + p + '%)';
  }
  function syncOptionsUI() {
    const pct = v => Math.round(v * 100) + '%';
    const mas = $('opt-master'), mus = $('opt-music'), sfx = $('opt-sfx'), mute = $('opt-mute');
    if (mas) { mas.value = Math.round(settings.master * 100); $('opt-master-val').textContent = pct(settings.master); paintSlider(mas); }
    if (mus) { mus.value = Math.round(settings.music * 100); $('opt-music-val').textContent = pct(settings.music); paintSlider(mus); }
    if (sfx) { sfx.value = Math.round(settings.sfx * 100); $('opt-sfx-val').textContent = pct(settings.sfx); paintSlider(sfx); }
    if (mute) { mute.classList.toggle('on', settings.muted); mute.setAttribute('aria-checked', settings.muted ? 'true' : 'false'); }
    [mas, mus, sfx].forEach(el => { if (el) el.classList.toggle('opt-disabled', settings.muted); });
  }
  function openOptions() {
    syncOptionsUI();
    // "Exit to Menu" is pointless when we're already on the home menu
    const onHome = $('screen-home').classList.contains('is-active');
    $('btn-exit-menu').classList.toggle('hidden', onHome);
    $('options-modal').classList.remove('hidden');
  }
  function closeOptions() {
    $('options-modal').classList.add('hidden');
  }
  function wireOptions() {
    const mas = $('opt-master'), mus = $('opt-music'), sfx = $('opt-sfx'), mute = $('opt-mute');
    if (mas) mas.addEventListener('input', () => {
      settings.master = mas.value / 100;
      $('opt-master-val').textContent = mas.value + '%';
      paintSlider(mas);
      if (root.CG.Audio) root.CG.Audio.setMasterVolume(settings.master);
      saveSettings();
    });
    if (mas) mas.addEventListener('change', () => SFX.click());   // audition on release
    if (mus) mus.addEventListener('input', () => {
      settings.music = mus.value / 100;
      $('opt-music-val').textContent = mus.value + '%';
      paintSlider(mus);
      if (root.CG.Audio) root.CG.Audio.setMusicVolume(settings.music);
      saveSettings();
    });
    if (sfx) sfx.addEventListener('input', () => {
      settings.sfx = sfx.value / 100;
      $('opt-sfx-val').textContent = sfx.value + '%';
      paintSlider(sfx);
      if (root.CG.Audio) root.CG.Audio.setSfxVolume(settings.sfx);
      saveSettings();
    });
    if (sfx) sfx.addEventListener('change', () => SFX.click());   // audition on release
    if (mute) mute.addEventListener('click', () => {
      settings.muted = !settings.muted;
      if (root.CG.Audio) root.CG.Audio.mute(settings.muted);
      if (!settings.muted) SFX.click();
      saveSettings();
      syncOptionsUI();
    });
    $('btn-options-close').addEventListener('click', () => { SFX.click(); closeOptions(); });
    $('options-modal').addEventListener('click', (e) => { if (e.target && e.target.id === 'options-modal') closeOptions(); });
    $('btn-options-gear').addEventListener('click', () => { SFX.click(); openOptions(); });
    $('btn-exit-menu').addEventListener('click', () => {
      SFX.click();
      closeOptions();
      // the run stays saved at its last map checkpoint, so Continue can resume it
      $('screen-collection').classList.remove('is-active');
      refreshContinueBtn();
      show('screen-home');
    });
    $('btn-exit-game').addEventListener('click', () => {
      SFX.click();
      try { window.close(); } catch (e) { /* ignore in a normal browser tab */ }
    });
    $('btn-erase-save').addEventListener('click', () => {
      SFX.click();
      confirmDialog({
        title: 'Erase ALL save data?',
        text: 'This permanently wipes <b>everything</b> — your current run, every wishing stone and unlock, Descension progress, lifetime stats, the bestiary, and run history. <b>This cannot be undone.</b>',
        okLabel: 'Erase Everything',
        cancelLabel: 'Keep My Data',
        danger: true,
        onConfirm: eraseAllSaveData
      });
    });
  }
  // wipe every persisted key (all use the cg_ prefix) and hard-reload to a fully
  // clean slate. Guarded so a locked-down localStorage can't throw mid-wipe.
  function eraseAllSaveData() {
    try {
      const doomed = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf('cg_') === 0) doomed.push(k);
      }
      doomed.forEach(k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });
    } catch (e) { /* ignore */ }
    try { location.reload(); } catch (e) { try { location.href = location.href; } catch (e2) { /* ignore */ } }
  }

  // ============================================================
  // BLESSING DETAIL MODAL — click any blessing to see it big
  // ============================================================
  function blessTier(id) {
    if (POWER_BLESSINGS[id]) return 'Powerful Blessing';
    if (SOUL_BLESSINGS[id]) return 'Soul Blessing';
    if (EVENT_BLESSINGS[id]) return 'Relic Blessing';
    return 'Blessing';
  }
  function showBlessingModal(id) {
    const all = Object.assign({}, BLESSINGS, POWER_BLESSINGS, SOUL_BLESSINGS, EVENT_BLESSINGS);
    const bl = all[id];
    const modal = $('bless-modal');
    if (!bl || !modal) return;
    const art = $('bm-art');
    art.className = 'bm-art' + (blessHasImg(bl) ? ' has-img' : '');
    art.innerHTML = blessArtHTML(bl, 'bm-art-img');
    $('bm-tier').textContent = blessTier(id);
    $('bm-name').textContent = bl.name;
    $('bm-desc').innerHTML = bl.desc;
    modal.classList.remove('hidden');
    SFX.click();
  }
  function hideBlessingModal() {
    const modal = $('bless-modal');
    if (modal && !modal.classList.contains('hidden')) { modal.classList.add('hidden'); SFX.click(); }
  }
  function wireBlessModal() {
    const close = $('btn-bless-close');
    if (close) close.addEventListener('click', hideBlessingModal);
    const modal = $('bless-modal');
    if (modal) modal.addEventListener('click', (e) => { if (e.target && e.target.id === 'bless-modal') hideBlessingModal(); });
    // any blessing tagged with data-bless opens the detail view on click
    document.addEventListener('click', (e) => {
      const t = e.target.closest && e.target.closest('[data-bless]');
      if (t) showBlessingModal(t.getAttribute('data-bless'));
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideBlessingModal(); });
  }

  // ============================================================
  // SECRET DEBUG UNLOCK — debug button is hidden until the player taps
  // the main-menu logo 5 times within 3 seconds (persists once unlocked)
  // ============================================================
  const DEBUG_KEY = 'cg_debug_v1';
  function revealDebug() {
    const btn = $('btn-debug');
    if (btn) btn.classList.remove('hidden');
  }
  function wireDebugUnlock() {
    // already unlocked on a previous session? show it right away
    try { if (localStorage.getItem(DEBUG_KEY)) revealDebug(); } catch (e) { /* ignore */ }
    const logo = document.querySelector('#screen-home .home-logo');
    if (!logo) return;
    let taps = [];
    const onTap = (e) => {
      if (e) { e.preventDefault(); }
      const now = Date.now();
      taps.push(now);
      taps = taps.filter(t => now - t <= 3000);   // keep only the last 3 seconds
      if (taps.length >= 5) {
        taps = [];
        revealDebug();
        try { localStorage.setItem(DEBUG_KEY, '1'); } catch (err) { /* ignore */ }
        SFX.reward && SFX.reward();
      }
    };
    logo.style.cursor = 'pointer';
    logo.addEventListener('click', onTap);
  }

  // ============================================================
  // WIRING
  // ============================================================
  function init() {
    buildStart();
    loadSettings();
    loadMeta();
    startPlayClock();
    wireOptions();
    wireConfirm();
    wireBlessModal();
    refreshContinueBtn();

    // ---- Home / main menu ----
    const beginNewGame = () => {
      buildModeSelect();
      show('screen-mode');
    };
    $('mode-classic').addEventListener('click', () => { SFX.click(); chooseMode('classic'); });
    $('mode-descension').addEventListener('click', () => { SFX.click(); chooseMode('descension'); });
    $('btn-mode-back').addEventListener('click', () => { SFX.click(); show('screen-home'); });
    $('btn-new-game').addEventListener('click', () => {
      root.CG.Audio.resume();
      goFullscreenOnMobile();
      SFX.click();
      if (hasSave()) {
        confirmDialog({
          title: 'Overwrite your run?',
          text: 'You have a run in progress. Starting a <b>New Game</b> will <b>erase it</b> — this can\'t be undone. Use <b>Continue</b> to resume instead.',
          okLabel: 'Start New Game', cancelLabel: 'Keep My Run', danger: true,
          onConfirm: () => { clearSave(); refreshContinueBtn(); beginNewGame(); }
        });
      } else {
        beginNewGame();
      }
    });
    $('btn-continue').addEventListener('click', () => {
      if (!hasSave()) return;
      root.CG.Audio.resume();
      goFullscreenOnMobile();
      SFX.click();
      loadGame();
    });
    $('btn-lost-woods').addEventListener('click', () => {
      root.CG.Audio.resume(); SFX.click();
      buildLostWoods(); show('screen-lostwoods');
    });
    $('btn-lostwoods-back').addEventListener('click', () => { SFX.click(); show('screen-home'); });
    document.querySelectorAll('.lw-sub-back').forEach(b => {
      b.addEventListener('click', () => { SFX.click(); show('screen-lostwoods'); });
    });
    // Glyph Codex: opens from the Star Charts for the currently-focused hero,
    // and its Back returns to the charts (not all the way out to the woods).
    const codexBtn = $('btn-glyph-codex');
    if (codexBtn) codexBtn.addEventListener('click', () => {
      SFX.click();
      buildGlyphCodex(stSelectedBeast || (Object.values(MONSTERS)[0] || {}).id);
      show('screen-glyphcodex');
    });
    document.querySelectorAll('.gc-back').forEach(b => {
      b.addEventListener('click', () => { SFX.click(); show('screen-stonetable'); });
    });
    $('btn-lw-modal-close').addEventListener('click', () => { SFX.click(); closeLwModal(); });
    $('lw-modal').addEventListener('click', (e) => { if (e.target.id === 'lw-modal') closeLwModal(); });
    $('btn-options').addEventListener('click', () => { root.CG.Audio.resume(); SFX.click(); openOptions(); });
    $('btn-exit').addEventListener('click', () => {
      SFX.click();
      // works in packaged/standalone builds; harmless no-op in a normal browser tab
      try { window.close(); } catch (e) { /* ignore */ }
    });
    $('btn-start-back').addEventListener('click', () => { SFX.click(); buildModeSelect(); show('screen-mode'); });

    // ---- secret debug unlock: tap the menu logo 5x within 3s ----
    wireDebugUnlock();

    // turn bestiary pages with ← / → while on the beast-select screen
    document.addEventListener('keydown', (e) => {
      const scr = $('screen-start');
      if (!scr || !scr.classList.contains('is-active')) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); flipBeast(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); flipBeast(1); }
    });

    // touch: swipe across the open hero card to turn pages on mobile. We track a
    // single touch and only fire when the gesture is clearly horizontal, so it
    // never hijacks a vertical scroll.
    const pager = document.querySelector('.beast-pager');
    if (pager) {
      let sx = 0, sy = 0, swiping = false;
      pager.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) { swiping = false; return; }
        sx = e.touches[0].clientX; sy = e.touches[0].clientY; swiping = true;
      }, { passive: true });
      pager.addEventListener('touchend', (e) => {
        if (!swiping) return;
        swiping = false;
        const t = e.changedTouches[0];
        const dx = t.clientX - sx, dy = t.clientY - sy;
        if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) {
          flipBeast(dx < 0 ? 1 : -1);
        }
      }, { passive: true });
    }

    $('btn-begin').addEventListener('click', () => {
      if (!pendingMonsterPick) return;
      root.CG.Audio.resume();
      goFullscreenOnMobile();   // the click is a user gesture, so this is allowed
      SFX.click();
      startRun(pendingMonsterPick, { mode: pendingMode, descension: pendingDescensionLevel });
    });

    $('btn-skip-reward').addEventListener('click', () => { SFX.click(); finishReward(); });
    $('btn-leave-rest').addEventListener('click', () => { SFX.click(); finishReward(); });
    $('btn-leave-soulstone').addEventListener('click', () => { SFX.click(); finishReward(); });
    $('btn-leave-shop').addEventListener('click', () => { SFX.click(); renderMap(); show('screen-map'); });

    $('btn-collection').addEventListener('click', () => {
      SFX.click();
      const cur = document.querySelector('.screen.is-active');
      collectionReturn = (cur && cur.id && cur.id !== 'screen-collection') ? cur.id : 'screen-map';
      buildCollection();
      show('screen-collection');
    });
    $('btn-close-collection').addEventListener('click', () => {
      SFX.click();
      const back = collectionReturn || 'screen-map';
      if (back === 'screen-map') renderMap();
      show(back);
    });

    $('btn-upgrade-cancel').addEventListener('click', () => { SFX.click(); closeUpgradeModal(); });
    $('btn-forge-back').addEventListener('click', () => { SFX.click(); upgradeIndex = -1; showUpgradeView('gallery'); });

    $('btn-socket-continue').addEventListener('click', () => { SFX.click(); hideSocketModal(); });
    $('socket-modal').addEventListener('click', (e) => { if (e.target && e.target.id === 'socket-modal') hideSocketModal(); });
    $('btn-soulstone-continue').addEventListener('click', () => { SFX.click(); hideSoulstoneModal(); });
    $('soulstone-modal').addEventListener('click', (e) => { if (e.target && e.target.id === 'soulstone-modal') hideSoulstoneModal(); });

    $('btn-reveal-claim').addEventListener('click', () => claimRevealScene());

    $('btn-restart').addEventListener('click', () => {
      SFX.click(); refreshContinueBtn(); show('screen-home');
    });

    // any first interaction unlocks audio. We listen on several gesture types so
    // that even a hover (mousemove) counts in a browser build — otherwise the
    // very first hover sound is silent until the player clicks something. The
    // packaged Steam build disables the autoplay gate entirely, but this keeps
    // web/dev playtests seamless.
    let audioUnlocked = false;
    const unlockAudio = () => {
      if (audioUnlocked) return;
      audioUnlocked = true;
      root.CG.Audio.resume();
      ['pointerdown', 'mousedown', 'mousemove', 'keydown', 'touchstart'].forEach(ev =>
        document.removeEventListener(ev, unlockAudio));
    };
    ['pointerdown', 'mousedown', 'mousemove', 'keydown', 'touchstart'].forEach(ev =>
      document.addEventListener(ev, unlockAudio, { passive: true }));
  }

  root.CG = root.CG || {};
  // ============================================================
  // DEBUG HOOKS — called from the battle.js debug menu
  // ============================================================
  function debugGold() {
    if (!State) return;
    State.souls = 9999;
    setSoulCounters(State.souls);
    updateTopbar();
  }
  function debugToggleAnyNode() {
    dbgAnyNode = !dbgAnyNode;
    const onMap = $('screen-map') && $('screen-map').classList.contains('is-active');
    if (onMap) renderMap();
    return dbgAnyNode;
  }
  // A "secret shop": every hero/neutral glyph, every blessing, every item — all free.
  function buildSecretShop() {
    if (!State) return;
    const am = activeMonster();
    const grid = $('shop-grid');
    grid.innerHTML = '';
    const head = document.querySelector('#screen-shop .reward-head');
    const sub = document.querySelector('#screen-shop .reward-sub');
    if (head) head.textContent = 'Secret Shop';
    if (sub) sub.textContent = 'Everything is free, forger. Take what you need.';

    // every glyph the chosen hero can wield — their own, neutral, AND the
    // colorless Soul-glyphs, INCLUDING still-locked ones (this is the debug
    // "take anything" shop). Repeatable, so you can stack copies into a deck.
    Object.values(GLYPHS)
      .filter(g => !g.junk && !g.token && (!g.character || g.character === am.id))
      .forEach(g => {
      grid.appendChild(shopCard({
        kind: 'Glyph', name: g.name, color: 'var(--' + g.color + ')',
        art: '<div class="sc-art">' + glyphArtHTML(g) + '</div>', chip: letterChipHTML(g),
        desc: DATA.formatDesc(g, metaEnv(g.id)), price: 0, repeat: true,
        onBuy: () => { State.pool.push(g.id); }
      }));
    });

    // every blessing (basic + power + soul + event)
    const allBless = Object.values(BLESSINGS)
      .concat(Object.values(POWER_BLESSINGS), Object.values(SOUL_BLESSINGS), Object.values(EVENT_BLESSINGS));
    const seenBless = {};
    allBless.forEach(b => {
      if (!b || seenBless[b.id]) return; seenBless[b.id] = 1;
      grid.appendChild(shopCard({
        kind: 'Blessing', icon: b.icon, name: b.name, color: 'var(--purple)',
        art: '<div class="sc-icon' + (blessHasImg(b) ? ' has-img' : '') + '" style="color:var(--purple)">' + blessArtHTML(b) + '</div>',
        desc: b.desc, price: 0,
        onBuy: () => applyBlessing(b)
      }));
    });

    // every consumable item — stackable, so keep them buyable until they cap
    Object.values(ITEMS).forEach(it => {
      grid.appendChild(shopCard({
        kind: 'Item', icon: it.icon, name: it.name, color: 'var(--gold)',
        art: '<div class="sc-icon' + (it.img ? ' has-img' : '') + '" style="color:var(--gold)">' + itemArtHTML(it) + '</div>',
        desc: it.desc, price: 0, repeat: true,
        canBuy: () => canAddItem(it.id),
        onBuy: () => { addItem(it.id); }
      }));
    });

    // a Soulstone — repeatable, so you can fast-track an evolution (5 = evolve)
    grid.appendChild(shopCard({
      kind: 'Soulstone', icon: '\u25C6', name: 'Soulstone', color: 'var(--blue)',
      art: '<div class="sc-icon has-img" style="color:var(--blue)"><img class="ss-shop-img" src="assets/Soulstone Stone.png" alt="" draggable="false"></div>',
      desc: 'A shard of raw soul. Gather <b>5</b> to evolve <b>' + am.name + '</b>.', price: 0, repeat: true,
      onBuy: () => gainSoulstone()
    }));

    // a couple of always-useful services, also free (repeatable)
    grid.appendChild(shopCard({
      kind: 'Service', icon: '🔥', name: 'Mend Wounds', color: 'var(--red)',
      desc: 'Heal your active beast (' + am.name + ') for 45% of max HP.', price: 0, repeat: true,
      onBuy: () => healActive(0.45)
    }));
    grid.appendChild(shopCard({
      kind: 'Service', icon: '🜨', name: 'Reforge a Slot', color: 'var(--blue)',
      desc: 'Add a random special power to a socket.', price: 0, repeat: true,
      onBuy: () => forgeRandomSlot()
    }));
  }
  function debugSecretShop() {
    if (!State) return;
    buildSecretShop();
    show('screen-shop');
  }
  // grant a pile of wishing stones (for testing the Enchanted Well); refresh the
  // Well screen if it's open so the new balance shows immediately
  function debugWishStones() {
    grantWishingStones(25);
    if ($('screen-well') && $('screen-well').classList.contains('is-active')) buildWell();
    const lw = $('lw-stones'); if (lw) lw.textContent = META.wishingStones || 0;
  }
  // bump the highest-cleared Descension by one (unlocks the next depth), capped
  // at MAX_DESCENSION. Returns the new cleared value for the debug button label.
  function debugDescent() {
    META.descension.cleared = Math.min(MAX_DESCENSION, (META.descension.cleared || 0) + 1);
    META.stats.bestDescension = Math.max(META.stats.bestDescension || 0, META.descension.cleared);
    saveMeta();
    if ($('screen-mode') && $('screen-mode').classList.contains('is-active')) buildModeSelect();
    return META.descension.cleared;
  }

  // ---- Debug: instant-battle picker (map screen of a run only) ----
  function debugBattleAvailable() {
    return !!(State && $('screen-map') && $('screen-map').classList.contains('is-active'));
  }
  // every defined foe, plus the synthetic Soul Hunter, grouped by tier
  function debugEncounterList() {
    const order = { final: 0, boss: 1, floorboss: 2, elite: 3, normal: 4, token: 5 };
    const list = [];
    Object.keys(ENEMIES).forEach(id => {
      const e = ENEMIES[id];
      if (!e || !e.name) return;
      let kind = 'normal';
      if (e.finalFinal) kind = 'final';
      else if (e.boss) kind = 'boss';
      else if (e.floorBoss) kind = 'floorboss';
      else if (e.elite) kind = 'elite';
      else if (e.token) kind = 'token';
      list.push({ id: id, name: e.name, emoji: e.emoji || '👾', img: e.img || '', kind: kind });
    });
    // the recurring shadow rival is built per current form — offer it explicitly
    list.push({ id: '__soulhunter', name: 'Soul Hunter (current form)', emoji: '\u2620\uFE0F', img: 'assets/Soulhunter I.png', kind: 'boss' });
    list.sort((a, b) => (order[a.kind] - order[b.kind]) || a.name.localeCompare(b.name));
    return list;
  }
  function debugStartBattle(id) {
    if (!debugBattleAvailable()) return false;
    let enemies, isBoss = false, shadow = false, music = 'battle';
    if (id === '__soulhunter') {
      enemies = soulhunterFormation();
      isBoss = true; shadow = true; music = 'elite';
    } else {
      const e = ENEMIES[id];
      if (!e) return false;
      enemies = [ e ];
      if (e.boss) {
        enemies = enemies.concat((BOSS_ESCORTS[id] || []).map(x => ENEMIES[x]).filter(Boolean));
        isBoss = true; music = 'boss';
      } else if (e.elite) {
        music = 'elite';
      }
    }
    // a debug fight shouldn't wreck the run — snapshot every beast's HP/alive and
    // restore it once the test battle ends (win OR lose), then bounce to the map
    const snap = (State.monsters || []).map(m => ({ hp: m.hp, alive: m.alive }));
    const restore = () => {
      (State.monsters || []).forEach((m, i) => { if (snap[i]) { m.hp = snap[i].hp; m.alive = snap[i].alive; } });
      State.activeIndex = firstAlive();
      renderMap();
      show('screen-map');
    };
    const node = State.pos || {};
    const depth = ((State.act || 1) - 1) * 10 + (node.floor || 0);
    root.CG.Battle.start({
      enemies: enemies,
      isBoss: isBoss,
      shadow: shadow,
      depth: depth,
      descension: descensionEffects(),
      onWin: restore,
      onLose: restore
    });
    if (root.CG.Audio && root.CG.Audio.Music) root.CG.Audio.Music.to(music);
    return true;
  }
  // build + show the clickable encounter list (or a "go to the map" notice)
  function debugBattlePicker() {
    const host = ($('debug-modal') && $('debug-modal').parentNode) || document.body;
    const overlay = el('div', 'debug-modal debug-battle-modal');
    const close = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
    if (!debugBattleAvailable()) {
      overlay.innerHTML =
        '<div class="debug-panel">' +
          '<h2 class="debug-title">⚔ Pick a Battle</h2>' +
          '<p class="debug-sub">This only works from the <b>map screen</b> of an active run.</p>' +
          '<button class="btn btn-ghost dbe-close">Close</button>' +
        '</div>';
    } else {
      const kindLabel = { final: 'Final', boss: 'Boss', floorboss: 'Floor Boss', elite: 'Elite', normal: 'Normal', token: 'Token' };
      const cards = debugEncounterList().map(enc => {
        const art = enc.img
          ? '<img src="' + enc.img + '" alt="" draggable="false">'
          : '<span class="dbe-emoji">' + enc.emoji + '</span>';
        return '<button class="dbe-card dbe-' + enc.kind + '" data-enc="' + enc.id + '">' +
          '<span class="dbe-art">' + art + '</span>' +
          '<span class="dbe-name">' + enc.name + '</span>' +
          '<span class="dbe-kind">' + (kindLabel[enc.kind] || '') + '</span>' +
        '</button>';
      }).join('');
      overlay.innerHTML =
        '<div class="debug-panel debug-battle-panel">' +
          '<h2 class="debug-title">⚔ Pick a Battle</h2>' +
          '<p class="debug-sub">Drops you straight into the fight. Your party\'s HP is restored afterward.</p>' +
          '<div class="dbe-grid">' + cards + '</div>' +
          '<button class="btn btn-ghost dbe-close">Close</button>' +
        '</div>';
    }
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    const cb = overlay.querySelector('.dbe-close');
    if (cb) cb.addEventListener('click', close);
    overlay.querySelectorAll('[data-enc]').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.dataset.enc;
        close();
        debugStartBattle(id);
      });
    });
    host.appendChild(overlay);
    return true;
  }

  root.CG.Game = {
    init, show, renderMap, gameOver, activeMonster, firstAlive, updateTopbar,
    grantRandomBlessing, consumeRevive, addItem, canAddItem,
    gainSouls, grantRandomGlyph, permEmpowerBase,
    recordBestiarySeen, recordBestiaryDefeated,
    recordKill, recordSingleHit, recordTurnDamage, recordCombo,
    debugGold, debugToggleAnyNode, debugSecretShop, debugWishStones, debugDescent,
    debugBattlePicker,
    get state() { return State; }
  };

})(window);
