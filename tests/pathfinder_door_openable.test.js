// SPDX-License-Identifier: CC0-1.0
import test from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import blockFactory from 'prismarine-block';
import pf from 'mineflayer-pathfinder';

const VERSION = '1.21.11';
const registry = minecraftData(VERSION);
const Block = blockFactory(VERSION);

function makeBot(doorName) {
    const door = registry.blocksByName[doorName];
    assert.ok(door, `expected ${doorName} in Minecraft data`);

    return {
        registry,
        version: VERSION,
        game: { minY: -64 },
        entity: { effects: {} },
        inventory: { items: () => [], slots: [] },
        entities: {},
        pathfinder: { bestHarvestTool: () => null },
        blockAt(position) {
            const pos = position.floored();
            let name = 'air';
            if (pos.x === 1 && pos.y === 64 && pos.z === 0) name = doorName;
            else if (pos.y < 64) name = 'stone';

            const block = Block.fromStateId(registry.blocksByName[name].defaultState, 0);
            block.position = pos.clone();
            return block;
        },
    };
}

test('pathfinder recognises every modern non-iron door and fence gate', () => {
    const bot = makeBot('cherry_door');
    const movements = new pf.Movements(bot);
    const openable = registry.blocksArray.filter(block =>
        (block.name.endsWith('_door') || block.name.endsWith('_fence_gate')) &&
        !block.name.toLowerCase().includes('iron')
    );

    assert.ok(openable.length > 0, 'the test registry should contain doors and gates');
    for (const block of openable) {
        assert.ok(movements.openable.has(block.id), `${block.name} should be openable`);
    }

    assert.ok(!movements.openable.has(registry.blocksByName.iron_door.id));
});

test('modern doors and gates generate useOne actions instead of dig targets', () => {
    for (const doorName of ['cherry_door', 'copper_door', 'pale_oak_door', 'oak_fence_gate']) {
        const bot = makeBot(doorName);
        const movements = new pf.Movements(bot);
        movements.canDig = false;
        const neighbors = [];

        movements.getMoveForward(
            { x: 0, y: 64, z: 0, remainingBlocks: 0 },
            { x: 1, z: 0 },
            neighbors,
        );

        assert.equal(neighbors.length, 1, `${doorName} should produce a forward move`);
        assert.equal(neighbors[0].toBreak.length, 0, `${doorName} must not be dug`);
        assert.ok(
            neighbors[0].toPlace.some(action => action.useOne),
            `${doorName} should be opened through an interaction action`,
        );
    }
});
