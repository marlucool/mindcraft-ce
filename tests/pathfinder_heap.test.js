// SPDX-License-Identifier: CC0-1.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Heap = require('mineflayer-pathfinder/lib/heap.js');

function drain(heap) {
    const values = [];
    while (!heap.isEmpty()) values.push(heap.pop().f);
    return values;
}

function makeRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

test('heap pops the right child when it is the last valid array element', () => {
    const heap = new Heap();
    [1, 3, 2, 4].forEach((f, id) => heap.push({ f, id }));
    assert.deepEqual(drain(heap), [1, 2, 3, 4]);
});

test('heap preserves sorted order across deterministic randomized inputs', () => {
    const random = makeRandom(0x3692026);
    for (let trial = 0; trial < 2000; trial++) {
        const count = 3 + Math.floor(random() * 30);
        const values = Array.from({ length: count }, () => Math.floor(random() * 10000));
        const heap = new Heap();
        values.forEach((f, id) => heap.push({ f, id }));
        assert.deepEqual(
            drain(heap),
            [...values].sort((a, b) => a - b),
            `heap order mismatch in deterministic trial ${trial}`,
        );
    }
});

test('heap update maintains order after decreasing an open node cost', () => {
    const heap = new Heap();
    const nodes = [10, 20, 30, 40, 50].map((f, id) => ({ f, id }));
    nodes.forEach(node => heap.push(node));
    nodes[4].f = 5;
    heap.update(nodes[4]);
    assert.deepEqual(drain(heap), [5, 10, 20, 30, 40]);
});

test('heap remains ordered during interleaved push, decrease-key and pop operations', () => {
    const random = makeRandom(0x369384);
    for (let trial = 0; trial < 500; trial++) {
        const heap = new Heap();
        const active = new Map();
        let nextId = 0;

        for (let step = 0; step < 50; step++) {
            const choice = random();
            if (active.size === 0 || choice < 0.45) {
                const node = { f: Math.floor(random() * 500) + 1, id: nextId++ };
                heap.push(node);
                active.set(node.id, node);
            } else if (choice < 0.7) {
                const nodes = [...active.values()];
                const node = nodes[Math.floor(random() * nodes.length)];
                node.f = Math.floor(random() * Math.max(1, node.f));
                heap.update(node);
            } else {
                const expected = Math.min(...[...active.values()].map(node => node.f));
                const popped = heap.pop();
                assert.equal(popped.f, expected, `wrong minimum at trial ${trial}, step ${step}`);
                active.delete(popped.id);
            }
        }

        assert.deepEqual(
            drain(heap),
            [...active.values()].map(node => node.f).sort((a, b) => a - b),
            `final drain mismatch in trial ${trial}`,
        );
    }
});
