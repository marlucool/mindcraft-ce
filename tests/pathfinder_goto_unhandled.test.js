// SPDX-License-Identifier: CC0-1.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const goto = require('mineflayer-pathfinder/lib/goto.js');

function makeBot() {
    const bot = new EventEmitter();
    bot.pathfinder = {
        goal: null,
        setGoal(goal) {
            this.goal = goal;
            if (goal) setImmediate(() => bot.emit('path_stop'));
        },
    };
    return bot;
}

test('goto still rejects PathStopped for callers that are awaiting it', async () => {
    const bot = makeBot();
    await assert.rejects(goto(bot, { id: 'target' }), { name: 'PathStopped' });
});

test('an abandoned goto interruption does not emit an unhandled rejection', async () => {
    const unhandled = [];
    const listener = reason => unhandled.push(reason);
    process.on('unhandledRejection', listener);

    try {
        goto(makeBot(), { id: 'target' });
        await new Promise(resolve => setTimeout(resolve, 50));
    } finally {
        process.removeListener('unhandledRejection', listener);
    }

    assert.deepEqual(unhandled, []);
});
