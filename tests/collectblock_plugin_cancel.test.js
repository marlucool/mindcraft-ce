// SPDX-License-Identifier: CC0-1.0
// Regression coverage for the mineflayer-collectblock pickup-wait cancellation patch.
// These tests exercise the real installed plugin class with a deterministic fake bot;
// the live Paper harness separately verifies actual Mineflayer/pathfinder behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import minecraftData from 'minecraft-data';
import Vec3 from 'vec3';
import { CollectBlock } from 'mineflayer-collectblock';

const VERSION = '1.21.11';

class Entity {
    constructor(x = 2, y = 64, z = 2) {
        this.position = new Vec3(x, y, z);
        this.isValid = true;
    }
}

function createHarness() {
    const bot = new EventEmitter();
    bot.version = VERSION;
    bot.registry = minecraftData(VERSION);
    bot.entity = { position: new Vec3(0, 64, 0) };
    bot.inventory = { items: () => [], emptySlotCount: () => 36 };
    bot.entities = {};
    bot.tool = {};

    let rejectGoto = null;
    let gotoMode = 'resolve';
    let stopCalls = 0;
    bot.pathfinder = {
        setMovements() {},
        goto() {
            bot.emit('test:goto-started');
            if (gotoMode === 'pending') {
                return new Promise((resolve, reject) => {
                    rejectGoto = reject;
                });
            }
            return Promise.resolve();
        },
        stop() {
            stopCalls++;
            if (rejectGoto) {
                const error = new Error('Path stopped');
                error.name = 'PathStopped';
                const reject = rejectGoto;
                rejectGoto = null;
                reject(error);
            }
        },
    };

    bot.collectBlock = new CollectBlock(bot);
    bot.collectBlock.movements = null;

    return {
        bot,
        setGotoMode(mode) { gotoMode = mode; },
        getStopCalls() { return stopCalls; },
    };
}

async function withDeadline(promise, label, timeoutMs = 1500) {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`${label} did not settle within ${timeoutMs}ms`)), timeoutMs);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

test('collectBlock completes normally when the exact item emits entityGone', async () => {
    const { bot } = createHarness();
    const item = new Entity();
    const started = once(bot, 'test:goto-started');

    const collecting = bot.collectBlock.collect(item);
    await withDeadline(started, 'pathfinder goto start');
    bot.emit('entityGone', item);

    await withDeadline(collecting, 'normal item collection');
    assert.equal(bot.listenerCount('collectBlock_cancel'), 0, 'cancellation listener is cleaned up');
    assert.equal(bot.listenerCount('entityGone'), 0, 'pickup listener is cleaned up');
});


test('an unrelated entityGone event does not finish the active pickup wait', async () => {
    const { bot } = createHarness();
    const item = new Entity();
    const unrelatedItem = new Entity(12, 64, 12);
    const started = once(bot, 'test:goto-started');
    let settled = false;

    const collecting = bot.collectBlock.collect(item).then(() => { settled = true; });
    await withDeadline(started, 'pathfinder goto start');
    bot.emit('entityGone', unrelatedItem);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(settled, false, 'only the exact target entity may satisfy the pickup wait');

    bot.emit('entityGone', item);
    await withDeadline(collecting, 'exact target pickup');
    assert.equal(settled, true);
});

test('cancelTask settles collection while waiting for item pickup', async () => {
    const { bot, getStopCalls } = createHarness();
    const item = new Entity();
    const started = once(bot, 'test:goto-started');

    let finishedEvents = 0;
    bot.once('collectBlock_finished', () => finishedEvents++);
    const collecting = bot.collectBlock.collect(item);
    await withDeadline(started, 'pathfinder goto start');

    const cancelling = bot.collectBlock.cancelTask();
    await withDeadline(Promise.all([collecting, cancelling]), 'collection cancellation');

    assert.equal(getStopCalls(), 1, 'pathfinder is stopped once');
    assert.equal(finishedEvents, 1, 'the collection emits exactly one completion event');
    assert.equal(bot.listenerCount('collectBlock_cancel'), 0, 'cancellation listener is removed');
    assert.equal(bot.listenerCount('entityGone'), 0, 'pickup listener is removed');
    assert.equal(bot.listenerCount('collectBlock_finished'), 0, 'completion listener is removed');
});

test('cancelTask interrupts navigation while goto is still pending', async () => {
    const harness = createHarness();
    harness.setGotoMode('pending');
    const { bot } = harness;
    const item = new Entity();
    const started = once(bot, 'test:goto-started');

    const collecting = bot.collectBlock.collect(item);
    await withDeadline(started, 'pending pathfinder goto start');
    const cancelling = bot.collectBlock.cancelTask();

    await withDeadline(Promise.all([collecting, cancelling]), 'navigation cancellation');
    assert.equal(bot.listenerCount('collectBlock_cancel'), 0, 'cancellation listener is removed');
    assert.equal(bot.listenerCount('entityGone'), 0, 'pickup listener is removed');
});

test('repeated cancellation settles and a later collection still succeeds', async () => {
    const { bot } = createHarness();
    const firstItem = new Entity();
    const firstStarted = once(bot, 'test:goto-started');

    const firstCollect = bot.collectBlock.collect(firstItem);
    await withDeadline(firstStarted, 'first pathfinder goto start');
    await withDeadline(Promise.all([
        firstCollect,
        bot.collectBlock.cancelTask(),
        bot.collectBlock.cancelTask(),
    ]), 'repeated cancellation');

    const secondItem = new Entity(3, 64, 3);
    const secondStarted = once(bot, 'test:goto-started');
    const secondCollect = bot.collectBlock.collect(secondItem);
    await withDeadline(secondStarted, 'second pathfinder goto start');
    bot.emit('entityGone', secondItem);
    await withDeadline(secondCollect, 'collection after cancellation');

    assert.equal(bot.listenerCount('collectBlock_cancel'), 0, 'no stale cancellation listener remains');
    assert.equal(bot.listenerCount('entityGone'), 0, 'no stale pickup listener remains');
});
