// 旌旗戰棋 — 純邏輯層（無 DOM）。
// 座標一律用 {x, y}；x 向右、y 向下。棋盤以字串陣列描述地形。

export const TERRAIN = {
  plain: { name: "平地", cost: 1, def: 0 },
  grass: { name: "草埔", cost: 1, def: 5 },
  forest: { name: "竹林", cost: 2, def: 20 },
  hill: { name: "土丘", cost: 2, def: 30 },
  water: { name: "溪水", cost: Infinity, def: 0 },
  wall: { name: "石垣", cost: Infinity, def: 0 },
  banner: { name: "帥旗", cost: 1, def: 10 },
};

export const UNIT_TYPES = {
  spear: { name: "槍兵", move: 3, range: 1, maxHp: 26, atk: 9, beats: "cavalry", skill: "架槍" },
  bow: { name: "弓兵", move: 3, range: 2, maxHp: 20, atk: 8, beats: "spear", skill: "瞄準射擊" },
  cavalry: { name: "騎兵", move: 5, range: 1, maxHp: 24, atk: 10, beats: "bow", skill: "衝鋒" },
  commander: { name: "主將", move: 4, range: 1, maxHp: 32, atk: 11, beats: null },
};

export const ADVANTAGE = 1.5;
export const DISADVANTAGE = 0.7;
export const EXP_PER_HIT = 12;
export const EXP_PER_KILL = 34;
export const EXP_PER_LEVEL = 100;

// 章節地圖：`.`平地 `,`草埔 `f`竹林 `^`土丘 `~`溪水 `#`石垣 `B`帥旗
const LEGEND = { ".": "plain", ",": "grass", f: "forest", "^": "hill", "~": "water", "#": "wall", B: "banner" };

export const CHAPTERS = [
  {
    title: "竹圍隘口",
    brief: "山賊擋在竹圍隘口。擊潰全部敵軍。",
    objective: { kind: "rout" },
    map: [
      ",,f..^^.",
      ",.f...^.",
      "..,,,,..",
      "#..,,..#",
      "#..,,..#",
      "..,,,,..",
      ".^...f,,",
      ".^^..f,,",
    ],
    allies: [
      { type: "spear", x: 2, y: 7 },
      { type: "bow", x: 4, y: 7 },
      { type: "cavalry", x: 3, y: 6 },
      { type: "spear", x: 5, y: 6 },
    ],
    foes: [
      { type: "spear", x: 2, y: 0, name: "賊眾" },
      { type: "spear", x: 5, y: 0, name: "賊眾" },
      { type: "bow", x: 3, y: 1, name: "賊弓" },
      { type: "cavalry", x: 6, y: 1, name: "賊騎" },
    ],
  },
  {
    title: "溪畔渡口",
    brief: "敵軍主力未到。十二回合內奪下對岸帥旗。",
    objective: { kind: "seize", x: 4, y: 0, turns: 12 },
    map: [
      "^..fB..^",
      "^.,...,^",
      ".,,..,,.",
      "~~.~~.~~",
      "~~.~~.~~",
      ".,,..,,.",
      "f.,...,f",
      "f..,,..f",
    ],
    allies: [
      { type: "spear", x: 2, y: 7 },
      { type: "bow", x: 5, y: 7 },
      { type: "cavalry", x: 3, y: 6 },
      { type: "spear", x: 4, y: 6 },
    ],
    foes: [
      { type: "bow", x: 4, y: 1, name: "守旗弓" },
      { type: "spear", x: 2, y: 1, name: "守渡兵" },
      { type: "spear", x: 5, y: 2, name: "守渡兵" },
      { type: "cavalry", x: 1, y: 2, name: "巡騎" },
      { type: "cavalry", x: 6, y: 2, name: "巡騎" },
    ],
  },
  {
    title: "圍城破陣",
    brief: "斬落敵方主將，圍城即解。",
    objective: { kind: "commander" },
    map: [
      "###B####",
      "#..^^..#",
      "#.,..,.#",
      "..f..f..",
      "..f..f..",
      "#.,..,.#",
      "#..^^..#",
      "..,,,,..",
    ],
    allies: [
      { type: "spear", x: 1, y: 7 },
      { type: "spear", x: 6, y: 7 },
      { type: "bow", x: 3, y: 7 },
      { type: "cavalry", x: 4, y: 7 },
    ],
    foes: [
      { type: "commander", x: 3, y: 1, name: "敵將" },
      { type: "bow", x: 1, y: 2, name: "城弓" },
      { type: "spear", x: 2, y: 3, name: "城兵" },
      { type: "spear", x: 5, y: 3, name: "城兵" },
      { type: "cavalry", x: 4, y: 4, name: "出擊騎" },
    ],
  },
];

