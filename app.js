import {
  CHAPTERS,
  UNIT_TYPES,
  attack,
  createGame,
  distance,
  endPhase,
  forecast,
  movementRange,
  moveUnit,
  pendingUnits,
  rosterFrom,
  stepEnemy,
  targetsFrom,
  terrainAt,
  TERRAIN,
  unitAt,
  wait,
} from "./game.js";
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
let preMove = null; // 移動前的 state 快照，供「取消」還原
let mode = "idle"; // idle | moved | targeting
let reachable = [];
let threatened = [];
let enemyTimer = null;
let cell = 40;

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

  for (const unit of state.units) {
    if (unit.hp <= 0) continue;
    const color = SIDE_COLOR[unit.side];
    if (unit.id === selected) {
      ctx.fillStyle = "rgba(242,193,78,.35)";
      ctx.fillRect(unit.x * cell, unit.y * cell, cell, cell);
    }
    ctx.fillStyle = unit.side === "ally" ? "rgba(40,80,120,.55)" : "rgba(110,40,40,.55)";
    ctx.beginPath();
    ctx.ellipse(unit.x * cell + cell / 2, unit.y * cell + cell * 0.78, cell * 0.3, cell * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    if (sheet) drawSprite(tint(unit.type, unit.acted ? "#7c7268" : color), unit.x, unit.y, 0.92);
    else {
      ctx.fillStyle = color;
      ctx.fillText(UNIT_TYPES[unit.type].name[0], unit.x * cell + cell / 3, unit.y * cell + cell / 2);
    }

    const ratio = unit.hp / unit.maxHp;
    const barW = cell - 8;
    ctx.fillStyle = "rgba(0,0,0,.6)";
    ctx.fillRect(unit.x * cell + 4, unit.y * cell + cell - 6, barW, 4);
    ctx.fillStyle = ratio > 0.5 ? "#7ddc7d" : ratio > 0.25 ? "#f2c14e" : "#ff6b5e";
    ctx.fillRect(unit.x * cell + 4, unit.y * cell + cell - 6, barW * ratio, 4);
    if (unit.lvl > 1) {
      ctx.fillStyle = "#f2c14e";
      ctx.font = `${Math.max(9, cell * 0.25)}px system-ui, sans-serif`;
      ctx.fillText(`${unit.lvl}`, unit.x * cell + 3, unit.y * cell + cell * 0.3);
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
  preMove = null;
  mode = "idle";
  reachable = [];
  threatened = [];
}

function selectUnit(unit) {
  selected = unit.id;
  preMove = null;
  mode = "idle";
  reachable = unit.side === "ally" && !unit.moved ? movementRange(state, unit) : [];
  threatened = targetsFrom(state, unit).map((t) => ({ x: t.x, y: t.y }));
}

function enterTargeting() {
  const unit = selectedUnit();
  mode = "targeting";
  reachable = [];
  threatened = targetsFrom(state, unit).map((t) => ({ x: t.x, y: t.y }));
  setMessage(threatened.length ? "點選要攻擊的敵軍" : "射程內沒有敵軍");
}

function setMessage(text) {
  $("msg").textContent = text;
}

function onBoardPointer(event) {
  if (state.outcome !== "playing" || state.phase !== "ally") return;
  const { x, y } = cellFromEvent(event);
  if (x < 0 || y < 0 || x >= state.w || y >= state.h) return;
  const target = unitAt(state, x, y);
  const unit = selectedUnit();

  if (mode === "targeting" && unit && target && target.side === "foe" && distance(unit, target) <= UNIT_TYPES[unit.type].range) {
    resolveAttack(unit, target);
    return;
  }

  if (unit && unit.side === "ally" && !unit.acted) {
    if (target && target.side === "foe" && distance(unit, target) <= UNIT_TYPES[unit.type].range) {
      resolveAttack(unit, target);
      return;
    }
    if (!unit.moved && reachable.some((c) => c.x === x && c.y === y)) {
      preMove = state;
      state = moveUnit(state, unit.id, x, y);
      mode = "moved";
      reachable = [];
      const moved = selectedUnit();
      threatened = targetsFrom(state, moved).map((t) => ({ x: t.x, y: t.y }));
      audio.play("soft", { volume: 0.35 });
      setMessage(threatened.length ? "可以攻擊，或選擇待命" : "沒有目標，選擇待命");
      render();
      return;
    }
  }

  if (target) {
    if (target.side === "ally" && !target.acted && mode !== "moved") selectUnit(target);
    else showInspect(target);
    render();
    return;
  }

  if (mode !== "moved") {
    clearSelection();
    render();
  }
}

function resolveAttack(attacker, defender) {
  const f = forecast(state, attacker, defender);
  state = attack(state, attacker.id, defender.id);
  audio.play("hit", { volume: 0.5, rate: f.mult > 1 ? 1.15 : 0.95 });
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
  if (!pendingUnits(state, "ally").length) runEnemyPhase();
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
  ].join("");

  const attacker = selectedUnit();
  const box = $("forecast");
  if (attacker && attacker.side === "ally" && unit.side === "foe" && distance(attacker, unit) <= UNIT_TYPES[attacker.type].range) {
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

  if (mode === "moved" || (unit.moved && !unit.acted)) {
    const canHit = targetsFrom(state, unit).length > 0;
    if (canHit) box.append(button("攻擊", "primary", () => { enterTargeting(); render(); }));
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
  } else if (mode === "targeting") {
    box.append(button("取消攻擊", "ghost", () => {
      selectUnit(selectedUnit());
      mode = "moved";
      render();
    }));
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
  $("end-turn").disabled = state.phase !== "ally" || state.outcome !== "playing";
}

function render() {
  layout();
  draw();
  renderHud();
  renderActions();
  const unit = selectedUnit();
  if (unit) showInspect(unit);
  else $("inspect").hidden = true;
}

function runEnemyPhase() {
  clearSelection();
  state = endPhase(state);
  render();
  const queue = pendingUnits(state, "foe").map((u) => u.id);
  const tick = () => {
    if (state.outcome !== "playing") {
      finish();
      return;
    }
    const id = queue.shift();
    if (id === undefined) {
      state = endPhase(state);
      setMessage("換我方行動");
      render();
      void persist();
      return;
    }
    const before = state.units.filter((u) => u.side === "ally").map((u) => u.hp);
    state = stepEnemy(state, id);
    const after = state.units.filter((u) => u.side === "ally").map((u) => u.hp);
    if (after.some((hp, i) => hp < before[i])) audio.play("hit", { volume: 0.4, rate: 0.9 });
    render();
    enemyTimer = setTimeout(tick, 420);
  };
  enemyTimer = setTimeout(tick, 500);
}

async function persist() {
  progress.best = Math.max(progress.best ?? 0, state.score);
  progress.campaign = state.outcome === "playing"
    ? { chapter: state.chapter, roster: campaignRoster }
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
    ? `戰功 ${state.score}${fallen.length ? `　陣亡 ${fallen.length} 人` : "　全員生還"}`
    : "旌旗折損，這一章要重來。";
  $("overlay-roster").innerHTML = roster
    .map((r) => `<li class="${r.alive ? "" : "dead"}">${r.name}　${UNIT_TYPES[r.type].name} Lv.${r.lvl}${r.alive ? "" : "　陣亡"}</li>`)
    .join("");

  const actions = $("overlay-actions");
  actions.innerHTML = "";
  if (won && state.chapter + 1 < CHAPTERS.length) {
    campaignRoster = roster;
    actions.append(button("進入下一章", "primary", () => {
      overlay.hidden = true;
      startChapter(state.chapter + 1, campaignRoster);
    }));
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

function startChapter(chapter, roster) {
  clearTimeout(enemyTimer);
  campaignRoster = roster;
  state = createGame({ chapter, roster });
  clearSelection();
  $("lobby").hidden = true;
  $("game").hidden = false;
  setMessage(state.brief);
  render();
  void persist();
}

canvas.addEventListener("pointerdown", onBoardPointer);
window.addEventListener("resize", () => {
  if (state) render();
});

$("end-turn").onclick = () => {
  if (state.phase !== "ally" || state.outcome !== "playing") return;
  audio.play("click", { volume: 0.3 });
  runEnemyPhase();
};

$("give-up").onclick = () => {
  clearTimeout(enemyTimer);
  campaignRoster = null;
  progress.campaign = null;
  void saveProgress(progress);
  $("game").hidden = true;
  $("overlay").hidden = true;
  $("lobby").hidden = false;
  updateResumeButton();
};

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
  startChapter(progress.campaign.chapter, progress.campaign.roster);
};

function updateResumeButton() {
  const saved = progress.campaign;
  const canResume = Boolean(saved && saved.chapter > 0);
  $("resume").hidden = !canResume;
  if (canResume) $("resume-chapter").textContent = "一二三"[saved.chapter];
}

sheet = await loadSheet();
progress = await loadProgress();
$("best").textContent = progress.best ?? 0;
updateResumeButton();
