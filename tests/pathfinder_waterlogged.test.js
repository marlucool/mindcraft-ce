// SPDX-License-Identifier: CC0-1.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');

function fixture(version = '1.21.4') {
    const registry = require('minecraft-data')(version);
    const Block = require('prismarine-block')(version);
    const blocks = new Map();
    const bot = new EventEmitter();
    Object.assign(bot, {
        registry, version,
        game: { minY: -64, height: 384 },
        entity: { position: new Vec3(0.5, 64, 0.5), effects: {}, onGround: false,
            velocity: new Vec3(0, 0, 0), attributes: {}, yaw: 0, pitch: 0 },
        entities: {},
        inventory: { items: () => [] },
        clearControlStates() {},
        setControlState() {},
        controlState: {},
        pathfinder: { bestHarvestTool: () => null },
        blockAt(position) {
            const pos = position.floored();
            const state = blocks.get(pos.toString()) ?? registry.blocksByName.air.defaultState;
            const block = Block.fromStateId(state, 0);
            block.position = pos.clone();
            return block;
        },
    });
    function put(name, position, properties = {}) {
        const data = registry.blocksByName[name];
        assert.ok(data, `missing ${name} in ${version}`);
        for (let state = data.minStateId; state <= data.maxStateId; state++) {
            const block = Block.fromStateId(state, 0);
            if (Object.entries(properties).every(([k, v]) => block.getProperties()[k] === v)) {
                blocks.set(position.toString(), state);
                return;
            }
        }
        throw new Error(`No state for ${name}: ${JSON.stringify(properties)}`);
    }
    return { bot, put, movements: new Movements(bot) };
}

test('water plants and bubble columns are passable liquid, not scaffolding targets', () => {
    for (const name of ['seagrass', 'tall_seagrass', 'kelp', 'kelp_plant', 'bubble_column']) {
        const { bot, put, movements } = fixture();
        const p = new Vec3(0, 64, 0);
        put('water', p);
        put(name, p.offset(1, 0, 0));
        movements.canDig = false;
        const moves = [];
        movements.getMoveForward({ x: 0, y: 64, z: 0, remainingBlocks: 0 }, { x: 1, z: 0 }, moves);
        assert.equal(movements.getBlock(p, 1, 0, 0).liquid, true, name);
        assert.equal(moves.length, 1, name);
        assert.deepEqual(moves[0].toPlace, [], name);
        assert.equal(bot.blockAt(p.offset(1, 0, 0)).name, name);
    }
});

test('waterlogged and dry coral fan states are distinguished', () => {
    const { put, movements } = fixture();
    const p = new Vec3(0, 64, 0);
    put('horn_coral_wall_fan', p, { waterlogged: true });
    assert.equal(movements.getBlock(p, 0, 0, 0).liquid, true);
    put('horn_coral_wall_fan', p, { waterlogged: false });
    assert.equal(movements.getBlock(p, 0, 0, 0).liquid, false);
});

test('waterlogged coral does not generate a downward swimming move', () => {
    const { put, movements } = fixture();
    const p = new Vec3(0, 64, 0);
    put('horn_coral_wall_fan', p, { waterlogged: true });
    put('water', p.offset(0, -1, 0));
    put('water', p.offset(0, -2, 0));
    const moves = [];
    movements.getMoveDown({ x: 0, y: 64, z: 0, remainingBlocks: 0 }, moves);
    assert.deepEqual(moves, []);
});

test('dontCreateFlow protects blocks adjacent to waterlogged states', () => {
    const { put, movements } = fixture();
    const p = new Vec3(0, 64, 0);
    put('stone', p);
    put('oak_slab', p.offset(1, 0, 0), { waterlogged: true, type: 'bottom' });
    assert.equal(movements.safeToBreak(movements.getBlock(p, 0, 0, 0)), false);
    movements.dontCreateFlow = false;
    assert.equal(movements.safeToBreak(movements.getBlock(p, 0, 0, 0)), true);
});

test('waterlogged solid slabs keep their collision and landing height', () => {
    const { put, movements } = fixture();
    const p = new Vec3(0, 64, 0);
    put('oak_slab', p.offset(0, -2, 0), { waterlogged: true, type: 'top' });
    const slab = movements.getBlock(p, 0, -2, 0);
    assert.equal(slab.liquid, true);
    assert.equal(slab.physical, true);
    assert.equal(slab.safe, false);
    assert.equal(movements.getLandingBlock(p, { x: 0, z: 0 }).position.y, p.y - 1);
});

test('legacy versions without water plants or waterlogging still initialize', () => {
    const { put, movements } = fixture('1.12.2');
    const p = new Vec3(0, 64, 0);
    put('water', p);
    assert.equal(movements.getBlock(p, 0, 0, 0).liquid, true);
    put('stone', p);
    assert.equal(movements.getBlock(p, 0, 0, 0).liquid, false);
});

test('processed water-plant and waterlogged waypoints retain the planned height', () => {
    for (const name of ['kelp', 'horn_coral_wall_fan']) {
        const { bot, put, movements } = fixture();
        for (let x = 0; x <= 2; x++) {
            const p = new Vec3(x, 64, 0);
            put('water', p.offset(0, -1, 0));
            put(name, p, name === 'horn_coral_wall_fan' ? { waterlogged: true } : {});
        }
        pathfinder(bot);
        movements.canDig = false;
        movements.allowEntityDetection = false;
        movements.allow1by1towers = false;
        bot.pathfinder.setMovements(movements);
        const goal = new goals.GoalBlock(2, 64, 0);
        const raw = bot.pathfinder.getPathFromTo(movements, bot.entity.position, goal, { optimizePath: false }).next().value.result;
        const processed = bot.pathfinder.getPathFromTo(movements, bot.entity.position, goal).next().value.result;
        assert.equal(raw.status, 'success');
        assert.equal(processed.status, 'success');
        assert.ok(processed.path.length > 0);
        assert.deepEqual(processed.path.map(node => node.y), raw.path.map(node => node.y));
        assert.ok(processed.path.every(node => node.x % 1 === 0.5 && node.z % 1 === 0.5));
    }
});
