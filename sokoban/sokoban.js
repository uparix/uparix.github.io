import { encode, decode } from "@toon-format/toon";
import { generateLevels } from "./levelgen.js";

// --- Board geometry -------------------------------------------------
const COLS = 18;
const ROWS = 14;
const SRC_TILE = 80; // sprite size inside images.gif
const TILE = 48; // on-screen tile size
const ORIGIN_X = 20;
const ORIGIN_Y = 20;

// --- Tile codes (also the sprite indices) ---------------------------
const EMPTY = 0;
const FLOOR = 1;
const HOLE = 2;
const PLAYER = 4;
const PLAYER_ON_HOLE = 5;
const BALL = 6;
const BALL_ON_HOLE = 7;
const HIGHEST_TILE = 8;
// Move limit per level (index 0 = level 1).
const MAX_MOVES = [200, 200, 1000, 230, 260, 470];

// A level character maps to a tile code via CHAR_CODES.indexOf(ch) % 10.
// A comma yields 9, which exceeds HIGHEST_TILE and so marks a row break.
const CHAR_CODES = " 01234567, :o#@XHB";

// The six built-in levels (originally the applets Sok1-Sok6).
const LEVELS = [
  " ,    #######, ####:::::#, #:::o###:#, #:#:#::::##, #:#:H:H#o:#, #:#::B::#:#, #:o#H:H:#:#, ##::::#:#:###,  #:###o::::@#,  #:::::##:::#,  ############",
  " , ,       ######,   #####o:::#,   #::#oo##:#,   #::Hoo:::#,   #::#:o#:##,  ###:##H#::#,  #:H::::HH:#,  #:#H#::#::#,  #@::#######,  #####",
  " ,   ##########,  ##::##::::#####, ##:::H::#:H::H:#, #:::H##::HH#:::#, #::::H:::#:::::#, #H####:#####:::#, #:#:ooooooo:@:##,##:::oBoBoBo:#:##,#:::######:###::#,#:#H:::::H::::H:#,#:::#############,#####, ",
  " ,   ####  ######,   #::####::::#,  ##B:::B:BB::#,  #:H:B::::B#:#,  #:o:::###:::#,  ######:::#@##,  #:B:o:B::BB:#,  #:::#:::#:::#,  ##B:::B:#H#:#,   #::#####:::#,   ####   #####, , ",
  " ##############, #:@:B:B:B:#::##, #H#::B:B::#:::#, #:#:B:B:B:::::#, #:#::B:B::##:##, #:#:B:B:B:##:#, #:#::B:B::##:#, #:#:B:B:B:##:#, #:#::B:B::##:#, #:#:B:o:B:##:##,##:##########::#,#::::::::::::::#,#:::#########::#,#####       ####",
  " ,  ############,  #::::o:#:::#,  #:::HB:#:H:#,  #:::#o:#:###,  #::##o#:::#, ##::##o#:H:##, #:::#:o#H#::#, #:@:#:o:::H:#, #::##:BHH#::#, #:::#:o::::##, #:::########, #####, ",
];

// --- Runtime state --------------------------------------------------
const canvas = document.getElementById("board");
canvas.width = ORIGIN_X * 2 + COLS * TILE;
canvas.height = ORIGIN_Y * 2 + ROWS * TILE;
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const levelSelect = document.getElementById("level");
const generatedSelect = document.getElementById("generated-level");
const modeSelect = document.getElementById("mode");
const seedInput = document.getElementById("seed");
const builtinControls = document.getElementById("builtin-controls");
const generatedControls = document.getElementById("generated-controls");
const movesList = document.getElementById("moves-list");
const sheet = new Image();

// Human-readable name for a [dx, dy] move, used in the panel and JSON export.
const moveName = (dx, dy) =>
  dy < 0 ? "Up" : dy > 0 ? "Down" : dx < 0 ? "Left" : "Right";

let board = [];
let playerCol = 0;
let playerRow = 0;
let levelIndex = 0;
let moveCount = 0;
let solved = false; // set by the move that finishes the level: fires the confetti once, then locks the keys

