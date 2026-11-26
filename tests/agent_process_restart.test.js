import test from 'node:test';
import assert from 'node:assert/strict';
import {
    getAgentRestartDelay,
    shouldRestartAgent,
    MAX_AGENT_RESTART_ATTEMPTS
} from '../src/process/agent_process.js';

test('restarts unexpected code-1 exits and non-SIGINT signal exits', () => {
    assert.equal(shouldRestartAgent(1, null), true);
    assert.equal(shouldRestartAgent(null, 'SIGTERM'), true);
});

test('does not restart clean exits, operator SIGINT, or fatal task exit codes', () => {
    assert.equal(shouldRestartAgent(0, null), false);
    assert.equal(shouldRestartAgent(null, 'SIGINT'), false);
    assert.equal(shouldRestartAgent(2, null), false);
    assert.equal(shouldRestartAgent(4, null), false);
});

test('uses increasing restart delays with a 10-second cap', () => {
    assert.deepEqual(
        [1, 2, 3, 4, 5, 6].map(getAgentRestartDelay),
        [1000, 2000, 4000, 8000, 10000, 10000]
    );
    assert.equal(MAX_AGENT_RESTART_ATTEMPTS, 5);
    assert.throws(() => getAgentRestartDelay(0), /positive integer/);
});
