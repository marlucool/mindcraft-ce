import test from 'node:test';
import assert from 'node:assert/strict';
import { Prompter } from '../src/models/prompter.js';

function makePrompter(primary, backup = null) {
    const prompter = Object.create(Prompter.prototype);
    prompter.chat_model = primary;
    prompter.code_model = primary;
    prompter.backup_model = backup;
    prompter.profile = {
        model: { model: 'primary-model' },
        backup_model: backup ? { model: 'backup-model' } : null
    };
    return prompter;
}

test('model fallback returns the primary response without calling backup', async () => {
    let primaryCalls = 0;
    let backupCalls = 0;
    const primary = {
        async sendRequest() {
            primaryCalls++;
            return 'primary response';
        }
    };
    const backup = {
        async sendRequest() {
            backupCalls++;
            return 'backup response';
        }
    };

    const prompter = makePrompter(primary, backup);
    const result = await prompter._sendWithFallback([], 'prompt');

    assert.equal(result, 'primary response');
    assert.equal(primaryCalls, 1);
    assert.equal(backupCalls, 0);
});

test('model fallback switches after three consecutive primary failures', async () => {
    let primaryCalls = 0;
    let backupCalls = 0;
    const primary = {
        async sendRequest() {
            primaryCalls++;
            throw new Error('primary unavailable');
        }
    };
    const backup = {
        async sendRequest() {
            backupCalls++;
            return 'backup response';
        }
    };

    const prompter = makePrompter(primary, backup);
    const result = await prompter._sendWithFallback([], 'prompt');

    assert.equal(result, 'backup response');
    assert.equal(primaryCalls, 3);
    assert.equal(backupCalls, 1);
});

test('model fallback returns an empty response after both models exhaust retries', async () => {
    let primaryCalls = 0;
    let backupCalls = 0;
    const primary = {
        async sendRequest() {
            primaryCalls++;
            throw new Error('primary unavailable');
        }
    };
    const backup = {
        async sendRequest() {
            backupCalls++;
            throw new Error('backup unavailable');
        }
    };

    const prompter = makePrompter(primary, backup);
    const result = await prompter._sendWithFallback([], 'prompt');

    assert.equal(result, '');
    assert.equal(primaryCalls, 3);
    assert.equal(backupCalls, 3);
});

test('model fallback does not start a request after the conversation is superseded', async () => {
    let primaryCalls = 0;
    const primary = {
        async sendRequest() {
            primaryCalls++;
            return 'should not be called';
        }
    };

    const prompter = makePrompter(primary);
    const result = await prompter._sendWithFallback([], 'prompt', primary, 'conversation', () => false);

    assert.equal(result, '');
    assert.equal(primaryCalls, 0);
});
