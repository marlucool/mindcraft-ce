// SPDX-License-Identifier: CC0-1.0
// Regression tests for the collectBlock interruption fix (commit b46e849).
//
// Before the fix, collectBlock treated a PathStopped/GoalChanged rejection as an
// ordinary collection failure and retried it. Because interrupt_code stayed set,
// every retry failed the same way, so the loop spun forever and the action promise
// never settled. The 10-second watchdog then killed the process (cleanKill), which
// restarted the agent into the same failure.
//
// These tests drive the real collectBlock skill with a mocked world/bot and assert
// on observable behaviour (number of collection attempts, returned value, elapsed
// time and log output), not on mocked return values.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import minecraftData from 'minecraft-data';
import blockFactory from 'prismarine-block';
import Vec3 from 'vec3';
import { collectBlock } from '../src/agent/library/skills.js';
import rootSettings from '../settings.js';
import { setSettings } from '../src/agent/settings.js';

// mcdata.js loads its game data when a bot logs in. A bot pointed at a closed port
// never connects; telling it that it logged in loads the data all the same. This is
// what lets the skills that consult the registry (goToGoal calls mc.getBlockId)
// work in these unit tests.
async function loadGameData() {
    setSettings({ ...rootSettings, host: '127.0.0.1', port: 1, auth: 'offline' });
    const mc = await import('../src/utils/mcdata.js');
    const bot = mc.initBot('GameData');
    bot.on('error', () => {});
    bot.emit('login');
    bot.end();
}

const VERSION = '1.21.11';
const registry = minecraftData(VERSION);
const Block = blockFactory(VERSION);

// The watchdog in the agent kills a code execution that has not finished after this
// many seconds. Any test that waits longer than this would have produced a cleanKill
// in production, so it is also the bound the regression tests assert against.
const WATCHDOG_SECONDS = 10;

function createBot(dirtCells = []) {
    const dirt = new Set(dirtCells);
    const bot = new EventEmitter();

    Object.assign(bot, {
        registry,
        version: VERSION,
        entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, effects: {} },
        inventory: { items: () => [], slots: [] },
        entities: {},
        controlState: {
            forward: false, back: false, left: false, right: false,
            jump: false, sprint: false, sneak: false,
        },
        clearControlStates() {},
        setControlState() {},
        interrupt_code: false,
        output: '',
        targetDigBlock: null,
        heldItem: null,
        game: { minY: -64, gameMode: 'survival' },
        // modes.isOn('cheat') is consulted by goToPosition/goToGoal before navigating.
        modes: { isOn: () => false, pause: () => {}, unpause: () => {} },
    });

    bot.blockAt = position => {
        const pos = position.floored();
        const key = `${pos.x},${pos.y},${pos.z}`;
        let name = 'stone';
        if (dirt.has(key)) name = 'dirt';
        else if (pos.y >= 64 && pos.y <= 66) name = 'air';

        const info = registry.blocksByName[name];
        const block = Block.fromStateId(info.defaultState, 0);
        block.position = pos.clone();
        return block;
    };

    bot.tool = { equipForBlock: () => {} };
    bot.dig = async () => {};
    bot.pickupNearbyItems = async () => {};

    // Track every collection attempt so a retry loop is observable.
    let collectCalls = 0;
    bot.collectBlock = {
        collect: async () => { collectCalls++; },
    };
    bot.getCollectCallCount = () => collectCalls;

    // The world lookup used by collectBlock to find candidate blocks.
    bot.findBlocks = ({ matching, count }) => {
        const results = [];
        for (const key of dirt) {
            const [x, y, z] = key.split(',').map(Number);
            const pos = new Vec3(x, y, z);
            const block = bot.blockAt(pos);
            if (matching(block)) {
                results.push(pos);
            }
        }
        results.sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
        return results.slice(0, count);
    };

    return bot;
}

test('collectBlock collects one dirt block normally without interruption', async () => {
    const bot = createBot(['1,64,0', '2,64,0']);
    const result = await collectBlock(bot, 'dirt', 1);
    assert.equal(result, true);
    assert.equal(bot.getCollectCallCount(), 1, 'exactly one collection attempt');
    assert.ok(bot.output.includes('Collected 1 dirt.'));
});

