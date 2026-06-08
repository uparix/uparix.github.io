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
const MAX_MOVES = 200;

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
const sheet = new Image();

let board = [];
let playerCol = 0;
let playerRow = 0;
let levelIndex = 0;
let moveCount = 0;

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
  setStatus("Level " + (levelIndex + 1) + " — use the arrow keys to move.");
  render();
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
  afterMove();
}

function afterMove() {
  const ballsLeft = board.flat().filter((t) => t === BALL).length;
  if (ballsLeft === 0) {
    setStatus("Completed in " + moveCount + " steps!");
  } else {
    setStatus("Moves: " + moveCount + ",  Moves Left: " + (MAX_MOVES - moveCount));
  }
  render();
  if (moveCount === MAX_MOVES) goToLevel(levelIndex);
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
    tryMove(move[0], move[1]);
  }
});

LEVELS.forEach((_, i) => {
  const option = document.createElement("option");
  option.textContent = "Level " + (i + 1);
  levelSelect.appendChild(option);
});
levelSelect.addEventListener("change", () => goToLevel(levelSelect.selectedIndex));
document.getElementById("restart").addEventListener("click", () => goToLevel(levelIndex));

sheet.onload = () => goToLevel(0);
sheet.onerror = () => setStatus("Could not load images.gif (serve over http, not file://).");
sheet.src = "images.gif";