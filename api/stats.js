// API endpoint for syncing user stats (personal best and streaks)
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    idleTimeoutMillis: 5000,
});

const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN || 'dev-u2bw4lxudhfznipt.uk.auth0.com';
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE || 'https://gokuro.vercel.app/api';

// Cache jose imports
let joseModule = null;

async function getJose() {
  if (!joseModule) {
    joseModule = await import('jose');
  }
  return joseModule;
}

async function verifyAuthToken(token) {
  try {
    const { createRemoteJWKSet, jwtVerify } = await getJose();
    const JWKS = createRemoteJWKSet(new URL(`https://${AUTH0_DOMAIN}/.well-known/jwks.json`));
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://${AUTH0_DOMAIN}/`,
      audience: AUTH0_AUDIENCE,
    });
    return payload.sub || null;
  } catch (e) {
    console.error('JWT verify failed:', e.message);
    return null;
  }
}

/**
 * Handles stats synchronization between client and server
 * POST body: { 
 *   grid_size: "5x5",
 *   stats: {
 *     best_time_seconds: 245,
 *     best_time_date: "2025-11-20T10:30:00Z",
 *     current_streak_days: 5,
 *     max_streak_days: 12,
 *     last_completed_date: "2025-11-20",
 *     max_streak_date: "2025-10-15"
 *   }
 * }
 * 
 * OR for bulk fetch:
 * GET with query param: ?grid_sizes=5x5,5x6,6x7,7x7
 */
