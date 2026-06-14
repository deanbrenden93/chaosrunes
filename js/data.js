/* ============================================================
   CHAOS GLYPHS — Static content definitions
   Glyphs, Blessings, Monsters, Enemies.
   All gameplay numbers live here so balance is easy to tweak.
   ============================================================ */
(function (root) {
  'use strict';

  // ---- Glyph color types ----
  const COLOR = {
    red:    'var(--red)',
    blue:   'var(--blue)',
    green:  'var(--green)',
    purple: 'var(--purple)',
    gray:   'var(--gray)',
    white:  'var(--white)'
  };

  /* ----------------------------------------------------------
     GLYPHS — the starter set of 8.
     `effect` is resolved by the battle engine; see battle.js.
     `tag` documents the teaching concept.
     ---------------------------------------------------------- */
  // Each glyph belongs to a beast (`character`). Reward offers and the
  // starting deck only ever surface glyphs matching your beast.
  const GLYPHS = {
    /* ---------------- TROLL — sturdy, simple, forgiving ---------------- */
    /* -- starters (in the opening deck) -- */
    smash: {
      id: 'smash', name: 'Smash', color: 'red', rune: '🜂', img: 'assets/Strike Rune.png',
      character: 'troll', letter: 'A', rarity: 'common',
      dyn: [{ kind: 'dmg', base: 6 }],
      desc: 'Deal {0} damage to the first enemy.'
    },
    brace: {
      id: 'brace', name: 'Brace', color: 'blue', rune: '🜛',
      character: 'troll', letter: 'B', rarity: 'common',
      dyn: [{ kind: 'shield', base: 6 }],
      desc: 'Gain {0} shield.'
    },
    quake: {
      id: 'quake', name: 'Quake', color: 'red', rune: '🜊', img: 'assets/Pierce Rune.png',
      character: 'troll', letter: 'C', rarity: 'common', multiHit: true,
      dyn: [{ kind: 'dmg', base: 3 }],
      desc: 'Deal {0} damage to <b>all</b> enemies.'
    },
    bulwark_slam: {
      id: 'bulwark_slam', name: 'Bulwark Slam', color: 'red', rune: '🜨',
      character: 'troll', letter: 'wild', rarity: 'common',
      dyn: [{ kind: 'dmg', base: function (e) { return e.shield || 0; } }],
      desc: 'Deal {0} damage to the first enemy, equal to your current <b>shield</b> (not consumed).'
    },
    hammer: {
      id: 'hammer', name: 'Hammer', color: 'red', rune: '🜨',
      character: 'troll', letter: 'B', rarity: 'common',
      dyn: [{ kind: 'dmg', base: function (e) { return (e.shield || 0) > 0 ? 6 : 4; } }],
      desc: 'Deal {0} damage to the first enemy. <b>+2</b> if you already have shield.'
    },
    steady: {
      id: 'steady', name: 'Steady', color: 'blue', rune: '🜔',
      character: 'troll', letter: 'C', rarity: 'common',
      dyn: [{ kind: 'shield', base: 4 }],
      desc: 'Gain {0} shield. <b>+2</b> more if this is your first glyph this turn.'
    },

    /* -- run-pool: commons -- */
    boulder: {
      id: 'boulder', name: 'Boulder', color: 'red', rune: '🜔',
      character: 'troll', letter: 'A', rarity: 'common',
      dyn: [{ kind: 'dmg', base: 8 }],
      desc: 'Deal {0} damage to the first enemy.'
    },
    iron_skin: {
      id: 'iron_skin', name: 'Iron Skin', color: 'blue', rune: '🜛',
      character: 'troll', letter: 'B', rarity: 'common',
      dyn: [{ kind: 'shield', base: 8 }],
      desc: 'Gain {0} shield.'
    },
    mend: {
      id: 'mend', name: 'Mend', color: 'green', rune: '🜁',
      character: 'troll', letter: 'C', rarity: 'common',
      dyn: [{ kind: 'heal', base: 6 }],
      desc: 'Heal {0} HP.'
    },
    rockfall: {
      id: 'rockfall', name: 'Rockfall', color: 'red', rune: '🜊',
      character: 'troll', letter: 'C', rarity: 'common', multiHit: true,
      dyn: [{ kind: 'dmg', base: 2 }],
      desc: 'Deal {0} damage to <b>all</b> enemies. <b>+1</b> to all per other Rockfall played this turn.'
    },
    backhand: {
      id: 'backhand', name: 'Backhand', color: 'red', rune: '🜂',
      character: 'troll', letter: 'A', rarity: 'common',
      dyn: [{ kind: 'dmg', base: 5 }],
      desc: 'Deal {0} damage to a random enemy. <b>+2</b> if the previous glyph this turn was red.'
    },

    /* -- run-pool: uncommons -- */
    fortify: {
      id: 'fortify', name: 'Fortify', color: 'blue', rune: '🜕',
      character: 'troll', letter: 'B', rarity: 'uncommon',
      dyn: [{ kind: 'res', base: 1 }],
      desc: 'Gain <b>+{0}</b> Resilience for the rest of this battle (every shield gain is increased).'
    },
    rampart: {
      id: 'rampart', name: 'Rampart', color: 'blue', rune: '🜨',
      character: 'troll', letter: 'wild', rarity: 'uncommon',
      dyn: [{ kind: 'shield', base: function (e) { return 2 * (e.chainPos || 0); } }],
      desc: 'Gain {0} shield — <b>2</b> per glyph already played this turn.'
    },
    spiked_hide: {
      id: 'spiked_hide', name: 'Spiked Hide', color: 'blue', rune: '🜿',
      character: 'troll', letter: 'A', rarity: 'uncommon',
      dyn: [{ kind: 'shield', base: 5 }],
      desc: 'Gain {0} shield, then deal that much damage to a random enemy.'
    },
    crush: {
      id: 'crush', name: 'Crush', color: 'red', rune: '🜨',
      character: 'troll', letter: 'C', rarity: 'uncommon',
      dyn: [{ kind: 'dmg', base: 5 }],
      desc: 'Deal {0} damage to the first enemy. <b>+4</b> if it has no shield.'
    },
    second_wind: {
      id: 'second_wind', name: 'Second Wind', color: 'green', rune: '🜁',
      character: 'troll', letter: 'B', rarity: 'uncommon',
      dyn: [{ kind: 'heal', base: 4 }],
      desc: 'Heal {0} HP. <b>+4</b> more if you are below half HP.'
    },

    /* -- run-pool: rares -- */
    avalanche: {
      id: 'avalanche', name: 'Avalanche', color: 'red', rune: '🜊',
      character: 'troll', letter: 'wild', rarity: 'rare', multiHit: true,
      dyn: [{ kind: 'dmg', base: function (e) { return e.shield || 0; } }],
      desc: 'Deal {0} damage to <b>all</b> enemies, equal to your current shield.'
    },
    bastion: {
      id: 'bastion', name: 'Bastion', color: 'blue', rune: '🜛',
      character: 'troll', letter: 'A', rarity: 'rare',
      dyn: [{ kind: 'shield', base: 10 }],
      desc: 'Gain {0} shield. It does <b>not</b> expire at the start of your next turn.'
    },

    /* -- unlockables (hidden until earned; not in the reward pool yet) -- */
    titans_smash: {
      id: 'titans_smash', name: "Titan's Smash", color: 'red', rune: '🜨',
      character: 'troll', letter: 'A', rarity: 'uncommon', unlock: 'troll_floor1',
      dyn: [{ kind: 'dmg', base: function (e) { return 9 + Math.floor((e.shield || 0) / 3); } }],
      desc: 'Deal {0} damage to the first enemy. <b>+1</b> per 3 shield you hold.'
    },
    unbreakable: {
      id: 'unbreakable', name: 'Unbreakable', color: 'blue', rune: '🜕',
      character: 'troll', letter: 'B', rarity: 'rare', unlock: 'troll_floor2',
      dyn: [{ kind: 'res', base: 1 }],
      desc: 'Gain <b>+{0}</b> Resilience for the rest of the <b>run</b>.'
    },
    reckoning: {
      id: 'reckoning', name: 'Reckoning', color: 'red', rune: '🜊',
      character: 'troll', letter: 'C', rarity: 'rare', unlock: 'troll_floor3', multiHit: true,
      dyn: [{ kind: 'flat', base: 0 }],
      desc: 'Deal damage to <b>all</b> enemies equal to <b>twice</b> your Strength, plus <b>{0}</b>.'
    },
    mountains_wrath: {
      id: 'mountains_wrath', name: "Mountain's Wrath", color: 'red', rune: '🜨',
      character: 'troll', letter: 'wild', rarity: 'rare', unlock: 'troll_boss',
      dyn: [{ kind: 'dmg', base: function (e) { return (e.shield || 0) * 2; } }],
      desc: 'Deal {0} damage to the first enemy ( <b>twice</b> your current shield). Your shield is kept.'
    },
    aftershock: {
      id: 'aftershock', name: 'Aftershock', color: 'red', rune: '🜊',
      character: 'troll', letter: 'C', rarity: 'rare', unlock: 'troll_block150', multiHit: true,
      dyn: [{ kind: 'dmg', base: 3 }],
      desc: 'Deal {0} damage to <b>all</b> enemies, repeated once per blue glyph played this turn.'
    },
    juggernaut: {
      id: 'juggernaut', name: 'Juggernaut', color: 'blue', rune: '🜛',
      character: 'troll', letter: 'B', rarity: 'rare', unlock: 'troll_flawless',
      dyn: [{ kind: 'flat', base: 0 }],
      desc: 'Gain shield equal to <b>half</b> your max HP, plus <b>{0}</b>.'
    },

    /* ---------------- GHOUL — leech, ramp, control ---------------- */
    leech: {
      id: 'leech', name: 'Leech', color: 'red', rune: '🜹',
      character: 'ghoul', letter: 'A',
      dyn: [{ kind: 'dmg', base: 3 }],
      desc: 'Deal {0} to the center enemy and apply <b>Leech 3</b> — each turn it saps 10% of its HP as life to you.'
    },
    rake: {
      id: 'rake', name: 'Rake', color: 'red', rune: '🜺',
      character: 'ghoul', letter: 'B', multiHit: true, hits: 2,
      dyn: [{ kind: 'dmg', base: 2 }],
      desc: 'Deal {0} to a random enemy <b>twice</b>. <b>+1</b> vs Leeched. If played last as your only red glyph, every enemy hit becomes <b>Leeched 3</b>.'
    },
    vigor: {
      id: 'vigor', name: 'Vigor', color: 'green', rune: '🜲',
      character: 'ghoul', letter: 'wild',
      dyn: [{ kind: 'str', base: function (e) { return 1 + (e.redAfter || 0); } }],
      desc: 'Gain <b>+{0}</b> Strength — 1, plus 1 per red glyph placed after this one.'
    },
    blood_harden: {
      id: 'blood_harden', name: 'Blood Harden', color: 'blue', rune: '🜕',
      character: 'ghoul', letter: 'C',
      dyn: [{ kind: 'shield', base: 2 }],
      desc: 'Gain {0} shield, plus <b>1</b> per Leeched enemy.'
    },
    snarl: {
      id: 'snarl', name: 'Snarl', color: 'purple', rune: '🜠',
      character: 'ghoul', letter: 'wild',
      dyn: [{ kind: 'scare', base: 1 }],
      desc: '<b>50%</b> chance to apply <b>{0} Scare</b> to each enemy (3 turns). <b>+25%</b> chance if Snarl is your first glyph this turn.'
    },

    /* -- run-pool: commons -- */
    gnaw: {
      id: 'gnaw', name: 'Gnaw', color: 'red', rune: '🜹',
      character: 'ghoul', letter: 'A', rarity: 'common',
      dyn: [{ kind: 'dmg', base: 4 }, { kind: 'heal', base: 2 }],
      desc: 'Deal {0} to the first enemy and heal {1}.'
    },
    grave_rot: {
      id: 'grave_rot', name: 'Grave Rot', color: 'red', rune: '🜺',
      character: 'ghoul', letter: 'C', rarity: 'common', multiHit: true,
      dyn: [{ kind: 'dmg', base: 3 }],
      desc: 'Deal {0} to <b>all</b> enemies. <b>Leeched</b> enemies take <b>2</b> more.'
    },
    mend_flesh: {
      id: 'mend_flesh', name: 'Mend Flesh', color: 'green', rune: '🜁',
      character: 'ghoul', letter: 'B', rarity: 'common',
      dyn: [{ kind: 'heal', base: 5 }],
      desc: 'Heal {0} HP.'
    },
    bone_wall: {
      id: 'bone_wall', name: 'Bone Wall', color: 'blue', rune: '🜕',
      character: 'ghoul', letter: 'B', rarity: 'common',
      dyn: [{ kind: 'shield', base: 5 }],
      desc: 'Gain {0} block.'
    },

    /* -- run-pool: uncommons -- */
    raise_dead: {
      id: 'raise_dead', name: 'Raise Dead', color: 'purple', rune: '🜠',
      character: 'ghoul', letter: 'wild', rarity: 'uncommon',
      desc: 'Summon <b>2 Husks</b> into your next hand — red <b>1</b>-damage tokens that vanish if unused.'
    },
    exsanguinate: {
      id: 'exsanguinate', name: 'Exsanguinate', color: 'red', rune: '🜹',
      character: 'ghoul', letter: 'A', rarity: 'uncommon',
      dyn: [{ kind: 'dmg', base: 5 }, { kind: 'heal', base: 3 }],
      desc: 'Deal {0} to the center enemy, apply <b>Leech 3</b>, and heal {1}.'
    },
    dread_howl: {
      id: 'dread_howl', name: 'Dread Howl', color: 'purple', rune: '🜲',
      character: 'ghoul', letter: 'wild', rarity: 'uncommon',
      dyn: [{ kind: 'scare', base: 1 }],
      desc: 'Apply <b>{0} Scare</b> to <b>all</b> enemies (3 turns). <b>+1</b> if you are below half HP.'
    },
    soul_harvest: {
      id: 'soul_harvest', name: 'Soul Harvest', color: 'red', rune: '🜺',
      character: 'ghoul', letter: 'C', rarity: 'uncommon', multiHit: true,
      dyn: [{ kind: 'dmg', base: 3 }],
      desc: 'Deal {0} to <b>all</b> enemies and heal <b>1</b> per enemy hit.'
    },

    /* -- run-pool: rares -- */
    blood_pact: {
      id: 'blood_pact', name: 'Blood Pact', color: 'red', rune: '🜹',
      character: 'ghoul', letter: 'wild', rarity: 'rare',
      dyn: [{ kind: 'str', base: 3 }],
      desc: 'Lose <b>4</b> HP (never lethal), then gain <b>+{0}</b> Strength.'
    },
    glutton: {
      id: 'glutton', name: 'Glutton', color: 'red', rune: '🜨',
      character: 'ghoul', letter: 'B', rarity: 'rare',
      dyn: [{ kind: 'dmg', base: function (e) { return Math.max(2, 2 * (e.devoured || 0)); } }],
      desc: 'Deal {0} to the first enemy — <b>2×</b> the Devils you have <b>fed</b> this run (at least 2).'
    },
    plague: {
      id: 'plague', name: 'Plague', color: 'green', rune: '🜬',
      character: 'ghoul', letter: 'A', rarity: 'rare',
      dyn: [{ kind: 'heal', base: 2 }],
      desc: 'Apply <b>Leech 3</b> to <b>all</b> enemies, then heal {0}.'
    },

    /* -- unlockables (hidden until earned; not in the reward pool yet) -- */
    mass_grave: {
      id: 'mass_grave', name: 'Mass Grave', color: 'red', rune: '🜺',
      character: 'ghoul', letter: 'wild', rarity: 'uncommon', unlock: 'ghoul_floor1', multiHit: true,
      dyn: [{ kind: 'dmg', base: 2 }],
      desc: 'Summon <b>3 Husks</b>, then deal {0} to <b>all</b> enemies.'
    },
    lich_ascendant: {
      id: 'lich_ascendant', name: 'Lich Ascendant', color: 'green', rune: '🜲',
      character: 'ghoul', letter: 'C', rarity: 'rare', unlock: 'ghoul_boss',
      dyn: [{ kind: 'heal', base: 8 }, { kind: 'str', base: 2 }],
      desc: 'Heal {0} HP and gain <b>+{1}</b> Strength.'
    },

    /* -- token: summoned by Raise Dead / Mass Grave, never offered -- */
    husk: {
      id: 'husk', name: 'Husk', color: 'red', rune: '⚰', token: true,
      character: 'ghoul', rarity: 'common',
      dyn: [{ kind: 'dmg', base: 1 }],
      desc: 'Deal {0} to a random enemy.'
    },

    /* -- token: spat back by a Devil slot after it devours a glyph. DISPOSABLE
          (one-shot, vanishes if unused — never bloats the deck). A wild-combo
          lifesteal striker: it bites an enemy AND heals the beast. Feed it BACK
          to a Devil and it drinks 30% of your blood. Never offered (token). -- */
    maweaten_scrap: {
      id: 'maweaten_scrap', name: 'Maw-Eaten Scrap', color: 'red', rune: '🩸', token: true,
      character: null, letter: 'wild', rarity: 'token',
      dyn: [{ kind: 'dmg', base: 5 }],
      desc: 'Deal {0} to a random enemy and <b>heal 4</b>. <i>A one-shot morsel torn from the Devil\'s maw — it vanishes if unused, so devouring never clogs your deck. Feed it BACK to a Devil and it tears away <b>30%</b> of your current HP.</i>'
    },

    /* ---------------- KITSUNE — glass-cannon combo chaos (3rd slot is HOLD) ---------------- */
    /* -- starters -- */
    flicker: {
      id: 'flicker', name: 'Flicker', color: 'red', rune: '🜅',
      character: 'kitsune', letter: 'A', rarity: 'common',
      onUnplayed: { kind: 'damageRandom', value: 2 },
      dyn: [{ kind: 'dmg', base: 2 }],
      desc: 'Deal {0} damage to a random enemy.<br><i>If left in hand at end of turn, deal 2 damage to a random enemy.</i>'
    },
    foxfire: {
      id: 'foxfire', name: 'Foxfire', color: 'red', rune: '🜍',
      character: 'kitsune', letter: 'B', rarity: 'common',
      onUnplayed: { kind: 'block', value: 2 },
      dyn: [{ kind: 'burn', base: 2 }],
      desc: 'Apply Burn {0} to a random enemy.<br><i>If left in hand at end of turn, gain 2 block.</i>'
    },
    onslaught: {
      id: 'onslaught', name: 'Onslaught', color: 'red', rune: '🜔',
      character: 'kitsune', letter: 'C', rarity: 'common', multiHit: true, strMul: 0.4,
      dyn: [{ kind: 'dmg', base: 4 }],
      desc: 'Deal {0} damage to a random enemy for <b>each glyph played before it</b> this turn.<br><i>Best played last in the chain.</i>'
    },
    mirror: {
      id: 'mirror', name: 'Mirror', color: 'red', rune: '🜟',
      character: 'kitsune', letter: 'wild', rarity: 'common',
      dyn: [{ kind: 'echo', base: 0 }],
      desc: 'Repeat the effect of the previous glyph played this turn, with <b>+{0}</b> bonus power. (Nothing if played first.)<br><i>If EVERY socket is filled with a Mirror, instead copy your previous turn\'s actions.</i>'
    },
    spark: {
      id: 'spark', name: 'Spark', color: 'red', rune: '🜂',
      character: 'kitsune', letter: 'A', rarity: 'common',
      dyn: [{ kind: 'dmg', base: function (e) { return 4 + ((e.chainPos || 0) === 0 ? 2 : 0); } }],
      desc: 'Deal {0} damage to a random enemy. <i>+2 if it is your first glyph this turn.</i>'
    },
    smolder: {
      id: 'smolder', name: 'Smolder', color: 'red', rune: '🜍',
      character: 'kitsune', letter: 'C', rarity: 'common',
      dyn: [{ kind: 'burn', base: 2 }],
      desc: 'Apply Burn {0} to the first enemy.'
    },

    /* -- run-pool: commons -- */
    wisp: {
      id: 'wisp', name: 'Wisp', color: 'red', rune: '🜅',
      character: 'kitsune', letter: 'B', rarity: 'common', multiHit: true,
      dyn: [{ kind: 'dmg', base: 2 }],
      desc: 'Deal {0} damage to <b>all</b> enemies.'
    },
    scorch: {
      id: 'scorch', name: 'Scorch', color: 'red', rune: '🜍',
      character: 'kitsune', letter: 'A', rarity: 'common',
      dyn: [{ kind: 'burn', base: 3 }],
      desc: 'Apply Burn {0} to the <b>highest-HP</b> enemy.'
    },
    veil: {
      id: 'veil', name: 'Veil', color: 'blue', rune: '🜛',
      character: 'kitsune', letter: 'C', rarity: 'common',
      dyn: [{ kind: 'shield', base: 4 }],
      desc: 'Gain {0} block.'
    },
    emberlash: {
      id: 'emberlash', name: 'Emberlash', color: 'red', rune: '🜔',
      character: 'kitsune', letter: 'B', rarity: 'common', multiHit: true, hits: 3,
      dyn: [{ kind: 'dmg', base: 1 }],
      desc: 'Deal {0} damage to a random enemy <b>three</b> times (random each).'
    },
    lick_wounds: {
      id: 'lick_wounds', name: 'Lick Wounds', color: 'green', rune: '🜁',
      character: 'kitsune', letter: 'B', rarity: 'common',
      dyn: [{ kind: 'heal', base: 5 }],
      desc: 'Heal {0} HP.'
    },

    /* -- run-pool: uncommons -- */
    everflame: {
      id: 'everflame', name: 'Everflame', color: 'red', rune: '🜂',
      character: 'kitsune', letter: 'A', rarity: 'uncommon',
      dyn: [{ kind: 'dmg', base: 4 }],
      desc: 'Deal {0} damage to a random enemy. Each time it resolves, <b>every</b> Everflame gains <b>+1</b> damage — permanently, for the rest of the run.'
    },
    conflagration: {
      id: 'conflagration', name: 'Conflagration', color: 'red', rune: '🜍',
      character: 'kitsune', letter: 'C', rarity: 'uncommon', multiHit: true,
      dyn: [{ kind: 'flat', base: 0 }],
      desc: 'Deal damage to <b>all</b> enemies equal to the <b>Burn</b> already on them, plus <b>{0}</b>.'
    },
    wildfire: {
      id: 'wildfire', name: 'Wildfire', color: 'red', rune: '🜍', img: 'assets/Ember Rune.png',
      character: 'kitsune', slots: 2, letter: 'wild', rarity: 'uncommon',
      onDraw: { kind: 'heal', value: 2 },
      dyn: [{ kind: 'burn', base: 1 }],
      desc: 'Burn {0} all enemies. Any enemy already Burning instead gains <b>+1</b> Burn, then takes damage equal to its Burn.<br><i>Takes 2 sockets. When drawn, heal 2.</i>'
    },
    foxfire_dance: {
      id: 'foxfire_dance', name: 'Foxfire Dance', color: 'red', rune: '🜍',
      character: 'kitsune', letter: 'B', rarity: 'uncommon',
      dyn: [{ kind: 'burn', base: 2 }],
      desc: 'Apply Burn {0} to <b>all</b> enemies.'
    },
    hoarders_flame: {
      id: 'hoarders_flame', name: "Hoarder's Flame", color: 'red', rune: '🜔',
      character: 'kitsune', letter: 'C', rarity: 'uncommon', multiHit: true, strMul: 0.4,
      dyn: [{ kind: 'dmg', base: 2 }],
      desc: 'Deal {0} damage to a random enemy <b>per glyph in your hand</b>.'
    },

    /* -- run-pool: rares -- */
    nine_tails: {
      id: 'nine_tails', name: 'Nine Tails', color: 'red', rune: '🜔',
      character: 'kitsune', slots: 2, letter: 'A', rarity: 'rare', multiHit: true, hits: 9, strMul: 0.3,
      dyn: [{ kind: 'dmg', base: 3 }],
      desc: 'Deal {0} damage <b>9 times</b> to random enemies. For each <b>unique</b> enemy struck, <b>steal 1 Strength</b> from it this combat.<br><i>Takes 2 sockets.</i>'
    },
    immolate: {
      id: 'immolate', name: 'Immolate', color: 'red', rune: '🜍',
      character: 'kitsune', letter: 'C', rarity: 'rare',
      dyn: [{ kind: 'dmg', base: 5 }],
      desc: 'Deal {0} damage to the first enemy and apply <b>Burn 5</b>.'
    },

    /* -- unlockables (hidden until earned; not in the reward pool yet) -- */
    will_o_wisp: {
      id: 'will_o_wisp', name: "Will-o-Wisp", color: 'red', rune: '🜅',
      character: 'kitsune', letter: 'A', rarity: 'uncommon', unlock: 'kitsune_floor1',
      dyn: [{ kind: 'dmg', base: 3 }],
      desc: 'Deal {0} damage to the <b>lowest-HP</b> enemy.'
    },
    ember_hoard: {
      id: 'ember_hoard', name: 'Ember Hoard', color: 'blue', rune: '🜛',
      character: 'kitsune', letter: 'B', rarity: 'rare', unlock: 'kitsune_floor2',
      dyn: [{ kind: 'shield', base: 2 }],
      desc: 'Gain {0} block <b>per glyph in your hand</b>.'
    },
    spirit_fire: {
      id: 'spirit_fire', name: 'Spirit Fire', color: 'red', rune: '🜍',
      character: 'kitsune', letter: 'C', rarity: 'rare', unlock: 'kitsune_floor3',
      dyn: [{ kind: 'flat', base: 0 }],
      desc: 'Apply <b>Burn</b> to all enemies equal to the number of red glyphs played this turn, plus <b>{0}</b>.'
    },
    nine_tailed_inferno: {
      id: 'nine_tailed_inferno', name: 'Nine-Tailed Inferno', color: 'red', rune: '🜍',
      character: 'kitsune', letter: 'wild', rarity: 'rare', unlock: 'kitsune_boss',
      dyn: [{ kind: 'burn', base: 3 }],
      desc: 'Detonate <b>all</b> Burn (each enemy takes damage equal to its Burn), then Burn {0} every enemy anew.'
    },
    phoenix: {
      id: 'phoenix', name: 'Phoenix', color: 'green', rune: '🜁',
      character: 'kitsune', letter: 'B', rarity: 'rare', unlock: 'kitsune_oneturn',
      dyn: [{ kind: 'heal', base: 10 }],
      desc: 'Heal {0} HP. <b>+10</b> more if no other glyphs remain in your hand.'
    },
    trickster_echo: {
      id: 'trickster_echo', name: "Trickster's Echo", color: 'red', rune: '🜟',
      character: 'kitsune', letter: 'wild', rarity: 'rare', unlock: 'kitsune_combo3',
      dyn: [{ kind: 'echo', base: 3 }],
      desc: 'Repeat the previous glyph this turn, <b>empowered by +{0}</b>. (Nothing if played first.)'
    },

    /* ---------------- JUNK — forced on you by enemies, never offered ---------------- */
    rubble: {
      id: 'rubble', name: 'Rubble', color: 'gray', rune: '◼',
      character: null, junk: true,
      desc: 'Worthless debris clogging your deck. Socket it and Act to be rid of it for good.'
    },
    deadweight: {
      id: 'deadweight', name: 'Dead Weight', color: 'gray', rune: '⛓',
      character: null, junk: true, slots: 2, discardDmg: 10,
      desc: 'A cursed anchor taking <b>2</b> sockets. Socket and Act to be rid of it for good — or it bites for <b>10</b> when you let it discard unplayed.'
    },

    /* ---------------- COLORLESS — the white Soul-glyphs ----------------
       Beast-agnostic, premium cards earned ONLY at Soulstone nodes. They
       play to no beast's traits, so they're strong on raw numbers. Each carries
       a real combo letter (A/B/C) so they must be chained like any glyph; only a
       rare couple stay `wild`. `colorless: true` keeps them out of the normal
       reward pools. Resolution is data-driven from `fx` (see battle.js
       resolveNeutral). 12 are available from the start; 8 more (unlock-gated)
       are saved for a meta-progression pass. */
    soul_strike: {
      id: 'soul_strike', name: 'Soul Strike', color: 'white', rune: '✶',
      colorless: true, letter: 'A', rarity: 'uncommon',
      fx: [{ op: 'dmg', v: 8, t: 'first' }],
      desc: 'Deal <b>8</b> damage to the first enemy.'
    },
    soul_ward: {
      id: 'soul_ward', name: 'Soul Ward', color: 'white', rune: '❖',
      colorless: true, letter: 'B', rarity: 'uncommon',
      fx: [{ op: 'shield', v: 8 }],
      desc: 'Gain <b>8</b> shield.'
    },
    soul_mend: {
      id: 'soul_mend', name: 'Soul Mend', color: 'white', rune: '✚',
      colorless: true, letter: 'C', rarity: 'uncommon',
      fx: [{ op: 'heal', v: 8 }],
      desc: 'Heal <b>8</b> HP.'
    },
    soul_lash: {
      id: 'soul_lash', name: 'Soul Lash', color: 'white', rune: '✦',
      colorless: true, letter: 'A', rarity: 'uncommon', multiHit: true,
      fx: [{ op: 'dmg', v: 4, t: 'all' }],
      desc: 'Deal <b>4</b> damage to ALL enemies.'
    },
    soul_spark: {
      id: 'soul_spark', name: 'Soul Spark', color: 'white', rune: '❂',
      colorless: true, letter: 'B', rarity: 'uncommon', multiHit: true, hits: 2,
      fx: [{ op: 'dmg', v: 5, t: 'random', hits: 2 }],
      desc: 'Strike random enemies <b>twice</b> for <b>5</b> each.'
    },
    soul_might: {
      id: 'soul_might', name: 'Soul Might', color: 'white', rune: '⬢',
      colorless: true, letter: 'C', rarity: 'uncommon',
      fx: [{ op: 'str', v: 2 }],
      desc: 'Gain <b>2</b> Strength for the battle.'
    },
    soul_bulwark: {
      id: 'soul_bulwark', name: 'Soul Bulwark', color: 'white', rune: '⬣',
      colorless: true, letter: 'A', rarity: 'uncommon',
      fx: [{ op: 'res', v: 2 }],
      desc: 'Gain <b>2</b> Resilience for the battle.'
    },
    soul_pyre: {
      id: 'soul_pyre', name: 'Soul Pyre', color: 'white', rune: '✸',
      colorless: true, letter: 'B', rarity: 'uncommon',
      fx: [{ op: 'burn', v: 4, t: 'first' }],
      desc: 'Apply <b>4</b> Burn to the first enemy.'
    },
    soul_drain: {
      id: 'soul_drain', name: 'Soul Drain', color: 'white', rune: '❉',
      colorless: true, letter: 'C', rarity: 'rare',
      fx: [{ op: 'dmg', v: 6, t: 'first' }, { op: 'heal', v: 4 }],
      desc: 'Deal <b>6</b> damage to the first enemy and heal <b>4</b> HP.'
    },
    soul_crush: {
      id: 'soul_crush', name: 'Soul Crush', color: 'white', rune: '✹',
      colorless: true, letter: 'A', rarity: 'rare',
      fx: [{ op: 'dmg', v: 10, t: 'lowest' }],
      desc: 'Deal <b>10</b> damage to the weakest enemy.'
    },
    soul_aegis: {
      id: 'soul_aegis', name: 'Soul Aegis', color: 'white', rune: '⛨',
      colorless: true, letter: 'B', rarity: 'rare',
      fx: [{ op: 'shield', v: 5 }, { op: 'dmg', v: 5, t: 'first' }],
      desc: 'Gain <b>5</b> shield and deal <b>5</b> damage to the first enemy.'
    },
    soul_terror: {
      id: 'soul_terror', name: 'Soul Terror', color: 'white', rune: '☠',
      colorless: true, letter: 'wild', rarity: 'rare',
      fx: [{ op: 'scare', v: 2, t: 'all' }],
      desc: 'Apply <b>2</b> Scare to ALL enemies.'
    },

    /* -- unlockable soul-glyphs (gated; saved for meta progression) -- */
    soul_rend: {
      id: 'soul_rend', name: 'Soul Rend', color: 'white', rune: '✺',
      colorless: true, letter: 'C', rarity: 'rare', unlock: 'soulglyph_rend', multiHit: true,
      fx: [{ op: 'dmg', v: 6, t: 'all' }],
      desc: 'Deal <b>6</b> damage to ALL enemies.'
    },
    soul_nova: {
      id: 'soul_nova', name: 'Soul Nova', color: 'white', rune: '✴',
      colorless: true, letter: 'A', rarity: 'rare', unlock: 'soulglyph_nova',
      fx: [{ op: 'dmg', v: 12, t: 'first' }, { op: 'shield', v: 4 }],
      desc: 'Deal <b>12</b> damage to the first enemy and gain <b>4</b> shield.'
    },
    soul_phoenix: {
      id: 'soul_phoenix', name: 'Soul Phoenix', color: 'white', rune: '❤',
      colorless: true, letter: 'B', rarity: 'rare', unlock: 'soulglyph_phoenix',
      fx: [{ op: 'heal', v: 12 }, { op: 'str', v: 1 }],
      desc: 'Heal <b>12</b> HP and gain <b>1</b> Strength.'
    },
    soul_tempest: {
      id: 'soul_tempest', name: 'Soul Tempest', color: 'white', rune: '❈',
      colorless: true, letter: 'C', rarity: 'rare', unlock: 'soulglyph_tempest', multiHit: true, hits: 2,
      fx: [{ op: 'dmg', v: 4, t: 'all', hits: 2 }],
      desc: 'Deal <b>4</b> damage to ALL enemies, <b>twice</b>.'
    },
    soul_fortress: {
      id: 'soul_fortress', name: 'Soul Fortress', color: 'white', rune: '🏰',
      colorless: true, letter: 'A', rarity: 'rare', unlock: 'soulglyph_fortress',
      fx: [{ op: 'shield', v: 14 }],
      desc: 'Gain <b>14</b> shield.'
    },
    soul_reaper: {
      id: 'soul_reaper', name: 'Soul Reaper', color: 'white', rune: '⚰',
      colorless: true, letter: 'B', rarity: 'rare', unlock: 'soulglyph_reaper',
      fx: [{ op: 'dmg', v: 9, t: 'highest' }, { op: 'scare', v: 2, t: 'highest' }],
      desc: 'Deal <b>9</b> damage and apply <b>2</b> Scare to the strongest enemy.'
    },
    soul_inferno: {
      id: 'soul_inferno', name: 'Soul Inferno', color: 'white', rune: '♨',
      colorless: true, letter: 'C', rarity: 'rare', unlock: 'soulglyph_inferno',
      fx: [{ op: 'burn', v: 5, t: 'all' }],
      desc: 'Apply <b>5</b> Burn to ALL enemies.'
    },
    soul_ascend: {
      id: 'soul_ascend', name: 'Soul Ascend', color: 'white', rune: '❇',
      colorless: true, letter: 'wild', rarity: 'rare', unlock: 'soulglyph_ascend',
      fx: [{ op: 'str', v: 3 }, { op: 'res', v: 3 }],
      desc: 'Gain <b>3</b> Strength and <b>3</b> Resilience for the battle.'
    }
  };

  /* ----------------------------------------------------------
     BLESSINGS — the standard pool (start draft, elites, shop).
     Every one of these is wired into the battle/run engine.
     ---------------------------------------------------------- */
  const BLESSINGS = {
    recall: {
      id: 'recall', name: 'Recall', icon: '↺', img: 'assets/Recall Stone.png', scope: 'run',
      desc: 'Once per turn, click an equipped glyph to return it to your hand before acting.'
    },
    emberward: {
      id: 'emberward', name: 'Ember Ward', icon: '🜂', img: 'assets/Ember Ward.png', scope: 'run',
      desc: 'Gain 2 shield each time a red glyph is played this turn.'
    },
    emberstorm: {
      id: 'emberstorm', name: 'Emberstorm', icon: '⚝', img: 'assets/Firestorm Jar.png', scope: 'run',
      desc: 'All of your red glyphs deal +1 damage.'
    },
    overload: {
      id: 'overload', name: 'Overload', icon: '🜳', img: 'assets/Overload Crown.png', scope: 'run',
      unlock: 'bless_overload',
      desc: 'Draw 6 glyphs each turn instead of 5.'
    },
    aegis: {
      id: 'aegis', name: 'Aegis', icon: '🛡', img: 'assets/Aegis Shield.png', scope: 'run',
      desc: 'Gain 3 shield at the start of every turn.'
    },
    warbanner: {
      id: 'warbanner', name: 'War Banner', icon: '⚔', img: 'assets/War Banner.png', scope: 'run',
      desc: 'Begin every battle with +2 Strength.'
    },
    lifebloom: {
      id: 'lifebloom', name: 'Lifebloom', icon: '🌿', img: 'assets/Lifebloom Bud.png', scope: 'run',
      desc: 'Heal 2 HP at the start of every turn.'
    },
    greed: {
      id: 'greed', name: 'Greed', icon: '🪙', img: 'assets/Greed Coin.png', scope: 'run',
      unlock: 'bless_greed',
      desc: 'Gain 50% more souls from every source.'
    },
    stoneblood: {
      id: 'stoneblood', name: 'Stoneblood', icon: '🪨', img: 'assets/Bloodstone.png', scope: 'run',
      desc: 'Reduce all incoming damage by 1 (minimum 1).'
    }
  };

  // Powerful blessings — only offered by floor bosses & the back room of the shop.
  const POWER_BLESSINGS = {
    pyreheart: {
      id: 'pyreheart', name: 'Pyreheart', icon: '🔥', img: 'assets/Pyre Heart.png', scope: 'run',
      desc: 'All of your red glyphs deal +2 damage.'
    },
    bastionheart: {
      id: 'bastionheart', name: 'Bastion Core', icon: '🏰', img: 'assets/Bastion Core.png', scope: 'run',
      unlock: 'bless_bastion',
      desc: 'Gain 5 shield at the start of every turn.'
    }
  };

  // Soul blessings — wrested ONLY from the Soulhunter, one per form (A → B → C).
  const SOUL_BLESSINGS = {
    conjoined: {
      id: 'conjoined', name: 'Conjoined Soul', icon: '🜸', img: 'assets/Conjoined Soul.png', scope: 'run', form: 'A',
      desc: 'Every set of reward glyphs guarantees a <b>+2 empowered</b> glyph among the choices.'
    },
    conniving: {
      id: 'conniving', name: 'Conniving Soul', icon: '🜹', img: 'assets/Conniving Soul.png', scope: 'run', form: 'B',
      desc: 'Every fifth turn, the enemies <b>skip their turn</b> entirely.'
    },
    calamitous: {
      id: 'calamitous', name: 'Calamitous Soul', icon: '🜺', img: 'assets/Calamitous Soul.png', scope: 'run', form: 'C',
      desc: 'On pickup, every eligible socket gains <b>Upgrade</b> — glyphs played there gain +1 empower for the rest of each battle.'
    }
  };

  // Event blessings — granted ONLY by their specific map events. Kept out of the
  // standard draft/elite/shop pools so they stay tied to the moments that earn them.
  const EVENT_BLESSINGS = {
    fearbraid: {
      id: 'fearbraid', name: 'Fear Braids', icon: '🧿', img: 'assets/Fear Braids.png', scope: 'run',
      desc: 'The <b>second enemy</b> in every battle starts <b>Scared 3</b>.'
    },
    shimmer: {
      id: 'shimmer', name: 'Shimmering Orb', icon: '🔮', img: 'assets/Shimmering Orb.png', scope: 'run',
      desc: 'When your chain resolves, every glyph is empowered by the number of <b>different glyph colors</b> in the chain.'
    },
    blackfeather: {
      id: 'blackfeather', name: 'Black Feather', icon: '🪶', img: 'assets/Black Feather.png', scope: 'run',
      desc: 'Begin every battle with <b>+3 Resilience</b>.'
    },
    rawmuscle: {
      id: 'rawmuscle', name: 'Muscle Fiber', icon: '💪', img: 'assets/Muscle Fiber.png', scope: 'run',
      desc: 'Begin every battle with <b>+3 Strength</b>.'
    },
    ratcharm: {
      id: 'ratcharm', name: 'Rat Charm', icon: '🐀', img: 'assets/Rat Charm.png', scope: 'run',
      desc: 'If you take <b>no glyph</b> from a rewards screen, gain <b>double souls</b> from it.'
    },
    chickencharm: {
      id: 'chickencharm', name: 'Chicken Charm', icon: '🐔', img: 'assets/Chicken Charm.png', scope: 'run',
      desc: 'Normal battle rewards also offer a <b>reforge</b> option.'
    }
  };

  /* ----------------------------------------------------------
     MONSTERS — 3 distinct starters.
     passive: small identity bonus resolved in battle.
     ---------------------------------------------------------- */
  const MONSTERS = {
    troll: {
      id: 'troll', name: 'Goblin', role: 'Bulwark', emoji: '👺',
      img: 'assets/goblin.png',
      selectBg: 'assets/Goblin Select Backdrop.png',
      color: 'var(--green)',
      maxHp: 75, sockets: 3, slotTypes: ['normal', 'empower', 'normal'],
      passive: 'wargrudge', passiveVal: 10,
      passiveText: 'War Grudge: for every <b>10 damage</b> you take, gain <b>+1 Strength</b> for the rest of the battle.',
      desc: 'A bruiser who turns punishment into power — the more he bleeds, the harder he hits.',
      evolveName: 'Goblin Warlord',
      // Branching evolution. Evo 1 (5 soulstones) commits Shield-thorns (Orc) vs
      // Charge/Big-Hit (Troll) and grants a complementary socket. Evo 2 (10) refines
      // each into a pure or multi-hit-hybrid form. Multi-hit is the thread woven
      // through every form. Art falls back to the base portrait until it lands.
      evolution: {
        tier1: [
          {
            id: 'orc', name: 'Orc', img: 'assets/Orc.png', hp: 20,
            tagline: 'Defense Is Offense',
            passive: { id: 'shieldlash', name: 'Shieldlash',
              text: 'Whenever you gain <b>Shield</b>, deal that much damage to a random enemy.' },
            socket: { type: 'repeat', index: 0, label: 'Repeat' }
          },
          {
            id: 'troll', name: 'Troll', img: 'assets/Troll.png', hp: 20,
            tagline: 'The Slow Apocalypse',
            passive: { id: 'overcharge', name: 'Overcharge',
              text: 'Every tick of damage you deal adds <b>1 Damage Charge</b> to this turn\u2019s Charge Attack.' },
            socket: { type: 'combo', index: 2, label: 'Combo' }
          }
        ],
        tier2: {
          orc: [
            { id: 'hornedgolem', name: 'Horned Golem', img: 'assets/Horned Golem.png', hp: 20, tagline: 'Living Bramble',
              passive: { id: 'goringhide', name: 'Goring Hide',
                text: 'Every time an enemy takes damage, gain <b>1 Thorns</b> for the rest of combat \u2014 multi-hits bristle you fast.' } },
            { id: 'irongolem', name: 'Iron Golem', img: 'assets/Iron Golem.png', hp: 20, tagline: 'Immovable',
              passive: { id: 'ironwall', name: 'Iron Wall',
                text: 'Your Shield <b>never fades</b> between turns, and you gain <b>+1 Strength</b> for every 10 Shield you currently hold.' } }
          ],
          troll: [
            { id: 'berserkcolossus', name: 'Berserk Colossus', img: 'assets/Berserk Colossus.png', hp: 20, tagline: 'Combo Frenzy',
              passive: { id: 'berserkfrenzy', name: 'Berserk Frenzy',
                text: 'Each damage tick of a multi-hit raises your combo (the alphabet still decides whether it carries or resets).' } },
            { id: 'allknowingcolossus', name: 'All-Knowing Colossus', img: 'assets/All-Knowing Colossus.png', hp: 20, tagline: 'Eternal Charge',
              passive: { id: 'eternalcharge', name: 'Eternal Charge',
                text: 'If your combo is <b>5 or higher</b> at end of turn, your Charge Attack carries its full state into next turn and keeps snowballing.' } }
          ]
        }
      },
      deck: ['smash', 'smash', 'brace', 'brace', 'quake', 'bulwark_slam', 'hammer', 'steady']
    },
    ghoul: {
      id: 'ghoul', name: 'Ghoul', role: 'Feaster', emoji: '🧟',
      img: 'assets/ghoul.png',
      selectBg: 'assets/Ghoul Select Backdrop.png',
      color: 'var(--purple)',
      maxHp: 50, sockets: 3, slotTypes: ['normal', 'normal', 'devil'],
      passive: 'feast', passiveVal: 1,
      passiveText: 'Slaying a foe <b>feasts</b> it, granting a boon in the <b>next encounter</b> and healing you for <b>5%</b> the enemy\u2019s max HP.',
      desc: 'A famished thing that grows by devouring its prey \u2014 every foe it fells gives up a piece of its power.',
      // Branching evolution. Evo 1 at 5 soulstones, Evo 2 at 10. The Multi-devil
      // (Crawler) line is the only one that grants sockets \u2014 at BOTH evo tiers.
      evolution: {
        tier1: [
          {
            id: 'undead', name: 'Undead', img: 'assets/Undead.png', hp: 20,
            tagline: 'Everheal + Feast',
            passive: { id: 'undeadfeast', name: 'Endless Hunger',
              text: 'Feast now has a <b>25%</b> chance to trigger from any attack tick, granting boons in the <b>current combat</b> and healing that is now <b>10%</b> the damaged target\u2019s max HP.' }
          },
          {
            id: 'crawler', name: 'Crawler', img: 'assets/Crawler.png', hp: 20,
            tagline: 'Multi-Devil + Feast',
            passive: { id: 'crawlerfeast', name: 'Skittering Hunger',
              text: 'Satisfying a Devil socket triggers a <b>Feast</b> on a foe.' },
            socket: { type: 'devil', index: 1, label: 'Devil' }
          }
        ],
        tier2: {
          undead: [
            { id: 'skinwalker', name: 'Skinwalker', img: 'assets/Skinwalker.png', hp: 20, tagline: 'Trophy Hunter',
              passive: { id: 'skinwalker', name: 'Wear Their Skin',
                text: 'For every elite and boss you have slain (and will slay), keep <b>all</b> their bonuses and <b>+5% their max HP</b>, permanently. Feast tick-chance <b>+10%</b>.' } },
            { id: 'vampire', name: 'Vampire', img: 'assets/Vampire.png', hp: 20, tagline: 'Bloodgorge',
              passive: { id: 'vampire', name: 'Bloodgorge',
                text: 'Feast procced by damage is now a <b>35%</b> chance and also heals by <b>that amount of damage</b>. Feast kills now heal for <b>25%</b> the enemy\u2019s max HP. Healing past full spills as <b>damage to all foes</b>.' } }
          ],
          crawler: [
            { id: 'demon', name: 'Demon', img: 'assets/Demon.png', hp: 20, tagline: 'Devil\u2019s Glutton',
              passive: { id: 'demon', name: 'Insatiable',
                text: 'Satisfying a Devil socket Feasts <b>twice</b>, and each Devil you sate this turn amplifies your Devil boons by <b>+33%</b>.' },
              socket: { type: 'devil', index: 3, label: 'Devil' } },
            { id: 'wendigo', name: 'Wendigo', img: 'assets/Wendigo.png', hp: 20, tagline: 'Primal Craving',
              passive: { id: 'wendigo', name: 'Primal Craving',
                text: 'Each glyph you play buffs you for the combat \u2014 red <b>+2 Str</b>, blue <b>+2 Res</b>, green <b>5% heal</b>, white a random of the three \u2014 <b>\u00D75</b> if it sates a Devil\u2019s craving.' },
              socket: { type: 'devil', index: 3, label: 'Devil' } }
          ]
        }
      },
      deck: ['leech', 'leech', 'rake', 'rake', 'gnaw', 'vigor', 'blood_harden', 'mend_flesh']
    },
    kitsune: {
      id: 'kitsune', name: 'Kitsune', role: 'Glass Cannon', emoji: '🦊',
      img: 'assets/kitsune.png',
      selectBg: 'assets/Kitsune Select Backdrop.png',
      color: 'var(--red)',
      maxHp: 32, sockets: 3, slotTypes: ['normal', 'normal', 'hold'],
      passive: 'gatheringTails', passiveVal: 1,
      passiveText: 'Gathering Tails: each glyph you play deals +1 damage for every glyph already played this turn.',
      desc: 'Glass-cannon combo chaos. Three sockets — the third Holds a glyph for next turn — and no defense at all.',
      evolveName: 'Nine-Tailed Fox',
      // Branching evolution. Evo 1 fires at 5 soulstones, Evo 2 at 10. Each form
      // stacks a NEW passive on top of the ones before it; Evo 1 also grants a
      // socket. Evo 2's options depend on which Evo 1 form was chosen.
      evolution: {
        tier1: [
          {
            id: 'emberkin', name: 'Emberkin', img: 'assets/Emberkin.png', hp: 20,
            tagline: 'The Burning Path',
            passive: { id: 'smolderingTails', name: 'Smoldering Tails',
              text: 'Every hit you land applies Burn equal to your current combo.' },
            socket: { type: 'loopback', after: 1, label: 'Loop' }
          },
          {
            id: 'tricktail', name: 'Tricktail', img: 'assets/Tricktail.png', hp: 20,
            tagline: 'The Trickster Path',
            passive: { id: 'willOWisps', name: 'Will-o\u2019-Wisps',
              text: 'At end of turn, each glyph left in hand \u2014 junk included \u2014 strikes a random enemy for your highest combo this turn.' },
            socket: { type: 'hold', after: -1, label: 'Hold' }
          }
        ],
        tier2: {
          emberkin: [
            { id: 'inferna', name: 'Inferna', img: 'assets/Inferna.png', hp: 20, tagline: 'Pure Burn',
              passive: { id: 'conflagration', name: 'Conflagration',
                text: 'Your Burn never decays \u2014 its full stack burns every turn until they die \u2014 and your Burn applications are doubled.' } },
            { id: 'cinderdancer', name: 'Cinderdancer', img: 'assets/Cinderdancer.png', hp: 20, tagline: 'Burn \u00D7 Combo',
              passive: { id: 'cinderfall', name: 'Cinderfall',
                text: 'Each time your combo climbs to a new number, deal that much Burn to a random enemy.' } }
          ],
          tricktail: [
            { id: 'foxlights', name: 'Foxlights', img: 'assets/Foxlights.png', hp: 20, tagline: 'Prismatic Draw',
              passive: { id: 'foxlights', name: 'Foxlights',
                text: 'At turn start, each drawn glyph flickers by color \u2014 red: deal 1 (+Strength) to a random foe; blue: gain 1 (+Resilience) shield; green: heal 5% max HP; colorless: a random one of the three.' } },
            { id: 'spectralWeaver', name: 'Spectral Weaver', img: 'assets/Spectral Weaver.png', hp: 20, tagline: 'Eternal Combo',
              passive: { id: 'lingeringCadence', name: 'Lingering Cadence',
                text: 'Your combo number carries across turns \u2014 the chain letters reset, but the count keeps climbing.' } }
          ]
        }
      },
      deck: ['flicker', 'flicker', 'foxfire', 'foxfire', 'onslaught', 'spark', 'smolder', 'mirror']
    }
  };

  /* ----------------------------------------------------------
     ENEMIES — telegraphed intents.
     intentScript: ordered list the engine cycles through.
     ---------------------------------------------------------- */
  const ENEMIES = {
    /* ---- Tier 1: simple, readable (floors 1-2) ---- */
    cinderling: {
      id: 'cinderling', name: 'Cinderling', emoji: '👺', img: 'assets/Cinderling.png', maxHp: 20, ranged: true,
      // an ember-imp pack-buffer: its Strength bumps feed every ally, so a swarm snowballs
      intents: [
        { type: 'attack', value: 5 },
        { type: 'buffStat', stat: 'strength', value: 1 },
        { type: 'attack', value: 3, hits: 2 }
      ],
      desc: 'An ember-imp that whips itself and its kin into a frenzy — its Strength buff feeds every ally, so a pack of them snowballs fast. Focus them down before the swarm spikes.'
    },
    thornback: {
      id: 'thornback', name: 'Thornback', emoji: '🦔', img: 'assets/Thornback.png', maxHp: 30,
      // THORNS gimmick: armors the whole pack in thorns (once), then turtles + jabs
      loopStart: 1,
      intents: [
        { type: 'thornsAll', value: 3 },
        { type: 'blockAll', value: 10 },
        { type: 'attack', value: 5 }
      ],
      desc: 'A bristling hide that armors the whole pack in thorns, then turtles up. Every blow you land on a thorned foe pricks you back — pick your hits and don\'t flail with multi-strikes.'
    },

    /* ---- Tier 2: one disruptive trick each (floors 2-3) ---- */
    hexweaver: {
      id: 'hexweaver', name: 'Hexweaver', emoji: '🪬', img: 'assets/Hexweaver.png', maxHp: 30, ranged: true,
      // weaves Frail/Weak between jabs — softens you so scaling allies hit harder
      intents: [
        [ { type: 'debuff', stat: 'frail', value: 2 }, { type: 'attack', value: 4 } ],
        [ { type: 'debuff', stat: 'weak', value: 2 }, { type: 'attack', value: 4 } ],
        { type: 'thinking' }
      ],
      desc: 'Weaves frailty and weakness into you between jabs — most dangerous beside foes whose damage scales, since your softened defenses let their blows land harder.'
    },
    gravewarden: {
      id: 'gravewarden', name: 'Gravewarden', emoji: '⚰️', img: 'assets/Gravewarden.png', maxHp: 40,
      // buries Rubble in your hand, then telegraphs a Crushing Blow with a Thinking beat
      loopStart: 1,
      intents: [
        [ { type: 'trash', count: 1, where: 'hand' }, { type: 'attack', value: 6 } ],
        { type: 'thinking' },
        { type: 'attack', value: 16 },
        [ { type: 'trash', count: 1, where: 'hand' }, { type: 'attack', value: 6 } ]
      ],
      desc: 'A keeper of the dead that buries Rubble in your hand to choke your draws, then winds up a Crushing Blow. The breath it takes is your cue to brace.'
    },

    /* ---- Tier 3: nastier control (floors 3-4) ---- */
    maledict: {
      id: 'maledict', name: 'Maledict', emoji: '👁️', img: 'assets/Maledict.png', maxHp: 45, ranged: true,
      // MALICE passive (brain): +1 each curse — drives both its strike and curse count
      brain: 'malice', loopStart: 1,
      intents: [
        { type: 'curse', preferLoop: true },
        { type: 'thinking' },
        { type: 'attack', value: 6, malefic: true },
        { type: 'curse', preferLoop: true, maliceCount: true }
      ],
      desc: 'The unblinking eye. Its Malice swells with every curse it lays — fueling both how hard it strikes and how many sockets it corrupts at once. A beatable clock: cut it down before the curses cascade.'
    },
    wormling: {
      id: 'wormling', name: 'Wormling', emoji: '🐛', img: 'assets/Wormling.png', maxHp: 15,
      // torn from a Sapfiend; saps you each turn, and matures into a real threat if ignored
      brain: 'wormling',
      intents: [
        { type: 'sap', value: 4 },
        { type: 'attack', value: 3, gnaw: true },
        { type: 'mature' }
      ],
      desc: 'A torn-off larva that latches on and drains you each turn while it lives. Kill it to stop the bleed — but if you let it linger it matures, biting far harder.'
    },
    sapfiend: {
      id: 'sapfiend', name: 'Sapfiend', emoji: '🕷️', img: 'assets/Sapfiend.png', maxHp: 60,
      // BROOD-BORN (brain): births Wormlings at 10 HP each (no healing), banishes sockets
      brain: 'broodborn',
      intents: [
        { type: 'birthBrood', who: 'wormling', n: 2, hpCost: 10 },
        [ { type: 'banish' }, { type: 'attack', value: 6 } ],
        { type: 'blockAll', value: 5 }
      ],
      desc: 'A brood-mother that tears Wormlings from its own flesh — every birth costs it 10 HP that never returns. It cannot heal, so culling its brood forces it to bleed itself raw.'
    },
    hexwitch: {
      id: 'hexwitch', name: 'Hex Witch', emoji: '🕸️', img: 'assets/Hex Witch.png', maxHp: 45, ranged: true,
      // HEX (brain): while she lives, your turn's combo bonus recoils onto you
      brain: 'hex',
      intents: [
        [ { type: 'hex' }, { type: 'buffStat', stat: 'strength', scope: 'self', value: 2 } ],
        { type: 'attack', value: 6 },
        { type: 'thinking' }
      ],
      desc: 'She lays a Hex that turns your own combos against you — the longer your chain, the harder it recoils. Kill her to break it, or keep your chains short.'
    },

    /* ---- Summon token ---- */
    bonelet: {
      id: 'bonelet', name: 'Bonelet', emoji: '🦴', maxHp: 9, token: true,
      intents: [ { type: 'attack', value: 3 } ],
      desc: 'A skittering conscript.'
    },

    /* ---- Event foes: hunted prey & the collector ---- */
    collector: {
      id: 'collector', name: 'The Monster Collector', emoji: '🪤', maxHp: 46,
      // a trapper: snares your sockets, steels himself, then strikes
      intents: [
        { type: 'attack', value: 7 },
        [ { type: 'sunder', value: 1 }, { type: 'defend', value: 8 } ],
        { type: 'attack', value: 6, hits: 2 }
      ],
      desc: 'A wiry trapper who collects rare beasts. He snares your sockets and wears you down to drag you home in a cage.'
    },
    giantRat: {
      id: 'giantRat', name: 'Giant Rat', emoji: '🐀', maxHp: 38,
      // quick and filthy: a flurry of bites, then a rabid lunge
      intents: [
        { type: 'attack', value: 4, hits: 2 },
        { type: 'attack', value: 9 }
      ],
      desc: 'A bristling, sewer-fat rodent the size of a hound. Fast, filthy, and all teeth.'
    },
    giantChicken: {
      id: 'giantChicken', name: 'Giant Chicken', emoji: '🐔', maxHp: 44, thorns: 1,
      // deceptively vicious: it pecks back at flailers, then flogs with its wings
      intents: [
        { type: 'defend', value: 6 },
        { type: 'attack', value: 5, hits: 2 },
        { type: 'attack', value: 12, big: true }
      ],
      desc: 'An enormous, furious fowl. It pecks back at careless strikes and beats the air to a frenzy before a flogging charge.'
    },

    /* ---- Elites ---- */
    starveling: {
      id: 'starveling', name: 'The Starveling', emoji: '🐺', img: 'assets/Berserk Colossus.png', maxHp: 140, floorBoss: true,
      // a cornered grave-beast: three PERMANENT HP-threshold phases driven by its
      // brain (see STARVELING_BANKS / starvelingSync) + a Hunger Strength ramp.
      // The single dummy intent below is replaced by the brain's phase rotation.
      brain: 'starveling',
      // NOTE: combat uses the brain's phase banks (STARVELING_BANKS in battle.js),
      // which always override these. This list exists purely so the Monster Book
      // shows a representative spread of its three-phase vocabulary.
      intents: [
        { type: 'thinking' },
        { type: 'attack', value: 8 },
        [ { type: 'attack', value: 6 }, { type: 'attack', value: 6 } ],
        [ { type: 'regen', value: 12 }, { type: 'attack', value: 4 } ],
        { type: 'attack', value: 10 },
        { type: 'thornsAll', value: 3 },
        { type: 'attack', value: 22 },
        { type: 'attack', value: 4, hits: 3 }
      ],
      desc: 'A cornered grave-beast that only ever grows hungrier. It stalks docile, then wakes and feeds, then frenzies behind a wall of thorns — and each phase is permanent. Burst it down before its Hunger outscales you.'
    },
    gloommaw: {
      id: 'gloommaw', name: 'Gloommaw', emoji: '👹', img: 'assets/Gaping Maw.png', maxHp: 64, floorBoss: true,
      intents: [
        { type: 'attack', value: 6, hits: 2 },
        [ { type: 'sunder', value: 2 }, { type: 'attack', value: 7 } ],
        { type: 'regen', value: 10 },
        { type: 'attack', value: 18, big: true }
      ],
      desc: 'Rakes, seals a socket, knits its wounds, then builds toward a devastating maw-strike. Punch through its mend window or the fight only drags on.'
    },
    skeleton: {
      id: 'skeleton', name: 'Skeleton', emoji: '🦴', img: 'assets/Undead.png', maxHp: 10, token: true,
      // its strike multiplier climbs with each Bonepiper Dirge (hits = multiplier × 4)
      brain: 'skeleton',
      intents: [ { type: 'attack', value: 4, mult: true } ],
      desc: 'A piped-up conscript. Its swing grows each time the Bonepiper drums — clear it to rewind the multiplier.'
    },
    bonepiper: {
      id: 'bonepiper', name: 'Bonepiper', emoji: '💀', img: 'assets/Bonepiper.png', maxHp: 60, elite: true,
      // PIPE: raises 2 Skeletons (only when none stand); DIRGE: bumps their multiplier
      brain: 'bonepiper',
      intents: [
        { type: 'birthBrood', who: 'skeleton', n: 2, label: 'Pipe' },
        [ { type: 'dirge' }, { type: 'attack', value: 8 } ],
        { type: 'thinking' }
      ],
      desc: 'Pipes the dead into the fray and drums them into a swelling march — each Dirge makes every Skeleton hit harder. Clear the bones to rewind the snowball, or cut down the conductor to end it.'
    },
    warchanter: {
      id: 'warchanter', name: 'Warchanter', emoji: '🥁', img: 'assets/Warchanter.png', maxHp: 50, elite: true,
      // WAR DRUM: each Rally swells Strength + Resilience, and the next Rally beats louder
      brain: 'wardrum',
      intents: [
        [ { type: 'warcry', value: 4 }, { type: 'attack', value: 6 } ],
        [ { type: 'defend', value: 10 }, { type: 'attack', value: 8 } ],
        { type: 'thinking' }
      ],
      desc: 'Beats a war-drum that swells its might and guard turn after turn — and each Rally makes the next one louder. An unresettable ramp: a pure race you must out-damage.'
    },
    clogfiend: {
      id: 'clogfiend', name: 'Clogfiend', emoji: '🫠', img: 'assets/Clogfiend.png', maxHp: 60, elite: true,
      // stuffs your hand with junk, then GORGES once per junk glyph you let pile up
      intents: [
        [ { type: 'clog' }, { type: 'attack', value: 6 } ],
        { type: 'trash', count: 1, where: 'hand' },
        { type: 'frustration' },
        { type: 'gorge', value: 6 }
      ],
      desc: 'Crams Dead Weight and Rubble into your grip, then Gorges — striking once for every junk glyph left in your hand. Purge the clutter on the quiet turns or the feast turns lethal.'
    },

    /* ---- Floor 1 bosses (one of three guards the first ascent) ---- */
    voidIdol: {
      id: 'voidIdol', name: 'The Chaos Idol', emoji: '🗿', img: 'assets/Chaos Idol.png', maxHp: 160, boss: true, enrage: 1, ranged: true,
      // harder than before: opens with disruption, stacks frailty into a buffed
      // double-strike, and its war-fury ramps every turn (enrage)
      intents: [
        [ { type: 'curse', value: 2 }, { type: 'attack', value: 10 } ],
        [ { type: 'sunder', value: 2 }, { type: 'summon', who: 'bonelet', max: 2 } ],
        { type: 'attack', value: 9, hits: 2 },
        [ { type: 'debuff', stat: 'frail', value: 2 }, { type: 'buff', value: 4, turns: 2 } ],
        { type: 'attack', value: 22, big: true },
        [ { type: 'regen', value: 12 }, { type: 'debuff', stat: 'weak', value: 2 } ]
      ],
      desc: 'The heart of the first ascent. It curses, conscripts, seals your sockets — and its fury only grows.'
    },
    hollowChoir: {
      id: 'hollowChoir', name: 'The Hollow Choir', emoji: '🎭', maxHp: 150, boss: true, ranged: true,
      // a swelling congregation: raises the dead, weakens you in waves, and
      // crescendos into a massed hymn-strike
      intents: [
        [ { type: 'summon', who: 'bonelet', max: 3 }, { type: 'debuff', stat: 'weak', value: 2 } ],
        [ { type: 'defend', value: 10 }, { type: 'attack', value: 8 } ],
        [ { type: 'rally', value: 4 }, { type: 'curse', value: 2 } ],
        { type: 'attack', value: 8, hits: 2 },
        { type: 'attack', value: 24, big: true }
      ],
      desc: 'A congregation of stolen voices. It raises the dead, saps your strength in waves, and builds toward a crushing crescendo.'
    },
    mawMother: {
      id: 'mawMother', name: 'The Maw Mother', emoji: '🪸', maxHp: 170, boss: true,
      // an attrition fight: chokes your deck with junk, knits her wounds, and
      // punishes slow turns with grinding multi-hits
      intents: [
        [ { type: 'clog' }, { type: 'attack', value: 7 } ],
        [ { type: 'trash', count: 1, where: 'deck' }, { type: 'defend', value: 12 } ],
        { type: 'attack', value: 7, hits: 3 },
        [ { type: 'regen', value: 14 }, { type: 'debuff', stat: 'frail', value: 2 } ],
        { type: 'attack', value: 20, big: true }
      ],
      desc: 'She feeds you Dead Weight and buries Rubble in your deck, mending herself while your draws choke. Kill her before the rot wins.'
    },

    /* ---- Floor 2 bosses (one of three bars the second ascent) ---- */
    gravetideColossus: {
      id: 'gravetideColossus', name: 'The Gravetide Colossus', emoji: '🗿', img: 'assets/Gravewarden.png', maxHp: 280, boss: true, ward: 3,
      // a walking fortress: its ward shields allies, it seals sockets and
      // answers with avalanche blows
      intents: [
        [ { type: 'defend', value: 16 }, { type: 'attack', value: 12 } ],
        [ { type: 'sunder', value: 2 }, { type: 'summon', who: 'bonelet', max: 2 } ],
        { type: 'attack', value: 11, hits: 2 },
        [ { type: 'trash', count: 1, where: 'deck' }, { type: 'buff', value: 5, turns: 2 } ],
        { type: 'attack', value: 30, big: true }
      ],
      desc: 'A drowned titan of grave-silt. It walls itself in, seals your sockets, and falls on you like a collapsing tomb.'
    },
    cinderQueen: {
      id: 'cinderQueen', name: 'The Cinder Queen', emoji: '👑', img: 'assets/Cinderling.png', maxHp: 240, boss: true, enrage: 2, ranged: true,
      // pure escalation: her court rallies, her fury ramps fast, and her
      // flurries multiply — race her or burn
      intents: [
        [ { type: 'rally', value: 5 }, { type: 'attack', value: 10 } ],
        { type: 'attack', value: 9, hits: 3 },
        [ { type: 'debuff', stat: 'weak', value: 2 }, { type: 'defend', value: 14 } ],
        { type: 'attack', value: 12, hits: 2 },
        { type: 'attack', value: 34, big: true }
      ],
      desc: 'Empress of the ember court. Her fury ramps with every passing turn and her flurries multiply — this fight is a race you must win.'
    },
    hollowShepherd: {
      id: 'hollowShepherd', name: 'The Hollow Shepherd', emoji: '🐏', img: 'assets/Maledict.png', maxHp: 260, boss: true, ranged: true,
      // the control boss: drains your strength, curses and seals, and herds
      // an endless flock between you and it
      intents: [
        [ { type: 'summon', who: 'bonelet', max: 3 }, { type: 'siphon', stat: 'strength', value: 2 } ],
        [ { type: 'curse', value: 2 }, { type: 'attack', value: 11 } ],
        [ { type: 'sunder', value: 2 }, { type: 'debuff', stat: 'frail', value: 2 } ],
        { type: 'attack', value: 10, hits: 2 },
        [ { type: 'regen', value: 18 }, { type: 'attack', value: 26, big: true } ]
      ],
      desc: 'It drains the might you hoard, curses what you build, and herds an endless flock between you and its throat.'
    },

    /* ---- Floor 3: the final boss of the Spire ---- */
    chaosIncarnate: {
      id: 'chaosIncarnate', name: 'Chaos Incarnate', emoji: '🌌', img: 'assets/Chaos Idol.png', maxHp: 420, boss: true, enrage: 2, ranged: true,
      // the end of the climb: every trick in the Spire, stitched into one
      // escalating storm
      intents: [
        [ { type: 'curse', value: 2 }, { type: 'sunder', value: 2 } ],
        [ { type: 'summon', who: 'bonelet', max: 3 }, { type: 'attack', value: 12 } ],
        { type: 'attack', value: 11, hits: 3 },
        [ { type: 'siphon', stat: 'strength', value: 2 }, { type: 'debuff', stat: 'weak', value: 2 } ],
        [ { type: 'defend', value: 20 }, { type: 'buff', value: 6, turns: 2 } ],
        { type: 'attack', value: 40, big: true },
        [ { type: 'regen', value: 20 }, { type: 'debuff', stat: 'frail', value: 2 } ]
      ],
      desc: 'The Spire was only ever its shell. Every curse, every chain, every hungry thing you have fought — all of it was practice for this.'
    },
    // ---- Descension final-FINAL boss (PLACEHOLDER) ----
    // TODO: real design + art. For now it's a meaner Chaos Incarnate that only
    // appears on the 13th Descension's final floor (see FLOOR_BOSSES swap).
    theUnmaking: {
      id: 'theUnmaking', name: 'Soul Hunter \u2014 Ultimate Form', emoji: '☠️', img: 'assets/Soulhunter III.png',
      maxHp: 260, boss: true, finalFinal: true, doomClock: true, brain: 'doomhunter', ranged: true,
      // No socket corruption this form — you face him with your full, intact build.
      // The threat is the Doom Clock (engine-side: setupDoom / checkDoomArm / the
      // descending number rendered over your sockets). Steady pressure races it.
      // maxHp is the key tuning knob: aim killable on a ~5-socket run via near-
      // perfect play (roughly socket-count clean chains of output).
      intents: [
        { type: 'attack', value: 14 },
        [ { type: 'scare', value: 3 }, { type: 'attack', value: 10 } ],
        { type: 'attack', value: 9, hits: 2 },
        { type: 'thinking' }
      ],
      desc: 'The hunt\'s end. He takes nothing from your build this time — he simply starts the clock. Every socket is a heartbeat: chain clean through all of them each turn to buy another, and put him down before the count strikes one.'
    }
  };

  /* ----------------------------------------------------------
     ITEMS — single-use consumables the player carries between fights.
     `combatOnly` items can only be used during a battle; the rest can be
     used anywhere from the top-HUD item tray. `passive` items also do
     something automatically while carried (Soul Jar's death-save).
     Effects are resolved in battle.js (combat) / game.js (out of combat).
     ---------------------------------------------------------- */
  const ITEMS = {
    blood_phial:     { id: 'blood_phial', name: 'Blood Phial', icon: '🩸', img: 'assets/Blood Phial.png', rarity: 'common', price: 30, combatOnly: false,
                       desc: 'Heal <b>30%</b> of your active beast\'s max HP.', effect: { kind: 'heal', pct: 0.30 } },
    unmelting_ice:   { id: 'unmelting_ice', name: 'Unmelting Ice', icon: '❄️', img: 'assets/Unmelting Ice.png', rarity: 'common', price: 32, combatOnly: true,
                       desc: 'Gain <b>15</b> shield. It lingers all combat until chipped away.', effect: { kind: 'shield', value: 15 } },
    acid_phial:      { id: 'acid_phial', name: 'Acid Phial', icon: '🧪', img: 'assets/Acid Phial.png', rarity: 'uncommon', price: 46, combatOnly: true,
                       desc: 'Strip the shields off <b>all</b> enemies and apply <b>Weak 3</b>.', effect: { kind: 'acid', weak: 3 } },
    throwing_knife:  { id: 'throwing_knife', name: 'Dagger', icon: '🔪', img: 'assets/Dagger.png', rarity: 'common', price: 34, combatOnly: true,
                       desc: 'Deal <b>10</b> damage to all enemies.', effect: { kind: 'damageAll', value: 10 } },
    explosive_knife: { id: 'explosive_knife', name: 'Exploding Dagger', icon: '💣', img: 'assets/Exploding Dagger.png', rarity: 'uncommon', price: 58, combatOnly: true, unlock: 'item_exploding',
                       desc: 'Deal <b>30</b> damage to all enemies.', effect: { kind: 'damageAll', value: 30 } },
    soul_jar:        { id: 'soul_jar', name: 'Soul Jar', icon: '⚱️', img: 'assets/Soul Jar.png', rarity: 'rare', price: 96, combatOnly: false, passive: true, unlock: 'item_souljar',
                       desc: 'Use to <b>fully heal</b> your active beast. While carried, it shatters to <b>revive</b> a fallen beast at <b>30%</b> HP — then it\'s spent.', effect: { kind: 'soulHeal' } },
    emergency_phial: { id: 'emergency_phial', name: 'Emergency Phial', icon: '🧫', img: 'assets/Emergency Phial.png', rarity: 'uncommon', price: 44, combatOnly: true,
                       desc: 'Pull a <b>chosen glyph</b> from your deck straight into your hand this turn.', effect: { kind: 'tutor' } },
    ember_tome:      { id: 'ember_tome', name: 'Archaic Tome', icon: '📜', img: 'assets/Archaic Tome.png', rarity: 'uncommon', price: 60, combatOnly: false,
                       desc: 'Gain a random <b>common</b> blessing.', effect: { kind: 'blessing', rarity: 'common' } },
    astral_tome:     { id: 'astral_tome', name: 'Astral Tome', icon: '📖', img: 'assets/Astral Tome.png', rarity: 'rare', price: 110, combatOnly: false, unlock: 'item_astraltome',
                       desc: 'Gain a random <b>rare</b> blessing.', effect: { kind: 'blessing', rarity: 'rare' } },
    bramble_draught: { id: 'bramble_draught', name: 'Bramble Gauntlets', icon: '🌵', img: 'assets/Bramble Gauntlets.png', rarity: 'common', price: 34, combatOnly: true,
                       desc: 'Gain <b>5 Thorns</b> this combat — attackers take 5 damage back.', effect: { kind: 'thorns', value: 5 } },
    war_tincture:    { id: 'war_tincture', name: 'War Tincture', icon: '⚔️', img: 'assets/War Tincture.png', rarity: 'uncommon', price: 48, combatOnly: true,
                       desc: 'Gain <b>3 Strength</b> and <b>3 Resilience</b> this combat.', effect: { kind: 'buff', str: 3, res: 3 } }
  };

  /* ----------------------------------------------------------
     formatDesc — render a glyph's description with live numbers.
     `env` carries the current chain/state bonuses so a card can preview
     exactly what it will do if played next:
       gather       +N from a "per glyph already played" passive
       comboBonus   +N from the alphabet combo chain
       cloneEmpower +N from being a Clone copy
       strength     player strength (added to damage only)
       weak         true => damage reduced 40% (applied before strength)
       shield       current shield (for shield-scaling glyphs)
       ember        true => Emberstorm adds +1 to red damage/burn
     A neutral env (all 0/false) yields the glyph's base numbers.
     ---------------------------------------------------------- */
  function formatDesc(g, env) {
    if (!g.dyn || !g.dyn.length) return g.desc;
    env = env || {};
    const gather = env.gather || 0, combo = env.comboBonus || 0;
    const clone = env.cloneEmpower || 0;
    const weak = !!env.weak, shield = env.shield || 0;
    const resilience = env.resilience || 0, frail = !!env.frail;
    const ember = (g.color === 'red') ? (Number(env.ember) || 0) : 0;
    const str = env.strength || 0;
    // multi-hit / AoE glyphs add the combo NUMBER at a reduced rate (per hit), and
    // lean on Strength less per strike than a single big hitter does
    const cf = comboFactorOf(g);
    const sMul = strMulOf(g, env.strUp || 0);
    // combo + clone empower every effect kind; on DAMAGE the combo number is scaled
    // by the multi-hit factor. Gathering Tails (gather) only feeds DAMAGE.
    const gtAll = combo + clone;
    const gtDmg = combo * cf + clone;
    let out = g.desc;
    g.dyn.forEach((tok, i) => {
      const base = (typeof tok.base === 'function') ? tok.base(env) : tok.base;
      let v;
      if (tok.kind === 'dmg') {
        v = base + gtDmg + gather + ember;
        if (weak) v = Math.max(1, Math.round(v * 0.6));
        v += str * sMul;            // Strength scales the per-hit base by the glyph's multiplier
        v = Math.ceil(v);           // damage rounds up
      } else if (tok.kind === 'burn') {     // Burn is not "damage" — Emberstorm/Pyreheart don't touch it
        v = base + gtAll;
      } else if (tok.kind === 'shield') {   // Resilience boosts shield, Frail halves it
        v = base + gtAll + resilience;
        if (frail) v = Math.floor(v * 0.5);
      } else {                       // heal — no strength, no weak
        v = base + gtAll;
      }
      v = Math.max(0, Math.round(v));
      const cls = v > base ? ' class="dyn-up"' : (v < base ? ' class="dyn-down"' : '');
      out = out.split('{' + i + '}').join('<b' + cls + '>' + v + '</b>');
    });
    return out;
  }
  /* ----------------------------------------------------------
     Attack-glyph scaling helpers.
     - Multi-hit / AoE damage glyphs (flagged `multiHit: true`) add the combo
       NUMBER at a reduced rate so high combos don't explode repeated strikes;
       single hitters take the full combo number.
     - Strength is a PER-HIT bonus scaled by each glyph's own multiplier: single
       hitters carry it best (~0.9); the more a glyph splinters its damage the
       less each strike leans on Strength. Override per glyph with `strMul`.
     - Each upgrade (Power +N) nudges the multiplier up — single hitters more.
     ---------------------------------------------------------- */
  function glyphIsMulti(g) { return !!(g && g.multiHit); }
  function comboFactorOf(g) { return glyphIsMulti(g) ? 0.33 : 1; }
  function glyphHitCount(g) { return Math.max(1, (g && g.hits) || (glyphIsMulti(g) ? 3 : 1)); }
  function strMulBase(g) {
    if (g && typeof g.strMul === 'number') return g.strMul;
    const h = glyphHitCount(g);
    if (h <= 1) return 0.9;
    return Math.max(0.2, Math.round((0.9 / Math.pow(h, 0.62)) * 20) / 20);   // rounded to .05
  }
  function strMulOf(g, upgrades) {
    const step = glyphIsMulti(g) ? 0.04 : 0.1;
    return Math.round((strMulBase(g) + step * (upgrades || 0)) * 100) / 100;
  }

  /* ----------------------------------------------------------
     FEAST — the Ghoul's core. Every enemy spawns holding a small set
     of predefined bonuses (one of each), themed to its kit and sized by
     menace (normal 2 · elite 3 · boss 4). A Feast saps ONE random
     remaining bonus; once taken it's gone. Tokens hold nothing.
     bonus token: { t, n?, pct? }
       str/res/thorn  +N for the combat
       guard          +N Block at each turn start (combat)
       rampstr        +N Strength at each turn start (combat)
       weaken/scare   apply N to all foes
       heal           heal pct of max HP now
       souls          +N souls (permanent)
       purge          clear junk + clog-immune this combat
       cleanse        remove the first Curse each turn this combat
     ---------------------------------------------------------- */
  const FEAST_SETS = {
    /* normal (2) */
    cinderling:   [{ t: 'str', n: 1 }, { t: 'souls', n: 5 }],
    thornback:    [{ t: 'thorn', n: 1 }, { t: 'guard', n: 1 }],
    hexweaver:    [{ t: 'res', n: 2 }, { t: 'cleanse' }],
    gravewarden:  [{ t: 'guard', n: 2 }, { t: 'souls', n: 5 }],
    maledict:     [{ t: 'str', n: 2 }, { t: 'weaken', n: 2 }],
    sapfiend:     [{ t: 'res', n: 2 }, { t: 'thorn', n: 1 }],
    giantRat:     [{ t: 'str', n: 2 }, { t: 'souls', n: 5 }],
    giantChicken: [{ t: 'thorn', n: 1 }, { t: 'guard', n: 2 }],
    collector:    [{ t: 'souls', n: 8 }, { t: 'str', n: 2 }],
    /* elite (3) */
    bonepiper:    [{ t: 'str', n: 3 }, { t: 'scare', n: 2 }, { t: 'souls', n: 10 }],
    warchanter:   [{ t: 'str', n: 3 }, { t: 'rampstr', n: 1 }, { t: 'souls', n: 10 }],
    clogfiend:    [{ t: 'purge' }, { t: 'res', n: 2 }, { t: 'souls', n: 10 }],
    soulhunter:   [{ t: 'str', n: 3 }, { t: 'souls', n: 20 }, { t: 'scare', n: 3 }],
    /* floor / final boss (4) */
    gloommaw:          [{ t: 'str', n: 3 }, { t: 'heal', pct: 0.10 }, { t: 'guard', n: 1 }, { t: 'souls', n: 10 }],
    voidIdol:          [{ t: 'str', n: 4 }, { t: 'guard', n: 2 }, { t: 'weaken', n: 3 }, { t: 'souls', n: 20 }],
    hollowChoir:       [{ t: 'str', n: 4 }, { t: 'scare', n: 3 }, { t: 'heal', pct: 0.15 }, { t: 'souls', n: 20 }],
    mawMother:         [{ t: 'purge' }, { t: 'res', n: 2 }, { t: 'heal', pct: 0.15 }, { t: 'souls', n: 20 }],
    gravetideColossus: [{ t: 'guard', n: 4 }, { t: 'str', n: 4 }, { t: 'thorn', n: 2 }, { t: 'souls', n: 20 }],
    cinderQueen:       [{ t: 'str', n: 4 }, { t: 'rampstr', n: 2 }, { t: 'weaken', n: 3 }, { t: 'souls', n: 20 }],
    hollowShepherd:    [{ t: 'str', n: 4 }, { t: 'res', n: 2 }, { t: 'scare', n: 3 }, { t: 'souls', n: 20 }],
    chaosIncarnate:    [{ t: 'str', n: 5 }, { t: 'guard', n: 3 }, { t: 'heal', pct: 0.20 }, { t: 'souls', n: 30 }]
  };
  // which bonus types Skinwalker keeps PERMANENTLY (persistent stats only —
  // souls/heal are one-time, weaken/scare are per-combat debuffs)
  const FEAST_PERSIST = { str: true, res: true, thorn: true, guard: true, rampstr: true };
  function feastPoolFor(def) {
    if (!def || def.token) return [];
    return (FEAST_SETS[def.id] || []).map(b => Object.assign({}, b));
  }
  // fold an enemy's persistent bonuses into a running Skinwalker "skin" tally
  function feastTrophyAdd(skin, enemyId) {
    (FEAST_SETS[enemyId] || []).forEach(b => {
      if (FEAST_PERSIST[b.t]) skin[b.t] = (skin[b.t] || 0) + (b.n || 0);
    });
    return skin;
  }
  function feastLabel(b) {
    switch (b && b.t) {
      case 'str': return '+' + b.n + ' Strength';
      case 'res': return '+' + b.n + ' Resilience';
      case 'thorn': return '+' + b.n + ' Thorns';
      case 'guard': return '+' + b.n + ' Block/turn';
      case 'rampstr': return '+' + b.n + ' Str/turn';
      case 'weaken': return 'Weak ' + b.n + ' (all)';
      case 'scare': return 'Scare ' + b.n + ' (all)';
      case 'heal': return 'Heal ' + Math.round(b.pct * 100) + '%';
      case 'souls': return '+' + b.n + ' Souls';
      case 'purge': return 'Purge';
      case 'cleanse': return 'Cleanse';
    }
    return 'Bonus';
  }

  /* ----------------------------------------------------------
     DESCENSION — the 13-level meta-gauntlet.
     Each entry is ONE modifier that switches on at its level and STAYS on for
     every deeper level (they stack). All numbers here are PLACEHOLDER / tunable
     bones — balance them later. Recognized effect keys:
       enemyHpMul       multiply every enemy's max HP
       enemyDmgMul      multiply every enemy attack value
       eliteBossDmgMul  extra attack multiplier for elites / floor & final bosses
       enrageAdd        add this much Enrage to every enemy (incl. non-enraging)
       healMul          multiply ALL player healing (combat + services)
       playerHpMul      multiply the beast's starting max HP at run start
       shopMul          multiply shop prices
       eliteBias        add this many extra elite rows to the map
       fewerRests       drop the optional mid-floor rest
       finalBoss        swap the act-3 boss for the unique final-FINAL boss
     `name`/`desc` are surfaced in the Mode Select modifier preview.
     ---------------------------------------------------------- */
  const DESCENSION_MODS = [
    { level: 1,  name: 'Bloodthirst I',  desc: 'Foes have +15% HP.',                 enemyHpMul: 1.15 },
    { level: 2,  name: 'Ferocity I',     desc: 'Foes deal +15% damage.',             enemyDmgMul: 1.15 },
    { level: 3,  name: 'Withering',      desc: 'Your healing is reduced by 25%.',     healMul: 0.75 },
    { level: 4,  name: 'Swarm',          desc: 'The Spire crawls with extra elites.', eliteBias: 1 },
    { level: 5,  name: 'Bloodthirst II', desc: 'Foes have +15% more HP.',             enemyHpMul: 1.15 },
    { level: 6,  name: 'Frailty',        desc: 'Your beasts start with 10% less max HP.', playerHpMul: 0.90 },
    { level: 7,  name: 'Ferocity II',    desc: 'Foes deal +15% more damage.',         enemyDmgMul: 1.15 },
    { level: 8,  name: 'Scarcity',       desc: 'Shop prices +25%, and breathers are scarce.', shopMul: 1.25, fewerRests: true },
    { level: 9,  name: 'Relentless I',   desc: 'Every foe gains +1 Enrage.',          enrageAdd: 1 },
    { level: 10, name: 'Bloodthirst III',desc: 'Foes have +20% more HP.',             enemyHpMul: 1.20 },
    { level: 11, name: 'Relentless II',  desc: 'Every foe gains another +1 Enrage.',  enrageAdd: 1 },
    { level: 12, name: 'Doom',           desc: 'Elites and bosses deal +25% damage.', eliteBossDmgMul: 1.25 },
    { level: 13, name: 'The Unmaking',   desc: 'A nameless horror guards the final floor. +10% enemy HP & damage.', enemyHpMul: 1.10, enemyDmgMul: 1.10, finalBoss: true }
  ];
  // Merge every modifier for levels 1..N into one effect object.
  // Multipliers compound; additive/boolean keys accumulate/OR.
  function descensionStack(level) {
    const eff = { enemyHpMul: 1, enemyDmgMul: 1, eliteBossDmgMul: 1, healMul: 1, playerHpMul: 1,
                  shopMul: 1, enrageAdd: 0, eliteBias: 0, fewerRests: false, finalBoss: false };
    if (!level || level < 1) return eff;
    DESCENSION_MODS.forEach(m => {
      if (m.level > level) return;
      if (m.enemyHpMul)      eff.enemyHpMul      *= m.enemyHpMul;
      if (m.enemyDmgMul)     eff.enemyDmgMul     *= m.enemyDmgMul;
      if (m.eliteBossDmgMul) eff.eliteBossDmgMul *= m.eliteBossDmgMul;
      if (m.healMul)         eff.healMul         *= m.healMul;
      if (m.playerHpMul)     eff.playerHpMul     *= m.playerHpMul;
      if (m.shopMul)         eff.shopMul         *= m.shopMul;
      if (m.enrageAdd)       eff.enrageAdd       += m.enrageAdd;
      if (m.eliteBias)       eff.eliteBias       += m.eliteBias;
      if (m.fewerRests)      eff.fewerRests       = true;
      if (m.finalBoss)       eff.finalBoss        = true;
    });
    return eff;
  }
  // The list of individual modifiers active at level N (for previews).
  function descensionModsUpTo(level) {
    return DESCENSION_MODS.filter(m => m.level <= (level || 0));
  }

  root.CG = root.CG || {};
  root.CG.DATA = { COLOR, GLYPHS, BLESSINGS, POWER_BLESSINGS, SOUL_BLESSINGS, EVENT_BLESSINGS, MONSTERS, ENEMIES, ITEMS, formatDesc,
    FEAST_SETS, feastPoolFor, feastTrophyAdd, feastLabel,
    glyphIsMulti, comboFactorOf, glyphHitCount, strMulBase, strMulOf,
    DESCENSION_MODS, descensionStack, descensionModsUpTo, MAX_DESCENSION: 13 };

})(window);
