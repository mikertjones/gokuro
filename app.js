const letterValues = Object.fromEntries(
  Array.from({ length: 26 }, (_, idx) => [String.fromCharCode(65 + idx), idx + 1])
);

const vowelSet = new Set(['A', 'E', 'I', 'O', 'U']);

function shouldSuppressVirtualKeyboard() {
  if (typeof window === 'undefined') {
    return false;
  }
  const nav = window.navigator || null;
  if (nav && nav.userAgentData && typeof nav.userAgentData.mobile === 'boolean' && nav.userAgentData.mobile) {
    return true;
  }
  if (typeof window.matchMedia === 'function') {
    try {
      const coarseQuery = window.matchMedia('(pointer: coarse)');
      if (coarseQuery && coarseQuery.matches) {
        return true;
      }
    } catch (error) {
      // ignore matchMedia errors
    }
  }
  if (nav) {
    if (typeof nav.maxTouchPoints === 'number' && nav.maxTouchPoints > 0) {
      return true;
    }
    if (typeof nav.msMaxTouchPoints === 'number' && nav.msMaxTouchPoints > 0) {
      return true;
    }
  }
  if (typeof window.ontouchstart !== 'undefined') {
    return true;
  }
  if (typeof document !== 'undefined') {
    return 'ontouchstart' in document.documentElement;
  }
  return false;
}

const suppressVirtualKeyboard = shouldSuppressVirtualKeyboard();

const BASE_CELL_SIZE = 56;


const LOCAL_API_BASE = '/api/puzzles';
const REMOTE_API_BASE = 'https://gokuro.vercel.app/api/puzzles';
const WEEK_PATH = '/week';
const VALID_PUZZLE_KEYS = ['5x5', '5x6', '6x7', '7x7'];

function resolveApiBase() {
  if (typeof window === 'undefined' || !window.location) {
    return LOCAL_API_BASE;
  }

  const host = window.location.hostname ? window.location.hostname.toLowerCase() : '';
  if (!host) {
    return LOCAL_API_BASE;
  }

  if (host === 'gokuro.net' || host === 'www.gokuro.net' || host.endsWith('gokuro.github.io')) {
    return REMOTE_API_BASE;
  }

  return LOCAL_API_BASE;
}

const API_BASE = resolveApiBase();

let weeklyEntries = [];
let activeDayIndex = 0;
let puzzles = {};
let maxTotalCols = 0;

function computeMaxTotalCols(source) {
  return Object.values(source || {}).reduce((max, puzzle) => {
    const matrix = puzzle?.data?.matrix || [];
    const cols = matrix[0] ? matrix[0].length : 0;
    return Math.max(max, cols + 1);
  }, 0);
}

function setPuzzlesMap(nextPuzzles) {
  puzzles = nextPuzzles || {};
  maxTotalCols = computeMaxTotalCols(puzzles);
}

function getFallbackWeekEntries() {
  const today = new Date();
  return Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    return {
      puzzleDate: date.toISOString().slice(0, 10),
      puzzleMap: buildFallbackPuzzleMap(),
    };
  });
}

