// SPDX-License-Identifier: CC0-1.0
import test from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import blockFactory from 'prismarine-block';
import pf from 'mineflayer-pathfinder';

const VERSION = '1.20.4';
const registry = minecraftData(VERSION);
const Block = blockFactory(VERSION);
const start = { x: 0, y: 0, z: 0, remainingBlocks: 0 };

function movementsFor(blocks) {
    const bot = {
        registry,
        version: VERSION,
        game: { minY: 0, height: 256 },
        entity: { effects: {} },
        entities: {},
        inventory: { items: () => [], slots: [] },
        pathfinder: { bestHarvestTool: () => null },
        blockAt(position) {
            const pos = position.floored();
            const name = blocks[`${pos.x},${pos.y},${pos.z}`] || 'air';
            const block = Block.fromStateId(registry.blocksByName[name].minStateId, 0);
            block.position = pos.clone();
            return block;
        },
    };
    const movements = new pf.Movements(bot);
    movements.canDig = false;
    return movements;
}

test('swims up through a water column without scaffolding', () => {
    const movements = movementsFor({ '0,0,0': 'water', '0,1,0': 'water' });
    const neighbors = [];
    movements.getMoveWaterExit(start, neighbors);
    assert.ok(neighbors.some(node =>
        node.x === 0 && node.y === 1 && node.z === 0 && node.toPlace.length === 0
    ));
});

test('plans a step from water onto an adjacent clear shore', () => {
    const movements = movementsFor({ '0,0,0': 'water', '1,0,0': 'stone' });
    const neighbors = [];
    movements.getMoveWaterExit(start, neighbors);
    assert.ok(neighbors.some(node => node.x === 1 && node.y === 1 && node.z === 0));
});

test('does not plan a water exit under a solid ceiling', () => {
    const movements = movementsFor({ '0,0,0': 'water', '0,2,0': 'stone', '1,0,0': 'stone' });
    const neighbors = [];
    movements.getMoveWaterExit(start, neighbors);
    assert.equal(neighbors.length, 0);
});

for (const kind of ['lava', 'fire', 'cobweb']) {
    for (const y of [1, 2]) {
        test(`does not swim into ${kind} at height ${y}`, () => {
            const movements = movementsFor({
                '0,0,0': 'water',
                '0,1,0': 'water',
                [`0,${y},0`]: kind,
            });
            const neighbors = [];
            movements.getMoveWaterExit(start, neighbors);
            assert.equal(neighbors.length, 0);
        });
    }
}

test('does not swim upward from lava', () => {
    const movements = movementsFor({ '0,0,0': 'lava', '0,1,0': 'water' });
    const neighbors = [];
    movements.getMoveWaterExit(start, neighbors);
    assert.equal(neighbors.length, 0);
});

for (const y of [1, 2]) {
    test(`rejects an excluded ascent cell at height ${y}`, () => {
        const movements = movementsFor({ '0,0,0': 'water', '0,1,0': 'water' });
        movements.exclusionAreasStep.push(block => block.position.y === y ? 100 : 0);
        const neighbors = [];
        movements.getMoveWaterExit(start, neighbors);
        assert.equal(neighbors.length, 0);
    });
}

test('includes destination and head exclusion penalties in ascent cost', () => {
    const movements = movementsFor({ '0,0,0': 'water', '0,1,0': 'water' });
    movements.exclusionAreasStep.push(block => block.position.y === 1 ? 7 : 3);
    const neighbors = [];
    movements.getMoveWaterExit(start, neighbors);
    assert.equal(neighbors.length, 1);
    assert.equal(neighbors[0].cost, 1 + movements.liquidCost + 10);
});
