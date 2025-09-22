const letterValues = Object.fromEntries(
  Array.from({ length: 26 }, (_, idx) => [String.fromCharCode(65 + idx), idx + 1])
);

const vowelSet = new Set(['A', 'E', 'I', 'O', 'U']);

const puzzles = {
  '5x5': {
    label: '5x5 Grid',
    data: {
      rows: {
        R3C1_ACROSS: 'WORLD',
        R1C1_ACROSS: 'LEA',
        R4C2_ACROSS: 'SILO',
        R2C1_ACROSS: 'AREA',
        R5C3_ACROSS: 'EYE',
      },
      columns: {
        C5R3_DOWN: 'DOE',
        C1R1_DOWN: 'LAW',
        C2R1_DOWN: 'EROS',
        C4R2_DOWN: 'ALLY',
        C3R1_DOWN: 'AERIE',
      },
      matrix: ['LEA..', 'AREA.', 'WORLD', '.SILO', '..EYE'],
      fingerprint: '7fe891344d9734b5caeac06d871f60eb',
    },
  },
  '6x6': {
    label: '6x6 Grid',
    data: {
      rows: {
        R3C1_ACROSS: 'ABACUS',
        R4C2_ACROSS: 'EDEN',
        R1C2_ACROSS: 'REF',
        R2C2_ACROSS: 'OVER',
        R5C3_ACROSS: 'EST',
      },
      columns: {
        C2_DOWN: 'ROBE',
        C4_DOWN: 'FECES',
        C3_DOWN: 'EVADE',
        C5_DOWN: 'RUNT',
      },
      matrix: ['.REF..', '.OVER.', 'ABACUS', '.EDEN.', '..EST.'],
      fingerprint: 'a558f5e752ac2fdc7e95025f1dbff680',
    },
  },
  '7x7': {
    label: '7x7 Diamond',
    data: {
      matrix: [
        '###H###',
        '##BUS##',
        '#EARTH#',
        'ABSTAIN',
        '#BEFIT#',
        '##SUN##',
        '###L###',
      ],
      row_words: ['BUS', 'EARTH', 'ABSTAIN', 'BEFIT', 'SUN'],
      col_words: ['EBB', 'BASES', 'HURTFUL', 'STAIN', 'HIT'],
      fingerprint: 'abstain_35ff1327',
    },
  },
};

const gridEl = document.getElementById('puzzle-grid');
const letterTableBody = document.getElementById('letter-tally');
const letterArrayEl = document.getElementById('letter-array');
const toggleButtons = Array.from(document.querySelectorAll('.grid-toggle'));
const resetButton = document.getElementById('reset-btn');

let activeKey = null;
let activeState = null;

function init() {
  toggleButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.puzzle;
      setActivePuzzle(key);
    });
  });

  if (resetButton) {
    resetButton.addEventListener('click', () => {
      if (activeKey) {
        setActivePuzzle(activeKey, { force: true });
      }
    });
  }

  window.addEventListener('resize', syncLetterArrayWidth);
  setActivePuzzle('5x5', { force: true });
}

function setActivePuzzle(key, { force = false } = {}) {
  if (!force && key === activeKey) {
    return;
  }

  const definition = puzzles[key];
  if (!definition) {
    return;
  }

  activeKey = key;
  activeState = prepareState(definition.data);

  renderButtons();
  renderGrid(activeState);
  renderLetterTable(activeState);
  renderLetterArray(activeState);
  attachInputHandlers(activeState);
  updateTotals(activeState);
}

function renderButtons() {
  toggleButtons.forEach((btn) => {
    const isActive = btn.dataset.puzzle === activeKey;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  });
}