function buildFallbackPuzzleMap() {
  return {
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
    '5x6': {
      label: '5x6 Grid',
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
    '6x7': {
      label: '6x7 Grid',
      data: {
        matrix: [
          '##BEND',
          '#ALERT',
          'PUZZLE',
          'LETTER',
          'STREAM',
          'REVEAL',
          '##ENDS',
        ],
        row_words: ['BEND', 'ALERT', 'PUZZLE', 'LETTER', 'STREAM', 'REVEAL', 'ENDS'],
        col_words: ['PSLR', 'ULEET', 'ZEARM', 'ZTELN', 'LEEAR', 'EDLEV'],
        fingerprint: 'fallback_6x7_demo',
      },
    },
    '7x7': {
      label: '7x7 Grid',
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
}

async function loadWeeklyPuzzles() {
  const fallbackEntries = getFallbackWeekEntries();

  if (typeof fetch !== 'function') {
    console.error('Fetch API is unavailable in this environment. Using fallback puzzles.');
    setWeeklyEntries(fallbackEntries);
    return;
  }

  try {
    const response = await fetch(API_BASE + WEEK_PATH, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Request failed with status ' + response.status);
    }
    const payload = await response.json();
    const entries = normalizeWeekPayload(payload);
    if (entries.length > 0) {
      setWeeklyEntries(entries);
      return;
    }
  } catch (error) {
    console.error('Failed to load puzzles from API', error);
  }

  setWeeklyEntries(fallbackEntries);
}

function setWeeklyEntries(entries) {
  const normalized = Array.isArray(entries)
    ? entries.map(normalizeWeekEntry).filter((entry) => entry && Object.keys(entry.puzzleMap || {}).length > 0)
    : [];

  if (normalized.length === 0) {
    weeklyEntries = [];
    puzzles = {};
    maxTotalCols = 0;
    activeDayIndex = 0;
    updateDayNavigationUI(null);
    clearGridOutputs();
    renderButtons();
    return;
  }

  normalized.sort((a, b) => getTimeValue(b.puzzleDate) - getTimeValue(a.puzzleDate));

  weeklyEntries = normalized;
  activeDayIndex = 0;
  applyDayEntry(0, { maintainSelection: false });
}

function normalizeWeekPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const candidates = [];
  if (Array.isArray(payload.days)) {
    candidates.push(...payload.days);
  } else if (Array.isArray(payload.rows)) {
    candidates.push(...payload.rows);
  } else if (Array.isArray(payload.puzzles)) {
    candidates.push(...payload.puzzles);
  } else if (Array.isArray(payload)) {
    candidates.push(...payload);
  }

  return candidates.map(normalizeWeekEntry).filter(Boolean);
}

function normalizeWeekEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  if (entry.puzzleMap && typeof entry.puzzleMap === 'object') {
    const sanitizedMap = {};
    for (const key of VALID_PUZZLE_KEYS) {
      if (entry.puzzleMap[key]) {
        const sanitized = ensurePuzzleEntry(entry.puzzleMap[key], key);
        if (sanitized) {
          sanitizedMap[key] = sanitized;
        }
      }
    }
    if (Object.keys(sanitizedMap).length === 0) {
      return null;
    }
    return {
      puzzleDate: normalizeDateString(entry.puzzleDate || entry.puzzle_date || entry.date || null),
      puzzleMap: sanitizedMap,
      metadata: entry.metadata || entry,
    };
  }

  const puzzleMap = parseDailyPuzzleMap(
    entry.puzzle_data || entry.puzzleData || entry.data || entry.puzzles || entry
  );

  if (!puzzleMap || Object.keys(puzzleMap).length === 0) {
    return null;
  }

  return {
    puzzleDate: normalizeDateString(entry.puzzle_date || entry.puzzleDate || entry.date || entry.day || null),
    puzzleMap,
    metadata: {
      id: entry.id ?? null,
      createdAt: entry.created_at ?? entry.createdAt ?? null,
    },
  };
}

function parseDailyPuzzleMap(raw) {
  const parsed = parseJsonMaybe(raw);
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const source =
    parsed.puzzles && typeof parsed.puzzles === 'object' && !Array.isArray(parsed.puzzles)
      ? parsed.puzzles
      : parsed;

  const mapped = {};
  for (const [rawKey, value] of Object.entries(source)) {
    const normalizedKey = normalizePuzzleKey(rawKey);
    if (!normalizedKey || !VALID_PUZZLE_KEYS.includes(normalizedKey)) {
      continue;
    }
    const entry = ensurePuzzleEntry(value, normalizedKey);
    if (entry) {
      mapped[normalizedKey] = entry;
    }
  }

  return mapped;
}

function parseJsonMaybe(raw) {
  if (raw == null) {
    return null;
  }
  if (typeof raw === 'object') {
    return raw;
  }
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.error('Unable to parse puzzle JSON', error);
      return null;
    }
  }
  return null;
}

function normalizePuzzleKey(rawKey) {
  if (!rawKey) {
    return null;
  }
  const match = String(rawKey).trim().toLowerCase().match(/(\d+)\s*x\s*(\d+)/);
  return match ? match[1] + 'x' + match[2] : null;
}

function formatPuzzleLabel(key) {
  return key ? key.toUpperCase() + ' Grid' : 'Puzzle';
}

function ensurePuzzleEntry(rawValue, key) {
  if (!rawValue || typeof rawValue !== 'object') {
    return null;
  }

  const label =
    typeof rawValue.label === 'string' && rawValue.label.trim()
      ? rawValue.label.trim()
      : formatPuzzleLabel(key);

  const data =
    rawValue.data && typeof rawValue.data === 'object' ? rawValue.data : { ...rawValue };

  if (!Array.isArray(data.matrix) || data.matrix.length === 0) {
    return null;
  }

  return {
    label,
    data,
  };
}

function normalizeDateString(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const str = String(value);
  const match = str.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) {
    return match[1];
  }
  const date = new Date(str);
  if (!Number.isNaN(date.getTime())) {
    return date.toISOString().slice(0, 10);
  }
  return str;
}

function getTimeValue(dateString) {
  if (!dateString) {
    return Number.NEGATIVE_INFINITY;
  }
  const date = new Date(dateString);
  if (!Number.isNaN(date.getTime())) {
    return date.getTime();
  }
  return Number.NEGATIVE_INFINITY;
}

async function performApplyDayEntry(index, { maintainSelection = false } = {}) {
  const entry = weeklyEntries[index];
  if (!entry) {
    activePuzzleDate = null;
    return;
  }

  pauseActiveTimer({ silent: true });

  try {
    await persistActivePuzzle({
      statusOverride: puzzleCompleted ? 'complete' : 'paused',
      targetKey: getActivePuzzleStorageKey(),
    });
  } catch (error) {
    console.error('Failed to persist progress before day switch', error);
  }

  activeDayIndex = index;
  const nextPuzzleDate = normalizeDateString(entry.puzzleDate);
  const puzzleMap = entry.puzzleMap || {};
  const availableKeys = getAvailablePuzzleKeys(puzzleMap); 
  const preferredKey =
    maintainSelection && activeKey && puzzleMap[activeKey] ? activeKey : availableKeys[0] || null;

  setPuzzlesMap(puzzleMap);
  updateDayNavigationUI(entry);
  await refreshStatusesForDay(nextPuzzleDate);

  if (preferredKey) {
    await setActivePuzzle(preferredKey, { force: true, targetDate: nextPuzzleDate });
  } else {
    activeKey = null;
    activeState = null;
    resetTimerState();
    renderButtons();
    clearGridOutputs();
  }

  activePuzzleDate = nextPuzzleDate;
}

