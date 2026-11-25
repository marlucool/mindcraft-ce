// SPDX-License-Identifier: CC0-1.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const goto = require('mineflayer-pathfinder/lib/goto.js');

function makeBot(onGoal) {
    const bot = new EventEmitter();
    bot.pathfinder = {
        goal: null,
        setGoal(goal) {
            this.goal = goal;
            if (goal) onGoal?.(bot);
        },
    };
    return bot;
}

test('goto still rejects PathStopped for callers that are awaiting it', async () => {
    const bot = makeBot(instance => setImmediate(() => instance.emit('path_stop')));
    await assert.rejects(goto(bot, { id: 'target' }), { name: 'PathStopped' });
});

test('an abandoned goto interruption does not emit an unhandled rejection', async () => {
    const unhandled = [];
    const listener = reason => unhandled.push(reason);
    process.on('unhandledRejection', listener);

    try {
        goto(makeBot(instance => setImmediate(() => instance.emit('path_stop'))), { id: 'target' });
        await new Promise(resolve => setTimeout(resolve, 50));
    } finally {
        process.removeListener('unhandledRejection', listener);
    }

    assert.deepEqual(unhandled, []);
});

test('goto rejects NoPath even when the failed result has an empty path', async () => {
    const bot = makeBot(instance => setImmediate(() => instance.emit('path_update', {
        status: 'noPath',
        path: [],
    })));
    await assert.rejects(goto(bot, { id: 'unreachable' }), { name: 'NoPath' });
});

test('goto rejects Timeout even when the timed-out result has an empty path', async () => {
    const bot = makeBot(instance => setImmediate(() => instance.emit('path_update', {
        status: 'timeout',
        path: [],
    })));
    await assert.rejects(goto(bot, { id: 'timed-out' }), { name: 'Timeout' });
});

test('goto resolves when an empty successful path means the goal is already reached', async () => {
    const bot = makeBot(instance => setImmediate(() => instance.emit('path_update', {
        status: 'success',
        path: [],
    })));
    await assert.doesNotReject(goto(bot, { id: 'already-there' }));
});

test('goto keeps waiting through empty partial results until search completes', async () => {
    const bot = makeBot(instance => setImmediate(() => instance.emit('path_update', {
        status: 'partial',
        path: [],
    })));
    let settled = false;
    const pending = goto(bot, { id: 'still-searching' }).then(() => {
        settled = true;
    });

    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(settled, false, 'a partial search result must not resolve goto');

    bot.emit('path_update', { status: 'success', path: [] });
    await pending;
    assert.equal(settled, true);
});
