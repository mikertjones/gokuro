// This file assumes a Vercel Node.js environment where you can use 'pg'
const { Pool } = require('pg');

// Vercel serverless functions should use an environment variable for connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL, 
    // Recommended for Serverless: Max 1 idle client, timeout after 5 seconds
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
 * Handles the sync request by saving the user's current game progress 
 * to the user_progress table in the Neon database.
 * @param {object} req - The Vercel request object.
 * @param {object} res - The Vercel response object.
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
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // ----------------------------------------------------------------------
    // STEP 1: SECURITY - VERIFY AUTHENTICATION TOKEN
    // ----------------------------------------------------------------------
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.warn('Attempted sync without Authorization header.');
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid token format.' });
    }

    const token = authHeader.split(' ')[1];
    const verifiedAuthId = await verifyAuthToken(token);

    if (!verifiedAuthId) {
        console.error('Token verification failed for incoming request.');
        return res.status(401).json({ error: 'Unauthorized: Invalid token.' });
    }
    
    // Use the verified ID for ALL database operations.
    const auth_id = verifiedAuthId; 

    // ----------------------------------------------------------------------
    // STEP 2: INPUT VALIDATION
    // ----------------------------------------------------------------------
    const { 
        puzzle_id, 
        grid_size, 
        elapsed_seconds, 
        was_paused, 
        progress_json, 
        status,
        immediate
    } = req.body;

    if (!puzzle_id || !grid_size || elapsed_seconds === undefined || !progress_json || !status) {
        return res.status(400).json({ error: 'Missing required progress fields.' });
    }

    let client;
    try {
        client = await pool.connect();

        // ----------------------------------------------------------------------
        // STEP 3: ENSURE USER EXISTS (UPSERT)
        // This uses ON CONFLICT DO NOTHING to insert the user if they're new.
        // ----------------------------------------------------------------------
        const username = `user_${auth_id.substring(0, 8)}`;
        await client.query(
            `INSERT INTO users (auth_id, username)
             VALUES ($1, $2)
             ON CONFLICT (auth_id) DO NOTHING;`, 
            [auth_id, username]
        );

        // ----------------------------------------------------------------------
        // STEP 4: INSERT PROGRESS RECORD (Log every save point)
        // ----------------------------------------------------------------------

        // STEP 4: LOAD-vs-SAVE (newest wins)
        const latestRes = await client.query(
          `
            SELECT id, puzzle_id, grid_size, elapsed_seconds, was_paused, progress_json, status, updated_at
            FROM user_progress
            WHERE auth_id = $1 AND puzzle_id = $2
            ORDER BY updated_at DESC
            LIMIT 1
          `,
          [auth_id, puzzle_id]
        );


        const latest = latestRes.rows[0] || null;
        // Detect if client actually has progress
        let clientHasProgress = false;
        try {
          const parsed = typeof progress_json === 'string' ? JSON.parse(progress_json) : (progress_json || {});
          const entries = parsed.entries || {};
          clientHasProgress = (Number(elapsed_seconds) > 0) || (Object.keys(entries).length > 0) || (status === 'complete');
        } catch {
          clientHasProgress = (Number(elapsed_seconds) > 0) || (status === 'complete');
        }

        // If client is empty and no matching (date+grid) record, load the user's most recent progress (any puzzle)
        // BUT only on non-immediate (startup) syncs to prevent LOADED loops on day changes
        if (!immediate && !latest && !clientHasProgress) {
          const anyLatestRes = await client.query(
            `
              SELECT id, puzzle_id, grid_size, elapsed_seconds, was_paused, progress_json, status, updated_at
              FROM user_progress
              WHERE auth_id = $1
              ORDER BY updated_at DESC
              LIMIT 1
            `,
            [auth_id]
          );
          const anyLatest = anyLatestRes.rows[0] || null;
          if (anyLatest) {
            return res.status(200).json({
              action: 'LOADED',
              latest_progress: {
                puzzle_id: anyLatest.puzzle_id,
                grid_size: anyLatest.grid_size,
                elapsed_seconds: anyLatest.elapsed_seconds,
                was_paused: anyLatest.was_paused,
                progress_json: anyLatest.progress_json,
                status: anyLatest.status,
                updated_at: anyLatest.updated_at
              }
            });
          }
        }

        // Use client_updated_at only if clientHasProgress
        const clientUpdatedAtIso = req.body.client_updated_at || null;
        const clientUpdatedAt = (clientHasProgress && clientUpdatedAtIso) ? new Date(clientUpdatedAtIso) : null;

        // Decide whether server data is newer
        const serverUpdatedAt = latest ? new Date(latest.updated_at) : null;

        // Special case: if this is an immediate sync with no client progress,
        // just acknowledge without saving or loading (user is navigating to empty puzzle)
        if (immediate && !clientHasProgress) {
          console.log(`[SYNC] Immediate sync with no progress for ${puzzle_id} - returning no-op SAVED`);
          return res.status(200).json({
            action: 'SAVED',
            log_id: null,
            note: 'No progress to save on navigation'
          });
        }

        let clientIsNewer;
        if (!latest) {
          clientIsNewer = true;                 // nothing on server → save
        } else if (!clientHasProgress) {
          // Client is empty and this is a non-immediate (startup) sync → load server
          clientIsNewer = false;
        } else {
          clientIsNewer = !!(clientUpdatedAt && serverUpdatedAt && serverUpdatedAt < clientUpdatedAt);
        }


        if (latest && !clientIsNewer) {
          // Server is newer → LOAD
          console.log(`[SYNC] Server data newer for ${puzzle_id} - returning LOADED (immediate: ${immediate})`);
          return res.status(200).json({
            action: 'LOADED',
            latest_progress: {
              puzzle_id: latest.puzzle_id,
              grid_size: latest.grid_size,
              elapsed_seconds: latest.elapsed_seconds,
              was_paused: latest.was_paused,
              progress_json: latest.progress_json,
              status: latest.status,
              updated_at: latest.updated_at
            }
          });
        }

        // Client is newer (or no server record) → SAVE
        const completedAt = status === 'complete'
          ? new Date().toISOString().substring(0, 10)
          : null;

        const upsertRes = await client.query(
          `
            INSERT INTO user_progress (
              auth_id, puzzle_id, grid_size, elapsed_seconds, was_paused, progress_json, status, completed_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            ON CONFLICT (auth_id, puzzle_id) DO UPDATE SET
              grid_size     = EXCLUDED.grid_size,
              elapsed_seconds = EXCLUDED.elapsed_seconds,
              was_paused    = EXCLUDED.was_paused,
              progress_json = EXCLUDED.progress_json,
              status        = EXCLUDED.status,
              completed_at  = EXCLUDED.completed_at,
              updated_at    = NOW()
            RETURNING id;
          `,
          [
            auth_id,
            puzzle_id,
            grid_size,
            elapsed_seconds,
            was_paused,
            progress_json,
            status,
            completedAt
          ]
        );

        return res.status(200).json({
          action: 'SAVED',
          log_id: upsertRes.rows[0].id
        });


    } catch (error) {
        console.error('Database Transaction Error:', error);
        res.status(500).json({ error: 'Failed to complete database operation.', details: error.message });
    } finally {
        if (client) {
            client.release();
        }
    }
};