const ALLY_NAMES = ["阿賢", "秀娥", "阿義", "文彬", "阿慶"];

export function parseMap(rows) {
  return {
    w: rows[0].length,
    h: rows.length,
    tiles: rows.map((row) => [...row].map((c) => LEGEND[c] ?? "plain")),
  };
}

export function terrainAt(state, x, y) {
  if (x < 0 || y < 0 || x >= state.w || y >= state.h) return null;
  return state.tiles[y][x];
}

export function unitAt(state, x, y) {
  return state.units.find((u) => u.hp > 0 && u.x === x && u.y === y) ?? null;
}

function makeUnit(spec, side, index, carried) {
  const base = UNIT_TYPES[spec.type];
  const lvl = carried?.lvl ?? 1;
  const rewardHp = carried?.bonusHp ?? 0;
  const rewardAtk = carried?.bonusAtk ?? 0;
  const bonusHp = (lvl - 1) * 3 + rewardHp;
  const bonusAtk = lvl - 1 + rewardAtk;
  const foeHpPenalty = side === "foe" && spec.type !== "commander" ? 4 : 0;
  const foeAtkPenalty = side === "foe" ? (spec.type === "commander" ? 1 : 2) : 0;
  return {
    id: `${side}-${index}`,
    side,
    type: spec.type,
    name: spec.name ?? carried?.name ?? ALLY_NAMES[index % ALLY_NAMES.length],
    x: spec.x,
    y: spec.y,
    lvl,
    exp: carried?.exp ?? 0,
    maxHp: base.maxHp + bonusHp - foeHpPenalty,
    hp: base.maxHp + bonusHp - foeHpPenalty,
    atk: base.atk + bonusAtk - foeAtkPenalty,
    bonusHp: rewardHp,
    bonusAtk: rewardAtk,
    moved: false,
    acted: false,
    movedDistance: 0,
    guarding: false,
    skillCd: 0,
  };
}

/**
 * roster：跨章保留的我軍（陣亡者不再出現）。
 * 傳入 roster 時，會依序套用等級／經驗到該章的我軍位置。
 */
export function createGame({ chapter = 0, roster = null, seed = 1 } = {}) {
  const ch = CHAPTERS[Math.min(chapter, CHAPTERS.length - 1)];
  const { w, h, tiles } = parseMap(ch.map);
  const carried = roster ? roster.filter((r) => r.alive !== false) : null;
  const allySpecs = carried
    ? ch.allies.slice(0, Math.max(1, carried.length)).map((spec, i) => ({ ...spec, type: carried[i]?.type ?? spec.type }))
    : ch.allies;
  const units = [
    ...allySpecs.map((spec, i) => makeUnit(spec, "ally", i, carried?.[i])),
    ...ch.foes.map((spec, i) => makeUnit(spec, "foe", i)),
  ];
  return {
    seed,
    chapter: Math.min(chapter, CHAPTERS.length - 1),
    title: ch.title,
    brief: ch.brief,
    objective: { ...ch.objective },
    w,
    h,
    tiles,
    units,
    turn: 1,
    phase: "ally",
    outcome: "playing",
    score: 0,
    log: [ch.brief],
  };
}

