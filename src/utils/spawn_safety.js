const WATER_BLOCK_NAMES = new Set(['water', 'bubble_column']);

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns true when the bot's eye/head block is submerged.
 * If the block is unavailable, fall back to Mineflayer's water/oxygen state.
 */
export function isUnderwaterSpawn(bot) {
    const position = bot?.entity?.position;
    if (!position) return false;

    let headBlock = null;
    if (typeof bot.blockAt === 'function') {
        const headPosition = typeof position.offset === 'function'
            ? position.offset(0, 1.6, 0)
            : { x: position.x, y: position.y + 1.6, z: position.z };
        try {
            headBlock = bot.blockAt(headPosition);
        } catch {
            headBlock = null;
        }
    }

    if (headBlock) {
        return WATER_BLOCK_NAMES.has(headBlock.name);
    }

    return bot.entity.isInWater === true
        && (!Number.isFinite(bot.oxygenLevel) || bot.oxygenLevel < 300);
}

/**
 * Swim vertically to breathable air if the bot initially spawns underwater.
 * The jump control is always released, including on timeout or disconnect.
 */
export async function escapeSpawnWater(bot, {
    timeoutMs = 8000,
    pollIntervalMs = 100
} = {}) {
    if (!bot || typeof bot.setControlState !== 'function') {
        throw new TypeError('A Mineflayer bot with setControlState() is required.');
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0
        || !Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
        throw new RangeError('Spawn recovery timeout and poll interval must be positive numbers.');
    }
    if (!isUnderwaterSpawn(bot)) {
        return { recovered: false, elapsedMs: 0 };
    }

    const startedAt = Date.now();
    bot.clearControlStates?.();
    bot.setControlState('jump', true);

    try {
        while (Date.now() - startedAt < timeoutMs) {
            await wait(pollIntervalMs);
            if (!isUnderwaterSpawn(bot)) {
                return { recovered: true, elapsedMs: Date.now() - startedAt };
            }
        }
        throw new Error(`Bot remained underwater after ${timeoutMs}ms of upward swimming.`);
    } finally {
        try {
            bot.setControlState('jump', false);
        } catch {
            // The connection may already have closed; do not mask the original error.
        }
    }
}