test('collectBlock stops immediately when interrupt_code is already set', async () => {
    const bot = createBot(['1,64,0']);
    bot.interrupt_code = true;

    const result = await collectBlock(bot, 'dirt', 3);

    assert.equal(result, false);
    assert.equal(bot.getCollectCallCount(), 0, 'no collection attempt after an interrupt');
    assert.ok(bot.output.includes('Collection of dirt interrupted.'));
});

test('collectBlock stops on PathStopped error instead of retrying', async () => {
    const bot = createBot(['1,64,0']);
    bot.collectBlock.collect = async () => {
        bot.getCollectCallCount(); // no-op, count is bumped below
        const err = new Error('Path stopped');
        err.name = 'PathStopped';
        throw err;
    };

    const result = await collectBlock(bot, 'dirt', 3);

    assert.equal(result, false);
    assert.ok(
        bot.output.includes('Collection of dirt interrupted:'),
        `expected an interruption log, got: ${bot.output}`,
    );
    assert.ok(
        !bot.output.includes('Failed to collect dirt:'),
        'a PathStopped rejection must not be reported as an ordinary collection failure',
    );
});

test('collectBlock stops on GoalChanged error instead of retrying', async () => {
    const bot = createBot(['1,64,0']);
    bot.collectBlock.collect = async () => {
        const err = new Error('Goal changed');
        err.name = 'GoalChanged';
        throw err;
    };

    const result = await collectBlock(bot, 'dirt', 3);

    assert.equal(result, false);
    assert.ok(
        bot.output.includes('Collection of dirt interrupted:'),
        `expected an interruption log, got: ${bot.output}`,
    );
    assert.ok(
        !bot.output.includes('Failed to collect dirt:'),
        'a GoalChanged rejection must not be reported as an ordinary collection failure',
    );
});

test('collectBlock does not retry the same target after an interruption', async () => {
    // This is the exact production failure mode: the collection attempt fails with
    // PathStopped, the old code logged "Failed to collect" and continued the loop,
    // and the next iteration failed the same way, forever.
    const bot = createBot(['1,64,0', '2,64,0', '3,64,0']);

    let attempts = 0;
    bot.collectBlock.collect = async () => {
        attempts++;
        const err = new Error('Path stopped');
        err.name = 'PathStopped';
        throw err;
    };

    const start = Date.now();
    const result = await collectBlock(bot, 'dirt', 3);
    const elapsed = Date.now() - start;

    assert.equal(result, false);
    assert.equal(attempts, 1, `collection must be attempted once, not retried (attempts=${attempts})`);
    assert.ok(
        elapsed < WATCHDOG_SECONDS * 1000,
        `collectBlock must settle before the ${WATCHDOG_SECONDS}s watchdog (took ${elapsed}ms)`,
    );
});

test('collectBlock promise settles when interrupt_code is set mid-collection', async () => {
    const bot = createBot(['1,64,0', '2,64,0', '3,64,0']);

    const originalCollect = bot.collectBlock.collect.bind(bot.collectBlock);
    let collectCallCount = 0;
    bot.collectBlock.collect = async (block) => {
        collectCallCount++;
        if (collectCallCount === 1) {
            bot.interrupt_code = true; // interrupted while the block is being dug
        }
        await originalCollect(block);
    };

    const start = Date.now();
    const result = await collectBlock(bot, 'dirt', 3);
    const elapsed = Date.now() - start;

    assert.ok(
        elapsed < WATCHDOG_SECONDS * 1000,
        `collectBlock must settle before the ${WATCHDOG_SECONDS}s watchdog (took ${elapsed}ms)`,
    );
    assert.equal(result, true, 'the block that was already being collected completes');
    assert.ok(bot.output.includes('Collected 1 dirt.'));
    assert.equal(collectCallCount, 1, 'no further collection is attempted after the interrupt');
});

