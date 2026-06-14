/*
 * Chaos Glyphs — balance simulator
 * --------------------------------
 * A standalone Monte-Carlo model of a Classic run, written to MIRROR the real
 * combat formulas in js/battle.js and js/data.js (see RECON notes inline). Its
 * job is to estimate the probability a player CLEARS each floor for three run
 * "archetypes" (bad / average / great) per hero, so we can tune difficulty
 * toward the design targets.
 *
 * It is a model, not the engine: card resolution is abstracted to role+value,
 * the play policy is a greedy chain-builder, and enemy AI is the intent
 * rotation. Absolute win-rates are estimates; the value is in the relative
 * curve (floor ramp, archetype spread, hero deltas) and in anchoring the
 * difficulty knobs. Run:  node tools/balance/sim.js
 */
'use strict';

// ----------------------------------------------------------------------------
// 1. Difficulty knobs  (mirror js/battle.js scaleEnemyDef — keep in sync!)
// ----------------------------------------------------------------------------
const EV = process.env;
const num = (k, d) => (EV[k] !== undefined ? parseFloat(EV[k]) : d);
// Defaults below MIRROR the shipped values in js/battle.js (scaleEnemyDef) so that
// `node sim.js` reproduces the live game's curve. Override any via env var to sweep.
const K = {
  SCALE_REF_HP: num('REF_HP', 40),
  HP_P: num('HP_P', 0.063),        // progHpMul = 1 + HP_P*d + HP_Q*d^2
  HP_Q: num('HP_Q', 0.0017),
  tierHp:  { normal: num('NORM_HP', 1.0), elite: num('ELITE_HP', 1.35), boss: num('BOSS_HP', 1.4) },
  tierDmg: { normal: num('NORM_DMG', 1.0), elite: num('ELITE_DMG', 1.05), boss: num('BOSS_DMG', 1.0) },
  SNOWBALL: num('SNOWBALL', 1.0),  // scales enrage / Hunger per-turn strength gain (1.0 = shipped)
  DMG_LIN: num('DMG_LIN', 0.024)
};
function progHpMul(d) { return 1 + K.HP_P * d + K.HP_Q * d * d; }
// Damage scales LINEARLY (gentler than HP's quadratic) so deep fights stay
// survivable — "in proportion but not at health-levels".
function progDmgMul(d) { return 1 + K.DMG_LIN * d; }

