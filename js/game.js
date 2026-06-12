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
    if (id) e.cloneEmpower = empowerOf(id);
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

  // ---- Run state (rebuilt each run) ----
  let State = null;
  let pendingMonsterPick = null;
  let pendingVictory = false;    // FINAL boss cleared -> victory after the reward screen
  let pendingNextFloor = false;  // floor boss cleared -> climb to the next act after rewards

  // ---- The Spire is climbed in 3 floors (acts), each barred by its own boss.
  // Floors 1 and 2 roll one of three bosses; floor 3 is always the end-boss.
  const SPIRE_FLOORS = 3;
  const FLOOR_BOSSES = {
    1: ['voidIdol', 'hollowChoir', 'mawMother'],
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
    chaosIncarnate: ['maledict', 'hexweaver']
  };
  function pickFloorBoss(act) {
    const pool = FLOOR_BOSSES[act] || FLOOR_BOSSES[1];
    return pool[Math.floor(Math.random() * pool.length)];
  }
  function currentBoss() {
    return (State && State.bossId && ENEMIES[State.bossId]) || ENEMIES.voidIdol;
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
    'screen-evolve': 'node'
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
    // the small options gear rides along on every screen except the main menu
    const gear = $('btn-options-gear');
    if (gear) gear.classList.toggle('hidden', screenId === 'screen-home');
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

    // tab states + the open page is the live choice
    const tabs = $('beast-tabs');
    if (tabs) Array.from(tabs.children).forEach((t, i) => t.classList.toggle('active', i === beastIdx));
    pendingMonsterPick = m.id;
    const begin = $('btn-begin');
    begin.disabled = false;
    begin.classList.add('armed');
    begin.innerHTML = 'Descend with <b>' + m.name + '</b>';
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

  function startRun(monsterId) {
    pendingVictory = false;
    pendingNextFloor = false;
    State = {
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
      map: genMap(),
      pos: { floor: -1, idx: null },   // -1 = before the first floor
      cleared: 0,
      items: ['blood_phial'],    // carried consumables (top-HUD tray); start with one
      lastEvent: null,           // avoid repeating the same event back-to-back
      soulstones: 0,             // collected at Soulstone nodes; 5 evolves the beast
      soulhunterKills: 0,        // Soulhunter forms cleared this run (0 → next is A, etc.)
      feastKills: [],            // Ghoul Feast: foes slain this run (for Skinwalker trophies)
      feastBoons: [],            // Ghoul Feast: kill-boons waiting to manifest next encounter
      unlocks: {}                // earned meta-unlocks (e.g. colorless glyphs)
    };
    root.CG.State = State;
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
    placeOn(PREBOSS, 'rest');           // breather right before the boss

    // --- Soulhunter: the shadow elite, exactly one per floor (act) ---
    placeInRange(2, LAST - 2, 'shadow', { freshFloor: true });

    // --- Elites: 3-5 distinct rows, anywhere ---
    const eliteRows = 3 + Math.floor(Math.random() * 3);   // 3,4,5
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

    // --- A second rest, allowed in the middle region only ---
    if (Math.random() < 0.75) placeInRange(5, 9, 'rest', { noAdjacent: true });

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
    if (title) title.textContent = 'The Spire of Chaos — Floor ' + (State.act || 1);
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
      n.innerHTML = flames + `<span>${NODE_ICON[node.type]}</span><span class="node-label">${nodeLabel(node)}</span>`;
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
      const lead = f >= 4 ? rng([ E.warchanter, E.clogfiend, E.bonepiper ])
                 : f >= 2 ? rng([ E.bonepiper, E.gloommaw ])
                          : E.gloommaw;
      // Gloommaw (floor boss) hits plenty hard on its own — keep its escort lighter.
      if (lead === E.gloommaw) return [ lead, rng([ E.cinderling, E.thornback ]) ];
      // other elites get a depth-scaled escort; nastier support shows up deeper in
      const escort = f >= 3 ? rng([ E.thornback, E.maledict, E.sapfiend, E.gravewarden ])
                   : f >= 1 ? rng([ E.thornback, E.hexweaver, E.cinderling ])
                            : rng([ E.cinderling, E.thornback ]);
      return [ lead, escort ];
    }

    // ---- normal battles: pick a hand-designed group available at this depth ----
    // (gimmicks now ride on existing foes: Thornback=Thorns, Gravewarden=Ward,
    //  Maledict=Siphon; new gimmick enemies are saved for future floors.)
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
    const FORMS = {
      A: { hp: 124, enrage: 0, intents: [
        { type: 'attack', value: 12 },
        [ { type: 'debuff', stat: 'weak', value: 2 }, { type: 'attack', value: 8 } ],
        { type: 'attack', value: 9, hits: 2 },
        { type: 'attack', value: 24, big: true }
      ] },
      B: { hp: 210, enrage: 2, intents: [
        [ { type: 'curse', value: 2 }, { type: 'attack', value: 12 } ],
        { type: 'attack', value: 12, hits: 2 },
        [ { type: 'sunder', value: 2 }, { type: 'debuff', stat: 'frail', value: 2 } ],
        { type: 'attack', value: 15, hits: 2 },
        { type: 'attack', value: 36, big: true },
        { type: 'regen', value: 18 }
      ] },
      C: { hp: 340, enrage: 3, intents: [
        [ { type: 'curse', value: 3 }, { type: 'sunder', value: 2 } ],
        { type: 'attack', value: 13, hits: 3 },
        [ { type: 'siphon', stat: 'strength', value: 2 }, { type: 'debuff', stat: 'weak', value: 3 } ],
        [ { type: 'defend', value: 26 }, { type: 'buff', value: 6, turns: 2 } ],
        { type: 'attack', value: 19, hits: 3 },
        { type: 'attack', value: 54, big: true },
        [ { type: 'regen', value: 28 }, { type: 'debuff', stat: 'frail', value: 3 } ]
      ] }
    };
    const spec = FORMS[form];
    const scaleSub = it => {
      const o = Object.assign({}, it);
      if (o.type === 'attack' || o.type === 'defend' || o.type === 'regen') o.value = Math.round(it.value * actMul);
      return o;
    };
    const intents = spec.intents.map(e => Array.isArray(e) ? e.map(scaleSub) : scaleSub(e));
    const def = {
      id: 'soulhunter', name: 'Soulhunter \u2014 Form ' + form, emoji: '\u2620\uFE0F',
      maxHp: Math.round(spec.hp * actMul),
      boss: true, shadow: true, form: form,
      intents: intents
    };
    if (spec.enrage) def.enrage = spec.enrage;
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
      out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    return out;
  }

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
    for (let i = 0; i < 5; i++) pips += '<span class="ss-pip' + (i < have ? ' lit' : '') + '">\u25C6</span>';
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
    }
    updateRunUI();
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
    claims.appendChild(claimCard('\u25C6', 'Soulstone',
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
  function offerGlyphs(n) {
    const pool = eligibleGlyphs().slice();
    const out = [];
    while (out.length < n) {
      if (pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
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
      const it = rng(Object.values(ITEMS));
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

    // --- Soulhunter spoils: the soul blessing for the form you just slew ---
    if (tier === 'shadow') {
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
      const power = Object.values(POWER_BLESSINGS).filter(b => !(b.scope === 'run' && State.blessings[b.id]));
      if (power.length) return rng(power);
      // power pool exhausted (multi-floor runs) — fall back to the standard pool
    }
    const choices = Object.values(BLESSINGS).filter(b => b.scope === 'run' ? !State.blessings[b.id] : true);
    return rng(choices.length ? choices : Object.values(BLESSINGS));
  }

  function applyBlessing(bless) {
    if (bless.scope === 'run') {
      State.blessings[bless.id] = true;
      // Calamitous Soul reshapes every eligible socket the moment it's taken
      if (bless.id === 'calamitous') grantCalamitousUpgrade();
      updateRunUI();
    } else if (bless.effect === 'twinsocket') {
      gainSocket(2);
    } else { // socket
      gainSocket(1);
    }
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
        const idx = parseInt(btn.dataset.idx, 10);
        chooseEvoForm(m, forms[idx], tier);
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
    m.name = form.name;
    m.evoFormImg = form.img || m.evoFormImg || null;   // remembered for when art lands
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

    host.className = 'evo-stage evo-phase-morph';
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
            return '<span class="tb-bless' + (b.img ? ' has-img' : '') + '" data-bless="' + b.id + '">' + blessArtHTML(b) +
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
    if (!canAddItem(id)) return false;
    State.items.push(id);
    renderItems(); saveGame();
    return true;
  }
  function removeFirstItem(id) {
    if (!State || !State.items) return;
    const i = State.items.indexOf(id);
    if (i !== -1) State.items.splice(i, 1);
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
      const pool = Object.values(POWER_BLESSINGS).filter(b => !(b.scope === 'run' && State.blessings[b.id]));
      bless = rng(pool.length ? pool : Object.values(POWER_BLESSINGS));
    } else {
      const pool = Object.values(BLESSINGS).filter(b => b.scope === 'run' ? !State.blessings[b.id] : true);
      bless = rng(pool.length ? pool : Object.values(BLESSINGS));
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
      const chip = el('div', 'item-slot filled rarity-' + (it.rarity || 'common') + (it.img ? ' has-img' : '') + (usableNow ? '' : ' item-locked'));
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
    const inst = ensureInstance(index);   // peel ONE copy out as its own instance
    if (!inst) return;
    if (type === 'combo') State.comboUp[inst] = true;
    else State.empower[inst] = (State.empower[inst] || 0) + 1;   // power, stacks
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
    const comboAvail = !!g.letter && !hasCombo;
    if (upgradeType === 'combo' && !comboAvail) upgradeType = 'power';

    pane.innerHTML =
      '<div class="ud-name">' + g.name + '</div>' +
      '<div class="ud-toggle">' +
        '<button class="ud-tab' + (upgradeType === 'power' ? ' active' : '') + '" data-t="power">⬆ Power Up</button>' +
        '<button class="ud-tab' + (upgradeType === 'combo' ? ' active' : '') + (comboAvail ? '' : ' disabled') + '" data-t="combo">▲▲ Combo Up</button>' +
      '</div>' +
      '<div class="ud-hint"></div>' +
      '<div class="ud-cmp"></div>' +
      '<button class="btn btn-primary ud-forge">⚒ Forge ' + g.name + '</button>';

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
    if (upgradeType === 'power') {
      hint.innerHTML = 'Adds <b>+1</b> to this card\'s effect. Stacks with future forges.';
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
    m.hp = Math.min(m.maxHp, m.hp + Math.ceil(m.maxHp * frac));
    updateTopbar();
    return m.hp - before;
  }
  function gainSocket(n) {
    const m = activeMonster();
    const add = n || 1;
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
    State.blessings[id] = true;
    updateRunUI();
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
      claims.appendChild(claimCard('\u25C6', 'Soulstone',
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
          resolve: () => { grantEventBlessing('blackfeather'); return 'You take the black feather. It sinks into your hide — you feel far harder to break.'; }
        },
        {
          tag: 'Gift', icon: '💪', name: 'Raw Muscle Fiber', color: 'var(--red)',
          desc: 'A permanent <b>+3 Strength</b> at the start of every battle.',
          resolve: () => { grantEventBlessing('rawmuscle'); return 'You swallow the raw fiber. Strength coils hot through your limbs.'; }
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
      const offered = rng(Object.values(ITEMS));
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
    const stages = [0, 1, 2].map(i => {
      const reached = i <= lvl;
      const isNow = i === lvl;
      const name = reached ? stageName(i) : '???';
      const art = reached
        ? (m.img ? '<img class="evo-art-img" src="' + m.img + '" alt="">' : '<span class="evo-art-emoji">' + m.emoji + '</span>')
        : '<span class="evo-art-q">?</span>';
      return '<div class="evo-stage' + (isNow ? ' now' : reached ? ' done' : ' future') + '">' +
        '<div class="evo-orb">' + art + (isNow ? '<span class="evo-now-tag">Current</span>' : '') + '</div>' +
        '<div class="evo-stage-name">' + name + '</div></div>';
    });
    const maxed = lvl >= 2;
    // Soulstones read as a glowing gem + big number, with a full-width row of
    // large soul sockets that fill as they're gathered.
    const gems = [0, 1, 2, 3, 4].map(i =>
      '<span class="soul-pip' + (i < Math.min(5, have) ? ' lit' : '') + '">' +
        '<span class="soul-pip-core"></span></span>').join('');
    const meter = maxed
      ? '<div class="evo-soul maxed">' +
          '<div class="soul-top">' +
            '<div class="soul-gem"><span class="soul-gem-core"></span><span class="soul-gem-spark">✦</span></div>' +
            '<div class="soul-read"><span class="soul-num">MAX</span><span class="soul-lab">Fully evolved</span></div>' +
          '</div>' +
          '<div class="soul-pips">' +
            [0, 1, 2, 3, 4].map(() => '<span class="soul-pip lit"><span class="soul-pip-core"></span></span>').join('') +
          '</div>' +
        '</div>'
      : '<div class="evo-soul">' +
          '<div class="soul-top">' +
            '<div class="soul-gem"><span class="soul-gem-core"></span><span class="soul-gem-spark">✦</span></div>' +
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
    host.innerHTML =
      '<div class="cs-charcard">' +
        '<div class="player-combat cs-player" style="--pc-color:' + pcColor + '">' +
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
  }

  // ============================================================
  // GAME OVER
  // ============================================================
  function gameOver(win) {
    clearSave();   // the run is over either way — no checkpoint to resume
    if (win) { SFX.victory(); } else { SFX.defeat(); }
    $('end-title').textContent = win ? 'Chaos Unmade' : 'Undone';
    $('end-title').style.background = win
      ? 'linear-gradient(180deg,#ffd98a,#57e08f 60%,#4fb6ff)'
      : 'linear-gradient(180deg,#ff7a52,#b07bff)';
    $('end-title').style.webkitBackgroundClip = 'text';
    $('end-title').style.backgroundClip = 'text';
    $('end-sub').textContent = win
      ? 'Three floors climbed, Chaos Incarnate unmade. The Chaos Runes are yours.'
      : 'Your beasts have fallen on floor ' + (State.act || 1) + ' of the Spire. Encounters cleared: ' + State.cleared + '.';
    show('screen-end');
  }

  // ============================================================
  // SAVE / CONTINUE  (single-slot checkpoint, written on the map)
  // ============================================================
  const SAVE_KEY = 'cg_save_v1';
  function saveGame() {
    if (!State) return;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, state: State })); }
    catch (e) { /* storage may be unavailable (private mode / quota) */ }
  }
  function hasSave() {
    try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
  }
  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  }
  function loadGame() {
    let raw = null;
    try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { raw = null; }
    if (!raw) return false;
    try {
      const data = JSON.parse(raw);
      if (!data || !data.state || !data.state.monsters) return false;
      State = data.state;
      if (!Array.isArray(State.items)) State.items = [];   // back-compat for pre-items saves
      if (!State.act) State.act = 1;                       // back-compat for pre-multi-floor saves
      if (!State.bossId) State.bossId = pickFloorBoss(State.act);
      if (State.soulstones == null) State.soulstones = 0;  // back-compat for pre-soulstone saves
      if (State.soulhunterKills == null) State.soulhunterKills = 0;
      if (!State.unlocks) State.unlocks = {};
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
    wireOptions();
    wireConfirm();
    wireBlessModal();
    refreshContinueBtn();

    // ---- Home / main menu ----
    const beginNewGame = () => {
      buildStart();
      show('screen-start');
    };
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
    $('btn-options').addEventListener('click', () => { root.CG.Audio.resume(); SFX.click(); openOptions(); });
    $('btn-exit').addEventListener('click', () => {
      SFX.click();
      // works in packaged/standalone builds; harmless no-op in a normal browser tab
      try { window.close(); } catch (e) { /* ignore */ }
    });
    $('btn-start-back').addEventListener('click', () => { SFX.click(); show('screen-home'); });

    // ---- secret debug unlock: tap the menu logo 5x within 3s ----
    wireDebugUnlock();

    // turn bestiary pages with ← / → while on the beast-select screen
    document.addEventListener('keydown', (e) => {
      const scr = $('screen-start');
      if (!scr || !scr.classList.contains('is-active')) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); flipBeast(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); flipBeast(1); }
    });

    $('btn-begin').addEventListener('click', () => {
      if (!pendingMonsterPick) return;
      root.CG.Audio.resume();
      goFullscreenOnMobile();   // the click is a user gesture, so this is allowed
      SFX.click();
      startRun(pendingMonsterPick);
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

  root.CG.Game = {
    init, show, renderMap, gameOver, activeMonster, firstAlive, updateTopbar,
    grantRandomBlessing, consumeRevive, addItem, canAddItem,
    gainSouls, grantRandomGlyph, permEmpowerBase,
    debugGold, debugToggleAnyNode, debugSecretShop,
    get state() { return State; }
  };

})(window);