test('collectBlock stops when interrupt_code is set while navigating to the block', async () => {
    await loadGameData();
    // Bamboo is collected manually: collectBlock walks to the block with
    // goToPosition and then digs it. An interrupt during that navigation must stop
    // the skill instead of digging the block anyway.
    const bot = createBot(['1,64,0']);
    // The default mock reports every cell as dirt; make the target bamboo instead.
    bot.blockAt = position => {
        const pos = position.floored();
        const key = `${pos.x},${pos.y},${pos.z}`;
        let name = 'stone';
        if (key === '1,64,0') name = 'bamboo';
        else if (pos.y >= 64 && pos.y <= 66) name = 'air';
        const info = registry.blocksByName[name];
        const block = Block.fromStateId(info.defaultState, 0);
        block.position = pos.clone();
        return block;
    };

    let navigationInterrupted = false;
    let digCalled = false;
    bot.pathfinder = {
        // goToGoal asks the pathfinder for a route before it starts walking.
        getPathFromTo: function* () {
            yield { result: { status: 'success', path: [] } };
        },
        goto: async () => {
            navigationInterrupted = true;
            bot.interrupt_code = true; // the agent was interrupted while walking
            const err = new Error('Path stopped');
            err.name = 'PathStopped';
            throw err;
        },
        setMovements: () => {},
    };
    bot.dig = async () => { digCalled = true; };

    const start = Date.now();
    const result = await collectBlock(bot, 'bamboo', 3);
    const elapsed = Date.now() - start;

    assert.equal(result, false);
    assert.ok(navigationInterrupted, 'the navigation attempt was actually made');
    assert.ok(!digCalled, 'the block must not be dug after the navigation was interrupted');
    assert.ok(
        elapsed < WATCHDOG_SECONDS * 1000,
        `collectBlock must settle before the ${WATCHDOG_SECONDS}s watchdog (took ${elapsed}ms)`,
    );
});

test('collectBlock stops when Mineflayer aborts an active dig', async () => {
    const bot = createBot(['1,64,0', '2,64,0', '3,64,0']);
    let attempts = 0;

    bot.collectBlock.collect = async () => {
        attempts++;
        // Mineflayer stopDigging() rejects the active bot.dig() promise with
        // Error('Digging aborted'), not a PathStopped error. requestInterrupt()
        // sets interrupt_code before it calls stopDigging().
        bot.interrupt_code = true;
        throw new Error('Digging aborted');
    };

    const start = Date.now();
    const result = await collectBlock(bot, 'dirt', 3);
    const elapsed = Date.now() - start;

    assert.equal(result, false);
    assert.equal(attempts, 1, 'an interrupted dig must not be retried');
    assert.ok(
        bot.output.includes('Collection of dirt interrupted: Digging aborted.'),
        `expected the Mineflayer interruption to be identified, got: ${bot.output}`,
    );
    assert.ok(
        !bot.output.includes('Failed to collect dirt:'),
        'a cancelled dig must not be treated as an ordinary collection failure',
    );
    assert.ok(
        elapsed < WATCHDOG_SECONDS * 1000,
        `collectBlock must settle before the ${WATCHDOG_SECONDS}s watchdog (took ${elapsed}ms)`,
    );
});

test('collectBlock excludes an unreachable target and tries the next block', async () => {
    const bot = createBot(['1,64,0', '2,64,0']);
    const attempted = [];

    bot.collectBlock.collect = async block => {
        attempted.push(block.position.toString());
        if (attempted.length === 1) {
            throw new Error('NoPath');
        }
    };

    const result = await collectBlock(bot, 'dirt', 1);

    assert.equal(result, true);
    assert.deepEqual(attempted, ['(1, 64, 0)', '(2, 64, 0)']);
    assert.ok(bot.output.includes('Failed to collect dirt: Error: NoPath.'));
    assert.ok(bot.output.includes('Collected 1 dirt.'));
});

test('collectBlock cancels and settles a timed-out target before trying another', async () => {
    const bot = createBot(['1,64,0', '2,64,0']);
    bot.collectBlockTimeoutMs = 15;

    const attempted = [];
    let rejectPendingCollection;
    let cancelCalls = 0;

    bot.collectBlock.collect = block => {
        attempted.push(block.position.toString());
        if (attempted.length === 1) {
            return new Promise((resolve, reject) => {
                rejectPendingCollection = () => {
                    const error = new Error('Path stopped after timeout');
                    error.name = 'PathStopped';
                    reject(error);
                };
            });
        }
        return Promise.resolve();
    };
    bot.collectBlock.cancelTask = async () => {
        cancelCalls++;
        rejectPendingCollection();
    };

    const result = await collectBlock(bot, 'dirt', 1);

    assert.equal(result, true);
    assert.equal(cancelCalls, 1, 'the timed-out collection is cancelled once');
    assert.deepEqual(attempted, ['(1, 64, 0)', '(2, 64, 0)']);
    assert.ok(bot.output.includes('Timeout collecting dirt'));
    assert.ok(bot.output.includes('Collected 1 dirt.'));
});