/** 可移動格：Dijkstra（地形成本；敵軍阻擋、友軍可穿越但不可停留）。 */
export function movementRange(state, unit) {
  const budget = UNIT_TYPES[unit.type].move;
  const key = (x, y) => `${x},${y}`;
  const best = new Map([[key(unit.x, unit.y), 0]]);
  const queue = [{ x: unit.x, y: unit.y, cost: 0 }];
  const out = [];
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const cur = queue.shift();
    if (cur.cost > (best.get(key(cur.x, cur.y)) ?? Infinity)) continue;
    if (!(cur.x === unit.x && cur.y === unit.y)) {
      const blocker = unitAt(state, cur.x, cur.y);
      if (!blocker) out.push({ x: cur.x, y: cur.y, cost: cur.cost });
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const t = terrainAt(state, nx, ny);
      if (!t) continue;
      const step = TERRAIN[t].cost;
      if (!Number.isFinite(step)) continue;
      const occupant = unitAt(state, nx, ny);
      if (occupant && occupant.side !== unit.side) continue;
      const next = cur.cost + step;
      if (next > budget) continue;
      if (next < (best.get(key(nx, ny)) ?? Infinity)) {
        best.set(key(nx, ny), next);
        queue.push({ x: nx, y: ny, cost: next });
      }
    }
  }
  return out;
}

export function canMoveTo(state, unit, x, y) {
  return movementRange(state, unit).some((c) => c.x === x && c.y === y);
}