function prepareState(raw) {
  const matrix = raw.matrix.map((row) => row.split(''));
  const rowCount = matrix.length;
  const colCount = matrix[0] ? matrix[0].length : 0;
  const rowBases = [];
  const colBases = Array(colCount).fill(0);
  const rowDuplicateMaps = [];
  const colDuplicateMaps = Array.from({ length: colCount }, () => new Map());
  const vowelCounts = new Map();
  const consonantCounts = new Map();

  for (let r = 0; r < rowCount; r += 1) {
    const rowMap = new Map();
    let rowSum = 0;
    for (let c = 0; c < colCount; c += 1) {
      const char = matrix[r][c].toUpperCase();
      if (/^[A-Z]$/.test(char)) {
        const value = letterValues[char];
        rowSum += value;
        colBases[c] += value;

        rowMap.set(char, (rowMap.get(char) || 0) + 1);
        const colMap = colDuplicateMaps[c];
        colMap.set(char, (colMap.get(char) || 0) + 1);

        if (vowelSet.has(char)) {
          incrementMap(vowelCounts, char);
        } else {
          incrementMap(consonantCounts, char);
        }
      }
    }
    rowBases[r] = rowSum;
    rowDuplicateMaps[r] = rowMap;
  }

  const rowDuplicateFlags = rowDuplicateMaps.map((map) => Array.from(map.values()).some((count) => count > 1));
  const colDuplicateFlags = colDuplicateMaps.map((map) => Array.from(map.values()).some((count) => count > 1));

  return {
    raw,
    matrix,
    rowCount,
    colCount,
    rowBases,
    colBases,
    rowRemaining: rowBases.slice(),
    colRemaining: colBases.slice(),
    rowDuplicateFlags,
    colDuplicateFlags,
    vowelEntries: Array.from(vowelCounts.entries()).sort((a, b) => a[0].localeCompare(b[0])),
    consonantEntries: Array.from(consonantCounts.entries()).sort((a, b) => a[0].localeCompare(b[0])),
    letterTokens: new Map(),
    letterCards: new Map(),
    inputs: [],
    rowDisplays: [],
    colDisplays: [],
    rowCellGroups: [],
    colCellGroups: [],
  };
}

function renderGrid(state) {
  gridEl.innerHTML = '';
  const totalCols = state.colCount + 1;
  gridEl.style.setProperty('--grid-cols', totalCols);

  state.rowDisplays = [];
  state.colDisplays = [];
  state.inputs = [];
  state.rowCellGroups = Array.from({ length: state.rowCount }, () => []);
  state.colCellGroups = Array.from({ length: state.colCount }, () => []);

  for (let r = 0; r < state.rowCount + 1; r += 1) {
    for (let c = 0; c < state.colCount + 1; c += 1) {
      const cell = document.createElement('div');
      cell.classList.add('cell');

      if (r < state.rowCount && c < state.colCount) {
        const char = state.matrix[r][c].toUpperCase();
        if (char === '.' || char === '#') {
          cell.classList.add('black');
          cell.setAttribute('aria-hidden', 'true');
        } else {
          cell.dataset.row = String(r);
          cell.dataset.col = String(c);
          cell.dataset.letter = char;
          cell.dataset.prev = '0';
          cell.dataset.prevChar = '';
          if (vowelSet.has(char)) {
            cell.dataset.mask = 'star';
          }
          const input = document.createElement('input');
          input.type = 'text';
          input.maxLength = 1;
          input.autocomplete = 'off';
          input.inputMode = 'text';
          input.spellcheck = false;
          input.setAttribute('aria-label', `Row ${r + 1} column ${c + 1}`);
          cell.appendChild(input);
          state.inputs.push(input);
          state.rowCellGroups[r].push(cell);
          state.colCellGroups[c].push(cell);
        }
      } else if (r < state.rowCount && c === state.colCount) {
        cell.classList.add('total');
        cell.dataset.totalType = 'row';
        cell.dataset.index = String(r);
        state.rowDisplays.push(cell);
      } else if (r === state.rowCount && c < state.colCount) {
        cell.classList.add('total');
        cell.dataset.totalType = 'col';
        cell.dataset.index = String(c);
        state.colDisplays.push(cell);
      } else {
        cell.classList.add('no-total');
        cell.setAttribute('aria-hidden', 'true');
      }

      gridEl.appendChild(cell);
    }
  }
}

function renderLetterTable(state) {
  letterTableBody.innerHTML = '';
  state.letterTokens = new Map();

  const maxRows = Math.max(state.vowelEntries.length, state.consonantEntries.length, 1);
  for (let i = 0; i < maxRows; i += 1) {
    const row = document.createElement('tr');

    const vowelEntry = state.vowelEntries[i];
    row.appendChild(createLetterCell(vowelEntry, state));
    row.appendChild(createValueCell(vowelEntry));

    const consonantEntry = state.consonantEntries[i];
    row.appendChild(createLetterCell(consonantEntry, state));
    row.appendChild(createValueCell(consonantEntry));

    letterTableBody.appendChild(row);
  }
}

