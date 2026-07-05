import { decode } from '@toon-format/toon';

const LANG_FILES = { de: 'german.toon', en: 'english.toon' };
const langData = {}; // lang -> { rows, presets, entries }, loaded on demand

async function loadLangData(lang) {
  if (!langData[lang]) {
    const res = await fetch(LANG_FILES[lang]);
    langData[lang] = decode(await res.text());
  }
  return langData[lang];
}

const grid = document.getElementById('grid');
const outLetters = document.getElementById('outLetters');
const outHex = document.getElementById('outHex');
const outIdx = document.getElementById('outIdx');
const outWarning = document.getElementById('outWarning');
const timeSelect = document.getElementById('timeSelect');
const langSelect = document.getElementById('langSelect');

let currentLang = 'de';
let rows = [];
let selection = []; // array of {row, col, letter, index}
const cellsByIndex = new Map(); // index -> cell element
let isDragging = false;

function toHex(index) {
  return index.toString(16).toUpperCase().padStart(2, '0');
}

function render() {
  outLetters.textContent = selection.length ? selection.map(s => s.letter).join(' ') : '—';
  outHex.textContent = selection.length ? selection.map(s => toHex(s.index)).join(' ') : '—';
  outIdx.textContent = selection.length ? selection.map(s => s.index).join(' ') : '—';
  outWarning.hidden = selection.length <= 32;
}

function clearSelection() {
  selection = [];
  document.querySelectorAll('.cell.selected').forEach(el => el.classList.remove('selected'));
}

function toggleCell(r, c) {
  const index = r * 11 + c;
  const cell = cellsByIndex.get(index);
  const existingIdx = selection.findIndex(s => s.row === r && s.col === c);
  if (existingIdx >= 0) {
    selection.splice(existingIdx, 1);
    cell.classList.remove('selected');
  } else {
    selection.push({ row: r, col: c, letter: rows[r][c], index });
    cell.classList.add('selected');
  }
}

function selectIndices(indices) {
  clearSelection();
  for (const index of indices) {
    const r = Math.floor(index / 11);
    const c = index % 11;
    toggleCell(r, c);
  }
  render();
}

function buildGrid() {
  grid.innerHTML = '';
  cellsByIndex.clear();
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 11; c++) {
      const letter = rows[r][c];
      const index = r * 11 + c; // row-major, 0-indexed
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.textContent = letter;
      cell.dataset.row = r;
      cell.dataset.col = c;

      cell.addEventListener('mousedown', (e) => {
        e.preventDefault(); // avoid text-selection while dragging across cells
        isDragging = true;
        toggleCell(r, c);
        render();
        timeSelect.value = ''; // manual edit no longer matches a preset
      });

      cell.addEventListener('mouseenter', () => {
        if (!isDragging) return;
        toggleCell(r, c);
        render();
        timeSelect.value = '';
      });

      cellsByIndex.set(index, cell);
      grid.appendChild(cell);
    }
  }
}

function populateTimeSelect() {
  const presets = langData[currentLang].presets;
  timeSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = currentLang === 'de' ? '— Uhrzeit wählen —' : '— Select a time —';
  timeSelect.appendChild(placeholder);
  presets.forEach((entry, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = entry.phrase;
    timeSelect.appendChild(opt);
  });
}

const hexTable = document.getElementById('hexTable');
const tableLangLabel = document.getElementById('tableLangLabel');
const hexDump = document.getElementById('hexDump');
const dumpLangLabel = document.getElementById('dumpLangLabel');

function populateHexTable() {
  const entries = langData[currentLang].entries;
  const timeW = 6; // extra space so TIME and PHRASE columns don't run together
  const phraseW = Math.max(...entries.map(e => e.phrase.length)) + 2;
  const posW = 8; // 4-digit position + padding
  const header = 'TIME'.padEnd(timeW) + 'PHRASE'.padEnd(phraseW) + 'POS'.padEnd(posW) + 'INDEX (HEX)';
  const sep = '-'.repeat(header.length + 20);
  const lines = entries.map((e, i) => {
    const pos = (i + 1).toString(16).toUpperCase().padStart(4, '0');
    return e.time.padEnd(timeW) + e.phrase.padEnd(phraseW) + pos.padEnd(posW) + e.hex.join(' ');
  });
  hexTable.value = [header, sep, ...lines].join('\n');
  tableLangLabel.textContent = currentLang === 'de' ? 'German' : 'English';
}

function populateHexDump() {
  const entries = langData[currentLang].entries;
  const SLOTS_PER_ENTRY = 32;   // 4 rows x 8 values, per entry
  const VALUES_PER_GROUP = 8;
  const GROUPS_PER_ENTRY = SLOTS_PER_ENTRY / VALUES_PER_GROUP; // 4

  const lines = [];
  entries.forEach((e, entryIdx) => {
    const padded = e.hex.concat(
      Array(Math.max(0, SLOTS_PER_ENTRY - e.hex.length)).fill('00')
    );
    const groups = [];
    for (let i = 0; i < SLOTS_PER_ENTRY; i += VALUES_PER_GROUP) {
      groups.push(padded.slice(i, i + VALUES_PER_GROUP).join(''));
    }
    const pos = (entryIdx * GROUPS_PER_ENTRY).toString(16).toUpperCase().padStart(4, '0');
    lines.push(pos + ': ' + groups.join(' '));
  });

  hexDump.value = ['v3.0 hex words addressed.', ...lines].join('\n');
  dumpLangLabel.textContent = currentLang === 'de' ? 'German' : 'English';
}

async function switchLanguage(lang) {
  await loadLangData(lang);
  currentLang = lang;
  rows = langData[lang].rows;
  document.documentElement.lang = lang;
  clearSelection();
  buildGrid();
  populateTimeSelect();
  populateHexTable();
  populateHexDump();
  render();
}

document.addEventListener('mouseup', () => {
  isDragging = false;
});

document.getElementById('clearBtn').addEventListener('click', () => {
  clearSelection();
  render();
  timeSelect.value = '';
});

timeSelect.addEventListener('change', () => {
  if (timeSelect.value === '') {
    clearSelection();
    render();
    return;
  }
  const entry = langData[currentLang].presets[Number(timeSelect.value)];
  selectIndices(entry.indices);
});

langSelect.addEventListener('change', () => {
  switchLanguage(langSelect.value);
});

switchLanguage('de');