export function distance(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** 站在 (x,y) 時可攻擊的敵軍。 */
export function targetsFrom(state, unit, x = unit.x, y = unit.y) {
  const range = UNIT_TYPES[unit.type].range;
  return state.units.filter((u) => u.hp > 0 && u.side !== unit.side && distance({ x, y }, u) <= range);
}

/** 該單位本回合移動後可能攻擊到的所有格子，用於敵方威脅預覽。 */
export function threatRange(state, unit) {
  const origins = [{ x: unit.x, y: unit.y }, ...movementRange(state, unit)];
  const range = UNIT_TYPES[unit.type].range;
  const cells = new Map();
  for (const origin of origins) {
    for (let y = 0; y < state.h; y += 1) {
      for (let x = 0; x < state.w; x += 1) {
        if (distance(origin, { x, y }) <= range) cells.set(`${x},${y}`, { x, y });
      }
    }
  }
  return [...cells.values()];
}

export function typeMultiplier(attacker, defender) {
  if (UNIT_TYPES[attacker.type].beats === defender.type) return ADVANTAGE;
  if (UNIT_TYPES[defender.type].beats === attacker.type) return DISADVANTAGE;
  return 1;
}

export function forecast(state, attacker, defender, from = { x: attacker.x, y: attacker.y }) {
  const def = TERRAIN[terrainAt(state, defender.x, defender.y)].def;
  const mult = typeMultiplier(attacker, defender);
  const chargeDistance = attacker.type === "cavalry"
    ? Math.max(attacker.movedDistance ?? 0, distance(attacker, from))
    : 0;
  const charge = chargeDistance >= 2 ? Math.min(1.5, 1 + chargeDistance * 0.1) : 1;
  const guard = defender.guarding ? 0.5 : 1;
  const damage = Math.max(1, Math.ceil(attacker.atk * mult * charge * (1 - def / 100) * guard));
  const survives = defender.hp - damage > 0;
  const canCounter = survives && distance(from, defender) <= UNIT_TYPES[defender.type].range;
  const counterDef = TERRAIN[terrainAt(state, from.x, from.y)].def;
  const counter = canCounter
    ? Math.max(1, Math.round(defender.atk * typeMultiplier(defender, attacker) * (1 - counterDef / 100) * 0.8))
    : 0;
  return { damage, counter, mult, charge, guarded: defender.guarding, kills: !survives };
}

function grantExp(unit, amount) {
  unit.exp += amount;
  while (unit.exp >= EXP_PER_LEVEL) {
    unit.exp -= EXP_PER_LEVEL;
    unit.lvl += 1;
    unit.maxHp += 3;
    unit.hp = Math.min(unit.maxHp, unit.hp + 3);
    unit.atk += 1;
  }
}

const clone = (s) => structuredClone(s);

/** 移動（不結束該單位行動，仍可攻擊或待命）。 */
export function moveUnit(state, unitId, x, y) {
  const s = clone(state);
  const unit = s.units.find((u) => u.id === unitId);
  if (!unit || unit.hp <= 0 || unit.moved || unit.side !== s.phase) return state;
  if (!canMoveTo(s, unit, x, y)) return state;
  unit.movedDistance = distance(unit, { x, y });
  unit.x = x;
  unit.y = y;
  unit.moved = true;
  return checkObjective(s);
}

/** 攻擊（含反擊、經驗、升級）。 */
export function attack(state, attackerId, defenderId) {
  const s = clone(state);
  const attacker = s.units.find((u) => u.id === attackerId);
  const defender = s.units.find((u) => u.id === defenderId);
  if (!attacker || !defender || attacker.acted || attacker.side !== s.phase) return state;
  if (attacker.hp <= 0 || defender.hp <= 0 || attacker.side === defender.side) return state;
  if (distance(attacker, defender) > UNIT_TYPES[attacker.type].range) return state;

  const f = forecast(s, attacker, defender);
  defender.hp -= f.damage;
  defender.guarding = false;
  s.log.unshift(`${attacker.name} 對 ${defender.name} 造成 ${f.damage}${f.charge > 1 ? "（衝鋒）" : f.guarded ? "（架槍減傷）" : f.mult > 1 ? "（相剋）" : f.mult < 1 ? "（被剋）" : ""}`);
  if (defender.hp <= 0) {
    defender.hp = 0;
    s.log.unshift(`${defender.name} 陣亡`);
    grantExp(attacker, EXP_PER_KILL);
    if (attacker.side === "ally") s.score += 40;
  } else {
    grantExp(attacker, EXP_PER_HIT);
    if (f.counter > 0) {
      attacker.hp = Math.max(0, attacker.hp - f.counter);
      s.log.unshift(`${defender.name} 反擊 ${f.counter}`);
      if (attacker.hp === 0) s.log.unshift(`${attacker.name} 陣亡`);
      else grantExp(defender, EXP_PER_HIT);
    }
  }
  attacker.moved = true;
  attacker.acted = true;
  return checkObjective(s);
}

/** 槍兵犧牲本回合行動架槍，下一次受擊傷害減半。 */
export function brace(state, unitId) {
  const s = clone(state);
  const unit = s.units.find((u) => u.id === unitId);
  if (!unit || unit.type !== "spear" || unit.hp <= 0 || unit.acted || unit.side !== s.phase) return state;
  unit.moved = true;
  unit.acted = true;
  unit.guarding = true;
  s.log.unshift(`${unit.name} 架槍固守`);
  return s;
}

/** 弓兵三格瞄準射擊：威力 90%、不受反擊、冷卻三個自己的回合。 */
export function aimedShot(state, attackerId, defenderId) {
  const s = clone(state);
  const attacker = s.units.find((u) => u.id === attackerId);
  const defender = s.units.find((u) => u.id === defenderId);
  if (!attacker || !defender || attacker.type !== "bow" || attacker.skillCd > 0) return state;
  if (attacker.hp <= 0 || defender.hp <= 0 || attacker.acted || attacker.side !== s.phase || attacker.side === defender.side) return state;
  if (distance(attacker, defender) > 3) return state;
  const terrainDef = TERRAIN[terrainAt(s, defender.x, defender.y)].def;
  const guard = defender.guarding ? 0.5 : 1;
  const damage = Math.max(1, Math.ceil(attacker.atk * typeMultiplier(attacker, defender) * 0.9 * (1 - terrainDef / 100) * guard));
  defender.hp = Math.max(0, defender.hp - damage);
  defender.guarding = false;
  attacker.moved = true;
  attacker.acted = true;
  attacker.skillCd = 3;
  s.log.unshift(`${attacker.name} 瞄準射擊 ${defender.name}，造成 ${damage}`);
  if (defender.hp === 0) {
    s.log.unshift(`${defender.name} 陣亡`);
    grantExp(attacker, EXP_PER_KILL);
    if (attacker.side === "ally") s.score += 40;
  } else {
    grantExp(attacker, EXP_PER_HIT);
  }
  return checkObjective(s);
}

export function wait(state, unitId) {
  const s = clone(state);
  const unit = s.units.find((u) => u.id === unitId);
  if (!unit || unit.side !== s.phase) return state;
  unit.moved = true;
  unit.acted = true;
  return checkObjective(s);
}

export function pendingUnits(state, side = state.phase) {
  return state.units.filter((u) => u.hp > 0 && u.side === side && !u.acted);
}

export function endPhase(state) {
  const s = clone(state);
  for (const u of s.units) {
    u.moved = false;
    u.acted = false;
  }
  if (s.phase === "ally") {
    s.phase = "foe";
  } else {
    s.phase = "ally";
    s.turn += 1;
  }
  for (const u of s.units.filter((unit) => unit.side === s.phase)) {
    u.guarding = false;
    u.movedDistance = 0;
    if (u.skillCd > 0) u.skillCd -= 1;
  }
  return checkObjective(s);
}

export function checkObjective(state) {
  const s = state.outcome === "playing" ? state : clone(state);
  const allies = s.units.filter((u) => u.side === "ally" && u.hp > 0);
  const foes = s.units.filter((u) => u.side === "foe" && u.hp > 0);
  if (!allies.length) {
    s.outcome = "lost";
    return s;
  }
  if (s.objective.kind === "rout" && !foes.length) s.outcome = "won";
  if (s.objective.kind === "commander" && !foes.some((u) => u.type === "commander")) s.outcome = "won";
  if (s.objective.kind === "seize") {
    const holder = unitAt(s, s.objective.x, s.objective.y);
    if (holder?.side === "ally") s.outcome = "won";
    else if (s.turn > s.objective.turns) s.outcome = "lost";
  }
  if (s.outcome === "won") s.score += 100 + Math.max(0, 200 - s.turn * 10) + allies.length * 25;
  return s;
}

/** 通關後可帶往下一章的名冊（陣亡者不列入）。 */
export function rosterFrom(state) {
  return state.units
    .filter((u) => u.side === "ally")
    .map((u) => ({
      type: u.type,
      name: u.name,
      lvl: u.lvl,
      exp: u.exp,
      alive: u.hp > 0,
      bonusHp: u.bonusHp ?? 0,
      bonusAtk: u.bonusAtk ?? 0,
    }));
}

export function applyReward(roster, reward) {
  const next = structuredClone(roster);
  for (const unit of next.filter((u) => u.alive !== false)) {
    if (reward === "armor") unit.bonusHp = (unit.bonusHp ?? 0) + 4;
    if (reward === "edge") unit.bonusAtk = (unit.bonusAtk ?? 0) + 1;
    if (reward === "training") {
      unit.exp += 35;
      while (unit.exp >= EXP_PER_LEVEL) {
        unit.exp -= EXP_PER_LEVEL;
        unit.lvl += 1;
      }
    }
  }
  return next;
}

/**
 * 敵方 AI：對每個未行動單位挑最佳一手。
 * 評分＝造成傷害＋擊殺獎勵−反擊風險＋地形防禦−與最近我軍距離。
 */
export function planEnemyMove(state, unitId) {
  const unit = state.units.find((u) => u.id === unitId);
  if (!unit || unit.hp <= 0) return null;
  const cells = [{ x: unit.x, y: unit.y, cost: 0 }, ...movementRange(state, unit)];
  const opponents = state.units.filter((u) => u.side !== unit.side && u.hp > 0);
  if (!opponents.length) return { move: null, target: null };
  let best = null;
  for (const cell of cells) {
    const terrain = TERRAIN[terrainAt(state, cell.x, cell.y)];
    const nearest = Math.min(...opponents.map((a) => distance(cell, a)));
    const targets = targetsFrom(state, unit, cell.x, cell.y);
    if (targets.length) {
      for (const target of targets) {
        const f = forecast(state, unit, target, cell);
        const objectiveBonus = unit.side === "ally" && state.objective.kind === "commander" && target.type === "commander" ? 70 : 0;
        const score = f.damage * 2 + (f.kills ? 90 : 0) - f.counter * 1.6 + terrain.def * 0.3 - nearest + objectiveBonus;
        if (!best || score > best.score) best = { score, move: cell, target };
      }
    } else {
      const objectiveDistance = unit.side === "ally" && state.objective.kind === "seize"
        ? distance(cell, state.objective)
        : nearest;
      const score = terrain.def * 0.2 - objectiveDistance * 3;
      if (!best || score > best.score) best = { score, move: cell, target: null };
    }
  }
  return best ? { move: best.move, target: best.target } : null;
}

/** 執行一個敵方單位的完整行動；回傳新 state。 */
export function stepEnemy(state, unitId) {
  const plan = planEnemyMove(state, unitId);
  if (!plan) return wait(state, unitId);
  let s = state;
  if (plan.move && (plan.move.x !== state.units.find((u) => u.id === unitId).x || plan.move.y !== state.units.find((u) => u.id === unitId).y)) {
    s = moveUnit(s, unitId, plan.move.x, plan.move.y);
  }
  if (plan.target) s = attack(s, unitId, plan.target.id);
  return wait(s, unitId);
}

/** 第一章第一回合的情境式引導；UI 只需呈現回傳文字。 */
export function tutorialHint(state, selectedId, mode) {
  if (state.chapter !== 0 || state.turn !== 1 || state.phase !== "ally" || state.outcome !== "playing") return null;
  if (!selectedId) {
    if (!pendingUnits(state, "ally").length) {
      return { step: "end", title: "交棒給敵軍", text: "所有人都行動完了。按「結束我方回合」觀察敵人的走法。" };
    }
    return { step: "select", title: "先選一名同伴", text: "點藍色單位。槍、弓、騎各有不同射程與能力。" };
  }
  const unit = state.units.find((u) => u.id === selectedId);
  if (!unit || unit.acted) return { step: "select", title: "換下一名同伴", text: "灰色單位已行動；選另一名藍色單位。" };
  if (!unit.moved && mode === "idle") {
    return { step: "move", title: "選擇落腳處", text: "亮藍格都能走。竹林和土丘較慢，但能降低受到的傷害。" };
  }
  return {
    step: "act",
    title: unit.type === "spear" ? "攻擊，或架槍固守" : unit.type === "bow" ? "攻擊，或使用瞄準射擊" : "騎兵移動越遠，衝鋒越痛",
    text: "紅格是可攻擊目標；也可以待命保留位置。",
  };
}

export function summarize(state) {
  return {
    chapter: state.chapter + 1,
    title: state.title,
    turn: state.turn,
    phase: state.phase,
    outcome: state.outcome,
    score: state.score,
    allies: state.units.filter((u) => u.side === "ally" && u.hp > 0).length,
    foes: state.units.filter((u) => u.side === "foe" && u.hp > 0).length,
    objective: state.objective,
    log: state.log.slice(0, 4),
  };
}

export function getOutcome(state) {
  return state.outcome;
}
