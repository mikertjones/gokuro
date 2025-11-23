// === Gokuro User Authentication and Synchronization Logic (user.js) ===
// 
// This file handles:
// 1. Initializing Auth0 with a guaranteed timing loop (waitForAuth0Client).
// 2. Handling login/logout/callback processing.
// 3. Exposing a debounced sync function (window.syncProgress) for frequent saves.
// 4. Exposing immediate sync functions (window.syncOnPause, window.syncOnNewPuzzle) for critical saves.
// 5. Communicating with the Vercel Serverless API (/api/sync) for saving and loading data.
// 
// ----------------------------------------------------------------------

// --- 1. CONFIGURATION (REPLACE WITH YOUR VALUES) ---
const AUTH0_DOMAIN = 'dev-u2bw4lxudhfznipt.uk.auth0.com'; // e.g., 'gokuro.us.auth0.com'
const AUTH0_CLIENT_ID = 'nKOIppPLesXPhRBrPlipViNp9LDGsgV6';
const AUTH0_AUDIENCE = 'https://gokuro.vercel.app/api'; // e.g., 'https://api.gokuro.com'

// --- 2. DEBOUNCE UTILITY ---
/**
 * Debounces a function, ensuring it is only called after wait milliseconds
 * since the last time it was invoked.
 * @param {function} func The function to debounce.
 * @param {number} wait The number of milliseconds to wait.
 * @returns {function} The debounced function.
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const context = this;
        const later = () => {
            timeout = null;
            func.apply(context, args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// --- 3. STATE AND CLIENT ---
let auth0Client = null;
let currentUserId = null;
let hasLoadedInitialProgress = false; // Track if we've done the startup restore
let isInitializing = false; // Track if we're in the initial load phase (before first bulk sync)
const statusElement = document.getElementById('statusMessage');
const authButton = document.getElementById('auth-btn');

// --- 4. GAME DATA ACCESS (Relies on functions exposed by app.js) ---

/**
 * Gets the current game state from the main application logic (app.js).
 * @returns {object} The game state object for syncing.
 */
function getLocalProgressData() {
    // This function MUST be defined in app.js and return the data object
    if (typeof window.getCurrentGameState === 'function') {
        return window.getCurrentGameState();
    }
    console.error('getCurrentGameState() not found in app.js!');
    return { error: 'No game state function.' };
}

/**
 * Applies the loaded game state to the main application logic (app.js).
 * @param {object} data The game state object loaded from the cloud.
 */
function applyLoadedGameState(data) {
    // This function MUST be defined in app.js
    if (typeof window.applyLoadedGameState === 'function') {
        window.applyLoadedGameState(data);
    } else {
        console.error('applyLoadedGameState() not found in app.js!');
    }
}


// --- 5. UI UPDATES ---

function updateUI(isAuthenticated, userId) {
    if (authButton) {
        authButton.textContent = isAuthenticated ? 'Logout' : 'Login (Sync)';
        authButton.onclick = handleAuth;
    }
    
    if (isAuthenticated) {
        currentUserId = userId;
        statusElement.textContent = `User: ${userId.substring(0, 15)}... | Status: Ready`;
        statusElement.className = 'text-center h-4 text-xs mt-1 text-green-600';
    } else {
        currentUserId = null;
        statusElement.textContent = 'Login to sync your progress with other devices.';
        statusElement.className = 'text-center h-4 text-xs mt-1 text-gray-600';
    }
}


// --- 6. AUTHENTICATION HANDLERS ---

/**
 * Initializes the Auth0 client and checks for an active session.
 */
