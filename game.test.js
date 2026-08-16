import { describe, expect, it } from "vitest";
import {
  CHAPTERS,
  UNIT_TYPES,
  attack,
  canMoveTo,
  checkObjective,
  createGame,
  distance,
  endPhase,
  forecast,
  movementRange,
  moveUnit,
  pendingUnits,
  planEnemyMove,
  rosterFrom,
  stepEnemy,
  summarize,
  terrainAt,
  typeMultiplier,
  unitAt,
  wait,
} from "./game.js";

const ally = (s, i = 0) => s.units.filter((u) => u.side === "ally")[i];
const foe = (s, i = 0) => s.units.filter((u) => u.side === "foe")[i];

describe("地圖", () => {
  it("各章地圖為方陣且含我軍與敵軍", () => {
    for (const ch of CHAPTERS) {
      const width = ch.map[0].length;
      expect(ch.map.every((row) => row.length === width)).toBe(true);
      expect(ch.allies.length).toBeGreaterThan(0);
      expect(ch.foes.length).toBeGreaterThan(0);
    }
  });

  it("奪旗章的目標格確實是帥旗地形", () => {
    const s = createGame({ chapter: 1 });
    expect(terrainAt(s, s.objective.x, s.objective.y)).toBe("banner");
  });

  it("初始佈陣不重疊", () => {
    const s = createGame({ chapter: 0 });
    const seen = new Set(s.units.map((u) => `${u.x},${u.y}`));
    expect(seen.size).toBe(s.units.length);
  });
});

describe("移動範圍", () => {
  it("受地形成本限制：竹林兩點、平地一點", () => {
    const s = createGame({ chapter: 0 });
    const u = ally(s, 0);
    u.x = 3;
    u.y = 3;
    const reach = movementRange(s, u);
    const cost = (x, y) => reach.find((c) => c.x === x && c.y === y)?.cost;
    expect(cost(3, 2)).toBe(1);
    expect(reach.every((c) => c.cost <= UNIT_TYPES[u.type].move)).toBe(true);
  });

  it("溪水與石垣不可進入", () => {
    const s = createGame({ chapter: 1 });
    const u = ally(s, 0);
    u.x = 2;
    u.y = 5;
    const reach = movementRange(s, u);
    for (const cell of reach) {
      expect(["water", "wall"]).not.toContain(terrainAt(s, cell.x, cell.y));
    }
  });

  it("敵軍擋路：不可穿越敵人", () => {
    const s = createGame({ chapter: 0 });
    const u = ally(s, 0);
    u.x = 3;
    u.y = 4;
    const blocker = foe(s, 0);
    blocker.x = 3;
    blocker.y = 3;
    blocker.type = "spear";
    expect(canMoveTo(s, u, 3, 3)).toBe(false);
    expect(canMoveTo(s, u, 3, 2)).toBe(false);
    expect(canMoveTo(s, u, 2, 3)).toBe(true);
  });

  it("友軍可穿越但不可停留", () => {
    const s = createGame({ chapter: 0 });
    const u = ally(s, 0);
    u.x = 3;
    u.y = 4;
    const friend = ally(s, 1);
    friend.x = 3;
    friend.y = 3;
    expect(canMoveTo(s, u, 3, 3)).toBe(false);
    expect(canMoveTo(s, u, 3, 2)).toBe(true);
  });
});

