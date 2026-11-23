// SPDX-License-Identifier: CC0-1.0
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import settings from '../settings.js';
import { setSettings } from '../src/agent/settings.js';
import { initBot } from '../src/utils/mcdata.js';
import { moveAway, moveAwayFromEntity, avoidEnemies, stay } from '../src/agent/library/skills.js';

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
    const bot = {
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
    };
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