async function initializeAuth0() {
    // Reset flags on page load to ensure fresh sync
    hasLoadedInitialProgress = false;
    isInitializing = false;
    
    try {
        // CORRECTED: Must use the 'auth0.' namespace prefix
        auth0Client = await auth0.createAuth0Client({
            domain: AUTH0_DOMAIN,
            clientId: AUTH0_CLIENT_ID,
            authorizationParams: {
                redirect_uri: window.location.origin,
                audience: AUTH0_AUDIENCE
            },
            useRefreshTokens: true,
            cacheLocation: 'localstorage'
        });

        // Handle the redirect after login
        if (window.location.search.includes('code=')) {
            const { appState } = await auth0Client.handleRedirectCallback();
            console.log('Redirect handled. App state:', appState);
            // Clean up the URL
            window.history.replaceState({}, document.title, window.location.pathname);
        }

        const isAuthenticated = await auth0Client.isAuthenticated();
        const user = isAuthenticated ? await auth0Client.getUser() : null;
        
        console.log('[initializeAuth0] isAuthenticated:', isAuthenticated, 'user:', user?.sub);
        
        updateUI(isAuthenticated, user ? user.sub : null);
        
        if (isAuthenticated) {
            // Set initializing flag immediately to prevent timestamp updates during restoration
            isInitializing = true;
            console.log('[initializeAuth0] User authenticated, calling scheduleFirstSync...');
            // After successful login or page refresh, sync all puzzles
            scheduleFirstSync();
        } else {
            console.log('[initializeAuth0] User not authenticated, skipping sync');
        }
        
    } catch (error) {
        console.error('Auth0 Initialization Error:', error);
        updateUI(false, null);
    }
}

function scheduleFirstSync(retry = 0) {
    try {
        // Check if app.js is ready by seeing if we can get game state
        const gs = getLocalProgressData();
        
        // Also check if weekly puzzles are loaded
        const puzzleIds = typeof window.getAllWeeklyPuzzleIds === 'function' 
            ? window.getAllWeeklyPuzzleIds() 
            : [];
        
        console.log(`[scheduleFirstSync] Retry ${retry}: gs =`, gs ? `puzzle_id: ${gs.puzzle_id}` : 'null', `puzzleIds.length = ${puzzleIds.length}`);
        
        if (gs && gs.puzzle_id && puzzleIds.length > 0) {
            // App is ready AND weekly puzzles are loaded - do bulk sync
            console.log('[scheduleFirstSync] App ready with puzzles loaded, starting bulk sync...');
            bulkSyncAllPuzzles();
            return;
        }
    } catch (e) {
        console.log(`[scheduleFirstSync] Error on retry ${retry}:`, e.message);
    }
    // App not ready yet, retry
    if (retry < 20) {
        setTimeout(() => scheduleFirstSync(retry + 1), 250); // up to ~5s
    } else {
        console.warn('[scheduleFirstSync] Gave up after 5s - app.js may not be ready or no puzzles loaded');
    }
}

/**
 * Handles the click event for the Login/Logout button.
 */
async function handleAuth() {
    if (!auth0Client) return;

    if (await auth0Client.isAuthenticated()) {
        // Logout
        hasLoadedInitialProgress = false; // Reset flag on logout
        await auth0Client.logout({
            logoutParams: {
                returnTo: window.location.origin
            }
        });
    } else {
        // Login
        await auth0Client.loginWithRedirect();
    }
}

// --- 7. SYNCHRONIZATION LOGIC ---

/**
 * Bulk sync all puzzles for the current week (up to 28 puzzles)
 * Fetches remote progress for all puzzles and updates local IndexedDB
 */
// Flag to prevent concurrent bulk syncs
let isBulkSyncing = false;
// Expose to app.js so it can check before saving/syncing
window.isBulkSyncing = () => isBulkSyncing;
window.isInitializing = () => isInitializing;

