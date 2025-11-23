// === Gokuro User Stats Management (stats.js) ===
// 
// This file handles:
// 1. Local storage of user stats (personal best, streaks) per grid size
// 2. Updating stats when puzzles are completed
// 3. Displaying stats in the UI
// 4. Syncing stats with the server when logged in
// 
// ----------------------------------------------------------------------

// --- 1. CONSTANTS ---
const STATS_STORAGE_KEY = 'gokuro_user_stats';

// --- 2. STATE ---
let currentGridSize = '5x5'; // Will be updated when grid changes

// --- 3. STATS DATA STRUCTURE ---
/**
 * Gets the stats structure for a grid size
 * Mirrors the database table structure: user_stats
 * @param {string} gridSize - e.g., "5x5", "6x7"
 * @returns {object} Stats object for the grid size
 */
function getEmptyStats(gridSize) {
    return {
        grid_size: gridSize,
        best_time_seconds: null,
        best_time_date: null,
        current_streak_days: 0,
        max_streak_days: 0,
        last_completed_date: null,
        max_streak_date: null
    };
}

/**
 * Gets all stats from local storage
 * @returns {object} Map of grid_size -> stats object
 */
function getAllStatsFromStorage() {
    try {
        const stored = localStorage.getItem(STATS_STORAGE_KEY);
        if (!stored) {
            return {};
        }
        return JSON.parse(stored);
    } catch (error) {
        console.error('Error reading stats from localStorage:', error);
        return {};
    }
}

/**
 * Saves all stats to local storage
 * @param {object} allStats - Map of grid_size -> stats object
 */
function saveAllStatsToStorage(allStats) {
    try {
        localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(allStats));
    } catch (error) {
        console.error('Error saving stats to localStorage:', error);
    }
}

/**
 * Gets stats for a specific grid size
 * @param {string} gridSize - e.g., "5x5", "6x7"
 * @returns {object} Stats object for the grid size
 */
function getStatsForGrid(gridSize) {
    const allStats = getAllStatsFromStorage();
    if (!allStats[gridSize]) {
        allStats[gridSize] = getEmptyStats(gridSize);
        saveAllStatsToStorage(allStats);
    }
    return allStats[gridSize];
}

/**
 * Saves stats for a specific grid size
 * @param {string} gridSize - e.g., "5x5", "6x7"
 * @param {object} stats - Stats object to save
 */
function saveStatsForGrid(gridSize, stats) {
    const allStats = getAllStatsFromStorage();
    allStats[gridSize] = stats;
    saveAllStatsToStorage(allStats);
}

// --- 4. STATS UPDATE LOGIC ---

/**
 * Updates stats when a puzzle is completed
 * @param {string} puzzleId - e.g., "2025-11-20-5x5"
 * @param {number} elapsedSeconds - Time taken to complete the puzzle
 * @param {boolean} isPristine - Whether the puzzle was completed without pausing/switching/resetting
 * @returns {object} Updated stats with flags indicating what changed
 */
