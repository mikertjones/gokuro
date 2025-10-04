const { Pool } = require('pg');

const ALLOWED_ORIGINS = new Set([
  'https://gokuro.net',
  'https://www.gokuro.net',
  'https://gokuro.github.io',
]);

const pool = new Pool(resolveConnectionConfig());

async function handler(req, res) {
  addCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const type = req.params?.type || req.query?.type;
  const { query, params, error } = buildQuery(type, req.query || {});

  if (!query) {
    return res.status(400).json({ error: error || 'Invalid request' });
  }

  try {
    const result = await pool.query(query, params);
    const rows = Array.isArray(result.rows) ? result.rows : [];

    const days = rows.map((row) => ({
      id: row.id,
      puzzle_date: serializeDate(row.puzzle_date),
      created_at: serializeDateTime(row.created_at),
      puzzle_data: serializePuzzleData(row.puzzle_data),
    }));

    return res.status(200).json({
      type,
      count: days.length,
      days,
    });
  } catch (dbError) {
    console.error('Database error:', dbError);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = handler;
module.exports.pool = pool;

function addCorsHeaders(req, res) {
  const origin = req.headers?.origin || '';
  const normalizedOrigin = typeof origin === 'string' ? origin.toLowerCase() : '';

  if (normalizedOrigin && ALLOWED_ORIGINS.has(normalizedOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  }
}

function resolveConnectionConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: shouldUseSSL() ? { rejectUnauthorized: false } : false,
    };
  }

  return {
    host: process.env.PGHOST || 'localhost',
    port: Number.parseInt(process.env.PGPORT || '5432', 10),
    user: process.env.PGUSER || 'postgresql',
    password: process.env.PGPASSWORD || 'eifion11',
    database: process.env.PGDATABASE || 'gokuro',
    ssl: shouldUseSSL() ? { rejectUnauthorized: false } : false,
  };
}

function shouldUseSSL() {
  const sslMode = (process.env.PGSSLMODE || process.env.NODE_ENV || '').toLowerCase();
  return sslMode === 'require' || sslMode === 'production';
}

function buildQuery(type, queryParams = {}) {
  switch (type) {
    case 'week': {
      const { startDate, endDate } = resolveWeekDateRange(queryParams);
      return {
        query: `
          SELECT id, puzzle_date, puzzle_data, created_at
          FROM gokuropuzzles
          WHERE puzzle_date BETWEEN $1 AND $2
          ORDER BY puzzle_date DESC
        `,
        params: [startDate, endDate],
      };
    }
    case 'today': {
      const { endDate } = resolveWeekDateRange(queryParams);
      return {
        query: `
          SELECT id, puzzle_date, puzzle_data, created_at
          FROM gokuropuzzles
          WHERE puzzle_date = $1
        `,
        params: [endDate],
      };
    }
    case 'latest': {
      const fallback = 7;
      const limit = Number.parseInt(queryParams.limit, 10);
      const boundedLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 31) : fallback;
      return {
        query: `
          SELECT id, puzzle_date, puzzle_data, created_at
          FROM gokuropuzzles
          ORDER BY puzzle_date DESC
          LIMIT $1
        `,
        params: [boundedLimit],
      };
    }
    default:
      return {
        query: null,
        params: [],
        error: 'Invalid type. Use: week, today, or latest',
      };
  }
}

function resolveWeekDateRange(queryParams = {}) {
  const explicitEnd =
    queryParams.end || queryParams.endDate || queryParams.to || queryParams.date || null;
  const now = getLocalNow();
  const end = normalizeDateValue(explicitEnd) || startOfDay(now);
  const start = new Date(end.getTime());
  start.setDate(start.getDate() - 6);

  return {
    startDate: formatDateISO(start),
    endDate: formatDateISO(end),
  };
}

function normalizeDateValue(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return startOfDay(value);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return startOfDay(parsed);
}

function startOfDay(date) {
  const copy = new Date(date.getTime());
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function formatDateISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function serializeDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return formatDateISO(value);
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return formatDateISO(parsed);
  }

  const str = String(value);
  const match = str.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : str;
}

function serializeDateTime(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

function serializePuzzleData(data) {
  if (data == null) {
    return null;
  }

  if (typeof data === 'string') {
    return data;
  }

  try {
    return JSON.stringify(data);
  } catch (error) {
    console.warn('Failed to stringify puzzle data', error);
    return null;
  }
}

function getLocalNow() {
  return new Date();
}