async function bulkSyncAllPuzzles() {
    if (!currentUserId || !auth0Client) {
        console.log('Bulk sync skipped: User not authenticated.');
        return;
    }

    // Prevent concurrent bulk syncs
    if (isBulkSyncing) {
        console.log('[BULK-SYNC] Already syncing, skipping...');
        return;
    }

    // Get all puzzle_ids for the current week from app.js
    if (typeof window.getAllWeeklyPuzzleIds !== 'function') {
        console.error('getAllWeeklyPuzzleIds() not found in app.js!');
        return;
    }

    const puzzleIds = window.getAllWeeklyPuzzleIds();
    if (!puzzleIds || puzzleIds.length === 0) {
        console.log('No puzzles to sync');
        return;
    }

    isBulkSyncing = true;
    console.log(`[BULK-SYNC] Starting bulk sync for ${puzzleIds.length} puzzles...`);
    statusElement.textContent = `Syncing ${puzzleIds.length} puzzles...`;
    statusElement.className = 'text-center h-4 text-xs mt-1 text-blue-600';

    try {
        const token = await auth0Client.getTokenSilently({
            authorizationParams: { audience: AUTH0_AUDIENCE },
        });

        const response = await fetch('https://gokuro.vercel.app/api/sync-bulk', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ puzzle_ids: puzzleIds }),
        });

        const result = await response.json();

        if (response.ok) {
            const remotePuzzles = result.puzzles || {};
            let downloadedCount = 0;
            let uploadedCount = 0;

            // Track if the currently active puzzle was updated (downloaded OR uploaded)
            let currentPuzzleUpdated = false;
            let currentPuzzleDownloaded = false;
            const currentPuzzleId = typeof window.getCurrentGameState === 'function' 
                ? window.getCurrentGameState()?.puzzle_id 
                : null;

            // For each of the 28 puzzles, sync bidirectionally
            for (const puzzleId of puzzleIds) {
                try {
                    // Get local data from IndexedDB
                    const localData = await getLocalPuzzleData(puzzleId);
                    const remoteData = remotePuzzles[puzzleId];

                    const remoteUpdatedAt = remoteData?.updated_at ? new Date(remoteData.updated_at).getTime() : 0;
                    const localUpdatedAt = localData?.updatedAt || 0;

                    // Check if local has any actual progress
                    const localHasProgress = localData && (
                        (localData.entries && Object.keys(localData.entries).length > 0) ||
                        (localData.elapsedSeconds > 0) ||
                        (localData.status === 'complete')
                    );

                    // Debug logging for timestamp comparison
                    if (remoteData || localHasProgress) {
                        const remoteDate = remoteUpdatedAt ? new Date(remoteUpdatedAt).toISOString() : 'none';
                        const localDate = localUpdatedAt ? new Date(localUpdatedAt).toISOString() : 'none';
                        const diff = remoteUpdatedAt && localUpdatedAt ? Math.round((localUpdatedAt - remoteUpdatedAt) / 1000) : 0;
                        console.log(`[BULK-SYNC] ${puzzleId}:`);
                        console.log(`  Remote: ${remoteDate} (${remoteUpdatedAt})`);
                        console.log(`  Local:  ${localDate} (${localUpdatedAt})`);
                        console.log(`  Diff:   ${diff}s (local ${diff > 0 ? 'newer' : 'older'})`);
                        
                        // DEBUG: Log what we received from server
                        if (remoteData) {
                            const parsed = typeof remoteData.progress_json === 'string'
                                ? JSON.parse(remoteData.progress_json)
                                : (remoteData.progress_json || {});
                            console.log(`  Server sent: ${Object.keys(parsed.entries || {}).length} entries:`, parsed.entries);
                        }
                    }

                    let wasDownloaded = false;

                    if (!remoteData && localHasProgress) {
                        // Local has progress but server doesn't → Upload to server
                        await uploadPuzzleToServer(puzzleId, localData, token);
                        uploadedCount++;
                        console.log(`[BULK-SYNC] ↑ Uploaded ${puzzleId} to server (no remote)`);
                    } else if (remoteData) {
                        // Server has data → ALWAYS download it (trust server as source of truth)
                        // This prevents stale local timestamps from causing wrong uploads
                        await updateLocalPuzzleData(puzzleId, remoteData);
                        downloadedCount++;
                        wasDownloaded = true;
                        const reason = !localHasProgress ? 'local empty' : 
                                      remoteUpdatedAt > localUpdatedAt ? `remote newer: ${Math.round((remoteUpdatedAt - localUpdatedAt) / 1000)}s` :
                                      `server data (avoiding timestamp issues)`;
                        console.log(`[BULK-SYNC] ↓ Downloaded ${puzzleId} from server (${reason})`);
                    }

                    // Check if this was the currently active puzzle
                    if (puzzleId === currentPuzzleId) {
                        if (wasDownloaded) {
                            currentPuzzleUpdated = true;
                            currentPuzzleDownloaded = true;
                        } else {
                            currentPuzzleUpdated = true;
                        }
                    }
                } catch (err) {
                    console.error(`Failed to sync ${puzzleId}:`, err);
                }
            }

            console.log(`[BULK-SYNC] Complete: ${downloadedCount} downloaded, ${uploadedCount} uploaded`);
            statusElement.textContent = `✅ Synced ${puzzleIds.length} puzzles (↓${downloadedCount} ↑${uploadedCount})`;
            statusElement.className = 'text-center h-4 text-xs mt-1 text-green-600';

            // Refresh the UI to show updated status indicators
            if (typeof window.refreshButtonStatusesForActiveDay === 'function') {
                window.refreshButtonStatusesForActiveDay();
            }

            // If the currently active puzzle was downloaded, ALWAYS reload it
            // (even if local seemed newer - trust the server's version we just fetched)
            if (currentPuzzleDownloaded && currentPuzzleId) {
                console.log(`[BULK-SYNC] Reloading current puzzle from server: ${currentPuzzleId}`);
                
                // Small delay to ensure IndexedDB write has completed
                await new Promise(resolve => setTimeout(resolve, 100));
                
                if (typeof window.applyLoadedGameState === 'function') {
                    const updatedData = await getLocalPuzzleData(currentPuzzleId);
                    if (updatedData) {
                        console.log(`[BULK-SYNC] Loaded data from IndexedDB:`, {
                            entries: Object.keys(updatedData.entries || {}).length + ' entries',
                            status: updatedData.status,
                            elapsedSeconds: updatedData.elapsedSeconds
                        });
                        // Convert IndexedDB format to the format expected by applyLoadedGameState
                        const loadData = {
                            puzzle_id: currentPuzzleId,
                            grid_size: currentPuzzleId.split('-').pop(), // Extract grid size from puzzle_id
                            elapsed_seconds: updatedData.elapsedSeconds || 0,
                            status: updatedData.status || 'not-started',
                            progress_json: JSON.stringify({
                                entries: updatedData.entries || {},
                                storageKey: currentPuzzleId,
                                updatedAt: updatedData.updatedAt || Date.now()
                            })
                        };
                        console.log(`[BULK-SYNC] Calling applyLoadedGameState...`);
                        await window.applyLoadedGameState(loadData);
                        console.log(`[BULK-SYNC] ✅ Current puzzle reloaded from server`);
                    } else {
                        console.warn(`[BULK-SYNC] No data found in IndexedDB for ${currentPuzzleId}`);
                    }
                } else {
                    console.error(`[BULK-SYNC] applyLoadedGameState function not found!`);
                }
            }

            // Mark that we've done the initial load
            hasLoadedInitialProgress = true;

            // After puzzle sync completes, sync stats
            console.log('[BULK-SYNC] Starting stats sync...');
            await bulkSyncAllStats();

        } else {
            throw new Error(result.error || `Server responded with status ${response.status}`);
        }

    } catch (error) {
        console.error('Bulk sync failed:', error);
        statusElement.textContent = `❌ Bulk sync failed: ${String(error.message || error)}`.slice(0, 120);
        statusElement.className = 'text-center h-4 text-xs mt-1 text-red-600';
    } finally {
        // Keep isBulkSyncing=true for a bit longer to block any debounced syncs
        // that might have been triggered by applyLoadedGameState UI updates
        setTimeout(() => {
            isBulkSyncing = false;
            isInitializing = false;
            console.log('[BULK-SYNC] Sync guards released');
        }, 500); // 500ms should be enough for debounced syncs to be blocked
    }
}

