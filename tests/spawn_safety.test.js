import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeSpawnWater, isUnderwaterSpawn } from '../src/utils/spawn_safety.js';

function makeBot({ headBlock = 'air', isInWater = false, onJump = null } = {}) {
    let jump = false;
    return {
        entity: {
            position: {
                x: 0, y: 56, z: 0,
                offset: (x, y, z) => ({ x, y: 56 + y, z })
            },
            isInWater
        },
        oxygenLevel: 300,
        blockAt: () => ({ name: typeof headBlock === 'function' ? headBlock() : headBlock }),
        clearControlStates() {},
        setControlState(control, state) {
            if (control === 'jump') {
                jump = state;
                onJump?.(state);
            }
        },
        get jumping() { return jump; }
    };
}

test('detects a water block at the bot head position as submerged', () => {
    assert.equal(isUnderwaterSpawn(makeBot({ headBlock: 'water', isInWater: true })), true);
});

test('does not classify a bot with air at head height as submerged', () => {
    assert.equal(isUnderwaterSpawn(makeBot({ headBlock: 'air', isInWater: false })), false);
});

test('uses Mineflayer water state when the head block is not available', () => {
    const bot = makeBot({ isInWater: true });
    bot.blockAt = () => null;
    bot.oxygenLevel = 120;
    assert.equal(isUnderwaterSpawn(bot), true);
});

test('swims upward and releases jump after reaching air', async () => {
    let headBlock = 'water';
    const bot = makeBot({
        headBlock: () => headBlock,
        isInWater: true,
        onJump: (state) => { if (state) setTimeout(() => { headBlock = 'air'; }, 10); }
    });

    const result = await escapeSpawnWater(bot, { timeoutMs: 200, pollIntervalMs: 5 });
    assert.equal(result.recovered, true);
    assert.equal(bot.jumping, false);
    assert.ok(result.elapsedMs >= 0);
});

test('releases jump and reports failure when the bot cannot reach air', async () => {
    const bot = makeBot({ headBlock: 'water', isInWater: true });
    await assert.rejects(
        escapeSpawnWater(bot, { timeoutMs: 20, pollIntervalMs: 5 }),
        /remained underwater/
    );
    assert.equal(bot.jumping, false);
});

test('rejects invalid recovery timing', async () => {
    const bot = makeBot();
    await assert.rejects(escapeSpawnWater(bot, { timeoutMs: 0 }), /positive numbers/);
});