function applyDayEntry(index, options = {}) {
  daySwitchChain = daySwitchChain
    .then(() => performApplyDayEntry(index, options))
    .catch((error) => {
      console.error('Failed to switch day', error);
    });
  return daySwitchChain;
}

function getAvailablePuzzleKeys(target = puzzles) {
  const map = target || {};
  return VALID_PUZZLE_KEYS.filter((key) => map[key]);
}

function updateDayNavigationUI(entry) {
  if (dayLabel) {
    if (entry?.puzzleDate) {
      dayLabel.textContent = formatDisplayDate(entry.puzzleDate);
      dayLabel.dataset.activeDate = entry.puzzleDate;
    } else {
      dayLabel.textContent = 'No puzzle date';
      delete dayLabel.dataset.activeDate;
    }
  }

  const hasEntries = weeklyEntries.length > 0;
  if (prevDayButton) {
    prevDayButton.disabled = !hasEntries || activeDayIndex >= weeklyEntries.length - 1;
  }
  if (nextDayButton) {
    nextDayButton.disabled = !hasEntries || activeDayIndex <= 0;
  }
}

function formatDisplayDate(value) {
  if (!value) {
    return 'Unknown date';
  }
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
  return String(value);
}

function navigateDay(offset) {
  if (!Number.isInteger(offset) || offset === 0 || weeklyEntries.length === 0) {
    return;
  }
  const nextIndex = activeDayIndex + offset;
  if (nextIndex < 0 || nextIndex >= weeklyEntries.length) {
    return;
  }
  applyDayEntry(nextIndex, { maintainSelection: true });
}

function setupDayNavigation() {
  if (prevDayButton) {
    prevDayButton.addEventListener('click', () => navigateDay(1));
  }
  if (nextDayButton) {
    nextDayButton.addEventListener('click', () => navigateDay(-1));
  }
}

function clearGridOutputs() {
  if (gridEl) {
    gridEl.innerHTML = '';
  }
  if (letterArrayEl) {
    letterArrayEl.innerHTML = '';
  }
  if (letterTableBody) {
    letterTableBody.innerHTML = '';
  }
}

function ensurePuzzlesLoaded() {
  if (puzzles && Object.keys(puzzles).length > 0) {
    return;
  }
  if (weeklyEntries.length > 0) {
    const entry = weeklyEntries[activeDayIndex] || weeklyEntries[0];
    if (entry) {
      setPuzzlesMap(entry.puzzleMap || {});
      updateDayNavigationUI(entry);
    }
    return;
  }
  setWeeklyEntries(getFallbackWeekEntries());
}

async function bootstrap() {
  await loadWeeklyPuzzles();
  init();
}
const gridEl = document.getElementById('puzzle-grid');
const letterTableBody = document.getElementById('letter-tally');
const letterArrayEl = document.getElementById('letter-array');
const toggleButtons = Array.from(document.querySelectorAll('.grid-toggle'));
const resetButton = document.getElementById('reset-btn');
const howToPlayButton = document.getElementById('how-to-play-btn');
const howToPlayModal = document.getElementById('how-to-play-modal');
const timerText = document.getElementById('timer-text');
const completionMessage = document.getElementById('completion-message');
const dayLabel = document.getElementById('active-day-label');
const prevDayButton = document.getElementById('prev-day-btn');
const nextDayButton = document.getElementById('next-day-btn');
const pauseButton = document.getElementById('timer-pause-btn');

let activeKey = null;
let activeState = null;
let lastFocusedElement = null;
let activePuzzleDate = null;
let timerIntervalId = null;
let timerStartTimestamp = 0;
let timerAccumulatedSeconds = 0;
let timerPaused = false;
let puzzleCompleted = false;
let isRestoringProgress = false;
let pendingSaveTimeoutId = 0;
let pendingSaveOptions = null;
const puzzleStatusCache = new Map();
let progressStore = null;
let progressDbPromise = null;
let puzzleSwitchChain = Promise.resolve();
let daySwitchChain = Promise.resolve();

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
        setActivePuzzle(activeKey, { force: true, reset: true });
      }
    });
  }

  setupDayNavigation();
  window.addEventListener('resize', handleResize);
  setupHowToPlayModal();

  if (pauseButton) {
    pauseButton.addEventListener('click', handlePauseButtonClick);
  }

  ensurePuzzlesLoaded();

  if (!activeKey) {
    const defaultKey = getAvailablePuzzleKeys()[0];
    if (defaultKey) {
      setActivePuzzle(defaultKey, { force: true });
    } else {
      renderButtons();
    }
  } else {
    renderButtons();
  }

  if (weeklyEntries.length > 0) {
    const currentEntry = weeklyEntries[activeDayIndex];
    updateDayNavigationUI(currentEntry);
    refreshStatusesForDay(currentEntry?.puzzleDate);
  } else {
    updateDayNavigationUI(null);
    refreshButtonStatusesForActiveDay();
  }

  updateTimerControls();
}