/**
 * Gets puzzle data from local IndexedDB
 */
async function getLocalPuzzleData(puzzleId) {
    if (typeof window.getPuzzleProgressRecord === 'function') {
        return await window.getPuzzleProgressRecord(puzzleId);
    }
    return null;
}

/**
 * Updates local IndexedDB with remote puzzle data
 */
async function updateLocalPuzzleData(puzzleId, remoteData) {
    if (typeof window.savePuzzleProgressRecord !== 'function') {
        return;
    }

    const parsed = typeof remoteData.progress_json === 'string'
        ? JSON.parse(remoteData.progress_json)
        : (remoteData.progress_json || {});

    const recordToSave = {
        id: puzzleId,
        status: remoteData.status || 'not-started',
        entries: parsed.entries || {},
        elapsedSeconds: remoteData.elapsed_seconds || 0,
        updatedAt: new Date(remoteData.updated_at).getTime()
    };

    console.log(`[updateLocalPuzzleData] Saving to IndexedDB:`, {
        puzzleId,
        entriesCount: Object.keys(recordToSave.entries).length,
        entries: recordToSave.entries,
        status: recordToSave.status
    });

    await window.savePuzzleProgressRecord(recordToSave);
    
    // Verify it was saved correctly
    const verification = await window.getPuzzleProgressRecord(puzzleId);
    console.log(`[updateLocalPuzzleData] Verification read from IndexedDB:`, {
        puzzleId,
        entriesCount: verification ? Object.keys(verification.entries || {}).length : 0,
        entries: verification?.entries
    });
}

