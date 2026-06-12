/* ============================================================
   CHAOS GLYPHS — Combat: "The Glyph Forge"  (the heart)
   Draw a hand, click glyphs into sockets in a chosen order,
   then Detonate to resolve the whole turn as one animated chain.
   Targeting is always rule-based — never by clicking an enemy.
   ============================================================ */
(function (root) {
  'use strict';

  const { GLYPHS } = root.CG.DATA;
  const SFX = root.CG.Audio.SFX;
  const Scale = root.CG.Scale;

  let stage;
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));

  // Cards are individuals: a pool entry may carry an instance suffix
  // ("strike#i7" or a clone's "strike#clone3"). baseOf strips it back to the
  // glyph-definition key so counts, switch cases and effects still match.
  function baseOf(id) { const i = id.indexOf('#'); return i < 0 ? id : id.slice(0, i); }
  // glyph lookup that resolves transient Clone instances, then the base definition
  function glyph(id) { return (B && B.tempGlyphs && B.tempGlyphs[id]) || GLYPHS[baseOf(id)]; }

  // slot-type presentation (label + icon shown on the socket)
  const SLOT_META = {
    normal:   null,
    loopback: { icon: '↻', label: 'Loop', tip: 'Holds no glyph. When the chain reaches it, every glyph already played this turn resolves <b>again</b>, then the chain continues.' },
    repeat:   { icon: '×2', label: 'Repeat', tip: 'The glyph placed here resolves <b>twice</b>.' },
    hold:     { icon: '⏸', label: 'Hold', tip: 'The glyph placed here is <b>not discarded</b> — it returns next turn as a bonus card that doesn\'t reduce your draw.' },
    catalyst: { icon: '✦', label: 'Catalyst', tip: 'Infuses the <b>next</b> glyph by the color placed here — Red: 3 damage to all · Blue: 3 block · Green: heal 6.' },
    devil:    { icon: '<img class="devil-emote" src="assets/Happy Devil.png" alt="">', label: 'Devil', tip: 'Each turn it <b>craves a specific glyph</b> (shown on the socket) and hides a random <b>boon</b>. Play that glyph here to claim the boon — any other glyph just resolves as normal, no harm done. <b>Ignore it 3 turns running</b> and it bites you for <b>1/3 of your max HP</b>, then craves anew. The hungrier it gets, the rarer the boons it offers.' },
    clone:    { icon: '⧉', label: 'Clone', tip: 'Copies the glyph into your <b>next hand</b>, empowered <b>+1</b>. The copy is one-shot.' },
    empower:  { icon: '⊕', label: 'Empower', tip: 'Bolsters the glyphs resolved <b>immediately before and after</b> it by <b>+1</b>.' },
    upgrade:  { icon: '⬆', label: 'Upgrade', tip: 'Every glyph resolved here gains <b>+1 empower</b> for the rest of the battle — and it keeps stacking with each play.' },
    combo:    { icon: '⛓', label: 'Combo', tip: 'The glyph placed here sets your combo to <b>double</b> the running combo so far (a fresh chain starts at <b>2</b>), then the chain keeps climbing from there.' }
  };
  // ---- hybrid sockets ----
  // a socket's slotTypes entry may be a plain string ('normal'/'devil'/'repeat'…)
  // or an ARRAY of up to 3 special types (hybrids — duplicates allowed and they
  // stack; Devil never mixes, so it always stays a plain string).
  function slotTypesOf(v) {
    if (Array.isArray(v)) return v;
    if (!v || v === 'normal') return [];
    return [v];
  }
  function slotList(i) { return slotTypesOf(B.slotTypes && B.slotTypes[i]); }
  function slotCountAt(i, t) {
    let n = 0; const l = slotList(i);
    for (let k = 0; k < l.length; k++) if (l[k] === t) n++;
    return n;
  }
  // pure-Loopback sockets hold no glyph; hybrid Loop sockets still do
  function isPureLoop(i) {
    const l = slotList(i);
    return l.length > 0 && l.every(t => t === 'loopback');
  }
  // compress a type list into [{ t, n }] preserving first-seen order
  function groupSlotTypes(list) {
    const order = [], counts = {};
    list.forEach(t => { if (!counts[t]) { counts[t] = 0; order.push(t); } counts[t]++; });
    return order.map(t => ({ t: t, n: counts[t] }));
  }
  function slotLabel(list) {
    return groupSlotTypes(list).map(g => SLOT_META[g.t].label + (g.n > 1 ? ' ×' + g.n : '')).join(' · ');
  }
  function slotTipHTML(list) {
    return groupSlotTypes(list).map(g =>
      '<b class="st-name">' + SLOT_META[g.t].label + (g.n > 1 ? ' ×' + g.n : '') + ' Socket</b>' + SLOT_META[g.t].tip
    ).join('<br>');
  }

  // ---- live battle state ----
  let B = null;
  let onWinCb = null, onLoseCb = null;

  // ============================================================
  // START
  // ============================================================
  function start(opts) {
    stage = $('stage');
    clearChargeOrb(true);   // no charge hoard carries between separate battles
    onWinCb = opts.onWin; onLoseCb = opts.onLose;
    const G = root.CG.Game;
    const monster = G.state.monsters[G.firstAlive()];
    G.state.activeIndex = G.firstAlive();

    const depth = opts.depth || 0;
    const scaledEnemies = opts.enemies.map(e => scaleEnemyDef(e, depth));

    B = {
      monster: monster,
      depthScale: depth,
      playerShield: 0,
      strength: monster.runStrength || 0,   // seeded by Devil(red) run buffs
      turnStrength: 0,    // temporary strength that only lasts the current turn
      resilience: monster.runResilience || 0,   // boosts your shield gains; seeded by run buffs
      carryShield: 0,     // shield that survives into next turn (Bastion)
      redThisTurn: 0,     // red glyphs played this turn (for Gravetide)
      blueThisTurn: 0,    // blue glyphs played this turn (for Aftershock)
      slotTypes: [],      // per-socket behavior: normal/loopback/repeat/hold/catalyst/devil/clone/upgrade
      combatEmpower: {},  // Upgrade sockets: per-type +empower that lasts the battle (keyed by base id)
      tempGlyphs: {},     // transient glyph instances (Clone copies)
      extras: [],         // bonus cards for next hand (Hold + Clone) — do NOT reduce the draw
      spanHead: [],       // for multi-socket glyphs: continuation slot -> head slot index
      fireOrigins: null,  // stage positions a resolving glyph fires from (multi-socket = many)
      lastTurnPlays: [],  // genuine glyph ids placed last turn (for all-Mirror replay)
      resolveCount: {},   // times a glyph (by base id) resolved this battle (Everflame ramp)
      cloneSeq: 0,        // unique id counter for clones
      enemies: scaledEnemies.map((e, i) => ({
        base: e, id: e.id + '#' + i, name: e.name, emoji: e.emoji, img: e.img,
        maxHp: e.maxHp, hp: e.maxHp, shield: 0,
        weak: 0, burn: 0, leech: 0, scare: 0, scareTurns: 0, empower: 0,
        strength: 0, strengthTurns: 0,
        feastPool: root.CG.DATA.feastPoolFor(e),   // Ghoul Feast: predefined bonuses to sap
        intentIndex: 0, intent: null, alive: true,
        dom: null
      })),
      isBoss: !!opts.isBoss,
      turn: 0,
      sockets: [],
      slotFx: [],         // per-socket { disabled, cursed, caster }
      hand: [],
      draw: [],           // the draw pile (shuffled snapshot of the run deck)
      discard: [],        // cards spent/dropped this battle; reshuffles into draw when empty
      drawnThisTurn: [],  // real deck cards in hand this turn -> routed to discard at end
      stuck: [],          // sticky glyph ids that cling to your hand (Dead Weight)
      injected: [],       // junk forced into your NEXT hand (cleared once drawn)
      playerWeak: 0,      // turns: your damage is reduced
      playerFrail: 0,     // turns: your shield gains are reduced
      playerBurn: 0,      // Burn DoT on you (e.g. a burn glyph played into a cursed slot)
      playerThorns: 0,    // item-granted Thorns: reflect damage to melee attackers this combat
      recallUsed: false,
      comboCarry: 0,       // Lingering Cadence: combo number carried into next turn
      comboNow: 0,         // running combo during the active chain (Smoldering Tails)
      resolving: false,
      socketIntro: true,   // first socket render of the battle plays the "runes appear" reveal
      devil: {},           // per-socket Devil state (craving / boon / ignore), keyed by index
      extraTurn: false,    // Devil "Extra Turn" boon: skip the enemy response once
      dmgTakenBank: 0,     // War Grudge: HP damage accrued toward the next +1 Strength
      charge: { dmg: 0, weak: 0, scare: 0, burn: 0 },   // Big-Hit Charge Attack, assembled each chain
      tickCount: 0,        // genuine enemy hits during the current glyph (Berserk Frenzy)
      feastGuard: 0,       // Feast: Block granted at each turn start (combat)
      feastRamp: 0,        // Feast: Strength granted at each turn start (combat)
      feastCleanse: 0,     // Feast: lift a curse each turn (combat)
      clogImmune: false,   // Feast(Purge): shrug off the next clog
      devilsFedThisTurn: 0,// Demon: Devil boons amplify per Devil sated this turn
      ended: false
    };
    B.slotFx = Array.from({ length: monster.sockets }, () => ({ disabled: 0, cursed: 0, caster: null }));
    B.slotTypes = Array.from({ length: monster.sockets }, (_, i) => (monster.slotTypes && monster.slotTypes[i]) || 'normal');
    B.draw = shuffle(root.CG.Game.state.pool.slice());   // the run deck, shuffled into a draw pile
    B.discard = [];
    B.enemies.forEach(en => { en.intent = prepareIntent(en); });

    // Skinwalker: permanent trophies from slain elites/bosses re-apply each combat
    applySkinTrophies();
    // battle-start passive
    if (monster.passive === 'startShield') B.playerShield = monster.passiveVal;
    // War Banner blessing — begin each battle with bonus Strength
    if (G.state.blessings.warbanner) B.strength += 2;
    // Raw Muscle Fiber / Black Feather — permanent battle-start stat gifts
    if (G.state.blessings.rawmuscle) B.strength += 3;
    if (G.state.blessings.blackfeather) B.resilience += 3;
    // Fear Braid — the second foe in the formation opens the fight Scared
    if (G.state.blessings.fearbraid && B.enemies[1]) {
      B.enemies[1].scare = (B.enemies[1].scare || 0) + 3;
      B.enemies[1].scareTurns = 3;
    }

    buildDOM();
    // base Feast: boons banked from kills last encounter cash in now (DOM is up)
    applyBankedFeastBoons();
    root.CG.Game.show('screen-battle');
    const headline = B.isBoss ? '⚔ ' + B.enemies[0].name + ' ⚔'
      : opts.shadow ? '☠ ' + B.enemies[0].name + ' ☠'
      : 'Battle';
    banner(headline, 1100);
    setTimeout(() => beginTurn(), 700);
  }

  // ============================================================
  // DOM BUILD
  // ============================================================
  function paintSprite(c, en) {
    const spr = c.querySelector('.c-sprite');
    if (!spr) return;
    if (en.img) {
      spr.classList.add('has-img');
      spr.innerHTML = '<img src="' + en.img + '" alt="">';
    } else {
      spr.classList.remove('has-img');
      spr.textContent = en.emoji;
    }
    // tougher foes loom larger on the stage — elite gets a bump, floor/final
    // bosses more so, to feel imposing (feet stay anchored, so they grow upward)
    const b = en.base || {};
    c.classList.remove('tier-elite', 'tier-floorboss', 'tier-boss');
    c.classList.toggle('foe-shadow', !!b.shadow);   // Soulhunter's black-flame aura
    if (b.boss) c.classList.add('tier-boss');
    else if (b.floorBoss) c.classList.add('tier-floorboss');
    else if (b.elite) c.classList.add('tier-elite');
  }

  function combatantHTML(name, isPlayer) {
    return `
      <div class="c-sprite"></div>
      <div class="intent"></div>
      <div class="c-name">${name}</div>
      <div class="bars">
        <div class="bar hp"><div class="fill"></div><div class="label"></div></div>
      </div>
      <div class="shield-pip"><span>◆</span><span class="sv"></span></div>
      <div class="statuses"></div>`;
  }

  // ============================================================
  // UNIVERSAL COMBAT TOOLTIP — the scattered hover tips all feed one large,
  // readable panel on the left of the battlefield. The anchored tips still
  // render (hidden by CSS) and act as the content source, so every tooltip
  // stays live-updated without duplicating its logic here.
  // ============================================================
  let ctWired = false;
  let ctSource = null;   // the element the open panel belongs to
  function clearCombatTip() {
    ctSource = null;
    const ct = $('combat-tip');
    if (ct) { ct.classList.remove('show'); ct.innerHTML = ''; }
  }
  function showCombatTip(html) {
    const ct = $('combat-tip');
    if (!ct) return;
    ct.innerHTML = html;
    ct.classList.add('show');
  }
  // the hover "owner" for any element under the cursor (or null)
  function tipSourceFor(t) {
    if (!t || t.nodeType !== 1 || !t.closest) return null;
    return t.closest('#socket-row .socket') ||
           t.closest('#hand-row .glyph') ||
           t.closest('.intent') ||
           t.closest('.status-badge') ||
           t.closest('.pc-passive-badge') ||
           t.closest('#pile-tray .pile') ||
           t.closest('#btn-recall');
  }
  // a tip's body minus its lead <b>name</b> (the panel header already names it)
  // and minus the emblem row (the header collects the emblems inline instead)
  function tipBodySansName(tipEl) {
    const c = tipEl.cloneNode(true);
    const emb = c.querySelector('.g-tip-emblems');
    if (emb) emb.remove();
    const kids = Array.from(c.childNodes);
    for (const k of kids) {
      if (k.nodeType === 1 && k.tagName === 'B') {
        const nxt = k.nextSibling;
        k.remove();
        if (nxt && nxt.nodeType === 1 && nxt.tagName === 'BR') nxt.remove();
        break;
      }
    }
    return c.innerHTML;
  }
  // build panel content for a hover source
  function tipHTMLFor(src) {
    if (!src) return null;
    // a socket merges its glyph's live tip with its slot-type / seal / curse tips
    if (src.matches('#socket-row .socket')) {
      const parts = [];
      const num = src.querySelector('.socket-num');
      const tn = src.querySelector('.slot-type-name');
      parts.push('<div class="ct-head">Socket ' + (num ? num.textContent : '') +
        (tn ? ' — ' + tn.textContent : '') + '</div>');
      const g = src.querySelector('.g-tip');
      if (g) parts.push('<div class="ct-body">' + g.innerHTML + '</div>');
      src.querySelectorAll('.slot-tip, .slot-fx-tip').forEach(x =>
        parts.push((parts.length > 1 ? '<div class="ct-div"></div>' : '') +
          '<div class="ct-body">' + x.innerHTML + '</div>'));
      if (parts.length === 1) {
        parts.push('<div class="ct-body">An empty socket — play a glyph from your hand into it.</div>');
      }
      return parts.join('');
    }
    // a glyph in hand — its name becomes the header (combo/temper emblems sit
    // inline just before it), so both drop out of the body
    if (src.matches('#hand-row .glyph')) {
      const tip = src.querySelector('.g-tip');
      if (tip) {
        const nm = src.querySelector('.g-name');
        const emb = tip.querySelector('.g-tip-emblems');
        return '<div class="ct-head">' +
          (emb ? '<span class="ct-emblems">' + emb.innerHTML + '</span>' : '') +
          (nm ? nm.textContent : 'Glyph') + '</div>' +
          '<div class="ct-body">' + tipBodySansName(tip) + '</div>';
      }
    }
    // an enemy's telegraphed intent
    if (src.classList.contains('intent')) {
      const tip = src.querySelector('.intent-tip');
      if (tip && tip.innerHTML) {
        const host = src.closest('.combatant');
        const nm = host && host.querySelector('.c-name');
        return '<div class="ct-head">' + (nm ? nm.textContent + ' — ' : '') + 'Intent</div>' +
          '<div class="ct-body">' + tip.innerHTML + '</div>';
      }
    }
    // status badges (burn / weak / leech … on enemies or the player)
    if (src.classList.contains('status-badge')) {
      const tip = src.querySelector('.hud-tip');
      if (tip) return '<div class="ct-head">Status</div><div class="ct-body">' + tip.innerHTML + '</div>';
    }
    // the beast's passive badge under its portrait
    if (src.classList.contains('pc-passive-badge')) {
      const tip = src.querySelector('.hud-tip');
      if (tip) return '<div class="ct-head">Passive</div><div class="ct-body">' + tip.innerHTML + '</div>';
    }
    // draw / discard piles + the Recall button carry their text in data-tip
    if (src.dataset && src.dataset.tip) {
      const nm = src.querySelector('.pile-label');
      return '<div class="ct-head">' + (nm ? nm.textContent + ' Pile' : 'Recall') + '</div>' +
        '<div class="ct-body">' + src.dataset.tip + '</div>';
    }
    return null;
  }
  function wireCombatTip() {
    if (ctWired) return;
    ctWired = true;
    const scr = $('screen-battle');
    if (!scr) return;
    scr.addEventListener('mouseover', (e) => {
      if (handDrag.active) return;   // no tooltips while a card is being dragged
      const src = tipSourceFor(e.target);
      if (!src || src === ctSource) return;   // unchanged owner — don't rebuild
      const html = tipHTMLFor(src);
      if (html) { ctSource = src; showCombatTip(html); }
    });
    scr.addEventListener('mouseout', (e) => {
      if (!ctSource) return;
      const to = e.relatedTarget;
      // still inside the same owner (or moving onto another tip source, which
      // the mouseover above will repaint) — otherwise the panel goes away
      if (to && (ctSource.contains(to) || tipSourceFor(to))) return;
      clearCombatTip();
    });
    scr.addEventListener('mouseleave', () => clearCombatTip());
  }
  // re-renders replace DOM nodes — if the panel's owner got swapped out, the
  // mouseout that would normally close it never fires, so close it here
  function syncCombatTip() {
    if (ctSource && !document.contains(ctSource)) clearCombatTip();
  }

  function buildDOM() {
    // wipe last battle's leftovers so nothing stale flashes during the intro banner
    $('socket-row').innerHTML = '';
    $('hand-row').innerHTML = '';
    wireCombatTip();
    clearCombatTip();
    renderForecast(null);   // fresh battle — clear any stale forecast panel
    hideComboMeter(true);
    const ez = $('enemy-zone');
    ez.innerHTML = '';
    B.enemies.forEach(en => {
      const c = el('div', 'combatant enemy');
      c.innerHTML = combatantHTML(en.name, false);
      paintSprite(c, en);
      ez.appendChild(c);
      en.dom = c;
      attachIntentTip(en);
    });
    renderPlayer();
    wirePiles();
    updatePiles();
    refreshAll();
  }

  // ---- draw / discard pile viewer ----
  // neutral preview env for a pile tile: folds in permanent empower, the per-battle
  // ramp (Everflame) and red-glyph ember so the numbers read true at a glance.
  function pileEnv(id) {
    return {
      gather: 0, comboBonus: 0, strength: 0, weak: false, shield: 0,
      resilience: 0, frail: false, chainPos: 0,
      cloneEmpower: (glyph(id).cloneEmpower || 0) + empowerOf(id),
      ramp: rampOf(id), ember: emberBonusAmt()
    };
  }
  function pileTileHTML(grp) {
    const g = grp.def;
    const art = g.img
      ? '<img class="g-img" src="' + g.img + '" alt="" draggable="false">'
      : '<div class="g-hex"><span class="g-rune">' + g.rune + '</span></div>';
    const badges =
      (grp.empower > 0 ? '<span class="pv-up pv-up-power">✦+' + grp.empower + '</span>' : '') +
      (grp.combo ? '<span class="pv-up pv-up-combo">▲▲</span>' : '');
    const tip = '<b>' + g.name + '</b>' + upgradeTipSuffix(grp.repId)
      + '<br>' + fmtDesc(grp.repId, pileEnv(grp.repId));
    return '<div class="pv-tile" style="--g-color:var(--' + g.color + ')" data-tip="' + escAttr(tip) + '">'
      + badges
      + '<div class="pv-art">' + art + '</div>'
      + '<div class="pv-name">' + g.name + '</div>'
      + (grp.count > 1 ? '<div class="pv-count">×' + grp.count + '</div>' : '')
      + '</div>';
  }
  function escAttr(s) { return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
  // a single floating tooltip lives in the overlay (not the scrolling panel),
  // so it can never be clipped by the modal edges; we clamp it into the stage.
  function showPileTip(tile) {
    const tip = $('pv-float-tip'), Scale = root.CG.Scale;
    if (!tip || !Scale) return;
    tip.innerHTML = tile.getAttribute('data-tip') || '';
    tip.style.visibility = 'hidden'; tip.style.opacity = '0'; tip.classList.add('show');
    const r = tile.getBoundingClientRect();
    const topPt = Scale.toStage(r.left + r.width / 2, r.top);
    const botPt = Scale.toStage(r.left + r.width / 2, r.bottom);
    const W = Scale.REF_W, halfW = tip.offsetWidth / 2, th = tip.offsetHeight, m = 16;
    let x = Math.min(Math.max(topPt.x, m + halfW), W - m - halfW);
    let y, anchor;
    if (topPt.y - 12 - th >= m) { y = topPt.y - 12; anchor = 'translate(-50%, -100%)'; }
    else { y = botPt.y + 12; anchor = 'translate(-50%, 0)'; }
    tip.style.left = x + 'px'; tip.style.top = y + 'px'; tip.style.transform = anchor;
    tip.style.visibility = 'visible'; tip.style.opacity = '1';
  }
  function hidePileTip() { const tip = $('pv-float-tip'); if (tip) { tip.classList.remove('show'); tip.style.opacity = '0'; tip.style.visibility = 'hidden'; } }
  // group a pile's instance ids by glyph + forge signature (so an upgraded copy
  // reads as its own tile with the right numbers)
  function pileGroups(ids) {
    const map = {}, order = [];
    ids.forEach(id => {
      const key = baseOf(id) + '|' + empowerOf(id) + '|' + (comboAdv(id) > 1 ? 1 : 0);
      if (!map[key]) { map[key] = { def: glyph(id), repId: id, empower: empowerOf(id), combo: comboAdv(id) > 1, count: 0 }; order.push(key); }
      map[key].count++;
    });
    return order.map(k => map[k]).sort((a, b) => a.def.name.localeCompare(b.def.name));
  }
  function renderPileViewer() {
    if (!B.pileOpen) return;
    const which = B.pileOpen;
    const ids = which === 'deck' ? B.draw : B.discard;
    $('pile-viewer-title').textContent = (which === 'deck' ? 'Draw Pile' : 'Discard Pile') + ' (' + ids.length + ')';
    const grid = $('pile-viewer-grid');
    const groups = pileGroups(ids);
    grid.innerHTML = groups.length
      ? groups.map(pileTileHTML).join('')
      : '<div class="pile-viewer-empty">' + (which === 'deck' ? 'The draw pile is empty.' : 'Nothing discarded yet.') + '</div>';
    hidePileTip();
    grid.querySelectorAll('.pv-tile').forEach(t => {
      t.addEventListener('mouseenter', () => showPileTip(t));
      t.addEventListener('mouseleave', hidePileTip);
    });
  }
  function openPileViewer(which) {
    B.pileOpen = which;
    renderPileViewer();
    $('pile-viewer').classList.remove('hidden');
    SFX.click();
  }
  function closePileViewer() { B.pileOpen = null; hidePileTip(); $('pile-viewer').classList.add('hidden'); }
  function wirePiles() {
    const deck = $('pile-deck'), disc = $('pile-discard'), close = $('pile-viewer-close'), vw = $('pile-viewer'), grid = $('pile-viewer-grid');
    if (deck) deck.onclick = () => openPileViewer('deck');
    if (disc) disc.onclick = () => openPileViewer('discard');
    if (close) close.onclick = closePileViewer;
    if (vw) vw.onclick = e => { if (e.target === vw) closePileViewer(); };
    if (grid) grid.addEventListener('scroll', hidePileTip);
  }

  function renderPlayer() {
    const m = B.monster;
    const pz = $('player-monster');
    pz.className = 'player-combat';
    pz.style.setProperty('--pc-color', m.color || 'var(--gold)');
    const face = m.img
      ? `<img class="c-sprite" src="${m.img}" alt="">`
      : `<span class="c-sprite">${m.emoji}</span>`;
    // split "Stonehide: reduce all incoming damage…" into a badge name + tooltip
    const passiveFull = m.passiveText || '';
    const ci = passiveFull.indexOf(':');
    const passiveName = ci > 0 ? passiveFull.slice(0, ci).trim() : (m.passive || '');
    const passiveDesc = ci > 0 ? passiveFull.slice(ci + 1).trim() : passiveFull;
    const badge = (nm, desc) =>
      `<div class="pc-passive-badge" tabindex="0">
           <span class="pcb-icon">✦</span><span class="pcb-name">${nm}</span>
           <span class="hud-tip"><b>${nm}</b> ${desc || ''}</span>
         </div>`;
    let passiveHTML = passiveName ? badge(passiveName, passiveDesc) : '';
    (m.evoPassives || []).forEach(p => { passiveHTML += badge(p.name, p.text); });
    pz.innerHTML = `
      <div class="pc-disc-wrap">
        <div class="pc-disc">
          <svg class="pc-hp-ring" viewBox="0 0 160 160" aria-hidden="true">
            <circle class="hp-track" cx="80" cy="80" r="66"></circle>
            <circle class="hp-arc" cx="80" cy="80" r="66"></circle>
          </svg>
          <div class="pc-gear"></div>
          <div class="pc-rune"></div>
          <div class="pc-portrait">${face}</div>
          <div class="shield-pip"><span class="sp-ico">◆</span><span class="sv"></span></div>
          <div class="pc-hp-num"></div>
        </div>
      </div>
      <div class="pc-name">${m.name}</div>
      <div class="pc-role">${m.role}</div>
      ${passiveHTML}
      <div class="statuses"></div>`;
    // seed the radial HP gauge geometry
    const arc = pz.querySelector('.hp-arc');
    if (arc) { const C = 2 * Math.PI * 66; arc.style.strokeDasharray = C; arc.dataset.c = C; arc.style.strokeDashoffset = 0; }
    const spr = pz.querySelector('.c-sprite');
    if (spr && !m.img) spr.style.color = m.color;
  }

  // the global HUD is owned by Game; battle just asks it to refresh
  function updateTopbar() { root.CG.Game.updateTopbar(); }

  // ============================================================
  // RENDER: bars / intents / statuses
  // ============================================================
  function setBar(dom, hp, maxHp) {
    const ratio = Math.max(0, Math.min(1, hp / maxHp));
    // the player's HP is a radial gauge around the portrait; enemies keep the bar
    const arc = dom.querySelector('.hp-arc');
    if (arc) {
      const C = parseFloat(arc.dataset.c) || (2 * Math.PI * 66);
      arc.style.strokeDashoffset = (1 - ratio) * C;
      arc.classList.toggle('low', ratio <= 0.3);
      const num = dom.querySelector('.pc-hp-num');
      if (num) num.textContent = Math.max(0, Math.round(hp)) + ' / ' + maxHp;
      return;
    }
    const fill = dom.querySelector('.bar.hp .fill');
    if (!fill) return;
    fill.style.transform = 'scaleX(' + ratio + ')';
    const lbl = dom.querySelector('.bar.hp .label');
    if (lbl) lbl.textContent = Math.max(0, Math.round(hp)) + ' / ' + maxHp;
  }
  function setShieldPip(dom, val) {
    const pip = dom.querySelector('.shield-pip');
    pip.classList.toggle('on', val > 0);
    pip.querySelector('.sv').textContent = val;
  }

  function intentText(intent) {
    switch (intent.type) {
      case 'attack': {
        const hits = intent.hits || 1;
        return { cls: 'attack', icon: '⚔', txt: intent.value + (hits > 1 ? ' ×' + hits : '') + (intent.big ? '  ⚠' : '') };
      }
      case 'defend': return { cls: 'defend', icon: '🛡', txt: 'Guard ' + intent.value };
      case 'buff':   return { cls: 'buff', icon: '✦', txt: intent.turns ? 'Strength +' + (intent.value || 3) : 'Empower' };
      case 'rally':  return { cls: 'buff', icon: '🚩', txt: 'Rally +' + (intent.value || 4) };
      case 'curse':  return { cls: 'hex', icon: '☠', txt: 'Curse Slot ' + (clampSlot(intent.slot) + 1) };
      case 'sunder': return { cls: 'hex', icon: '⛔', txt: 'Seal Slot ' + (clampSlot(intent.slot) + 1) };
      case 'trash':  return { cls: 'hex', icon: '◼', txt: 'Bury ' + (intent.count || 1) };
      case 'clog':   return { cls: 'hex', icon: '⛓', txt: 'Dead Weight' };
      case 'debuff': return { cls: 'hex', icon: '👁', txt: intent.stat === 'frail' ? 'Frail' : 'Weaken' };
      case 'summon': return { cls: 'buff', icon: '💀', txt: 'Summon' };
      case 'regen':  return { cls: 'mend', icon: '✚', txt: 'Mend ' + (intent.value || 6) };
      case 'siphon': return { cls: 'hex', icon: '🩸', txt: intent.stat === 'strength' ? 'Siphon Might' : 'Siphon Block' };
      default:       return { cls: 'buff', icon: '✦', txt: '?' };
    }
  }

  // build the inner DOM for an enemy's telegraph — a single action, or two
  // chained actions shown side-by-side for elites/bosses
  function intentBadgeHTML(intent) {
    const it = intentText(intent);
    return `<span class="i-icon">${it.icon}</span><span>${it.txt}</span>`;
  }
  function intentInnerHTML(intent) {
    if (intent.type === 'multi') {
      const body = intent.actions.map(a => `<span class="i-part i-${intentText(a).cls}">${intentBadgeHTML(a)}</span>`)
        .join('<span class="i-amp">+</span>');
      const tip = intent.actions.map(a => intentDetail(a)).join('<br><span class="tip-then">then…</span> ');
      return { cls: 'multi', html: body + `<div class="intent-tip">${tip}</div>` };
    }
    return { cls: intentText(intent).cls, html: intentBadgeHTML(intent) + `<div class="intent-tip">${intentDetail(intent)}</div>` };
  }

  // plain-language explanation of an enemy's telegraphed action (hover/click tip)
  function intentDetail(intent) {
    switch (intent.type) {
      case 'attack': {
        const hits = intent.hits || 1;
        return hits > 1
          ? 'Attacks <b>' + hits + '</b> times for <b>' + intent.value + '</b> (<b>' + (intent.value * hits) + '</b> total).'
          : 'Attacks for <b>' + intent.value + '</b> damage' + (intent.big ? ' — a heavy blow!' : '.');
      }
      case 'defend': return 'Raises <b>' + intent.value + '</b> shield, bracing against your strikes.';
      case 'buff':   return intent.turns
        ? 'Steels itself: <b>+' + (intent.value || 3) + '</b> Strength for <b>' + intent.turns + '</b> turns — every attack hits harder.'
        : 'Empowers itself — its next attack hits harder.';
      case 'rally':  return 'Empowers <b>all</b> allies by <b>+' + (intent.value || 4) + '</b> damage.';
      case 'curse':  return 'Curses socket <b>' + (clampSlot(intent.slot) + 1) + '</b> for <b>' + (intent.value || 2) + '</b> turns: that slot\'s effect still lands normally, but is <b>also mirrored</b> — your shields & heals also feed the caster, and its damage & burns also recoil onto you.';
      case 'sunder': return 'Seals socket <b>' + (clampSlot(intent.slot) + 1) + '</b> shut for <b>' + (intent.value || 2) + '</b> turns — you forge with one fewer slot.';
      case 'trash':  return 'Buries <b>' + (intent.count || 1) + '</b> Rubble in your ' + (intent.where || 'deck') + ', clogging future draws until you socket it away.';
      case 'clog':   return 'Jams a 2-socket <b>Dead Weight</b> into your hand. It never discards until you socket it.';
      case 'debuff': return intent.stat === 'frail' ? 'Applies <b>Frail</b> — your shield gains are reduced.' : 'Applies <b>Weak</b> — your damage is reduced.';
      case 'summon': return 'Summons a minion to join the fight.';
      case 'regen':  return 'Knits its wounds, healing <b>' + (intent.value || 6) + '</b> HP. Burst it down before it recovers.';
      case 'siphon': return intent.stat === 'strength'
        ? 'Drains up to <b>' + (intent.value || 2) + '</b> of your <b>Strength</b> and claims it for itself.'
        : 'Drains up to <b>' + (intent.value || 6) + '</b> of your <b>Block</b> and adds it to its own shield.';
      default:       return 'Prepares an unknown action.';
    }
  }
  // hover shows the tip; click pins it open (survives refreshAll via en.intentPinned)
  function attachIntentTip(en) {
    const intEl = en.dom && en.dom.querySelector('.intent');
    if (!intEl) return;
    intEl.addEventListener('click', e => {
      e.stopPropagation();
      en.intentPinned = !en.intentPinned;
      intEl.classList.toggle('tip-open', en.intentPinned);
    });
  }

  // status glossary — icon + name + tooltip text per status (keyed so the same
  // condition can read differently for player vs enemy where the math differs)
  const STATUS_META = {
    strength:   { cls: 'str',   icon: '⚔', name: 'Strength',   desc: 'Adds {n} damage to each of your attacks.' },
    resilience: { cls: 'res',   icon: '🛡', name: 'Resilience', desc: 'Adds {n} to every block you gain.' },
    pweak:      { cls: 'weak',  icon: '▼', name: 'Weak',       desc: 'Your attacks deal 40% less damage. {n} turn(s) left.' },
    frail:      { cls: 'leech', icon: '💔', name: 'Frail',      desc: 'You gain 50% less block. {n} turn(s) left.' },
    pburn:      { cls: 'burn',  icon: '🔥', name: 'Burn',       desc: 'Take {n} damage at the start of your turn, then it drops by 1.' },
    eweak:      { cls: 'weak',  icon: '▼', name: 'Weak',       desc: 'This enemy\'s attacks deal 45% less damage. {n} turn(s) left.' },
    eburn:      { cls: 'burn',  icon: '🔥', name: 'Burn',       desc: 'Takes {n} damage at the start of its turn, then Burn drops by 1.' },
    leech:      { cls: 'leech', icon: '🩸', name: 'Leech',      desc: 'Saps 10% of its HP each turn to heal your beast — and powers many Ghoul glyphs. {n} turn(s) left.' },
    scare:      { cls: 'scare', icon: '☠', name: 'Scared',     desc: 'Takes +{n} damage from each of your attacks.' },
    empower:    { cls: 'str',   icon: '⊕', name: 'Empower',    desc: 'Adds {n} damage to this enemy\'s next attack only.' },
    estrength:  { cls: 'str',   icon: '⚔', name: 'Strength',   desc: 'Adds {n} damage to its attacks.' },
    ward:       { cls: 'res',   icon: '🛡', name: 'Wardstone',  desc: 'While it lives, its allies take {n} less damage from your hits. Break it first.' },
    warded:     { cls: 'res',   icon: '🜉', name: 'Warded',     desc: 'A Wardstone shields this foe — {n} less damage from your hits. Destroy the Wardstone to end it.' },
    thorns:     { cls: 'scare', icon: '🜂', name: 'Thornmail',  desc: 'Each time you strike it, it lashes {n} damage back at you — avoid wasteful multi-hits.' },
    enrage:     { cls: 'str',   icon: '🔺', name: 'Enrage',     desc: 'Gains +{n} Strength at the end of every turn. End the fight fast.' }
  };
  function shieldBadge(val) {
    return '<span class="status-badge shield" tabindex="0">' +
             '<span class="sb-icon">◆</span>' +
             '<span class="sb-num">' + val + '</span>' +
             '<span class="hud-tip"><b>Block</b> Absorbs ' + val + ' incoming damage this turn before HP is touched.</span>' +
           '</span>';
  }
  function statusBadge(key, val) {
    const m = STATUS_META[key];
    if (!m) return '';
    return '<span class="status-badge ' + m.cls + '" tabindex="0">' +
             '<span class="sb-icon">' + m.icon + '</span>' +
             '<span class="sb-num">' + val + '</span>' +
             '<span class="hud-tip"><b>' + m.name + '</b> ' + m.desc.replace('{n}', val) + '</span>' +
           '</span>';
  }

  function refreshAll() {
    B.enemies.forEach(en => {
      setBar(en.dom, en.hp, en.maxHp);
      setShieldPip(en.dom, en.shield);
      const intDom = en.dom.querySelector('.intent');
      if (en.alive) {
        const r = intentInnerHTML(en.intent);
        intDom.className = 'intent ' + r.cls + (en.intentPinned ? ' tip-open' : '');
        intDom.innerHTML = r.html;
        intDom.style.display = 'flex';
        en.dom.classList.remove('dead', 'dying');
      } else {
        intDom.style.display = 'none';
        // play the death animation if it hasn't started (e.g. died to a status tick);
        // killEnemyVisual collapses it once the animation ends
        if (!en.dom.classList.contains('dying') && !en.dom.classList.contains('dead')) killEnemyVisual(en);
      }
      // statuses
      const st = en.dom.querySelector('.statuses');
      let s = '';
      if (en.shield > 0) s += shieldBadge(en.shield);
      if (en.weak > 0) s += statusBadge('eweak', en.weak);
      if (en.burn > 0) s += statusBadge('eburn', en.burn);
      if (en.leech > 0) s += statusBadge('leech', en.leech);
      if (en.scare > 0) s += statusBadge('scare', en.scare);
      if (en.empower > 0) s += statusBadge('empower', en.empower);
      if (en.strength > 0) s += statusBadge('estrength', en.strength);
      // passive gimmick badges (read off the def, active while it lives)
      if (en.base) {
        if (en.base.ward > 0) s += statusBadge('ward', en.base.ward);
        else if (wardReductionFor(en) > 0) s += statusBadge('warded', wardReductionFor(en));
        if (en.base.thorns > 0) s += statusBadge('thorns', en.base.thorns);
        if (en.base.enrage > 0) s += statusBadge('enrage', en.base.enrage);
      }
      st.innerHTML = s;
    });
    const pd = $('player-monster');
    setBar(pd, B.monster.hp, B.monster.maxHp);
    setShieldPip(pd, B.playerShield);
    const ps = pd.querySelector('.statuses');
    if (ps) {
      let s = '';
      if (effStrength() > 0) s += statusBadge('strength', effStrength());
      if (B.resilience > 0) s += statusBadge('resilience', B.resilience);
      if (B.playerWeak > 0) s += statusBadge('pweak', B.playerWeak);
      if (B.playerFrail > 0) s += statusBadge('frail', B.playerFrail);
      if (B.playerBurn > 0) s += statusBadge('pburn', B.playerBurn);
      ps.innerHTML = s;
    }
    updateTopbar();
  }

  // ============================================================
  // TURN START
  // ============================================================
  function beginTurn() {
    if (B.ended) return;
    B.enemyActing = false;   // player's turn — items are usable again
    B.turn++;
    $('turn-counter').textContent = B.turn;

    // a Devil ignored three turns running takes its tithe before anything else
    ensureDevils();
    chompStarvedDevils();
    if (B.ended) return;

    // shield is a per-turn response to telegraphs — but Iron Wall never lets it fade
    B.playerShield = hasPassive('ironwall') ? (B.playerShield || 0) : 0;
    if (B.monster.passive === 'turnShield') B.playerShield += B.monster.passiveVal;
    if (B.monster.passive === 'startShield' && B.turn === 1) B.playerShield += B.monster.passiveVal;
    B.playerShield += (B.monster.runTurnShield || 0);   // Devil(blue) run buff
    if (B.carryShield > 0) { B.playerShield += B.carryShield; B.carryShield = 0; }   // Bastion carry-over

    // Feast bonuses sapped from foes: Block-each-turn, Strength-each-turn, Cleanse
    if (B.feastGuard > 0) B.playerShield += B.feastGuard;
    if (B.feastRamp > 0) { B.strength += B.feastRamp; strengthFx(playerArt()); }
    if (B.feastCleanse > 0) feastCleanseNow();
    B.devilsFedThisTurn = 0;   // Demon amp counts per turn

    // start-of-turn blessing upkeep
    const _bl = root.CG.Game.state.blessings;
    if (_bl.aegis) B.playerShield += 3;
    if (_bl.bastionheart) B.playerShield += 5;
    if (_bl.lifebloom && B.monster.hp < B.monster.maxHp) {
      B.monster.hp = Math.min(B.monster.maxHp, B.monster.hp + 2);
      setBar($('player-monster'), B.monster.hp, B.monster.maxHp);
      floatText(offset(center(playerArt()), -10, -70), '+2', 'heal');
    }

    // Gravetide: each turn, the grave-tide rises with the dying — gain +1 Strength
    // (rest of battle) for every enemy you keep Leeched. Ramp is gated by upkeep,
    // so there's no turn-one spike.
    if (B.monster.passive === 'gravetide') {
      const leeched = B.enemies.filter(e => e.alive && e.leech > 0).length;
      if (leeched > 0) {
        B.strength += leeched;
        floatText(offset(center(playerArt()), 60, -120), 'Gravetide +' + leeched + ' Str', 'status');
        strengthFx(playerArt());
      }
    }

    // sockets rebuild — keep slot timers in sync with current socket count
    B.turnStrength = 0;
    B.sockets = new Array(B.monster.sockets).fill(null);
    B.spanHead = new Array(B.monster.sockets).fill(null);
    while (B.slotFx.length < B.monster.sockets) B.slotFx.push({ disabled: 0, cursed: 0, caster: null });
    while (B.slotTypes.length < B.monster.sockets) B.slotTypes.push('normal');
    B.recallUsed = false;
    drawHand();
    assignDevilCravings();   // each Devil picks a craved glyph + rolls a boon for this turn
    renderSockets();
    renderHand(true);
    applyFoxlights();        // turn-start color payoff for the Foxlights form
    refreshAll();
    updateRecallBtn();
    updateActButton();
    updatePiles();
    renderForecast(null);
  }

  // a slot can be filled if it accepts glyphs (pure Loopback never does — but a
  // hybrid Loop socket still holds one), is empty (not already a glyph or a
  // multi-socket continuation), and not sealed
  function slotTakesGlyph(i) { return !isPureLoop(i); }
  function slotFillable(i) {
    return B.sockets[i] == null && (B.spanHead[i] == null) && slotTakesGlyph(i) && !slotDisabled(i);
  }
  function freeSocketCount() {
    let n = 0;
    for (let i = 0; i < B.sockets.length; i++) if (slotFillable(i)) n++;
    return n;
  }
  function firstFreeSocket() {
    for (let i = 0; i < B.sockets.length; i++) if (slotFillable(i)) return i;
    return -1;
  }
  // first index that starts a run of `span` consecutive fillable sockets
  function firstFreeRun(span) {
    if (span <= 1) return firstFreeSocket();
    for (let i = 0; i + span - 1 < B.sockets.length; i++) {
      let ok = true;
      for (let k = 0; k < span; k++) if (!slotFillable(i + k)) { ok = false; break; }
      if (ok) return i;
    }
    return -1;
  }
  function canPlaceGlyph(id) {
    const span = glyph(id).slots || 1;
    return firstFreeRun(span) !== -1;
  }
  function slotDisabled(i) { return B.slotFx[i] && B.slotFx[i].disabled > 0; }
  function slotCursed(i) { return B.slotFx[i] && B.slotFx[i].cursed > 0; }

  // ACT becomes SKIP (end turn) when nothing is socketed
  function updateActButton() {
    const btn = $('btn-detonate');
    if (!btn) return;
    const hasPlaced = B.sockets.some(s => s !== null);
    btn.disabled = !!B.resolving;
    btn.classList.toggle('is-skip', !hasPlaced);
    const lab = btn.querySelector('.det-label');
    const sub = btn.querySelector('.det-sub');
    if (lab) lab.textContent = hasPlaced ? 'Act' : 'Skip';
    if (sub) sub.textContent = hasPlaced ? 'resolve' : 'end turn';
  }

  // Fisher–Yates
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function removeOne(arr, id) { const i = arr.indexOf(id); if (i !== -1) arr.splice(i, 1); }
  // pull `count` cards off the draw pile, reshuffling the discard back in when it runs dry
  function drawFromPile(count) {
    const out = [];
    for (let i = 0; i < count; i++) {
      if (!B.draw.length) {
        if (!B.discard.length) break;       // deck fully exhausted this turn
        B.draw = shuffle(B.discard); B.discard = [];
      }
      out.push(B.draw.pop());
    }
    return out;
  }

  function drawHand() {
    // Dead Weight (sticky) and freshly-forced junk both eat into your draw
    const stuckCost = B.stuck.reduce((s, id) => s + (glyph(id).slots || 1), 0);
    const injected = B.injected.slice();
    B.injected = [];
    // Held / cloned glyphs return as EXTRA cards — pure bonuses that ADD to your
    // hand and do NOT reduce your fresh draw (a Held card joins a full hand, it
    // never replaces a drawn one). Only forced junk (stuck / injected) eats in.
    const extras = B.extras.slice();
    B.extras = [];
    // Fresh draw target: at least your socket count, never fewer than 5 (+1 Overload).
    // Extras are then layered on top, so e.g. 5 sockets + 1 Hold + 1 Clone = 7 cards.
    const target = Math.max(5, B.monster.sockets) + (root.CG.Game.state.blessings.overload ? 1 : 0);
    let handSize = target - stuckCost - injected.length;
    handSize = Math.max(0, handSize);
    const hand = drawFromPile(handSize);
    B.hand = B.stuck.concat(injected, extras, hand);
    // real deck cards (drawn + non-clone held returns) flow to the discard at end of turn;
    // stuck / injected junk / temp clones stay outside the pile system
    B.drawnThisTurn = hand.slice();
    extras.forEach(id => { if (!glyph(id).cloneOf) B.drawnThisTurn.push(id); });
    applyDrawHooks();
  }

  // "When drawn" effects fire each turn the card is in your hand.
  // On-draw Strength is capped to once per glyph type per turn (so a hand full
  // of Onslaughts doesn't snowball Strength).
  function applyDrawHooks() {
    const strSeen = {};
    B.hand.forEach(id => {
      const base = baseOf(glyph(id).cloneOf || id);   // cap is per glyph TYPE
      const od = glyph(id).onDraw;
      if (!od) return;
      if (od.kind === 'strength') {
        if (strSeen[base]) return;
        strSeen[base] = 1;
        B.turnStrength += od.value;
      } else if (od.kind === 'heal') {
        B.monster.hp = Math.min(B.monster.maxHp, B.monster.hp + od.value);
      }
    });
  }

  // ============================================================
  // GLYPH TILES (use bespoke rune art where available)
  // ============================================================
  function glyphVisual(id) {
    const g = glyph(id);
    if (g.img) {
      const i = el('img', 'g-img');
      i.src = g.img; i.alt = g.name; i.draggable = false;
      return i;
    }
    const hex = el('div', 'g-hex');
    hex.innerHTML = '<span class="g-rune">' + g.rune + '</span>';
    return hex;
  }

  // a multi-socket glyph reads as a diagonally stacked set of the same rune
  // (two for a 2-slot glyph, a triad for 3) instead of one wide tile.
  function glyphStack(id, n) {
    if (!n || n <= 1) return glyphVisual(id);
    const wrap = el('div', 'g-stack');
    wrap.style.setProperty('--n', n);
    for (let i = 0; i < n; i++) {
      const layer = el('div', 'g-layer');
      layer.style.setProperty('--i', i);
      layer.appendChild(glyphVisual(id));
      wrap.appendChild(layer);
    }
    return wrap;
  }

  // the A/B/C/Wild badge that drives alphabet combos
  function letterChip(id) {
    const l = glyph(id).letter;
    if (!l) return null;
    return el('div', 'letter-chip ' + (l === 'wild' ? 'wild' : 'l-' + l), l === 'wild' ? '✦' : l);
  }

  function glyphTile(id) {
    const g = glyph(id);
    const t = el('div', 'glyph');
    if (g.junk) t.classList.add('junk');
    if ((g.slots || 1) > 1) t.classList.add('wide');
    if (g.sticky) t.classList.add('sticky');
    if (g.cloneOf) t.classList.add('cloned');
    t.style.setProperty('--g-color', 'var(--' + g.color + ')');
    t.dataset.color = g.color;
    const body = el('div', 'g-body');
    body.appendChild(glyphStack(id, g.slots || 1));
    // chip lives inside the body so it lifts/scales with the card on hover
    const chip = letterChip(id);
    if (chip) body.appendChild(chip);
    t.appendChild(body);
    t.appendChild(el('span', 'g-name', g.name));
    // per-card upgrade markers (this specific copy, not the glyph type)
    const emp = empowerOf(id);
    if (emp > 0) t.appendChild(el('span', 'g-up g-up-power', '✦+' + emp));
    if (comboAdv(id) > 1) t.appendChild(el('span', 'g-up g-up-combo', '▲▲'));
    // on hover the on-card emblems fade out and re-collect inside the tooltip
    let emblems = '';
    const lc = glyph(id).letter;
    if (lc) emblems += '<span class="te-chip ' + (lc === 'wild' ? 'wild' : 'l-' + lc) + '">' + (lc === 'wild' ? '✦' : lc) + '</span>';
    if (emp > 0) emblems += '<span class="te-up te-up-power">✦+' + emp + '</span>';
    if (comboAdv(id) > 1) emblems += '<span class="te-up te-up-combo">▲▲</span>';
    const emblemRow = emblems ? '<div class="g-tip-emblems">' + emblems + '</div>' : '';
    t.appendChild(el('div', 'g-tip', emblemRow + '<b>' + g.name + '</b>' + upgradeTipSuffix(id) + '<br>' + fmtDesc(id, handEnv(id))));
    return t;
  }

  function renderHand(animate) {
    const row = $('hand-row');
    row.innerHTML = '';
    syncCombatTip();   // the old hand nodes are gone — drop a stale panel
    // is a combo chain already going? (a lettered glyph is socketed)
    const tail = placedComboTail();
    // which hand cards a Devil is craving right now (distinct copies). The
    // craving is signalled by a Devil Finger pointing at the card.
    const cravedAt = {};
    if (B.devil) {
      const used = {};
      devilIdxs().forEach(di => {
        const d = B.devil[di];
        if (!d || !d.crave || d.fed) return;
        let hi = B.hand.findIndex((hid, k) => !used[k] && hid === d.craveId);
        if (hi === -1) hi = B.hand.findIndex((hid, k) => !used[k] && baseOf(hid) === d.crave);
        if (hi !== -1) { used[hi] = true; cravedAt[hi] = di; }
      });
    }
    B.hand.forEach((id, i) => {
      const t = glyphTile(id);
      if (cravedAt[i] != null) {
        t.classList.add('devil-craved');
        const finger = el('img', 'devil-finger');
        finger.src = 'assets/Devil Finger.png';
        finger.alt = '';
        t.appendChild(finger);
      }
      // highlight cards that would continue the active alphabet chain
      if (!B.resolving && tail.prev != null && comboLinks(tail.prev, comboLetter(id))) {
        t.classList.add('combo-next');
      }
      // a glyph is playable only if its full socket span can fit somewhere
      const playable = !B.resolving && canPlaceGlyph(id);
      if (!playable) {
        t.style.opacity = '0.45'; t.style.cursor = 'not-allowed';
        if (!B.resolving && (glyph(id).slots || 1) > 1) t.classList.add('no-room');
      } else {
        t.addEventListener('mouseenter', () => {
          if (handDrag.active) return;
          SFX.hover(); t.style.zIndex = 1000;
          markDestSockets(id, true);     // light up where it would land
          renderForecast(id);            // fold it into the forecast
        });
        t.addEventListener('mouseleave', () => {
          t.style.zIndex = t.dataset.baseZ || 0;
          if (handDrag.active) return;
          markDestSockets(null, false);
          renderForecast(null);
        });
      }
      wireHandDrag(t, i, playable);      // tap plays it; press-and-drag reorders
      row.appendChild(t);
    });
    layoutHand();
    if (animate) animateDraw(Array.from(row.children));
  }

  // stage-space center of an element (1 stage unit == 1 logical px pre-scale)
  function stageRectCenter(elm) {
    const r = elm.getBoundingClientRect();
    return root.CG.Scale.toStage(r.left + r.width / 2, r.top + r.height / 2);
  }
  function pulsePile(elm) {
    if (!elm) return;
    elm.classList.remove('pulse'); void elm.offsetWidth; elm.classList.add('pulse');
  }
  // deal: each card streaks out of the DECK pile into its slot in the hand
  function animateDraw(cards) {
    const deck = $('pile-deck');
    if (!deck || !cards.length || typeof cards[0].animate !== 'function' || !root.CG.Scale) return;
    const from = stageRectCenter(deck);
    pulsePile(deck);
    cards.forEach((c, i) => {
      const cc = stageRectCenter(c);
      const dx = from.x - cc.x, dy = from.y - cc.y;
      c.animate([
        { transform: `translate(${dx}px, ${dy}px) scale(.22) rotate(-28deg)`, opacity: 0 },
        { opacity: 1, offset: 0.32 },
        { transform: 'translate(0,0) scale(1) rotate(0)' }
      ], { duration: 460, delay: i * 55, easing: 'cubic-bezier(.2,.85,.3,1)', fill: 'backwards' });
    });
  }
  // discard: unplayed cards sweep off into the DISCARD pile
  function animateDiscard(cards) {
    const disc = $('pile-discard');
    return new Promise(res => {
      if (!disc || !cards.length || typeof cards[0].animate !== 'function' || !root.CG.Scale) { res(); return; }
      const to = stageRectCenter(disc);
      let done = 0; const total = cards.length;
      cards.forEach((c, i) => {
        const cc = stageRectCenter(c);
        const dx = to.x - cc.x, dy = to.y - cc.y;
        const a = c.animate([
          { transform: 'translate(0,0) scale(1) rotate(0)', opacity: 1 },
          { transform: `translate(${dx}px, ${dy}px) scale(.22) rotate(26deg)`, opacity: 0 }
        ], { duration: 420, delay: i * 45, easing: 'cubic-bezier(.45,0,.7,1)', fill: 'forwards' });
        const fin = () => { if (++done === total) { pulsePile(disc); res(); } };
        a.onfinish = fin;
      });
      setTimeout(() => { if (done < total) res(); }, 420 + total * 45 + 250);
    });
  }

  // Lay the hand out so it ALWAYS reads as centered on the stage, no matter the
  // card count. We use a band that is symmetric around stage center — its reach
  // is the SMALLER of the clearances to the player panel (left) and the ACT
  // button (right). Cards keep their natural gap until they'd overflow that
  // band, then overlap just enough to fit. Because the band is symmetric, the
  // row never has to drift off-center to clear the UI — adding/removing a glyph
  // simply tightens or loosens the spacing while the group stays centered.
  const HAND_GAP = 22;
  const ZONE_L = 454;          // right edge of the player panel (+margin)
  const ZONE_R = 1604;         // left edge of the ACT button (-margin)
  const STAGE_MID = 960;
  function layoutHand() {
    const row = $('hand-row');
    const cards = Array.from(row.children);
    if (!cards.length) { row.style.transform = 'translateX(0)'; return; }
    const sumW = cards.length * 150;       // multi-socket glyphs share the normal footprint
    const n = cards.length;
    // symmetric reach: limited by whichever side (panel / ACT button) is tighter
    const halfBand = Math.min(STAGE_MID - ZONE_L, ZONE_R - STAGE_MID);
    const bandW = halfBand * 2;
    const natural = sumW + HAND_GAP * (n - 1);
    let step = HAND_GAP;
    if (n > 1 && natural > bandW) step = (bandW - sumW) / (n - 1);   // negative => overlap
    row.dataset.step = step;   // the drag-reorder math reads the card pitch from here
    cards.forEach((c, i) => {
      c.style.marginLeft = (i === 0 ? 0 : step) + 'px';
      c.dataset.baseZ = i;        // later cards stack above earlier ones
      c.style.zIndex = i;
    });
    // flexbox already centers the row on the stage; with a symmetric band there
    // is never any need to nudge it sideways.
    row.style.transform = 'translateX(0)';
  }

  // sockets are rebuilt from scratch on every turn-start/placement; anchoring a
  // looping animation's phase to the wall clock keeps idle pulses (the "current
  // socket" beckon, loopback bob) continuous across rebuilds instead of snapping
  // back to frame 0 each time the hand is drawn.
  function syncPulse(elm, periodMs) {
    elm.style.animationDelay = (-(((root.performance || Date).now()) % periodMs)) + 'ms';
  }
  function renderSockets() {
    const row = $('socket-row');
    row.innerHTML = '';
    // scale the row down as sockets pile up so a wide row never overlaps the
    // left character panel (3-5 keep the full 152px; 9 packs to ~94px)
    const n = B.sockets.length;
    let size = 152, gap = 30;
    if (n >= 9) { size = 94; gap = 12; }
    else if (n === 8) { size = 104; gap = 14; }
    else if (n === 7) { size = 118; gap = 18; }
    else if (n === 6) { size = 134; gap = 24; }
    row.style.setProperty('--sock-size', size + 'px');
    row.style.setProperty('--sock-gap', gap + 'px');
    const firstFree = firstFreeSocket();
    B.sockets.forEach((id, i) => {
      const list = slotList(i);
      const primary = list.length ? list[0] : 'normal';
      const s = el('div', 'socket slot-' + primary + (list.length > 1 ? ' slot-hybrid' : ''));
      s.innerHTML = '<img class="slot-img" src="assets/Base Rune.png" alt=""><span class="socket-num">' + (i + 1) + '</span>';
      if (list.length) {
        const groups = groupSlotTypes(list);
        const badge = el('div', 'slot-badge' + (groups.length > 1 ? ' multi' : ''));
        badge.innerHTML = groups.map(g =>
          '<span class="sb-ic">' + SLOT_META[g.t].icon + (g.n > 1 ? '<i>×' + g.n + '</i>' : '') + '</span>').join('');
        badge.appendChild(el('div', 'slot-tip', slotTipHTML(list)));
        s.appendChild(badge);
        s.appendChild(el('div', 'slot-type-name', slotLabel(list)));
      }
      const fx = B.slotFx[i] || {};
      const headIdx = B.spanHead[i];
      if (headIdx != null) {
        // continuation half of a multi-socket glyph — show the same glyph in it
        const hid = B.sockets[headIdx];
        const hg = glyph(hid);
        s.classList.add('filled', 'span-cont', 'color-' + hg.color);
        s.style.setProperty('--g-color', 'var(--' + hg.color + ')');
        const gv = el('div', 'socket-glyph');
        gv.appendChild(glyphVisual(hid));
        s.appendChild(gv);
        s.appendChild(el('div', 'span-link', '⟜'));
        s.appendChild(el('div', 'g-tip', '<b>' + hg.name + '</b><br>' + fmtDesc(hid, socketEnv(headIdx))));
        if (fx.cursed > 0) s.classList.add('cursed');   // a cursed half curses the whole glyph
        if (recallReady()) {
          s.classList.add('recallable');
          s.addEventListener('click', () => recallGlyph(headIdx, $('socket-row').children[headIdx]));
        }
      } else if (isPureLoop(i)) {
        s.classList.add('loopback');   // never holds a glyph
        syncPulse(s, 2400);
        if (fx.disabled > 0) {
          // a sealed loop stays visible but dormant — show the lock so the
          // player knows it won't replay this turn
          s.classList.add('disabled');
          const lb = el('div', 'slot-lock fx-badge', '⛔<span class="lock-turns">' + fx.disabled + '</span>');
          lb.appendChild(el('div', 'slot-fx-tip',
            '<b class="st-name">Sealed Socket</b>Shut tight by the enemy — this Loop will <b>not replay</b> the chain until it reopens.' +
            '<span class="sft-turns">' + fx.disabled + ' turn(s) remaining</span>'));
          s.appendChild(lb);
        }
      } else if (id) {
        const g = glyph(id);
        const span = g.slots || 1;
        s.classList.add('filled', 'color-' + g.color);
        if (span > 1) s.classList.add('span-head');
        s.style.setProperty('--g-color', 'var(--' + g.color + ')');
        const gv = el('div', 'socket-glyph');
        gv.appendChild(glyphVisual(id));
        s.appendChild(gv);
        const chip = letterChip(id);
        if (chip) s.appendChild(chip);
        const sEmp = empowerOf(id);
        if (sEmp > 0) s.appendChild(el('span', 'g-up g-up-power', '✦+' + sEmp));
        if (comboAdv(id) > 1) s.appendChild(el('span', 'g-up g-up-combo', '▲▲'));
        s.appendChild(el('div', 'g-tip', '<b>' + g.name + '</b>' + upgradeTipSuffix(id) + '<br>' + fmtDesc(id, socketEnv(i))));
        // cursed if this socket OR any continuation socket of this glyph is cursed
        let spanCursed = fx.cursed > 0;
        if (span > 1) {
          for (let j = i + 1; j < B.sockets.length; j++) {
            if (B.spanHead[j] === i && B.slotFx[j] && B.slotFx[j].cursed > 0) { spanCursed = true; break; }
          }
        }
        if (spanCursed) s.classList.add('cursed');
        if (recallReady()) {
          s.classList.add('recallable');
          s.addEventListener('click', () => recallGlyph(i, s));
        }
      } else if (fx.disabled > 0) {
        s.classList.add('disabled');
        const lb = el('div', 'slot-lock fx-badge', '⛔<span class="lock-turns">' + fx.disabled + '</span>');
        lb.appendChild(el('div', 'slot-fx-tip',
          '<b class="st-name">Sealed Socket</b>Shut tight by the enemy — you forge with <b>one fewer slot</b> until it reopens.' +
          '<span class="sft-turns">' + fx.disabled + ' turn(s) remaining</span>'));
        s.appendChild(lb);
      } else {
        s.classList.add('empty');
        if (fx.cursed > 0) s.classList.add('cursed');
        if (i === firstFree) { s.classList.add('next'); syncPulse(s, 1600); }
      }
      if (fx.cursed > 0) {
        const cb = el('div', 'slot-curse fx-badge', '☠<span class="lock-turns">' + fx.cursed + '</span>');
        cb.appendChild(el('div', 'slot-fx-tip',
          '<b class="st-name">Cursed Socket</b>Its effect still resolves, but is <b>mirrored</b>: any block or heal you gain here <b>also feeds the caster</b>, and any damage or burn <b>also recoils onto you</b>.' +
          '<span class="sft-turns">' + fx.cursed + ' turn(s) remaining</span>'));
        // insert BEFORE the glyph tip so hovering the curse badge suppresses it
        const gt = s.querySelector('.g-tip');
        if (gt) s.insertBefore(cb, gt); else s.appendChild(cb);
      }
      if (slotCountAt(i, 'devil') > 0) decorateDevilSocket(s, i);
      row.appendChild(s);
    });
    // the runes are THE centerpiece — on the first build of a battle they
    // materialize one by one instead of snapping in
    if (B.socketIntro) { B.socketIntro = false; revealSockets(); }
    syncCombatTip();   // the old socket nodes are gone — drop a stale panel
  }

  // ============================================================
  // PLACE / RECALL  (with fly + seat animations)
  // ============================================================
  function flyClone(fromRect, toEl, id, scaleTo, cb) {
    const tr = toEl.getBoundingClientRect();
    const a = Scale.toStage(fromRect.left + fromRect.width / 2, fromRect.top + fromRect.height / 2);
    const b = Scale.toStage(tr.left + tr.width / 2, tr.top + tr.height / 2);
    const clone = el('div', 'fly-clone');
    clone.style.setProperty('--g-color', 'var(--' + glyph(id).color + ')');
    const body = el('div', 'g-body');
    body.appendChild(glyphVisual(id));
    clone.appendChild(body);
    clone.style.left = a.x + 'px'; clone.style.top = a.y + 'px';
    clone.style.transform = 'translate(-50%,-50%) scale(1)';
    stage.appendChild(clone);
    requestAnimationFrame(() => {
      clone.style.transition = 'left .26s cubic-bezier(.3,.7,.25,1), top .26s cubic-bezier(.3,.7,.25,1), transform .26s';
      clone.style.left = b.x + 'px'; clone.style.top = b.y + 'px';
      clone.style.transform = 'translate(-50%,-50%) scale(' + (scaleTo || 0.7) + ')';
    });
    setTimeout(() => { clone.remove(); if (cb) cb(); }, 270);
  }

  function placeGlyph(handIdx, handEl) {
    if (B.resolving) return;
    const id = B.hand[handIdx];
    const span = glyph(id).slots || 1;
    const empty = firstFreeRun(span);
    if (empty === -1) return;
    SFX.click();   // the satisfying "select" click the moment a glyph is played
    const fromRect = (handEl.querySelector('.g-body') || handEl).getBoundingClientRect();
    B.hand.splice(handIdx, 1);
    // sticky junk (Dead Weight) is finally released once socketed
    if (glyph(id).sticky) {
      const si = B.stuck.indexOf(id);
      if (si !== -1) B.stuck.splice(si, 1);
    }
    B.sockets[empty] = id;
    for (let k = 1; k < span; k++) B.spanHead[empty + k] = empty;   // mark continuation slots
    renderHand(false);
    renderSockets();
    // Devil reaction: a craved glyph turns it happy (handled in render); the
    // WRONG glyph dropped on it throws a one-second frustrated fit
    for (let k = 0; k < span; k++) {
      const ci = empty + k;
      if (slotCountAt(ci, 'devil') > 0) {
        const d = B.devil && B.devil[ci];
        // only a glyph NO Devil craves draws a frustrated fit (cravings aren't
        // socket-locked — any craved glyph satisfies the socket it lands on)
        if (d && d.crave) {
          const db = baseOf(id);
          const cravedByAny = devilIdxs().some(k => { const dd = B.devil[k]; return dd && dd.crave && dd.crave === db; });
          if (!cravedByAny) devilFrustrate(ci);
        }
      }
    }
    // send one glyph flying into EACH socket the glyph occupies
    for (let k = 0; k < span; k++) {
      const slotIdx = empty + k;
      const socketEl = $('socket-row').children[slotIdx];
      if (!socketEl) continue;
      const gv = socketEl.querySelector('.socket-glyph');
      if (gv) gv.style.visibility = 'hidden';
      flyClone(fromRect, socketEl, id, 0.74, () => {
        if (gv) { gv.style.visibility = ''; gv.classList.add('seating'); }
        SFX.place(slotIdx);
      });
    }
    updateActButton();
    renderForecast(null);
  }

  function recallReady() {
    return root.CG.Game.state.blessings.recall && !B.recallUsed && !B.resolving;
  }
  function recallGlyph(socketIdx, socketEl) {
    if (!recallReady()) return;
    const id = B.sockets[socketIdx];
    if (!id) return;
    const fromRect = socketEl.getBoundingClientRect();
    B.sockets[socketIdx] = null;
    // release any continuation slots this glyph spanned
    for (let i = 0; i < B.spanHead.length; i++) if (B.spanHead[i] === socketIdx) B.spanHead[i] = null;
    B.hand.push(id);
    if (glyph(id).sticky && B.stuck.indexOf(id) === -1) B.stuck.push(id);
    B.recallUsed = true;
    SFX.recall();
    renderSockets();
    renderHand(false);
    const handEls = $('hand-row').children;
    const target = handEls[handEls.length - 1];
    if (target) {
      const toEl = target.querySelector('.g-body') || target;
      target.style.visibility = 'hidden';
      flyClone(fromRect, toEl, id, 1, () => {
        target.style.visibility = '';
        target.classList.add('returning');
      });
    }
    updateRecallBtn();
    updateActButton();
    renderForecast(null);
  }
  function updateRecallBtn() {
    const btn = $('btn-recall');
    if (!root.CG.Game.state.blessings.recall) { btn.classList.add('hidden'); return; }
    btn.classList.remove('hidden');
    btn.disabled = true;
    btn.dataset.tip = 'Click an equipped glyph to return it to your hand (once per turn).';
    btn.textContent = B.recallUsed ? '↺ Recall used' : '↺ Recall ready';
  }

  // ============================================================
  // POSITION HELPERS (stage-space)
  // ============================================================
  function center(elem) {
    const r = elem.getBoundingClientRect();
    return Scale.toStage(r.left + r.width / 2, r.top + r.height / 2);
  }
  // classify a CSS color string into an elemental "move type" so each attack
  // reads as a themed strike (fire/frost/venom/shadow/holy) instead of a generic orb
  function boltKind(color) {
    const c = (color || '').toLowerCase();
    if (c.indexOf('red') >= 0) return 'k-fire';
    if (c.indexOf('blue') >= 0) return 'k-frost';
    if (c.indexOf('green') >= 0) return 'k-venom';
    if (c.indexOf('purple') >= 0) return 'k-shadow';
    if (c.indexOf('gold') >= 0) return 'k-holy';
    return 'k-arc';
  }

  // The active beast's signature strike style. THIS — not the glyph's color —
  // drives what a player attack looks like, so the Troll always swings a blade
  // (never a fireball), the Ghoul always gnaws, the Kitsune always burns.
  function playerStrikeStyle() {
    const id = B.monster && B.monster.id;
    // only the Kitsune THROWS something — its fireball flies across. The melee
    // beasts strike directly over the foe (their slash / bite just appears there).
    if (id === 'kitsune') return { kind: 'k-fire', color: '#ff7a2a', ranged: true };
    if (id === 'ghoul') return { kind: 'k-gnaw', color: '#a6e86a', ranged: false };
    return { kind: 'k-blade', color: '#dbe7f5', ranged: false };   // troll & default
  }

  // a directional energy strike: muzzle flash -> oriented comet streak -> impact
  // burst. This replaces the old "thrown orb"; same signature + timing so every
  // call site (hitTargets / boltAll / boltP / combo sparks) upgrades at once.
  // Pass `kind` to force a style (used by player attacks, which are keyed to the
  // monster); otherwise the visual is inferred from the color (self-buffs etc.).
  function bolt(from, to, color, onHit, kind) {
    const dx = to.x - from.x, dy = to.y - from.y;
    const ang = Math.atan2(dy, dx) * 180 / Math.PI;
    kind = kind || boltKind(color);
    // a quick charge flash where the strike launches
    fxRing(from, color, 320, 'fx-ring-soft');
    const proj = el('div', 'atk-proj ' + kind);
    proj.style.setProperty('--atk-color', color);
    proj.style.setProperty('--ang', ang + 'deg');
    proj.style.left = from.x + 'px'; proj.style.top = from.y + 'px';
    stage.appendChild(proj);
    // force a synchronous layout so the START position is committed before we
    // flip to the END — otherwise the browser can coalesce both writes and the
    // projectile teleports straight onto the target instead of flying.
    void proj.offsetWidth;
    proj.style.transition = 'left .2s cubic-bezier(.5,.02,.65,1), top .2s cubic-bezier(.5,.02,.65,1)';
    proj.style.left = to.x + 'px'; proj.style.top = to.y + 'px';
    setTimeout(() => {
      proj.remove();
      boltImpact(to, color, kind);
      if (onHit) onHit();
    }, 255);
  }

  // the themed splash where a strike lands
  function boltImpact(to, color, kind) {
    fxRing(to, color, 520);
    const core = fxSpawn(to, 'atk-impact ' + kind, '', 360);
    core.style.setProperty('--atk-color', color);
    if (kind === 'k-fire') fxMotes(to, 9, '#ff8a3a', 'fx-mote-spark', 84);
    else if (kind === 'k-blade') fxMotes(to, 7, '#eaf4ff', 'fx-mote-spark', 70);
    else if (kind === 'k-gnaw') fxMotes(to, 7, '#cdeeb0', 'fx-mote-spark', 64);
    else if (kind === 'k-frost') fxMotes(to, 8, '#c7ecff', 'fx-mote-shard', 78);
    else if (kind === 'k-venom') fxMotes(to, 8, '#9be86a', 'fx-mote-spark', 74);
    else if (kind === 'k-shadow') fxMotes(to, 9, '#c98bff', 'fx-mote-spark', 80);
    else if (kind === 'k-holy') fxMotes(to, 8, '#ffe9a8', 'fx-mote-spark', 84);
    else fxMotes(to, 7, color, 'fx-mote-spark', 72);
  }
  function floatText(pos, text, kind) {
    const f = el('div', 'float-text ' + kind, text);
    f.style.top = pos.y + 'px';
    stage.appendChild(f);
    const margin = 16;
    const stageW = stage.offsetWidth || 1920;
    // the float-up keyframe momentarily scales the text to ~1.2x, so account for
    // that peak when keeping it on-stage
    const peak = 1.24;
    const half = (f.offsetWidth / 2) * peak;
    // near the bottom-left player UI the centered text (and its bounce) would
    // spill past the screen edge — left-anchor it there so it grows rightward
    // and is never clipped, while still sitting cleanly over the portrait
    if (pos.x - half < margin) {
      f.classList.add('float-edge-left');
      f.style.left = margin + 'px';
    } else {
      f.style.left = Math.min(stageW - half - margin, pos.x) + 'px';
    }
    setTimeout(() => f.remove(), 1100);
  }
  let shakeClear = null;
  function shake(level) {
    stage.classList.remove('stage-shake', 'stage-shake-2', 'stage-shake-3');
    void stage.offsetWidth;
    stage.classList.add(level >= 3 ? 'stage-shake-3' : level === 2 ? 'stage-shake-2' : 'stage-shake');
    // strip the class once the shake is over so nothing lingers on #stage when we
    // move on to the reward screen (prevents stale GPU layers on mobile)
    clearTimeout(shakeClear);
    const dur = level >= 3 ? 700 : level === 2 ? 560 : 460;
    shakeClear = setTimeout(() => {
      stage.classList.remove('stage-shake', 'stage-shake-2', 'stage-shake-3');
    }, dur);
  }
  // a brief full-stage light flash for big, dramatic moments (boss deaths)
  function deathFlash(maxA, dur, color) {
    const f = el('div', 'death-flash');
    if (color) f.style.background = 'radial-gradient(circle at 50% 46%, ' + color + ', transparent 72%)';
    stage.appendChild(f);
    f.animate(
      [{ opacity: 0 }, { opacity: maxA, offset: 0.12 }, { opacity: 0 }],
      { duration: dur, easing: 'cubic-bezier(.2,.6,.3,1)' }
    ).onfinish = () => f.remove();
  }

  // ============================================================
  // COMBAT FX — reusable, themed flourishes for every action
  // ============================================================
  function fxSpawn(pos, cls, html, life) {
    const f = el('div', 'cfx ' + cls, html || '');
    f.style.left = pos.x + 'px'; f.style.top = pos.y + 'px';
    stage.appendChild(f);
    setTimeout(() => f.remove(), life || 900);
    return f;
  }
  function fxRing(pos, color, life, cls) {
    const r = fxSpawn(pos, 'fx-ring ' + (cls || ''), '', life || 720);
    if (color) r.style.setProperty('--fx-color', color);
    return r;
  }
  // `area` (optional {w,h}) scatters each mote's ORIGIN across a box around `pos`
  // instead of all of them erupting from a single point
  function fxMotes(pos, n, color, cls, spread, area) {
    spread = spread || 80;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = spread * (0.4 + Math.random() * 0.7);
      const sp = area
        ? { x: pos.x + (Math.random() - 0.5) * area.w, y: pos.y + (Math.random() - 0.5) * area.h }
        : pos;
      const m = fxSpawn(sp, 'fx-mote ' + (cls || ''), '', 950);
      if (color) m.style.setProperty('--fx-color', color);
      m.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      m.style.setProperty('--dy', (Math.sin(ang) * dist - 24) + 'px');
      m.style.animationDelay = (Math.random() * 180) + 'ms';
    }
  }
  // measure an element's box in stage space (for scattering fx across it)
  function stageBox(elm) {
    const r = elm.getBoundingClientRect();
    const tl = Scale.toStage(r.left, r.top), br = Scale.toStage(r.right, r.bottom);
    return { w: br.x - tl.x, h: br.y - tl.y };
  }
  function flashEl(elm, cls, ms) {
    if (!elm) return;
    elm.classList.remove(cls); void elm.offsetWidth; elm.classList.add(cls);
    setTimeout(() => elm.classList.remove(cls), ms || 500);
  }
  function topOf(elm, dy) { return offset(center(elm), 0, dy == null ? -34 : dy); }

  // ---- normal attack: a per-character impact when the player deals damage ----
  function playerLunge() {
    const now = (root.performance || Date).now();
    if (B._lastLunge && now - B._lastLunge < 240) return;   // don't jitter on AoE
    B._lastLunge = now;
    // lunge the WHOLE emblem toward the foe (up-right). We animate the outer
    // container so the portrait's own centering transform is left intact.
    const t = $('player-monster');
    if (!t || typeof t.animate !== 'function') return;
    t.animate([
      { transform: 'translate(0,0) scale(1)' },
      { transform: 'translate(34px,-24px) scale(1.05)', offset: 0.3 },
      { transform: 'translate(0,0) scale(1)' }
    ], { duration: 360, easing: 'cubic-bezier(.3,.8,.3,1)' });
  }
  // ---- taking a hit: the whole emblem recoils down-left, away from the foes ----
  function playerHitReact() {
    const t = $('player-monster');
    if (!t || typeof t.animate !== 'function') return;
    t.animate([
      { transform: 'translate(0,0) rotate(0)' },
      { transform: 'translate(-15px,7px) rotate(-2.6deg)', offset: 0.18 },
      { transform: 'translate(9px,-2px) rotate(1.5deg)', offset: 0.46 },
      { transform: 'translate(-5px,2px) rotate(-1deg)', offset: 0.72 },
      { transform: 'translate(0,0) rotate(0)' }
    ], { duration: 440, easing: 'cubic-bezier(.3,.7,.4,1)' });
  }
  function monsterStrikeFx(en) {
    if (!en || !en.dom) return;
    const p = center(en.dom);
    playerLunge();
    const id = B.monster && B.monster.id;
    if (id === 'ghoul') {
      // a snapping bite — two fang rows chomp shut over the foe
      const bite = fxSpawn(p, 'fx-bite', '<i class="jaw top"></i><i class="jaw bot"></i><i class="chomp"></i>', 600);
      bite.style.setProperty('--ang', (Math.random() * 24 - 12) + 'deg');
      fxMotes(p, 6, '#cdeeb0', 'fx-mote-spark', 58);
    } else if (id === 'kitsune') {
      // clean, all-warm foxfire burst (no stray cool tones)
      fxSpawn(p, 'fx-foxfire', '<i></i><i></i>', 600);
      fxRing(p, '#ff7a2a', 500, 'fx-ring-soft');
      fxMotes(p, 10, '#ffb347', 'fx-mote-spark', 80);
    } else {
      // troll & default: a katana-style blade slash trails across the foe
      const slash = fxSpawn(p, 'fx-slash', '<i class="trail"></i><i class="edge"></i>', 460);
      slash.style.setProperty('--ang', (-34 + (Math.random() * 20 - 10)) + 'deg');
      fxMotes(p, 6, '#eaf4ff', 'fx-mote-spark', 60);
    }
  }

  // a real-fire particle system: a dense cloud of soft, blurred embers that are
  // born white-hot at the base and COOL as they rise (white→yellow→orange→red→
  // ember→smoke), drifting on a little turbulence. Additive (screen) blending so
  // overlapping particles bloom into a continuous flame body instead of distinct
  // cartoon "tongues". Topped with fast sparks, a flickering heat-glow and smoke.
  function flameBurst(p, opts) {
    opts = opts || {};
    const scale = opts.scale || 1;
    const n = Math.round((opts.count || 22) * (opts.dense === false ? 1 : 1));
    const spread = opts.spread || 26;

    // low flickering heat-glow at the base
    if (opts.glow !== false) {
      const glow = fxSpawn(offset(p, 0, 6), 'fx-fglow', '', 760);
      glow.style.setProperty('--gs', (62 * scale).toFixed(0) + 'px');
    }

    // the flame body — many soft cooling embers
    for (let i = 0; i < n; i++) {
      // bias emission toward the center (hotter core, thinner edges)
      const t = Math.random();
      const ox = (Math.random() * 2 - 1) * spread * (0.35 + t * 0.65);
      const fp = fxSpawn(offset(p, ox, 6 + Math.random() * 12), 'fx-fp', '', 1500);
      const sz = (9 + Math.random() * 22) * scale * (1 - Math.abs(ox) / (spread * 1.6) * 0.4);
      fp.style.setProperty('--fs', sz.toFixed(1) + 'px');
      fp.style.setProperty('--fb', Math.max(2, sz * 0.24).toFixed(1) + 'px');
      fp.style.setProperty('--ry', (-(64 + Math.random() * 120) * scale).toFixed(0) + 'px');
      fp.style.setProperty('--wx', ((Math.random() * 2 - 1) * 12).toFixed(0) + 'px');
      fp.style.setProperty('--wx2', ((Math.random() * 2 - 1) * 24).toFixed(0) + 'px');
      fp.style.setProperty('--fd', (0.62 + Math.random() * 0.6).toFixed(2) + 's');
      fp.style.animationDelay = Math.round(Math.random() * 300) + 'ms';
    }

    // bright fast sparks shooting up out of the flame
    const sparks = opts.sparks == null ? Math.round(6 * scale) : opts.sparks;
    for (let s = 0; s < sparks; s++) {
      const sp = fxSpawn(offset(p, (Math.random() * 2 - 1) * spread * 0.7, 4), 'fx-spark', '', 1200);
      sp.style.setProperty('--ry', (-(120 + Math.random() * 130) * scale).toFixed(0) + 'px');
      sp.style.setProperty('--wx', ((Math.random() * 2 - 1) * 34).toFixed(0) + 'px');
      sp.style.setProperty('--fd', (0.55 + Math.random() * 0.5).toFixed(2) + 's');
      sp.style.animationDelay = Math.round(Math.random() * 280) + 'ms';
    }

    // a curl of smoke lifting off the top
    if (opts.smoke !== false) {
      for (let k = 0; k < (opts.smoke || 2); k++) {
        const sm = fxSpawn(offset(p, (Math.random() * 2 - 1) * spread * 0.5, -8), 'fx-smoke', '', 1500);
        sm.style.setProperty('--sdx', ((Math.random() * 2 - 1) * 20).toFixed(0) + 'px');
        sm.style.animationDelay = (220 + Math.random() * 280) + 'ms';
      }
    }
  }

  // ---- status applications & ticks ----
  function burnApplyFx(elm) {
    if (!elm) return;
    flameBurst(offset(center(elm), 0, 12), { count: 30, scale: 1.15, spread: 28, sparks: 8, smoke: 2 });
  }
  function burnTickFx(elm) {
    if (!elm) return;
    flameBurst(offset(center(elm), 0, 14), { count: 16, scale: 0.82, spread: 22, sparks: 4, smoke: 1, glow: false });
    flashEl(elm, 'fx-burnflash', 480);
  }
  function shieldGainFx(elm) { if (!elm) return; const p = center(elm); fxSpawn(p, 'fx-shield', '', 760); fxRing(p, '#5ab6ff', 700); }
  function weakFx(elm) { if (!elm) return; fxSpawn(topOf(elm), 'fx-weak', '▼', 820); flashEl(elm, 'fx-weakflash', 640); }
  function scareFx(elm) { if (!elm) return; const p = topOf(elm); fxSpawn(p, 'fx-scare', '☠', 840); fxRing(p, '#c77bff', 640, 'fx-ring-soft'); flashEl(elm, 'fx-scareflash', 520); }
  function leechApplyFx(elm) { if (!elm) return; const p = topOf(elm, -20); fxSpawn(p, 'fx-leech', '🩸', 820); fxRing(p, '#d33a46', 640, 'fx-ring-soft'); }
  function leechTickFx(fromEl, toEl) {
    if (!fromEl) return;
    if (toEl) bolt(center(fromEl), center(toEl), '#d33a46');
    fxMotes(topOf(fromEl, -6), 5, '#d33a46', 'fx-mote-spark', 50);
  }
  function healFx(elm) { if (!elm) return; const p = center(elm); fxSpawn(p, 'fx-heal', '✚', 920); fxRing(p, '#7ee07a', 760, 'fx-ring-soft'); fxMotes(p, 9, '#8ef58a', 'fx-mote-rise', 72); }
  function strengthFx(elm) { if (!elm) return; const p = topOf(elm, -52); fxSpawn(p, 'fx-strength', '⚔', 840); fxMotes(p, 6, '#ff6a4a', 'fx-mote-rise', 48); flashEl(elm, 'fx-strflash', 520); }
  function resilienceFx(elm) { if (!elm) return; const p = topOf(elm, -52); fxSpawn(p, 'fx-resil', '🛡', 840); fxMotes(p, 6, '#7fd0ff', 'fx-mote-rise', 48); }

  // ---- slot effects ----
  function slotCurseFx(socketEl) { if (!socketEl) return; const p = center(socketEl); fxSpawn(p, 'fx-curse', '☠', 920); fxRing(p, '#c45cff', 800); flashEl(socketEl, 'fx-curseflash', 760); }
  function slotBanishFx(socketEl) { if (!socketEl) return; const p = center(socketEl); fxSpawn(p, 'fx-banish', '⛔', 840); fxRing(p, '#9aa0aa', 720); flashEl(socketEl, 'fx-banishflash', 640); }
  // a glyph kept by a Hold socket: it freezes, shimmers teal, and floats a tag
  function holdFx(socketEl) {
    if (!socketEl) return;
    const p = center(socketEl);
    floatText(offset(p, 0, -10), 'Held ⏸', 'shield');
    fxRing(p, '#6fe0cf', 700);
    fxMotes(p, 8, '#9ff0e0', 'fx-mote-rise', 52);
    const gv = socketEl.querySelector('.socket-glyph');
    if (gv && gv.animate) gv.animate([
      { transform: 'scale(1)', filter: 'brightness(1)' },
      { transform: 'scale(1.16)', filter: 'brightness(1.5) drop-shadow(0 0 14px #6fe0cf)', offset: 0.4 },
      { transform: 'scale(1)', filter: 'brightness(1)' }
    ], { duration: 640, easing: 'cubic-bezier(.3,1.4,.4,1)' });
  }
  // an Empower socket bolstering a neighbouring glyph (+N)
  function empowerSpark(socketEl, n) {
    if (!socketEl) return;
    const p = center(socketEl);
    floatText(offset(p, 0, -34), '⊕ +' + n, 'status');
    fxRing(p, '#ffe6a8', 540);
    fxMotes(p, 6, '#ffe6a8', 'fx-mote-rise', 46);
  }
  // a Repeat socket multiplying its glyph (×mult)
  function repeatPop(socketEl, mult) {
    if (!socketEl) return;
    const p = center(socketEl);
    floatText(offset(p, 0, -34), '×' + mult, 'status');
    const gv = socketEl.querySelector('.socket-glyph');
    if (gv && gv.animate) gv.animate([
      { transform: 'scale(1)' },
      { transform: 'scale(1.2) rotate(-4deg)', offset: 0.45 },
      { transform: 'scale(1)' }
    ], { duration: 460, easing: 'cubic-bezier(.3,1.5,.4,1)' });
  }

  // ---- runes: dissolve out after a chain; materialize at battle start ----
  function clearSocketsExit() {
    const row = $('socket-row');
    if (!row) return Promise.resolve();
    const glyphs = Array.from(row.querySelectorAll('.socket .socket-glyph'));
    if (!glyphs.length) return Promise.resolve();
    let any = false;
    glyphs.forEach((gv, i) => {
      if (!gv || gv.dataset.exiting) return;
      gv.dataset.exiting = '1'; any = true;
      gv.style.animationDelay = (i * 55) + 'ms';
      gv.classList.add('rune-spend-out');
      const socket = gv.closest('.socket');
      if (socket) {
        const p = center(socket);
        const box = stageBox(socket);
        const area = { w: box.w * 0.92, h: box.h * 0.92 };
        setTimeout(() => fxMotes(p, 14, '#f5c969', 'fx-mote-rise', 48, area), i * 55);
      }
    });
    if (any && SFX.recall) SFX.recall();
    return wait(420 + glyphs.length * 55).then(() => {
      // truly empty the runes so an enemy curse/seal mid-turn can't re-show spent glyphs
      B.sockets = new Array(B.monster.sockets).fill(null);
      B.spanHead = new Array(B.monster.sockets).fill(null);
      renderSockets();
    });
  }
  function revealSockets() {
    const row = $('socket-row');
    if (!row) return;
    Array.from(row.children).forEach((s, i) => {
      s.style.setProperty('--ri', i);
      s.classList.remove('rune-appear'); void s.offsetWidth; s.classList.add('rune-appear');
      setTimeout(() => s.classList.remove('rune-appear'), 1300 + i * 90);
    });
  }

  // ---- Alphabet combo feedback: heard, seen, felt ----
  function comboFlash(sEl, prevSEl, comboLen, bonus) {
    if (!sEl) return;
    const here = center(sEl);
    SFX.combo(comboLen - 1);
    // a spark leaps from the previous linked rune into this one
    if (prevSEl) bolt(center(prevSEl), here, 'var(--gold)');
    // the rune itself flares and snaps with the combo
    sEl.classList.remove('combo-hit'); void sEl.offsetWidth; sEl.classList.add('combo-hit');
    // escalating popup
    const lvl = Math.min(comboLen, 6);
    const pop = el('div', 'combo-pop lvl-' + lvl);
    pop.innerHTML = '<span class="cp-x">×' + comboLen + '</span><span class="cp-b">+' + bonus + ' power</span>';
    pop.style.left = here.x + 'px'; pop.style.top = (here.y - 96) + 'px';
    stage.appendChild(pop);
    setTimeout(() => pop.remove(), 900);
    if (comboLen >= 3) shake();
  }
  function comboFinale(maxCombo) {
    SFX.comboFinish(maxCombo);
    shake();
    const f = el('div', 'combo-finale');
    f.innerHTML = '<span class="cf-label">COMBO</span><span class="cf-num">×' + maxCombo + '</span>';
    stage.appendChild(f);
    setTimeout(() => f.remove(), 1300);
  }

  // ---- Charge Attack: the Big-Hit payoff (Troll line) ----
  // Damage Charges and rider charges pile up across a chain; at the end they
  // erupt as ONE AOE that strikes every foe at once. Strength is baked into each
  // charge as it is applied, so detonation deals the raw accumulated pool.
  function chargeHasContent() {
    const c = B.charge || {};
    return (c.dmg || 0) > 0 || (c.weak || 0) > 0 || (c.scare || 0) > 0 || (c.burn || 0) > 0;
  }
  function chargeTotal() {
    const c = B.charge || {};
    return (c.dmg || 0) + (c.weak || 0) + (c.scare || 0) + (c.burn || 0);
  }

  // ---- the Charge Orb: a growing ball of stored power on the left of the field.
  // It swells as the chain feeds it, drinks each incoming charge with a flowing
  // mote, then overloads and unleashes the AOE at the end of the chain. ----
  function chargeOrbEl() {
    let o = $('charge-orb');
    if (!o) {
      o = el('div', 'charge-orb');
      o.id = 'charge-orb';
      o.innerHTML =
        '<div class="co-glow"></div>' +
        '<div class="co-scale">' +
          '<div class="co-ring"></div>' +
          '<div class="co-ball"><span class="co-core"></span><span class="co-spark"></span></div>' +
        '</div>' +
        '<div class="co-num"><span class="co-val">0</span></div>';
      $('screen-battle').appendChild(o);
    }
    return o;
  }
  function chargeOrbCenter() {
    const o = $('charge-orb');
    if (!o) return null;
    return center(o.querySelector('.co-ball') || o);
  }
  // re-read the pool and size the orb to match (smooth grow via CSS transition)
  function refreshChargeOrb() {
    const total = chargeTotal();
    const o = chargeOrbEl();
    const lvl = Math.min(6, Math.floor(total / 4));
    o.className = 'charge-orb show lvl-' + lvl;
    const scale = Math.min(2.7, 1 + total * 0.07);
    o.style.setProperty('--co-scale', scale.toFixed(3));
    o.querySelector('.co-val').textContent = (B.charge && B.charge.dmg) || total;
    return o;
  }
  // a single charge streaks from where it was earned into the orb, which drinks it
  function flowChargeInto(fromPos) {
    const o = refreshChargeOrb();
    const to = chargeOrbCenter();
    if (!to) return;
    const mote = el('div', 'charge-flow');
    mote.style.left = fromPos.x + 'px';
    mote.style.top = fromPos.y + 'px';
    stage.appendChild(mote);
    // arc up-and-over so it reads as energy being drawn across the field
    const cx = (fromPos.x + to.x) / 2 + (Math.random() * 120 - 60);
    const cy = Math.min(fromPos.y, to.y) - (110 + Math.random() * 80);
    const dur = 360 + Math.random() * 130;
    mote.animate([
      { transform: 'translate(-50%,-50%) scale(0.7)', opacity: 0.2, offset: 0 },
      { opacity: 1, offset: 0.18 },
      { transform: 'translate(-50%,-50%) translate(' + (cx - fromPos.x) + 'px,' + (cy - fromPos.y) + 'px) scale(1.25)', opacity: 1, offset: 0.55 },
      { transform: 'translate(-50%,-50%) translate(' + (to.x - fromPos.x) + 'px,' + (to.y - fromPos.y) + 'px) scale(0.35)', opacity: 0.85, offset: 1 }
    ], { duration: dur, easing: 'cubic-bezier(.42,.05,.5,1)', fill: 'forwards' }).onfinish = () => {
      mote.remove();
      o.classList.remove('drink'); void o.offsetWidth; o.classList.add('drink');
    };
  }
  function clearChargeOrb(immediate) {
    const o = $('charge-orb');
    if (!o) return;
    if (immediate) { o.remove(); return; }
    o.classList.remove('show'); o.classList.add('spent');
    setTimeout(() => { if (o.parentNode) o.remove(); }, 520);
  }

  async function detonateCharge(maxCombo) {
    if (!B.charge) B.charge = { dmg: 0, weak: 0, scare: 0, burn: 0 };
    const c = B.charge;
    if (chargeHasContent()) {
      const foes = alive();
      if (foes.length) {
        const o = refreshChargeOrb();
        const orbPos = chargeOrbCenter();
        banner('Charge Attack', 760);
        // wind-up: the orb overloads, straining at the seams
        o.classList.add('overload');
        SFX.comboFinish(Math.max(3, maxCombo));
        shake();
        await wait(440);
        // unleash: a lance of light from the orb to every foe, then it bursts
        foes.forEach(e => { if (e.alive && orbPos) boltP(orbPos, center(e.dom), 'var(--gold)'); });
        if (orbPos) {
          fxRing(orbPos, '#ffce5e', 660);
          fxMotes(orbPos, 22, '#ffd070', 'fx-mote-spark', 140);
        }
        await wait(170);
        for (const e of foes) {
          if (!e.alive) continue;
          if ((c.dmg || 0) > 0) applyDamage(e, c.dmg, { strength: false, charge: true });
          if ((c.weak || 0) > 0) { e.weak = (e.weak || 0) + c.weak; weakFx(e.dom); }
          if ((c.scare || 0) > 0) { e.scare = (e.scare || 0) + c.scare; e.scareTurns = Math.max(e.scareTurns || 0, 3); scareFx(e.dom); }
          if ((c.burn || 0) > 0) addBurn(e, c.burn);
        }
        refreshAll();
        await wait(220);
      }
    }
    // Eternal Charge (All-Knowing Colossus): combo 5+ keeps the whole state alive
    // to snowball into next turn; otherwise the hoard is spent and resets to empty.
    if (hasPassive('eternalcharge') && maxCombo >= 5 && chargeHasContent()) {
      const o = chargeOrbEl();
      o.classList.remove('overload');
      o.classList.add('held');
      floatText(offset(chargeOrbCenter() || playerPos(), 0, -90), 'Charge held!', 'status');
    } else {
      B.charge = { dmg: 0, weak: 0, scare: 0, burn: 0 };
      clearChargeOrb();
    }
  }

  // ---- live combo meter (right of the field, ticks up as the chain fires) ----
  function comboMeterEl() {
    let m = $('combo-meter');
    if (!m) {
      m = el('div', 'combo-meter');
      m.id = 'combo-meter';
      m.innerHTML =
        '<div class="cm-flames"></div>' +
        '<div class="cm-label">COMBO</div>' +
        '<div class="cm-num"><span class="cm-x">×</span><span class="cm-val">1</span></div>' +
        '<div class="cm-bonus">+0 power</div>';
      $('screen-battle').appendChild(m);
    }
    return m;
  }
  function showComboMeter(len, bonus) {
    const m = comboMeterEl();
    const lvl = Math.min(len, 6);
    m.className = 'combo-meter show lvl-' + lvl;
    m.querySelector('.cm-val').textContent = len;
    m.querySelector('.cm-bonus').textContent = '+' + bonus + ' power';
    // a quick bump every time the counter ticks up
    m.classList.remove('bump'); void m.offsetWidth; m.classList.add('bump');
  }
  function hideComboMeter(immediate) {
    const m = $('combo-meter');
    if (!m) return;
    if (immediate) { m.className = 'combo-meter'; return; }
    m.classList.add('fade');
    setTimeout(() => { if (m.classList.contains('fade')) m.className = 'combo-meter'; }, 520);
  }

  // ============================================================
  // TARGETING RULES (never player-chosen)
  // ============================================================
  function alive() { return B.enemies.filter(e => e.alive); }
  function targetFirst() { const a = alive(); return a.length ? [a[0]] : []; }
  function targetAll() { return alive(); }
  function targetLowest() {
    const a = alive();
    if (!a.length) return [];
    return [a.slice().sort((x, y) => x.hp - y.hp)[0]];
  }
  function targetHighest() {
    const a = alive();
    if (!a.length) return [];
    return [a.slice().sort((x, y) => y.hp - x.hp)[0]];
  }
  function targetRandom() { const a = alive(); return a.length ? [a[Math.floor(Math.random() * a.length)]] : []; }
  // center of the formation; if there's no exact middle, default to the last enemy
  function targetCenter() {
    const a = alive();
    if (!a.length) return [];
    return a.length % 2 === 1 ? [a[(a.length - 1) / 2]] : [a[a.length - 1]];
  }

  // ============================================================
  // DETONATE — the hero moment
  // ============================================================
  async function detonate() {
    if (B.resolving || B.ended || B.itemBusy) return;
    const placed = B.sockets.filter(Boolean);

    B.resolving = true;
    updateActButton();
    updateRecallBtn();
    renderSockets();
    renderHand(false);
    renderForecast(null);   // the dry-run bows out — the real chain takes the stage
    // Act commits the chain — it should feel like an ignition, not a hit.
    // The screenshake/impact is reserved for actual damage landing.
    if (placed.length) SFX.act();
    await wait(placed.length ? 250 : 60);

    // expand the sockets into an ordered resolution sequence honoring slot types.
    // Loopback replays the prior glyph steps; Repeat duplicates its glyph; Devil
    // is a non-effect "devour" step. A multi-socket glyph triggers the effect of
    // EVERY slot it covers, and hybrid sockets stack: every INSTANCE of a special
    // type counts (2× Repeat = 4 resolutions, 2× Clone = 2 copies, …).
    const seq = [];          // { id, slot, covered, type, replay?, repeat2?, holdAny?, cloneCount?, catalystCount? }
    const baseSteps = [];    // original glyph steps, for Loopback replay
    for (let i = 0; i < B.sockets.length; i++) {
      const id = B.sockets[i];
      // a pure-Loopback socket holds no glyph; each Loop instance replays the
      // chain so far once (a sealed loop stays dormant this turn)
      if (!id && B.spanHead[i] == null && isPureLoop(i)) {
        if (!slotDisabled(i)) {
          const loops = slotCountAt(i, 'loopback');
          for (let L = 0; L < loops; L++) {
            baseSteps.forEach(st => seq.push({ id: st.id, slot: st.slot, covered: st.covered, type: 'glyph', replay: true }));
          }
        }
        continue;
      }
      if (!id) continue;   // empty slot, or a multi-socket continuation
      // every socket this glyph occupies (head + continuations)
      const covered = [i];
      for (let j = i + 1; j < B.sockets.length; j++) if (B.spanHead[j] === i) covered.push(j);
      const countAcross = t => covered.reduce((n, ci) => n + slotCountAt(ci, t), 0);
      const step = {
        id, slot: i, covered, type: 'glyph',
        holdAny: countAcross('hold') > 0,
        cloneCount: countAcross('clone'),
        catalystCount: countAcross('catalyst'),
        devilSlots: covered.filter(ci => slotCountAt(ci, 'devil') > 0)   // Devil sockets this glyph fills
      };
      seq.push(step); baseSteps.push(step);
      // Repeat instances stack: a glyph covering N Repeats resolves 2×N times
      // (1 → 2×, 2 → 4×, 3 → 6×). We already pushed the genuine step once,
      // so add (2×N − 1) extra copies; the extras carry repeat2 so slot
      // side-effects only fire on the original placement.
      const repeatCount = countAcross('repeat');
      if (repeatCount > 0) {
        const extra = 2 * repeatCount - 1;
        for (let r = 0; r < extra; r++) {
          const s2 = Object.assign({}, step, { repeat2: true });
          seq.push(s2); baseSteps.push(s2);
        }
      }
      // hybrid Loop instance(s) riding on a FILLED socket: after this glyph (and
      // its repeats), each instance replays the whole chain so far once
      const loopHere = countAcross('loopback');
      if (loopHere > 0 && !slotDisabled(i)) {
        const snapshot = baseSteps.slice();
        for (let L = 0; L < loopHere; L++) {
          snapshot.forEach(st => seq.push({ id: st.id, slot: st.slot, covered: st.covered, type: 'glyph', replay: true }));
        }
      }
    }

    // Mirror twist: only when EVERY socket on the board holds a Mirror —
    // a full board of mirrors replays your previous turn's genuine actions.
    const isMirror = s => baseOf(glyph(s.id).cloneOf || s.id) === 'mirror';
    const allMirror = seq.length > 0 && seq.every(isMirror) && freeSocketCount() === 0;
    let runSeq = seq;
    let recordPlays = true;
    if (allMirror && B.lastTurnPlays.length) {
      recordPlays = false;
      banner('Hall of Mirrors', 900);
      runSeq = B.lastTurnPlays.map((id, idx) => {
        const host = baseSteps[Math.min(idx, baseSteps.length - 1)] || baseSteps[0];
        return { id, slot: host ? host.slot : 0, type: 'normal', replay: true };
      });
    }

    // every step drives count/order context (a devoured glyph still resolves in-chain)
    const fxSteps = runSeq.slice();
    const counts = {};
    fxSteps.forEach(s => { const b = baseOf(s.id); counts[b] = (counts[b] || 0) + 1; });
    const totalRed = fxSteps.filter(s => glyph(s.id).color === 'red').length;
    B.redThisTurn = totalRed;
    B.blueThisTurn = fxSteps.filter(s => glyph(s.id).color === 'blue').length;
    if (recordPlays && baseSteps.length) B.lastTurnPlays = baseSteps.map(s => s.id);

    // Empower slots bolster the glyphs resolved immediately before and after
    // them (+1 each) — hybrid sockets stack, so 2× Empower grants +2.
    const empBonus = new Array(runSeq.length).fill(0);
    for (let k = 0; k < runSeq.length; k++) {
      const cov = runSeq[k].covered || [runSeq[k].slot];
      const empCount = cov.reduce((n, ci) => n + slotCountAt(ci, 'empower'), 0);
      if (empCount > 0) {
        if (k - 1 >= 0) empBonus[k - 1] += empCount;
        if (k + 1 < runSeq.length) empBonus[k + 1] += empCount;
      }
    }
    // Shimmering Orb: on resolve, every glyph is empowered by the count of
    // distinct colors woven through the chain.
    if (root.CG.Game.state.blessings.shimmer && runSeq.length) {
      const shimmer = new Set(runSeq.map(s => glyph(s.id).color)).size;
      for (let k = 0; k < empBonus.length; k++) empBonus[k] += shimmer;
    }

    // "Played last" effects (e.g. Rake's Leech payoff) key off the last glyph the
    // player GENUINELY placed — not a Repeat echo, Loopback replay, or any trailing
    // empty/special socket after it. Find that step so the bonus still fires when the
    // chain ends early with empty sockets behind the final glyph.
    let lastGenuineIdx = -1;
    for (let gi = runSeq.length - 1; gi >= 0; gi--) {
      if (!runSeq[gi].replay && !runSeq[gi].repeat2) { lastGenuineIdx = gi; break; }
    }

    let prevId = null, chainPos = 0, fxIndex = 0, pendingCatalyst = [];
    B._devilRewards = [];        // boons banked this chain, paid out as their own finale
    B.lastMirrorTarget = null;   // resets each detonation; tracks what Mirrors are echoing
    let comboLen = 0, comboPrev = null, maxCombo = 0, prevComboEl = null;
    // Lingering Cadence: a combo number carried from last turn seeds the first
    // fresh chain (the letters reset, but the count keeps climbing).
    let comboCarry = hasPassive('lingeringCadence') ? (B.comboCarry || 0) : 0;
    let comboSeeded = false;
    B.comboNow = 0;
    for (let k = 0; k < runSeq.length; k++) {
      const ev = runSeq[k];
      const slot = ev.slot;
      const sEl = $('socket-row').children[slot];
      const coveredEls = (ev.covered || [slot]).map(ci => $('socket-row').children[ci]).filter(Boolean);

      // ----- Devil feed: a craved glyph offered to ANY Devil socket -----
      // Cravings aren't socket-locked. A glyph counts as "craved" if ANY Devil
      // this turn wants it; offering such a glyph to a Devil socket sates the
      // Devil sitting on THAT socket and pays out THAT socket's own boon.
      const devilFeeds = [];
      if (!ev.replay && !ev.repeat2 && ev.devilSlots && ev.devilSlots.length) {
        const fb = baseOf(ev.id);
        const isCraved = devilIdxs().some(k => { const d = B.devil[k]; return d && d.crave && d.crave === fb; });
        if (isCraved) {
          for (const ci of ev.devilSlots) {
            const d = B.devil && B.devil[ci];
            if (d && !d.fed) devilFeeds.push(ci);
          }
        }
      }

      // ----- Alphabet combo: figure this glyph's link + bonus before it fires -----
      const lt = comboLetter(ev.id);
      const adv = comboAdv(ev.id);   // Combo-up upgrade advances the chain by 2
      const comboBefore = comboLen;  // running combo before this glyph (for the Combo socket)
      let comboBonus = 0, linked = false;
      // repeat copies & loopback replays are EXTRA activations — each one extends
      // the running combo by a step rather than breaking it or counting as one
      const extraAct = !!(ev.repeat2 || ev.replay);
      if (lt == null) { comboLen = 0; comboPrev = null; comboCarry = 0; comboSeeded = true; }
      else if (comboLinks(comboPrev, lt) || (extraAct && comboLen > 0)) { comboLen += adv; comboPrev = lt; linked = true; }
      else {
        comboLen = adv;
        // first fresh combo of the turn inherits the carried count (Lingering Cadence)
        if (!comboSeeded && comboCarry > 0) { comboLen += comboCarry; linked = comboLen > 1; }
        comboPrev = lt;
      }
      comboSeeded = true;
      // Devil "Combo +N" boons stretch the running chain right as the fed glyph fires
      let comboExtend = 0;
      devilFeeds.forEach(ci => { const b = B.devil[ci].bonus; if (b && b.preCombo) comboExtend += b.preCombo; });
      if (comboExtend > 0) { comboLen = Math.max(0, comboLen) + comboExtend; linked = comboLen > 1; }
      // Combo socket (Troll line): this glyph's combo becomes DOUBLE the running
      // combo so far — a fresh chain starts at 2 — then keeps climbing onward.
      const comboSocketHere = lt != null && (ev.covered || [slot]).reduce((n, ci) => n + slotCountAt(ci, 'combo'), 0) > 0;
      if (comboSocketHere) { comboLen = Math.max(2, comboBefore * 2); linked = true; }
      comboBonus = comboBonusOf(comboLen);
      // Cinderfall: each time the combo climbs to a NEW number, throw that much
      // Burn at a random foe (a chain to 5 lobs 2 → 3 → 4 → 5).
      if (comboLen >= 2 && comboLen > maxCombo && hasPassive('cinderfall')) {
        const ct = targetRandom();
        if (ct[0]) addBurn(ct[0], comboLen);
      }
      if (comboLen > maxCombo) maxCombo = comboLen;
      B.comboNow = comboLen;   // Smoldering Tails / charges read this on every hit
      if (comboBonus > 0) { comboFlash(sEl, prevComboEl, comboLen, comboBonus); showComboMeter(comboLen, comboBonus); }
      prevComboEl = (lt == null) ? null : sEl;

      // Catalysts placed earlier infuse this glyph's resolution (one per instance)
      if (pendingCatalyst.length) {
        for (const col of pendingCatalyst) await applyCatalyst(col, sEl);
        pendingCatalyst = [];
      }

      const g = glyph(ev.id);
      // Devil "Upgrade" boons must land BEFORE the fed glyph resolves, so this
      // very activation fires upgraded (combat = this battle; run = permanent)
      devilFeeds.forEach(ci => {
        const b = B.devil[ci].bonus;
        if (b && b.preUpgrade) {
          const ukey = baseOf(g.cloneOf || ev.id);
          B.combatEmpower[ukey] = (B.combatEmpower[ukey] || 0) + 1;
          if (b.preUpgrade === 'run') root.CG.Game.permEmpowerBase(ukey);
        }
      });
      const redAfter = fxSteps.slice(fxIndex + 1).filter(s => glyph(s.id).color === 'red').length;
      const originEl = sEl ? sEl.querySelector('.socket-glyph') : null;
      const originEls = coveredEls.map(ce => ce.querySelector('.socket-glyph')).filter(Boolean);
      coveredEls.forEach(ce => ce.classList.add('firing'));
      playColorSfx(g.color, chainPos);

      // visualize the special-slot boosts as the glyph fires (genuine step only)
      if (!ev.replay && !ev.repeat2) {
        if (empBonus[k] > 0) empowerSpark(sEl, empBonus[k]);
        const repAt = (ev.covered || [slot]).reduce((n, ci) => n + slotCountAt(ci, 'repeat'), 0);
        if (repAt > 0) repeatPop(sEl, 2 * repAt);
      }

      // a multi-socket glyph is fully cursed if ANY socket it covers is cursed
      const cursedSlot = (ev.covered || [slot]).find(ci => slotCursed(ci));
      B.tickCount = 0;   // Berserk Frenzy counts only THIS glyph's hits as it resolves
      B._glyphTargets = [];   // foes this glyph strikes (Crawler/Demon precise Feast target)
      await resolveGlyph(ev.id, g, {
        slot, chainPos, prevId, redAfter, totalRed, counts, originEl, originEls,
        comboBonus: comboBonus + empBonus[k],   // Empower slots fold in as a flat +1 to neighbors
        cursed: cursedSlot != null, curseCaster: cursedSlot != null ? (B.slotFx[cursedSlot] || {}).caster : null,
        isFirst: chainPos === 0, isLast: k === lastGenuineIdx
      });

      // Berserk Frenzy (Berserk Colossus): a multi-hit's extra ticks each raise the
      // running combo — the glyph's first hit is the normal step, every hit after it
      // pushes the chain higher (carry/reset already settled by the alphabet above).
      if (hasPassive('berserkfrenzy') && B.tickCount > 1) {
        comboLen += (B.tickCount - 1);
        if (comboLen > maxCombo) maxCombo = comboLen;
        B.comboNow = comboLen;
        const fb = comboBonusOf(comboLen);
        if (fb > 0) showComboMeter(comboLen, fb);
      }

      // Wendigo: each glyph you play feeds a lasting color buff — ×5 if it sated a Devil
      if (hasPassive('wendigo') && !ev.replay && !ev.repeat2) {
        wendigoColorBuff(g.color, devilFeeds.length > 0 ? 5 : 1);
      }

      // a curse-slot recoil (or burn) can KO your last beast mid-chain — stop cold
      // instead of resolving the rest of the chain to an empty stage
      if (B.ended) { hideComboMeter(true); coveredEls.forEach(ce => ce.classList.remove('firing')); return; }

      // socketing Rubble purges one copy from your deck for good
      if (ev.id === 'rubble' && !ev.replay) {
        const pool = root.CG.Game.state.pool;
        const pi = pool.indexOf('rubble');
        if (pi !== -1) pool.splice(pi, 1);
        removeOne(B.drawnThisTurn, 'rubble');   // gone — don't send it to the discard
      }

      // slot side-effects fire once, on the genuine placement (not replays/repeat copies).
      // A multi-socket glyph triggers EVERY special slot it covers. These run AFTER
      // the glyph has resolved — so a glyph fed to a Devil plays out its effect in the
      // chain first, then the craved-glyph boon (if any) lands.
      if (!ev.replay && !ev.repeat2) {
        // junk (enemy Rubble / Dead Weight) must never be cloned or held — that
        // could trap the player with permanent enemy cards in hand
        if (ev.cloneCount && !g.junk) for (let c = 0; c < ev.cloneCount; c++) queueClone(ev.id, sEl);
        if (ev.holdAny && !g.junk) { B.extras.push(ev.id); removeOne(B.drawnThisTurn, ev.id); holdFx(sEl); }   // retained, not discarded
        if (ev.catalystCount) for (let c = 0; c < ev.catalystCount; c++) pendingCatalyst.push(g.color);
        // any glyph landing on a Devil socket "touches" it — that spares the
        // ignore tick even when it's the wrong glyph (you just miss the boon)
        if (ev.devilSlots && ev.devilSlots.length) ev.devilSlots.forEach(ci => { if (B.devil[ci]) B.devil[ci].touched = true; });
        // Devil feed: the craving is sated (the glyph is NOT consumed — it discards
        // as normal). preCombo/preUpgrade already fired above so they shape this very
        // activation; every other boon is BANKED and paid out as its own dramatic
        // event once the chain (and the combo number) is done.
        if (devilFeeds.length) {
          for (const ci of devilFeeds) {
            const d = B.devil[ci];
            d.fed = true;
            const b = d.bonus;
            devilFeedFx(ci);
            floatText(offset(center(sEl), 0, -64), '😈 craving sated', 'status');
            // every Devil you satisfy this run feeds the Glutton's hunger
            if (B.monster) B.monster.devoured = (B.monster.devoured || 0) + 1;
            // Crawler/Demon: a sated Devil triggers a Feast (Demon: twice) + amplifies boons
            if (hasPassive('crawlerfeast')) {
              B.devilsFedThisTurn = (B.devilsFedThisTurn || 0) + 1;
              const nFeasts = hasPassive('demon') ? 2 : 1;
              for (let fz = 0; fz < nFeasts; fz++) { const tgt = devilFeastTarget(); if (tgt) feast(tgt, { devilAmp: true }); }
            }
            B._devilRewards.push({ slot: ci, bonus: b, comboLen: comboLen, baseId: baseOf(ev.id) });
          }
        }
        // Upgrade socket (Calamitous Soul): this glyph type grows +1 for the battle
        const upAt = (ev.covered || [slot]).reduce((n, ci) => n + slotCountAt(ci, 'upgrade'), 0);
        if (upAt > 0 && !g.junk) {
          const ukey = baseOf(g.cloneOf || ev.id);
          B.combatEmpower[ukey] = (B.combatEmpower[ukey] || 0) + upAt;
          floatText(offset(center(sEl), 0, -40), 'Upgrade +' + upAt, 'status');
          SFX.place(slot);
        }
      }

      prevId = ev.id;
      chainPos++; fxIndex++;
      refreshAll();
      coveredEls.forEach(ce => { ce.classList.remove('firing'); ce.classList.add('spent'); });
      await wait(360);

      if (alive().length === 0) break; // enemies wiped mid-chain
    }

    // big payoff for a long alphabet chain
    if (maxCombo >= 3) { comboFinale(maxCombo); await wait(260); }
    hideComboMeter();
    B.comboNow = 0;
    // Lingering Cadence: the standing combo number rides into next turn (a turn
    // that played nothing leaves the carry untouched).
    if (hasPassive('lingeringCadence') && runSeq.length > 0) B.comboCarry = comboLen;

    // Charge Attack (Troll line): the Big-Hit payoff erupts across the enemy line
    await detonateCharge(maxCombo);
    if (B.ended) return;

    // the Devil's fed boons take the stage where the combo number just was
    await resolveDevilRewards();
    if (B.ended) return;

    // glyphs left unplayed in hand fire their lingering "end of turn" effects
    if (alive().length > 0) await processUnplayed();

    // Will-o'-Wisps: every glyph still in hand (junk included) flits out and
    // strikes a random foe for the highest combo reached this turn.
    if (alive().length > 0 && maxCombo > 0 && hasPassive('willOWisps')) {
      await willOWisps(maxCombo);
    }

    // a fed Devil cools off; an ignored (but craving) one grows hungrier
    finalizeDevils();

    await wait(250);
    await discardHand();

    // win check
    if (alive().length === 0) { return victory(); }

    // the spent runes dissolve into embers instead of cutting away
    await clearSocketsExit();

    // Devil "Extra Turn" boon: skip the enemy response and forge again at once
    if (B.extraTurn) {
      B.extraTurn = false;
      banner('Extra Turn', 800);
      B.resolving = false;
      beginTurn();
      return;
    }

    // enemies respond
    await enemyTurn();
    if (B.ended) return;

    B.resolving = false;
    beginTurn();
  }

  // unplaced glyphs sweep off into the discard pile, then clear
  function discardHand() {
    // every real deck card touched this turn (played or not) lands in the discard pile
    B.discard.push(...B.drawnThisTurn);
    B.drawnThisTurn = [];
    const cards = Array.from($('hand-row').querySelectorAll('.glyph'));
    return animateDiscard(cards).then(() => {
      B.hand = [];
      renderHand(false);
      updatePiles();   // count ticks up as the cards land in the pile
    });
  }

  // refresh the deck / discard pile counters
  function updatePiles() {
    const d = $('pile-deck-count'), c = $('pile-discard-count');
    if (d) d.textContent = B.draw.length;
    if (c) c.textContent = B.discard.length;
    renderPileViewer();   // keep an open pile modal in sync as cards move
  }

  function playColorSfx(color, step) {
    if (color === 'red') SFX.fireRed(step);
    else if (color === 'blue') SFX.fireBlue(step);
    else if (color === 'green') SFX.fireGreen(step);
    else SFX.firePurple(step);
  }

  // the player's visual anchor is the portrait art, not the whole emblem,
  // so heal/shield/strength FX land dead-center over the monster image
  function playerArt() { const pc = $('player-monster'); return (pc && pc.querySelector('.pc-portrait')) || pc; }
  function playerPos() { return offset(center(playerArt()), 0, -40); }
  // Combo bonus rule (game-wide): a lone glyph (combo 1) earns nothing; from combo 2
  // onward the bonus equals the combo number, so a chain pays +0, +2, +3, +4 …
  function comboBonusOf(n) { return n >= 2 ? n : 0; }

  // Iron Wall (Goblin / Iron Golem): +1 Strength for every 10 Shield currently held.
  // Derived live, so it rises and falls exactly with the wall.
  function ironWallStrength() { return hasPassive('ironwall') ? Math.floor((B.playerShield || 0) / 10) : 0; }
  // total strength = persistent battle strength + temporary "this turn" strength + wall bonus
  function effStrength() { return B.strength + (B.turnStrength || 0) + ironWallStrength(); }

  // War Grudge (Goblin base): every 10 HP of punishment banks +1 Strength for the battle
  function grudgeFromDamage(hpLost) {
    if (!B.monster || B.monster.passive !== 'wargrudge' || hpLost <= 0) return;
    const per = B.monster.passiveVal || 10;
    B.dmgTakenBank = (B.dmgTakenBank || 0) + hpLost;
    let gained = 0;
    while (B.dmgTakenBank >= per) { B.dmgTakenBank -= per; gained++; }
    if (gained > 0) {
      B.strength += gained;
      floatText(offset(center(playerArt()), 0, -120), 'Grudge +' + gained + ' Strength', 'status');
      strengthFx(playerArt());
      refreshAll();
    }
  }

  // ---- Alphabet combos: linear A→B→C (C ends the chain), Wild links to anything ----
  const COMBO_SUCC = { A: 'B', B: 'C' };   // no C→A wraparound
  function comboLetter(id) { const l = glyph(id).letter; return l || null; }
  // does `cur` continue a chain whose previous effective letter was `prev`?
  function comboLinks(prev, cur) {
    if (cur == null || prev == null) return false;
    if (cur === 'wild' || prev === 'wild') return true;
    return COMBO_SUCC[prev] === cur;
  }
  // how many steps a glyph advances the combo chain (Combo-up upgrade = 2)
  function comboAdv(id) {
    const up = root.CG.Game.state.comboUp;
    const base = glyph(id).cloneOf || id;
    return 1 + ((up && up[base]) ? 1 : 0);
  }
  // Gathering Tails: each glyph's main effect +1 per glyph already played
  function gather(ctx) { return B.monster.passive === 'gatheringTails' ? ctx.chainPos : 0; }
  // does the active beast carry this passive — its base one OR any stacked from
  // an evolution (e.g. Inferna holds Gathering Tails + Smoldering + Conflagration)
  function hasPassive(id) {
    const m = B.monster;
    if (!m) return false;
    if (m.passive === id) return true;
    return !!(m.evoPassives && m.evoPassives.some(p => p && p.id === id));
  }
  // Lingering Cadence: the combo count carried into THIS turn (seeds the first
  // fresh chain in both the live walk and every forecast/preview projection).
  function lingerCarry() { return hasPassive('lingeringCadence') ? (B.comboCarry || 0) : 0; }
  // Ember Ward / Emberstorm bonuses keyed off red glyphs
  function emberBonusAmt() {
    const bl = root.CG.Game.state.blessings;
    return (bl.emberstorm ? 1 : 0) + (bl.pyreheart ? 2 : 0);
  }
  function emberDmg(g) { return g.color === 'red' ? emberBonusAmt() : 0; }
  // a small "this copy is forged" line for tooltips
  function upgradeTipSuffix(id) {
    const parts = [];
    const e = empowerOf(id);
    if (e > 0) parts.push('✦ Power +' + e);
    if (comboAdv(id) > 1) parts.push('▲▲ Combo Up');
    return parts.length ? ' <span class="gt-up">' + parts.join(' · ') + '</span>' : '';
  }
  // permanent +N to a glyph's main effect, earned from events / the shop
  function empowerOf(id) {
    const st = root.CG.Game.state;
    const key = glyph(id).cloneOf || id;
    const inst = (st.empower && st.empower[key]) || 0;
    const run = (st.runEmpower && st.runEmpower[baseOf(key)]) || 0;   // shared by every copy of the type (Everflame)
    const combat = (B && B.combatEmpower && B.combatEmpower[baseOf(key)]) || 0;   // Upgrade sockets (this battle)
    return inst + run + combat;
  }

  // ----- live "what would this do" preview env (drives card detail numbers) -----
  // count of placed glyph heads (each resolves as one effect step)
  function placedHeadCount() {
    let n = 0;
    for (let i = 0; i < B.sockets.length; i++) if (B.sockets[i] && B.spanHead[i] == null) n++;
    return n;
  }
  // trailing alphabet-combo state across the glyphs already socketed, in order
  function placedComboTail() {
    let prev = null, len = 0, carry = lingerCarry(), seeded = false;
    for (let i = 0; i < B.sockets.length; i++) {
      if (B.spanHead[i] != null || !B.sockets[i]) continue;
      const lt = comboLetter(B.sockets[i]);
      if (lt == null) { len = 0; prev = null; carry = 0; seeded = true; }
      else if (comboLinks(prev, lt)) { len += 1; prev = lt; seeded = true; }
      else { len = 1; if (!seeded && carry > 0) len += carry; prev = lt; seeded = true; }
    }
    return { prev: prev, len: len };
  }
  // estimate the shield a glyph would grant, given the running sim state. Used to
  // project how much shield later glyphs (e.g. Bulwark Slam) will have to work with.
  function simShieldGain(id, gt, sim) {
    const g = glyph(id);
    const bId = baseOf(id);
    let base = null;
    if (bId === 'rampart') base = 2 * sim.pos;                       // 2 per glyph already played
    else if (bId === 'juggernaut') base = Math.ceil(B.monster.maxHp / 2);
    else if (g.dyn) {
      const tok = g.dyn.find(t => t.kind === 'shield');
      if (tok) base = (typeof tok.base === 'function') ? tok.base({ shield: sim.shield }) : tok.base;
    }
    if (base == null) return 0;                                     // not a shield grant
    if (bId === 'steady' && sim.pos === 0) base += 2;                // +2 if first glyph
    if (bId === 'blood_harden') base += B.enemies.filter(e => e.alive && e.leech > 0).length;
    let a = base + gt + sim.resilience;
    if (sim.frail) a = Math.floor(a * 0.5);
    return Math.max(0, a);
  }
  // walk the placed chain in order, accumulating shield / resilience / combo so a
  // glyph's preview reflects the state it will see WHEN it resolves. Stops just
  // before socket `targetSlot` (pass -1 to simulate the whole placed chain).
  function projectStateBefore(targetSlot) {
    const sim = {
      shield: B.playerShield, resilience: B.resilience, frail: B.playerFrail > 0,
      strength: effStrength(), pos: 0, prev: null, len: 0
    };
    let carry = lingerCarry(), seeded = false;
    for (let i = 0; i < B.sockets.length; i++) {
      if (B.spanHead[i] != null || !B.sockets[i]) continue;
      if (i === targetSlot) break;
      const id = B.sockets[i];
      const lt = comboLetter(id);
      const adv = comboAdv(id);
      const isComboSock = lt != null && slotCountAt(i, 'combo') > 0;
      // this glyph's resulting combo number (Combo socket doubles the running count)
      let num;
      if (isComboSock) num = Math.max(2, sim.len * 2);
      else if (lt != null && comboLinks(sim.prev, lt)) num = sim.len + adv;
      else if (lt != null && !seeded && carry > 0) num = carry + adv;
      else if (lt != null) num = adv;
      else num = 0;
      const combo = comboBonusOf(num);
      const gather = (B.monster.passive === 'gatheringTails') ? sim.pos : 0;
      const gt = gather + combo + (glyph(id).cloneEmpower || 0) + empowerOf(id);
      // cursed slots still grant you the shield (it just also feeds the caster), so always bank it
      sim.shield += simShieldGain(id, gt, sim);
      if (baseOf(id) === 'fortify' || baseOf(id) === 'unbreakable') sim.resilience += 1 + (gt - gather);
      if (lt == null) { sim.len = 0; sim.prev = null; carry = 0; seeded = true; }
      else { sim.len = num; sim.prev = lt; seeded = true; }
      sim.pos += 1;
    }
    return sim;
  }
  function envFromSim(sim) {
    // Iron Wall: re-derive the +Strength from the shield this glyph will SEE when
    // it resolves (sim.strength banked the start-of-chain bonus; swap in the live one)
    const ironAdj = hasPassive('ironwall')
      ? Math.floor((sim.shield || 0) / 10) - ironWallStrength() : 0;
    return {
      gather: 0, comboBonus: 0, cloneEmpower: 0, chainPos: sim.pos,
      strength: sim.strength + ironAdj, weak: B.playerWeak > 0,
      shield: sim.shield, resilience: sim.resilience, frail: sim.frail,
      devoured: (B.monster && B.monster.devoured) || 0,
      ember: emberBonusAmt()
    };
  }
  // how many times a glyph (by its true base id) has resolved this battle
  function rampOf(id) {
    const g = glyph(id);
    return (B.resolveCount && B.resolveCount[baseOf(g.cloneOf || id)]) || 0;
  }
  // ---- Empower-slot previews ----
  // the order of filled glyphs (head slots only) as they'll resolve
  function placedOrder() {
    const order = [];
    for (let i = 0; i < B.sockets.length; i++) {
      if (B.spanHead[i] != null) continue;     // continuation half of a multi-socket glyph
      if (B.sockets[i]) order.push(i);
    }
    return order;
  }
  // total Empower instances covered by the glyph anchored at head slot `h`
  // (hybrids stack — a 2× Empower socket counts twice)
  function empowerCountAt(h) {
    let n = slotCountAt(h, 'empower');
    for (let j = h + 1; j < B.sockets.length; j++) if (B.spanHead[j] === h) n += slotCountAt(j, 'empower');
    return n;
  }
  // +N for the Empower instances resolved immediately before/after this socket
  function empowerBonusForSlot(slotIndex) {
    const order = placedOrder();
    const pos = order.indexOf(slotIndex);
    if (pos === -1) return 0;
    let b = 0;
    if (pos > 0) b += empowerCountAt(order[pos - 1]);
    if (pos < order.length - 1) b += empowerCountAt(order[pos + 1]);
    return b;
  }
  // env for a hand card if it were played NEXT (appended after the placed chain)
  function handEnv(id) {
    const sim = projectStateBefore(-1);
    const lt = comboLetter(id);
    const linked = comboLinks(sim.prev, lt);
    const e = envFromSim(sim);
    e.gather = (B.monster.passive === 'gatheringTails') ? sim.pos : 0;
    e.comboBonus = linked ? comboBonusOf(sim.len + comboAdv(id)) : comboBonusOf(lt != null ? comboAdv(id) : 0);
    // Lingering Cadence: a card played first onto an empty board inherits the carry
    if (!linked && lt != null && placedHeadCount() === 0) {
      const carry = lingerCarry();
      if (carry > 0) e.comboBonus = comboBonusOf(carry + comboAdv(id));
    }
    // if the last placed glyph sits in Empower slot(s), a card played next is "after" them
    const order = placedOrder();
    if (order.length) e.comboBonus += empowerCountAt(order[order.length - 1]);
    e.cloneEmpower = (glyph(id).cloneEmpower || 0) + empowerOf(id);
    e.ramp = rampOf(id);
    e.linked = linked;
    return e;
  }
  // env for a glyph already sitting in socket `slotIndex` (its real chain position)
  function socketEnv(slotIndex) {
    const sim = projectStateBefore(slotIndex);
    const id = B.sockets[slotIndex];
    const lt = comboLetter(id);
    const linked = comboLinks(sim.prev, lt);
    const e = envFromSim(sim);
    e.gather = (B.monster.passive === 'gatheringTails') ? sim.pos : 0;
    const isComboSock = lt != null && slotCountAt(slotIndex, 'combo') > 0;
    const num = (lt == null) ? 0
      : isComboSock ? Math.max(2, sim.len * 2)
      : linked ? sim.len + comboAdv(id)
      : comboAdv(id);
    let cb = comboBonusOf(num);
    // Lingering Cadence: if this is the chain's first fresh letter, fold in the carry
    if (!isComboSock && !linked && lt != null && placedOrder().indexOf(slotIndex) === 0) {
      const carry = lingerCarry();
      if (carry > 0) cb = comboBonusOf(carry + comboAdv(id));
    }
    e.comboBonus = cb + empowerBonusForSlot(slotIndex);
    e.cloneEmpower = (glyph(id).cloneEmpower || 0) + empowerOf(id);
    e.ramp = rampOf(id);
    return e;
  }
  function fmtDesc(id, env) { return root.CG.DATA.formatDesc(glyph(id), env); }

  // ============================================================
  // FORECAST — a faithful dry-run of the socketed chain.
  // Builds the exact resolution sequence Detonate would run (loop
  // replays, repeats, empower neighbors, catalysts, devours) and walks
  // it against CLONED enemy state, so the player can read what the turn
  // is about to deliver. Random-target effects pool into a 🎲 bucket
  // instead of pretending to know where the dice land.
  // ============================================================
  // a virtual board: the live sockets, optionally with a hovered hand
  // glyph dropped into the slot(s) it would actually take
  function fcVirtualBoard(extraId) {
    const sockets = B.sockets.slice();
    const spanHead = B.spanHead.slice();
    if (extraId) {
      const span = glyph(extraId).slots || 1;
      const at = firstFreeRun(span);
      if (at !== -1) {
        sockets[at] = extraId;
        for (let k = 1; k < span; k++) spanHead[at + k] = at;
      }
    }
    return { sockets, spanHead };
  }
  // mirror of detonate()'s sequence expansion, parameterized over a board
  function fcBuildSeq(sockets, spanHead) {
    const seq = [], baseSteps = [];
    for (let i = 0; i < sockets.length; i++) {
      const id = sockets[i];
      if (!id && spanHead[i] == null && isPureLoop(i)) {
        if (!slotDisabled(i)) {
          const loops = slotCountAt(i, 'loopback');
          for (let L = 0; L < loops; L++) {
            baseSteps.forEach(st => seq.push({ id: st.id, slot: st.slot, covered: st.covered, replay: true }));
          }
        }
        continue;
      }
      if (!id) continue;
      const covered = [i];
      for (let j = i + 1; j < sockets.length; j++) if (spanHead[j] === i) covered.push(j);
      const countAcross = t => covered.reduce((n, ci) => n + slotCountAt(ci, t), 0);
      const step = {
        id, slot: i, covered,
        holdAny: countAcross('hold') > 0,
        cloneCount: countAcross('clone'),
        catalystCount: countAcross('catalyst'),
        devourAny: countAcross('devil') > 0
      };
      seq.push(step); baseSteps.push(step);
      const repeatCount = countAcross('repeat');
      if (repeatCount > 0) {
        const extra = 2 * repeatCount - 1;
        for (let r = 0; r < extra; r++) {
          const s2 = Object.assign({}, step, { repeat2: true });
          seq.push(s2); baseSteps.push(s2);
        }
      }
      const loopHere = countAcross('loopback');
      if (loopHere > 0 && !slotDisabled(i)) {
        const snapshot = baseSteps.slice();
        for (let L = 0; L < loopHere; L++) {
          snapshot.forEach(st => seq.push({ id: st.id, slot: st.slot, covered: st.covered, replay: true }));
        }
      }
    }
    return seq;
  }

  function simulateChain(extraId) {
    const board = fcVirtualBoard(extraId);
    let seq = fcBuildSeq(board.sockets, board.spanHead);
    // Hall of Mirrors twist — fires only when EVERY usable socket holds a Mirror
    const isMir = s => baseOf(glyph(s.id).cloneOf || s.id) === 'mirror';
    const vFree = board.sockets.reduce((n, s, i) =>
      n + (s == null && board.spanHead[i] == null && slotTakesGlyph(i) && !slotDisabled(i) ? 1 : 0), 0);
    let mirrorTurn = false;
    if (seq.length && seq.every(isMir) && vFree === 0 && B.lastTurnPlays.length) {
      mirrorTurn = true;
      seq = B.lastTurnPlays.map(id => ({ id, slot: -1, covered: [], replay: true }));
    }

    const T = {
      foes: B.enemies.filter(e => e.alive).map(e => ({
        ref: e, hp: e.hp, shield: e.shield, burn: e.burn || 0, scare: e.scare || 0,
        leech: e.leech || 0, alive: true,
        dmg: 0, burnAdd: 0, scareAdd: 0, leechAdd: 0,      // certain
        pdmg: 0, pburn: 0, pscare: 0, pleech: 0            // possible (random / chance)
      })),
      rndDmg: 0, rndSwings: 0,
      shield: B.playerShield, shieldGain: 0,
      heal: 0, selfLoss: 0, playerBurn: 0,
      // base strength WITHOUT the Iron Wall bonus — curStr() folds that in live so
      // it grows as the projected shield climbs during the chain
      strength: B.strength + (B.turnStrength || 0), strGain: 0,
      // Charge Attack pool: any hoard carried in (Eternal Charge) plus this chain
      charge: {
        dmg: (B.charge && B.charge.dmg) || 0, weak: (B.charge && B.charge.weak) || 0,
        scare: (B.charge && B.charge.scare) || 0, burn: (B.charge && B.charge.burn) || 0
      },
      chargeFired: null, _hits: 0,
      resilience: B.resilience, resGain: 0,
      frail: B.playerFrail > 0, weak: B.playerWeak > 0,
      burnTotal: 0, scareTotal: 0, leechTotal: 0,
      husks: 0, clones: 0, holds: 0, devours: 0,
      everRamp: 0, approx: false, mirrorTurn, steps: seq.length,
      handFx: []   // end-of-turn effects from glyphs left in hand, with sources
    };

    T._comboNow = 0;                                    // running combo for Smoldering Tails
    const smolderActive = hasPassive('smolderingTails');

    const A = () => T.foes.filter(f => f.alive);
    const tFirst = () => A()[0] || null;
    const tAll = A;
    const tLowest = () => { const a = A(); return a.length ? a.slice().sort((x, y) => x.hp - y.hp)[0] : null; };
    const tHighest = () => { const a = A(); return a.length ? a.slice().sort((x, y) => y.hp - x.hp)[0] : null; };
    const tCenter = () => { const a = A(); return a.length ? (a.length % 2 === 1 ? a[(a.length - 1) / 2] : a[a.length - 1]) : null; };

    let stepCursed = false, stepBurnMirrored = false, lastMirrorTarget = null;

    const fcWardOf = t => {
      let w = 0;
      T.foes.forEach(o => { if (o.alive && o !== t && o.ref.base && o.ref.base.ward > 0) w = Math.max(w, o.ref.base.ward); });
      return w;
    };
    // current player Strength inside the forecast — Iron Wall (Iron Golem) adds
    // +1 per 10 of the PROJECTED shield, so it climbs as the chain banks block
    function curStr() {
      return T.strength + (hasPassive('ironwall') ? Math.floor((T.shield || 0) / 10) : 0);
    }
    // a genuine landed hit feeds the Goblin engines exactly as live applyDamage does
    function fcTickEngines(amt, opts) {
      if (amt <= 0 || opts.charge) return;
      T._hits++;                                            // Berserk Frenzy: combo per tick
      if (hasPassive('overcharge')) T.charge.dmg++;         // Overcharge: a Damage Charge per tick
    }
    // one strike against one foe — mirrors applyDamage's math exactly
    function fcHit(t, base, opts) {
      opts = opts || {};
      let dmg = base;
      if (T.weak) dmg = Math.max(1, Math.round(dmg * 0.6));
      if (t === 'random') {
        const pool = A();
        if (!pool.length) return 0;
        // a lone survivor makes "random" a sure thing — resolve it exactly
        if (pool.length === 1) t = pool[0];
        else {
          const amt = Math.max(0, Math.round(dmg + (opts.strength === false ? 0 : curStr())));
          T.rndDmg += amt; T.rndSwings++; T.approx = true;
          // every foe alive right now is in this strike's pool
          pool.forEach(f => { f.pdmg += amt; });
          // Smoldering Tails: the hit (wherever it lands) also lays combo Burn
          if (smolderActive && (T._comboNow || 0) > 0) fcBurn('random', T._comboNow);
          fcTickEngines(amt, opts);
          return amt;
        }
      }
      if (!t || !t.alive) return 0;
      let amt = dmg;
      if (opts.strength !== false) amt += curStr();
      if (opts.scare !== false) amt += (t.scare || 0);
      amt = Math.max(0, Math.round(amt));
      const ward = fcWardOf(t);
      if (ward > 0 && amt > 0) amt = Math.max(1, amt - ward);
      const absorbed = Math.min(t.shield, amt);
      t.shield -= absorbed;
      t.hp = Math.max(0, t.hp - (amt - absorbed));
      t.dmg += amt;
      fcTickEngines(amt, opts);
      if (t.hp <= 0) { if (t.alive) { t.alive = false; fcOnKill(t); } }
      else if (t.ref.base && t.ref.base.thorns > 0 && amt > 0 && !opts.noThorns) fcSelf(t.ref.base.thorns);
      // Smoldering Tails: every genuine hit also lays Burn equal to the current combo
      if (smolderActive && t.alive && (T._comboNow || 0) > 0) fcBurn(t, T._comboNow);
      return amt;
    }
    // a predicted kill Feasts the slain foe — deterministic where it produces
    // damage/heal. Vampire's Feast-kill heals 20% of the foe's max HP; any heal
    // past full spills as AoE damage to every survivor (which can chain). A kill
    // only Feasts while the foe still holds a bonus to sap.
    function fcOnKill(t) {
      if (!t.ref.feastPool || !t.ref.feastPool.length) return;
      const missing = B.monster.maxHp - B.monster.hp;
      if (hasPassive('vampire')) {
        const heal = Math.round((t.ref.maxHp || 0) * 0.25);
        const room = Math.max(0, missing - T.heal);
        const healed = Math.min(room, heal);
        T.heal += healed;
        const spill = heal - healed;
        if (spill > 0) A().forEach(f => fcHit(f, spill, { strength: false, scare: false, charge: true }));
      } else if (hasPassive('undeadfeast')) {
        const room = Math.max(0, missing - T.heal);
        T.heal += Math.min(room, Math.max(1, Math.round((t.ref.maxHp || 0) * 0.10)));
      } else if (hasPassive('feast')) {
        const room = Math.max(0, missing - T.heal);
        T.heal += Math.min(room, Math.max(1, Math.round((t.ref.maxHp || 0) * 0.05)));
      }
    }
    // damage recoiling onto the beast (curse mirror, thorns, blood magic)
    function fcSelf(n) {
      if (n <= 0) return;
      if (B.monster.passive === 'stonehide') n = Math.max(1, n - B.monster.passiveVal);
      if (root.CG.Game.state.blessings.stoneblood) n = Math.max(1, n - 1);
      const absorbed = Math.min(T.shield, n);
      T.shield -= absorbed;
      T.selfLoss += n - absorbed;
    }
    // one hitTargets() call: strikes the group, plus the cursed-slot recoil
    function fcVolley(targets, base, opts) {
      targets = (targets || []).filter(Boolean);
      targets.forEach(t => fcHit(t, base, opts));
      if (stepCursed) {
        let r = base;
        if (T.weak) r = Math.max(1, Math.round(r * 0.6));
        fcSelf(Math.max(0, Math.round(r)));
      }
    }
    function fcShield(amt) {
      let a = amt + T.resilience;
      if (T.frail) a = Math.floor(a * 0.5);
      if (a <= 0) return 0;
      T.shield += a; T.shieldGain += a;
      // Shieldlash (Orc): every point of Shield gained lashes a random foe for that much
      if (hasPassive('shieldlash')) fcHit('random', a);
      return a;
    }
    function fcHeal(n) { if (n > 0) T.heal += n; }
    function fcBurn(t, n) {
      if (n <= 0) return;
      if (hasPassive('conflagration')) n *= 2;   // Conflagration: Burn applications doubled
      if (stepCursed && !stepBurnMirrored) { stepBurnMirrored = true; T.playerBurn += n; }
      if (t === 'random') {
        const pool = A();
        if (!pool.length) return;
        if (pool.length === 1) t = pool[0];
        else {
          T.burnTotal += n; T.approx = true;
          pool.forEach(f => { f.pburn += n; });
          return;
        }
      }
      if (!t || !t.alive) return;
      t.burn += n; t.burnAdd += n; T.burnTotal += n;
    }
    function fcStr(n) { if (n > 0) { T.strength += n; T.strGain += n; } }
    function fcRes(n) { if (n > 0) { T.resilience += n; T.resGain += n; } }
    function fcDevour(id) {
      const g = glyph(id);
      T.devours++;
      if (baseOf(g.cloneOf || id) === DEVIL_TOKEN) { T.selfLoss += Math.max(1, Math.ceil(B.monster.hp * 0.30)); return; }
      if (g.color === 'red') fcStr(1);
      else if (g.color === 'blue') fcShield(1);
      else fcHeal(3);
    }

    // chain-wide context (same precomputes detonate makes)
    const counts = {};
    seq.forEach(s => { const b = baseOf(s.id); counts[b] = (counts[b] || 0) + 1; });
    const totalRed = seq.filter(s => glyph(s.id).color === 'red').length;
    const blueCount = seq.filter(s => glyph(s.id).color === 'blue').length;
    const redSuffix = new Array(seq.length + 1).fill(0);
    for (let i = seq.length - 1; i >= 0; i--) redSuffix[i] = redSuffix[i + 1] + (glyph(seq[i].id).color === 'red' ? 1 : 0);
    const empB = new Array(seq.length).fill(0);
    for (let k = 0; k < seq.length; k++) {
      const cov = seq[k].covered || [];
      const n = cov.reduce((s, ci) => s + slotCountAt(ci, 'empower'), 0);
      if (n > 0) {
        if (k > 0) empB[k - 1] += n;
        if (k + 1 < seq.length) empB[k + 1] += n;
      }
    }
    // Shimmering Orb mirror — empower every glyph by the chain's distinct colors
    if (root.CG.Game.state.blessings.shimmer && seq.length) {
      const shimmer = new Set(seq.map(s => glyph(s.id).color)).size;
      for (let k = 0; k < empB.length; k++) empB[k] += shimmer;
    }
    let lastGenuineIdx = -1;
    for (let gi = seq.length - 1; gi >= 0; gi--) if (!seq[gi].replay && !seq[gi].repeat2) { lastGenuineIdx = gi; break; }
    const handLeft = Math.max(0, B.hand.length - (extraId ? 1 : 0));

    // per-glyph effect estimate — mirrors resolveGlyphInner case by case
    function fcResolve(id, ctx) {
      const g = glyph(id);
      const gatherN = (B.monster.passive === 'gatheringTails') ? ctx.chainPos : 0;
      const gt = gatherN + (g.cloneEmpower || 0) + (ctx.comboBonus || 0) + empowerOf(id);
      const gtx = gt - gatherN;
      if (g.color === 'red' && root.CG.Game.state.blessings.emberward) fcShield(2);
      const E = emberDmg(g);
      // colorless Soul-glyphs: mirror resolveNeutral's data-driven effects
      if (g.colorless && Array.isArray(g.fx)) {
        const fcPick = t => t === 'all' ? tAll() : t === 'random' ? ['random']
          : t === 'lowest' ? [tLowest()] : t === 'highest' ? [tHighest()]
          : t === 'center' ? [tCenter()] : [tFirst()];
        g.fx.forEach(step => {
          for (let h = 0; h < (step.hits || 1); h++) {
            if (step.op === 'dmg') fcVolley(fcPick(step.t || 'first'), (step.v || 0) + gt + E);
            else if (step.op === 'shield') fcShield((step.v || 0) + gtx);
            else if (step.op === 'heal') fcHeal((step.v || 0) + gtx);
            else if (step.op === 'str') fcStr((step.v || 0) + Math.round(gtx));
            else if (step.op === 'res') fcRes((step.v || 0) + Math.round(gtx));
            else if (step.op === 'burn') {
              const t = step.t || 'first';
              if (t === 'all') A().forEach(f => fcBurn(f, (step.v || 0) + gtx));
              else if (t === 'random') fcBurn('random', (step.v || 0) + gtx);
              else { const f = fcPick(t)[0]; if (f) fcBurn(f, (step.v || 0) + gtx); }
            } else if (step.op === 'scare') {
              const stacks = (step.v || 0) + Math.round(gtx);
              const t = step.t || 'all';
              const foes = (t === 'all') ? A() : fcPick(t).filter(Boolean);
              foes.forEach(f => { f.scareAdd += stacks; });
              T.scareTotal += stacks * foes.length;
            }
          }
        });
        return;
      }
      switch (baseOf(g.cloneOf || id)) {
        case 'rubble': case 'deadweight': break;
        /* -------- TROLL -------- */
        case 'smash': fcVolley([tFirst()], 6 + gt + E); break;
        case 'brace': fcShield(6 + gt); break;
        case 'quake': fcVolley(tAll(), 3 + gt + E); break;
        case 'bulwark_slam': fcVolley([tFirst()], T.shield + gt + E); break;
        case 'hammer': fcVolley([tFirst()], (T.shield > 0 ? 6 : 4) + gt + E); break;
        case 'steady': fcShield(4 + (ctx.isFirst ? 2 : 0) + gt); break;
        case 'boulder': fcVolley([tFirst()], 8 + gt + E); break;
        case 'iron_skin': fcShield(8 + gt); break;
        case 'mend': fcHeal(6 + gt); break;
        case 'rockfall': {
          const extra = Math.max(0, (ctx.counts['rockfall'] || 1) - 1);
          fcVolley(tAll(), 2 + extra + gt + E);
          break;
        }
        case 'backhand': {
          const prevRed = ctx.prevId && glyph(ctx.prevId).color === 'red' ? 2 : 0;
          fcVolley(['random'], 5 + prevRed + gt + E);
          break;
        }
        case 'fortify': fcRes(1 + Math.round(gtx)); break;
        case 'rampart': fcShield(2 * ctx.chainPos + gt); break;
        case 'spiked_hide': { const got = fcShield(5 + gt); if (got > 0) fcVolley(['random'], got); break; }
        case 'crush': {
          const t = tFirst();
          fcVolley([t], 5 + (t && t.shield <= 0 ? 4 : 0) + gt + E);
          break;
        }
        case 'second_wind': fcHeal(4 + (B.monster.hp < B.monster.maxHp / 2 ? 4 : 0) + gt); break;
        case 'avalanche': fcVolley(tAll(), T.shield + gt + E); break;
        case 'bastion': fcShield(10 + gt); break;
        case 'titans_smash': fcVolley([tFirst()], 9 + Math.floor(T.shield / 3) + gt + E); break;
        case 'unbreakable': fcRes(1 + Math.round(gtx)); break;
        case 'reckoning': fcVolley(tAll(), 2 * curStr() + gt + E, { strength: false }); break;
        case 'mountains_wrath': fcVolley([tFirst()], T.shield * 2 + gt + E); break;
        case 'aftershock': {
          const volleys = Math.max(1, ctx.blueCount || 0);
          for (let v = 0; v < volleys; v++) { fcVolley(tAll(), 3 + gt + E); if (!A().length) break; }
          break;
        }
        case 'juggernaut': fcShield(Math.ceil(B.monster.maxHp / 2) + gt); break;
        /* -------- GHOUL -------- */
        case 'leech': { const t = tCenter(); fcVolley([t], 3 + gt + E); if (t && t.alive) { t.leech = 3; t.leechAdd++; T.leechTotal++; } break; }
        case 'rake': {
          for (let n = 0; n < 2; n++) fcVolley(['random'], 2 + gt + E);
          if (ctx.isLast && ctx.totalRed === 1) {
            A().forEach(f => { f.pleech++; });
            T.leechTotal++; T.approx = true;
          }
          break;
        }
        case 'vigor': fcStr(1 + (ctx.redAfter || 0) + Math.round(gtx)); break;
        case 'blood_harden': fcShield(2 + A().filter(f => f.leech > 0).length + gt); break;
        case 'snarl': {
          const stacks = 1 + Math.round(gtx);
          // each foe rolls its own ~50% resist — a chance, not a promise
          A().forEach(f => { f.pscare += stacks; });
          T.scareTotal += stacks * A().length; T.approx = true;
          break;
        }
        case 'gnaw': fcVolley([tFirst()], 4 + gt + E); fcHeal(2 + gtx); break;
        case 'grave_rot': {
          const all = A();
          fcVolley(all.filter(f => !(f.leech > 0)), 3 + gt + E);
          fcVolley(all.filter(f => f.leech > 0), 5 + gt + E);
          break;
        }
        case 'mend_flesh': fcHeal(5 + gtx); break;
        case 'bone_wall': fcShield(5 + gt); break;
        case 'raise_dead': T.husks += 2; break;
        case 'exsanguinate': {
          const t = tCenter();
          fcVolley([t], 5 + gt + E);
          if (t && t.alive) { t.leech = 3; t.leechAdd++; T.leechTotal++; }
          fcHeal(3 + gtx);
          break;
        }
        case 'dread_howl': {
          const stacks = 1 + Math.round(gtx) + (B.monster.hp < B.monster.maxHp / 2 ? 1 : 0);
          A().forEach(f => { f.scare += stacks; f.scareAdd += stacks; });
          T.scareTotal += stacks * A().length;
          break;
        }
        case 'soul_harvest': { const n = A().length; fcVolley(tAll(), 3 + gt + E); fcHeal(n); break; }
        case 'blood_pact': {
          T.selfLoss += Math.min(4, Math.max(0, B.monster.hp - 1));
          fcStr(3 + Math.round(gtx));
          break;
        }
        case 'glutton': fcVolley([tFirst()], Math.max(2, 2 * ((B.monster.devoured || 0) + T.devours)) + gt + E); break;
        case 'plague': { A().forEach(f => { f.leech = 3; f.leechAdd++; }); T.leechTotal += A().length; fcHeal(2 + gtx); break; }
        case 'mass_grave': T.husks += 3; fcVolley(tAll(), 2 + gt + E); break;
        case 'lich_ascendant': fcHeal(8 + gtx); fcStr(2 + Math.round(gtx)); break;
        case 'husk': fcVolley(['random'], 1 + gt + E); break;
        case 'maweaten_scrap': fcVolley(['random'], 5 + gt + E); fcHeal(4 + Math.round(gtx)); break;
        /* -------- KITSUNE -------- */
        case 'flicker': fcVolley(['random'], 2 + gt + E); break;
        case 'foxfire': fcBurn('random', 2 + gtx); break;
        case 'onslaught': { for (let h = 0; h < ctx.chainPos; h++) fcVolley(['random'], 2 + gt + E); break; }
        case 'wildfire': {
          const burnAmt = 1 + gtx;
          A().forEach(f => {
            const was = f.burn > 0;
            fcBurn(f, burnAmt);
            if (was) fcHit(f, f.burn, { strength: false, scare: false });
          });
          break;
        }
        case 'mirror': {
          const prevBase = ctx.prevId ? baseOf(glyph(ctx.prevId).cloneOf || ctx.prevId) : null;
          const echoId = (prevBase && prevBase !== 'mirror') ? ctx.prevId
            : (prevBase === 'mirror' ? lastMirrorTarget : null);
          if (echoId) {
            lastMirrorTarget = echoId;
            fcResolve(echoId, Object.assign({}, ctx, {
              comboBonus: (ctx.comboBonus || 0) + Math.max(0, comboAdv(echoId) - 1) + empowerOf(id)
            }));
          }
          break;
        }
        case 'spark': fcVolley(['random'], 4 + (ctx.chainPos === 0 ? 2 : 0) + gt + E); break;
        case 'smolder': fcBurn(tFirst(), 2 + gtx); break;
        case 'wisp': fcVolley(tAll(), 2 + gt + E); break;
        case 'scorch': fcBurn(tHighest(), 3 + gtx); break;
        case 'veil': fcShield(4 + gtx); break;
        case 'emberlash': for (let n = 0; n < 3; n++) fcVolley(['random'], 1 + gt + E); break;
        case 'lick_wounds': fcHeal(5 + gtx); break;
        case 'everflame': fcVolley(['random'], 4 + gt + E + T.everRamp); T.everRamp++; break;
        case 'conflagration': A().forEach(f => { if (f.burn > 0) fcHit(f, f.burn + gt, { strength: false }); }); break;
        case 'foxfire_dance': A().forEach(f => fcBurn(f, 2 + gtx)); break;
        case 'hoarders_flame': { for (let h = 0; h < ctx.handLeft; h++) fcVolley(['random'], 2 + gt + E); break; }
        case 'nine_tails': fcVolley(['random'], 2 * ctx.chainPos + gt + E); break;
        case 'immolate': { const t = tFirst(); fcVolley([t], 5 + gt + E); if (t && t.alive) fcBurn(t, 5); break; }
        case 'will_o_wisp': fcVolley([tLowest()], 3 + gt + E); break;
        case 'ember_hoard': fcShield(2 * ctx.handLeft + gtx); break;
        case 'spirit_fire': A().forEach(f => fcBurn(f, ctx.totalRed + gtx)); break;
        case 'nine_tailed_inferno': {
          A().forEach(f => { if (f.burn > 0) { fcHit(f, f.burn, { strength: false }); f.burn = 0; } });
          A().forEach(f => fcBurn(f, 3 + gtx));
          break;
        }
        case 'phoenix': fcHeal(10 + gtx + (ctx.handLeft === 0 ? 10 : 0)); break;
        case 'trickster_echo':
          if (ctx.prevId && baseOf(ctx.prevId) !== 'trickster_echo') {
            fcResolve(ctx.prevId, Object.assign({}, ctx, {
              comboBonus: (ctx.comboBonus || 0) + 3 + empowerOf(id)
            }));
          }
          break;
      }
    }

    // ---- the walk: combo + catalysts + slot side-effects, in chain order ----
    let prevId = null, chainPos = 0, pendingCat = [];
    let comboLen = 0, comboPrev = null, fcMax = 0;
    let carry = lingerCarry(), seeded = false;   // Lingering Cadence seed
    for (let k = 0; k < seq.length; k++) {
      const ev = seq[k];
      const lt = comboLetter(ev.id), adv = comboAdv(ev.id);
      const comboBefore = comboLen;
      let comboBonus = 0;
      // repeat/loop extra activations extend the combo (mirror of the live walk)
      const extraAct = !!(ev.repeat2 || ev.replay);
      if (lt == null) { comboLen = 0; comboPrev = null; carry = 0; seeded = true; }
      else if (comboLinks(comboPrev, lt) || (extraAct && comboLen > 0)) { comboLen += adv; comboPrev = lt; seeded = true; }
      else {
        comboLen = adv;
        if (!seeded && carry > 0) { comboLen += carry; }
        comboPrev = lt; seeded = true;
      }
      // Combo socket: this glyph's combo is double the running count (fresh = 2)
      if (lt != null && (ev.covered || [ev.slot]).reduce((n, ci) => n + slotCountAt(ci, 'combo'), 0) > 0) {
        comboLen = Math.max(2, comboBefore * 2);
      }
      comboBonus = comboBonusOf(comboLen);
      // Cinderfall: each climb to a new combo height throws that much Burn at a random foe
      const newHeight = comboLen >= 2 && comboLen > fcMax;
      if (comboLen > fcMax) fcMax = comboLen;
      T._comboNow = comboLen;
      // catalysts sown by the previous glyph infuse this one
      stepCursed = false;
      for (const col of pendingCat) {
        if (col === 'red') fcVolley(tAll(), 3);
        else if (col === 'blue') fcShield(3);
        else fcHeal(6);
      }
      pendingCat = [];
      stepCursed = (ev.covered || []).some(ci => slotCursed(ci));
      stepBurnMirrored = false;
      if (newHeight && hasPassive('cinderfall')) fcBurn('random', comboLen);
      T._hits = 0;   // Berserk Frenzy counts only THIS glyph's hits
      fcResolve(ev.id, {
        chainPos, prevId, redAfter: redSuffix[k + 1], totalRed, counts,
        comboBonus: comboBonus + empB[k],
        isFirst: chainPos === 0, isLast: k === lastGenuineIdx,
        blueCount, handLeft
      });
      // Berserk Frenzy (Berserk Colossus): a multi-hit's extra ticks raise the
      // running combo for everything that follows (mirror of the live walk)
      if (hasPassive('berserkfrenzy') && T._hits > 1) {
        comboLen += (T._hits - 1);
        if (comboLen > fcMax) fcMax = comboLen;
        T._comboNow = comboLen;
      }
      // Wendigo: a genuine play ramps a color buff (×5 when it sates a Devil) —
      // red/blue Strength/Resilience reshape every later hit, so fold them in now
      if (hasPassive('wendigo') && !ev.replay && !ev.repeat2) {
        let devilFed = false;
        const wfb = baseOf(ev.id);
        // a glyph craved by ANY Devil, dropped on ANY Devil socket, sates it
        const wCraved = devilIdxs().some(k => { const d = B.devil[k]; return d && d.crave && d.crave === wfb; });
        if (wCraved) (ev.covered || [ev.slot]).forEach(ci => { if (slotCountAt(ci, 'devil') > 0) devilFed = true; });
        const wMult = devilFed ? 5 : 1;
        const wCol = glyph(ev.id).color;
        if (wCol === 'red') fcStr(2 * wMult);
        else if (wCol === 'blue') fcRes(2 * wMult);
        else if (wCol === 'green') fcHeal(Math.max(1, Math.round(B.monster.maxHp * 0.05 * wMult)));
        // white/colorless rolls a random of the three — unforecastable, left out
      }
      if (!ev.replay && !ev.repeat2) {
        const g = glyph(ev.id);
        if (ev.cloneCount && !g.junk) T.clones += ev.cloneCount;
        if (ev.holdAny && !g.junk) T.holds++;
        if (ev.catalystCount) for (let c = 0; c < ev.catalystCount; c++) pendingCat.push(g.color);
      }
      prevId = ev.id; chainPos++;
      if (!A().length) break;
    }

    // Charge Attack (Troll line): the assembled Damage Charges erupt as one AOE
    // across the whole enemy line — guaranteed damage, folded into each foe's total
    if ((T.charge.dmg || 0) > 0 && A().length) {
      T.chargeFired = { dmg: T.charge.dmg };
      A().forEach(f => fcHit(f, T.charge.dmg, { strength: false, charge: true }));
    }

    // glyphs that would stay in hand fire their end-of-turn effects too —
    // tracked with their source name so the panel can say WHY
    if (A().length) {
      stepCursed = false;
      T._comboNow = 0;   // the chain's over — leftover-hand hits carry no combo
      let skippedExtra = false;
      const agg = {};
      B.hand.forEach(id => {
        if (extraId && id === extraId && !skippedExtra) { skippedExtra = true; return; }
        const g = glyph(id), ou = g.onUnplayed;
        if (!ou) return;
        let amt = 0;
        if (ou.kind === 'damageRandom') { fcVolley(['random'], ou.value); amt = ou.value; }
        else if (ou.kind === 'block') amt = fcShield(ou.value);
        const k = g.name + '|' + ou.kind;
        agg[k] = agg[k] || { name: g.name, kind: ou.kind, n: 0, amt: 0 };
        agg[k].n++; agg[k].amt += amt;
      });
      T.handFx = Object.values(agg);

      // Will-o'-Wisps: every glyph still in hand (junk included) flits out and
      // strikes a random foe for the highest combo reached this turn.
      if (hasPassive('willOWisps') && fcMax > 0) {
        let wisps = 0, skipW = false;
        B.hand.forEach(id => {
          if (extraId && id === extraId && !skipW) { skipW = true; return; }
          if (!A().length) return;
          fcVolley(['random'], fcMax, { strength: false, scare: false });
          wisps++;
        });
        if (wisps > 0) T.handFx.push({ name: 'Will-o\u2019-Wisps', kind: 'damageRandom', n: wisps, amt: fcMax });
      }
    }
    return T;
  }

  // ============================================================
  // FORECAST UI — a panel on the right (mirroring the tooltip panel on
  // the left) totals the chain; floating marks over each foe show where
  // the damage actually lands; hovering a hand glyph folds it in and
  // shows the delta + lights up the socket(s) it would take.
  // ============================================================
  function fcEnsureBar() {
    let p = $('chain-forecast');
    if (!p) {
      p = el('aside', 'chain-forecast');
      p.id = 'chain-forecast';
      $('screen-battle').appendChild(p);
    }
    return p;
  }
  function clearForecastMarks() {
    if (!B) return;
    B.enemies.forEach(en => {
      const m = en.dom && en.dom.querySelector('.fc-mark');
      if (m) m.remove();
    });
    const pm = document.querySelector('#player-panel .fc-mark-self');
    if (pm) pm.remove();
  }
  function fcRow(cls, ico, val, label) {
    return '<div class="fc-row ' + cls + '"><span class="fc-ico">' + ico + '</span>' +
      '<span class="fc-val">' + val + '</span><span class="fc-lab">' + label + '</span></div>';
  }
  function renderForecast(hoverId) {
    if (!B) return;
    const bar = fcEnsureBar();
    const placedAny = B.sockets.some(Boolean);
    if (B.ended || B.resolving) {
      bar.classList.remove('show');
      clearForecastMarks();
      return;
    }
    // one unambiguous projection per view: hover = "you play this card";
    // otherwise = "you Act now" — which, on an empty board, is purely the
    // end-of-turn effects of the cards sitting in hand
    const sim = simulateChain(hoverId || null);
    const sumDmg = s => s.foes.reduce((n, f) => n + f.dmg, 0) + s.rndDmg;
    const dmgAll = sumDmg(sim);
    const lethal = sim.foes.filter(f => !f.alive).length;
    const rows = [];
    if (dmgAll > 0) rows.push(fcRow('dmg', '⚔', (sim.approx ? '~' : '') + dmgAll, 'damage'));
    if (sim.rndDmg > 0) rows.push(fcRow('rnd', '🎲', sim.rndDmg, 'random damage, ' + sim.rndSwings + ' hit' + (sim.rndSwings === 1 ? '' : 's')));
    if (sim.chargeFired && sim.chargeFired.dmg > 0) rows.push(fcRow('charge', '⚡', sim.chargeFired.dmg, 'Charge Attack · every foe'));
    if (lethal > 0) rows.push(fcRow('lethal', '💀', lethal, lethal === 1 ? 'killing blow' : 'killing blows'));
    if (sim.shieldGain > 0) rows.push(fcRow('shield', '◆', sim.shieldGain, 'block'));
    if (sim.heal > 0) rows.push(fcRow('heal', '♥', sim.heal, 'healing'));
    if (sim.burnTotal > 0) rows.push(fcRow('burn', '🔥', sim.burnTotal, 'burn applied'));
    if (sim.scareTotal > 0) rows.push(fcRow('scare', '☠', '~' + sim.scareTotal, 'scare'));
    if (sim.leechTotal > 0) rows.push(fcRow('leech', '🩸', sim.leechTotal, 'leeched'));
    if (sim.strGain > 0) rows.push(fcRow('str', '✦', '+' + sim.strGain, 'Strength'));
    if (sim.resGain > 0) rows.push(fcRow('res', '🛡', '+' + sim.resGain, 'Resilience'));
    if (sim.husks > 0) rows.push(fcRow('husk', '⚰', sim.husks, 'Husks next hand'));
    if (sim.clones > 0) rows.push(fcRow('clone', '⧉', sim.clones, sim.clones === 1 ? 'clone next hand' : 'clones next hand'));
    if (sim.holds > 0) rows.push(fcRow('hold', '⏸', sim.holds, 'held for next turn'));
    if (sim.selfLoss > 0) rows.push(fcRow('warn', '⚠', '−' + sim.selfLoss, 'recoil onto you'));
    if (sim.playerBurn > 0) rows.push(fcRow('warn', '🔥', sim.playerBurn, 'Burn onto you'));
    if (!rows.length) {
      bar.classList.remove('show');
      clearForecastMarks();
      return;
    }
    // explain end-of-turn effects from glyphs that would stay in hand
    let handNote = '';
    if (sim.handFx.length) {
      const bits = sim.handFx.map(h =>
        h.name + (h.n > 1 ? ' ×' + h.n : '') + ' ' +
        (h.kind === 'block' ? '<i class="fn-shield">◆' + h.amt + '</i>' : '<i class="fn-dmg">🎲⚔' + h.amt + '</i>'));
      handNote = '<div class="fc-note hand">✋ left in hand at turn\u2019s end: ' + bits.join(' · ') + '</div>';
    }
    const sub = hoverId ? 'playing ' + glyph(hoverId).name
      : sim.mirrorTurn ? 'Hall of Mirrors — last turn echoes'
      : placedAny ? 'if you Act now'
      : 'cards waiting in hand';
    bar.innerHTML =
      '<div class="fc-head">Forecast</div>' +
      '<div class="fc-sub">' + sub + '</div>' +
      rows.join('') +
      handNote +
      (sim.approx ? '<div class="fc-note">~ marks over foes — possible shares of random effects</div>' : '');
    bar.classList.add('show');

    // floating per-foe projections: solid numbers for what WILL land,
    // dimmed "~" shares for each random/chance effect the foe might catch
    B.enemies.forEach(en => {
      const f = sim.foes.find(x => x.ref === en);
      let m = en.dom && en.dom.querySelector('.fc-mark');
      const sure = f && (f.dmg > 0 || f.burnAdd > 0 || f.scareAdd > 0 || f.leechAdd > 0);
      const maybe = f && (f.pdmg > 0 || f.pburn > 0 || f.pscare > 0 || f.pleech > 0);
      if (!en.alive || !f || (!sure && !maybe)) { if (m) m.remove(); return; }
      if (!m) { m = el('div', 'fc-mark'); en.dom.appendChild(m); }
      m.classList.toggle('lethal', !f.alive);
      m.classList.toggle('maybe', !sure);
      let html = '';
      if (f.dmg > 0 || !f.alive) html += (!f.alive ? '💀 ' : '⚔ ') + f.dmg;
      if (f.burnAdd > 0) html += ' <i class="fm-burn">🔥' + f.burnAdd + '</i>';
      if (f.scareAdd > 0) html += ' <i class="fm-scare">☠+' + f.scareAdd + '</i>';
      if (f.leechAdd > 0) html += ' <i class="fm-leech">🩸</i>';
      if (f.pdmg > 0) html += ' <i class="fm-maybe">🎲~' + f.pdmg + '</i>';
      if (f.pburn > 0) html += ' <i class="fm-maybe fm-burn">🔥~' + f.pburn + '</i>';
      if (f.pscare > 0) html += ' <i class="fm-maybe fm-scare">☠~' + f.pscare + '</i>';
      if (f.pleech > 0) html += ' <i class="fm-maybe fm-leech">🩸?</i>';
      m.innerHTML = html.trim();
    });

    // matching projection over the beast — block / heal / buffs / recoil
    const pp = document.getElementById('player-panel');
    if (pp) {
      const bits = [];
      if (sim.shieldGain > 0) bits.push('<i class="fs-shield">◆ ' + sim.shieldGain + '</i>');
      if (sim.heal > 0) bits.push('<i class="fs-heal">♥ ' + sim.heal + '</i>');
      if (sim.strGain > 0) bits.push('<i class="fs-str">✦ +' + sim.strGain + '</i>');
      if (sim.resGain > 0) bits.push('<i class="fs-res">🛡 +' + sim.resGain + '</i>');
      const hurt = sim.selfLoss + sim.playerBurn;
      if (hurt > 0) bits.push('<i class="fs-hurt">⚠ −' + hurt + '</i>');
      let pm = pp.querySelector('.fc-mark-self');
      if (!bits.length) { if (pm) pm.remove(); }
      else {
        if (!pm) { pm = el('div', 'fc-mark fc-mark-self'); pp.appendChild(pm); }
        pm.innerHTML = bits.join('<i class="fs-sep"></i>');
      }
    }
  }
  // light up the socket(s) a hand glyph would fly into
  function markDestSockets(id, on) {
    const row = $('socket-row');
    if (!row) return;
    Array.from(row.children).forEach(s => s.classList.remove('fc-dest'));
    if (!on || !id) return;
    const span = glyph(id).slots || 1;
    const at = firstFreeRun(span);
    if (at === -1) return;
    for (let k = 0; k < span; k++) {
      const s = row.children[at + k];
      if (s) s.classList.add('fc-dest');
    }
  }

  // ============================================================
  // HAND DRAG — press-and-drag reorders the hand; a quick tap still
  // plays the glyph. The press becomes a drag only once the pointer
  // travels past a small slop threshold, so clicks stay clicks.
  // ============================================================
  const handDrag = { active: false };
  const DRAG_SLOP = 8;   // stage px of travel before a press becomes a drag

  function wireHandDrag(tile, idx, playable) {
    tile.addEventListener('pointerdown', (e) => {
      if (!B || B.resolving || B.ended) return;
      if (e.button != null && e.button !== 0) return;
      e.preventDefault();
      // On touch (mobile) a glyph is PLAYED by dragging it onto the sockets, not
      // by tapping. Reordering still works by dragging sideways within the hand.
      const isTouch = (e.pointerType === 'touch');
      const start = Scale.toStage(e.clientX, e.clientY);
      const stepRaw = parseFloat($('hand-row').dataset.step);
      const press = {
        idx, tile, dragging: false, clone: null, centers: null,
        pitch: 150 + (isNaN(stepRaw) ? HAND_GAP : stepRaw),
        targetIdx: idx, isTouch, playable, overDrop: false
      };
      const unwire = () => {
        tile.removeEventListener('pointermove', onMove);
        tile.removeEventListener('pointerup', onUp);
        tile.removeEventListener('pointercancel', onCancel);
      };
      const onMove = (ev) => {
        const p = Scale.toStage(ev.clientX, ev.clientY);
        if (!press.dragging) {
          if (Math.hypot(p.x - start.x, p.y - start.y) < DRAG_SLOP) return;
          // mouse drag only reorders, so it needs ≥2 cards; a touch drag PLAYS a
          // glyph, so it must engage even for a single card in hand
          if (!isTouch && B.hand.length < 2) return;
          beginHandDrag(press);
        }
        moveHandDrag(press, p, ev);
      };
      const onUp = (ev) => {
        unwire();
        if (press.dragging) { endHandDrag(press, false, ev); return; }
        // no drag happened (a tap)
        if (isTouch) {
          // mobile: a tap never plays — it just previews the glyph's tooltip and
          // shows where it would land (there is no hover on touch)
          if (playable && !B.resolving) showGlyphTipPreview(tile, idx);
        } else if (playable && !B.resolving) {
          placeGlyph(idx, tile);
        }
      };
      const onCancel = () => { unwire(); if (press.dragging) endHandDrag(press, true); };
      try { tile.setPointerCapture(e.pointerId); } catch (err) {}
      tile.addEventListener('pointermove', onMove);
      tile.addEventListener('pointerup', onUp);
      tile.addEventListener('pointercancel', onCancel);
    });
  }
  // mobile: the play "drop zone" is anywhere above the hand row (i.e. aimed at
  // the socket strip / battlefield). Dragging up = play; staying level = reorder.
  function pointerOverSocketDrop(ev) {
    if (!ev) return false;
    const hr = $('hand-row');
    if (!hr) return false;
    return ev.clientY < hr.getBoundingClientRect().top - 4;
  }
  // show a hand glyph's tooltip in the universal combat-tip panel (used while a
  // touch drag is in flight, and on a mobile tap to preview)
  function showGlyphDragTip(tile) {
    const html = tipHTMLFor(tile);
    if (html) { ctSource = tile; showCombatTip(html); }
  }
  function showGlyphTipPreview(tile, idx) {
    showGlyphDragTip(tile);
    markDestSockets(B.hand[idx], true);
    renderForecast(B.hand[idx]);
  }
  // neighbours glide aside to open a reorder gap as the dragged card passes them
  function reorderPreview(press, p) {
    const n = press.centers.length;
    const t = Math.max(0, Math.min(n - 1, Math.round((p.x - press.centers[0]) / press.pitch)));
    if (t === press.targetIdx) return;
    press.targetIdx = t;
    Array.from($('hand-row').children).forEach((c, j) => {
      if (j === press.idx) return;
      const pos = j - (j > press.idx ? 1 : 0);
      const fin = pos + (pos >= t ? 1 : 0);
      c.style.transform = fin === j ? '' : 'translateX(' + ((fin - j) * press.pitch) + 'px)';
    });
  }
  function beginHandDrag(press) {
    press.dragging = true;
    handDrag.active = true;
    const row = $('hand-row');
    row.classList.add('dragging');
    // cache every card's resting center (stage space) for the slot math
    press.centers = Array.from(row.children).map(c => stageRectCenter(c).x);
    if (press.centers.length > 1) press.pitch = press.centers[1] - press.centers[0];   // measured beats assumed
    // a floating copy chases the pointer; the original holds its layout slot
    const clone = press.tile.cloneNode(true);
    clone.classList.add('drag-clone');
    clone.classList.remove('combo-next');
    clone.style.opacity = '';
    stage.appendChild(clone);
    press.clone = clone;
    press.tile.classList.add('drag-origin');
    if (press.isTouch) {
      // mobile: lifting a glyph reveals its tooltip (no hover exists on touch)
      showGlyphDragTip(press.tile);
    } else {
      clearCombatTip();
    }
    markDestSockets(null, false);
    renderForecast(null);
    // mouse gets a "lift" click on pickup; on touch the drag IS the play, so we
    // hold the click until release (placeGlyph) to avoid a double select sound
    if (!press.isTouch) SFX.click();
  }
  function moveHandDrag(press, p, ev) {
    if (!press.dragging) return;
    press.clone.style.left = p.x + 'px';
    press.clone.style.top = p.y + 'px';
    if (press.isTouch) {
      // touch: are we aiming at the sockets (play) or sliding within the hand (reorder)?
      const overDrop = press.playable && pointerOverSocketDrop(ev);
      if (overDrop !== press.overDrop) {
        press.overDrop = overDrop;
        press.clone.classList.toggle('drag-to-socket', overDrop);
        if (overDrop) {
          // entering play mode: clear any reorder gaps, light the landing sockets
          press.targetIdx = press.idx;
          Array.from($('hand-row').children).forEach(c => { c.style.transform = ''; });
          markDestSockets(B.hand[press.idx], true);
          renderForecast(B.hand[press.idx]);
        } else {
          markDestSockets(null, false);
          renderForecast(null);
        }
      }
      if (!overDrop) reorderPreview(press, p);
      return;
    }
    reorderPreview(press, p);
  }
  function endHandDrag(press, cancelled, ev) {
    const row = $('hand-row');
    row.classList.remove('dragging');
    Array.from(row.children).forEach(c => { c.style.transform = ''; });
    if (press.clone) press.clone.remove();
    press.tile.classList.remove('drag-origin');
    handDrag.active = false;
    // mobile: dropping a glyph onto the sockets PLAYS it into the next free socket
    if (!cancelled && press.isTouch && press.playable && !B.resolving && pointerOverSocketDrop(ev)) {
      markDestSockets(null, false);
      renderForecast(null);
      placeGlyph(press.idx, press.tile);   // re-renders hand + sockets itself
      return;
    }
    markDestSockets(null, false);
    if (!cancelled && press.targetIdx !== press.idx) {
      const moved = B.hand.splice(press.idx, 1)[0];
      B.hand.splice(press.targetIdx, 0, moved);
      SFX.place(press.targetIdx);
    }
    renderHand(false);
    renderForecast(null);
  }

  // self-targeting glyphs (shield / buff) get their own cast bolt so the
  // socket's firing animation reads as long and satisfying as an attack.
  // The boon goes to the player; a cursed slot ALSO streaks a mirror to the caster.
  function castSelf(fromPos, color) {
    const p = boltAll(center(playerArt()), color);   // twin streams for multi-socket glyphs
    if (RES && RES.cursed && RES.caster && RES.caster.alive) {
      boltAll(center(RES.caster.dom), color);   // mirrored boon also feeds the curse-caster
    }
    return p;
  }

  // active resolution context — lets heal/shield/damage know about a cursed slot
  let RES = null;

  // returns when this glyph's visual + effect is applied
  async function resolveGlyph(id, g, ctx) {
    const fromPos = ctx.originEl ? center(ctx.originEl) : center(playerArt());
    // a multi-socket glyph fires from each of its sockets at once
    const prevOrigins = B.fireOrigins;
    B.fireOrigins = (ctx.originEls && ctx.originEls.length) ? ctx.originEls.map(center) : [fromPos];
    const R = 'var(--' + g.color + ')';
    const gt = gather(ctx) + (g.cloneEmpower || 0) + (ctx.comboBonus || 0) + empowerOf(id);   // Clone +1, Alphabet combo +N, permanent empower
    const prevRES = RES;
    RES = { cursed: !!ctx.cursed, caster: ctx.curseCaster || null };
    try {
      await resolveGlyphInner(id, g, ctx, fromPos, R, gt);
    } finally {
      RES = prevRES;
      B.fireOrigins = prevOrigins;
    }
  }

  // fire a projectile to `to` from every active origin; resolve when the
  // primary (first) bolt lands. Extra origins are cosmetic twin streams.
  function boltAll(to, color, onPrimaryHit) {
    const origins = (B.fireOrigins && B.fireOrigins.length) ? B.fireOrigins : [playerPos()];
    return new Promise(res => {
      origins.forEach((o, i) => bolt(o, to, color, i === 0 ? () => { if (onPrimaryHit) onPrimaryHit(); setTimeout(res, 40); } : null));
    });
  }

  async function resolveGlyphInner(id, g, ctx, fromPos, R, gt) {
    // Gathering Tails empowers DAMAGE only — gtx strips the passive so it does
    // NOT swell Burn / shield / heal (combo + clone empower still apply).
    const gtx = gt - gather(ctx);
    // Ember Ward blessing: shield on each red glyph
    if (g.color === 'red' && root.CG.Game.state.blessings.emberward) gainShield(2);

    // colorless Soul-glyphs resolve from their data-driven fx list
    if (g.colorless && Array.isArray(g.fx)) { await resolveNeutral(g, id, ctx, fromPos, R, gt, gtx); return; }

    switch (baseOf(g.cloneOf || id)) {
      /* -------- JUNK forced on you by enemies -------- */
      case 'rubble':
      case 'deadweight':
        floatText(fromPos, '…', 'status'); await wait(120);
        break;

      /* -------- TROLL -------- */
      case 'smash':
        await hitTargets(targetFirst(), 6 + gt + emberDmg(g), fromPos, R);
        break;
      case 'brace':
        await castSelf(fromPos, R); gainShield(6 + gt); await wait(220);
        break;
      case 'quake':
        await hitTargets(targetAll(), 3 + gt + emberDmg(g), fromPos, R);
        break;
      case 'bulwark_slam':
        await hitTargets(targetFirst(), B.playerShield + gt + emberDmg(g), fromPos, R);
        break;
      case 'hammer':
        await hitTargets(targetFirst(), (B.playerShield > 0 ? 6 : 4) + gt + emberDmg(g), fromPos, R);
        break;
      case 'steady':
        await castSelf(fromPos, R);
        gainShield(4 + (ctx.isFirst ? 2 : 0) + gt);
        await wait(220);
        break;
      case 'boulder':
        await hitTargets(targetFirst(), 8 + gt + emberDmg(g), fromPos, R);
        break;
      case 'iron_skin':
        await castSelf(fromPos, R); gainShield(8 + gt); await wait(220);
        break;
      case 'mend':
        await castSelf(fromPos, R); heal(6 + gt); await wait(220);
        break;
      case 'rockfall': {
        const extra = Math.max(0, (ctx.counts['rockfall'] || 1) - 1);   // other Rockfall this turn
        await hitTargets(targetAll(), 2 + extra + gt + emberDmg(g), fromPos, R);
        break;
      }
      case 'backhand': {
        const prevRed = ctx.prevId && glyph(ctx.prevId).color === 'red' ? 2 : 0;
        await hitTargets(targetRandom(), 5 + prevRed + gt + emberDmg(g), fromPos, R);
        break;
      }
      case 'fortify': {
        await castSelf(fromPos, R);
        const amt = 1 + Math.round(gtx);   // power-up / combo swell the buff
        B.resilience += amt;
        floatText(playerPos(), 'Resilience +' + amt, 'status');
        resilienceFx(playerArt());
        refreshAll(); await wait(220);
        break;
      }
      case 'rampart':
        await castSelf(fromPos, R);
        gainShield(2 * ctx.chainPos + gt);
        await wait(220);
        break;
      case 'spiked_hide': {
        await castSelf(fromPos, R);
        const before = B.playerShield;
        gainShield(5 + gt);
        const reflected = B.playerShield - before;   // honor Resilience / Frail
        if (reflected > 0) await hitTargets(targetRandom(), reflected, fromPos, R);
        await wait(160);
        break;
      }
      case 'crush': {
        const t = targetFirst();
        const noShield = t[0] && (t[0].shield || 0) <= 0 ? 4 : 0;
        await hitTargets(t, 5 + noShield + gt + emberDmg(g), fromPos, R);
        break;
      }
      case 'second_wind': {
        const low = B.monster.hp < B.monster.maxHp / 2 ? 4 : 0;
        await castSelf(fromPos, R); heal(4 + low + gt); await wait(220);
        break;
      }
      case 'avalanche':
        await hitTargets(targetAll(), B.playerShield + gt + emberDmg(g), fromPos, R);
        break;
      case 'bastion': {
        await castSelf(fromPos, R);
        const before = B.playerShield;
        gainShield(10 + gt);
        B.carryShield += (B.playerShield - before);   // this much survives the next turn reset
        floatText(playerPos(), 'Held shield', 'status');
        await wait(220);
        break;
      }
      case 'titans_smash': {
        const bonus = Math.floor(B.playerShield / 3);
        await hitTargets(targetFirst(), 9 + bonus + gt + emberDmg(g), fromPos, R);
        break;
      }
      case 'unbreakable': {
        await castSelf(fromPos, R);
        const amt = 1 + Math.round(gtx);   // power-up / combo swell the buff
        B.monster.runResilience = (B.monster.runResilience || 0) + amt;
        B.resilience += amt;
        floatText(playerPos(), 'Resilience +' + amt + ' (run)', 'status');
        resilienceFx(playerArt());
        refreshAll(); await wait(220);
        break;
      }
      case 'reckoning':
        await hitTargets(targetAll(), 2 * effStrength() + gt + emberDmg(g), fromPos, R, { strength: false });
        break;
      case 'mountains_wrath':
        await hitTargets(targetFirst(), B.playerShield * 2 + gt + emberDmg(g), fromPos, R);
        break;
      case 'aftershock': {
        const volleys = Math.max(1, B.blueThisTurn || 0);
        for (let v = 0; v < volleys; v++) {
          await hitTargets(targetAll(), 3 + gt + emberDmg(g), fromPos, R);
          if (alive().length === 0) break;
        }
        break;
      }
      case 'juggernaut': {
        await castSelf(fromPos, R);
        gainShield(Math.ceil(B.monster.maxHp / 2) + gt);
        await wait(220);
        break;
      }

      /* -------- GHOUL -------- */
      case 'leech': {
        const t = targetCenter();
        await hitTargets(t, 3 + gt + emberDmg(g), fromPos, R);
        if (t[0] && t[0].alive) applyLeech(t[0]);
        break;
      }
      case 'rake': {
        const hitList = [];
        for (let n = 0; n < 2; n++) {
          const t = targetRandom();
          if (t[0]) {
            const bonus = t[0].leech > 0 ? 1 : 0;
            await hitTargets(t, 2 + gt + bonus + emberDmg(g), fromPos, R);
            if (t[0].alive) hitList.push(t[0]);
          }
        }
        if (ctx.isLast && ctx.totalRed === 1) hitList.forEach(e => { if (e.alive) applyLeech(e); });
        break;
      }
      case 'vigor': {
        const gain = 1 + ctx.redAfter + Math.round(gtx);   // +power-up / combo
        await castSelf(fromPos, R);
        B.strength += gain;
        floatText(playerPos(), 'Strength +' + gain, 'status');
        strengthFx(playerArt());
        refreshAll(); await wait(220);
        break;
      }
      case 'blood_harden': {
        const leeched = B.enemies.filter(e => e.alive && e.leech > 0).length;
        await castSelf(fromPos, R); gainShield(2 + leeched + gt); await wait(220);
        break;
      }
      case 'snarl': {
        const base = 0.5 + (ctx.isFirst ? 0.25 : 0);
        const stacks = 1 + Math.round(gtx);   // power-up / combo apply more Scare
        for (const e of alive()) {
          await wait(130);
          if (Math.random() < base) {
            e.scare = (e.scare || 0) + stacks; e.scareTurns = 3;
            floatText(offset(center(e.dom), 0, -60), 'Scared +' + stacks + '!', 'status');
            scareFx(e.dom);
            e.dom.classList.add('hit-flash');
            setTimeout(() => e.dom.classList.remove('hit-flash'), 400);
            SFX.firePurple(0);
          } else {
            floatText(offset(center(e.dom), 0, -60), 'Resist', 'status');
          }
        }
        refreshAll();
        break;
      }
      case 'gnaw':
        await hitTargets(targetFirst(), 4 + gt + emberDmg(g), fromPos, R);
        heal(2 + gtx);
        await wait(160);
        break;
      case 'grave_rot': {
        const all = alive();
        const plain = all.filter(e => !(e.leech > 0));
        const rotted = all.filter(e => e.leech > 0);   // Leeched foes take +2
        if (plain.length) await hitTargets(plain, 3 + gt + emberDmg(g), fromPos, R);
        if (rotted.length) await hitTargets(rotted, 5 + gt + emberDmg(g), fromPos, R);
        break;
      }
      case 'mend_flesh':
        await castSelf(fromPos, R); heal(5 + gtx); await wait(220);
        break;
      case 'bone_wall':
        await castSelf(fromPos, R); gainShield(5 + gt); await wait(220);
        break;
      case 'raise_dead':
        await castSelf(fromPos, R); summonHusks(2, fromPos); await wait(220);
        break;
      case 'exsanguinate': {
        const t = targetCenter();
        await hitTargets(t, 5 + gt + emberDmg(g), fromPos, R);
        if (t[0] && t[0].alive) applyLeech(t[0]);
        heal(3 + gtx);
        await wait(160);
        break;
      }
      case 'dread_howl': {
        const stacks = 1 + Math.round(gtx) + (B.monster.hp < B.monster.maxHp / 2 ? 1 : 0);
        for (const e of alive()) {
          e.scare = (e.scare || 0) + stacks; e.scareTurns = 3;
          floatText(offset(center(e.dom), 0, -60), 'Scared +' + stacks + '!', 'status');
          scareFx(e.dom);
          e.dom.classList.add('hit-flash');
          setTimeout(() => e.dom.classList.remove('hit-flash'), 400);
        }
        SFX.firePurple(0); refreshAll(); await wait(160);
        break;
      }
      case 'soul_harvest': {
        const targets = alive();
        const n = targets.length;
        await hitTargets(targets, 3 + gt + emberDmg(g), fromPos, R);
        for (let i = 0; i < n; i++) heal(1);   // one heal per foe hit — each feeds Gravetide
        await wait(120);
        break;
      }
      case 'blood_pact': {
        await castSelf(fromPos, R);
        const loss = Math.min(4, Math.max(0, B.monster.hp - 1));   // blood magic, never lethal
        if (loss > 0) selfDamage(loss);
        const gain = 3 + Math.round(gtx);
        B.strength += gain;
        floatText(playerPos(), 'Strength +' + gain, 'status');
        strengthFx(playerArt());
        refreshAll(); await wait(220);
        break;
      }
      case 'glutton': {
        const dmg = Math.max(2, 2 * (B.monster.devoured || 0)) + gt + emberDmg(g);
        await hitTargets(targetFirst(), dmg, fromPos, R);
        break;
      }
      case 'plague':
        for (const en of alive()) applyLeech(en);
        await castSelf(fromPos, R); heal(2 + gtx); await wait(200);
        break;
      case 'mass_grave':
        summonHusks(3, fromPos);
        await hitTargets(targetAll(), 2 + gt + emberDmg(g), fromPos, R);
        break;
      case 'lich_ascendant':
        await castSelf(fromPos, R);
        heal(8 + gtx);
        B.strength += 2 + Math.round(gtx);
        floatText(playerPos(), 'Strength +' + (2 + Math.round(gtx)), 'status');
        strengthFx(playerArt());
        refreshAll(); await wait(220);
        break;
      case 'husk':
        await hitTargets(targetRandom(), 1 + gt + emberDmg(g), fromPos, R);
        break;
      case 'maweaten_scrap': {
        await hitTargets(targetRandom(), 5 + gt + emberDmg(g), fromPos, R);
        heal(4 + Math.round(gtx));   // lifesteal — the morsel feeds the beast
        refreshAll(); await wait(160);
        break;
      }

      /* -------- KITSUNE -------- */
      case 'flicker':
        await hitTargets(targetRandom(), 2 + gt + emberDmg(g), fromPos, R);
        break;
      case 'foxfire': {
        const t = targetRandom();
        if (t[0]) { await boltP(fromPos, center(t[0].dom), R); addBurn(t[0], 2 + gtx); }
        await wait(160);
        break;
      }
      case 'onslaught': {
        const hits = ctx.chainPos;   // one volley per glyph played before this
        if (hits <= 0) { floatText(playerPos(), 'no momentum', 'status'); await wait(140); break; }
        for (let h = 0; h < hits; h++) {
          const t = targetRandom();
          if (t[0]) await hitTargets(t, 2 + gt + emberDmg(g), fromPos, R);
        }
        break;
      }
      case 'wildfire': {
        // Burn everyone; already-burning foes gain extra Burn and take that much damage now
        const burnAmt = 1 + gtx;
        for (const en of alive()) {
          const wasBurning = en.burn > 0;
          await boltAll(center(en.dom), R);
          en.burn = (en.burn || 0) + burnAmt;
          floatText(offset(center(en.dom), 0, -64), 'Burn ' + en.burn, 'status');
          en.dom.classList.add('hit-flash');
          setTimeout(() => en.dom.classList.remove('hit-flash'), 400);
          if (wasBurning) {
            await wait(80);
            applyDamage(en, en.burn, { strength: false, scare: false });
          }
          refreshAll();
        }
        // cursed slot: the conflagration also catches you (once)
        if (RES && RES.cursed && !RES.burnMirrored) { RES.burnMirrored = true; addPlayerBurn(burnAmt); }
        await wait(120);
        break;
      }
      case 'mirror': {
        // copy the previous glyph — but if that was itself a Mirror, echo whatever
        // the last Mirror copied (so a run of Mirrors all repeat the same effect)
        const prevBase = ctx.prevId ? baseOf(glyph(ctx.prevId).cloneOf || ctx.prevId) : null;
        const echoId = (prevBase && prevBase !== 'mirror') ? ctx.prevId
          : (prevBase === 'mirror' ? B.lastMirrorTarget : null);
        if (echoId) {
          B.lastMirrorTarget = echoId;
          // the echo carries the mirrored card's OWN upgrades: power (folded in via
          // empowerOf(echoId) inside resolveGlyph) and Combo-up (its extra combo step).
          // Mirror's OWN power-up adds bonus might to the reflection on top of that.
          const echoCtx = Object.assign({}, ctx, {
            mirrored: true,
            comboBonus: (ctx.comboBonus || 0) + Math.max(0, comboAdv(echoId) - 1) + empowerOf(id)
          });
          await resolveGlyph(echoId, glyph(echoId), echoCtx);
        } else {
          floatText(playerPos(), 'no echo', 'status'); await wait(120);
        }
        break;
      }
      case 'spark':
        await hitTargets(targetRandom(), 4 + (ctx.chainPos === 0 ? 2 : 0) + gt + emberDmg(g), fromPos, R);
        break;
      case 'smolder': {
        const t = targetFirst();
        if (t[0]) { await boltP(fromPos, center(t[0].dom), R); addBurn(t[0], 2 + gtx); }
        await wait(150);
        break;
      }
      case 'wisp':
        await hitTargets(targetAll(), 2 + gt + emberDmg(g), fromPos, R);
        break;
      case 'scorch': {
        const t = targetHighest();
        if (t[0]) { await boltP(fromPos, center(t[0].dom), R); addBurn(t[0], 3 + gtx); }
        await wait(150);
        break;
      }
      case 'veil':
        await castSelf(fromPos, R); gainShield(4 + gtx); await wait(220);
        break;
      case 'emberlash':
        for (let n = 0; n < 3; n++) {
          const t = targetRandom();
          if (t[0]) await hitTargets(t, 1 + gt + emberDmg(g), fromPos, R);
        }
        break;
      case 'lick_wounds':
        await castSelf(fromPos, R); heal(5 + gtx); await wait(220);
        break;
      case 'everflame': {
        // gt already folds in the permanent run-empower (shared by every Everflame copy)
        const dmg = 4 + gt + emberDmg(g);
        await hitTargets(targetRandom(), dmg, fromPos, R);
        // each resolve permanently strengthens EVERY Everflame in the deck, for the rest of the run
        const st = root.CG.Game.state;
        st.runEmpower['everflame'] = (st.runEmpower['everflame'] || 0) + 1;
        break;
      }
      case 'conflagration':
        for (const en of alive()) {
          if (en.burn > 0) { await boltAll(center(en.dom), R); applyDamage(en, en.burn + gt, { strength: false }); refreshAll(); }
        }
        await wait(120);
        break;
      case 'foxfire_dance':
        for (const en of alive()) { await boltAll(center(en.dom), R); addBurn(en, 2 + gtx); }
        await wait(120);
        break;
      case 'hoarders_flame': {
        const hits = B.hand.length;   // remaining unplayed cards swell the volley
        if (hits <= 0) { floatText(playerPos(), 'empty hand', 'status'); await wait(140); break; }
        for (let h = 0; h < hits; h++) {
          const t = targetRandom();
          if (t[0]) await hitTargets(t, 2 + gt + emberDmg(g), fromPos, R);
        }
        break;
      }
      case 'nine_tails':
        await hitTargets(targetRandom(), 2 * ctx.chainPos + gt + emberDmg(g), fromPos, R);
        break;
      case 'immolate': {
        const t = targetFirst();
        await hitTargets(t, 5 + gt + emberDmg(g), fromPos, R);
        if (t[0] && t[0].alive) addBurn(t[0], 5);
        break;
      }
      case 'will_o_wisp':
        await hitTargets(targetLowest(), 3 + gt + emberDmg(g), fromPos, R);
        break;
      case 'ember_hoard':
        await castSelf(fromPos, R); gainShield(2 * B.hand.length + gtx); await wait(220);
        break;
      case 'spirit_fire': {
        const n = ctx.totalRed;
        for (const en of alive()) { await boltAll(center(en.dom), R); addBurn(en, n + gtx); }
        await wait(120);
        break;
      }
      case 'nine_tailed_inferno': {
        for (const en of alive()) {
          if (en.burn > 0) {
            await boltAll(center(en.dom), R);
            applyDamage(en, en.burn, { strength: false });
            en.burn = 0; refreshAll();
          }
        }
        for (const en of alive()) addBurn(en, 3 + gtx);
        await wait(140);
        break;
      }
      case 'phoenix': {
        await castSelf(fromPos, R);
        heal(10 + gtx + (B.hand.length === 0 ? 10 : 0));
        await wait(220);
        break;
      }
      case 'trickster_echo':
        if (ctx.prevId && baseOf(ctx.prevId) !== 'trickster_echo') {
          // +3 base reflection power, plus this Echo's own power-up
          await resolveGlyph(ctx.prevId, glyph(ctx.prevId),
            Object.assign({}, ctx, { mirrored: true, comboBonus: (ctx.comboBonus || 0) + 3 + empowerOf(id) }));
        } else {
          floatText(playerPos(), 'no echo', 'status'); await wait(120);
        }
        break;
    }
  }

  // Data-driven resolver for the colorless Soul-glyphs. Damage folds in the
  // full power-up (gt); support effects use gtx (no Gathering-Tails passive).
  async function resolveNeutral(g, id, ctx, fromPos, R, gt, gtx) {
    const pick = t => t === 'all' ? targetAll() : t === 'random' ? targetRandom()
      : t === 'lowest' ? targetLowest() : t === 'highest' ? targetHighest()
      : t === 'center' ? targetCenter() : targetFirst();
    let didSelf = false;
    const selfCast = async () => { if (!didSelf) { didSelf = true; await castSelf(fromPos, R); } };
    for (const step of g.fx) {
      const reps = step.hits || 1;
      for (let h = 0; h < reps; h++) {
        if (alive().length === 0 && (step.op === 'dmg' || step.op === 'burn' || step.op === 'scare')) break;
        switch (step.op) {
          case 'dmg': {
            const tg = pick(step.t || 'first');
            if (tg.length) await hitTargets(tg, (step.v || 0) + gt + emberDmg(g), fromPos, R);
            break;
          }
          case 'shield':
            await selfCast(); gainShield((step.v || 0) + gtx); await wait(150); break;
          case 'heal':
            await selfCast(); heal((step.v || 0) + gtx); await wait(150); break;
          case 'str': {
            await selfCast();
            const a = (step.v || 0) + Math.round(gtx); B.strength += a;
            floatText(playerPos(), 'Strength +' + a, 'status'); strengthFx(playerArt()); await wait(180);
            break;
          }
          case 'res': {
            await selfCast();
            const a = (step.v || 0) + Math.round(gtx); B.resilience += a;
            floatText(playerPos(), 'Resilience +' + a, 'status'); resilienceFx(playerArt()); await wait(180);
            break;
          }
          case 'burn': {
            for (const en of pick(step.t || 'first')) {
              if (en && en.alive) { await boltAll(center(en.dom), R); addBurn(en, (step.v || 0) + gtx); }
            }
            break;
          }
          case 'scare': {
            const stacks = (step.v || 0) + Math.round(gtx);
            for (const en of pick(step.t || 'all')) {
              if (en && en.alive) {
                en.scare = (en.scare || 0) + stacks; en.scareTurns = 3;
                floatText(offset(center(en.dom), 0, -60), 'Scared +' + stacks, 'status');
                scareFx(en.dom);
              }
            }
            break;
          }
        }
        refreshAll();
      }
    }
    await wait(120);
  }

  // apply Burn to one enemy with the standard themed float + flash
  function addBurn(en, n) {
    if (!en || !en.alive || n <= 0) return;
    if (hasPassive('conflagration')) n *= 2;   // Conflagration: every Burn you lay is doubled
    en.burn = (en.burn || 0) + n;
    floatText(offset(center(en.dom), 0, -60), 'Burn ' + en.burn, 'status');
    burnApplyFx(en.dom);
    en.dom.classList.add('hit-flash');
    setTimeout(() => en.dom.classList.remove('hit-flash'), 400);
    // CURSED slot: the burn lands on the enemy as normal, but ALSO catches you.
    // Mirror once per glyph (like damage recoil) so an AoE burn doesn't multi-stack.
    if (RES && RES.cursed && !RES.burnMirrored) {
      RES.burnMirrored = true;
      addPlayerBurn(n);
    }
    refreshAll();
  }

  // Burn applied to the player (cursed-slot recoil). Ticks down each round like enemy Burn.
  function addPlayerBurn(n) {
    if (n <= 0) return;
    B.playerBurn = (B.playerBurn || 0) + n;
    floatText(offset(center(playerArt()), 0, -86), '🔥 Burn ' + B.playerBurn, 'dmg');
    const pd = $('player-monster');
    burnApplyFx(playerArt());
    playerHitReact();
    pd.classList.add('hit-flash');
    setTimeout(() => pd.classList.remove('hit-flash'), 400);
  }

  function applyLeech(en) {
    en.leech = 3; // refresh (does not stack)
    floatText(offset(center(en.dom), 0, -70), 'Leech 3', 'status');
    leechApplyFx(en.dom);
  }

  function offset(p, dx, dy) { return { x: p.x + dx, y: p.y + dy }; }

  // a bolt that resolves a promise when it lands
  function boltP(from, to, color) {
    return new Promise(res => bolt(from, to, color, () => setTimeout(res, 40)));
  }

  // deal `dmg` to each target with projectile; returns total damage dealt.
  // Weak reduces your damage; a cursed slot ALSO recoils the strike onto you
  // (the glyph still hits the enemies — the curse just mirrors it back).
  // A multi-socket glyph fires a twin stream from each of its sockets.
  function hitTargets(targets, dmg, fromPos, color, opts) {
    if (B.playerWeak > 0) dmg = Math.max(1, Math.round(dmg * 0.6));
    const origins = (B.fireOrigins && B.fireOrigins.length) ? B.fireOrigins : [fromPos];
    // the strike's LOOK is the beast's signature (blade/gnaw/fire), not the glyph color
    const st = playerStrikeStyle();
    // CURSED slot: the strike lands on the enemies as normal, but also recoils onto you
    if (RES && RES.cursed) {
      if (st.ranged) {
        origins.forEach((o, oi) => setTimeout(() =>
          bolt(o, center(playerArt()), st.color, oi === 0 ? () => damagePlayer(dmg) : null, st.kind), 40));
      } else {
        setTimeout(() => damagePlayer(dmg), 200);   // melee recoil — no projectile
      }
    }
    return new Promise(resolve => {
      if (!targets.length) { setTimeout(() => resolve(0), (RES && RES.cursed) ? 180 : 0); return; }
      let total = 0, done = 0;
      targets.forEach((tg, k) => {
        const to = center(tg.dom);
        const land = () => {
          // applyDamage fires the beast's signature (slash / bite / foxfire) over the foe
          total += applyDamage(tg, dmg, opts);
          done++;
          if (done === targets.length) setTimeout(() => resolve(total), 60);
        };
        setTimeout(() => {
          if (st.ranged) {
            origins.forEach((o, oi) => bolt(o, to, st.color, oi === 0 ? land : null, st.kind));
          } else {
            land();   // melee: the blade / bite simply strikes over the enemy
          }
        }, k * 70 + (st.ranged ? 0 : 60));
      });
    });
  }

  // how much a living Wardstone shaves off damage to its protected kin (max,
  // not stacked). The Wardstone itself is never warded, so it can be broken.
  function wardReductionFor(target) {
    let w = 0;
    for (const o of B.enemies) {
      if (o.alive && o !== target && o.base && o.base.ward > 0) w = Math.max(w, o.base.ward);
    }
    return w;
  }
  // a Thornmail foe lashes a flat bite back when struck
  function thornsRecoil(en) {
    const n = en.base.thorns;
    floatText(offset(center(en.dom), 0, -68), '🜂 ' + n, 'dmg');
    fxMotes(center(en.dom), 5, '#8fe08f', 'fx-mote-spark', 46);
    damagePlayer(n);
  }

  // apply damage to an enemy. opts.strength (player bonus) and opts.scare default on.
  function applyDamage(en, amount, opts) {
    opts = opts || {};
    if (!en.alive) return 0;
    let amt = amount;
    if (opts.strength !== false) amt += effStrength();
    if (opts.scare !== false) amt += (en.scare || 0);
    amt = Math.max(0, Math.round(amt));
    // WARD: a living Wardstone shaves damage off its protected kin (min 1)
    const ward = wardReductionFor(en);
    if (ward > 0 && amt > 0) amt = Math.max(1, amt - ward);

    const beforeTotal = en.hp + en.shield;
    let remaining = amt;
    if (en.shield > 0) {
      const absorbed = Math.min(en.shield, remaining);
      en.shield -= absorbed; remaining -= absorbed;
      setShieldPip(en.dom, en.shield);
    }
    en.hp = Math.max(0, en.hp - remaining);
    const dealt = beforeTotal - (en.hp + en.shield);
    setBar(en.dom, en.hp, en.maxHp);
    // status ticks (burn/leech) show their own themed number, so skip the -N float
    if (!opts.noFloat) floatText(offset(center(en.dom), (Math.random() * 40 - 20), -40), '-' + amt, 'dmg');
    en.dom.classList.add('hit-flash');
    setTimeout(() => en.dom.classList.remove('hit-flash'), 400);
    // genuine attacks (not burn/leech ticks) play the active beast's signature strike
    if (!opts.noFloat) monsterStrikeFx(en);
    SFX.hit();
    if (amt >= 9) shake();
    if (en.hp <= 0 && en.alive) {
      killEnemy(en, { dmg: dealt, noFeast: opts.noFeast });   // base Feast fires on the kill
    } else if (en.alive && en.base && en.base.thorns > 0 && dealt > 0 && !opts.noFloat && !opts.reflect && !B.ended) {
      // THORNS: a genuine strike (not a burn/leech tick) lashes back, per hit —
      // so dumping multi-hit glyphs into it hurts. Skipped if the blow killed it.
      thornsRecoil(en);
    }
    // Smoldering Tails: every genuine hit lays Burn equal to the current combo
    // (per hit — a multi-hit glyph at combo 3 lays 3 Burn each strike).
    if (en.alive && !opts.noFloat && (B.comboNow || 0) > 0 && hasPassive('smolderingTails')) {
      addBurn(en, B.comboNow);
    }
    // ---- Goblin engines: every genuine tick of YOUR damage feeds the bruiser ----
    // (the Charge Attack's own hits pass opts.charge, and thorns recoil passes
    // opts.reflect, so neither feeds back into the engines)
    if (dealt > 0 && !opts.noFloat && !opts.charge && !opts.reflect) {
      B.tickCount = (B.tickCount || 0) + 1;                      // Berserk Frenzy: combo per tick
      // remember which foes THIS glyph struck — a lone struck foe is a "targeted
      // attack" (Crawler/Demon Feast it precisely; many/none falls back to random)
      if (B._glyphTargets && B._glyphTargets.indexOf(en) === -1) B._glyphTargets.push(en);
      if (hasPassive('overcharge')) {                            // Overcharge: 1 Damage Charge per tick
        B.charge.dmg = (B.charge.dmg || 0) + 1;
        flowChargeInto(center(en.dom));                          // energy flows into the orb
      }
      if (hasPassive('goringhide')) B.playerThorns = (B.playerThorns || 0) + 1;   // Goring Hide: 1 Thorns per hit (this combat)
      // Undead: any genuine tick has a chance to Feast the struck foe
      if (en.alive && !opts.noFeast && hasPassive('undeadfeast') && Math.random() < feastChance()) {
        feast(en, { dmg: dealt });
      }
    }
    return dealt;
  }

  // a satisfying death: a flash + collapse, an ember burst, then the corpse is
  // removed from the formation (no lingering transparent ghost).
  // how grand a foe's demise should be
  function enemyTier(en) {
    const d = (en && en.base) || {};
    if (d.boss) return 'finalboss';
    if (d.floorBoss) return 'floorboss';
    if (d.elite) return 'elite';
    return 'normal';
  }

  // ============================================================
  // FEAST — Ghoul's core: sap predefined bonuses from foes
  // ============================================================
  const DATA = root.CG.DATA;
  function feastChance() {
    if (hasPassive('vampire')) return 0.35;                 // Bloodgorge
    let c = hasPassive('undeadfeast') ? 0.25 : 0;           // Endless Hunger
    if (hasPassive('skinwalker')) c += 0.10;                // Wear Their Skin
    return c;
  }
  // an elite/boss/shadow foe — the only kills Skinwalker hoards permanently
  function feastQualifiesSkin(en) {
    const d = (en && en.base) || {};
    return !d.token && (enemyTier(en) !== 'normal' || d.shadow || d.elite);
  }
  function recordFeastKill(en) {
    const d = (en && en.base) || {};
    if (d.token) return;
    const S = root.CG.Game.state;
    if (!S) return;
    S.feastKills = S.feastKills || [];
    S.feastKills.push({ id: d.id, maxHp: en.maxHp, tier: enemyTier(en), skin: feastQualifiesSkin(en) });
    if (S.feastKills.length > 300) S.feastKills.shift();
  }
  function randomFeastTarget() {
    const pool = alive().filter(e => e.feastPool && e.feastPool.length);
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }
  // Crawler/Demon: a sated Devil Feasts the glyph's struck foe when it was a
  // single-target attack; an AoE or non-attack (no/many distinct foes) is random.
  function devilFeastTarget() {
    const hit = B._glyphTargets || [];
    if (hit.length === 1 && hit[0].alive && hit[0].feastPool && hit[0].feastPool.length) return hit[0];
    return randomFeastTarget();
  }
  function feastBiteFx(en) {
    if (!en || !en.dom) return;
    const p = center(en.dom);
    fxRing(p, '#c061ff', 560, 'fx-ring-soft');
    fxMotes(p, 10, '#e0a6ff', 'fx-mote-rise', 70);
    SFX.firePurple && SFX.firePurple(0);
  }
  // apply a sapped bonus to the CURRENT combat. `amp` (Demon's Insatiable)
  // scales every quantified boon — Devil-triggered Feasts pass demonAmp().
  function applyFeastBonus(b, amp) {
    amp = amp || 1;
    const N = q => Math.max(1, Math.round((q || 0) * amp));
    switch (b.t) {
      case 'str': B.strength += N(b.n); strengthFx(playerArt()); break;
      case 'res': B.resilience += N(b.n); resilienceFx(playerArt()); break;
      case 'thorn': B.playerThorns = (B.playerThorns || 0) + N(b.n); break;
      case 'guard': { const g = N(b.n); B.feastGuard = (B.feastGuard || 0) + g; B.playerShield += g; break; }
      case 'rampstr': { const r = N(b.n); B.feastRamp = (B.feastRamp || 0) + r; B.strength += r; strengthFx(playerArt()); break; }
      case 'weaken': { const w = N(b.n); alive().forEach(e => { e.weak = (e.weak || 0) + w; weakFx(e.dom); }); break; }
      case 'scare': { const s = N(b.n); alive().forEach(e => { e.scare = (e.scare || 0) + s; e.scareTurns = Math.max(e.scareTurns || 0, 3); scareFx(e.dom); }); break; }
      case 'heal': heal(Math.max(1, Math.round(B.monster.maxHp * (b.pct || 0) * amp))); break;
      case 'souls': root.CG.Game.gainSouls(N(b.n)); break;
      case 'purge': feastPurge(); break;
      case 'cleanse': B.feastCleanse = (B.feastCleanse || 0) + 1; feastCleanseNow(); break;
    }
    refreshAll();
  }
  // Base Feast: a slain foe's boon manifests in the NEXT encounter. Banked on
  // the run state and spent at the start of the next combat.
  function bankFeastBoon(b) {
    const S = root.CG.Game.state;
    if (!S) return;
    S.feastBoons = S.feastBoons || [];
    S.feastBoons.push(Object.assign({}, b));
  }
  function applyBankedFeastBoons() {
    const S = root.CG.Game.state;
    const q = (S && S.feastBoons) || [];
    if (!q.length) return;
    S.feastBoons = [];
    q.forEach(b => applyFeastBonus(b, 1));
    floatText(offset(center(playerArt()), 0, -150), '\uD83C\uDF56 Feast boons claimed', 'status');
  }
  function feastPurge() {
    // sweep junk (Dead Weight / Rubble) out of hand and queue, and shrug off the next clog
    B.clogImmune = true;
    B.stuck = [];
    B.injected = [];
    if (B.hand) {
      const keep = B.hand.filter(id => !glyph(id).junk);
      const tossed = B.hand.length - keep.length;
      B.hand = keep;
      if (tossed > 0) floatText(offset(center(playerArt()), 0, -120), 'Purged ' + tossed, 'status');
    }
    renderHand && renderHand(true);
  }
  function feastCleanseNow() {
    // lift one curse from your sockets
    const i = B.slotFx.findIndex(fx => fx && fx.cursed);
    if (i !== -1) { B.slotFx[i].cursed = 0; B.slotFx[i].caster = null; floatText(offset(center(playerArt()), 0, -120), 'Cleansed', 'status'); renderSockets && renderSockets(); }
  }
  // the life a Feast restores. Base: 5% of the feasted foe. Undead: 10% of the
  // damaged foe. Vampire: the triggering damage (kills: 25% of the foe's max HP),
  // with any overheal spilling as damage (heal() handles the Bloodgorge spill).
  function feastHeal(en, opts) {
    opts = opts || {};
    if (hasPassive('vampire')) {
      const h = opts.kill ? Math.round((en.maxHp || 0) * 0.25) : (opts.dmg || 0);
      if (h > 0) heal(h);
    } else if (hasPassive('undeadfeast')) {
      heal(Math.max(1, Math.round((en.maxHp || 0) * 0.10)));
    } else if (opts.kill) {
      heal(Math.max(1, Math.round((en.maxHp || 0) * 0.05)));
    }
  }
  // sap one (or, for Skinwalker, all) of a foe's remaining bonuses. A KILL banks
  // the boon for the next encounter; a mid-combat Feast (Undead tick, Devil sate)
  // pays out now. `devilAmp` scales Devil-triggered boons by Demon's Insatiable.
  function feast(en, opts) {
    opts = opts || {};
    if (!en || !en.feastPool || !en.feastPool.length) return false;
    let taken;
    if (opts.all) taken = en.feastPool.splice(0);
    else taken = [en.feastPool.splice(Math.floor(Math.random() * en.feastPool.length), 1)[0]];
    feastBiteFx(en);
    const amp = opts.devilAmp ? demonAmp() : 1;
    taken.forEach((b, i) => {
      if (opts.kill) bankFeastBoon(b);              // base: manifests next encounter
      else applyFeastBonus(b, amp);                 // tick / Devil sate: here and now
      const tag = opts.kill ? ' (next fight)' : '';
      floatText(offset(center(en.dom), 0, -86 - i * 22), '\uD83C\uDF56 ' + DATA.feastLabel(b) + tag, 'status');
    });
    feastHeal(en, opts);
    return true;
  }
  // Skinwalker: a slain elite/boss leaves a permanent trophy (persistent stats + maxHP)
  // apply a single persistent trophy bonus to the LIVE combat (so a fresh kill
  // is felt immediately, not only at the next combat's applySkinTrophies pass)
  function applySkinLive(b) {
    switch (b && b.t) {
      case 'str': B.strength += b.n; strengthFx(playerArt()); break;
      case 'res': B.resilience += b.n; resilienceFx(playerArt()); break;
      case 'thorn': B.playerThorns = (B.playerThorns || 0) + b.n; break;
      case 'guard': B.feastGuard = (B.feastGuard || 0) + b.n; B.playerShield += b.n; break;
      case 'rampstr': B.feastRamp = (B.feastRamp || 0) + b.n; B.strength += b.n; strengthFx(playerArt()); break;
    }
  }
  function addSkinTrophy(en) {
    const m = B.monster, id = en.base && en.base.id;
    if (!m || !id) return;
    m.skin = m.skin || {};
    DATA.feastTrophyAdd(m.skin, id);                       // bank it permanently
    (DATA.FEAST_SETS[id] || []).forEach(b => applySkinLive(b));   // and feel it now
    const add = Math.max(1, Math.round(en.maxHp * 0.05));
    m.maxHp += add; m.hp += add;
    setBar($('player-monster'), m.hp, m.maxHp);
    floatText(offset(center(playerArt()), 0, -150), 'Trophy claimed! +' + add + ' max HP', 'status');
    refreshAll();
  }
  function applySkinTrophies() {
    const sk = B.monster && B.monster.skin;
    if (!sk) return;
    if (sk.str) B.strength += sk.str;
    if (sk.res) B.resilience += sk.res;
    if (sk.thorn) B.playerThorns = (B.playerThorns || 0) + sk.thorn;
    if (sk.guard) B.feastGuard = (B.feastGuard || 0) + sk.guard;
    if (sk.rampstr) B.feastRamp = (B.feastRamp || 0) + sk.rampstr;
  }
  // central kill: visual + run-log + the base Feast (and Skinwalker hoarding)
  function killEnemy(en, opts) {
    opts = opts || {};
    if (!en || !en.alive) return;
    en.alive = false;
    killEnemyVisual(en);
    recordFeastKill(en);
    if (!opts.noFeast && hasPassive('feast')) {
      const skin = hasPassive('skinwalker') && feastQualifiesSkin(en);
      feast(en, { kill: true, dmg: opts.dmg || 0, all: !!skin });
      if (skin) addSkinTrophy(en);
    }
  }
  function demonAmp() { return hasPassive('demon') ? (1 + 0.33 * (B.devilsFedThisTurn || 0)) : 1; }
  // Wendigo: each glyph you play feeds a lasting color buff (×5 on a Devil sate)
  function wendigoColorBuff(color, mult) {
    let c = color;
    if (c !== 'red' && c !== 'blue' && c !== 'green') c = ['red', 'blue', 'green'][Math.floor(Math.random() * 3)];
    if (c === 'red') { const n = 2 * mult; B.strength += n; floatText(offset(center(playerArt()), 0, -130), 'Str +' + n, 'status'); strengthFx(playerArt()); }
    else if (c === 'blue') { const n = 2 * mult; B.resilience += n; floatText(offset(center(playerArt()), 0, -130), 'Res +' + n, 'status'); resilienceFx(playerArt()); }
    else { const n = Math.max(1, Math.round(B.monster.maxHp * 0.05 * mult)); heal(n); }
    refreshAll();
  }
  // Spectacle scaled to the foe's importance. Kept deliberately light: the
  // blend-mode/blur flame particles are costly, so higher tiers lean on cheap
  // transform/opacity rings + ash and STAGGER their spawns across frames rather
  // than dumping 100+ composited particles into a single frame (which stuttered).
  // the monster ART's visual box in stage space — measures the scaled <img>
  // itself (so the silhouette, not the layout box) so FX center on the body and
  // can scatter across it, rather than clumping at the lower combatant box edge
  function spriteAnchor(en) {
    const Scale = root.CG.Scale;
    const sprEl = en.dom && (en.dom.querySelector('.c-sprite img') || en.dom.querySelector('.c-sprite'));
    const r = (sprEl || en.dom).getBoundingClientRect();
    if (!Scale) return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    const tl = Scale.toStage(r.left, r.top), br = Scale.toStage(r.right, r.bottom);
    return { x: (tl.x + br.x) / 2, y: (tl.y + br.y) / 2, w: br.x - tl.x, h: br.y - tl.y };
  }
  function deathSpectacle(en, tier) {
    const a = spriteAnchor(en);
    const RED = '#ff6a4a', GOLD = '#ffd070', VIO = '#c45cff';
    // spread bursts over a few frames so no single frame pays for everything
    const later = (fn, t) => setTimeout(fn, t);
    // fire a ring at a point SCATTERED across the body (fx/fy are fractions of the
    // half-extent) so the bursts pepper the whole monster instead of stacking a
    // single circle on its midriff
    const ringAt = (fx, fy, color, life, t) =>
      later(() => fxRing({ x: a.x + fx * a.w * 0.5, y: a.y + fy * a.h * 0.5 }, color, life, 'fx-ring-shock'), t || 0);
    if (tier === 'elite') {
      SFX.death();
      enemyAsh(en, 22, 1.1);
      ringAt(0, -0.45, GOLD, 600, 0);
      ringAt(-0.6, 0.1, RED, 560, 90);
      ringAt(0.55, 0.4, GOLD, 560, 180);
      later(() => flameBurst({ x: a.x, y: a.y }, { scale: 1.15, count: 10, sparks: 4, smoke: 1, spread: Math.max(40, a.w * 0.4) }), 50);
      shake(2);
    } else if (tier === 'floorboss') {
      SFX.death(); later(() => SFX.death(), 170);
      enemyAsh(en, 28, 1.2);
      ringAt(0, -0.6, GOLD, 680, 0);
      ringAt(-0.7, -0.1, RED, 640, 90);
      ringAt(0.7, 0.15, GOLD, 640, 180);
      ringAt(-0.2, 0.6, RED, 620, 270);
      later(() => flameBurst({ x: a.x, y: a.y }, { scale: 1.4, count: 14, sparks: 6, smoke: 1, spread: Math.max(48, a.w * 0.45) }), 60);
      deathFlash(0.42, 520, 'rgba(255,220,170,1)');
      shake(2); later(() => shake(2), 300);
    } else if (tier === 'finalboss') {
      // no blur/blend flame particles here — purely cheap rings, ash + a flash,
      // staggered, so the largest sprite's demise doesn't spike a frame
      SFX.death(); later(() => SFX.death(), 200);
      enemyAsh(en, 34, 1.3);
      // a chain of shockwaves walking across the whole silhouette
      ringAt(0, -0.7, GOLD, 720, 0);
      ringAt(-0.75, -0.25, VIO, 700, 90);
      ringAt(0.75, -0.05, GOLD, 700, 180);
      ringAt(-0.4, 0.45, VIO, 680, 270);
      ringAt(0.45, 0.6, RED, 680, 360);
      ringAt(0, 0.15, GOLD, 760, 120);
      deathFlash(0.55, 680, 'rgba(255,245,220,1)');
      shake(3); later(() => shake(2), 340);
    } else {
      SFX.death();
      enemyAsh(en, 16);
      ringAt(0, -0.3, RED, 560, 0);
      ringAt(0.2, 0.35, RED, 560, 90);
      shake(1);
    }
  }
  // Pull a dying enemy OUT of the flex flow, pinned exactly where it stands, so
  // its (possibly long) death animation can't be yanked sideways when a faster
  // neighbouring corpse clears — and so it leaves no collapsing gap that makes
  // others jump. The living siblings FLIP-slide to fill the space it vacates.
  function detachDyingFromFlow(d) {
    const zone = $('enemy-zone'), Scale = root.CG.Scale;
    if (!zone || !Scale || d.style.position === 'absolute') return;
    const sibs = Array.from(zone.querySelectorAll('.combatant.enemy'))
      .filter(c => c !== d && !c.classList.contains('dying') && !c.classList.contains('dead'));
    // settle any reflow tween still running so we read true resting positions
    sibs.forEach(c => { if (c.getAnimations) c.getAnimations().forEach(a => { if (a.id === 'reflow') { try { a.finish(); } catch (e) {} } }); });
    const before = sibs.map(c => { const r = c.getBoundingClientRect(); return Scale.toStage(r.left + r.width / 2, r.top).x; });
    // d may itself be mid-slide from an earlier death's FLIP — bake that live
    // transform into the pin so it freezes exactly where it's *seen*, not where
    // its flow slot is (otherwise it would snap back before the death plays)
    let tx = 0, ty = 0;
    const cs = root.getComputedStyle(d).transform;
    if (cs && cs !== 'none') {
      try { const m = new root.DOMMatrixReadOnly(cs); tx = m.m41; ty = m.m42; } catch (e) {}
    }
    if (d.getAnimations) d.getAnimations().forEach(a => { if (a.id === 'reflow') { try { a.cancel(); } catch (e) {} } });
    // freeze d at its current visual box, then lift it out of the layout
    const left = d.offsetLeft + tx, top = d.offsetTop + ty, w = d.offsetWidth, h = d.offsetHeight;
    d.style.width = w + 'px'; d.style.height = h + 'px';
    d.style.left = left + 'px'; d.style.top = top + 'px';
    d.style.margin = '0'; d.style.position = 'absolute';
    // FLIP the survivors into the newly-centered formation
    sibs.forEach((c, i) => {
      const r = c.getBoundingClientRect();
      const nowX = Scale.toStage(r.left + r.width / 2, r.top).x;
      const dx = before[i] - nowX;
      if (Math.abs(dx) < 1 || typeof c.animate !== 'function') return;
      const anim = c.animate(
        [{ transform: 'translateX(' + dx + 'px)' }, { transform: 'translateX(0)' }],
        { duration: 460, easing: 'cubic-bezier(.4,.05,.25,1)' }
      );
      anim.id = 'reflow';
    });
  }
  function killEnemyVisual(en) {
    if (!en || !en.dom || en.dom.classList.contains('dying')) return;
    const tier = enemyTier(en);
    const intDom = en.dom.querySelector('.intent'); if (intDom) intDom.style.display = 'none';
    deathSpectacle(en, tier);
    const d = en.dom;
    // remove the corpse from the flex flow up front so simultaneous/staggered
    // deaths never shove a still-animating foe around (the clunky "jump")
    detachDyingFromFlow(d);
    // the sprite implode is keyed off the already-present tier-* class, so the
    // death motion pivots from the monster art's own centre (no upward lurch)
    d.classList.add('dying');
    // grander deaths play longer before the corpse clears
    const dur = tier === 'finalboss' ? 1400 : tier === 'floorboss' ? 1250 : tier === 'elite' ? 1150 : 820;
    let finished = false;
    const done = (e) => {
      if (e && e.animationName && e.animationName.indexOf('enemyDeath') !== 0) return;
      if (finished) return;
      finished = true;
      // survivors already slid over when this foe was lifted out of flow at death
      // start, so we just clear the (out-of-flow) corpse now — nothing to reflow
      d.classList.add('dead');
      d.removeEventListener('animationend', done);
    };
    d.addEventListener('animationend', done);
    setTimeout(() => done(), dur);   // safety net if animationend never fires
  }

  // Smoothly re-center the surviving enemies when the formation changes. `mutate`
  // performs the layout change (e.g. hiding the corpse); we measure before/after
  // in stage space and tween each survivor from its old slot to its new one.
  function reflowEnemies(mutate) {
    const zone = $('enemy-zone'), Scale = root.CG.Scale;
    if (!zone || !Scale) { mutate(); return; }
    const movers = Array.from(zone.querySelectorAll('.combatant.enemy'))
      .filter(c => !c.classList.contains('dying') && !c.classList.contains('dead'));
    // settle any FLIP tween still running from a previous (e.g. simultaneous AoE)
    // death so we measure true resting positions, not a sprite mid-glide — that
    // stale read is what made a survivor jump to center clunkily
    movers.forEach(c => { if (c.getAnimations) c.getAnimations().forEach(a => { if (a.id === 'reflow') { try { a.finish(); } catch (e) {} } }); });
    const before = movers.map(c => { const r = c.getBoundingClientRect(); return Scale.toStage(r.left + r.width / 2, r.top).x; });
    mutate();
    movers.forEach((c, i) => {
      const r = c.getBoundingClientRect();
      const nowX = Scale.toStage(r.left + r.width / 2, r.top).x;
      const dx = before[i] - nowX;
      if (Math.abs(dx) < 1 || typeof c.animate !== 'function') return;
      const anim = c.animate(
        [{ transform: 'translateX(' + dx + 'px)' }, { transform: 'translateX(0)' }],
        { duration: 460, easing: 'cubic-bezier(.4,.05,.25,1)' }
      );
      anim.id = 'reflow';
    });
  }

  // a burst of ember/ash motes from the dying foe (count + size scale with tier).
  // origins are SCATTERED across the monster art and centered on its body, then
  // each mote flies outward from where it was born — so it reads as the whole
  // sprite disintegrating, not a single jet near the feet.
  function enemyAsh(en, n, sizeMul) {
    const stage = $('stage');
    if (!stage || !en.dom) return;
    n = n || 12; sizeMul = sizeMul || 1;
    const a = spriteAnchor(en);
    // generous absolute spread (with a large minimum) so the blast clearly fills
    // and overshoots the silhouette regardless of how the art measures
    const spreadX = Math.max(a.w * 0.6, 130) * sizeMul;
    const spreadY = Math.max(a.h * 0.5, 150) * sizeMul;
    for (let i = 0; i < n; i++) {
      // born anywhere across the whole body box
      const ox = (Math.random() * 2 - 1) * spreadX;
      const oy = (Math.random() * 2 - 1) * spreadY;
      const sx = a.x + ox, sy = a.y + oy;
      const p = el('div', 'death-mote', Math.random() < 0.5 ? '🔥' : '✦');
      p.style.left = sx + 'px';
      p.style.top = sy + 'px';
      p.style.fontSize = (24 * sizeMul).toFixed(0) + 'px';
      stage.appendChild(p);
      // then blast FAR outward from the body center, so the debris flies wide
      const outAng = Math.atan2(oy, ox || (Math.random() - 0.5));
      const ang = outAng + (Math.random() - 0.5) * 0.8;
      const dist = (170 + Math.random() * 280) * sizeMul;
      const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist - 60 * sizeMul;
      const dur = 620 + Math.random() * 480;
      p.animate([
        { transform: 'translate(-50%,-50%) translate(0,0) scale(1)', opacity: 1 },
        { transform: `translate(-50%,-50%) translate(${dx}px,${dy}px) scale(.2) rotate(${(Math.random() * 360) | 0}deg)`, opacity: 0 }
      ], { duration: dur, easing: 'cubic-bezier(.2,.6,.3,1)', fill: 'forwards' }).onfinish = () => p.remove();
    }
  }

  function gainShield(amt) {
    let a = amt + (B.resilience || 0);
    if (B.playerFrail > 0) a = Math.floor(a * 0.5);
    if (a <= 0) return;
    // original: shield the player
    B.playerShield += a;
    setShieldPip($('player-monster'), B.playerShield);
    floatText(offset(center(playerArt()), 0, -120), '+' + a + '◆', 'shield');
    shieldGainFx(playerArt());
    // CURSED slot: the boon is ALSO mirrored to the enemy that cast the curse
    if (RES && RES.cursed && RES.caster && RES.caster.alive) {
      const en = RES.caster;
      en.shield += a;
      setShieldPip(en.dom, en.shield);
      floatText(offset(center(en.dom), 0, -50), '+' + a + '◆', 'shield');
    }
    // Shieldlash (Orc): every point of Shield gained lashes a random foe for that
    // much — a genuine hit, so Strength rides along and it feeds combos/charges.
    if (a > 0 && hasPassive('shieldlash')) {
      const t = targetRandom();
      if (t[0] && t[0].alive) {
        bolt(center(playerArt()), center(t[0].dom), '#9fe0ff');
        applyDamage(t[0], a);
      }
    }
  }
  function heal(amt, opts) {
    if (amt <= 0) return;
    opts = opts || {};
    const m = B.monster;
    const room = Math.max(0, m.maxHp - m.hp);
    const applied = Math.min(room, amt);
    if (applied > 0) {
      m.hp += applied;
      setBar($('player-monster'), m.hp, m.maxHp);
      floatText(offset(center(playerArt()), 0, -160), '+' + applied + '♥', 'heal');
      healFx(playerArt());
      // CURSED slot: the life is ALSO mirrored to the enemy that cast the curse
      if (RES && RES.cursed && RES.caster && RES.caster.alive) {
        const en = RES.caster;
        en.hp = Math.min(en.maxHp, en.hp + applied);
        setBar(en.dom, en.hp, en.maxHp);
        floatText(offset(center(en.dom), 0, -50), '+' + applied + '♥', 'heal');
      }
    }
    // Vampire/Bloodgorge: ANY healing past full spills as AoE damage to every
    // foe (the spill itself can't heal you or re-trigger Feast). opts.noSpill
    // lets a caller bank a heal without converting it.
    const spill = amt - applied;
    if (spill > 0 && !opts.noSpill && hasPassive('vampire')) {
      floatText(offset(center(playerArt()), 0, -150), 'Overgorge ' + spill, 'status');
      alive().forEach(e => applyDamage(e, spill, { strength: false, scare: false, reflect: true, noFeast: true }));
      refreshAll();
    }
  }
  function selfDamage(n) {
    if (n <= 0) return;
    B.monster.hp = Math.max(0, B.monster.hp - n);
    setBar($('player-monster'), B.monster.hp, B.monster.maxHp);
    floatText(offset(center(playerArt()), 0, -90), '-' + n, 'dmg');
    const pd = $('player-monster');
    playerHitReact();
    pd.classList.add('hit-flash');
    setTimeout(() => pd.classList.remove('hit-flash'), 400);
    if (B.monster.hp <= 0) handlePlayerDeath();
  }

  // ============================================================
  // SLOT-TYPE BEHAVIORS
  // ============================================================
  const DEVIL_TOKEN = 'maweaten_scrap';   // legacy token id (no longer spawned)

  // ---- DEVIL SOCKET: a craving + lottery -------------------------------------
  // Each turn a Devil socket craves one glyph in your hand and hides a random
  // boon. Play that glyph onto it to claim the boon — any other glyph just
  // resolves normally. Ignore it three turns running and it bites for 1/3 max HP,
  // then craves anew. The hungrier it is (higher ignore), the rarer its boons.
  const DEVIL_FACE = {
    happy: 'assets/Happy Devil.png',
    impatient: 'assets/Impatient Devil.png',
    angry: 'assets/Angry Devil.png',
    frustrated: 'assets/Frustrated Devil.png'
  };
  // boon catalog, in three rarity tiers. `apply` runs AFTER the fed glyph
  // resolves; `preCombo` / `preUpgrade` are handled inline in the chain so they
  // shape the very activation that fed the Devil.
  const DEVIL_BONUSES = [
    /* tier 1 — common */
    { key:'str_c', tier:1, icon:'⚔', label:'+1 Strength', desc:'+1 Strength for this combat.',
      apply: async () => { const n = Math.round(1 * demonAmp()); B.strength += n; floatText(playerPos(), 'Strength +' + n, 'status'); strengthFx(playerArt()); refreshAll(); } },
    { key:'res_c', tier:1, icon:'🛡', label:'+1 Resilience', desc:'+1 Resilience for this combat.',
      apply: async () => { const n = Math.round(1 * demonAmp()); B.resilience += n; floatText(playerPos(), 'Resilience +' + n, 'status'); resilienceFx(playerArt()); refreshAll(); } },
    { key:'souls', tier:1, icon:'💠', label:'+20 Souls', desc:'Gain 20 souls.',
      apply: async () => { const n = Math.round(20 * demonAmp()); root.CG.Game.gainSouls(n); floatText(offset(playerPos(), 0, -40), '+' + n + ' Souls', 'status'); } },
    { key:'heal', tier:1, icon:'♥', label:'Heal 20%', desc:'Heal 20% of max HP.',
      apply: async () => { heal(Math.max(1, Math.ceil(B.monster.maxHp * 0.20 * demonAmp()))); } },
    { key:'combo1', tier:1, icon:'▲', label:'Combo +1', desc:'Extend your combo by 1.', preCombo: 1 },
    /* tier 2 — uncommon */
    { key:'upg_c', tier:2, icon:'⬆', label:'Upgrade (combat)', desc:'Upgrade the fed glyph for the rest of this combat.', preUpgrade:'combat' },
    { key:'burst', tier:2, icon:'🎲', label:'Soul Burst', desc:'Three hits on random foes for 5 + combo each.',
      apply: async (c) => { const d = Math.round((5 + (c.comboLen || 0)) * demonAmp()); for (let i = 0; i < 3; i++) { const t = targetRandom(); if (!t.length) break; await hitTargets(t, d, c.from, 'var(--purple)', { strength:false, scare:false }); if (alive().length === 0) break; } } },
    { key:'scare', tier:2, icon:'☠', label:'Scare 3 (all)', desc:'Scare every foe by 3.',
      apply: async () => { const n = Math.round(3 * demonAmp()); alive().forEach(e => { e.scare = (e.scare || 0) + n; e.scareTurns = 3; scareFx(e.dom); }); SFX.firePurple(0); refreshAll(); await wait(160); } },
    { key:'weak', tier:2, icon:'▼', label:'Weak 3 (all)', desc:'Weaken every foe by 3.',
      apply: async () => { const n = Math.round(3 * demonAmp()); alive().forEach(e => { e.weak = (e.weak || 0) + n; weakFx(e.dom); }); refreshAll(); await wait(160); } },
    { key:'glyph', tier:2, icon:'🜲', label:'Gain a Glyph', desc:'Gain a random glyph for the run.',
      apply: async () => { const id = root.CG.Game.grantRandomGlyph(); if (id) { B.draw.push(id); shuffle(B.draw); floatText(offset(playerPos(), 0, -150), '+ ' + glyph(id).name, 'status'); fxMotes(center(playerArt()), 8, '#caa6ff', 'fx-mote-rise', 60); } } },
    { key:'item', tier:2, icon:'🎒', label:'Gain an Item', desc:'Gain a random item.', apply: async () => { grantRandomDevilItem(); } },
    { key:'combo3', tier:2, icon:'▲▲', label:'Combo +3', desc:'Extend your combo by 3.', preCombo: 3 },
    /* tier 3 — rare */
    { key:'extra', tier:3, icon:'⟳', label:'Extra Turn', desc:'Take another turn right after this one.',
      apply: async () => { B.extraTurn = true; floatText(offset(playerPos(), 0, -40), 'Extra Turn!', 'status'); } },
    { key:'upg_r', tier:3, icon:'⬆', label:'Upgrade (run)', desc:'Permanently upgrade the fed glyph.', preUpgrade:'run' },
    { key:'str_p', tier:3, icon:'⚔', label:'+1 Strength (run)', desc:'Permanent +1 Strength.',
      apply: async () => { B.monster.runStrength = (B.monster.runStrength || 0) + 1; B.strength += 1; floatText(playerPos(), 'Strength +1 (run)', 'status'); strengthFx(playerArt()); refreshAll(); } },
    { key:'res_p', tier:3, icon:'🛡', label:'+1 Resilience (run)', desc:'Permanent +1 Resilience.',
      apply: async () => { B.monster.runResilience = (B.monster.runResilience || 0) + 1; B.resilience += 1; floatText(playerPos(), 'Resilience +1 (run)', 'status'); resilienceFx(playerArt()); refreshAll(); } },
    { key:'kill', tier:3, icon:'💀', label:'Devour a Foe', desc:'Slay a random non-boss enemy.',
      apply: async (c) => {
        const foes = alive().filter(e => !(e.base && (e.base.boss || e.base.floorBoss)));
        if (!foes.length) { B.strength += 1; floatText(playerPos(), 'No prey — Strength +1', 'status'); strengthFx(playerArt()); return; }
        const e = foes[Math.floor(Math.random() * foes.length)];
        floatText(offset(center(e.dom), 0, -60), 'Devoured!', 'status');
        await boltP(c.from, center(e.dom), 'var(--purple)');
        e.hp = 0; if (e.alive) killEnemy(e, {});
      } }
  ];
  function rollDevilBonus(ignore) {
    const w = ignore >= 2 ? [30, 45, 25] : ignore === 1 ? [50, 38, 12] : [70, 27, 3];
    const r = Math.random() * 100;
    const tier = r < w[0] ? 1 : r < w[0] + w[1] ? 2 : 3;
    const opts = DEVIL_BONUSES.filter(b => b.tier === tier);
    return opts[Math.floor(Math.random() * opts.length)];
  }
  function grantRandomDevilItem() {
    const G = root.CG.Game;
    const ITEMS = root.CG.DATA.ITEMS || {};
    const ids = Object.keys(ITEMS).filter(id => G.canAddItem(id));
    if (!ids.length) { G.gainSouls(20); floatText(offset(playerPos(), 0, -40), 'Bags full — +20 Souls', 'status'); return; }
    const id = ids[Math.floor(Math.random() * ids.length)];
    G.addItem(id);
    floatText(offset(playerPos(), 0, -150), '+ ' + ITEMS[id].name, 'status');
  }

  // ---- DEVIL REWARD FINALE -----------------------------------------------------
  // Boons banked during the chain are paid out here, after the combo number has
  // cleared. The grinning Devil rears up where the combo meter sat and HURLS the
  // reward to wherever it belongs — buffs/loot to the hero, wrath to the foes.
  const DEVIL_ENEMY_BOONS = { burst: 1, scare: 1, weak: 1, kill: 1 };
  function devilRewardColor(b) {
    switch (b && b.key) {
      case 'burst': case 'kill': return 'var(--red)';
      case 'scare': return 'var(--purple)';
      case 'weak': return 'var(--blue)';
      case 'heal': case 'glyph': return 'var(--green)';
      default: return '#ffce5e';
    }
  }
  function devilRewardTargets(b) {
    if (b && DEVIL_ENEMY_BOONS[b.key]) {
      const a = alive().filter(e => e.dom);
      if (a.length) return a.map(e => center(e.dom));
    }
    return [playerPos()];
  }
  async function resolveDevilRewards() {
    const q = B._devilRewards || [];
    B._devilRewards = [];
    for (const r of q) {
      if (B.ended) return;
      await playDevilReward(r);
      if (B.ended) return;
    }
  }
  async function playDevilReward(r) {
    const b = r && r.bonus;
    if (!b) return;
    // anchor to the combo meter's spot so the Devil takes the stage it just left
    const meter = $('combo-meter');
    const pos = meter ? center(meter) : { x: (stage.offsetWidth || 1920) - 200, y: 400 };

    const face = el('div', 'devil-reward');
    const img = el('img', 'devil-reward-face');
    img.src = DEVIL_FACE.happy; img.alt = '';
    const lab = el('div', 'devil-reward-label', (b.icon ? b.icon + ' ' : '') + b.label);
    face.appendChild(img); face.appendChild(lab);
    face.style.left = pos.x + 'px'; face.style.top = pos.y + 'px';
    stage.appendChild(face);

    // a menacing entrance
    SFX.firePurple && SFX.firePurple(0);
    fxRing(pos, '#ff486e', 760, 'fx-ring-soft');
    fxRing(pos, '#ffce5e', 540);
    fxMotes(pos, 16, '#ff7a96', 'fx-mote-rise', 96);
    await wait(560);

    // pre-boons (combo / upgrade) already fired mid-chain — this is a pure flourish.
    // every other boon is fired off toward its destination, then resolved on impact.
    const targets = devilRewardTargets(b);
    const col = devilRewardColor(b);
    face.classList.add('cast');
    SFX.reward && SFX.reward();
    await Promise.all(targets.map((tp, k) => new Promise(res => {
      setTimeout(() => boltP(pos, tp, col).then(res), k * 70);
    })));

    if (b.apply && !b.preCombo && !b.preUpgrade) {
      await b.apply({ from: pos, comboLen: r.comboLen || 0, baseId: r.baseId, slot: r.slot });
      refreshAll();
    }

    face.classList.add('exit');
    await wait(360);
    face.remove();
  }

  // ---- per-combat Devil bookkeeping (keyed by socket index) ----
  function devilIdxs() {
    const out = [];
    const n = (B.slotTypes && B.slotTypes.length) || 0;
    for (let i = 0; i < n; i++) if (slotCountAt(i, 'devil') > 0) out.push(i);
    return out;
  }
  function ensureDevils() {
    if (!B.devil) B.devil = {};
    devilIdxs().forEach(i => { if (!B.devil[i]) B.devil[i] = { ignore: 0, crave: null, craveId: null, bonus: null, fed: false }; });
  }
  function devilMoodKey(ignore) { return ignore >= 2 ? 'angry' : ignore === 1 ? 'impatient' : 'happy'; }
  function devilMoodLabel(ignore) { return ignore >= 2 ? 'Starving — best odds!' : ignore === 1 ? 'Impatient' : 'Content'; }
  // each turn (after the draw) every Devil picks a craved glyph + rolls a boon.
  // multiple Devils crave DIFFERENT cards (distinct hand entries, distinct types
  // where possible).
  function assignDevilCravings() {
    ensureDevils();
    const idxs = devilIdxs();
    if (!idxs.length) return;
    const takenId = {};   // a specific hand copy can only be craved once
    idxs.forEach(i => {
      const d = B.devil[i];
      const cands = B.hand.filter(id => { const g = glyph(id); return g && !g.junk && !g.token && !takenId[id]; });
      const usedBases = idxs.map(j => B.devil[j].crave).filter(Boolean);
      const pref = cands.filter(id => usedBases.indexOf(baseOf(id)) === -1);
      const pool = pref.length ? pref : cands;
      if (!pool.length) { d.crave = null; d.craveId = null; d.bonus = null; d.fed = false; return; }
      const pick = pool[Math.floor(Math.random() * pool.length)];
      takenId[pick] = true;
      d.crave = baseOf(pick);
      d.craveId = pick;
      d.bonus = rollDevilBonus(d.ignore);
      d.fed = false;
      d.touched = false;   // did any glyph land on this socket this turn?
    });
  }
  // turn start: any Devil ignored three turns running takes its tithe (1/3 HP)
  function chompStarvedDevils() {
    if (!B.devil) return;
    devilIdxs().forEach(i => {
      const d = B.devil[i];
      if (d && d.ignore >= 3) {
        d.ignore = 0;
        const bite = Math.max(1, Math.ceil(B.monster.maxHp / 3));
        floatText(offset(playerPos(), 0, -40), 'The Devil feasts!', 'status');
        selfDamage(bite); shake(); updateTopbar();
      }
    });
  }
  // turn resolved: a fed Devil resets to content; a Devil left untouched (no
  // glyph played on it at all) grows hungrier. Playing the WRONG glyph on it is
  // not an ignore — you just miss the boon, the mood holds.
  function finalizeDevils() {
    if (!B.devil) return;
    devilIdxs().forEach(i => {
      const d = B.devil[i];
      if (!d) return;
      if (d.fed) d.ignore = 0;
      else if (d.crave && !d.touched) d.ignore += 1;
    });
  }
  function devilFeedFx(i) {
    const sEl = $('socket-row').children[i];
    if (!sEl) return;
    sEl.classList.add('devil-fed');
    setTimeout(() => sEl.classList.remove('devil-fed'), 720);
    fxRing(center(sEl), '#ffd36a', 620);
    fxMotes(center(sEl), 8, '#ffd36a', 'fx-mote-rise', 56);
  }
  // the mood face the socket badge should currently show
  function devilFaceKey(i) {
    const d = B.devil && B.devil[i];
    const here = B.sockets[i];
    // happy if already fed, or a craved glyph rests here — cravings aren't
    // socket-locked, so any Devil's craving sitting on this socket counts
    let happy = !!(d && d.fed);
    if (!happy && here) {
      const hb = baseOf(here);
      happy = devilIdxs().some(k => { const dd = B.devil[k]; return dd && dd.crave && !dd.fed && dd.crave === hb; });
    }
    return happy ? 'happy' : devilMoodKey(d ? d.ignore : 0);
  }
  // a non-craved glyph dropped on the socket: the badge face flips to Frustrated
  // and shakes for a second, then settles back to the mood face
  function devilFrustrate(i) {
    const sEl = $('socket-row').children[i];
    const img = sEl && sEl.querySelector('.slot-badge .devil-emote');
    if (!img) return;
    img.src = DEVIL_FACE.frustrated;
    img.classList.add('devil-shake');
    setTimeout(() => { img.classList.remove('devil-shake'); img.src = DEVIL_FACE[devilFaceKey(i)]; }, 1000);
  }
  // a fragment that completes "Play the craved glyph in this socket to ___"
  function devilBoonTip(b) {
    switch (b && b.key) {
      case 'str_c': return 'gain +1 Strength for this combat';
      case 'res_c': return 'gain +1 Resilience for this combat';
      case 'souls': return 'gain 20 souls';
      case 'heal': return 'heal 20% of your max HP';
      case 'combo1': return 'extend your combo by 1';
      case 'upg_c': return 'upgrade that glyph for the rest of this combat';
      case 'burst': return 'strike random foes three times for 5 + your combo each';
      case 'scare': return 'Scare every foe by 3';
      case 'weak': return 'Weaken every foe by 3';
      case 'glyph': return 'gain a random glyph for your run';
      case 'item': return 'gain a random item';
      case 'combo3': return 'extend your combo by 3';
      case 'extra': return 'take another turn right after this one';
      case 'upg_r': return 'permanently upgrade that glyph';
      case 'str_p': return 'gain a permanent +1 Strength';
      case 'res_p': return 'gain a permanent +1 Resilience';
      case 'kill': return 'slay a random non-boss enemy';
      default: return 'claim a hidden boon';
    }
  }
  // decorate a Devil socket in renderSockets: paint the badge with the mood face
  // and route the current boon offer into the hover tooltip
  function decorateDevilSocket(s, i) {
    const d = B.devil && B.devil[i];
    s.classList.add('has-devil');
    const img = s.querySelector('.slot-badge .devil-emote');
    if (img) img.src = DEVIL_FACE[devilFaceKey(i)];
    if (d && d.crave && d.bonus) {
      s.appendChild(el('div', 'slot-fx-tip devil-tip',
        '<b class="st-name">Devil — ' + devilMoodLabel(d.ignore) + '</b>' +
        'Play the craved glyph in this socket to <b>' + devilBoonTip(d.bonus) + '</b>.'));
    }
  }

  // CATALYST: the color sown in the slot infuses the NEXT glyph with a bonus.
  async function applyCatalyst(color, sEl) {
    const from = sEl ? center(sEl) : playerPos();
    // show the infusion firing out of the glyph regardless of color
    const cc = color === 'red' ? '#ff6a4a' : color === 'blue' ? '#5ab6ff' : '#5fe07a';
    floatText(offset(from, 0, -34), 'Infused ✦', color === 'red' ? 'dmg' : color === 'blue' ? 'shield' : 'heal');
    fxRing(from, cc, 620);
    fxMotes(from, 9, cc, 'fx-mote-rise', 54);
    if (color === 'red') {
      await hitTargets(targetAll(), 3, from, 'var(--red)');
    } else if (color === 'blue') {
      gainShield(3); await wait(200);
    } else {
      heal(6); await wait(200);
    }
  }

  // END OF TURN: glyphs still sitting in your hand fire a parting effect.
  async function processUnplayed() {
    for (const id of B.hand.slice()) {
      const ou = glyph(id).onUnplayed;
      if (!ou) continue;
      const from = playerPos();
      if (ou.kind === 'damageRandom') {
        floatText(from, glyph(id).name, 'status');
        await hitTargets(targetRandom(), ou.value, from, 'var(--red)');
      } else if (ou.kind === 'block') {
        floatText(from, glyph(id).name, 'status');
        gainShield(ou.value);
        await wait(180);
      }
      refreshAll();
      if (alive().length === 0) break;
    }
  }

  // Will-o'-Wisps (Tricktail line): at end of turn each glyph still in hand fires
  // a spectral bolt at a random foe for `dmg` (the turn's highest combo).
  async function willOWisps(dmg) {
    const cards = B.hand.slice();
    if (!cards.length) return;
    floatText(offset(center(playerArt()), 0, -96), '✦ Will-o\u2019-Wisps ✦', 'status');
    for (let i = 0; i < cards.length; i++) {
      const t = targetRandom();
      if (!t.length) break;
      await hitTargets(t, dmg, playerPos(), 'var(--purple)', { strength: false, scare: false });
      if (alive().length === 0) break;
    }
    refreshAll();
  }

  // Foxlights (Tricktail line): at turn start each glyph in hand flickers by its
  // color into a small payoff — red strikes, blue shields, green heals, colorless
  // rolls one of the three.
  function applyFoxlights() {
    if (!hasPassive('foxlights')) return;
    const cards = B.hand.slice();
    if (!cards.length) return;
    let healAcc = 0, blueCount = 0;
    const roll = ['red', 'blue', 'green'];
    cards.forEach(id => {
      let col = glyph(id).color;
      if (col !== 'red' && col !== 'blue' && col !== 'green') col = roll[Math.floor(Math.random() * 3)];
      if (col === 'red') {
        const t = targetRandom();
        if (t[0]) applyDamage(t[0], 1, { scare: false });   // 1 (+Strength), random foe
      } else if (col === 'blue') {
        blueCount += 1;                                       // each blue: 1 (+Resilience) shield
      } else if (col === 'green') {
        healAcc += Math.max(1, Math.round(B.monster.maxHp * 0.05));
      }
    });
    if (blueCount > 0) {
      let a = blueCount * (1 + (B.resilience || 0));
      if (B.playerFrail > 0) a = Math.floor(a * 0.5);
      if (a > 0) {
        B.playerShield += a;
        setShieldPip($('player-monster'), B.playerShield);
        floatText(offset(center(playerArt()), 0, -120), '+' + a + '◆', 'shield');
        shieldGainFx(playerArt());
      }
    }
    if (healAcc > 0) {
      B.monster.hp = Math.min(B.monster.maxHp, B.monster.hp + healAcc);
      setBar($('player-monster'), B.monster.hp, B.monster.maxHp);
      floatText(offset(center(playerArt()), -10, -78), '+' + healAcc, 'heal');
    }
    floatText(offset(center(playerArt()), 0, -100), '✦ Foxlights ✦', 'status');
    refreshAll();
  }

  // CLONE: stamp an empowered copy of the glyph into your next hand (one-shot).
  function queueClone(id, sEl) {
    const base = glyph(id);
    if (base.junk) return;   // never clone enemy junk

    const cid = (base.cloneOf || id) + '#clone' + (B.cloneSeq++);
    B.tempGlyphs[cid] = Object.assign({}, base, {
      id: cid,
      cloneOf: base.cloneOf || id,
      cloneEmpower: (base.cloneEmpower || 0) + 1,
      sticky: false, junk: false,
      desc: base.desc + ' <i>(Clone +' + ((base.cloneEmpower || 0) + 1) + ')</i>'
    });
    B.extras.push(cid);   // additive — does not eat into next turn's draw
    const from = sEl ? center(sEl) : playerPos();
    floatText(offset(from, 0, -10), 'Cloned ⧉', 'status');
    fxRing(from, '#8ad0ff', 640);
    fxMotes(from, 8, '#aee0ff', 'fx-mote-rise', 52);
    const gv = sEl ? sEl.querySelector('.socket-glyph') : null;
    if (gv && gv.animate) gv.animate([
      { transform: 'scale(1)', filter: 'brightness(1)' },
      { transform: 'scale(1.14)', filter: 'brightness(1.5) drop-shadow(0 0 12px #8ad0ff)', offset: 0.4 },
      { transform: 'scale(1)', filter: 'brightness(1)' }
    ], { duration: 560, easing: 'cubic-bezier(.3,1.4,.4,1)' });
  }

  // RAISE DEAD / MASS GRAVE: conjure disposable Husk tokens into your next hand.
  // Husks are one-shot (gone if unused) and aren't real deck cards, so feeding one
  // to the Devil grants its boon WITHOUT shrinking your run deck.
  function summonHusks(n, from) {
    for (let i = 0; i < n; i++) {
      const cid = 'husk#h' + (B.cloneSeq++);
      // each Husk gets a random combo letter, fixed for its (short) lifetime, so it
      // can slot into an A->B->C chain like any real glyph
      const letter = ['A', 'B', 'C'][Math.floor(Math.random() * 3)];
      B.tempGlyphs[cid] = Object.assign({}, GLYPHS.husk, {
        id: cid, cloneOf: 'husk', token: true, sticky: false, junk: false, letter: letter
      });
      B.extras.push(cid);
    }
    floatText(from || playerPos(), 'Raise Dead ⚰ ×' + n, 'status');
  }

  // ============================================================
  // ENEMY TURN
  // ============================================================
  // burn ticks, leech saps, scare decay — all at the top of the enemy turn
  async function processStatusTicks() {
    for (const en of B.enemies) {
      if (!en.alive) continue;
      if (en.burn > 0) {
        const n = en.burn;
        floatText(offset(center(en.dom), 0, -70), '🔥' + n, 'dmg');
        burnTickFx(en.dom);
        applyDamage(en, n, { strength: false, noFloat: true });
        // Conflagration: the fire never burns down — full stack rages every turn
        en.burn = hasPassive('conflagration') ? n : Math.max(0, n - 1);
        await wait(220);
      }
      if (en.alive && en.leech > 0) {
        const sap = Math.max(1, Math.ceil(en.hp * 0.10));
        floatText(offset(center(en.dom), 0, -70), '🩸' + sap, 'status');
        leechTickFx(en.dom, playerArt());
        applyDamage(en, sap, { strength: false, scare: false, noFloat: true });
        heal(sap); // triggers Gravetide
        en.leech -= 1;
        await wait(240);
      }
    }
    // your own Burn (from a cursed burn glyph) ticks here too
    if (B.playerBurn > 0 && !B.ended) {
      const n = B.playerBurn;
      const mon = B.monster;
      floatText(offset(center(playerArt()), 0, -86), '🔥' + n, 'dmg');
      burnTickFx(playerArt());
      damagePlayer(n);
      // if burn KO'd the beast, the swapped-in one shouldn't inherit it
      if (!B.ended && B.monster === mon) B.playerBurn = Math.max(0, n - 1);
      await wait(220);
    }
    // scare lasts a fixed number of turns
    B.enemies.forEach(en => {
      if (en.scareTurns > 0) { en.scareTurns -= 1; if (en.scareTurns <= 0) en.scare = 0; }
    });
    refreshAll();
  }

  async function enemyTurn() {
    B.enemyActing = true;   // block item use while the foes act
    // slot timers + player debuffs decay first, so a freshly-applied "2 turns"
    // lasts both of the player's next two turns
    tickRoundTimers();
    await processStatusTicks();
    if (alive().length === 0) { victory(); return; }
    // Conniving Soul: every fifth turn the foes are robbed of their action
    if (root.CG.Game.state.blessings.conniving && B.turn > 0 && B.turn % 5 === 0) {
      banner('The Soul connives — enemies skip their turn', 1100);
      B.enemies.forEach(en => { if (en.alive) advanceIntent(en); });
      await wait(500);
      refreshAll();
      return;
    }
    // iterate a snapshot — summons join the fight but act next round
    const actors = B.enemies.slice();
    for (const en of actors) {
      if (!en.alive || B.ended) continue;
      await wait(260);
      await doEnemyAction(en, en.intent);
      if (B.ended) return;
      if (en.weak > 0) en.weak = Math.max(0, en.weak - 1);
      // ENRAGE: works itself into a deeper frenzy every turn — permanent, ramping
      // Strength that turns a drawn-out fight lethal. Bumped before the next intent
      // is prepared so the telegraph already reflects the escalation.
      if (en.alive && en.base && en.base.enrage > 0) {
        en.strength = (en.strength || 0) + en.base.enrage;
        en.strengthTurns = 9999;
        floatText(offset(center(en.dom), 0, -52), 'Enrage +' + en.base.enrage, 'status');
        strengthFx(en.dom);
      }
      advanceIntent(en);
      if (en.strengthTurns > 0) { en.strengthTurns--; if (en.strengthTurns === 0) en.strength = 0; }
      refreshAll();
      // a foe can drop itself on its own turn — Thorns recoil, reflected hits,
      // self-inflicted burn — so check the moment it happens instead of waiting
      // for the next round's status tick.
      if (alive().length === 0 && !B.ended) { victory(); return; }
      await wait(140);
    }
    refreshAll();
    if (alive().length === 0 && !B.ended) { victory(); return; }
  }

  async function doEnemyAction(en, intent) {
    switch (intent.type) {
      case 'multi': {
        for (const a of intent.actions) {
          if (!en.alive || B.ended) break;
          await doEnemyAction(en, a);
          if (B.ended) return;
          await wait(200);
        }
        break;
      }
      case 'attack': {
        const hits = intent.hits || 1;
        for (let h = 0; h < hits; h++) {
          let dmg = intent.value;
          if (en.weak > 0) dmg = Math.max(1, Math.round(dmg * 0.55));
          en.dom.querySelector('.intent').style.display = 'none';
          en.dom.style.transition = 'transform .15s';
          en.dom.style.transform = 'translateY(40px) scale(1.06)';
          SFX.enemyHit();
          await wait(160);
          en.dom.style.transform = '';
          damagePlayer(dmg);
          if (B.ended) return;
          // item-granted Thorns: the attacker bleeds for it (reflect flag stops
          // the foe's own Thornmail from recoiling back at us in turn)
          if (B.playerThorns > 0 && en.alive) {
            floatText(offset(center(en.dom), 0, -30), 'Thorns ' + B.playerThorns, 'dmg');
            applyDamage(en, B.playerThorns, { reflect: true, strength: false, scare: false });
            if (B.ended) return;
          }
          if (h < hits - 1) await wait(200);
        }
        break;
      }
      case 'defend':
        en.shield += intent.value;
        setShieldPip(en.dom, en.shield);
        floatText(offset(center(en.dom), 0, -40), '+' + intent.value + '◆', 'shield');
        SFX.fireBlue(0);
        break;
      case 'buff':
        if (intent.turns) {
          en.strength = (en.strength || 0) + (intent.value || 3);
          en.strengthTurns = Math.max(en.strengthTurns || 0, intent.turns);
          floatText(offset(center(en.dom), 0, -40), 'Strength +' + (intent.value || 3), 'status');
        } else {
          en.empower = (en.empower || 0) + (intent.value || 4);
          floatText(offset(center(en.dom), 0, -40), 'Empowered', 'status');
        }
        SFX.firePurple(0);
        break;
      case 'rally': {
        const val = intent.value || 4;
        B.enemies.forEach(o => {
          if (o !== en && o.alive) {
            o.empower = (o.empower || 0) + val;
            floatText(offset(center(o.dom), 0, -40), 'Rallied +' + val, 'status');
            o.dom.classList.add('hit-flash');
            setTimeout(() => o.dom.classList.remove('hit-flash'), 400);
          }
        });
        SFX.firePurple(0);
        await wait(200);
        break;
      }
      case 'curse': {
        const slot = clampSlot(intent.slot);
        B.slotFx[slot].cursed = intent.value;
        B.slotFx[slot].caster = en;
        renderSockets();
        slotCurseFx($('socket-row').children[slot]);
        floatText(playerPos(), 'Slot ' + (slot + 1) + ' Cursed', 'status');
        SFX.firePurple(0);
        await wait(360);
        break;
      }
      case 'sunder': {
        const slot = clampSlot(intent.slot);
        B.slotFx[slot].disabled = intent.value;
        renderSockets();
        slotBanishFx($('socket-row').children[slot]);
        floatText(playerPos(), 'Slot ' + (slot + 1) + ' Sealed', 'status');
        SFX.firePurple(0);
        await wait(360);
        break;
      }
      case 'trash': {
        const n = intent.count || 1;
        if (intent.where === 'hand') {
          for (let i = 0; i < n; i++) B.injected.push('rubble');
          floatText(playerPos(), '+' + n + ' Rubble (hand)', 'status');
        } else {
          for (let i = 0; i < n; i++) root.CG.Game.state.pool.push('rubble');
          floatText(playerPos(), '+' + n + ' Rubble (deck)', 'status');
        }
        SFX.firePurple(0);
        await wait(220);
        break;
      }
      case 'clog':
        if (B.clogImmune) { B.clogImmune = false; floatText(playerPos(), 'Shrugged off!', 'status'); await wait(180); break; }
        if (B.stuck.indexOf('deadweight') === -1) B.stuck.push('deadweight');
        floatText(playerPos(), 'Dead Weight!', 'status');
        SFX.firePurple(0);
        await wait(220);
        break;
      case 'debuff': {
        if (intent.stat === 'frail') { B.playerFrail = intent.value; floatText(playerPos(), 'Frail ' + intent.value, 'status'); weakFx(playerArt()); }
        else { B.playerWeak = intent.value; floatText(playerPos(), 'Weak ' + intent.value, 'status'); weakFx(playerArt()); }
        SFX.firePurple(0);
        await wait(220);
        break;
      }
      case 'summon': {
        if (en.summonsLeft == null) en.summonsLeft = intent.max || 2;
        if (en.summonsLeft > 0 && alive().length < MAX_ENEMIES) {
          en.summonsLeft--;
          spawnEnemy(root.CG.DATA.ENEMIES[intent.who]);
          floatText(offset(center(en.dom), 0, -40), 'Summon!', 'status');
          SFX.firePurple(0);
          await wait(260);
        } else {
          floatText(offset(center(en.dom), 0, -40), '…', 'status');
          await wait(120);
        }
        break;
      }
      case 'regen': {
        const v = intent.value || 6;
        en.hp = Math.min(en.maxHp, en.hp + v);
        setBar(en.dom, en.hp, en.maxHp);
        floatText(offset(center(en.dom), 0, -40), '+' + v + '♥', 'heal');
        healFx(en.dom);
        SFX.fireBlue(0);
        await wait(260);
        break;
      }
      case 'siphon': {
        const v = intent.value || 2;
        bolt(center(playerArt()), center(en.dom), '#c45cff');   // power drains toward the foe
        await wait(140);
        if (intent.stat === 'strength') {
          const taken = Math.min(B.strength, v);
          if (taken > 0) {
            B.strength -= taken;
            en.strength = (en.strength || 0) + taken;
            en.strengthTurns = Math.max(en.strengthTurns || 0, 3);
          }
          floatText(playerPos(), taken > 0 ? 'Strength −' + taken : 'No Strength to drain', 'status');
        } else {
          const taken = Math.min(B.playerShield, v);
          if (taken > 0) {
            B.playerShield -= taken;
            setShieldPip($('player-monster'), B.playerShield);
            en.shield += taken;
            setShieldPip(en.dom, en.shield);
          }
          floatText(playerPos(), taken > 0 ? 'Block −' + taken : 'No Block to drain', 'status');
        }
        SFX.firePurple(0);
        await wait(300);
        break;
      }
    }
  }

  const MAX_ENEMIES = 5;
  function clampSlot(i) {
    const max = B.monster.sockets - 1;
    if (i == null || i < 0) return 0;
    return Math.min(i, max);
  }

  function advanceIntent(en) {
    en.intentIndex = (en.intentIndex + 1) % en.base.intents.length;
    en.intent = prepareIntent(en);
  }

  // clone the upcoming intent + bake in target slot / empower so the telegraph is exact.
  // a base entry may be an ARRAY — that becomes a two-action "multi" telegraph.
  function prepareIntent(en) {
    const entry = en.base.intents[en.intentIndex];
    if (Array.isArray(entry)) {
      return { type: 'multi', actions: entry.map(sub => prepareSubIntent(en, sub)) };
    }
    return prepareSubIntent(en, entry);
  }
  function prepareSubIntent(en, baseSub) {
    const it = Object.assign({}, baseSub);
    if (it.type === 'curse' || it.type === 'sunder') it.slot = chooseTargetSlot(it.type);
    if (it.type === 'attack') {
      let bonus = en.strength || 0;          // lasting Strength from multi-turn self-buffs
      if ((en.empower || 0) > 0) { bonus += en.empower; it.empowered = true; en.empower = 0; }
      if (bonus) it.value += bonus;
    }
    return it;
  }
  function chooseTargetSlot(kind) {
    const n = B.monster.sockets;
    const prefer = [];
    for (let i = 0; i < n; i++) {
      const fx = B.slotFx[i] || {};
      if (kind === 'sunder' && fx.disabled > 0) continue;
      if (kind === 'curse' && fx.cursed > 0) continue;
      prefer.push(i);
    }
    const pool = prefer.length ? prefer : Array.from({ length: n }, (_, i) => i);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function tickRoundTimers() {
    B.slotFx.forEach(fx => {
      if (fx.disabled > 0) fx.disabled--;
      if (fx.cursed > 0) { fx.cursed--; if (fx.cursed <= 0) fx.caster = null; }
    });
    if (B.playerWeak > 0) B.playerWeak--;
    if (B.playerFrail > 0) B.playerFrail--;
  }

  // Enemies grow a little tougher the deeper you climb — modest, incremental
  // bumps to HP and to their attack / guard numbers. Bosses keep their tuned
  // stats; everyone else (summons included) scales with node depth.
  function scaleEnemyDef(def, depth) {
    if (!depth || def.boss) return def;
    const hpMul = 1 + depth * 0.05;
    const atkBonus = Math.round(depth * 0.34);
    const defBonus = Math.round(depth * 0.3);
    const scaleSub = it => {
      const o = Object.assign({}, it);
      if (o.type === 'attack') o.value = it.value + atkBonus;
      else if (o.type === 'defend') o.value = it.value + defBonus;
      return o;
    };
    const intents = def.intents.map(entry => Array.isArray(entry) ? entry.map(scaleSub) : scaleSub(entry));
    return Object.assign({}, def, { maxHp: Math.round(def.maxHp * hpMul), intents });
  }

  function spawnEnemy(def) {
    def = scaleEnemyDef(def, B.depthScale || 0);
    const en = {
      base: def, id: def.id + '#' + (B.enemies.length), name: def.name, emoji: def.emoji, img: def.img,
      maxHp: def.maxHp, hp: def.maxHp, shield: 0,
      weak: 0, burn: 0, leech: 0, scare: 0, scareTurns: 0, empower: 0,
      strength: 0, strengthTurns: 0,
      feastPool: root.CG.DATA.feastPoolFor(def),
      intentIndex: 0, intent: null, alive: true, dom: null
    };
    en.intent = prepareIntent(en);
    const c = el('div', 'combatant enemy summoning');
    c.innerHTML = combatantHTML(en.name, false);
    paintSprite(c, en);
    en.dom = c;
    // FLIP: the already-present foes glide aside to make room as the minion
    // materializes, rather than the flex row snapping to a new layout
    reflowEnemies(() => { $('enemy-zone').appendChild(c); });
    attachIntentTip(en);
    B.enemies.push(en);
    // a little arrival burst once it has a real position on stage
    requestAnimationFrame(() => {
      const Scale = root.CG.Scale;
      if (!Scale) return;
      const r = c.getBoundingClientRect();
      const p = Scale.toStage(r.left + r.width / 2, r.top + r.height / 2);
      fxRing(p, '#b07bff', 620);
      fxMotes(p, 10, '#c9a3ff', 'fx-mote-rise', 70);
    });
    setTimeout(() => c.classList.remove('summoning'), 460);
    refreshAll();
  }

  function damagePlayer(dmg) {
    let remaining = dmg;
    // Stonehide: flat damage reduction (min 1)
    if (B.monster.passive === 'stonehide') {
      remaining = Math.max(1, remaining - B.monster.passiveVal);
    }
    // Stoneblood blessing: further flat reduction (min 1)
    if (root.CG.Game.state.blessings.stoneblood) {
      remaining = Math.max(1, remaining - 1);
    }
    if (B.playerShield > 0) {
      const absorbed = Math.min(B.playerShield, remaining);
      B.playerShield -= absorbed; remaining -= absorbed;
      setShieldPip($('player-monster'), B.playerShield);
      if (absorbed > 0) floatText(offset(center(playerArt()), -60, -80), '-' + absorbed + '◆', 'shield');
    }
    if (remaining > 0) {
      B.monster.hp = Math.max(0, B.monster.hp - remaining);
      setBar($('player-monster'), B.monster.hp, B.monster.maxHp);
      floatText(offset(center(playerArt()), 30, -60), '-' + remaining, 'dmg');
      const pd = $('player-monster');
      playerHitReact();
      pd.classList.add('hit-flash');
      setTimeout(() => pd.classList.remove('hit-flash'), 400);
      shake();
      grudgeFromDamage(remaining);   // War Grudge: punishment becomes power
    }
    if (B.monster.hp <= 0) handlePlayerDeath();
  }

  function handlePlayerDeath() {
    // Soul Jar: if the player carries one, it shatters to revive the falling
    // beast at 30% HP instead of letting it die — then the jar is spent.
    if (root.CG.Game.consumeRevive && root.CG.Game.consumeRevive()) {
      const back = Math.max(1, Math.ceil(B.monster.maxHp * 0.30));
      B.monster.hp = back;
      B.monster.alive = true;
      setBar($('player-monster'), B.monster.hp, B.monster.maxHp);
      floatText(offset(center(playerArt()), 0, -120), 'Soul Jar! Revived', 'heal');
      healFx(playerArt());
      SFX.reward();
      refreshAll();
      return;
    }
    B.monster.alive = false;
    B.monster.hp = 0;
    SFX.death();
    const next = root.CG.Game.firstAlive();
    if (next === -1) {
      B.ended = true;
      banner('Defeat', 1600);
      setTimeout(() => onLoseCb && onLoseCb(), 1500);
      return;
    }
    // swap in next beast
    root.CG.Game.state.activeIndex = next;
    B.monster = root.CG.Game.state.monsters[next];
    B.playerShield = (B.monster.passive === 'startShield') ? B.monster.passiveVal : 0;
    B.strength = B.monster.runStrength || 0; B.resilience = B.monster.runResilience || 0; B.turnStrength = 0;
    if (root.CG.Game.state.blessings.warbanner) B.strength += 2;
    if (root.CG.Game.state.blessings.rawmuscle) B.strength += 3;
    if (root.CG.Game.state.blessings.blackfeather) B.resilience += 3;
    B.carryShield = 0; B.playerBurn = 0;
    B.comboCarry = 0; B.comboNow = 0;
    B.playerThorns = 0; B.dmgTakenBank = 0;
    B.feastGuard = 0; B.feastRamp = 0; B.feastCleanse = 0;
    applySkinTrophies();   // a swapped-in Skinwalker keeps its permanent trophies
    B.charge = { dmg: 0, weak: 0, scare: 0, burn: 0 };   // a swapped-in beast starts with a clean Charge
    clearChargeOrb(true);
    // adopt the incoming beast's socket layout; clear any held/cloned carry-over
    B.slotTypes = Array.from({ length: B.monster.sockets }, (_, i) => (B.monster.slotTypes && B.monster.slotTypes[i]) || 'normal');
    B.extras = []; B.injected = []; B.tempGlyphs = {}; B.lastTurnPlays = [];
    B.resolveCount = {};
    B.devil = {};   // fresh cravings for the incoming beast's sockets
    // fresh deck for the incoming beast
    B.draw = shuffle(root.CG.Game.state.pool.slice()); B.discard = []; B.drawnThisTurn = [];
    B.spanHead = new Array(B.monster.sockets).fill(null);
    banner(B.monster.name + ' steps in!', 1100);
    renderPlayer();
    refreshAll();
  }

  // ============================================================
  // END STATES
  // ============================================================
  function victory() {
    if (B.ended) return;
    B.ended = true;
    B.resolving = false;
    SFX.victory();
    banner('Victory', 1500);
    setTimeout(() => onWinCb && onWinCb(), 1400);
  }

  function banner(text, dur) {
    const b = $('battle-banner');
    b.textContent = text;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    setTimeout(() => b.classList.remove('show'), dur || 1400);
  }

  // ============================================================
  // DEBUG CHEATS (operate on the live battle)
  // ============================================================
  function inBattle() { return !!(B && B.monster && !B.ended); }

  const Debug = {
    heal() {
      if (!inBattle()) return;
      const m = B.monster;
      m.maxHp = Math.max(m.maxHp, 99);
      m.hp = m.maxHp;
      refreshAll();
      floatText(playerPos(), '+HP', 'heal');
    },
    strength() {
      if (!inBattle()) return;
      B.strength = 99;
      refreshAll();
      floatText(playerPos(), 'Strength 99', 'status');
    },
    allGlyphs() {
      if (!inBattle()) return;
      B.hand = Object.keys(GLYPHS).filter(id => !GLYPHS[id].junk);
      renderHand(true);
      $('btn-detonate').disabled = B.sockets.every(s => s === null);
    },
    maxSlots() {
      if (!inBattle()) return;
      B.monster.sockets = 9;
      while (B.slotFx.length < 9) B.slotFx.push({ disabled: 0, cursed: 0, caster: null });
      while (B.slotTypes.length < 9) B.slotTypes.push('normal');
      const next = B.sockets.slice();
      while (next.length < 9) next.push(null);
      B.sockets = next;
      renderSockets();
    },
    killAll() {
      if (!inBattle()) return;
      B.enemies.forEach(en => {
        if (!en.alive) return;
        en.hp = 0; en.alive = false;
        setBar(en.dom, 0, en.maxHp);
        killEnemyVisual(en);
      });
      victory();
    },
    // ---- run/meta cheats (handled by the Game module) ----
    gold() { const G = root.CG.Game; if (G && G.debugGold) G.debugGold(); },
    anyNode() { const G = root.CG.Game; return (G && G.debugToggleAnyNode) ? G.debugToggleAnyNode() : false; },
    secretShop() { const G = root.CG.Game; if (G && G.debugSecretShop) G.debugSecretShop(); }
  };

  // ============================================================
  // WIRING
  // ============================================================
  function init() {
    $('btn-detonate').addEventListener('click', detonate);

    // ---- debug menu ----
    const modal = $('debug-modal');
    const open = () => { modal.classList.remove('hidden'); SFX.click && SFX.click(); };
    const close = () => modal.classList.add('hidden');
    const dbtn = $('btn-debug');
    if (dbtn) dbtn.addEventListener('click', open);
    const dclose = $('btn-debug-close');
    if (dclose) dclose.addEventListener('click', close);
    if (modal) {
      modal.addEventListener('click', e => { if (e.target === modal) close(); });
      modal.querySelectorAll('[data-debug]').forEach(b => {
        b.addEventListener('click', () => {
          const key = b.dataset.debug;
          const fn = Debug[key];
          if (!fn) return;
          const res = fn();
          if (key === 'anyNode') {
            b.classList.toggle('debug-on', !!res);
            b.textContent = res ? '🧭 Any Node: ON' : '🧭 Any Node: OFF';
          }
          // navigation cheats leave the menu
          if (key === 'killAll' || key === 'secretShop') close();
        });
      });
    }
  }

  // ============================================================
  // ITEMS — consumables used from the top-HUD tray during combat
  // ============================================================
  function inCombat() {
    const scr = $('screen-battle');
    return !!(B && !B.ended && B.monster && B.monster.alive && scr && scr.classList.contains('is-active'));
  }
  function combatBusy() { return !!(B && (B.resolving || B.enemyActing || B.itemBusy)); }

  // pull a CHOSEN glyph from the draw/discard pile straight into the hand.
  // Returns a promise: true if a card was taken, false if cancelled/empty.
  // a glyph's detail formatted for the universal combat-tip panel (header +
  // body), reused by the Emergency Phial chooser so it shares the same look
  function chooserTipHTML(id) {
    const g = glyph(id);
    let emblems = '';
    const lc = g.letter;
    if (lc) emblems += '<span class="te-chip ' + (lc === 'wild' ? 'wild' : 'l-' + lc) + '">' + (lc === 'wild' ? '✦' : lc) + '</span>';
    const emp = empowerOf(id);
    if (emp > 0) emblems += '<span class="te-up te-up-power">✦+' + emp + '</span>';
    if (comboAdv(id) > 1) emblems += '<span class="te-up te-up-combo">▲▲</span>';
    return '<div class="ct-head">' + (emblems ? '<span class="ct-emblems">' + emblems + '</span>' : '') + g.name + '</div>' +
      '<div class="ct-body">' + fmtDesc(id, handEnv(id)) + upgradeTipSuffix(id) + '</div>';
  }

  // add a single glyph to hand and animate ONLY it in (flying from the deck),
  // while the cards already in hand slide smoothly aside to make room (FLIP)
  function tutorAddToHand(id) {
    const row = $('hand-row');
    const oldTiles = Array.from(row.children);
    const oldC = oldTiles.map(c => stageRectCenter(c));   // where each card sits now
    B.hand.push(id);
    B.drawnThisTurn.push(id);   // a real deck card — routed to discard at end of turn
    renderHand(false);          // rebuild without the full-hand draw sweep
    const newTiles = Array.from(row.children);
    const newCard = newTiles[newTiles.length - 1];
    // FLIP: every pre-existing card is snapped back to its OLD position, then
    // released on the next frame so it glides to its new centered spot. The
    // tiles are fresh DOM nodes (so the CSS margin-transition can't fire), which
    // is exactly why we drive the slide with an inline transform here.
    for (let i = 0; i < oldC.length && i < newTiles.length - 1; i++) {
      const tile = newTiles[i];
      const nc = stageRectCenter(tile);
      const dx = oldC[i].x - nc.x, dy = oldC[i].y - nc.y;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      tile.style.transition = 'none';
      tile.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        tile.style.transition = 'transform .36s cubic-bezier(.2,.85,.3,1)';
        tile.style.transform = 'translate(0, 0)';
        setTimeout(() => { tile.style.transition = ''; tile.style.transform = ''; }, 420);
      });
    }
    if (newCard) animateDraw([newCard]);   // only the chosen glyph flies in
  }

  function tutorGlyph() {
    return new Promise(resolve => {
      // recall from BOTH the draw pile and the discard pile
      const inDraw = {}, inDisc = {};
      B.draw.forEach(id => { inDraw[id] = true; });
      B.discard.forEach(id => { inDisc[id] = true; });
      const seen = {}, uniq = [];
      B.draw.concat(B.discard).forEach(id => { if (!seen[id]) { seen[id] = 1; uniq.push(id); } });
      if (!uniq.length) { floatText(playerPos(), 'No glyphs to recall', 'status'); resolve(false); return; }

      const ct = $('combat-tip');
      const ctHome = ct ? { parent: ct.parentNode, next: ct.nextSibling } : null;
      const overlay = el('div', 'item-choose phial-choose');
      overlay.innerHTML =
        '<div class="ic-veil"></div>' +
        '<div class="ic-panel">' +
          '<div class="ic-phial-wrap">' +
            '<div class="ic-phial">' +
              '<span class="ph-neck"></span>' +
              '<span class="ph-body"><span class="ph-liquid"></span>' +
                '<span class="ph-bub b1"></span><span class="ph-bub b2"></span><span class="ph-bub b3"></span>' +
              '</span>' +
            '</div>' +
            '<span class="ic-phial-glow"></span>' +
          '</div>' +
          '<h3 class="ic-title">Emergency Phial</h3>' +
          '<p class="ic-sub">Shatter the vial and rip one glyph screaming back into your hand.</p>' +
          '<div class="ic-grid"></div>' +
          '<button class="btn btn-ghost ic-cancel">Keep it corked</button>' +
        '</div>';
      const grid = overlay.querySelector('.ic-grid');
      const finish = taken => {
        if (ct && ctHome) {
          ct.classList.remove('over-modal');
          ctHome.parent.insertBefore(ct, ctHome.next);   // return the tip to the battle layer
        }
        clearCombatTip();
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve(!!taken);
      };
      uniq.forEach((id, k) => {
        const g = glyph(id);
        const tile = el('div', 'ic-tile');
        tile.style.setProperty('--g-color', 'var(--' + (g.color || 'gold') + ')');
        tile.style.animationDelay = (k * 38) + 'ms';
        // the real hand-style glyph art (carved hex plate or bespoke image),
        // including the diagonal stack for multi-socket glyphs
        const artWrap = el('div', 'ic-art');
        artWrap.appendChild(glyphStack(id, g.slots || 1));
        tile.appendChild(artWrap);
        const lc = g.letter;
        if (lc) tile.appendChild(el('span', 'ic-chip ' + (lc === 'wild' ? 'wild' : 'l-' + lc), lc === 'wild' ? '✦' : lc));
        tile.appendChild(el('div', 'ic-name', g.name));
        // show where this copy is being torn from
        tile.appendChild(el('span', 'ic-src ' + (inDraw[id] ? 'src-draw' : 'src-disc'), inDraw[id] ? 'Deck' : 'Discard'));
        tile.addEventListener('mouseenter', () => { SFX.hover(); showCombatTip(chooserTipHTML(id)); });
        tile.addEventListener('mouseleave', () => clearCombatTip());
        tile.addEventListener('click', () => {
          let i = B.draw.indexOf(id);
          if (i !== -1) B.draw.splice(i, 1);
          else { i = B.discard.indexOf(id); if (i !== -1) B.discard.splice(i, 1); }
          SFX.recall();
          finish(true);          // clear the overlay so the glyph flies into a clean hand
          tutorAddToHand(id);    // only the chosen glyph animates in; the rest slide aside
          updatePiles();
        });
        grid.appendChild(tile);
      });
      overlay.querySelector('.ic-cancel').addEventListener('click', () => { SFX.click(); finish(false); });
      overlay.querySelector('.ic-veil').addEventListener('click', () => finish(false));
      $('stage').appendChild(overlay);
      // move the universal tooltip INTO the overlay (after the blur veil) so it
      // renders above the dark backdrop and stays fully readable while choosing
      if (ct) { ct.classList.add('over-modal'); overlay.appendChild(ct); clearCombatTip(); }
    });
  }

  // apply a consumable's COMBAT effect. Returns true if it actually fired (so
  // the caller can spend the item); false if it couldn't be used / was cancelled.
  async function applyCombatItem(id) {
    if (!inCombat() || combatBusy()) return false;
    const ITEMS = root.CG.DATA.ITEMS || {};
    const it = ITEMS[id]; if (!it) return false;
    const e = it.effect || {};
    const from = playerPos();
    B.itemBusy = true;
    try {
    switch (e.kind) {
      case 'heal': SFX.reward(); heal(Math.max(1, Math.ceil(B.monster.maxHp * e.pct))); break;
      case 'soulHeal': SFX.reward(); heal(B.monster.maxHp); break;
      case 'shield': SFX.fireBlue(0); gainShield(e.value); break;
      case 'damageAll':
        SFX.detonate(); fxRing(from, 'var(--red)', 560);
        // a thrown blade deals its flat damage — not boosted by Strength/Scare
        await hitTargets(targetAll(), e.value, from, 'var(--red)', { strength: false, scare: false });
        break;
      case 'acid':
        SFX.firePurple(0);
        alive().forEach(en => {
          if (en.shield > 0) { en.shield = 0; setShieldPip(en.dom, 0); }
          en.weak = Math.max(en.weak || 0, e.weak || 3);
          floatText(offset(center(en.dom), 0, -40), 'Acid · Weak ' + (e.weak || 3), 'status');
          weakFx(en.dom);
        });
        refreshAll(); await wait(280);
        break;
      case 'thorns':
        SFX.fireGreen(0);
        B.playerThorns += e.value;
        floatText(offset(center(playerArt()), 0, -120), 'Thorns +' + e.value, 'status');
        fxRing(from, '#7bd88f', 560);
        refreshAll();
        break;
      case 'buff':
        SFX.act();
        B.strength += e.str; B.resilience += e.res;
        floatText(offset(center(playerArt()), 0, -120), 'STR +' + e.str + ' · RES +' + e.res, 'status');
        strengthFx(playerArt());
        refreshAll();
        break;
      case 'blessing':
        SFX.reward();
        if (root.CG.Game.grantRandomBlessing) root.CG.Game.grantRandomBlessing(e.rarity);
        floatText(offset(center(playerArt()), 0, -120), 'Blessing claimed!', 'status');
        break;
      case 'tutor': {
        const ok = await tutorGlyph();
        if (!ok) return false;   // cancelled / empty — do NOT consume the item
        break;
      }
      default: return false;
    }
    await wait(120);
    return true;
    } finally { B.itemBusy = false; }
  }

  root.CG = root.CG || {};
  root.CG.Battle = { start, init, debug: Debug, useItem: applyCombatItem, inCombat, busy: combatBusy };

})(window);