// --- Level source ----------------------------------------------------
// The game plays either the built-in levels or the current generated set;
// goToLevel() and afterMove() read these instead of LEVELS/MAX_MOVES directly.
const randomSeed = () => (Math.random() * 0x100000000) >>> 0;

let mode = "builtin";
let generated = []; // levels from the generator, easiest first
let seed = randomSeed();
let activeLevels = LEVELS;
let activeMaxMoves = MAX_MOVES;
const activeSelect = () => (mode === "generated" ? generatedSelect : levelSelect);

// --- Move recording / replay ---------------------------------------
let recordedMoves = []; // sequence of [dx, dy] for the current level
let isReplaying = false; // true while a replay is animating
let replayTimer = null; // setTimeout handle for the running replay
const REPLAY_DELAY = 250; // ms between replayed moves

// --- Level loading --------------------------------------------------
function decodeLevel(description) {
  board = Array.from({ length: ROWS }, () => new Array(COLS).fill(EMPTY));
  let col = 0;
  let row = 0;
  for (const ch of description) {
    const tile = CHAR_CODES.indexOf(ch) % 10;
    if (tile > HIGHEST_TILE || col >= COLS) {
      col = 0;
      if (++row >= ROWS) break;
    } else {
      if (tile === PLAYER || tile === PLAYER_ON_HOLE) {
        playerCol = col;
        playerRow = row;
      }
      board[row][col++] = Math.max(tile, EMPTY);
    }
  }
}

function goToLevel(index) {
  levelIndex = Math.min(Math.max(0, index), activeLevels.length - 1);
  activeSelect().selectedIndex = levelIndex;
  decodeLevel(activeLevels[levelIndex]);
  moveCount = 0;
  solved = false;
  if (!isReplaying) recordedMoves = [];
  setStatus(`Level ${levelIndex + 1} — use the arrow keys to move.`);
  render();
  renderMoves();
}

// --- Game logic -----------------------------------------------------
const isWalkable = (tile) => tile === FLOOR || tile === HOLE;

// Tile transitions (derived from the tile-code values above).
const addPlayer = (tile) => tile + 3; // FLOOR→PLAYER, HOLE→PLAYER_ON_HOLE
const removePlayer = (tile) => tile - 3; // reverse
const ballToPlayer = (tile) => tile - 2; // BALL→PLAYER, BALL_ON_HOLE→PLAYER_ON_HOLE
const addBall = (tile) => tile + 5; // FLOOR→BALL, HOLE→BALL_ON_HOLE

function canPushBall(tile, col, row, dx, dy) {
  if (tile !== BALL && tile !== BALL_ON_HOLE) return false;
  const beyond = board[row + dy][col + dx];
  return beyond === FLOOR || beyond === HOLE;
}

function tryMove(dx, dy) {
  const targetCol = playerCol + dx;
  const targetRow = playerRow + dy;
  const hereTile = board[playerRow][playerCol];
  const targetTile = board[targetRow][targetCol];

  if (isWalkable(targetTile)) {
    board[playerRow][playerCol] = removePlayer(hereTile);
    board[targetRow][targetCol] = addPlayer(targetTile);
  } else if (canPushBall(targetTile, targetCol, targetRow, dx, dy)) {
    board[playerRow][playerCol] = removePlayer(hereTile);
    board[targetRow][targetCol] = ballToPlayer(targetTile);
    board[targetRow + dy][targetCol + dx] = addBall(board[targetRow + dy][targetCol + dx]);
  } else {
    return;
  }
  playerCol = targetCol;
  playerRow = targetRow;
  moveCount++;
  if (!isReplaying) {
    recordedMoves.push([dx, dy]);
    renderMoves();
  }
  afterMove();
}

function afterMove() {
  const ballsLeft = board.flat().filter((t) => t === BALL).length;
  const maxMoves = activeMaxMoves[levelIndex];
  const completed = ballsLeft === 0;
  if (completed) {
    setStatus(`Completed in ${moveCount} moves!`);
  } else {
    setStatus(`Moves: ${moveCount},  Moves Left: ${maxMoves - moveCount}`);
  }
  render();
  if (completed && !solved) {
    solved = true;
    celebrate();
  }
  if (moveCount === maxMoves) goToLevel(levelIndex);
}

