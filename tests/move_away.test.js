// SPDX-License-Identifier: CC0-1.0
import test, { before } from 'node:test';
import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import settings from '../settings.js';
import { setSettings } from '../src/agent/settings.js';
import { initBot } from '../src/utils/mcdata.js';
import { moveAway, moveAwayFromEntity, avoidEnemies, stay, goToNearestBlock, goToNearestEntity, goToPlayer, pickupNearbyItems, putInChest, goToSurface, giveToPlayer, attackEntity } from '../src/agent/library/skills.js';

const VERSION = '1.21.11';
const registry = minecraftData(VERSION);

before(() => {
    setSettings({ ...settings, minecraft_version: VERSION, host: '127.0.0.1', port: 1, auth: 'offline' });
    const loader = initBot('MovementTest');
    loader.on('error', () => {});
    loader.emit('login');
    loader.end();
});

function fakeBot({ destination = null, entityPosition = new Vec3(0, 64, 0), cheat = false } = {}) {
    const bot = Object.assign(new EventEmitter(), {
        registry,
        version: VERSION,
        game: { minY: -64 },
        entity: { position: entityPosition, effects: {} },
        output: '',
        interrupt_code: false,
        inventory: { items: () => [], slots: [] },
        entities: {},
        modes: { isOn: mode => mode === 'cheat' && cheat },
        chat() {},
        pathfinder: {
            bestHarvestTool: () => null,
            setMovements() {},
            *getPathFromTo() {
                yield { result: { status: 'success', path: [] } };
            },
            async getPathTo() {
                return { status: 'success', path: [{ x: 8, y: 64, z: 0 }] };
            },
            async goto() {
                if (destination) bot.entity.position = destination.clone();
            },
        },
        blockAt() { return null; },
    });
    return bot;
}

test('moveAway returns true only when the requested distance is actually reached', async () => {
    const bot = fakeBot({ destination: new Vec3(6, 64, 0) });
    assert.equal(await moveAway(bot, 5), true);
});

test('moveAway returns false when goto resolves without moving the bot', async () => {
    const bot = fakeBot();
    assert.equal(await moveAway(bot, 5), false);
});

test('moveAway returns false when the action is already interrupted', async () => {
    const bot = fakeBot();
    bot.interrupt_code = true;
    assert.equal(await moveAway(bot, 5), false);
});

test('moveAwayFromEntity verifies separation instead of trusting goto completion', async () => {
    const target = { name: 'target', position: new Vec3(2, 64, 0) };
    const bot = fakeBot({ destination: new Vec3(10, 64, 0) });
    assert.equal(await moveAwayFromEntity(bot, target, 5), true);

    const stalledBot = fakeBot();
    assert.equal(await moveAwayFromEntity(stalledBot, target, 5), false);
});

test('cheat-mode moveAway continues past partial pathfinding slices', async () => {
    const bot = fakeBot({ cheat: true });
    let slices = 0;

    // getPathTo exposes only the first slice, which is partial for this route.
    bot.pathfinder.getPathTo = async () => ({ status: 'partial', path: [] });
    bot.pathfinder.getPathFromTo = function* () {
        slices++;
        yield { result: { status: 'partial', path: [] } };
        slices++;
        yield { result: { status: 'success', path: [{ x: 8, y: 64, z: 0 }] } };
    };
    bot.chat = () => {
        // Simulate the server confirming the requested teleport.
        bot.entity.position = new Vec3(8, 64, 0);
    };

    assert.equal(await moveAway(bot, 5), true);
    assert.equal(slices, 2);
});

test('avoidEnemies reports failure when interrupted with a hostile still nearby', async () => {
    const bot = fakeBot();
    const enemy = { name: 'zombie', type: 'mob', position: new Vec3(2, 64, 0) };
    bot.nearestEntity = predicate => predicate(enemy) ? enemy : null;
    bot.modes.pause = () => {};
    bot.pathfinder.setGoal = () => {};
    bot.pathfinder.stop = () => {};

    const avoidance = avoidEnemies(bot, 5);
    setTimeout(() => { bot.interrupt_code = true; }, 10);
    assert.equal(await avoidance, false);
});

test('stay reports failure when interrupted before its duration ends', async () => {
    const paused = [];
    const bot = {
        output: '',
        interrupt_code: false,
        modes: { pause: mode => paused.push(mode) },
    };

    const staying = stay(bot, 5);
    setTimeout(() => { bot.interrupt_code = true; }, 10);
    assert.equal(await staying, false);
    assert.equal(paused.length, 7);
});

