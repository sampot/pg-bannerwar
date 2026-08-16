import {
  CHAPTERS,
  UNIT_TYPES,
  applyReward,
  attack,
  brace,
  createGame,
  distance,
  endPhase,
  forecast,
  moveUnit,
  movementRange,
  pendingUnits,
  planEnemyMove,
  rosterFrom,
  stepEnemy,
  targetsFrom,
  terrainAt,
  TERRAIN,
  threatRange,
  tutorialHint,
  unitAt,
  wait,
  aimedShot,
} from "./game.js";
import { makeCampaignSave, restoreCampaign } from "./campaign.js";
import { GameAudio } from "./audio.js";
import { loadProgress, saveProgress } from "./persist.js";

const TILE = 16;
const SHEET_COLS = 49;
// (col,row) 於 Kenney 1-Bit Pack packed tilesheet 上的位置。
const SPRITE = {
  plain: [1, 0],
  grass: [5, 0],
  forest: [0, 1],
  hill: [5, 2],
  water: [9, 4],
  wall: [10, 0],
  banner: [17, 7],
  spear: [27, 0],
  bow: [26, 0],
  cavalry: [28, 7],
  commander: [29, 3],
};
const TERRAIN_COLOR = {
  plain: "#4a3a2c",
  grass: "#3f4b2b",
  forest: "#2c3d24",
  hill: "#5b4630",
  water: "#1d3a55",
  wall: "#2a2320",
  banner: "#5a3630",
};
const SIDE_COLOR = { ally: "#7fd0ff", foe: "#ff8a7a" };
const EPILOGUE = [
  "隘口已清。鄉勇在賊營找到三批物資，只夠帶走一批。",
  "渡口入手，援軍卻已逼近。整軍後就是最後一戰。",
  "敵將落馬，圍城解除。旌旗上的風終於停了。",
];

const $ = (id) => document.getElementById(id);
const audio = new GameAudio();
const canvas = $("board");
const ctx = canvas.getContext("2d");

let sheet = null;
let tinted = new Map();
let state = null;
let progress = {};
let campaignRoster = null;
let selected = null; // 目前選取的我方單位 id
let inspected = null; // 可檢視敵軍而不冒充我方選取
let preMove = null; // 移動前的 state 快照，供「取消」還原
let mode = "idle"; // idle | moved | targeting | aimed
let reachable = [];
let threatened = [];
let enemyIntent = null;
let enemyTimer = null;
let cell = 40;
let animating = false;
let moveAnim = null; // { id, from:{x,y}, to:{x,y}, started, duration }
const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function loadSheet() {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = "./assets/images/tiles.png";
  });
}

/** 精靈原本是米白色剪影，依陣營重新上色後快取。 */
function tint(key, color) {
  const id = `${key}:${color}`;
  if (tinted.has(id)) return tinted.get(id);
  const off = document.createElement("canvas");
  off.width = TILE;
  off.height = TILE;
  const c = off.getContext("2d");
  const [col, row] = SPRITE[key];
  c.imageSmoothingEnabled = false;
  if (sheet) c.drawImage(sheet, col * TILE, row * TILE, TILE, TILE, 0, 0, TILE, TILE);
  c.globalCompositeOperation = "source-in";
  c.fillStyle = color;
  c.fillRect(0, 0, TILE, TILE);
  tinted.set(id, off);
  return off;
}

