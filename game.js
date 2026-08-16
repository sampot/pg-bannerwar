/** pg-bannerwar — 旌旗戰棋 (回合戰棋／SRPG) */

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function mulberry32(a) {
  return function() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function deep(o) { return JSON.parse(JSON.stringify(o)); }


export function createGame({ seed = 1, chapter = 1 } = {}) {
  const units = [
    { id: "s", name: "矛", type: "spear", hp: 12, x: 0, y: 1, side: "you" },
    { id: "a", name: "弓", type: "bow", hp: 8, x: 0, y: 2, side: "you" },
    { id: "c", name: "騎", type: "cavalry", hp: 14, x: 0, y: 0, side: "you" },
    { id: "e1", name: "敵矛", type: "spear", hp: 10, x: 4, y: 1, side: "foe" },
    { id: "e2", name: "敵弓", type: "bow", hp: 8, x: 4, y: 2, side: "foe" },
  ];
  return { seed, chapter, turn: 1, units, selected: "s", outcome: "playing", msg: "相剋：矛>騎>弓>矛。點選行動。" };
}
const beat = { spear: "cavalry", cavalry: "bow", bow: "spear" };
export function getLegalActions(s) {
  if (s.outcome !== "playing") return [];
  return ["move", "attack", "wait", "nextUnit"];
}
export function applyAction(state, action) {
  const s = deep(state);
  if (s.outcome !== "playing") return s;
  const u = s.units.find((x) => x.id === s.selected && x.side === "you" && x.hp > 0);
  if (!u) { s.selected = s.units.find((x) => x.side === "you" && x.hp > 0)?.id; return s; }
  if (action === "nextUnit") {
    const yours = s.units.filter((x) => x.side === "you" && x.hp > 0);
    const i = yours.findIndex((x) => x.id === s.selected);
    s.selected = yours[(i + 1) % yours.length].id;
    s.msg = `選中 ${yours[(i + 1) % yours.length].name}`;
    return s;
  }
  if (action === "move") {
    u.x = clamp(u.x + 1, 0, 4);
    s.msg = `${u.name} 前進至 (${u.x},${u.y})`;
  } else if (action === "attack") {
    const foe = s.units.find((x) => x.side === "foe" && x.hp > 0 && Math.abs(x.x - u.x) + Math.abs(x.y - u.y) <= 2);
    if (!foe) s.msg = "射程內無敵";
    else {
      let dmg = 4;
      if (beat[u.type] === foe.type) dmg = 8;
      if (beat[foe.type] === u.type) dmg = 2;
      foe.hp -= dmg;
      s.msg = `${u.name} 攻擊 ${foe.name} −${dmg}`;
    }
  } else s.msg = "待機";
  // foe AI
  for (const e of s.units.filter((x) => x.side === "foe" && x.hp > 0)) {
    const t = s.units.find((x) => x.side === "you" && x.hp > 0);
    if (!t) break;
    if (e.x > t.x) e.x--; else if (e.x < t.x) e.x++;
    if (Math.abs(e.x - t.x) + Math.abs(e.y - t.y) <= 2) {
      t.hp -= beat[e.type] === t.type ? 6 : 3;
    }
  }
  s.turn++;
  if (!s.units.some((x) => x.side === "you" && x.hp > 0)) s.outcome = "lost";
  else if (!s.units.some((x) => x.side === "foe" && x.hp > 0)) {
    if (s.chapter >= 3) { s.outcome = "won"; s.msg = "戰役勝利！"; }
    else {
      s.chapter++;
      return createGame({ seed: s.seed + s.chapter, chapter: s.chapter });
    }
  }
  return s;
}
export function summarize(s) {
  return {
    chapter: s.chapter, turn: s.turn, selected: s.selected, msg: s.msg, outcome: s.outcome,
    you: s.units.filter((x) => x.side === "you").map((x) => `${x.name}:${x.hp}`),
    foe: s.units.filter((x) => x.side === "foe").map((x) => `${x.name}:${x.hp}`),
  };
}
export function getOutcome(s) { return s.outcome; }

