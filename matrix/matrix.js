// --- Tunables -------------------------------------------------------
const SYMBOL_SIZE = 14; // on-screen glyph size in pixels
const FADE_INTERVAL = 1.6; // larger = slower opacity falloff down a stream
const SPAWN_RANGE = [-2000, 0]; // vertical range a stream's head starts at

// Katakana Unicode block: 0x30A0 plus the first 97 code points.
const KATAKANA_START = 0x30a0;
const KATAKANA_COUNT = 97;

// Chance a glyph is Katakana rather than a digit (a roll of 0..5, keep > 1).
const KATAKANA_ROLL_MAX = 5;
const KATAKANA_ROLL_THRESHOLD = 1;

const LEADING_COLOR = [140, 255, 170]; // bright head of a stream
const TRAIL_COLOR = [0, 255, 70]; // the green trail behind it

// --- State ----------------------------------------------------------
let streams = [];

function setup() {
    createCanvas(window.innerWidth, window.innerHeight);
    background(0);

    for (let x = 0; x <= width; x += SYMBOL_SIZE) {
        const stream = new Stream();
        stream.generateSymbols(x, random(SPAWN_RANGE[0], SPAWN_RANGE[1]));
        streams.push(stream);
    }

    textFont('Consolas');
    textSize(SYMBOL_SIZE);
}

function draw() {
    background(0, 150);
    streams.forEach(function (stream) {
        stream.render();
    });
}

function Glyph(x, y, speed, isLeading, opacity) {
    this.x = x;
    this.y = y;
    this.value = '';

    this.speed = speed;
    this.isLeading = isLeading;
    this.opacity = opacity;

    this.switchInterval = round(random(2, 25));

    this.setToRandomSymbol = function () {
        if (frameCount % this.switchInterval !== 0) return;

        const roll = round(random(0, KATAKANA_ROLL_MAX));
        if (roll > KATAKANA_ROLL_THRESHOLD) {
            this.value = String.fromCharCode(
                KATAKANA_START + floor(random(0, KATAKANA_COUNT))
            );
        } else {
            this.value = floor(random(0, 10));
        }
    };

    this.rain = function () {
        this.y = this.y >= height ? 0 : this.y + this.speed;
    };
}

function Stream() {
    this.symbols = [];
    this.totalSymbols = round(random(5, 35));
    this.speed = random(5, 22);

    this.generateSymbols = function (x, y) {
        let opacity = 255;
        let isLeading = round(random(0, 4)) === 1;

        for (let i = 0; i <= this.totalSymbols; i++) {
            const symbol = new Glyph(x, y, this.speed, isLeading, opacity);
            symbol.setToRandomSymbol();
            this.symbols.push(symbol);

            opacity -= (255 / this.totalSymbols) / FADE_INTERVAL;
            y -= SYMBOL_SIZE;
            isLeading = false;
        }
    };

    this.render = function () {
        this.symbols.forEach(function (symbol) {
            const color = symbol.isLeading ? LEADING_COLOR : TRAIL_COLOR;
            fill(color[0], color[1], color[2], symbol.opacity);
            text(symbol.value, symbol.x, symbol.y);
            symbol.rain();
            symbol.setToRandomSymbol();
        });
    };
}