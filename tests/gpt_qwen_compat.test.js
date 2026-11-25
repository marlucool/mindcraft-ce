// SPDX-License-Identifier: CC0-1.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLocalModelOptions, extractCompletionText } from '../src/models/gpt_utils.js';

test('Qwen-compatible local requests disable thinking and preserve other template options', () => {
    const request = { temperature: 0.2, chat_template_kwargs: { custom_option: true, enable_thinking: true } };
    const result = applyLocalModelOptions('Qwen3.5-9B-Q4_K_M', request);

    assert.equal(result, request);
    assert.deepEqual(result.chat_template_kwargs, { custom_option: true, enable_thinking: false });
    assert.equal(result.temperature, 0.2);
});

test('non-Qwen requests are unchanged', () => {
    const request = { temperature: 0.2 };
    assert.equal(applyLocalModelOptions('llama-3.1-8b', request), request);
    assert.deepEqual(request, { temperature: 0.2 });
});

test('completion extraction prefers normal content', () => {
    assert.equal(extractCompletionText({
        choices: [{ message: { content: '!goToCoordinates(1, 2, 3)', reasoning_content: 'internal' } }],
    }), '!goToCoordinates(1, 2, 3)');
});

test('completion extraction falls back to reasoning_content when content is empty', () => {
    assert.equal(extractCompletionText({
        choices: [{ message: { content: '', reasoning_content: '!moveAway(5)' } }],
    }), '!moveAway(5)');
});

test('completion extraction always returns a string', () => {
    assert.equal(extractCompletionText({ choices: [] }), '');
    assert.equal(extractCompletionText({ choices: [{ message: { content: null, reasoning_content: null } }] }), '');
});
