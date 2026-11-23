// SPDX-License-Identifier: CC0-1.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const patch = readFileSync(new URL('../patches/mineflayer-pathfinder+2.4.5.patch', import.meta.url), 'utf8');

test('a rejected door or gate activation resets the stale pathfinder interaction', () => {
    const activationStart = patch.indexOf('bot.activateBlock(bot.blockAt(new Vec3(placingBlock.x');
    assert.notEqual(activationStart, -1, 'expected the useOne activation handler in the dependency patch');

    const resetIndex = patch.indexOf("+          resetPath('use_one_error')", activationStart);
    assert.notEqual(resetIndex, -1, 'a failed useOne action must reset pathfinder state');
    assert.ok(resetIndex - activationStart < 1000, 'the reset must be in the useOne activation handler');
});
