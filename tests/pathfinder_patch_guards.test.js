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

test('the pathfinder dependency patch is a well-formed unified diff', () => {
    const lines = patch.replace(/\r\n/g, '\n').split('\n');
    let hunk = null;
    const finishHunk = lineNumber => {
        if (!hunk) return;
        assert.equal(hunk.oldSeen, hunk.oldExpected,
            `hunk at line ${hunk.line} has the wrong old-line count (ended at ${lineNumber})`);
        assert.equal(hunk.newSeen, hunk.newExpected,
            `hunk at line ${hunk.line} has the wrong new-line count (ended at ${lineNumber})`);
        hunk = null;
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('diff --git ')) {
            finishHunk(i + 1);
            continue;
        }
        const header = line.match(/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/);
        if (header) {
            finishHunk(i + 1);
            hunk = {
                line: i + 1,
                oldExpected: Number(header[2]),
                newExpected: Number(header[4]),
                oldSeen: 0,
                newSeen: 0,
            };
            continue;
        }
        if (!hunk) continue;

        assert.notEqual(line, '', `hunk at line ${hunk.line} contains an unprefixed blank line`);
        const prefix = line[0];
        assert.ok([' ', '+', '-', '\\'].includes(prefix),
            `hunk at line ${hunk.line} contains an invalid diff line at ${i + 1}: ${line}`);
        if (prefix === ' ' || prefix === '-') hunk.oldSeen++;
        if (prefix === ' ' || prefix === '+') hunk.newSeen++;
        if (hunk.oldSeen === hunk.oldExpected && hunk.newSeen === hunk.newExpected) {
            hunk = null;
        }
    }
    finishHunk(lines.length);
});
