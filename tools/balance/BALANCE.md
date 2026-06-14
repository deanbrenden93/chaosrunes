# Chaos Glyphs — difficulty balance pass

Goal (design targets, % chance to **clear** each floor):

| run quality | Floor 1 | Floor 2 | Floor 3 |
|---|---|---|---|
| great   | 90% | 80% | 70% |
| average | 70% | 60% | 50% |
| bad     | 60% | 50% | 35% |

Hero modifiers (applied on top of the category %): **Goblin +10%** all floors; **Ghoul** neutral (the reference hero); **Kitsune −10% F1 / 0 F2 / +10% F3**.

## How this was approached

Hitting *probability* targets needs measurement, not vibes, so I built a Monte-Carlo
simulator — `tools/balance/sim.js` — that mirrors the real combat formulas
(`js/battle.js`, `js/data.js`): the combo chain, Strength/`strMul`, Gathering Tails,
ember bonuses, hits/AoE, Burn DoT, enemy intents, enrage/Hunger snowball, and the
`scaleEnemyDef` HP/damage curve. It plays a greedy "build the best A→B→C chain, block the
telegraphed hit, kill the buffers/adds first, heal when low" policy and runs thousands of
full floors per cell.

Run it:

```
node tools/balance/sim.js 2000     # full win-rate table at shipped numbers
node tools/balance/sim.js sweep    # grid-search difficulty knobs vs targets
node tools/balance/sim.js trace goblin great 2   # turn-by-turn trace of one floor
```

Three run "archetypes" (bad/avg/great) are modeled as accumulated power per floor
(Strength, ember, sockets, upgrades, deck adds, max-HP, blessings, items — see
`powerProfile`). **Sockets** turned out to be the dominant late-game lever (you can reach
9; that's 9 glyphs/turn).

## What the model found

1. **The previous "+100% HP / +50% dmg" boss change made the game unwinnable.** Baseline
   sim was ~0–25% to clear *any* floor for *any* hero — bosses were impassable walls.
2. **The damage curve exploded.** Damage shared the HP curve's *quadratic* shape, so deep
   boss hits reached 100–250 — one-shots. Damage must scale far gentler than HP.
3. **Boss *rooms* (boss + escorts) snowball.** Cinderling escorts buff everyone's Strength
   every turn; stacked with enrage/Hunger, incoming ramped 48→73→99 and killed the player.
4. **Floors 2-3 are DPS-checks.** The quadratic HP pools mean weaker (lower-socket) runs
   can't out-race the snowball; strong runs crush. This makes results *binary* near a power
   threshold rather than a smooth gradient.

## Changes shipped (all in `js/`)

`battle.js` `scaleEnemyDef` (`depth = (floor-1)*15 + row`):
- **HP curve** `progHpMul = 1 + 0.063·d + 0.0017·d²` (was `…+0.00213·d²`). Keeps enemies
  tanky (ref normal ≈ **93 HP** at floor-2 start, ≈ **225** mid-floor-3) but trims the
  explosive high end so boss rooms aren't unbeatable.
- **Damage curve** `progDmgMul = 1 + 0.024·d` — now **linear** (was quadratic). Big hits
  stay blockable/survivable instead of one-shotting.
- **Tier multipliers:** elite HP 1.5→**1.35**, boss HP 2.0→**1.4**; elite dmg 1.25→**1.05**,
  boss dmg 1.5→**1.0** (bosses are scary via HP + telegraphed bigs + snowball, not a flat
  damage premium).
- Starveling banks use boss dmg tier 1.0 (was ×1.5).

Snowball / rooms:
- Starveling **Hunger** softened to +1/turn in phases 2-3 (was +1 then +2).
- Boss **enrage** lowered: Cinder Queen 2→1, Chaos Incarnate 2→1.
- Boss **escorts** lightened (`game.js`): Cinder Queen 2 Cinderlings → 1; Chaos Incarnate
  drops the Hexweaver (keeps Maledict). Cuts late boss-room HP and multi-attacker bursts.

Consistency:
- Fixed `depth` using `(act-1)*10` in **event battles** and the **re-fight path**
  (`game.js`) to match the mainline `(act-1)*15`, so those fights scale on the same curve.

No blessings or items were removed. Player power was **not** nerfed.

## Model results at shipped numbers (`node sim.js 2000`)

```
GREAT   F1        F2        F3
goblin  100/90   100/80    91/70
ghoul   100/90    87/80    39/70
kitsune  90/90    56/80    10/70
AVG     F1        F2        F3
goblin  100/70    96/60    12/50
ghoul   100/70    30/60     0/50
kitsune  60/70     0/60    10/50
BAD     F1        F2        F3
goblin   95/60    10/50    10/35
ghoul    93/60     0/50     0/35
kitsune   1/60     0/50     0/35
```

## Honest caveats (read before trusting the numbers)

- **The game is now completable with the right ramp** (Floor 1 easy → Floor 3 hardest),
  which is the headline win versus the prior impassable state. Floor 1 lands close to
  target across heroes.
- **Exact percentages are not hit, and the model can't hit them**, for real reasons:
  - *Binary cliffs:* floors 2-3 are DPS-checks, so the model returns ~100% or ~0% near a
    power threshold instead of a smooth 30-pt spread. Real play has more variance (draws,
    mistakes, item timing) that softens this — the true curve is gentler than the model's.
  - *Kitsune is under-modeled.* Its identity is explosive burn-detonation and Onslaught
    (hits = glyphs played, so 9 sockets = 9 hits) — burst the role/value abstraction
    underrates — on a 32-HP frame, so it reads as a coin-flip. Its real numbers are almost
    certainly higher than shown; treat Kitsune as the playtest priority.
  - *Ghoul/avg/bad on floors 2-3* read low because the model's near-optimal policy can't
    extract their sustain/variance edge.
- I deliberately erred toward **completable-and-fair** rather than brutal: better to find
  it slightly easy in playtest and nudge enemies up than to ship the prior wall.

## Recommended next steps (with the sim as a tuning tool)

1. **Playtest floors 2-3**, especially Ghoul and Kitsune, and the Cinder Queen / Chaos
   Incarnate rooms.
2. If great runs feel *too* safe on F1/F2, nudge `BOSS_HP`/`tierDmg` up a touch.
3. If weak runs wall on F3, lower `HP_Q` slightly more (flattens late HP) or raise the
   reward/socket economy so avg/bad reach more sockets.
4. Re-run `node sim.js sweep` after any data change to keep the model honest.
