import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStartupGoalOverride } from '../src/utils/startup_goal.js';

test('undefined STARTUP_GOAL preserves the profile goal', () => {
    const profile = { startup_goal: 'production objective' };
    assert.equal(applyStartupGoalOverride(profile, undefined), profile);
    assert.equal(profile.startup_goal, 'production objective');
});

test('non-empty STARTUP_GOAL overrides the profile goal', () => {
    const profile = { startup_goal: 'production objective' };
    applyStartupGoalOverride(profile, '  staging objective  ');
    assert.equal(profile.startup_goal, 'staging objective');
});

test('empty STARTUP_GOAL disables the profile goal', () => {
    const profile = { startup_goal: 'production objective' };
    applyStartupGoalOverride(profile, '   ');
    assert.equal(Object.hasOwn(profile, 'startup_goal'), false);
});

test('STARTUP_GOAL can add a goal to a profile without one', () => {
    const profile = { name: 'CornBotVL' };
    applyStartupGoalOverride(profile, 'staging objective');
    assert.equal(profile.startup_goal, 'staging objective');
});

test('invalid profile and non-string overrides are rejected', () => {
    assert.throws(() => applyStartupGoalOverride(null, 'goal'), /profile object/);
    assert.throws(() => applyStartupGoalOverride({}, 42), /must be a string/);
});
