// SPDX-License-Identifier: CC0-1.0
import test from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import blockFactory from 'prismarine-block';
import pf from 'mineflayer-pathfinder';

const VERSION = '1.21.11';
const registry = minecraftData(VERSION);
const Block = blockFactory(VERSION);
const lavaId = registry.blocksByName.lava.id;

function makeBot(lavaColumns, inLava) {
    const lava = new Set(lavaColumns);
    return {
        registry,
        version: VERSION,
        game: { minY: -64 },
        entity: { effects: {}, isInLava: inLava },
        entities: {},
        inventory: { items: () => [], slots: [] },
        pathfinder: { bestHarvestTool: () => null },
        blockAt(position) {
            const pos = position.floored();
            const key = `${pos.x},${pos.y},${pos.z}`;
            let name = 'air';
            if (pos.y < 64) name = 'stone';
            else if (lava.has(key)) name = 'lava';
            const block = Block.fromStateId(registry.blocksByName[name].defaultState, 0);
            block.position = pos.clone();
            return block;
        },
    };
}

function forwardMoves(movements, x) {
    const neighbors = [];
    movements.getMoveForward(
        { x, y: 64, z: 0, remainingBlocks: 0 },
        { x: 1, z: 0 },
        neighbors,
    );
    return neighbors;
}

test('lava is excluded from routes when the bot is not in lava', () => {
    const bot = makeBot(['0,64,0', '0,65,0'], false);
    const movements = new pf.Movements(bot);
    const lava = movements.getBlock({ x: -1, y: 64, z: 0 }, 1, 0, 0);

    assert.equal(movements.blocksToAvoid.has(lavaId), true);
    assert.equal(lava.name, 'lava');
    assert.equal(lava.safe, false);
    assert.equal(forwardMoves(movements, -1).some(move => move.x === 0), false);
});

test('the planner can cross the lava it is already inside to reach an exit', () => {
    const bot = makeBot(['0,64,0', '0,65,0', '1,64,0', '1,65,0', '2,64,0', '2,65,0'], true);
    const movements = new pf.Movements(bot);
    const start = movements.getBlock({ x: 0, y: 64, z: 0 }, 0, 0, 0);

    assert.equal(movements.blocksToAvoid.has(lavaId), false);
    assert.equal(start.safe, true);
    assert.equal(forwardMoves(movements, 0).some(move => move.x === 1), true);
});

test('lava avoidance is restored as soon as the bot leaves lava', () => {
    const bot = makeBot(['0,64,0', '0,65,0'], true);
    const movements = new pf.Movements(bot);
    assert.equal(movements.blocksToAvoid.has(lavaId), false);

    bot.entity.isInLava = false;
    movements.updateLavaAvoidance();

    const lava = movements.getBlock({ x: -1, y: 64, z: 0 }, 1, 0, 0);
    assert.equal(movements.blocksToAvoid.has(lavaId), true);
    assert.equal(lava.safe, false);
    assert.equal(forwardMoves(movements, -1).some(move => move.x === 0), false);
});
