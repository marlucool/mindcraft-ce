import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isValidTaskDefinition,
    resolveTaskDefinition
} from '../src/utils/task_validation.js';

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

test('resolves a selected task and uses the JSON map key as its stable task ID', () => {
    const original = { type: 'crafting', goal: 'Make a crafting table.' };
    const resolved = resolveTaskDefinition({ 'first-task': original }, 'first-task');

    assert.deepEqual(resolved, {
        type: 'crafting',
        goal: 'Make a crafting table.',
        task_id: 'first-task'
    });
    assert.notEqual(resolved, original);
    assert.equal(original.task_id, undefined);
});

test('throws a clear error when the requested task ID is absent', () => {
    assert.throws(
        () => resolveTaskDefinition({ available: { type: 'crafting' } }, 'missing'),
        /Task "missing" was not found/
    );
});

test('rejects empty, malformed, and inherited task entries', () => {
    assert.throws(() => resolveTaskDefinition({}, ''), /non-empty task_id/);
    assert.throws(() => resolveTaskDefinition([], 'task-a'), /JSON object keyed by task ID/);
    assert.throws(() => resolveTaskDefinition({ task: {} }, 'task'), /task_id and type are required/);
    assert.throws(() => resolveTaskDefinition({ task: { type: 'crafting' } }, 'task'), /task_id and type are required/);
    assert.throws(() => resolveTaskDefinition({}, 'toString'), /was not found/);
});
