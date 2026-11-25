// SPDX-License-Identifier: CC0-1.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { GoalCompositeAll, GoalCompositeAny, GoalInvert, Goal } = require('mineflayer-pathfinder/lib/goals.js');

class ConstantGoal extends Goal {
    constructor(value) {
        super();
        this.value = value;
    }

    heuristic() {
        return this.value;
    }
}

test('GoalCompositeAll returns zero when all child heuristics are zero', () => {
    const goal = new GoalCompositeAll([new ConstantGoal(0), new ConstantGoal(0)]);
    assert.equal(goal.heuristic({}), 0);
});

test('GoalCompositeAll returns the maximum for mixed positive and negative heuristics', () => {
    const goal = new GoalCompositeAll([new GoalInvert(new ConstantGoal(5)), new ConstantGoal(3)]);
    assert.equal(goal.heuristic({}), 3);
});

test('GoalCompositeAll preserves a negative maximum from inverted goals', () => {
    const goal = new GoalCompositeAll([new GoalInvert(new ConstantGoal(5)), new GoalInvert(new ConstantGoal(1))]);
    assert.equal(goal.heuristic({}), -1);
});

test('GoalCompositeAll uses negative infinity for an empty goal collection', () => {
    const goal = new GoalCompositeAll([]);
    assert.equal(goal.heuristic({}), -Infinity);
});

test('GoalCompositeAny remains a minimum reduction', () => {
    const goal = new GoalCompositeAny([new ConstantGoal(7), new ConstantGoal(2)]);
    assert.equal(goal.heuristic({}), 2);
});