describe("戰鬥", () => {
  it("兵種相剋：槍剋騎、騎剋弓、弓剋槍", () => {
    const s = createGame({ chapter: 0 });
    const a = ally(s, 0);
    const b = foe(s, 0);
    a.type = "spear";
    b.type = "cavalry";
    expect(typeMultiplier(a, b)).toBeGreaterThan(1);
    a.type = "cavalry";
    b.type = "bow";
    expect(typeMultiplier(a, b)).toBeGreaterThan(1);
    a.type = "bow";
    b.type = "spear";
    expect(typeMultiplier(a, b)).toBeGreaterThan(1);
    a.type = "spear";
    b.type = "bow";
    expect(typeMultiplier(a, b)).toBeLessThan(1);
  });

  it("地形防禦降低受到的傷害", () => {
    const s = createGame({ chapter: 0 });
    const a = ally(s, 0);
    const b = foe(s, 0);
    a.type = "spear";
    b.type = "spear";
    a.x = 3;
    a.y = 3;
    b.x = 3;
    b.y = 2; // 草埔
    const onGrass = forecast(s, a, b).damage;
    b.x = 0;
    b.y = 7;
    a.x = 0;
    a.y = 6;
    s.tiles[7][0] = "hill";
    const onHill = forecast(s, a, b).damage;
    expect(onHill).toBeLessThan(onGrass);
  });

  it("弓兵射程 2 時不會被近戰反擊", () => {
    const s = createGame({ chapter: 0 });
    const a = ally(s, 0);
    const b = foe(s, 0);
    a.type = "bow";
    a.x = 3;
    a.y = 4;
    b.type = "spear";
    b.x = 3;
    b.y = 2;
    expect(distance(a, b)).toBe(2);
    expect(forecast(s, a, b).counter).toBe(0);
    const after = attack(s, a.id, b.id);
    expect(after.units.find((u) => u.id === a.id).hp).toBe(a.hp);
    expect(after.units.find((u) => u.id === b.id).hp).toBeLessThan(b.hp);
  });

  it("近身互毆會吃到反擊", () => {
    const s = createGame({ chapter: 0 });
    const a = ally(s, 0);
    const b = foe(s, 0);
    a.type = "spear";
    b.type = "spear";
    b.hp = b.maxHp;
    a.x = 3;
    a.y = 3;
    b.x = 3;
    b.y = 2;
    const after = attack(s, a.id, b.id);
    expect(after.units.find((u) => u.id === a.id).hp).toBeLessThan(a.hp);
  });

  it("超出射程不能攻擊", () => {
    const s = createGame({ chapter: 0 });
    const a = ally(s, 0);
    const b = foe(s, 0);
    a.type = "spear";
    a.x = 0;
    a.y = 7;
    b.x = 7;
    b.y = 0;
    expect(attack(s, a.id, b.id)).toBe(s);
  });

  it("擊殺給經驗、累積可升級（血上限與攻擊力提升）", () => {
    const s = createGame({ chapter: 0 });
    const a = ally(s, 0);
    const b = foe(s, 0);
    a.type = "cavalry";
    a.exp = 90;
    a.x = 3;
    a.y = 3;
    b.type = "bow";
    b.hp = 1;
    b.x = 3;
    b.y = 2;
    const after = attack(s, a.id, b.id);
    const grown = after.units.find((u) => u.id === a.id);
    expect(after.units.find((u) => u.id === b.id).hp).toBe(0);
    expect(grown.lvl).toBe(a.lvl + 1);
    expect(grown.atk).toBe(a.atk + 1);
    expect(grown.maxHp).toBe(a.maxHp + 3);
  });

  it("行動過的單位不能再攻擊", () => {
    const s = createGame({ chapter: 0 });
    const a = ally(s, 0);
    const b = foe(s, 0);
    a.x = 3;
    a.y = 3;
    b.x = 3;
    b.y = 2;
    const once = attack(s, a.id, b.id);
    expect(attack(once, a.id, b.id)).toBe(once);
  });
});

describe("回合流程", () => {
  it("我方階段不能操作敵軍", () => {
    const s = createGame({ chapter: 0 });
    expect(moveUnit(s, foe(s, 0).id, 3, 3)).toBe(s);
  });

  it("待命後不再列入待行動清單", () => {
    const s = createGame({ chapter: 0 });
    const before = pendingUnits(s).length;
    const after = wait(s, ally(s, 0).id);
    expect(pendingUnits(after).length).toBe(before - 1);
  });

  it("換階段會重置行動旗標並在敵方結束後推進回合數", () => {
    const s = createGame({ chapter: 0 });
    const enemyPhase = endPhase(wait(s, ally(s, 0).id));
    expect(enemyPhase.phase).toBe("foe");
    expect(enemyPhase.turn).toBe(1);
    expect(enemyPhase.units.every((u) => !u.acted)).toBe(true);
    const next = endPhase(enemyPhase);
    expect(next.phase).toBe("ally");
    expect(next.turn).toBe(2);
  });

  it("移動後仍可攻擊，攻擊後才結束行動", () => {
    const s = createGame({ chapter: 0 });
    const a = ally(s, 0);
    a.x = 3;
    a.y = 4;
    const b = foe(s, 0);
    b.x = 3;
    b.y = 2;
    b.hp = b.maxHp;
    const moved = moveUnit(s, a.id, 3, 3);
    expect(moved.units.find((u) => u.id === a.id).moved).toBe(true);
    expect(moved.units.find((u) => u.id === a.id).acted).toBe(false);
    const hit = attack(moved, a.id, b.id);
    expect(hit.units.find((u) => u.id === a.id).acted).toBe(true);
    expect(hit.units.find((u) => u.id === b.id).hp).toBeLessThan(b.hp);
  });

  it("移動兩次無效", () => {
    const s = createGame({ chapter: 0 });
    const a = ally(s, 0);
    a.x = 3;
    a.y = 4;
    const moved = moveUnit(s, a.id, 3, 3);
    expect(moveUnit(moved, a.id, 3, 2)).toBe(moved);
  });
});