// --- Rendering ------------------------------------------------------
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const tile = board[row][col];
      const sprite = tile > HIGHEST_TILE ? EMPTY : tile;
      const sx = (sprite % 3) * SRC_TILE;
      const sy = Math.floor(sprite / 3) * SRC_TILE;
      const dx = ORIGIN_X + col * TILE;
      const dy = ORIGIN_Y + row * TILE;
      ctx.drawImage(sheet, sx, sy, SRC_TILE, SRC_TILE, dx, dy, TILE, TILE);
    }
  }
}

const setStatus = (text) => (statusEl.textContent = text);

// Burst of confetti from the player's square. confetti() wants the origin as a
// fraction of the viewport, so walk board -> canvas pixels -> page -> fraction.
// rect vs canvas.width covers the case where CSS scales the canvas down.
function celebrate() {
  const rect = canvas.getBoundingClientRect();
  const x = rect.left + ((ORIGIN_X + playerCol * TILE + TILE / 2) * rect.width) / canvas.width;
  const y = rect.top + ((ORIGIN_Y + playerRow * TILE + TILE / 2) * rect.height) / canvas.height;
  // Everything scaled 1.5x from the stock 100 / 70 / 45 / 1 burst: wider cone,
  // further throw and bigger pieces, with the count raised to match so the
  // larger burst does not read as thinner.
  confetti({
    particleCount: 150,
    spread: 105,
    startVelocity: 68,
    scalar: 1.5,
    origin: { x: x / window.innerWidth, y: y / window.innerHeight },
  });
}

// --- Generated levels -------------------------------------------------
const GENERATED_COUNT = 40;

const readSeed = () => {
  const value = Number.parseInt(seedInput.value.trim(), 10);
  return Number.isFinite(value) ? value >>> 0 : randomSeed();
};

async function buildGenerated(nextSeed) {
  seed = nextSeed;
  seedInput.value = String(seed);
  generatedSelect.disabled = true;
  generated = await generateLevels(seed, GENERATED_COUNT, { cols: COLS, rows: ROWS }, (done, total) =>
    setStatus(`Generating levels… ${done} / ${total}`)
  );
  generatedSelect.innerHTML = "";
  generated.forEach((level, i) => {
    const option = document.createElement("option");
    option.textContent = `Level ${i + 1} — ${level.boxes} balls, ${level.moves} moves`;
    generatedSelect.appendChild(option);
  });
  generatedSelect.disabled = false;
}

function setMode(next, index = 0) {
  stopReplay();
  mode = next;
  modeSelect.value = next;
  const isGenerated = next === "generated";
  builtinControls.hidden = isGenerated;
  generatedControls.hidden = !isGenerated;
  activeLevels = isGenerated ? generated.map((level) => level.description) : LEVELS;
  activeMaxMoves = isGenerated ? generated.map((level) => level.maxMoves) : MAX_MOVES;
  goToLevel(index);
}

// Rebuilds only when the seed actually changed, so the same seed always yields
// the same twenty levels.
let generating = false;

async function showGenerated(nextSeed, index = 0) {
  if (generating) return; // generation takes a moment; ignore impatient clicks
  if (nextSeed !== seed || generated.length === 0) {
    generating = true;
    try {
      await buildGenerated(nextSeed);
    } finally {
      generating = false;
    }
  }
  if (generated.length === 0) {
    modeSelect.value = mode;
    setStatus("Could not generate levels from that seed — try another one.");
    return;
  }
  setMode("generated", index);
}

// --- Moves panel / export -------------------------------------------
function renderMoves() {
  movesList.innerHTML = "";
  for (const [dx, dy] of recordedMoves) {
    const item = document.createElement("li");
    item.textContent = moveName(dx, dy);
    movesList.appendChild(item);
  }
  movesList.scrollTop = movesList.scrollHeight;
}