/**
 * Uploads local puzzle data to server
 * IMPORTANT: Uses localData.updatedAt which is the UTC timestamp (milliseconds since epoch)
 * from when this puzzle was last modified locally OR last synced from server
 */
async function uploadPuzzleToServer(puzzleId, localData, token) {
    // Parse puzzle_id to get grid_size (format: "2025-10-12-5x5")
    const parts = puzzleId.split('-');
    const grid_size = parts[parts.length - 1] || 'unknown';

    // Use the stored updatedAt timestamp (UTC milliseconds)
    // This ensures we're comparing the actual last-modified time, not "now"
    const timestamp = localData.updatedAt || Date.now();

    const payload = {
        puzzle_id: puzzleId,
        grid_size: grid_size,
        elapsed_seconds: localData.elapsedSeconds || 0,
        was_paused: localData.status === 'paused',
        progress_json: JSON.stringify({
            entries: localData.entries || {},
            storageKey: puzzleId,
            updatedAt: timestamp
        }),
        status: localData.status || 'not-started',
        client_updated_at: new Date(timestamp).toISOString(),
        immediate: false // This is a bulk sync, not immediate
    };

    const response = await fetch('https://gokuro.vercel.app/api/sync', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Upload failed for ${puzzleId}`);
    }

    return await response.json();
}

/**
 * Performs the actual API call to the Vercel sync endpoint.
 * This function handles both saving (POST) and loading (GET).
 * @param {boolean} isImmediate Whether this is a critical, non-debounced save.
 * @param {boolean} isInitialLoad Whether this is the first sync after login (allows cross-puzzle LOAD).
 */
async function syncProgressLogic(isImmediate, isInitialLoad = false) {
    if (!self || !auth0Client || !currentUserId) {
        console.log('Sync skipped: User not authenticated or app not ready.');
        return;
    }

    // Don't sync individual puzzles while bulk sync is running
    if (isBulkSyncing) {
        console.log('Sync skipped: Bulk sync in progress.');
        return;
    }

    // Don't sync before initial bulk sync completes
    if (!hasLoadedInitialProgress) {
        console.log('Sync skipped: Waiting for initial bulk sync to complete.');
        return;
    }

    // Get the current game state from app.js
    const data = getLocalProgressData && typeof getLocalProgressData === 'function'
        ? getLocalProgressData()
        : null;

    if (!data || data.error) {
        // app.js not ready yet
        return;
    }

    // Require a real puzzle key
    if (!data.puzzle_id || data.puzzle_id === 'unknown') {
        return;
    }
    
    // Store the current puzzle_id so we can check if LOADED response matches
    const currentPuzzleId = data.puzzle_id;

    // If this is an immediate "pause" sync but there is no progress at all,
    // don't hit the server (prevents creating a pointless not-started record
    // and prevents LOADED loops on day switches).
    let hasProgress = false;
    try {
        const parsed = typeof data.progress_json === 'string'
            ? JSON.parse(data.progress_json || '{}')
            : (data.progress_json || {});
        const hasEntries = !!(parsed && parsed.entries && Object.keys(parsed.entries).length);
        const hasTime = !!data.elapsed_seconds;
        const isComplete = data.status === 'complete';
        hasProgress = hasEntries || hasTime || isComplete;
    } catch (_) {
        // if parse fails, treat as no progress
        hasProgress = false;
    }

    if (isImmediate && !hasProgress) {
        // Nothing to save on an immediate call (pause/day-change with empty grid)
        return;
    }

    const token = await auth0Client.getTokenSilently({
        authorizationParams: { audience: AUTH0_AUDIENCE },
    });

    const syncStatusText = isImmediate ? 'Immediate Syncing...' : 'Auto-Syncing...';
    statusElement.textContent = syncStatusText;
    statusElement.className = 'text-center h-4 text-xs mt-1 text-blue-600';

    try {
        const payload = {
            auth_id: currentUserId,
            token,
            ...data,
            immediate: !!isImmediate,
        };

        const res = await fetch('https://gokuro.vercel.app/api/sync', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload),
        });
        const result = await res.json();

        if (res.ok) {
            if (result.action === 'LOADED') {
                const loadedPuzzleId = result.latest_progress?.puzzle_id;
                
                // Re-check current puzzle_id in case it changed during the async sync
                const nowData = getLocalProgressData && typeof getLocalProgressData === 'function'
                    ? getLocalProgressData()
                    : null;
                const nowPuzzleId = nowData?.puzzle_id || currentPuzzleId;
                
                // Only apply LOADED if:
                // 1. This is the initial load after login (can switch puzzles), OR
                // 2. The loaded data is for the same puzzle we're currently viewing
                const shouldApplyLoad = isInitialLoad || (loadedPuzzleId === nowPuzzleId);
                
                if (shouldApplyLoad) {
                    applyLoadedGameState && applyLoadedGameState(result.latest_progress);
                    statusElement.textContent = '✅ Load Complete. Game progress restored.';
                    hasLoadedInitialProgress = true; // Mark that we've done the initial load
                } else {
                    // Server has newer data for a different puzzle - ignore it
                    console.log(`Ignoring LOADED for different puzzle: ${loadedPuzzleId} (current was: ${currentPuzzleId}, now: ${nowPuzzleId})`);
                    statusElement.textContent = '✅ Sync checked (no changes needed).';
                }
            } else {
                const at = new Date().toISOString().slice(11, 19);
                statusElement.textContent = `✅ Auto-Save Complete @ ${at}`;
            }
            console.log('Sync successful:', result);
            statusElement.className = 'text-center h-4 text-xs mt-1 text-green-600';
        } else {
            throw new Error(result.error || `Server responded with status ${res.status}`);
        }
    } catch (err) {
        console.error('Synchronization failed:', err);
        statusElement.textContent = `❌ Sync Failed: ${String(err.message || err)}`.slice(0, 120);
        statusElement.className = 'text-center h-4 text-xs mt-1 text-red-600';
    }
}
// --- 8. STATS SYNCHRONIZATION ---

/**
 * Bulk fetches all stats from the server and merges with local stats
 * Called after login/authentication
 */
async function bulkSyncAllStats() {
    if (!currentUserId || !auth0Client) {
        console.log('Stats sync skipped: User not authenticated.');
        return;
    }

    console.log('[STATS-SYNC] Starting bulk stats sync...');

    try {
        const token = await auth0Client.getTokenSilently({
            authorizationParams: { audience: AUTH0_AUDIENCE },
        });

        const gridSizes = ['5x5', '5x6', '6x7', '7x7'];
        const response = await fetch(`https://gokuro.vercel.app/api/stats?grid_sizes=${gridSizes.join(',')}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const result = await response.json();

        if (response.ok && result.action === 'FETCHED') {
            const remoteStats = result.stats || {};
            
            // Get local stats
            const localStatsMap = typeof window.getAllStatsFromStorage === 'function' 
                ? window.getAllStatsFromStorage() 
                : {};

            // Merge stats for each grid size
            let syncedCount = 0;
            for (const gridSize of gridSizes) {
                const remoteData = remoteStats[gridSize];
                const localData = localStatsMap[gridSize];

                // Merge logic: Take the best of both
                const mergedStats = mergeStats(localData, remoteData);

                // Save merged stats locally
                if (typeof window.saveStatsForGrid === 'function') {
                    window.saveStatsForGrid(gridSize, mergedStats);
                    syncedCount++;
                }

                // If remote was missing or inferior, push to server
                if (!remoteData || statsNeedServerUpdate(mergedStats, remoteData)) {
                    await uploadStatsToServer(gridSize, mergedStats, token);
                }
            }

            console.log(`[STATS-SYNC] Complete: Synced ${syncedCount} grid sizes`);

            // Refresh the UI for current grid
            if (typeof window.displayStatsForGrid === 'function' && typeof window.getCurrentGameState === 'function') {
                const currentState = window.getCurrentGameState();
                if (currentState && currentState.puzzle_id) {
                    const parts = currentState.puzzle_id.split('-');
                    const gridSize = parts[parts.length - 1];
                    window.displayStatsForGrid(gridSize);
                }
            }

        } else {
            console.error('Failed to fetch stats:', result.error);
        }

    } catch (error) {
        console.error('Bulk stats sync failed:', error);
    }
}