module.exports = async (req, res) => {
    // CORS headers - allow requests from production and local development
    const allowedOrigins = [
        'https://gokuro.net',
        'https://192.168.0.25:3000',
        'http://localhost:3000',
        'https://localhost:3000'
    ];
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
        res.setHeader('Access-Control-Allow-Origin', 'https://gokuro.net');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Verify authentication
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid token format.' });
    }

    const token = authHeader.split(' ')[1];
    const auth_id = await verifyAuthToken(token);

    if (!auth_id) {
        return res.status(401).json({ error: 'Unauthorized: Invalid token.' });
    }

    let client;
    try {
        client = await pool.connect();

        // Ensure user exists
        const username = `user_${auth_id.substring(0, 8)}`;
        await client.query(
            `INSERT INTO users (auth_id, username)
             VALUES ($1, $2)
             ON CONFLICT (auth_id) DO NOTHING;`, 
            [auth_id, username]
        );

        // --- GET: Fetch stats for multiple grid sizes ---
        if (req.method === 'GET') {
            const gridSizes = req.query.grid_sizes 
                ? req.query.grid_sizes.split(',').map(s => s.trim())
                : ['5x5', '5x6', '6x7', '7x7'];

            const result = await client.query(
                `SELECT grid_size, best_time_seconds, best_time_date, 
                        current_streak_days, max_streak_days, 
                        last_completed_date, max_streak_date
                 FROM user_stats
                 WHERE auth_id = $1 AND grid_size = ANY($2)`,
                [auth_id, gridSizes]
            );

            // Build a map of grid_size -> stats
            const statsMap = {};
            for (const row of result.rows) {
                statsMap[row.grid_size] = {
                    grid_size: row.grid_size,
                    best_time_seconds: row.best_time_seconds,
                    best_time_date: row.best_time_date,
                    current_streak_days: row.current_streak_days,
                    max_streak_days: row.max_streak_days,
                    last_completed_date: row.last_completed_date,
                    max_streak_date: row.max_streak_date
                };
            }

            console.log(`[STATS-SYNC] Fetched stats for ${result.rows.length} grid sizes for user ${auth_id.substring(0, 8)}`);
            return res.status(200).json({ action: 'FETCHED', stats: statsMap });
        }

        // --- POST: Sync stats for a single grid size ---
        if (req.method === 'POST') {
            const { grid_size, stats } = req.body;

            if (!grid_size || !stats) {
                return res.status(400).json({ error: 'Missing grid_size or stats in request body' });
            }

            // Fetch existing stats from server
            const existingResult = await client.query(
                `SELECT grid_size, best_time_seconds, best_time_date, 
                        current_streak_days, max_streak_days, 
                        last_completed_date, max_streak_date
                 FROM user_stats
                 WHERE auth_id = $1 AND grid_size = $2`,
                [auth_id, grid_size]
            );

            const existingStats = existingResult.rows[0] || null;

            // Merge logic: Take the best of both
            const mergedStats = {
                grid_size: grid_size,
                best_time_seconds: null,
                best_time_date: null,
                current_streak_days: 0,
                max_streak_days: 0,
                last_completed_date: null,
                max_streak_date: null
            };

            // Personal Best: Take the faster time
            if (existingStats && existingStats.best_time_seconds !== null) {
                if (stats.best_time_seconds === null || existingStats.best_time_seconds < stats.best_time_seconds) {
                    mergedStats.best_time_seconds = existingStats.best_time_seconds;
                    mergedStats.best_time_date = existingStats.best_time_date;
                } else {
                    mergedStats.best_time_seconds = stats.best_time_seconds;
                    mergedStats.best_time_date = stats.best_time_date;
                }
            } else if (stats.best_time_seconds !== null) {
                mergedStats.best_time_seconds = stats.best_time_seconds;
                mergedStats.best_time_date = stats.best_time_date;
            }

            // Streaks: Take the most recent completion and recalculate
            const clientLastCompleted = stats.last_completed_date ? new Date(stats.last_completed_date) : null;
            const serverLastCompleted = existingStats?.last_completed_date ? new Date(existingStats.last_completed_date) : null;

            if (clientLastCompleted && serverLastCompleted) {
                // Take the most recent completion
                if (clientLastCompleted >= serverLastCompleted) {
                    mergedStats.current_streak_days = stats.current_streak_days;
                    mergedStats.last_completed_date = stats.last_completed_date;
                } else {
                    mergedStats.current_streak_days = existingStats.current_streak_days;
                    mergedStats.last_completed_date = existingStats.last_completed_date;
                }
            } else if (clientLastCompleted) {
                mergedStats.current_streak_days = stats.current_streak_days;
                mergedStats.last_completed_date = stats.last_completed_date;
            } else if (serverLastCompleted) {
                mergedStats.current_streak_days = existingStats.current_streak_days;
                mergedStats.last_completed_date = existingStats.last_completed_date;
            }

            // Max Streak: Take the higher value
            const clientMaxStreak = stats.max_streak_days || 0;
            const serverMaxStreak = existingStats?.max_streak_days || 0;
            if (clientMaxStreak > serverMaxStreak) {
                mergedStats.max_streak_days = stats.max_streak_days;
                mergedStats.max_streak_date = stats.max_streak_date;
            } else {
                mergedStats.max_streak_days = serverMaxStreak;
                mergedStats.max_streak_date = existingStats?.max_streak_date;
            }

            // Upsert merged stats
            await client.query(
                `INSERT INTO user_stats (
                    auth_id, grid_size, best_time_seconds, best_time_date,
                    current_streak_days, max_streak_days, last_completed_date, max_streak_date
                 )
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT (auth_id, grid_size) DO UPDATE SET
                    best_time_seconds = EXCLUDED.best_time_seconds,
                    best_time_date = EXCLUDED.best_time_date,
                    current_streak_days = EXCLUDED.current_streak_days,
                    max_streak_days = EXCLUDED.max_streak_days,
                    last_completed_date = EXCLUDED.last_completed_date,
                    max_streak_date = EXCLUDED.max_streak_date`,
                [
                    auth_id,
                    mergedStats.grid_size,
                    mergedStats.best_time_seconds,
                    mergedStats.best_time_date,
                    mergedStats.current_streak_days,
                    mergedStats.max_streak_days,
                    mergedStats.last_completed_date,
                    mergedStats.max_streak_date
                ]
            );

            console.log(`[STATS-SYNC] Synced stats for ${grid_size} for user ${auth_id.substring(0, 8)}`);
            return res.status(200).json({ 
                action: 'SYNCED', 
                merged_stats: mergedStats 
            });
        }

        return res.status(405).json({ error: 'Method Not Allowed' });

    } catch (error) {
        console.error('Stats sync error:', error);
        res.status(500).json({ error: 'Failed to sync stats', details: error.message });
    } finally {
        if (client) {
            client.release();
        }
    }
};

