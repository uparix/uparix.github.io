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
  levelIndex = Math.min(Math.max(0, index), LEVELS.length - 1);
  levelSelect.selectedIndex = levelIndex;
  decodeLevel(LEVELS[levelIndex]);
  moveCount = 0;
  if (!isReplaying) recordedMoves = [];
  setStatus("Level " + (levelIndex + 1) + " — use the arrow keys to move.");
  render();
  renderMoves();
}

// --- Game logic -----------------------------------------------------
const isWalkable = (tile) => tile === FLOOR || tile === HOLE;

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

  // +3 puts a player on floor/hole, -3 removes one; -2 turns a ball into a
  // player, +5 turns the floor/hole beyond it into a ball (see tile codes).
  if (isWalkable(targetTile)) {
    board[playerRow][playerCol] = hereTile - 3;
    board[targetRow][targetCol] = targetTile + 3;
  } else if (canPushBall(targetTile, targetCol, targetRow, dx, dy)) {
    board[playerRow][playerCol] = hereTile - 3;
    board[targetRow][targetCol] = targetTile - 2;
    board[targetRow + dy][targetCol + dx] += 5;
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
  const maxMoves = MAX_MOVES[levelIndex];
  if (ballsLeft === 0) {
    setStatus("Completed in " + moveCount + " steps!");
  } else {
    setStatus("Moves: " + moveCount + ",  Moves Left: " + (maxMoves - moveCount));
  }
  render();
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

// Serialize the recorded moves as TOON (Token-Oriented Object Notation): a
// compact, tabular format that lists the columns once and one row per move.
function toToon() {
  const header = "moves[" + recordedMoves.length + "]{dx,dy}:";
  const rows = recordedMoves.map(([dx, dy]) => "  " + dx + "," + dy);
  return ["level: " + (levelIndex + 1), header, ...rows].join("\n");
}

function downloadMoves() {
  if (recordedMoves.length === 0) {
    setStatus("Nothing to download yet — make some moves first.");
    return;
  }
  const blob = new Blob([toToon()], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "sokoban-level" + (levelIndex + 1) + "-moves.toon";
  link.click();
  URL.revokeObjectURL(url);
}

// Parse a TOON file produced by toToon() back into { level, moves }. Reads the
// "level:" line and every "dx,dy" data row, ignoring the header line.
function parseToon(text) {
  let level = 1;
  const moves = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const levelMatch = trimmed.match(/^level:\s*(\d+)$/);
    const moveMatch = trimmed.match(/^(-?\d+),(-?\d+)$/);
    if (levelMatch) {
      level = Number(levelMatch[1]);
    } else if (moveMatch) {
      moves.push([Number(moveMatch[1]), Number(moveMatch[2])]);
    }
  }
  return { level, moves };
}

function loadMoves(text) {
  const { level, moves } = parseToon(text);
  if (moves.length === 0) {
    setStatus("No moves found in that file.");
    return;
  }
  stopReplay();
  goToLevel(level - 1); // resets the board and clears recordedMoves
  recordedMoves = moves;
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
      setStatus("Replay finished — " + moves.length + " moves.");
      return;
    }
    const [dx, dy] = moves[i++];
    tryMove(dx, dy);
    setStatus("Replaying move " + i + " / " + moves.length);
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
    if (isReplaying) return; // ignore manual input during a replay
    tryMove(move[0], move[1]);
  }
});

LEVELS.forEach((_, i) => {
  const option = document.createElement("option");
  option.textContent = "Level " + (i + 1);
  levelSelect.appendChild(option);
});
levelSelect.addEventListener("change", () => {
  stopReplay();
  goToLevel(levelSelect.selectedIndex);
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