async function performSetActivePuzzle(key, { force = false, reset = false, targetDate = null } = {}) {
  if (!force && key === activeKey) {
    return;
  }

  pauseActiveTimer({ silent: true });

  const previousKey = activeKey;
  const previousDate = getActivePuzzleDate();
  if (previousKey && !(reset && previousKey === key)) {
    try {
      await persistActivePuzzle({
        statusOverride: puzzleCompleted ? 'complete' : 'paused',
        targetKey: composePuzzleStorageKey(previousDate, previousKey),
      });
    } catch (error) {
      console.error('Failed to save puzzle progress', error);
    }
  }

  resetTimerState();
  ensurePuzzlesLoaded();

  const definition = puzzles[key];
  if (!definition) {
    return;
  }

  activeKey = key;
  activeState = prepareState(definition.data);

  renderButtons();
  renderGrid(activeState);
  updateGridScaling(activeState);
  renderLetterTable(activeState);
  renderLetterArray(activeState);
  attachInputHandlers(activeState);

  let activeDate = targetDate ? normalizeDateString(targetDate) : getActivePuzzleDate();
  activePuzzleDate = normalizeDateString(activeDate);
  if (reset) {
    const storageKey = composePuzzleStorageKey(activeDate, key);
    await deletePuzzleProgressRecord(storageKey);
    setPuzzleStatusCacheEntry(storageKey, null);
    refreshButtonStatusesForActiveDay();
  } else {
    try {
      await restoreActivePuzzleProgress(activeDate, key);
    } catch (error) {
      console.error('Failed to restore puzzle progress', error);
    }
  }

  updateTotals(activeState);
  updateLetterArrayUsage(activeState);
  handleResize();
  updateTimerControls();
}

function setActivePuzzle(key, options = {}) {
  const params = Object.assign({ targetDate: getActivePuzzleDate() }, options || {});
  puzzleSwitchChain = puzzleSwitchChain
    .then(() => performSetActivePuzzle(key, params))
    .catch((error) => {
      console.error('Failed to switch puzzle', error);
    });
  return puzzleSwitchChain;
}

function renderButtons() {
  toggleButtons.forEach((btn) => {
    const key = btn.dataset.puzzle || '';
    const hasPuzzle = Boolean(puzzles[key]);
    btn.disabled = !hasPuzzle;
    btn.classList.toggle('unavailable', !hasPuzzle);
    btn.setAttribute('aria-disabled', String(!hasPuzzle));

    if (hasPuzzle && puzzles[key]?.label) {
      btn.setAttribute('title', puzzles[key].label);
    } else {
      btn.removeAttribute('title');
    }

    const isActive = key === activeKey;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  });
  refreshButtonStatusesForActiveDay();
}

function getActivePuzzleDate() {
  if (activePuzzleDate) {
    return activePuzzleDate;
  }
  const entry = weeklyEntries[activeDayIndex];
  const direct = entry?.puzzleDate || (dayLabel ? dayLabel.dataset.activeDate : null);
  return normalizeDateString(direct);
}

function getActivePuzzleStorageKey() {
  const date = getActivePuzzleDate();
  if (!date || !activeKey) {
    return null;
  }
  return composePuzzleStorageKey(date, activeKey);
}

function composePuzzleStorageKey(date, puzzleKey) {
  const normalizedDate = normalizeDateString(date) || 'unknown';
  const suffix = puzzleKey || 'unknown';
  return `${normalizedDate}-${suffix}`;
}

function getCurrentElapsedSeconds() {
  const runningSeconds = timerStartTimestamp
    ? Math.max(0, Math.floor((Date.now() - timerStartTimestamp) / 1000))
    : 0;
  return timerAccumulatedSeconds + runningSeconds;
}

function setPuzzleStatusCacheEntry(storageKey, payload) {
  if (!storageKey) {
    return;
  }
  if (!payload || payload.status === 'not-started') {
    puzzleStatusCache.delete(storageKey);
  } else {
    puzzleStatusCache.set(storageKey, {
      status: payload.status,
      elapsedSeconds: Math.max(0, Number(payload.elapsedSeconds) || 0),
    });
  }
}

function refreshButtonStatusesForActiveDay() {
  const date = getActivePuzzleDate();
  toggleButtons.forEach((btn) => {
    btn.classList.remove('status-complete', 'status-paused');
    btn.removeAttribute('data-status');
    if (!date) {
      return;
    }
    const puzzleKey = btn.dataset.puzzle || '';
    const storageKey = composePuzzleStorageKey(date, puzzleKey);
    const record = puzzleStatusCache.get(storageKey);
    const status = record?.status || 'not-started';
    const isActive = puzzleKey === activeKey;

    if (status === 'complete') {
      btn.classList.add('status-complete');
      btn.setAttribute('data-status', 'complete');
    } else if (status === 'paused' && !isActive) {
      btn.classList.add('status-paused');
      btn.setAttribute('data-status', 'paused');
    }
  });
}

const STORAGE_DB_NAME = 'gokuro-progress';
const STORAGE_STORE_NAME = 'puzzleProgress';

