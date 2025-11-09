// Bulk sync endpoint - fetches progress for multiple puzzles at once
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
 * Bulk sync endpoint - fetches progress for multiple puzzles
 * POST body: { puzzle_ids: ["2025-10-12-5x5", "2025-10-12-5x6", ...] }
 * Returns: { puzzles: { "2025-10-12-5x5": {...progress...}, ... } }
 */
module.exports = async (req, res) => {
    // CORS headers - allow requests from gokuro.net
    res.setHeader('Access-Control-Allow-Origin', 'https://gokuro.net');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // Verify authentication
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid token format.' });
    }

    const token = authHeader.split(' ')[1];
    const verifiedAuthId = await verifyAuthToken(token);

    if (!verifiedAuthId) {
        return res.status(401).json({ error: 'Unauthorized: Invalid token.' });
    }

    const auth_id = verifiedAuthId;
    const { puzzle_ids } = req.body;

    if (!Array.isArray(puzzle_ids) || puzzle_ids.length === 0) {
        return res.status(400).json({ error: 'Missing or invalid puzzle_ids array' });
    }

    let client;
    try {
        client = await pool.connect();

        // Fetch all matching progress records for this user and these puzzle_ids
        const result = await client.query(
            `
            SELECT puzzle_id, grid_size, elapsed_seconds, was_paused, progress_json, status, updated_at
            FROM user_progress
            WHERE auth_id = $1 AND puzzle_id = ANY($2)
            ORDER BY updated_at DESC
            `,
            [auth_id, puzzle_ids]
        );

        // Build a map of puzzle_id -> progress data
        const puzzles = {};
        for (const row of result.rows) {
            puzzles[row.puzzle_id] = {
                puzzle_id: row.puzzle_id,
                grid_size: row.grid_size,
                elapsed_seconds: row.elapsed_seconds,
                was_paused: row.was_paused,
                progress_json: row.progress_json,
                status: row.status,
                updated_at: row.updated_at
            };
        }

        console.log(`[BULK-SYNC] Fetched ${result.rows.length} puzzles for user ${auth_id.substring(0, 8)}`);

        return res.status(200).json({ puzzles });

    } catch (error) {
        console.error('Bulk sync error:', error);
        res.status(500).json({ error: 'Failed to fetch bulk progress', details: error.message });
    } finally {
        if (client) {
            client.release();
        }
    }
};