function layout() {
  const wrap = canvas.parentElement;
  const available = Math.min(wrap.clientWidth, 560);
  cell = Math.max(30, Math.floor(available / state.w));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = state.w * cell * dpr;
  canvas.height = state.h * cell * dpr;
  canvas.style.width = `${state.w * cell}px`;
  canvas.style.height = `${state.h * cell}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
}

function drawSprite(image, x, y, scale = 1) {
  const size = cell * scale;
  const offset = (cell - size) / 2;
  ctx.drawImage(image, x * cell + offset, y * cell + offset, size, size);
}

function unitDrawPos(unit) {
  if (moveAnim?.id === unit.id) {
    const t = Math.min(1, (performance.now() - moveAnim.started) / moveAnim.duration);
    const ease = 1 - (1 - t) ** 3;
    return {
      x: moveAnim.from.x + (moveAnim.to.x - moveAnim.from.x) * ease,
      y: moveAnim.from.y + (moveAnim.to.y - moveAnim.from.y) * ease,
      progress: t,
    };
  }
  return { x: unit.x, y: unit.y, progress: 1 };
}

function animateMove(unitId, from, to) {
  if (prefersReducedMotion() || (from.x === to.x && from.y === to.y)) return Promise.resolve();
  animating = true;
  moveAnim = { id: unitId, from, to, started: performance.now(), duration: 220 };
  return new Promise((resolve) => {
    const tick = () => {
      render();
      if (performance.now() - moveAnim.started >= moveAnim.duration) {
        moveAnim = null;
        animating = false;
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < state.h; y += 1) {
    for (let x = 0; x < state.w; x += 1) {
      const t = terrainAt(state, x, y);
      ctx.fillStyle = TERRAIN_COLOR[t];
      ctx.fillRect(x * cell, y * cell, cell, cell);
      if (sheet && t !== "plain") drawSprite(tint(t, t === "water" ? "#6fb6e8" : t === "wall" ? "#8d8377" : t === "hill" ? "#b08a5a" : t === "banner" ? "#f2c14e" : "#6fbf5e"), x, y, 0.86);
      ctx.strokeStyle = "rgba(0,0,0,.28)";
      ctx.strokeRect(x * cell + 0.5, y * cell + 0.5, cell - 1, cell - 1);
    }
  }

  if (state.objective.kind === "seize") {
    ctx.strokeStyle = "#f2c14e";
    ctx.lineWidth = 2;
    ctx.strokeRect(state.objective.x * cell + 2, state.objective.y * cell + 2, cell - 4, cell - 4);
    ctx.lineWidth = 1;
  }

  for (const c of reachable) {
    ctx.fillStyle = "rgba(110,190,255,.28)";
    ctx.fillRect(c.x * cell, c.y * cell, cell, cell);
  }
  for (const c of threatened) {
    ctx.fillStyle = "rgba(255,110,90,.3)";
    ctx.fillRect(c.x * cell, c.y * cell, cell, cell);
  }

  if (enemyIntent?.move) {
    const source = state.units.find((u) => u.id === enemyIntent.unitId);
    if (source) {
      const end = enemyIntent.target ?? enemyIntent.move;
      ctx.save();
      ctx.strokeStyle = "#ffcf70";
      ctx.fillStyle = "#ffcf70";
      ctx.lineWidth = Math.max(2, cell * 0.06);
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(source.x * cell + cell / 2, source.y * cell + cell / 2);
      ctx.lineTo(end.x * cell + cell / 2, end.y * cell + cell / 2);
      ctx.stroke();
      ctx.setLineDash([]);
      if (enemyIntent.target) {
        ctx.beginPath();
        ctx.arc(end.x * cell + cell / 2, end.y * cell + cell / 2, cell * 0.35, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  for (const unit of state.units) {
    if (unit.hp <= 0) continue;
    const pos = unitDrawPos(unit);
    const color = SIDE_COLOR[unit.side];
    if (unit.id === selected) {
      ctx.fillStyle = "rgba(242,193,78,.35)";
      ctx.fillRect(Math.round(pos.x) * cell, Math.round(pos.y) * cell, cell, cell);
    }
    if (unit.guarding) {
      ctx.strokeStyle = "rgba(127,208,255,.85)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pos.x * cell + cell / 2, pos.y * cell + cell / 2, cell * 0.42, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    ctx.fillStyle = unit.side === "ally" ? "rgba(40,80,120,.55)" : "rgba(110,40,40,.55)";
    ctx.beginPath();
    ctx.ellipse(pos.x * cell + cell / 2, pos.y * cell + cell * 0.78, cell * 0.3, cell * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    if (sheet) drawSprite(tint(unit.type, unit.acted ? "#7c7268" : color), pos.x, pos.y, 0.92);
    else {
      ctx.fillStyle = color;
      ctx.fillText(UNIT_TYPES[unit.type].name[0], pos.x * cell + cell / 3, pos.y * cell + cell / 2);
    }

    const ratio = unit.hp / unit.maxHp;
    const barW = cell - 8;
    ctx.fillStyle = "rgba(0,0,0,.6)";
    ctx.fillRect(pos.x * cell + 4, pos.y * cell + cell - 6, barW, 4);
    ctx.fillStyle = ratio > 0.5 ? "#7ddc7d" : ratio > 0.25 ? "#f2c14e" : "#ff6b5e";
    ctx.fillRect(pos.x * cell + 4, pos.y * cell + cell - 6, barW * ratio, 4);
    if (unit.lvl > 1) {
      ctx.fillStyle = "#f2c14e";
      ctx.font = `${Math.max(9, cell * 0.25)}px system-ui, sans-serif`;
      ctx.fillText(`${unit.lvl}`, pos.x * cell + 3, pos.y * cell + cell * 0.3);
    }
  }
}

function cellFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.floor(((event.clientX - rect.left) / rect.width) * state.w),
    y: Math.floor(((event.clientY - rect.top) / rect.height) * state.h),
  };
}

function selectedUnit() {
  return state.units.find((u) => u.id === selected) ?? null;
}

function clearSelection() {
  selected = null;
  inspected = null;
  preMove = null;
  mode = "idle";
  reachable = [];
  threatened = [];
}

function selectUnit(unit) {
  selected = unit.id;
  inspected = unit.id;
  preMove = null;
  mode = "idle";
  reachable = unit.side === "ally" && !unit.moved ? movementRange(state, unit) : [];
  threatened = targetsFrom(state, unit).map((t) => ({ x: t.x, y: t.y }));
}

function inspectEnemy(unit) {
  selected = null;
  inspected = unit.id;
  preMove = null;
  mode = "idle";
  reachable = [];
  threatened = threatRange(state, unit);
  const plan = planEnemyMove(state, unit.id);
  const targetName = plan?.target?.name;
  setMessage(targetName ? `${unit.name} 目前最可能攻擊 ${targetName}` : `${unit.name} 的紅色威脅範圍`);
}

function enterTargeting() {
  const unit = selectedUnit();
  mode = "targeting";
  reachable = [];
  threatened = targetsFrom(state, unit).map((t) => ({ x: t.x, y: t.y }));
  setMessage(threatened.length ? "點選要攻擊的敵軍" : "射程內沒有敵軍");
}

function enterAimedShot() {
  const unit = selectedUnit();
  mode = "aimed";
  reachable = [];
  threatened = state.units
    .filter((u) => u.side === "foe" && u.hp > 0 && distance(unit, u) <= 3)
    .map((u) => ({ x: u.x, y: u.y }));
  setMessage("瞄準射擊：點選三格內的敵軍（不受反擊）");
}

function setMessage(text) {
  $("msg").textContent = text;
}

function playCombatFx(attacker, defender, damage, kind = "hit") {
  if (prefersReducedMotion()) return;
  const layer = $("fx-layer");
  const board = canvas.parentElement;
  const fromX = attacker.x * cell + cell / 2;
  const fromY = attacker.y * cell + cell / 2;
  const toX = defender.x * cell + cell / 2;
  const toY = defender.y * cell + cell / 2;
  const slash = document.createElement("i");
  slash.className = `strike-fx ${kind}`;
  slash.style.setProperty("--from-x", `${fromX}px`);
  slash.style.setProperty("--from-y", `${fromY}px`);
  slash.style.setProperty("--to-x", `${toX}px`);
  slash.style.setProperty("--to-y", `${toY}px`);
  const number = document.createElement("b");
  number.className = "damage-fx";
  number.textContent = `−${damage}`;
  number.style.left = `${toX}px`;
  number.style.top = `${toY}px`;
  layer.append(slash, number);
  board.classList.remove("impact");
  void board.offsetWidth;
  board.classList.add("impact");
  setTimeout(() => {
    slash.remove();
    number.remove();
    board.classList.remove("impact");
  }, 650);
}

function playLevelUpFx(unit) {
  if (prefersReducedMotion()) return;
  const mark = document.createElement("span");
  mark.className = "levelup-fx";
  mark.textContent = "升級！";
  mark.style.left = `${unit.x * cell + cell / 2}px`;
  mark.style.top = `${unit.y * cell + cell / 2}px`;
  $("fx-layer").append(mark);
  setTimeout(() => mark.remove(), 900);
}

function onBoardPointer(event) {
  if (animating || state.outcome !== "playing" || state.phase !== "ally") return;
  const { x, y } = cellFromEvent(event);
  if (x < 0 || y < 0 || x >= state.w || y >= state.h) return;
  const target = unitAt(state, x, y);
  const unit = selectedUnit();

  if (mode === "targeting" && unit && target && target.side === "foe" && distance(unit, target) <= UNIT_TYPES[unit.type].range) {
    resolveAttack(unit, target);
    return;
  }
  if (mode === "aimed" && unit && target && target.side === "foe" && distance(unit, target) <= 3) {
    resolveAimedShot(unit, target);
    return;
  }

  if (unit && unit.side === "ally" && !unit.acted) {
    if (target && target.side === "foe" && distance(unit, target) <= UNIT_TYPES[unit.type].range) {
      resolveAttack(unit, target);
      return;
    }
    if (!unit.moved && reachable.some((c) => c.x === x && c.y === y)) {
      const from = { x: unit.x, y: unit.y };
      preMove = state;
      state = moveUnit(state, unit.id, x, y);
      mode = "moved";
      reachable = [];
      const moved = selectedUnit();
      threatened = targetsFrom(state, moved).map((t) => ({ x: t.x, y: t.y }));
      audio.play("soft", { volume: 0.35 });
      setMessage(threatened.length ? "可以攻擊，或選擇待命" : "沒有目標，選擇待命");
      void animateMove(unit.id, from, { x, y }).then(() => render());
      return;
    }
  }

  if (target) {
    if (target.side === "ally" && !target.acted && mode !== "moved") selectUnit(target);
    else if (target.side === "foe" && !selected) inspectEnemy(target);
    else inspected = target.id;
    render();
    return;
  }

  if (mode !== "moved") {
    clearSelection();
    render();
  }
}

function resolveAttack(attacker, defender) {
  const beforeLvl = attacker.lvl;
  const f = forecast(state, attacker, defender);
  playCombatFx(attacker, defender, f.damage, f.charge > 1 ? "charge" : "hit");
  state = attack(state, attacker.id, defender.id);
  const grown = state.units.find((u) => u.id === attacker.id);
  if (grown && grown.lvl > beforeLvl) playLevelUpFx(grown);
  audio.play("hit", { volume: 0.5, rate: f.mult > 1 ? 1.15 : 0.95 });
  clearSelection();
  render();
  void persist();
  afterAllyAction();
}

function resolveAimedShot(attacker, defender) {
  const before = defender.hp;
  const next = aimedShot(state, attacker.id, defender.id);
  if (next === state) return;
  const after = next.units.find((u) => u.id === defender.id);
  playCombatFx(attacker, defender, before - after.hp, "aimed");
  state = next;
  audio.play("hit", { volume: 0.45, rate: 1.35 });
  clearSelection();
  render();
  void persist();
  afterAllyAction();
}

function afterAllyAction() {
  if (state.outcome !== "playing") {
    finish();
    return;
  }
  if (!pendingUnits(state, "ally").length) {
    setMessage("全員行動完畢，按「結束我方回合」");
    render();
  }
}

function showInspect(unit) {
  const panel = $("inspect");
  panel.hidden = false;
  const type = UNIT_TYPES[unit.type];
  $("inspect-name").textContent = `${unit.name}${unit.side === "foe" ? "（敵）" : ""}`;
  $("inspect-type").textContent = `${type.name} Lv.${unit.lvl}`;
  $("inspect-hp").textContent = `${unit.hp}/${unit.maxHp}`;
  $("inspect-hp-fill").style.width = `${(unit.hp / unit.maxHp) * 100}%`;
  const t = TERRAIN[terrainAt(state, unit.x, unit.y)];
  $("inspect-stats").innerHTML = [
    `攻 <b>${unit.atk}</b>`,
    `移 <b>${type.move}</b>`,
    `射程 <b>${type.range}</b>`,
    `地形 <b>${t.name}${t.def ? ` +${t.def}%` : ""}</b>`,
    `經驗 <b>${unit.exp}</b>`,
    unit.guarding ? "<b>架槍中：下次受擊減半</b>" : "",
    unit.type === "bow" ? `瞄準 <b>${unit.skillCd ? `冷卻 ${unit.skillCd}` : "就緒"}</b>` : "",
    unit.type === "cavalry" ? "<b>移動 2 格以上發動衝鋒</b>" : "",
  ].join("");

  const attacker = selectedUnit();
  const box = $("forecast");
  if (attacker && attacker.side === "ally" && unit.side === "foe" && mode === "aimed" && distance(attacker, unit) <= 3) {
    const preview = aimedShot(state, attacker.id, unit.id);
    const after = preview.units.find((u) => u.id === unit.id);
    box.hidden = false;
    box.innerHTML = `瞄準射擊：造成 <b>${unit.hp - after.hp}</b>・不受反擊`;
  } else if (attacker && attacker.side === "ally" && unit.side === "foe" && distance(attacker, unit) <= UNIT_TYPES[attacker.type].range) {
    const f = forecast(state, attacker, unit);
    box.hidden = false;
    box.innerHTML = `預估：造成 <b>${f.damage}</b>${f.mult > 1 ? "（相剋）" : f.mult < 1 ? "（被剋）" : ""}${f.kills ? "・可擊殺" : ""}　反擊 <b>${f.counter}</b>`;
  } else {
    box.hidden = true;
  }
}

function renderActions() {
  const box = $("actions");
  box.innerHTML = "";
  const unit = selectedUnit();
  if (!unit || unit.side !== "ally" || state.phase !== "ally" || state.outcome !== "playing") return;

  if (mode === "targeting" || mode === "aimed") {
    box.append(button("取消瞄準", "ghost", () => {
      mode = unit.moved ? "moved" : "idle";
      reachable = unit.moved ? [] : movementRange(state, unit);
      threatened = targetsFrom(state, unit).map((t) => ({ x: t.x, y: t.y }));
      render();
    }));
    return;
  }

  if (!unit.acted) {
    const canHit = targetsFrom(state, unit).length > 0;
    if (canHit) box.append(button("攻擊", "primary", () => { enterTargeting(); render(); }));
    if (unit.type === "spear") {
      box.append(button("架槍固守", "skill", () => {
        state = brace(state, unit.id);
        audio.play("ok", { volume: 0.35 });
        clearSelection();
        setMessage("架槍完成：下一次受擊傷害減半");
        render();
        void persist();
        afterAllyAction();
      }));
    }
    const aimedTargets = unit.type === "bow"
      ? state.units.filter((u) => u.side === "foe" && u.hp > 0 && distance(unit, u) <= 3)
      : [];
    if (unit.type === "bow") {
      const aimed = button(unit.skillCd ? `瞄準冷卻 ${unit.skillCd}` : "瞄準射擊", "skill", () => {
        enterAimedShot();
        render();
      });
      aimed.disabled = unit.skillCd > 0 || !aimedTargets.length;
      box.append(aimed);
    }
    if (unit.type === "cavalry" && unit.movedDistance >= 2) {
      const badge = document.createElement("span");
      badge.className = "charge-ready";
      badge.textContent = `衝鋒 +${Math.round(Math.min(50, unit.movedDistance * 10))}%`;
      box.append(badge);
    }
    box.append(button("待命", "ghost", () => {
      state = wait(state, unit.id);
      audio.play("click", { volume: 0.3 });
      clearSelection();
      render();
      void persist();
      afterAllyAction();
    }));
    if (preMove) {
      box.append(button("取消移動", "ghost", () => {
        state = preMove;
        selectUnit(state.units.find((u) => u.id === unit.id));
        render();
      }));
    }
  }
}

function button(label, className, onClick) {
  const el = document.createElement("button");
  el.textContent = label;
  el.className = className;
  el.onclick = onClick;
  return el;
}

function renderHud() {
  $("chapter-title").textContent = `第${"一二三"[state.chapter]}章 ${state.title}`;
  const obj = state.objective;
  $("objective").textContent =
    obj.kind === "rout"
      ? `目標：殲滅敵軍（剩 ${state.units.filter((u) => u.side === "foe" && u.hp > 0).length}）`
      : obj.kind === "seize"
        ? `目標：${obj.turns - state.turn + 1} 回合內奪下帥旗`
        : "目標：斬落敵方主將";
  $("turn-badge").textContent = `回合 ${state.turn}`;
  const phase = $("phase-badge");
  phase.textContent = state.phase === "ally" ? `我方 ${pendingUnits(state, "ally").length} 待動` : "敵方行動中";
  phase.className = `badge ${state.phase === "ally" ? "phase-ally" : "phase-foe"}`;
  $("log").innerHTML = state.log.slice(0, 8).map((line) => `<li>${line}</li>`).join("");
  $("end-turn").disabled = animating || state.phase !== "ally" || state.outcome !== "playing";
}

function renderTutorial() {
  const hint = tutorialHint(state, selected, mode);
  const panel = $("tutorial");
  // 檢視敵軍時隱藏教學，避免蓋住情報訊息
  panel.hidden = !hint || (inspected && !selected);
  if (panel.hidden) return;
  panel.dataset.step = hint.step;
  $("tutorial-title").textContent = hint.title;
  $("tutorial-text").textContent = hint.text;
}

function render() {
  layout();
  draw();
  renderHud();
  renderActions();
  renderTutorial();
  const unit = state.units.find((u) => u.id === (inspected ?? selected));
  if (unit) showInspect(unit);
  else $("inspect").hidden = true;
}

function runEnemyPhase() {
  clearSelection();
  state = endPhase(state);
  render();
  const queue = pendingUnits(state, "foe").map((u) => u.id);
  const tick = async () => {
    if (state.outcome !== "playing") {
      finish();
      return;
    }
    const id = queue.shift();
    if (id === undefined) {
      enemyIntent = null;
      state = endPhase(state);
      setMessage("換我方行動");
      render();
      void persist();
      return;
    }
    const actor = state.units.find((u) => u.id === id);
    const plan = planEnemyMove(state, id);
    enemyIntent = plan ? { unitId: id, move: plan.move, target: plan.target } : null;
    setMessage(plan?.target ? `${actor.name} → ${plan.target.name}` : `${actor.name} 正在移動`);
    render();
    await sleep(prefersReducedMotion() ? 80 : 380);
    const from = { x: actor.x, y: actor.y };
    const beforeTarget = plan?.target ? state.units.find((u) => u.id === plan.target.id) : null;
    const beforeHp = beforeTarget?.hp ?? 0;
    if (plan?.move && (plan.move.x !== from.x || plan.move.y !== from.y)) {
      state = moveUnit(state, id, plan.move.x, plan.move.y);
      await animateMove(id, from, plan.move);
    }
    if (plan?.target) state = attack(state, id, plan.target.id);
    state = wait(state, id);
    if (beforeTarget) {
      const afterTarget = state.units.find((u) => u.id === beforeTarget.id);
      const damage = Math.max(0, beforeHp - (afterTarget?.hp ?? 0));
      if (damage) {
        playCombatFx(actor, beforeTarget, damage, "enemy");
        audio.play("hit", { volume: 0.4, rate: 0.9 });
      }
    }
    enemyIntent = null;
    render();
    enemyTimer = setTimeout(tick, prefersReducedMotion() ? 80 : 220);
  };
  enemyTimer = setTimeout(tick, prefersReducedMotion() ? 80 : 360);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function persist() {
  progress.best = Math.max(progress.best ?? 0, state.score);
  progress.campaign = state.outcome === "playing"
    ? makeCampaignSave(state, campaignRoster)
    : null;
  $("best").textContent = progress.best;
  await saveProgress(progress);
}

function finish() {
  clearTimeout(enemyTimer);
  const won = state.outcome === "won";
  audio.play(won ? "win" : "error", { volume: 0.5 });
  const roster = rosterFrom(state);
  const fallen = roster.filter((r) => !r.alive);
  const overlay = $("overlay");
  overlay.hidden = false;
  $("overlay-title").textContent = won ? `第${"一二三"[state.chapter]}章 得勝` : "戰敗";
  $("overlay-body").textContent = won
    ? `${EPILOGUE[state.chapter]}　戰功 ${state.score}${fallen.length ? `，陣亡 ${fallen.length} 人` : "，全員生還"}`
    : "旌旗折損，這一章要重來。";
  $("overlay-roster").innerHTML = roster
    .map((r) => `<li class="${r.alive ? "" : "dead"}">${r.name}　${UNIT_TYPES[r.type].name} Lv.${r.lvl}${r.alive ? "" : "　陣亡"}</li>`)
    .join("");

  const actions = $("overlay-actions");
  actions.innerHTML = "";
  if (won && state.chapter + 1 < CHAPTERS.length) {
    const rewardTitle = document.createElement("p");
    rewardTitle.className = "reward-title";
    rewardTitle.textContent = "選一項整軍補給";
    actions.append(rewardTitle);
    const rewards = [
      ["armor", "補甲", "全員生命上限 +4"],
      ["edge", "磨刀", "全員攻擊 +1"],
      ["training", "操練", "全員經驗 +35"],
    ];
    for (const [key, title, detail] of rewards) {
      const reward = document.createElement("button");
      reward.className = "reward";
      reward.innerHTML = `<b>${title}</b><span>${detail}</span>`;
      reward.onclick = () => {
        campaignRoster = applyReward(roster, key);
        overlay.hidden = true;
        startChapter(state.chapter + 1, campaignRoster);
      };
      actions.append(reward);
    }
  } else if (won) {
    campaignRoster = null;
    actions.append(button("再打一次戰役", "primary", () => {
      overlay.hidden = true;
      startChapter(0, null);
    }));
  } else {
    actions.append(button("重打本章", "primary", () => {
      overlay.hidden = true;
      startChapter(state.chapter, campaignRoster);
    }));
    actions.append(button("從第一章重來", "ghost", () => {
      overlay.hidden = true;
      campaignRoster = null;
      startChapter(0, null);
    }));
  }
  void persist();
}

function showChapterIntro() {
  const overlay = $("overlay");
  overlay.hidden = false;
  $("overlay-title").textContent = `第${"一二三"[state.chapter]}章 ${state.title}`;
  $("overlay-body").textContent = state.brief;
  $("overlay-roster").innerHTML = state.units
    .filter((u) => u.side === "ally")
    .map((u) => `<li>${u.name}　${UNIT_TYPES[u.type].name} Lv.${u.lvl}</li>`)
    .join("");
  const actions = $("overlay-actions");
  actions.innerHTML = "";
  actions.append(button("出陣", "primary", () => {
    overlay.hidden = true;
    setMessage(state.brief);
  }));
}

function startChapter(chapter, roster) {
  clearTimeout(enemyTimer);
  campaignRoster = roster;
  state = createGame({ chapter, roster });
  clearSelection();
  $("lobby").hidden = true;
  $("game").hidden = false;
  render();
  showChapterIntro();
  void persist();
}

function resumeSavedCampaign() {
  const saved = restoreCampaign(progress.campaign);
  if (!saved) return;
  clearTimeout(enemyTimer);
  state = saved.state;
  campaignRoster = saved.roster;
  clearSelection();
  $("lobby").hidden = true;
  $("game").hidden = false;
  setMessage(`續戰：第 ${state.turn} 回合`);
  render();
}

canvas.addEventListener("pointerdown", onBoardPointer);
window.addEventListener("resize", () => {
  if (state) render();
});

$("end-turn").onclick = () => {
  if (animating || state.phase !== "ally" || state.outcome !== "playing") return;
  audio.play("click", { volume: 0.3 });
  runEnemyPhase();
};

function abandonCampaign() {
  clearTimeout(enemyTimer);
  campaignRoster = null;
  progress.campaign = null;
  void saveProgress(progress);
  $("game").hidden = true;
  $("overlay").hidden = true;
  $("lobby").hidden = false;
  updateResumeButton();
}

$("give-up").onclick = () => {
  $("confirm-overlay").hidden = false;
  $("cancel-give-up").focus();
};

$("cancel-give-up").onclick = () => {
  $("confirm-overlay").hidden = true;
  $("give-up").focus();
};

$("confirm-give-up").onclick = () => {
  $("confirm-overlay").hidden = true;
  abandonCampaign();
};

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("confirm-overlay").hidden) {
    $("confirm-overlay").hidden = true;
    $("give-up").focus();
  }
});

$("sound").onclick = async (event) => {
  const on = event.currentTarget.getAttribute("aria-pressed") !== "true";
  event.currentTarget.setAttribute("aria-pressed", String(on));
  event.currentTarget.textContent = on ? "♫ 音效" : "♫ 靜音";
  audio.setEnabled(on);
  if (on) await audio.start();
};

$("start").onclick = async () => {
  await audio.start();
  startChapter(0, null);
};

$("resume").onclick = async () => {
  await audio.start();
  resumeSavedCampaign();
};

function updateResumeButton() {
  const saved = restoreCampaign(progress.campaign);
  const canResume = Boolean(saved);
  $("resume").hidden = !canResume;
  if (canResume) $("resume-chapter").textContent = "一二三"[saved.state.chapter];
}

sheet = await loadSheet();
progress = await loadProgress();
$("best").textContent = progress.best ?? 0;
updateResumeButton();
