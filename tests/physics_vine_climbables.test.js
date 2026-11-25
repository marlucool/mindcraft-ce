// SPDX-License-Identifier: CC0-1.0
import test from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import blockFactory from 'prismarine-block';
import physicsModule from 'prismarine-physics';
import { Vec3 } from 'vec3';

const { Physics, PlayerState } = physicsModule;
const VERSION = '1.21.11';
const mcData = minecraftData(VERSION);
const Block = blockFactory(VERSION);

const VINES = [
    'vine',
    'weeping_vines',
    'weeping_vines_plant',
    'twisting_vines',
    'twisting_vines_plant',
    'cave_vines',
    'cave_vines_plant',
];

function worldWithVine(vineName) {
    return {
        getBlock(position) {
            const pos = position.floored();
            let name = 'air';
            if (pos.x === 0 && pos.y === 61 && pos.z === 0) {
                name = vineName;
            } else if (pos.y < 61) {
                name = 'stone';
            }

            const block = Block.fromStateId(mcData.blocksByName[name].defaultState, 0);
            block.position = pos.clone();
            return block;
        },
    };
}

function playerAtVine() {
    return {
        entity: {
            position: new Vec3(0, 61, 0),
            velocity: new Vec3(0, 0, 0),
            onGround: true,
            isInWater: false,
            isInLava: false,
            isInWeb: false,
            isCollidedHorizontally: false,
            isCollidedVertically: false,
            elytraFlying: false,
            yaw: 0,
            pitch: 0,
            effects: {},
        },
        jumpTicks: 0,
        jumpQueued: false,
        fireworkRocketDuration: 0,
        version: VERSION,
        inventory: { slots: [] },
    };
}

test('physics simulates climbing for every Java Edition vine family', () => {
    for (const vineName of VINES) {
        assert.ok(mcData.blocksByName[vineName], `expected ${vineName} in Minecraft data`);
        const world = worldWithVine(vineName);
        const physics = Physics(mcData, world);
        const player = playerAtVine();
        const controls = {
            forward: false,
            back: false,
            left: false,
            right: false,
            jump: true,
            sprint: false,
            sneak: false,
        };
        const state = new PlayerState(player, controls);

        physics.simulatePlayer(state, world).apply(player);

        assert.ok(
            player.entity.velocity.y > 0,
            `${vineName} should produce upward climbing velocity (got ${player.entity.velocity.y})`,
        );
    }
});