async function ensureProgressStore() {
  if (progressStore) {
    return progressStore;
  }

  const memoryCache = new Map();
  const hasIndexedDb = typeof indexedDB !== 'undefined';

  if (!hasIndexedDb) {
    progressStore = {
      async get(key) {
        return memoryCache.get(key) || null;
      },
      async set(record) {
        if (!record || !record.id) {
          return;
        }
        memoryCache.set(record.id, record);
      },
      async delete(key) {
        memoryCache.delete(key);
      },
    };
    return progressStore;
  }

  if (!progressDbPromise) {
    progressDbPromise = new Promise((resolve) => {
      try {
        const request = indexedDB.open(STORAGE_DB_NAME, 1);
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(STORAGE_STORE_NAME)) {
            db.createObjectStore(STORAGE_STORE_NAME, { keyPath: 'id' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          console.error('Failed to open progress database', request.error);
          resolve(null);
        };
      } catch (error) {
        console.error('IndexedDB unavailable', error);
        resolve(null);
      }
    });
  }

  const db = await progressDbPromise;
  if (!db) {
    progressStore = {
      async get(key) {
        return memoryCache.get(key) || null;
      },
      async set(record) {
        if (!record || !record.id) {
          return;
        }
        memoryCache.set(record.id, record);
      },
      async delete(key) {
        memoryCache.delete(key);
      },
    };
    return progressStore;
  }

  progressStore = {
    async get(key) {
      if (!key) {
        return null;
      }
      return new Promise((resolve) => {
        const tx = db.transaction(STORAGE_STORE_NAME, 'readonly');
        const store = tx.objectStore(STORAGE_STORE_NAME);
        const request = store.get(key);
        request.onsuccess = () => {
          resolve(request.result || null);
        };
        request.onerror = () => {
          console.error('Failed to read progress record', request.error);
          resolve(null);
        };
      });
    },
    async set(record) {
      if (!record || !record.id) {
        return;
      }
      await new Promise((resolve) => {
        const tx = db.transaction(STORAGE_STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORAGE_STORE_NAME);
        store.put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => {
          console.error('Failed to save progress record', tx.error);
          resolve();
        };
      });
    },
    async delete(key) {
      if (!key) {
        return;
      }
      await new Promise((resolve) => {
        const tx = db.transaction(STORAGE_STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORAGE_STORE_NAME);
        store.delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => {
          console.error('Failed to delete progress record', tx.error);
          resolve();
        };
      });
    },
  };

  return progressStore;
}

async function getPuzzleProgressRecord(storageKey) {
  if (!storageKey) {
    return null;
  }
  const store = await ensureProgressStore();
  return store.get(storageKey);
}

async function savePuzzleProgressRecord(record) {
  if (!record || !record.id) {
    return;
  }
  const store = await ensureProgressStore();
  await store.set(record);
}

async function deletePuzzleProgressRecord(storageKey) {
  if (!storageKey) {
    return;
  }
  const store = await ensureProgressStore();
  await store.delete(storageKey);
}

function collectPuzzleEntries(state) {
  if (!state || !Array.isArray(state.rowCellGroups)) {
    return {};
  }
  const entries = {};
  state.rowCellGroups.forEach((rowCells, rowIndex) => {
    rowCells.forEach((cell, colIndex) => {
      const value = getCellValue(cell);
      if (value) {
        entries[`${rowIndex}-${colIndex}`] = value;
      }
    });
  });
  return entries;
}

async function persistActivePuzzle({ statusOverride, targetKey } = {}) {
  if (pendingSaveTimeoutId) {
    clearTimeout(pendingSaveTimeoutId);
    pendingSaveTimeoutId = 0;
    pendingSaveOptions = null;
  }

  const storageKey = targetKey || getActivePuzzleStorageKey();
  if (!storageKey || !activeState) {
    return;
  }

  const entries = collectPuzzleEntries(activeState);
  const elapsedSeconds = getCurrentElapsedSeconds();
  const hasEntries = Object.keys(entries).length > 0;
  const hasProgress = hasEntries || elapsedSeconds > 0;

  let status = statusOverride;
  if (status === 'paused' && !hasProgress) {
    status = 'not-started';
  }
  if (!status) {
    if (puzzleCompleted) {
      status = 'complete';
    } else if (!timerIntervalId && (timerPaused || hasProgress)) {
      status = hasProgress ? 'paused' : 'not-started';
    } else {
      status = hasProgress ? 'started' : 'not-started';
    }
  }

  if (status === 'not-started') {
    await deletePuzzleProgressRecord(storageKey);
    setPuzzleStatusCacheEntry(storageKey, null);
    refreshButtonStatusesForActiveDay();
    return;
  }

  const record = {
    id: storageKey,
    status,
    entries,
    elapsedSeconds,
    updatedAt: Date.now(),
  };

  await savePuzzleProgressRecord(record);
  setPuzzleStatusCacheEntry(storageKey, { status, elapsedSeconds });
  refreshButtonStatusesForActiveDay();
}

async function restoreActivePuzzleProgress(date, puzzleKey) {
  const storageKey = composePuzzleStorageKey(date, puzzleKey);
  const record = await getPuzzleProgressRecord(storageKey);
  if (!record) {
    timerAccumulatedSeconds = 0;
    timerStartTimestamp = 0;
    timerPaused = false;
    puzzleCompleted = false;
    updateTimerDisplay();
    updateTimerControls();
    if (completionMessage) {
      completionMessage.style.display = 'none';
    }
    setPuzzleStatusCacheEntry(storageKey, null);
    refreshButtonStatusesForActiveDay();
    return;
  }

  timerAccumulatedSeconds = Math.max(0, Number(record.elapsedSeconds) || 0);
  timerStartTimestamp = 0;
  timerPaused = record.status === 'paused';
  puzzleCompleted = record.status === 'complete';
  updateTimerDisplay();
  updateTimerControls();
  if (completionMessage) {
    completionMessage.style.display = puzzleCompleted ? 'inline' : 'none';
  }

  const entries = record.entries || {};
  if (activeState && activeState.inputs) {
    isRestoringProgress = true;
    Object.entries(entries).forEach(([coord, value]) => {
      const [rowIndexStr, colIndexStr] = coord.split('-');
      const rowIndex = Number(rowIndexStr);
      const colIndex = Number(colIndexStr);
      const cell = activeState.rowCellGroups?.[rowIndex]?.[colIndex];
      if (!cell) {
        return;
      }
      const input = cell.querySelector('input');
      if (!input) {
        return;
      }
      input.value = value;
      handleInput({ target: input }, activeState);
    });
    isRestoringProgress = false;
    updateTotals(activeState);
    updateLetterArrayUsage(activeState);
  }

  setPuzzleStatusCacheEntry(storageKey, {
    status: record.status || 'started',
    elapsedSeconds: timerAccumulatedSeconds,
  });
  refreshButtonStatusesForActiveDay();
}

async function refreshStatusesForDay(date) {
  const normalizedDate = normalizeDateString(date);
  if (!normalizedDate) {
    return;
  }
  const store = await ensureProgressStore();
  const keys = getAvailablePuzzleKeys();
  await Promise.all(
    keys.map(async (puzzleKey) => {
      const storageKey = composePuzzleStorageKey(normalizedDate, puzzleKey);
      const record = await store.get(storageKey);
      if (record) {
        setPuzzleStatusCacheEntry(storageKey, {
          status: record.status || 'not-started',
          elapsedSeconds: Math.max(0, Number(record.elapsedSeconds) || 0),
        });
      } else {
        setPuzzleStatusCacheEntry(storageKey, null);
      }
    })
  );
  refreshButtonStatusesForActiveDay();
}

function scheduleSaveActivePuzzle(options = {}) {
  pendingSaveOptions = Object.assign({}, pendingSaveOptions || {}, options);
  if (pendingSaveTimeoutId) {
    clearTimeout(pendingSaveTimeoutId);
  }
  pendingSaveTimeoutId = window.setTimeout(() => {
    const opts = pendingSaveOptions || {};
    pendingSaveOptions = null;
    pendingSaveTimeoutId = 0;
    persistActivePuzzle(opts).catch((error) => {
      console.error('Failed to persist puzzle progress', error);
    });
  }, 200);
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
    activeInput: null,
    lastActiveInput: null,
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
          input.inputMode = suppressVirtualKeyboard ? 'none' : 'text';
          input.spellcheck = false;
          if (suppressVirtualKeyboard) {
            input.readOnly = true;
            input.dataset.virtualKeyboard = 'suppressed';
          }
          input.setAttribute('aria-label', `Row ${r + 1} column ${c + 1}`);
          cell.appendChild(input);
          state.inputs.push(input);
          state.rowCellGroups[r].push(cell);
          state.colCellGroups[c].push(cell);
          cell.addEventListener('click', (event) => handleGridCellClick(event, state));
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

function getBaseCellSize() {
  return BASE_CELL_SIZE;
}

function updateGridScaling(state) {
  if (!gridEl || !state) {
    return;
  }
  const totalCols = state.colCount + 1;
  if (totalCols <= 0 || maxTotalCols === 0) {
    return;
  }

  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const bodyStyles = getComputedStyle(document.body);
  const paddingLeft = parseFloat(bodyStyles.paddingLeft) || 0;
  const paddingRight = parseFloat(bodyStyles.paddingRight) || 0;
  const availableWidth = Math.max(viewportWidth - paddingLeft - paddingRight, 240);
  
  // Use full available width on mobile, maintain max width constraint on desktop
  const isMobile = viewportWidth <= 640;
  let targetWidth;
  
  if (isMobile) {
    // On mobile, use 95% of available width to ensure it fits with some margin
    targetWidth = availableWidth * 0.95;
  } else {
    // On desktop, use original logic
    const maxBoardWidth = BASE_CELL_SIZE * maxTotalCols;
    targetWidth = Math.min(maxBoardWidth, availableWidth);
  }
  
  const adjustedCellSize = targetWidth / totalCols;
  const cellSizePx = `${Math.max(adjustedCellSize, 0).toFixed(3)}px`;
  const widthPx = `${targetWidth.toFixed(3)}px`;

  gridEl.style.setProperty('--cell-size', cellSizePx);
  gridEl.style.width = widthPx;
  gridEl.style.maxWidth = widthPx;
  gridEl.style.minWidth = widthPx;
}

function handleResize() {
  if (activeState) {
    updateGridScaling(activeState);
  }
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(syncLetterArrayWidth);
  } else {
    syncLetterArrayWidth();
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

  const consonantObjects = state.consonantEntries.map(([letter, count]) => ({
    letter,
    count,
    present: true,
  }));

  const cardsPerRow = 5;
  const rows = [{ entries: vowelRow, type: 'vowel' }];

  if (consonantObjects.length === 0) {
    rows.push({ entries: [], type: 'consonant' });
  } else {
    for (let idx = 0; idx < consonantObjects.length; idx += cardsPerRow) {
      rows.push({ entries: consonantObjects.slice(idx, idx + cardsPerRow), type: 'consonant' });
    }
  }


  rows.forEach((rowDef) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'letter-array-row';
    rowEl.dataset.rowType = rowDef.type;
    letterArrayEl.appendChild(rowEl);

    for (let i = 0; i < cardsPerRow; i += 1) {
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

  let countBadge = null;
  if (present) {
    countBadge = document.createElement('span');
    countBadge.className = 'letter-card-count';
    countBadge.textContent = String(count);
    countBadge.setAttribute('aria-hidden', 'true');
    card.appendChild(countBadge);
    card.dataset.remaining = String(Math.max(count, 0));
    card.classList.add('letter-card-interactive');
    if (count <= 0) {
      card.classList.add('letter-card-disabled');
    }
    card.addEventListener('click', (event) => handleLetterCardSelection(event, state, letter));
    state.letterCards.set(letter, { card, countEl: countBadge, total: count });
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

    if (info.countEl) {
      info.countEl.textContent = String(remaining);
    }

    info.total = total;
    info.card.dataset.remaining = String(remaining);
    info.card.classList.toggle('letter-card-disabled', remaining === 0);
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
    input.addEventListener('focus', () => {
      state.activeInput = input;
      state.lastActiveInput = input;
    });
    input.addEventListener('blur', () => {
      if (state.activeInput === input) {
        state.activeInput = null;
      }
    });
    if (input.readOnly) {
      input.addEventListener('keydown', (event) => handleSuppressedInputKeydown(event, state));
    }
    input.addEventListener('input', (event) => handleInput(event, state));
  });
}

function handleGridCellClick(event, state) {
  if (!state) {
    return;
  }
  const cell = event.currentTarget;
  if (!cell || !(cell instanceof HTMLElement)) {
    return;
  }
  const input = cell.querySelector('input');
  if (!input) {
    return;
  }
  const hadValue = Boolean(input.value);
  if (hadValue) {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (typeof input.focus === 'function') {
    try {
      input.focus({ preventScroll: true });
    } catch (error) {
      input.focus();
    }
  }
  if (typeof input.select === 'function') {
    try {
      input.select();
    } catch (error) {
      // no-op if selection fails
    }
  }
}

function resolveActiveInput(state) {
  if (!state || !Array.isArray(state.inputs)) {
    return null;
  }
  const activeEl = document.activeElement;
  if (activeEl && state.inputs.includes(activeEl)) {
    return activeEl;
  }
  if (state.activeInput && state.inputs.includes(state.activeInput)) {
    return state.activeInput;
  }
  if (state.lastActiveInput && state.inputs.includes(state.lastActiveInput)) {
    return state.lastActiveInput;
  }
  return null;
}

function handleSuppressedInputKeydown(event, state) {
  if (!state) {
    return;
  }
  const input = event.currentTarget;
  if (!input || input.readOnly !== true) {
    return;
  }
  const key = event.key || '';
  if (key === 'Tab' || key.startsWith('Arrow') || key === 'Shift' || key === 'Meta' || key === 'Control' || key === 'Alt') {
    return;
  }
  if (key === 'Backspace' || key === 'Delete') {
    if (input.value) {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    event.preventDefault();
    return;
  }
  if (key.length !== 1) {
    return;
  }
  const cleaned = sanitizeInput(key);
  if (!cleaned) {
    return;
  }
  input.value = cleaned;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  event.preventDefault();
}

function handleLetterCardSelection(event, state, letter) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (!state || !letter) {
    return;
  }
  const targetInput = resolveActiveInput(state);
  if (!targetInput) {
    return;
  }
  const currentValue = sanitizeInput(targetInput.value || '');
  const cardInfo = state.letterCards.get(letter);
  const remainingAttr = cardInfo && cardInfo.card ? cardInfo.card.dataset.remaining : null;
  const remaining = remainingAttr ? Number.parseInt(remainingAttr, 10) : Number.NaN;
  const safeRemaining = Number.isNaN(remaining) ? 0 : remaining;
  if (safeRemaining <= 0 && currentValue !== letter) {
    return;
  }
  if (currentValue !== letter) {
    targetInput.value = letter;
    targetInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (typeof targetInput.focus === 'function') {
    try {
      targetInput.focus({ preventScroll: true });
    } catch (error) {
      targetInput.focus();
    }
  }
  if (typeof targetInput.select === 'function') {
    try {
      targetInput.select();
    } catch (error) {
      // no-op if selection fails
    }
  }
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

  if (cleaned && !timerIntervalId && !puzzleCompleted && !isRestoringProgress) {
    startTimer();
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
    if (prevChar) {
      puzzleCompleted = false;
      if (completionMessage) {
        completionMessage.style.display = 'none';
      }
    }
  }

  cell.dataset.prevChar = cleaned;
  updateLetterArrayUsage(state);
  checkForCompletion(state);

  if (!isRestoringProgress && !puzzleCompleted) {
    scheduleSaveActivePuzzle();
  }
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

function startTimer() {
  if (timerIntervalId || puzzleCompleted) {
    return;
  }

  timerPaused = false;
  timerStartTimestamp = Date.now();
  updateTimerDisplay();
  timerIntervalId = window.setInterval(updateTimerDisplay, 1000);
  updateTimerControls();
}

function stopTimer() {
  if (timerIntervalId) {
    clearInterval(timerIntervalId);
    timerIntervalId = null;
  }

  if (timerStartTimestamp) {
    const delta = Math.max(0, Math.floor((Date.now() - timerStartTimestamp) / 1000));
    timerAccumulatedSeconds += delta;
    timerStartTimestamp = 0;
  }

  updateTimerDisplay();
  updateTimerControls();
}

function resetTimerState() {
  stopTimer();
  timerStartTimestamp = 0;
  timerAccumulatedSeconds = 0;
  timerPaused = false;
  puzzleCompleted = false;

  if (timerText) {
    timerText.textContent = '00:00';
  }
  if (completionMessage) {
    completionMessage.style.display = 'none';
  }
  updateTimerControls();
}

function updateTimerDisplay() {
  if (!timerText) {
    return;
  }

  const elapsedSeconds = getCurrentElapsedSeconds();
  const minutes = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0');
  const seconds = String(elapsedSeconds % 60).padStart(2, '0');
  timerText.textContent = `${minutes}:${seconds}`;
}

function pauseActiveTimer({ silent = false } = {}) {
  if (timerIntervalId || timerStartTimestamp) {
    stopTimer();
  }
  if (!puzzleCompleted) {
    timerPaused = true;
  }
  if (!silent) {
    updateTimerControls();
  }
}

function updateTimerControls() {
  if (!pauseButton) {
    return;
  }

  if (puzzleCompleted) {
    pauseButton.disabled = true;
    pauseButton.classList.remove('is-paused', 'is-running');
    pauseButton.setAttribute('aria-label', 'Puzzle complete');
    return;
  }

  pauseButton.disabled = false;
  const running = Boolean(timerIntervalId);
  if (running) {
    pauseButton.classList.add('is-running');
    pauseButton.classList.remove('is-paused');
    pauseButton.setAttribute('aria-label', 'Pause timer');
  } else {
    pauseButton.classList.remove('is-running');
    pauseButton.classList.add('is-paused');
    pauseButton.setAttribute('aria-label', getCurrentElapsedSeconds() > 0 ? 'Resume timer' : 'Pause timer');
  }
}

function handlePauseButtonClick() {
  if (puzzleCompleted) {
    return;
  }

  if (timerIntervalId) {
    pauseActiveTimer();
    scheduleSaveActivePuzzle({ statusOverride: 'paused' });
    return;
  }

  const elapsed = getCurrentElapsedSeconds();
  if (timerPaused && elapsed > 0) {
    startTimer();
    scheduleSaveActivePuzzle();
    return;
  }

  timerPaused = true;
  updateTimerControls();
  scheduleSaveActivePuzzle({ statusOverride: 'paused' });
}

function checkForCompletion(state) {
  if (puzzleCompleted) {
    return;
  }

  if (isPuzzleSolved(state)) {
    puzzleCompleted = true;
    stopTimer();
    timerPaused = false;
    if (completionMessage) {
      completionMessage.style.display = 'inline';
    }
    updateTimerControls();
    scheduleSaveActivePuzzle({ statusOverride: 'complete' });
  }
}

function isPuzzleSolved(state) {
  if (!state || !state.rowCellGroups) {
    return false;
  }

  let hasCells = false;
  for (const rowCells of state.rowCellGroups) {
    for (const cell of rowCells) {
      hasCells = true;
      const target = cell.dataset.letter || '';
      const current = getCellValue(cell);
      if (!target || current !== target) {
        return false;
      }
    }
  }

  return hasCells;
}


function setupHowToPlayModal() {
  if (!howToPlayButton || !howToPlayModal) {
    return;
  }

  const closeTargets = Array.from(howToPlayModal.querySelectorAll('[data-close-modal]'));

  howToPlayButton.addEventListener('click', openHowToPlayModal);
  closeTargets.forEach((element) => {
    element.addEventListener('click', closeHowToPlayModal);
  });

  document.addEventListener('keydown', handleModalKeydown);
}

function openHowToPlayModal() {
  if (!howToPlayModal || isModalOpen()) {
    return;
  }

  lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  howToPlayModal.classList.add('is-open');
  howToPlayModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');

  const defaultFocus =
    howToPlayModal.querySelector('.modal-close') || howToPlayModal.querySelector('.modal-action');
  if (defaultFocus && typeof defaultFocus.focus === 'function') {
    defaultFocus.focus();
  }
}

function closeHowToPlayModal() {
  if (!howToPlayModal || !isModalOpen()) {
    return;
  }

  howToPlayModal.classList.remove('is-open');
  howToPlayModal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');

  if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
    lastFocusedElement.focus();
  }
  lastFocusedElement = null;
}

function isModalOpen() {
  return Boolean(howToPlayModal && howToPlayModal.classList.contains('is-open'));
}

function handleModalKeydown(event) {
  if (event.key === 'Escape' && isModalOpen()) {
    event.preventDefault();
    closeHowToPlayModal();
  }
}


function incrementMap(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

bootstrap();