function renderLetterArray(state) {
  if (!letterArrayEl) {
    return;
  }
  letterArrayEl.innerHTML = '';
  state.letterCards = new Map();

  const vowelMap = new Map(state.vowelEntries);
  const vowelRow = Array.from(vowelSet).map((letter) => ({
    letter,
    count: vowelMap.get(letter) || 0,
    present: vowelMap.has(letter),
  }));

  const consonantObjects = state.consonantEntries.map(([letter, count]) => ({ letter, count, present: true }));

  const rows = [
    { entries: vowelRow, type: 'vowel' },
    { entries: consonantObjects.slice(0, 5), type: 'consonant' },
    { entries: consonantObjects.slice(5, 10), type: 'consonant' },
  ];

  rows.forEach((rowDef) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'letter-array-row';
    rowEl.dataset.rowType = rowDef.type;
    letterArrayEl.appendChild(rowEl);

    for (let i = 0; i < 5; i += 1) {
      const entry = rowDef.entries[i] || null;
      const card = createLetterCard(entry, state, rowDef.type);
      rowEl.appendChild(card);
    }
  });

  updateLetterArrayUsage(state);
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(syncLetterArrayWidth);
  } else {
    syncLetterArrayWidth();
  }
}

function createLetterCard(entry, state, type) {
  const card = document.createElement('div');
  card.classList.add('letter-card');
  card.classList.add(type === 'vowel' ? 'letter-card-vowel' : 'letter-card-consonant');

  if (!entry) {
    card.classList.add('letter-card-empty');
    card.setAttribute('aria-hidden', 'true');
    return card;
  }

  const { letter, count, present = true } = entry;
  card.dataset.letter = letter;
  card.setAttribute('role', 'group');

  const letterEl = document.createElement('span');
  letterEl.className = 'letter-card-letter';
  letterEl.textContent = letter;
  card.appendChild(letterEl);

  const valueEl = document.createElement('span');
  valueEl.className = 'letter-card-value';
  valueEl.textContent = letterValues[letter];
  card.appendChild(valueEl);

  const tokenStrip = document.createElement('div');
  tokenStrip.className = 'letter-card-token-strip';
  card.appendChild(tokenStrip);

  if (present && count > 0) {
    const tokens = [];
    for (let i = 0; i < count; i += 1) {
      const pip = document.createElement('span');
      pip.className = 'letter-card-token';
      tokenStrip.appendChild(pip);
      tokens.push(pip);
    }
    state.letterCards.set(letter, { card, tokens, total: count });
    card.setAttribute('aria-label', `${letter} letters available ${count}`);
  } else {
    card.classList.add('letter-card-absent');
    card.setAttribute('aria-label', `${letter} not present in puzzle`);
  }

  return card;
}

function updateLetterArrayUsage(state) {
  if (!state.letterCards || state.letterCards.size === 0) {
    return;
  }

  state.letterCards.forEach((info, letter) => {
    const bucket = state.letterTokens.get(letter) || [];
    const total = bucket.length || info.total || 0;
    const used = bucket.reduce(
      (acc, token) => acc + (token.classList.contains('used') ? 1 : 0),
      0
    );
    const remaining = Math.max(total - used, 0);

    info.tokens.forEach((pip, idx) => {
      pip.classList.toggle('used', idx < used);
    });

    info.card.classList.toggle('depleted', remaining === 0);
    info.card.classList.toggle('partial', remaining > 0 && remaining < total);
    info.card.setAttribute(
      'aria-label',
      `${letter} letters remaining ${remaining} of ${total}`
    );
  });
}

function syncLetterArrayWidth() {
  if (!letterArrayEl) {
    return;
  }
  const gridRect = gridEl.getBoundingClientRect();
  if (gridRect.width > 0) {
    letterArrayEl.style.width = `${Math.round(gridRect.width)}px`;
  } else {
    letterArrayEl.style.removeProperty('width');
  }
}

function createLetterCell(entry, state) {
  const td = document.createElement('td');
  if (!entry) {
    td.innerHTML = '&nbsp;';
    return td;
  }
  const [letter, count] = entry;
  const bucket = ensureTokenBucket(state, letter);
  for (let i = 0; i < count; i += 1) {
    const span = document.createElement('span');
    span.className = 'letter-token';
    span.textContent = letter;
    const tokenId = `${letter}-${bucket.length}`;
    span.dataset.letter = letter;
    span.dataset.tokenId = tokenId;
    bucket.push(span);
    td.appendChild(span);
  }
  return td;
}

