// SPDX-License-Identifier: CC0-1.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { configurePlayerCollisionWidth } from '../src/utils/player_physics.js';

test('player collision half-width matches Minecraft float32 width after physics injection', () => {
    const bot = new EventEmitter();
    bot.physics = { playerHalfWidth: 0.3 };

    configurePlayerCollisionWidth(bot);

    assert.equal(bot.physics.playerHalfWidth, 0.3);
    bot.emit('inject_allowed');

    assert.equal(bot.physics.playerHalfWidth, Math.fround(0.6) / 2);
    assert.notEqual(bot.physics.playerHalfWidth, 0.3);
    assert.equal(bot.listenerCount('inject_allowed'), 0);
});
