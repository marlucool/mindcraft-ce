// SPDX-License-Identifier: CC0-1.0
import test from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import pf from 'mineflayer-pathfinder';

const VERSION = '1.21.11';
const registry = minecraftData(VERSION);

test('pathfinder treats all Java Edition vine families as climbable', () => {
    const bot = {
        registry,
        version: VERSION,
        game: { minY: -64 },
        entity: { effects: {} },
        pathfinder: { bestHarvestTool: () => null },
        inventory: { items: () => [], slots: [] },
        entities: {},
        blockAt: () => null,
    };
    const movements = new pf.Movements(bot);
    const vineNames = [
        'vine',
        'weeping_vines',
        'weeping_vines_plant',
        'twisting_vines',
        'twisting_vines_plant',
        'cave_vines',
        'cave_vines_plant',
    ];

    for (const name of vineNames) {
        const block = registry.blocksByName[name];
        assert.ok(block, `expected ${name} in Minecraft data for ${VERSION}`);
        assert.ok(movements.climbables.has(block.id), `${name} should be climbable`);
    }
});
