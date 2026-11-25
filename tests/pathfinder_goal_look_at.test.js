// SPDX-License-Identifier: CC0-1.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Vec3 } = require('vec3');
const { GoalLookAtBlock, GoalBreakBlock } = require('mineflayer-pathfinder/lib/goals.js');

test('GoalLookAtBlock accepts a visible overhead face within interaction reach', () => {
    const target = new Vec3(0, 6, 0);
    const world = { raycast: () => ({ position: target }) };
    const goal = new GoalLookAtBlock(target, world, { reach: 4.5 });

    assert.equal(goal.isEnd(new Vec3(0, 0, 0)), true);
});

test('GoalLookAtBlock still rejects a target when no face is visible', () => {
    const target = new Vec3(0, 6, 0);
    const world = { raycast: () => null };
    const goal = new GoalLookAtBlock(target, world, { reach: 4.5 });

    assert.equal(goal.isEnd(new Vec3(0, 0, 0)), false);
});

test('GoalBreakBlock forwards the candidate node to its visibility goal', () => {
    const target = new Vec3(0, 6, 0);
    const world = { raycast: () => ({ position: target }) };
    const goal = new GoalBreakBlock(0, 6, 0, world, { reach: 4.5 });

    assert.equal(goal.isEnd(new Vec3(0, 0, 0)), true);
});
