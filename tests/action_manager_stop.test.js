// SPDX-License-Identifier: CC0-1.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ActionManager } from '../src/agent/action_manager.js';

test('a stuck action requests another interrupt but never kills the process', async () => {
    const bot = new EventEmitter();
    bot.interrupt_code = false;
    bot.output = '';

    let interrupts = 0;
    let cleanKills = 0;
    const agent = {
        bot,
        requestInterrupt() { interrupts++; },
        cleanKill() { cleanKills++; },
        clearBotLogs() { bot.output = ''; },
    };

    const manager = new ActionManager(agent);
    manager.executing = true;
    manager.currentActionLabel = 'deliberately-stuck-test-action';
    manager.stopTimeoutMs = 15;

    const stopping = manager.stop();
    await new Promise(resolve => setTimeout(resolve, 50));

    assert.equal(manager.timedout, true, 'the stop deadline is reported');
    assert.ok(interrupts >= 1, 'the action is repeatedly asked to stop');
    assert.equal(cleanKills, 0, 'the process is never hard-killed');

    manager.executing = false;
    await stopping;
});

test('a stop timeout from a previous action does not taint the next action result', async () => {
    const bot = new EventEmitter();
    bot.interrupt_code = false;
    bot.output = '';

    const agent = {
        bot,
        requestInterrupt() {},
        clearBotLogs() { bot.output = ''; },
    };
    const manager = new ActionManager(agent);
    manager.timedout = true;

    const result = await manager._executeAction('subsequent-action', async () => {}, 0);

    assert.equal(manager.timedout, false);
    assert.equal(result.timedout, false);
    assert.equal(result.success, true);
});
