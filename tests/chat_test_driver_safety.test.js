import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const driverPath = fileURLToPath(new URL('../scripts/minecraft-chat-test.cjs', import.meta.url));

function runDriver(envOverrides, args = ['--preset', 'findvillage']) {
    return spawnSync(process.execPath, [driverPath, ...args], {
        encoding: 'utf8',
        env: { ...process.env, ...envOverrides }
    });
}

test('chat test driver refuses production port 25565 by default', () => {
    const result = runDriver({ MINECRAFT_PORT: '25565', ALLOW_PRODUCTION_PORT: '' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Refusing production port 25565/);
});

test('chat test driver rejects an invalid port before connecting', () => {
    const result = runDriver({ MINECRAFT_PORT: '70000' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /MINECRAFT_PORT must be an integer/);
});

test('chat test driver rejects unknown presets before connecting', () => {
    const result = runDriver({}, ['--preset', 'not-a-real-preset']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Unknown preset/);
});
