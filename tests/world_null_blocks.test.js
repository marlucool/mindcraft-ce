// SPDX-License-Identifier: CC0-1.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { getNearestBlocksWhere } from '../src/agent/library/world.js';

test('getNearestBlocksWhere filters blocks that unload before blockAt resolves', () => {
    const loadedBlock = {
        name: 'stone',
        position: { x: 1, y: 64, z: 1 },
    };
    const positions = [
        { x: 1, y: 64, z: 1 },
        { x: 2, y: 64, z: 1 },
    ];
    const bot = {
        findBlocks: () => positions,
        blockAt: position => position.x === 1 ? loadedBlock : null,
    };

    const blocks = getNearestBlocksWhere(bot, () => true, 8, 10);

    assert.deepEqual(blocks, [loadedBlock]);
    assert.ok(blocks.every(Boolean));
});