/**
 * Merges local and remote stats, taking the best of both
 * @param {object} local - Local stats object
 * @param {object} remote - Remote stats object from server
 * @returns {object} Merged stats
 */
function mergeStats(local, remote) {
    console.log('[STATS-MERGE] Input:', { local, remote });
    
    // Handle cases where local or remote might be undefined or null
    const localData = local || {};
    const remoteData = remote || {};
    
    const merged = {
        grid_size: localData.grid_size || remoteData.grid_size || 'unknown',
        best_time_seconds: null,
        best_time_date: null,
        current_streak_days: 0,
        max_streak_days: 0,
        last_completed_date: null,
        max_streak_date: null
    };

    // Personal Best: Take the faster time
    if (localData.best_time_seconds !== null && localData.best_time_seconds !== undefined &&
        remoteData.best_time_seconds !== null && remoteData.best_time_seconds !== undefined) {
        if (localData.best_time_seconds < remoteData.best_time_seconds) {
            merged.best_time_seconds = localData.best_time_seconds;
            merged.best_time_date = localData.best_time_date;
        } else {
            merged.best_time_seconds = remoteData.best_time_seconds;
            merged.best_time_date = remoteData.best_time_date;
        }
    } else if (localData.best_time_seconds !== null && localData.best_time_seconds !== undefined) {
        merged.best_time_seconds = localData.best_time_seconds;
        merged.best_time_date = localData.best_time_date;
    } else if (remoteData.best_time_seconds !== null && remoteData.best_time_seconds !== undefined) {
        merged.best_time_seconds = remoteData.best_time_seconds;
        merged.best_time_date = remoteData.best_time_date;
    }

    // Streaks: Take the most recent completion
    const localLast = localData.last_completed_date ? new Date(localData.last_completed_date) : null;
    const remoteLast = remoteData.last_completed_date ? new Date(remoteData.last_completed_date) : null;

    if (localLast && remoteLast) {
        if (localLast >= remoteLast) {
            merged.current_streak_days = localData.current_streak_days;
            merged.last_completed_date = localData.last_completed_date;
        } else {
            merged.current_streak_days = remoteData.current_streak_days;
            merged.last_completed_date = remoteData.last_completed_date;
        }
    } else if (localLast) {
        merged.current_streak_days = localData.current_streak_days;
        merged.last_completed_date = localData.last_completed_date;
    } else if (remoteLast) {
        merged.current_streak_days = remoteData.current_streak_days;
        merged.last_completed_date = remoteData.last_completed_date;
    }

    // Max Streak: Take the higher value
    const localMax = localData.max_streak_days || 0;
    const remoteMax = remoteData.max_streak_days || 0;
    if (localMax > remoteMax) {
        merged.max_streak_days = localData.max_streak_days;
        merged.max_streak_date = localData.max_streak_date;
    } else {
        merged.max_streak_days = remoteMax;
        merged.max_streak_date = remoteData.max_streak_date;
    }

    console.log('[STATS-MERGE] Output:', merged);
    return merged;
}

