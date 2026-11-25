// SPDX-License-Identifier: CC0-1.0
// Bamboo has a narrow central collision shape despite minecraft-data reporting boundingBox="block".
// Keep the exception bamboo-specific: ordinary full blocks must remain solid.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import minecraftData from 'minecraft-data';
import blockFactory from 'prismarine-block';
import pf from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';

const VERSION = '1.21.11';
const registry = minecraftData(VERSION);
const Block = blockFactory(VERSION);

function createBot(bambooCells = []) {
    const bamboo = new Set(bambooCells);
    const bot = new EventEmitter();

    Object.assign(bot, {
        registry,
        version: VERSION,
        game: { minY: -64 },
        entity: {
            position: new Vec3(0.5, 64, 0.5),
            onGround: true,
            effects: {},
        },
        inventory: { items: () => [], slots: [] },
        entities: {},
        controlState: {
            forward: false, back: false, left: false, right: false,
            jump: false, sprint: false, sneak: false,
        },
        clearControlStates() {},
        setControlState() {},
    });

    bot.blockAt = position => {
        const pos = position.floored();
        const key = `${pos.x},${pos.y},${pos.z}`;
        let name = 'stone';
        if (bamboo.has(key)) name = 'bamboo';
        else if (pos.y >= 64 && pos.y <= 66) name = 'air';

        const info = registry.blocksByName[name];
        const block = Block.fromStateId(info.defaultState, 0);
        block.position = pos.clone();
        return block;
    };

    return bot;
}

function destinationSet(movements, node) {
    return new Set(movements.getNeighbors(node).map(move => `${move.x},${move.y},${move.z}`));
}

test('bamboo uses its narrow collision as passable without becoming a dig target', () => {
    const bot = createBot(['1,64,0', '1,65,0']);
    const movements = new pf.Movements(bot);
    const bamboo = movements.getBlock(new Vec3(1, 64, 0), 0, 0, 0);

    assert.equal(bamboo.name, 'bamboo');
    assert.equal(bamboo.boundingBox, 'block');
    assert.equal(bamboo.safe, true);
    assert.equal(bamboo.physical, false);

    const toBreak = [];
    assert.equal(movements.safeOrBreak(bamboo, toBreak), 0);
    assert.deepEqual(toBreak, []);
});

test('a diagonal sweep across bamboo is rejected while cardinal movement remains available', () => {
    const bot = createBot(['1,64,0', '1,65,0']);
    const movements = new pf.Movements(bot);
    movements.canDig = false;

    const destinations = destinationSet(movements, { x: 0, y: 64, z: 0, remainingBlocks: 0 });

    assert.ok(!destinations.has('1,64,1'), 'must not cut diagonally across the bamboo stalk');
    assert.ok(destinations.has('0,64,1'), 'the open lateral step remains available');
    assert.ok(destinations.has('1,64,0'), 'a cardinal step through a single bamboo stalk remains available');
});

test('path post-processing keeps a bamboo waypoint at ground level', () => {
    const bot = createBot(['1,64,0', '1,65,0']);
    pf.pathfinder(bot);

    const movements = new pf.Movements(bot);
    const goal = {
        isEnd: node => node.x === 1 && node.y === 64 && node.z === 0,
        heuristic: node => Math.abs(1 - node.x) + Math.abs(64 - node.y) + Math.abs(node.z),
    };

    const generator = bot.pathfinder.getPathFromTo(movements, bot.entity.position, goal, { timeout: 1000 });
    const result = generator.next().value.result;

    assert.equal(result.status, 'success');
    assert.equal(result.path.length, 1);
    assert.deepEqual(
        [result.path[0].x, result.path[0].y, result.path[0].z],
        [1.5, 64, 0.5],
    );
});