function updateStatsOnCompletion(puzzleId, elapsedSeconds, isPristine = true) {
    // Extract grid size and date from puzzle_id (format: "YYYY-MM-DD-GxG")
    const parts = puzzleId.split('-');
    if (parts.length < 4) {
        console.error('Invalid puzzle_id format:', puzzleId);
        return null;
    }
    
    const gridSize = parts[parts.length - 1]; // e.g., "5x5"
    const puzzleDate = `${parts[0]}-${parts[1]}-${parts[2]}`; // e.g., "2025-11-20"
    
    const stats = getStatsForGrid(gridSize);
    const changes = {
        newPersonalBest: false,
        streakIncreased: false,
        newMaxStreak: false
    };
    
    // --- Update Personal Best ---
    // Only update PB if this was a pristine completion (no pauses, switches, or resets)
    if (isPristine) {
        if (stats.best_time_seconds === null || elapsedSeconds < stats.best_time_seconds) {
            stats.best_time_seconds = elapsedSeconds;
            stats.best_time_date = new Date().toISOString();
            changes.newPersonalBest = true;
            console.log(`🎉 New personal best for ${gridSize}: ${elapsedSeconds}s`);
        }
    } else {
        console.log(`⏸️ Completion not eligible for PB (puzzle was paused/switched/reset)`);
    }
    
    // --- Update Streak ---
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const lastCompleted = stats.last_completed_date;
    
    if (!lastCompleted) {
        // First completion ever
        stats.current_streak_days = 1;
        stats.last_completed_date = today;
        changes.streakIncreased = true;
        
        if (stats.current_streak_days > stats.max_streak_days) {
            stats.max_streak_days = stats.current_streak_days;
            stats.max_streak_date = today;
            changes.newMaxStreak = true;
        }
    } else if (lastCompleted === today) {
        // Already completed a puzzle today for this grid size - no change to streak
        console.log(`Already completed a ${gridSize} puzzle today, streak unchanged`);
    } else {
        // Check if it's a consecutive day
        const lastDate = new Date(lastCompleted);
        const todayDate = new Date(today);
        const daysDiff = Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24));
        
        if (daysDiff === 1) {
            // Consecutive day - increment streak
            stats.current_streak_days += 1;
            stats.last_completed_date = today;
            changes.streakIncreased = true;
            console.log(`🔥 Streak increased to ${stats.current_streak_days} days!`);
            
            if (stats.current_streak_days > stats.max_streak_days) {
                stats.max_streak_days = stats.current_streak_days;
                stats.max_streak_date = today;
                changes.newMaxStreak = true;
                console.log(`🏆 New max streak: ${stats.max_streak_days} days!`);
            }
        } else if (daysDiff > 1) {
            // Streak broken - reset to 1
            console.log(`Streak broken (${daysDiff} days gap), resetting to 1`);
            stats.current_streak_days = 1;
            stats.last_completed_date = today;
            changes.streakIncreased = false;
        }
    }
    
    // Save updated stats
    saveStatsForGrid(gridSize, stats);
    
    // Refresh the UI
    displayStatsForGrid(gridSize);
    
    // Trigger sync if user is logged in
    if (typeof window.syncStatsToServer === 'function') {
        window.syncStatsToServer(gridSize, stats);
    }
    
    return { stats, changes };
}

// --- 5. UI DISPLAY ---

/**
 * Formats seconds as MM:SS
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted time string
 */
function formatTime(seconds) {
    if (seconds === null || seconds === undefined) {
        return '--:--';
    }
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Displays stats for the current grid size
 * @param {string} gridSize - e.g., "5x5", "6x7"
 */
function displayStatsForGrid(gridSize) {
    currentGridSize = gridSize;
    const stats = getStatsForGrid(gridSize);
    
    const bestTimeEl = document.getElementById('stat-best-time');
    const currentStreakEl = document.getElementById('stat-current-streak');
    const maxStreakEl = document.getElementById('stat-max-streak');
    
    if (bestTimeEl) {
        bestTimeEl.textContent = formatTime(stats.best_time_seconds);
    }
    
    if (currentStreakEl) {
        currentStreakEl.textContent = stats.current_streak_days.toString();
    }
    
    if (maxStreakEl) {
        maxStreakEl.textContent = stats.max_streak_days.toString();
    }
}

/**
 * Updates the current grid size being displayed
 * Called by app.js when grid size changes
 * @param {string} gridSize - e.g., "5x5", "6x7"
 */
function setCurrentGridSize(gridSize) {
    displayStatsForGrid(gridSize);
}

// --- 6. GLOBAL EXPORTS ---
window.updateStatsOnCompletion = updateStatsOnCompletion;
window.displayStatsForGrid = displayStatsForGrid;
window.setCurrentGridSize = setCurrentGridSize;
window.getStatsForGrid = getStatsForGrid;
window.saveStatsForGrid = saveStatsForGrid;
window.getAllStatsFromStorage = getAllStatsFromStorage;

// --- 7. INITIALIZE ON LOAD ---
document.addEventListener('DOMContentLoaded', () => {
    // Display stats for default grid size (will be updated when app.js loads)
    displayStatsForGrid('5x5');
});