function createValueCell(entry) {
  const td = document.createElement('td');
  if (!entry) {
    td.innerHTML = '&nbsp;';
    return td;
  }
  const [letter] = entry;
  td.textContent = letterValues[letter];
  td.classList.add('value-cell');
  return td;
}

function ensureTokenBucket(state, letter) {
  if (!state.letterTokens.has(letter)) {
    state.letterTokens.set(letter, []);
  }
  return state.letterTokens.get(letter);
}

function attachInputHandlers(state) {
  state.inputs.forEach((input) => {
    input.value = '';
    input.addEventListener('input', (event) => handleInput(event, state));
  });
}

function handleInput(event, state) {
  const input = event.target;
  const cell = input.closest('.cell');
  if (!cell) {
    return;
  }

  const cleaned = sanitizeInput(input.value);
  if (cleaned !== input.value) {
    input.value = cleaned;
  }

  const prevChar = cell.dataset.prevChar || '';
  const prevTokenId = cell.dataset.tokenId || '';

  if (prevChar && (!cleaned || cleaned !== prevChar)) {
    releaseToken(state, prevChar, prevTokenId);
    cell.dataset.tokenId = '';
  }

  if (cleaned && cleaned !== prevChar) {
    const newTokenId = consumeToken(state, cleaned);
    cell.dataset.tokenId = newTokenId || '';
  }

  const row = Number(cell.dataset.row);
  const col = Number(cell.dataset.col);
  const previousValue = Number(cell.dataset.prev || 0);
  const currentValue = letterValues[cleaned] || 0;
  const delta = currentValue - previousValue;

  if (delta !== 0) {
    state.rowRemaining[row] -= delta;
    state.colRemaining[col] -= delta;
    cell.dataset.prev = String(currentValue);
    updateTotals(state);
  } else {
    updateTotalStyles(state);
  }

  if (cleaned) {
    cell.classList.add('filled');
  } else {
    cell.classList.remove('filled');
  }

  cell.dataset.prevChar = cleaned;
  updateLetterArrayUsage(state);
}

function consumeToken(state, letter) {
  const bucket = state.letterTokens.get(letter);
  if (!bucket) {
    return '';
  }
  const token = bucket.find((span) => !span.classList.contains('used'));
  if (!token) {
    return '';
  }
  token.classList.add('used');
  return token.dataset.tokenId || '';
}

function releaseToken(state, letter, tokenId) {
  if (!letter || !tokenId) {
    return;
  }
  const bucket = state.letterTokens.get(letter);
  if (!bucket) {
    return;
  }
  const token = bucket.find((span) => span.dataset.tokenId === tokenId);
  if (token) {
    token.classList.remove('used');
  }
}

function sanitizeInput(raw) {
  return raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 1);
}

function hasEntry(cells) {
  return cells.some((cell) => getCellValue(cell));
}

function isGroupCorrect(cells) {
  return cells.every((cell) => getCellValue(cell) === (cell.dataset.letter || ''));
}

function getCellValue(cell) {
  const input = cell.querySelector('input');
  return input ? (input.value || '').toUpperCase() : '';
}

function updateTotals(state) {
  state.rowDisplays.forEach((el, idx) => {
    const suffix = state.rowDuplicateFlags[idx] ? '!' : '';
    el.textContent = `${state.rowRemaining[idx]}${suffix}`;
  });

  state.colDisplays.forEach((el, idx) => {
    const suffix = state.colDuplicateFlags[idx] ? '!' : '';
    el.textContent = `${state.colRemaining[idx]}${suffix}`;
  });

  updateTotalStyles(state);
}

function updateTotalStyles(state) {
  state.rowDisplays.forEach((el, idx) => {
    el.classList.remove('progress', 'complete');
    const remaining = state.rowRemaining[idx];
    const correct = remaining === 0 && isGroupCorrect(state.rowCellGroups[idx]);
    if (correct) {
      el.classList.add('complete');
    } else if (hasEntry(state.rowCellGroups[idx]) || remaining !== state.rowBases[idx]) {
      el.classList.add('progress');
    }
  });

  state.colDisplays.forEach((el, idx) => {
    el.classList.remove('progress', 'complete');
    const remaining = state.colRemaining[idx];
    const correct = remaining === 0 && isGroupCorrect(state.colCellGroups[idx]);
    if (correct) {
      el.classList.add('complete');
    } else if (hasEntry(state.colCellGroups[idx]) || remaining !== state.colBases[idx]) {
      el.classList.add('progress');
    }
  });
}

function incrementMap(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

init();

