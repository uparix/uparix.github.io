# uparix.github.io

The source for [**www.uparix.com**](https://www.uparix.com), a static site hosted
on GitHub Pages. It serves a lightweight animated landing page alongside a couple
of self-contained browser experiments — no build step, no dependencies to install.

## Contents

| Path | What it is |
|------|------------|
| [`/`](https://www.uparix.com) | Landing page — an animated particle network rendered on an HTML5 canvas in the Uparix brand colors. |
| [`/matrix`](https://www.uparix.com/matrix) | "Matrix rain" effect of falling Katakana and digit glyphs, built with [p5.js](https://p5js.org). |
| [`/sokoban`](https://www.uparix.com/sokoban) | A playable Sokoban puzzle game with six built-in levels, drawn on canvas from a sprite sheet. |

## Quick start

Everything is plain HTML, CSS, and vanilla JavaScript, so a static file server is
all you need. The repo ships with a self-contained `server` binary that serves
the current directory:

```bash
git clone https://github.com/uparix/uparix.github.io.git
cd uparix.github.io

# serve the current directory (defaults to port 8000)
./server [8000]
```

Then open <http://localhost:8000> in your browser. The sub-pages live at
`/matrix/` and `/sokoban/`.

> Prefer not to use the bundled binary? Any static server works just as well,
> e.g. `python3 -m http.server 8000`.

> The Matrix page loads p5.js from a CDN, so it needs an internet connection.
> The landing page and Sokoban run fully offline.

## Project layout

```
.
├── index.html          # Landing page
├── animation.js        # Particle-network canvas animation
├── styles.css          # Landing page styles
├── matrix/
│   ├── index.html
│   └── matrix.js       # p5.js Matrix-rain sketch
├── sokoban/
│   ├── index.html
│   ├── sokoban.js      # Game logic and rendering
│   └── images.gif      # Tile sprite sheet
├── server              # Static file server binary (serves the current dir)
├── CNAME               # Custom domain (www.uparix.com)
└── LICENSE
```

## Playing Sokoban

Push every ball onto a hole to clear a level. Use the **arrow keys** to move,
pick a level from the dropdown, and hit **Restart Level** if you get stuck. Each
level has its own move limit.

## Deployment

The site deploys automatically via GitHub Pages from the `main` branch. The
[`CNAME`](CNAME) file maps it to the custom domain `www.uparix.com`, so pushing
to `main` publishes the changes.

## Credits

- Matrix rain effect adapted from a sketch by Emily Xie.
- Sokoban based on the classic puzzle game (originally the [Caesum Electrica Puzzle](http://www.caesum.com/game/index.php)).

## License

Released under the [MIT License](LICENSE).