test('stay rejects invalid durations without pausing modes', async () => {
    const paused = [];
    const bot = {
        output: '',
        interrupt_code: false,
        modes: { pause: mode => paused.push(mode) },
    };

    assert.equal(await stay(bot, -2), false);
    assert.equal(await stay(bot, Number.NaN), false);
    assert.deepEqual(paused, []);
});


test('goToNearestBlock propagates a failed navigation result', async () => {
    const bot = fakeBot();
    const info = registry.blocksByName.oak_log;
    const block = { name: 'oak_log', type: info.id, position: new Vec3(10, 64, 0) };
    bot.findBlocks = ({ matching }) => matching.includes(block.type) ? [block.position] : [];
    bot.blockAt = () => block;
    bot.pathfinder.goto = async () => { throw new Error('NoPath'); };

    assert.equal(await goToNearestBlock(bot, 'oak_log', 2, 64), false);
});

test('goToNearestEntity propagates a failed navigation result', async () => {
    const bot = fakeBot();
    const target = { name: 'cow', position: new Vec3(10, 64, 0) };
    bot.nearestEntity = predicate => predicate(target) ? target : null;
    bot.pathfinder.goto = async () => { throw new Error('NoPath'); };

    assert.equal(await goToNearestEntity(bot, 'cow', 2, 64), false);
});

test('goToPlayer returns false instead of claiming success when navigation fails', async () => {
    const bot = fakeBot();
    bot.username = 'MovementTest';
    bot.players = { Alex: { entity: { username: 'Alex', position: new Vec3(10, 64, 0) } } };
    bot.modes.pause = () => {};
    bot.pathfinder.goto = async () => { throw new Error('NoPath'); };

    assert.equal(await goToPlayer(bot, 'Alex', 3), false);
    assert.match(bot.output, /Could not reach Alex/);
});

test('goToPlayer returns true only when the pathfinder reports completion', async () => {
    const bot = fakeBot();
    bot.username = 'MovementTest';
    bot.players = { Alex: { entity: { username: 'Alex', position: new Vec3(10, 64, 0) } } };
    bot.modes.pause = () => {};

    assert.equal(await goToPlayer(bot, 'Alex', 3), true);
    assert.match(bot.output, /You have reached Alex/);
});

test('pickupNearbyItems returns false when no item is nearby', async () => {
    const bot = fakeBot();
    bot.nearestEntity = () => null;
    assert.equal(await pickupNearbyItems(bot), false);
});


test('putInChest does not open a chest when navigation fails', async () => {
    const bot = fakeBot();
    const info = registry.blocksByName.chest;
    const chest = { name: 'chest', type: info.id, position: new Vec3(10, 64, 0) };
    bot.findBlocks = ({ matching }) => matching.includes(chest.type) ? [chest.position] : [];
    bot.blockAt = () => chest;
    bot.inventory.findInventoryItem = () => ({ name: 'oak_log', type: registry.itemsByName.oak_log.id, count: 4 });
    bot.pathfinder.goto = async () => { throw new Error('NoPath'); };
    bot.openContainer = async () => { assert.fail('must not open an unreachable chest'); };

    assert.equal(await putInChest(bot, 'oak_log'), false);
});

test('goToSurface reports false when the surface cannot be reached', async () => {
    const bot = fakeBot();
    const surface = { name: 'stone', position: new Vec3(0, 70, 0) };
    bot.blockAt = pos => pos.y === 70 ? surface : { name: 'air', position: pos };
    bot.pathfinder.goto = async () => { throw new Error('NoPath'); };

    assert.equal(await goToSurface(bot), false);
});


test('giveToPlayer catches an immediate collection event fired while tossing', async () => {
    const bot = fakeBot();
    bot.username = 'MovementTest';
    bot.players = { Alex: { entity: { username: 'Alex', position: new Vec3(2.5, 64, 0) } } };
    bot.modes.pause = () => {};
    bot.lookAt = async () => {};
    let heldItem = {
        name: 'oak_log',
        type: registry.itemsByName.oak_log.id,
        count: 1,
    };
    bot.inventory.findInventoryItem = name => heldItem?.name === name ? heldItem : null;
    bot.toss = async () => {
        bot.emit('playerCollect', bot.players.Alex.entity, { name: 'oak_log' });
        heldItem = null;
    };

    assert.equal(await giveToPlayer(bot, 'oak_log', 'Alex', 1), true);
    assert.equal(bot.listenerCount('playerCollect'), 0, 'the temporary event listener must be removed');
});

test('attackEntity returns true after a successful non-lethal attack', async () => {
    const bot = fakeBot();
    const target = { name: 'zombie', position: new Vec3(2, 64, 0) };
    let attacked = false;
    bot.attack = async entity => { attacked = entity === target; };

    assert.equal(await attackEntity(bot, target, false), true);
    assert.equal(attacked, true);
});