function downloadMoves() {
  if (recordedMoves.length === 0) {
    setStatus("Nothing to download yet — make some moves first.");
    return;
  }
  // encode() produces TOON (Token-Oriented Object Notation): a compact, tabular
  // format that lists the columns once and one row per move.
  const text = encode({
    mode,
    seed,
    level: levelIndex + 1,
    moves: recordedMoves.map(([dx, dy]) => ({ dx, dy })),
  });
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `sokoban-level${levelIndex + 1}-moves.toon`;
  link.click();
  URL.revokeObjectURL(url);
}

async function loadMoves(text) {
  const saved = decode(text);
  const { level, moves } = saved;
  if (!moves || moves.length === 0) {
    setStatus("No moves found in that file.");
    return;
  }
  stopReplay();
  // Files saved before generated levels existed carry no mode and are built-in.
  // Either branch resets the board and clears recordedMoves.
  if (saved.mode === "generated") await showGenerated(Number(saved.seed) >>> 0, level - 1);
  else setMode("builtin", level - 1);
  recordedMoves = moves.map(({ dx, dy }) => [dx, dy]);
  renderMoves();
  startReplay();
}

// --- Replay ---------------------------------------------------------
function stopReplay() {
  if (replayTimer !== null) {
    clearTimeout(replayTimer);
    replayTimer = null;
  }
  isReplaying = false;
}

function startReplay() {
  if (recordedMoves.length === 0) {
    setStatus("Nothing to replay yet — make some moves first.");
    return;
  }
  stopReplay();
  // Keep a copy: goToLevel only clears recordedMoves when not replaying.
  const moves = recordedMoves.slice();
  isReplaying = true;
  goToLevel(levelIndex); // reset the board to the level's start
  let i = 0;
  const step = () => {
    if (i >= moves.length) {
      stopReplay();
      setStatus(`Replay finished — ${moves.length} moves.`);
      return;
    }
    const [dx, dy] = moves[i++];
    tryMove(dx, dy);
    setStatus(`Replaying move ${i} / ${moves.length}`);
    replayTimer = setTimeout(step, REPLAY_DELAY);
  };
  step();
}

// --- Wiring ---------------------------------------------------------
const KEY_MOVES = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

document.addEventListener("keydown", (event) => {
  const move = KEY_MOVES[event.key];
  if (move) {
    event.preventDefault();
    if (isReplaying || solved) return; // ignore manual input during a replay, or once the level is finished
    tryMove(move[0], move[1]);
  }
});

LEVELS.forEach((_, i) => {
  const option = document.createElement("option");
  option.textContent = `Level ${i + 1}`;
  levelSelect.appendChild(option);
});
levelSelect.addEventListener("change", () => {
  stopReplay();
  goToLevel(levelSelect.selectedIndex);
});
generatedSelect.addEventListener("change", () => {
  stopReplay();
  goToLevel(generatedSelect.selectedIndex);
});

seedInput.value = String(seed);
modeSelect.addEventListener("change", () => {
  if (modeSelect.value === "generated") showGenerated(readSeed());
  else setMode("builtin");
});
document.getElementById("generate").addEventListener("click", () => showGenerated(readSeed()));
document.getElementById("new-seed").addEventListener("click", () => {
  seedInput.value = String(randomSeed());
  showGenerated(readSeed());
});
document.getElementById("restart").addEventListener("click", () => {
  stopReplay();
  goToLevel(levelIndex);
});
document.getElementById("replay").addEventListener("click", startReplay);
document.getElementById("download").addEventListener("click", downloadMoves);

const uploadInput = document.getElementById("upload-file");
document.getElementById("upload").addEventListener("click", () => uploadInput.click());
uploadInput.addEventListener("change", () => {
  const file = uploadInput.files[0];
  if (!file) return;
  file.text().then(loadMoves);
  uploadInput.value = ""; // allow re-loading the same file
});

sheet.onload = () => goToLevel(0);
sheet.onerror = () => setStatus("Could not load images.gif (serve over http, not file://).");
sheet.src = "images.gif";