/**
 * Checks if merged stats need to be pushed to server
 * @param {object} merged - Merged stats
 * @param {object} remote - Current remote stats
 * @returns {boolean} True if server needs update
 */
function statsNeedServerUpdate(merged, remote) {
    if (!remote) return true; // No remote data, need to push

    // Check if any field is different
    if (merged.best_time_seconds !== remote.best_time_seconds) return true;
    if (merged.current_streak_days !== remote.current_streak_days) return true;
    if (merged.max_streak_days !== remote.max_streak_days) return true;
    if (merged.last_completed_date !== remote.last_completed_date) return true;

    return false;
}

/**
 * Uploads stats to server
 * @param {string} gridSize - e.g., "5x5"
 * @param {object} stats - Stats object to upload
 * @param {string} token - Auth token
 */
async function uploadStatsToServer(gridSize, stats, token) {
    try {
        const response = await fetch('https://gokuro.vercel.app/api/stats', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ 
                grid_size: gridSize,
                stats: stats
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || `Stats upload failed for ${gridSize}`);
        }

        const result = await response.json();
        console.log(`[STATS-SYNC] ↑ Uploaded stats for ${gridSize}`);
        
        // If server returned merged stats, update local with the merge
        if (result.action === 'SYNCED' && result.merged_stats) {
            if (typeof window.saveStatsForGrid === 'function') {
                window.saveStatsForGrid(gridSize, result.merged_stats);
            }
        }

        return result;

    } catch (error) {
        console.error(`Failed to upload stats for ${gridSize}:`, error);
    }
}

