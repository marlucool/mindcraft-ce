import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidTaskDefinition } from '../src/utils/task_validation.js';

test('accepts a task with a non-empty task_id and type', () => {
    assert.equal(isValidTaskDefinition({ task_id: 'basic-survival', type: 'crafting' }), true);
});

test('rejects missing, null, empty, and non-object task definitions', () => {
    for (const value of [undefined, null, {}, [], '', false]) {
        assert.equal(isValidTaskDefinition(value), false);
    }
});

test('rejects task definitions missing either required identity field', () => {
    assert.equal(isValidTaskDefinition({ task_id: 'task-a' }), false);
    assert.equal(isValidTaskDefinition({ type: 'crafting' }), false);
    assert.equal(isValidTaskDefinition({ task_id: ' ', type: 'crafting' }), false);
    assert.equal(isValidTaskDefinition({ task_id: 'task-a', type: ' ' }), false);
});