// ----------------------------------------------------------------------------
// 2. RNG (seedable, so runs are reproducible)
// ----------------------------------------------------------------------------
let _seed = 1234567;
function srand(s) { _seed = s >>> 0; }
function rnd() { // mulberry32
  _seed |= 0; _seed = (_seed + 0x6D2B79F5) | 0;
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function ri(n) { return Math.floor(rnd() * n); }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = ri(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

// ----------------------------------------------------------------------------
// 3. strMul (mirror data.js strMulBase/strMulOf)
// ----------------------------------------------------------------------------
function strMulBase(g) {
  if (typeof g.strMul === 'number') return g.strMul;
  const h = g.hits || 1;
  if (h <= 1) return 0.9;
  return Math.max(0.2, Math.round((0.9 / Math.pow(h, 0.62)) * 20) / 20);
}
function strMulOf(g, upgrades) {
  const step = g.multi ? 0.04 : 0.1;
  return Math.round((strMulBase(g) + step * (upgrades || 0)) * 100) / 100;
}

// ----------------------------------------------------------------------------
// 4. Glyph library  (base numbers from data.js; role-abstracted)
//    fields: L=letter, dmg, hits, aoe, multi, block, heal, burn, strSelf, red
// ----------------------------------------------------------------------------
const G = {
  // --- Goblin ---
  smash:   { L: 'A', dmg: 6, red: true },
  brace:   { L: 'B', block: 6 },
  quake:   { L: 'C', dmg: 3, aoe: true, multi: true, red: true }, // AoE once each (multi only affects strMul/cf)
  hammer:  { L: 'B', dmg: 5, red: true },           // ~4-6, use 5 avg
  steady:  { L: 'C', block: 5 },
  boulder: { L: 'A', dmg: 8, red: true },
  ironskin:{ L: 'B', block: 8 },
  mend:    { L: 'B', heal: 6 },
  bastion: { L: 'A', block: 10, carry: true },
  crush:   { L: 'C', dmg: 7, red: true },           // 5 +4 if unshielded ~7
  // --- Ghoul ---
  leech:   { L: 'A', dmg: 3, leech: 3, red: true },  // applies Leech 3 -> heals you each enemy turn
  rake:    { L: 'B', dmg: 2, hits: 2, multi: true, red: true },
  gnaw:    { L: 'A', dmg: 4, heal: 2, red: true },
  bloodharden:{ L: 'C', block: 4 },
  mendflesh:{ L: 'B', heal: 5 },
  graverot:{ L: 'C', dmg: 4, aoe: true, red: true }, // 3 +2 vs leeched; AoE once each
  bonewall:{ L: 'B', block: 5 },
  exsang:  { L: 'A', dmg: 5, heal: 3, leech: 3, red: true },
  // --- Kitsune ---
  flicker: { L: 'A', dmg: 2, red: true },
  foxfire: { L: 'B', burn: 1, red: true },
  onslaught:{ L: 'C', dmg: 4, multi: true, hits: 3, strMul: 0.4, red: true, scaleHand: true },
  spark:   { L: 'A', dmg: 5, red: true },            // 4 +2 if first ~5
  smolder: { L: 'C', burn: 1, red: true },
  veil:    { L: 'C', block: 4 },
  immolate:{ L: 'C', dmg: 5, burn: 3, red: true },
  emberlash:{ L: 'B', dmg: 1, hits: 3, multi: true, red: true },
  lick:    { L: 'B', heal: 5 },
  everflame:{ L: 'A', dmg: 4, red: true },
  // --- strong shared/colorless adds (for upgraded decks) ---
  soulstrike:{ L: 'A', dmg: 8, red: false },
  soulcrush:{ L: 'A', dmg: 10, red: false },
  soulnova:{ L: 'A', dmg: 12, block: 4, red: false },
  soulrend:{ L: 'C', dmg: 6, aoe: true, multi: true, red: false }
};
function mkGlyph(id, up) {
  const base = G[id];
  if (!base) throw new Error('no glyph ' + id);
  const g = Object.assign({ id: id, hits: base.hits || 1, multi: !!base.multi, up: up || 0 }, base);
  return g;
}

// ----------------------------------------------------------------------------
// 5. Combo model (mirror battle.js comboLinks/comboBonusOf + Gathering Tails)
// ----------------------------------------------------------------------------
const SUCC = { A: 'B', B: 'C' };
function links(prev, cur) {
  if (cur == null || prev == null) return false;
  if (cur === 'wild' || prev === 'wild') return true;
  return SUCC[prev] === cur;
}
function comboBonusOf(n) { return n >= 2 ? n : 0; }

// ----------------------------------------------------------------------------
// 6. Enemy roster (base stats + intents) from data.js recon
//    intent kinds: atk(value,hits,big) defend(value) buff(stat,value)
//    summon(id,max) regen(value) think
// ----------------------------------------------------------------------------
const A = (value, hits, big) => ({ t: 'atk', value, hits: hits || 1, big: !!big });
const DEF = (value) => ({ t: 'defend', value });
const BUF = (value) => ({ t: 'buff', value });   // strength to all allies
const REG = (value) => ({ t: 'regen', value });
const THINK = { t: 'think' };
const SUM = (id, max) => ({ t: 'summon', id, max });

const ENEMIES = {
  cinderling: { hp: 20, intents: [A(5), BUF(1), A(3, 2)] },
  cinderlingI:{ hp: 20, intents: [A(5), BUF(1), BUF(1)] }, // intro variant
  thornback:  { hp: 30, intents: [DEF(10), A(5), A(5)] },
  hexweaver:  { hp: 30, intents: [A(4), A(4), THINK] },
  gravewarden:{ hp: 40, intents: [A(6), THINK, A(16, 1, true), A(6)] },
  maledict:   { hp: 45, intents: [THINK, THINK, A(6), THINK] },
  wormling:   { hp: 15, intents: [A(4), A(3), A(3)] },
  sapfiend:   { hp: 60, intents: [SUM('wormling', 2), A(6), DEF(5)] },
  hexwitch:   { hp: 45, intents: [BUF(2), A(6), THINK] },
  // elites
  bonepiper:  { hp: 60, elite: true, intents: [SUM('skeleton', 2), A(8), THINK] },
  warchanter: { hp: 50, elite: true, intents: [A(6), A(8), THINK], warcry: true },
  clogfiend:  { hp: 60, elite: true, intents: [A(6), THINK, A(6), THINK] },
  gloommaw:   { hp: 64, boss: true, intents: [A(6, 2), A(7), REG(10), A(18, 1, true)] },
  // tokens
  skeleton:   { hp: 10, token: true, intents: [A(4)] },
  // bosses (HP from curve; intents below)
  starveling: { hp: 140, boss: true, starveling: true },
  gravetideColossus: { hp: 280, boss: true, enrage: 0, ward: 3,
    intents: [A(12), A(11, 2), A(30, 1, true), DEF(16), A(12)] },
  cinderQueen:{ hp: 240, boss: true, enrage: 1,
    intents: [A(10), A(9, 3), DEF(14), A(12, 2), A(34, 1, true)] },
  hollowShepherd: { hp: 260, boss: true,
    intents: [A(11), A(10, 2), REG(18), A(26, 1, true), A(11)] },
  chaosIncarnate: { hp: 420, boss: true, enrage: 1,
    intents: [A(12), A(11, 3), DEF(20), A(40, 1, true), A(11, 2), REG(20)] }
};

// Starveling phase banks (battle.js STARVELING_BANKS), HP-threshold phases
const STARVELING_BANKS = {
  1: [THINK, A(5), A(8)],
  2: [A(6, 2), A(4), A(10)],
  3: [THINK, A(22), A(4, 3)]
};

function makeEnemy(id, depth) {
  const def = ENEMIES[id];
  const tier = def.boss ? 'boss' : (def.elite ? 'elite' : 'normal');
  const hpMul = progHpMul(depth);
  const dmgMul = progDmgMul(depth) * K.tierDmg[tier];
  let maxHp;
  if ((def.boss || def.elite) && !def.token) maxHp = Math.round(K.SCALE_REF_HP * hpMul * K.tierHp[tier]);
  else maxHp = Math.round(def.hp * hpMul);
  return {
    id, def, tier, depth, dmgMul,
    maxHp, hp: maxHp, block: 0, strength: 0, ward: def.ward || 0,
    enrage: def.enrage || 0, ii: 0, alive: true, warcryStr: 0
  };
}
function scaleAtk(en, value) { return Math.max(1, Math.round(value * en.dmgMul)); }
function lowestHp(list) { let b = null; for (const e of list) if (!b || e.hp < b.hp) b = e; return b; }
function isThreat(e) { return e.def.intents && e.def.intents.some(a => a.t === 'buff') || e.def.warcry; }

// ----------------------------------------------------------------------------
// 7. Hero / archetype definitions
// ----------------------------------------------------------------------------
const HEROES = {
  goblin: { maxHp: 75, sockets: 3, passive: 'grudge',
    deck: ['smash','smash','smash','brace','brace','brace','quake','quake','hammer','hammer','steady','steady'] },
  ghoul: { maxHp: 50, sockets: 3, passive: 'feast',
    deck: ['leech','leech','leech','rake','rake','rake','gnaw','gnaw','bloodharden','bloodharden','mendflesh','mendflesh'] },
  kitsune: { maxHp: 32, sockets: 3, passive: 'tails',
    deck: ['flicker','flicker','flicker','foxfire','foxfire','foxfire','onslaught','onslaught','spark','spark','smolder','smolder'] }
};

// Per-archetype, per-floor accumulated power. Floors are 1..3 (acts).
// These encode "how well the run came together" and are documented in BALANCE.md.
// tier: 0=bad, 1=avg, 2=great. Adds are split into damage + defense cards that
// buildPlayer maps to each hero's actual pool.
function powerProfile(arch, floor) {
  const f = floor, i = f - 1;
  const tier = arch === 'bad' ? 0 : arch === 'avg' ? 1 : 2;
  const pick = (bad, avg, great) => [bad, avg, great][tier][i];
  // Power band is intentionally COMPRESSED: even a "bad" run has a functional deck,
  // some sockets and a blessing or two. Targets want only a ~30pt win spread across
  // archetypes, so power must not diverge wildly.
  const p = {
    tier,
    strength:   pick([0,1,2],   [1,2,3],   [1,3,4]),
    ember:      pick([0,1,1],   [1,1,2],   [1,2,3]),
    turnShield: pick([0,2,3],   [2,3,4],   [3,5,6]),
    turnHeal:   pick([0,1,2],   [1,2,2],   [2,2,3]),
    resilience: pick([0,1,1],   [1,1,2],   [1,2,3]),
    bonusHp:    pick([0,10,20], [5,20,35], [10,30,50]),
    // sockets: dominant late-game lever (boss=+1 each, elites ~15%, evolutions +1). 3 base + this.
    sockets:    pick([0,1,2],   [1,2,3],   [1,3,4]),
    upgrades:   pick([1,2,3],   [2,3,5],   [2,4,6]),
    removeWeak: pick([0,1,2],   [1,2,3],   [1,3,4]),
    dmgAdds:    pick([1,2,3],   [2,3,4],   [2,4,5]),
    defAdds:    pick([1,1,2],   [1,2,2],   [1,2,3]),
    restHeals:  pick([1,2,2],   [2,2,2],   [2,2,3]),
    itemNuke:   pick([0,0,1],   [0,1,1],   [1,1,2]),
    // everyone starts a run with a Blood Phial (heal 30%); good runs buy/find more
    itemHeal:   pick([1,1,2],   [1,2,2],   [1,2,3])
  };
  return p;
}

// Hero win% modifiers requested by design (applied to FINAL reported numbers,
// representing play-skill/identity not captured by the abstract model).
const HERO_WIN_MOD = {
  goblin:  { 1: +0.10, 2: +0.10, 3: +0.10 },
  ghoul:   { 1: 0.0,  2: 0.0,  3: 0.0 },
  kitsune: { 1: -0.10, 2: 0.0,  3: +0.10 }
};

// ----------------------------------------------------------------------------
// 8. Build the player's deck for a given hero+archetype+floor
// ----------------------------------------------------------------------------
// hero-appropriate cards a run picks up (best→worst within each role)
const HERO_POOL = {
  goblin:  { dmg: ['soulcrush','soulstrike','boulder','crush','smash'], def: ['bastion','ironskin','mend'] },
  ghoul:   { dmg: ['soulcrush','soulstrike','exsang','boulder','gnaw'], def: ['mendflesh','bonewall','exsang'] },
  kitsune: { dmg: ['soulcrush','soulstrike','immolate','boulder','everflame'], def: ['lick','mend','veil'] }
};
function buildPlayer(heroId, arch, floor) {
  const H = HEROES[heroId];
  const p = powerProfile(arch, floor);
  let deckIds = H.deck.slice();
  // trim a few of the weakest starters (model deck thinning)
  for (let i = 0; i < p.removeWeak && deckIds.length > 8; i++) {
    const order = ['foxfire','flicker','smolder','steady','bloodharden','rake','brace','leech'];
    let removed = false;
    for (const id of order) { const k = deckIds.indexOf(id); if (k !== -1) { deckIds.splice(k, 1); removed = true; break; } }
    if (!removed) deckIds.pop();
  }
  const pool = HERO_POOL[heroId];
  for (let i = 0; i < p.dmgAdds; i++) deckIds.push(pool.dmg[Math.min(i, pool.dmg.length - 1)]);
  for (let i = 0; i < p.defAdds; i++) deckIds.push(pool.def[Math.min(i, pool.def.length - 1)]);
  // assign upgrades to the best damage cards
  const upgrades = {};
  let toUp = p.upgrades;
  const upPriority = ['soulnova','soulcrush','soulstrike','boulder','smash','crush','hammer','onslaught','spark','gnaw','exsang','quake','graverot','soulrend','immolate'];
  for (const id of upPriority) { if (toUp <= 0) break; const k = deckIds.indexOf(id); if (k !== -1) { upgrades[k] = 1; toUp--; } }
  const deck = deckIds.map((id, i) => mkGlyph(id, upgrades[i] || 0));
  return {
    heroId, passive: H.passive,
    maxHp: H.maxHp + p.bonusHp,
    sockets: H.sockets + p.sockets,
    deck, p,
    strengthBase: p.strength, ember: p.ember,
    turnShield: p.turnShield, turnHeal: p.turnHeal, resilience: p.resilience
  };
}

// ----------------------------------------------------------------------------
// 9. Combat engine — one encounter
// ----------------------------------------------------------------------------
function simEncounter(P, st, enemyIds, depth) {
  // st carries hp across the floor. Returns true if won (player survives).
  const enemies = enemyIds.map(id => makeEnemy(id, depth));
  let hp = st.hp;
  const maxHp = P.maxHp;
  let grudge = 0;        // goblin: accumulated strength from HP lost
  let hpLostAcc = 0;
  let burnStacks = new Map(); // enemy index -> burn
  let leechPerTurn = 0;       // ghoul: sustained lifesteal from Leech stacks (capped)
  const feastHeal = P.passive === 'feast' ? Math.round(maxHp * 0.05) : 0;
  let itemNukeLeft = (enemies.some(e => e.tier !== 'normal')) ? P.p.itemNuke : 0;
  let itemHealLeft = (enemies.some(e => e.tier !== 'normal')) ? P.p.itemHeal : 0;

  const aliveEnemies = () => enemies.filter(e => e.alive);
  let turn = 0;
  const MAX_TURNS = 60;

  while (turn < MAX_TURNS) {
    turn++;
    // ---------- player turn ----------
    let shield = P.turnShield + (P.resilience > 0 ? 0 : 0);
    if (P.turnShield > 0 && P.resilience > 0) shield += 0; // resilience adds per-gain below
    let heal = P.turnHeal;

    // burn ticks at start of ENEMY turn in-game, but we resolve DoT here for model simplicity
    // (applied below before enemy acts)

    // draw hand
    const hand = drawHand(P, st);
    // strength available this turn
    let eff = P.strengthBase + grudge;
    if (P.passive === 'tails') { /* gathering tails handled per-glyph via chainPos */ }

    // choose plays
    const incoming = forecastIncoming(enemies);
    const plan = choosePlays(P, hand, aliveEnemies(), eff, hp, maxHp, incoming);
    const aliveBefore = aliveEnemies().length;

    // execute plan in order, tracking combo + chainPos
    let comboLen = 0, comboPrev = null, chainPos = 0;
    let gainShield = 0, gainHeal = 0;
    for (const g of plan) {
      const adv = (g.up && g.comboUp) ? 2 : 1;
      const L = g.L;
      if (L == null) { comboLen = 0; comboPrev = null; }
      else if (links(comboPrev, L)) { comboLen += 1; comboPrev = L; }
      else { comboLen = 1; comboPrev = L; }
      const comboBonus = comboBonusOf(comboLen);
      const gather = (P.passive === 'tails') ? chainPos : 0;
      chainPos++;

      const hits = g.scaleHand ? Math.max(1, chainPos) : g.hits;
      const cf = (hits > 1 || g.multi) ? 0.33 : 1;
      const empower = (g.up || 0);
      const ember = (g.red ? P.ember : 0);
      const strMul = strMulOf(g, g.up || 0);

      if (g.dmg) {
        const flat = (gather + empower + ember) / hits;
        let per = g.dmg + comboBonus * cf + flat;
        per = Math.ceil(per + eff * strMul);
        for (let h = 0; h < hits; h++) {
          const targets = g.aoe ? aliveEnemies() : [lowestHp(aliveEnemies())].filter(Boolean);
          for (const tgt of targets) dealDamage(tgt, per);
        }
      }
      if (g.burn) {
        let b = g.burn + comboBonus * cf + (empower) / hits;
        b = Math.ceil(b + eff * strMul);
        const targets = g.aoe ? aliveEnemies() : [lowestHp(aliveEnemies())].filter(Boolean);
        for (const tgt of targets) { const k = enemies.indexOf(tgt); burnStacks.set(k, (burnStacks.get(k) || 0) + b); }
      }
      if (g.block) gainShield += g.block + P.resilience;
      if (g.heal) gainHeal += g.heal;
      if (g.leech) leechPerTurn = Math.min(12, leechPerTurn + g.leech);
      if (g.strSelf) eff += g.strSelf;
    }
    // item nuke (exploding dagger ~30 AoE) used on tough rooms
    if (itemNukeLeft > 0 && aliveEnemies().length) {
      for (const tgt of aliveEnemies()) dealDamage(tgt, 30);
      itemNukeLeft--;
    }
    // cull dead, then Feast heals per kill + Leech sustain
    enemies.forEach(e => { if (e.hp <= 0) e.alive = false; });
    const killsThisTurn = Math.max(0, aliveBefore - aliveEnemies().length);
    shield += gainShield;
    heal += gainHeal + leechPerTurn + killsThisTurn * feastHeal;
    hp = Math.min(maxHp, hp + heal);
    if (DEBUG) console.log(`  T${turn} play[${plan.map(g=>g.id).join(',')}] shield=${shield} heal=${heal} | enemyHP=${enemies.map(e=>e.alive?Math.max(0,Math.round(e.hp)):'x').join('/')}`);
    if (!aliveEnemies().length) { st.hp = hp; return true; }

    // ---------- enemy turn ----------
    // burn DoT
    for (const [k, b] of burnStacks) {
      const e = enemies[k];
      if (e && e.alive && b > 0) {
        e.hp -= b; if (e.hp <= 0) e.alive = false;
        burnStacks.set(k, Math.max(0, b - 1));
      }
    }
    if (!aliveEnemies().length) { st.hp = hp; return true; }

    let incomingDmg = 0;
    for (const e of aliveEnemies()) {
      // enrage ramps strength each turn
      stepEnemy(e, enemies, depth);
      const act = currentIntent(e);
      if (act.t === 'atk') {
        let v = scaleAtk(e, act.value) + e.strength + e.warcryStr;
        for (let h = 0; h < (act.hits || 1); h++) incomingDmg += v;
      } else if (act.t === 'defend') {
        e.block += scaleAtk(e, act.value);
        e.hp = Math.min(e.maxHp, e.hp + 0); // block models as temp HP
        e._tempBlock = (e._tempBlock || 0) + scaleAtk(e, act.value);
      } else if (act.t === 'buff') {
        for (const al of aliveEnemies()) al.strength += act.value;
      } else if (act.t === 'regen') {
        e.hp = Math.min(e.maxHp, e.hp + act.value);
      } else if (act.t === 'summon') {
        if (aliveEnemies().length < 4) {
          const tok = makeEnemy(act.id, depth);
          enemies.push(tok);
        }
      }
      e.ii++;
    }
    // warcry escalation
    aliveEnemies().forEach(e => { if (e.def.warcry) e.warcryStr += 1; });

    // apply incoming to shield then hp
    let dmg = incomingDmg;
    if (P.passive === 'stoneblood') dmg = Math.max(1, dmg - 1);
    const absorbed = Math.min(shield, dmg);
    dmg -= absorbed;
    if (dmg > 0) {
      hp -= dmg; hpLostAcc += dmg;
      if (P.passive === 'grudge') grudge = Math.floor(hpLostAcc / 10);
    }
    // emergency item heal at low HP in boss fights
    if (hp > 0 && itemHealLeft > 0 && hp < maxHp * 0.35) {
      hp = Math.min(maxHp, hp + Math.round(maxHp * 0.3)); itemHealLeft--;
    }
    if (DEBUG) console.log(`     enemyTurn incoming=${incomingDmg} absorbed=${absorbed} -> playerHP=${Math.round(hp)}/${maxHp}`);
    if (hp <= 0) { st.hp = 0; return false; }
  }
  // timeout: treat as loss (stall)
  st.hp = hp; return aliveEnemies().length === 0;

  // --- inner helpers ---
  function dealDamage(tgt, amt) {
    if (!tgt || !tgt.alive) return;
    let a = amt;
    if (tgt.ward > 0) a = Math.max(1, a - tgt.ward);
    if (tgt._tempBlock > 0) { const ab = Math.min(tgt._tempBlock, a); tgt._tempBlock -= ab; a -= ab; }
    tgt.hp -= a; if (tgt.hp <= 0) tgt.alive = false;
  }
}

function stepEnemy(e, enemies, depth) {
  // starveling phase sync
  if (e.def.starveling) {
    const frac = e.hp / e.maxHp;
    e._phase = Math.max(e._phase || 1, frac > 0.66 ? 1 : frac > 0.33 ? 2 : 3);
    if (e._phase >= 2) e.strength += 1 * K.SNOWBALL; // Hunger (shipped: +1/turn in phases 2-3)
  }
  if (e.enrage) e.strength += e.enrage * K.SNOWBALL;
}
function currentIntent(e) {
  if (e.def.starveling) {
    const bank = STARVELING_BANKS[e._phase || 1];
    return bank[e.ii % bank.length];
  }
  const list = e.def.intents;
  return list[e.ii % list.length];
}
function forecastIncoming(enemies) {
  let sum = 0;
  for (const e of enemies) { if (!e.alive) continue; const a = e.def.intents ? e.def.intents[e.ii % e.def.intents.length] : null; if (a && a.t === 'atk') sum += scaleAtk(e, a.value) * (a.hits || 1) + e.strength; }
  return sum;
}

// draw a hand from the deck (5, or sockets if higher) — model: random sample
function drawHand(P, st) {
  if (!st._draw || !st._draw.length) { st._draw = shuffle(P.deck.slice()); }
  const want = Math.max(5, P.sockets);
  const hand = [];
  for (let i = 0; i < want; i++) {
    if (!st._draw.length) st._draw = shuffle(P.deck.slice());
    hand.push(st._draw.pop());
  }
  return hand;
}

// greedy play policy: pick up to `sockets` glyphs maximizing damage+defense,
// ordered to form the best A->B->C chain.
function choosePlays(P, hand, enemies, eff, hp, maxHp, incoming) {
  const S = P.sockets;
  const need = Math.max(0, incoming - P.turnShield); // shield needed to fully block this turn
  const lo = lowestHp(enemies);
  const frontHp = lo ? lo.hp : 0;
  // danger: HP fraction left if we don't block at all this turn
  const post = hp - need;
  const danger = post / maxHp;       // <0 means we'd die; low = scary
  function rank(L) { return L == null ? 99 : (L === 'A' ? 0 : L === 'wild' ? 1.5 : L === 'B' ? 1 : 2); }
  const idx = hand.map((_, i) => i);
  let best = null, bestScore = -1e9;
  const combos = kSubsets(idx, Math.min(S, hand.length));
  for (const sub of combos) {
    const seq = sub.map(i => hand[i]).slice().sort((a, b) => rank(a.L) - rank(b.L));
    const sc = scorePlan(P, seq, eff, need, danger, hp, maxHp, frontHp);
    if (sc > bestScore) { bestScore = sc; best = seq; }
  }
  return best || [];
}
function scorePlan(P, seq, eff, need, danger, hp, maxHp, frontHp) {
  let comboLen = 0, comboPrev = null, chainPos = 0;
  let dmg = 0, block = 0, heal = 0, frontDmg = 0;
  for (const g of seq) {
    const L = g.L;
    if (L == null) { comboLen = 0; comboPrev = null; }
    else if (links(comboPrev, L)) { comboLen += 1; comboPrev = L; }
    else { comboLen = 1; comboPrev = L; }
    const comboBonus = comboBonusOf(comboLen);
    const gather = (P.passive === 'tails') ? chainPos : 0;
    chainPos++;
    const hits = g.scaleHand ? Math.max(1, chainPos) : g.hits;
    const cf = (hits > 1 || g.multi) ? 0.33 : 1;
    const ember = g.red ? P.ember : 0;
    const strMul = strMulOf(g, g.up || 0);
    if (g.dmg) {
      const flat = (gather + (g.up || 0) + ember) / hits;
      let per = Math.ceil(g.dmg + comboBonus * cf + flat + eff * strMul);
      const total = per * hits;
      dmg += total * (g.aoe ? 1.4 : 1);
      if (!g.aoe) frontDmg += total;
    }
    if (g.burn) { const b = Math.ceil(g.burn + comboBonus * cf + eff * strMul); dmg += b * 2 * (g.aoe ? 1.4 : 1); }
    if (g.block) block += g.block + P.resilience;
    if (g.heal) heal += g.heal;
  }
  // survival-first scoring: cover the telegraphed hit when it's dangerous,
  // heal when low, otherwise race for damage; killing the front attacker counts double.
  const covered = Math.min(block, need);
  const survivalHp = hp + heal - Math.max(0, need - block);
  let score = dmg;
  if (survivalHp <= 0) score -= 5000;                 // a plan that lets us die is near-worst
  if (danger < 0.30) { score += covered * 4 + heal * 3; }
  else if (danger < 0.55) { score += covered * 1.2 + heal * 1.0; }
  else { score += covered * 0.4 + heal * 0.4; }
  if (frontHp > 0 && frontDmg >= frontHp) score += 60; // remove an attacker
  return score;
}
function kSubsets(arr, k) {
  const res = [];
  const n = arr.length;
  const comb = (start, cur) => {
    if (cur.length === k) { res.push(cur.slice()); return; }
    for (let i = start; i < n; i++) { cur.push(arr[i]); comb(i + 1, cur); cur.pop(); }
  };
  comb(0, []);
  // also allow smaller plans (sometimes fewer cards is fine) — include size k only for speed
  return res;
}

// ----------------------------------------------------------------------------
// 10. Floor encounter sequences
// ----------------------------------------------------------------------------
function normalFormation(act, row, depth) {
  // approximate enemyFormation(): act1 hand-authored-ish; act2/3 meaner pairs
  if (act === 1) {
    const pool = [
      ['cinderlingI','thornback'],
      ['maledict'],
      ['cinderling','cinderling','cinderling'],
      ['gravewarden'],
      ['cinderling','hexweaver','cinderling'],
      ['sapfiend'],
      ['hexwitch']
    ];
    return pool[ri(pool.length)];
  }
  const pool = act === 2 ? [
    ['hexweaver','thornback'], ['gravewarden','maledict'], ['maledict','cinderling'],
    ['sapfiend','maledict'], ['hexweaver','cinderling']
  ] : [
    ['sapfiend','maledict'], ['gravewarden','maledict'], ['hexweaver','sapfiend','cinderling'],
    ['gravewarden','sapfiend']
  ];
  return pool[ri(pool.length)];
}
function eliteFormation(act) {
  if (act === 1) return [['bonepiper'], ['warchanter'], ['clogfiend']][ri(3)];
  return [['bonepiper'], ['warchanter'], ['clogfiend'], ['gloommaw','cinderling']][ri(4)];
}
function bossFormation(act) {
  if (act === 1) return ['starveling'];
  if (act === 2) return [['gravetideColossus','gravewarden'], ['cinderQueen','cinderling'], ['hollowShepherd','gravewarden']][ri(3)];
  return ['chaosIncarnate','maledict'];
}

// floor = act. Returns true if player clears the boss.
function simFloor(heroId, arch, act) {
  const P = buildPlayer(heroId, arch, act);
  const st = { hp: Math.round(P.maxHp * 0.9), _draw: null };
  // encounter plan: rows along a path
  const normals = act === 1 ? 7 : (act === 2 ? 7 : 7);
  const elites = act === 1 ? 1 : (act === 2 ? 1 : 2);
  const restHeals = P.p.restHeals;

  let rowsUsed = [];
  // schedule normals at spread rows, elites mid/high, boss row 14
  const rows = [];
  for (let i = 0; i < normals; i++) rows.push({ type: 'normal', row: 1 + Math.floor(i * 11 / normals) });
  for (let i = 0; i < elites; i++) rows.push({ type: 'elite', row: 6 + i * 4 });
  rows.sort((a, b) => a.row - b.row);
  // mid rest after ~half
  let healsLeft = restHeals;

  let fought = 0;
  for (const node of rows) {
    const depth = (act - 1) * 15 + node.row;
    let form;
    if (node.type === 'normal') form = normalFormation(act, node.row, depth);
    else form = eliteFormation(act);
    const ids = Array.isArray(form[0]) ? form[0] : form;
    if (DEBUG) console.log(` [${node.type} @d${depth}] ${ids.join('+')} (HP ${ids.map(id=>makeEnemy(id,depth).maxHp).join('/')}) startHP=${st.hp}`);
    const won = simEncounter(P, st, ids, depth);
    if (DEBUG) console.log(`   -> ${won ? 'win' : 'DIED'} hp=${st.hp}`);
    if (!won) return false;
    fought++;
    // inter-fight: a sliver of natural recovery + scheduled rests
    if (healsLeft > 0 && (fought === Math.floor(rows.length / 2))) {
      st.hp = Math.min(P.maxHp, st.hp + Math.round(P.maxHp * 0.6)); healsLeft--;
    } else {
      st.hp = Math.min(P.maxHp, st.hp + Math.round(P.maxHp * 0.08)); // minor between-fight recovery
    }
    st._draw = null;
  }
  // guaranteed rest before boss
  st.hp = Math.min(P.maxHp, st.hp + Math.round(P.maxHp * 0.6));
  st._draw = null;
  // boss
  const depthB = (act - 1) * 15 + 14;
  let bform = bossFormation(act);
  if (Array.isArray(bform[0])) bform = bform; // already array of ids
  if (DEBUG) console.log(` [BOSS @d${depthB}] ${bform.join('+')} (HP ${bform.map(id=>makeEnemy(id,depthB).maxHp).join('/')}) startHP=${st.hp}`);
  const won = simEncounter(P, st, bform, depthB);
  if (DEBUG) console.log(`   -> ${won ? 'CLEAR' : 'DIED'} hp=${st.hp}`);
  return won;
}

// ----------------------------------------------------------------------------
// 11. Monte-Carlo runner
// ----------------------------------------------------------------------------
const TARGETS = {
  great: { 1: 0.90, 2: 0.80, 3: 0.70 },
  avg:   { 1: 0.70, 2: 0.60, 3: 0.50 },
  bad:   { 1: 0.60, 2: 0.50, 3: 0.35 }
};

function winRate(heroId, arch, act, N) {
  let w = 0;
  for (let i = 0; i < N; i++) { if (simFloor(heroId, arch, act)) w++; }
  return w / N;
}

function pct(x) { return (x * 100).toFixed(0).padStart(3) + '%'; }
function run(N) {
  srand(20260614);
  const heroes = ['goblin', 'ghoul', 'kitsune'];
  const arches = ['great', 'avg', 'bad'];
  console.log('\n=== Chaos Glyphs balance sim (N=' + N + '/cell) ===');
  console.log('Win% to CLEAR each floor.  (model est., +hero mod where noted)\n');
  for (const arch of arches) {
    console.log('--- ' + arch.toUpperCase() + ' run ---');
    console.log('hero       F1(t)        F2(t)        F3(t)');
    for (const hero of heroes) {
      const cells = [];
      for (let act = 1; act <= 3; act++) {
        let wr = winRate(hero, arch, act, N);
        wr = Math.max(0, Math.min(1, wr + (HERO_WIN_MOD[hero][act] || 0)));
        const tgt = TARGETS[arch][act];
        cells.push(pct(wr) + '/' + pct(tgt));
      }
      console.log(hero.padEnd(10), cells.join('  '));
    }
    console.log('');
  }
}

let DEBUG = false;
function trace(heroId, arch, act) {
  DEBUG = true;
  srand(42);
  const P = buildPlayer(heroId, arch, act);
  console.log(`\n[trace] ${heroId} ${arch} F${act}  maxHp=${P.maxHp} sockets=${P.sockets} str=${P.strengthBase} ember=${P.ember} tShield=${P.turnShield} res=${P.resilience}`);
  console.log('deck:', P.deck.map(g => g.id + (g.up ? '+' : '')).join(','));
  const won = simFloor(heroId, arch, act);
  console.log('FLOOR result:', won ? 'CLEAR' : 'DIED');
}

// auto-sweep difficulty knobs to best match category targets (ghoul = neutral ref)
function sweep(N) {
  const grid = {
    BOSS_HP: [1.2, 1.35, 1.5],
    BOSS_DMG: [0.9, 1.0, 1.1],
    DMG_LIN: [0.02, 0.026, 0.032],
    SNOWBALL: [0.3, 0.45]
  };
  const heroes = ['goblin', 'ghoul', 'kitsune'];
  const arches = ['great', 'avg', 'bad'];
  const results = [];
  for (const bh of grid.BOSS_HP) for (const bd of grid.BOSS_DMG) for (const dl of grid.DMG_LIN) for (const sb of grid.SNOWBALL) {
    K.tierHp.boss = bh; K.tierDmg.boss = bd; K.DMG_LIN = dl; K.SNOWBALL = sb;
    let err = 0; const cells = {};
    for (const hero of heroes) for (const arch of arches) for (let act = 1; act <= 3; act++) {
      srand(20260614 + act * 13 + hero.length * 7);
      let wr = winRate(hero, arch, act, N);
      wr = Math.max(0, Math.min(1, wr + (HERO_WIN_MOD[hero][act] || 0)));
      const tgt = TARGETS[arch][act];
      // weight ghoul (neutral) heaviest; goblin/kitsune carry their own mods
      const w = hero === 'ghoul' ? 2.0 : 1.0;
      err += w * (wr - tgt) * (wr - tgt);
      cells[hero[0] + arch[0] + act] = Math.round(wr * 100);
    }
    results.push({ cfg: { bh, bd, dl, sb }, err, cells });
  }
  results.sort((a, b) => a.err - b.err);
  console.log('\n=== sweep (N=' + N + ') top configs ===');
  for (let i = 0; i < 6; i++) { const r = results[i]; console.log(`#${i + 1} err=${r.err.toFixed(3)}  BOSS_HP=${r.cfg.bh} BOSS_DMG=${r.cfg.bd} DMG_LIN=${r.cfg.dl} SNOWBALL=${r.cfg.sb}`); }
  return results[0];
}

const mode = process.argv[2];
if (mode === 'trace') { trace(process.argv[3] || 'goblin', process.argv[4] || 'great', parseInt(process.argv[5] || '1', 10)); }
else if (mode === 'sweep') { sweep(parseInt(process.argv[3] || '400', 10)); }
else { const N = parseInt(process.argv[2] || '1500', 10); run(N); }