/**
 * Syncs a single grid's stats to server (called from stats.js after completion)
 * @param {string} gridSize - e.g., "5x5"
 * @param {object} stats - Stats object to sync
 */
async function syncStatsToServer(gridSize, stats) {
    if (!currentUserId || !auth0Client) {
        console.log('Stats sync skipped: User not authenticated.');
        return;
    }

    // Don't sync during bulk operations
    if (isBulkSyncing || isInitializing) {
        console.log('Stats sync skipped: Bulk operation in progress.');
        return;
    }

    try {
        const token = await auth0Client.getTokenSilently({
            authorizationParams: { audience: AUTH0_AUDIENCE },
        });

        await uploadStatsToServer(gridSize, stats, token);

    } catch (error) {
        console.error('Stats sync failed:', error);
    }
}

// --- 9. GLOBAL EXPORTS AND EXECUTION ---

// A. Debounced function for frequent saves (from updateTotalStyles)
window.syncProgress = debounce(syncProgressLogic, 5000); 

// B. Immediate functions for critical user actions (from app.js)
window.syncOnPause = () => syncProgressLogic(true); 
window.syncOnNewPuzzle = () => syncProgressLogic(true);

// C. Bulk sync function (can be called manually or on refresh)
window.bulkSyncAllPuzzles = bulkSyncAllPuzzles;

// D. Stats sync functions
window.syncStatsToServer = syncStatsToServer;
window.bulkSyncAllStats = bulkSyncAllStats;

// E. Start the authentication process after the DOM is fully loaded.
document.addEventListener('DOMContentLoaded', initializeAuth0);