describe("勝負條件", () => {
  it("殲滅章：敵軍全滅即勝", () => {
    const s = createGame({ chapter: 0 });
    for (const u of s.units) if (u.side === "foe") u.hp = 0;
    expect(checkObjective(s).outcome).toBe("won");
  });

  it("我軍全滅即敗", () => {
    const s = createGame({ chapter: 0 });
    for (const u of s.units) if (u.side === "ally") u.hp = 0;
    expect(checkObjective(s).outcome).toBe("lost");
  });

  it("奪旗章：我軍站上帥旗即勝；超時即敗", () => {
    const s = createGame({ chapter: 1 });
    const a = ally(s, 0);
    a.x = s.objective.x;
    a.y = s.objective.y;
    expect(checkObjective(s).outcome).toBe("won");

    const timeout = createGame({ chapter: 1 });
    timeout.turn = timeout.objective.turns + 1;
    expect(checkObjective(timeout).outcome).toBe("lost");
  });

  it("奪旗章：敵軍站上帥旗不算我方勝利", () => {
    const s = createGame({ chapter: 1 });
    const f = foe(s, 0);
    f.x = s.objective.x;
    f.y = s.objective.y;
    expect(checkObjective(s).outcome).toBe("playing");
  });

  it("斬將章：主將陣亡即勝，其餘敵軍尚存也算", () => {
    const s = createGame({ chapter: 2 });
    const boss = s.units.find((u) => u.side === "foe" && u.type === "commander");
    boss.hp = 0;
    const done = checkObjective(s);
    expect(done.outcome).toBe("won");
    expect(done.units.some((u) => u.side === "foe" && u.hp > 0)).toBe(true);
  });
});

describe("跨章名冊", () => {
  it("陣亡者不會出現在下一章，生還者保留等級", () => {
    const s = createGame({ chapter: 0 });
    const dead = ally(s, 0);
    dead.hp = 0;
    const survivor = ally(s, 1);
    survivor.lvl = 3;
    survivor.exp = 40;
    const roster = rosterFrom(s);
    expect(roster.filter((r) => r.alive).length).toBe(2);
    const next = createGame({ chapter: 1, roster });
    const names = next.units.filter((u) => u.side === "ally").map((u) => u.name);
    expect(names).not.toContain(dead.name);
    const carried = next.units.find((u) => u.name === survivor.name);
    expect(carried.lvl).toBe(3);
    expect(carried.atk).toBeGreaterThan(next.units.find((u) => u.side === "foe" && u.type === carried.type)?.atk ?? 0);
  });
});

describe("敵方 AI", () => {
  it("能吃掉的目標會優先擊殺", () => {
    const s = createGame({ chapter: 0 });
    s.phase = "foe";
    const f = foe(s, 0);
    f.type = "cavalry";
    f.x = 3;
    f.y = 3;
    const weak = ally(s, 0);
    weak.type = "bow";
    weak.hp = 1;
    weak.x = 3;
    weak.y = 5;
    const strong = ally(s, 1);
    strong.type = "spear";
    strong.hp = strong.maxHp;
    strong.x = 5;
    strong.y = 3;
    const plan = planEnemyMove(s, f.id);
    expect(plan.target.id).toBe(weak.id);
  });

  it("夠不到人時會朝我軍靠近", () => {
    const s = createGame({ chapter: 0 });
    s.phase = "foe";
    const f = foe(s, 0);
    f.x = 0;
    f.y = 0;
    for (const u of s.units.filter((u) => u.side === "foe" && u.id !== f.id)) u.hp = 0;
    const target = ally(s, 0);
    target.x = 7;
    target.y = 7;
    for (const u of s.units.filter((u) => u.side === "ally" && u.id !== target.id)) u.hp = 0;
    const before = distance(f, target);
    const after = stepEnemy(s, f.id);
    const moved = after.units.find((u) => u.id === f.id);
    expect(distance(moved, target)).toBeLessThan(before);
    expect(moved.acted).toBe(true);
  });

  it("敵方一步只行動一次，且會實際造成傷害", () => {
    const s = createGame({ chapter: 0 });
    s.phase = "foe";
    const f = foe(s, 0);
    f.type = "spear";
    f.x = 3;
    f.y = 3;
    const victim = ally(s, 0);
    victim.type = "cavalry";
    victim.x = 3;
    victim.y = 4;
    victim.hp = victim.maxHp;
    const after = stepEnemy(s, f.id);
    expect(after.units.find((u) => u.id === victim.id).hp).toBeLessThan(victim.hp);
    expect(pendingUnits(after, "foe").some((u) => u.id === f.id)).toBe(false);
  });
});

describe("摘要", () => {
  it("回報章節、回合與雙方存活數", () => {
    const s = summarize(createGame({ chapter: 0 }));
    expect(s.chapter).toBe(1);
    expect(s.turn).toBe(1);
    expect(s.allies).toBe(CHAPTERS[0].allies.length);
    expect(s.foes).toBe(CHAPTERS[0].foes.length);
    expect(s.outcome).toBe("playing");
  });
});

describe("查詢工具", () => {
  it("unitAt 只回報存活單位", () => {
    const s = createGame({ chapter: 0 });
    const a = ally(s, 0);
    expect(unitAt(s, a.x, a.y).id).toBe(a.id);
    a.hp = 0;
    expect(unitAt(s, a.x, a.y)).toBe(null);
  });

  it("盤面外座標回傳 null", () => {
    const s = createGame({ chapter: 0 });
    expect(terrainAt(s, -1, 0)).toBe(null);
    expect(terrainAt(s, 0, 99)).toBe(null);
  });
});
