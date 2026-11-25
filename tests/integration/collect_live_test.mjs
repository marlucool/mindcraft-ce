// Live integration tests for collectblock navigation and cancellation.
//
// Usage:
//   CE_TEST_RCON_PASSWORD=<password> node tests/integration/collect_live_test.mjs
//
// Environment variables (all optional except the RCON password):
//   CE_TEST_HOST          default 127.0.0.1
//   CE_TEST_PORT          default 25566   (the isolated Paper test server)
//   CE_TEST_RCON_PORT     default 25576
//   CE_TEST_RCON_PASSWORD required: RCON password for the test server
//   CE_TEST_BOT           default CETestBot
//   CE_TEST_VERSION       default 1.21.11
//
// The harness mutates only the isolated test server by preparing a small stone pad
// and test blocks. It never writes to the production server (25565).
// Connects a real bot to the isolated Paper server on 25566 and exercises:
//   A. normal collection of a controlled block on flat, exposed terrain
//   B. cancellation while A* is yielding partial results and no path exists yet
//   C. interruption during an active dig
//   D. cancellation after navigation reaches an item whose pickup is delayed
import { createBot } from 'mineflayer';
import { pathfinder } from 'mineflayer-pathfinder';
import { plugin as collectblock } from 'mineflayer-collectblock';
import { plugin as tool } from 'mineflayer-tool';
import { Vec3 } from 'vec3';
import net from 'net';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const collectBlockRuntimePath = join(dirname(require.resolve('mineflayer-collectblock')), 'CollectBlock.js');
const collectBlockRuntime = readFileSync(collectBlockRuntimePath, 'utf8');
if (!collectBlockRuntime.includes('collectBlock_cancel')) {
    console.error('The installed mineflayer-collectblock runtime is missing the pickup-cancellation patch.');
    console.error('Run npm ci in this checkout so patch-package reapplies patches/mineflayer-collectblock+1.6.0.patch, then rerun this harness.');
    process.exit(2);
}

// RCON client for the isolated test server (25566 / RCON 25576).
function rcon(host, port, password, command) {
    return new Promise((resolve, reject) => {
        const sock = net.connect(port, host);
        const makePacket = (id, type, body) => {
            const payload = Buffer.concat([
                Buffer.from([id & 0xff, (id >> 8) & 0xff, (id >> 16) & 0xff, (id >> 24) & 0xff]),
                Buffer.from([type & 0xff, (type >> 8) & 0xff, (type >> 16) & 0xff, (type >> 24) & 0xff]),
                Buffer.from(body, 'utf8'), Buffer.from([0, 0]),
            ]);
            const len = Buffer.alloc(4);
            len.writeInt32LE(payload.length, 0);
            return Buffer.concat([len, payload]);
        };
        let buf = Buffer.alloc(0);
        let stage = 0;
        const timer = setTimeout(() => { sock.destroy(); reject(new Error('rcon timeout')); }, 10000);
        sock.on('connect', () => sock.write(makePacket(1, 3, password)));
        sock.on('data', (chunk) => {
            buf = Buffer.concat([buf, chunk]);
            while (buf.length >= 4) {
                const size = buf.readInt32LE(0);
                if (buf.length < size + 4) break;
                const id = buf.readInt32LE(4);
                const type = buf.readInt32LE(8);
                const body = buf.slice(12, size + 4 - 2).toString('utf8');
                buf = buf.slice(size + 4);
                if (stage === 0) {
                    stage = 1;
                    sock.write(makePacket(2, 2, command));
                } else {
                    clearTimeout(timer);
                    sock.end();
                    resolve(body);
                    return;
                }
            }
        });
        sock.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
}

const HOST = process.env.CE_TEST_HOST || '127.0.0.1';
const PORT = Number(process.env.CE_TEST_PORT || 25566);
const RCON_PORT = Number(process.env.CE_TEST_RCON_PORT || 25576);
const RCON_PASSWORD = process.env.CE_TEST_RCON_PASSWORD;
const VERSION = process.env.CE_TEST_VERSION || '1.21.11';
const BOT_NAME = process.env.CE_TEST_BOT || 'CETestBot';
const results = [];

if (!RCON_PASSWORD) {
    console.error('CE_TEST_RCON_PASSWORD is not set. The harness needs RCON access to give the test bot a pickaxe.');
    process.exit(2);
}

function record(name, status, detail) {
    results.push({ name, status, detail });
    console.log(`[${status}] ${name}${detail ? ' :: ' + detail : ''}`);
}

async function makeBot(username) {
    const bot = createBot({ username, host: HOST, port: PORT, version: VERSION, auth: 'offline' });
    bot.loadPlugin(pathfinder);
    bot.loadPlugin(tool);
    bot.loadPlugin(collectblock);
    await new Promise((resolve, reject) => {
        bot.once('spawn', resolve);
        bot.once('error', reject);
        setTimeout(() => reject(new Error('login timeout')), 30000);
    });
    // Let the surrounding chunks arrive before searching for blocks.
    await new Promise(r => setTimeout(r, 3000));

    // The bot spawns at a random point and may be falling. Wait until it is
    // standing still on solid ground so the tests are deterministic.
    const groundDeadline = Date.now() + 20000;
    let stableGroundSamples = 0;
    let previousPosition = null;
    while (Date.now() < groundDeadline) {
        await new Promise(r => setTimeout(r, 200));
        const position = bot.entity.position;
        const velocity = bot.entity.velocity;
        // Paper can report a small constant downward velocity while grounded.
        // Verify actual position stability instead of requiring vertical velocity to be zero.
        const stationary = velocity &&
            Math.abs(velocity.x) < 0.01 &&
            Math.abs(velocity.z) < 0.01 &&
            previousPosition !== null &&
            position.distanceTo(previousPosition) < 0.02;
        if (bot.entity.onGround && stationary) {
            stableGroundSamples++;
            if (stableGroundSamples >= 5) break;
        } else {
            stableGroundSamples = 0;
        }
        previousPosition = position.clone();
    }
    if (stableGroundSamples < 5) {
        throw new Error('bot did not settle on solid ground within 20 seconds');
    }
    console.log('  settled on ground at', bot.entity.position);

    let pathUpdateCount = 0;
    const originalGoto = bot.pathfinder.goto.bind(bot.pathfinder);
    bot.pathfinder.goto = goal => {
        const goalType = goal?.constructor?.name || 'unknown goal';
        const target = goal?.entity?.position || goal?.pos ||
            (Number.isFinite(goal?.x) ? new Vec3(goal.x, goal.y, goal.z) : null);
        const started = Date.now();
        console.log(`  [goto] start ${goalType}${target ? ` target=${target}` : ''}`);
        const promise = originalGoto(goal);
        promise.then(
            () => console.log(`  [goto] resolved ${goalType} in ${Date.now() - started}ms`),
            error => console.log(`  [goto] rejected ${goalType} in ${Date.now() - started}ms: ${error.name}: ${error.message}`),
        );
        return promise;
    };
    bot.on('path_update', results => {
        pathUpdateCount++;
        if (pathUpdateCount <= 5 || pathUpdateCount % 10 === 0 || results.status !== 'partial') {
            console.log(`  [path_update #${pathUpdateCount}] status=${results.status} path=${results.path?.length ?? 'n/a'} visited=${results.visitedNodes ?? 'n/a'} generated=${results.generatedNodes ?? 'n/a'} time=${Math.round(results.time ?? 0)}ms`);
        }
    });
    bot.on('goal_reached', goal => console.log(`  [goal_reached] ${goal?.constructor?.name || 'unknown'}`));
    bot.on('path_stop', () => console.log('  [path_stop]'));
    bot.on('diggingStarted', block => console.log(`  [diggingStarted] ${block?.name || 'unknown'} @ ${block?.position || ''}`));
    bot.on('diggingCompleted', block => console.log(`  [diggingCompleted] ${block?.name || 'unknown'} @ ${block?.position || ''}`));
    bot.on('diggingAborted', block => console.log(`  [diggingAborted] ${block?.name || 'unknown'} @ ${block?.position || ''}`));
    bot.on('itemDrop', entity => console.log(`  [itemDrop] id=${entity?.id} name=${entity?.name} pos=${entity?.position}`));
    bot.on('entityGone', entity => console.log(`  [entityGone] id=${entity?.id} name=${entity?.name} pos=${entity?.position}`));
    return bot;
}

// Prepare a controlled, exposed target on a small stone pad in the isolated test
// world. Random nearby blocks may be buried or occluded, which makes a collection
// timeout ambiguous: it may be a bad target rather than a pathfinder regression.
async function prepareTestBlock(bot, xOffset = 5, blockName = 'stone') {
    const startX = Math.floor(bot.entity.position.x);
    const y = Math.floor(bot.entity.position.y);
    const z = Math.floor(bot.entity.position.z);
    const target = new Vec3(startX + xOffset, y, z);
    const minX = Math.min(startX, target.x) - 1;
    const maxX = Math.max(startX, target.x) + 1;

    const commands = [
        `fill ${minX} ${y - 1} ${z - 1} ${maxX} ${y - 1} ${z + 1} stone`,
        `fill ${minX} ${y} ${z - 1} ${maxX} ${y + 2} ${z + 1} air`,
        `setblock ${target.x} ${target.y} ${target.z} ${blockName} replace`,
    ];
    for (const command of commands) {
        const result = await rcon(HOST, RCON_PORT, RCON_PASSWORD, command);
        if (/Unknown command|Syntax error|Failed to execute/i.test(result)) {
            throw new Error(`test-world setup failed for "${command}": ${result.trim()}`);
        }
    }

    for (let attempt = 0; attempt < 40; attempt++) {
        const block = bot.blockAt(target);
        if (block && block.name === blockName) return block;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`test block ${blockName} did not appear at ${target}`);
}

// Wait for a dropped item entity to appear near a position
function waitForItemDrop(bot, near, timeoutMs = 10000) {
    return new Promise((resolve) => {
        const onDrop = (item) => {
            if (item.position.distanceTo(near) <= 4) {
                clearTimeout(timer);
                bot.removeListener('itemDrop', onDrop);
                resolve(item);
            }
        };
        const timer = setTimeout(() => {
            bot.removeListener('itemDrop', onDrop);
            resolve(null);
        }, timeoutMs);
        bot.on('itemDrop', onDrop);
    });
}

async function main() {
    console.log('=== CE collectblock live integration test ===');
    console.log(`Connecting to ${HOST}:${PORT} (${VERSION})`);
    const bot = await makeBot(BOT_NAME);
    console.log('Bot spawned at', bot.entity.position);

    // Give the bot a pickaxe so every dig can harvest. The test server is
    // isolated, so we use its RCON to hand the bot an iron pickaxe.
    try {
        await rcon(HOST, RCON_PORT, RCON_PASSWORD, `give ${BOT_NAME} iron_pickaxe 1`);
        await new Promise(r => setTimeout(r, 1200));
        const pick = bot.inventory.items().find(i => i.name === 'iron_pickaxe');
        if (pick) {
            await bot.equip(pick, 'hand');
            console.log('  iron_pickaxe equipped:', bot.heldItem && bot.heldItem.name);
        } else {
            console.log('  WARNING: iron_pickaxe not in inventory');
        }
    } catch (e) {
        console.log('  could not equip iron_pickaxe:', e.message);
    }

    const start = bot.entity.position.clone();
    console.log('Start position:', start);

    // ---- Test A: normal collection of a real block ----
    // Exercise the same public API used by skills.collectBlock(): pass the block
    // to collectblock and let the plugin navigate, dig, and gather the drop.
    try {
        const target = await prepareTestBlock(bot, 5, 'stone');
        if (!target) {
            record('A: normal block collection', 'SKIP', 'controlled target block was not created');
        } else {
            const startDistance = bot.entity.position.distanceTo(target.position);
            console.log('  collecting block:', target.name, target.position, 'distance:', startDistance.toFixed(1));
            if (startDistance > 25.5) {
                record('A: normal block collection', 'FAIL',
                    `harness selected a block ${startDistance.toFixed(1)} blocks away despite maxDistance=25`);
            } else {
                const beforeType = target.type;
                const movements = bot.collectBlock.movements;
                const worldTargetBefore = bot.blockAt(target.position);
                const safetyContext = () => {
                    const current = bot.blockAt(target.position);
                    const above = movements?.getBlock(target.position, 0, 1, 0);
                    const sides = [
                        movements?.getBlock(target.position, -1, 0, 0),
                        movements?.getBlock(target.position, 1, 0, 0),
                        movements?.getBlock(target.position, 0, 0, -1),
                        movements?.getBlock(target.position, 0, 0, 1),
                    ];
                    return {
                        worldBlock: current ? `${current.name}:${current.type}` : 'unloaded',
                        targetType: target.type,
                        safeToBreak: movements?.safeToBreak(target),
                        canDig: movements?.canDig,
                        dontCreateFlow: movements?.dontCreateFlow,
                        dontMineUnderFallingBlock: movements?.dontMineUnderFallingBlock,
                        inBlocksCantBreak: movements?.blocksCantBreak?.has(target.type),
                        aboveIsLiquid: above?.liquid,
                        aboveCanFall: above?.canFall,
                        adjacentLiquid: sides.some(block => block?.liquid),
                    };
                };
                console.log('  Test A target diagnostics:', JSON.stringify({
                    start: bot.entity.position,
                    target: target.position,
                    targetType: target.type,
                    worldTargetType: worldTargetBefore?.type,
                    safety: safetyContext(),
                }));

                const originalSafeToBreak = movements?.safeToBreak?.bind(movements);
                if (originalSafeToBreak) {
                    movements.safeToBreak = block => {
                        const safe = originalSafeToBreak(block);
                        console.log(`  [collectblock safeToBreak] ${block.name}:${block.type} => ${safe}`);
                        return safe;
                    };
                }

                const originalEquipForBlock = bot.tool?.equipForBlock;
                if (originalEquipForBlock) {
                    bot.tool.equipForBlock = async function (...args) {
                        console.log('  [collectblock tool] equipForBlock called for', args[0]?.name);
                        const result = await originalEquipForBlock.apply(this, args);
                        console.log('  [collectblock tool] heldItem:', bot.heldItem?.name ?? null);
                        return result;
                    };
                }

                const originalDig = bot.dig.bind(bot);
                bot.dig = (...args) => {
                    console.log('  [collectblock dig] called for', args[0]?.name, args[0]?.position);
                    return originalDig(...args);
                };

                let timeoutHandle;
                const attempt = bot.collectBlock.collect(target).then(
                    () => ({ ok: true }),
                    error => ({ error }),
                );
                const outcome = await Promise.race([
                    attempt,
                    new Promise(resolve => {
                        timeoutHandle = setTimeout(() => resolve({ timeout: true }), 15000);
                    }),
                ]);
                clearTimeout(timeoutHandle);

                bot.dig = originalDig;
                if (originalEquipForBlock) bot.tool.equipForBlock = originalEquipForBlock;
                if (originalSafeToBreak) movements.safeToBreak = originalSafeToBreak;

                if (outcome.timeout) {
                    record('A: normal block collection', 'FAIL', 'collectBlock.collect(block) timed out after 15s');
                    // Do not leave a failed test task running into the following scenarios.
                    await Promise.race([
                        bot.collectBlock.cancelTask().catch(() => {}),
                        new Promise(resolve => setTimeout(resolve, 2000)),
                    ]);
                } else if (outcome.error) {
                    record('A: normal block collection', 'FAIL',
                        `${outcome.error.name}: ${outcome.error.message}`);
                } else {
                    const remaining = bot.blockAt(target.position);
                    if (remaining && remaining.type === beforeType) {
                        record('A: normal block collection', 'FAIL',
                            `collectBlock resolved but the target block is still present; diagnostics=${JSON.stringify(safetyContext())}`);
                    } else {
                        record('A: normal block collection', 'PASS',
                            `plugin navigated, mined ${target.name}, and settled in the expected block position`);
                    }
                }
            }
        }
    } catch (err) {
        record('A: normal block collection', 'FAIL', `${err.name}: ${err.message}`);
    }

    // ---- Test D: cancel while waiting for pickup ----
    // Set PickupDelay on the freshly dropped target so the bot can reach it but cannot
    // pick it up. Observe the exact GoalFollow goal and exact target entityGone event;
    // unrelated item despawns must not make this test pass.
    try {
        const block = await prepareTestBlock(bot, 5, 'dirt');
        if (!block) {
            record('D: cancel while waiting for pickup', 'SKIP', 'controlled target block was not created');
        } else {
            await bot.tool.equipForBlock(block, { requireHarvest: true, getFromChest: false, maxTools: 1 });
            const dropped = waitForItemDrop(bot, block.position);
            await bot.dig(block);
            const item = await dropped;

            if (!item) {
                record('D: cancel while waiting for pickup', 'SKIP', 'no item drop observed');
            } else {
                const x = Math.floor(item.position.x);
                const y = Math.floor(item.position.y);
                const z = Math.floor(item.position.z);
                const commandResult = await rcon(
                    HOST, RCON_PORT, RCON_PASSWORD,
                    `execute positioned ${x} ${y} ${z} as @e[type=item,distance=..2,sort=nearest,limit=1] run data merge entity @s {PickupDelay:32767}`
                );
                console.log('  set target pickup delay:', commandResult.trim());

                if (!commandResult.includes('Modified entity data')) {
                    record('D: cancel while waiting for pickup', 'FAIL',
                        `could not set PickupDelay on a dropped item: ${commandResult.trim()}`);
                } else {
                    let targetNavigationReached = false;
                    let targetEntityGone = false;
                    let collectSettled = false;
                    let collectError = null;
                    const onGoalReached = goal => {
                        if (goal?.entity === item) {
                            targetNavigationReached = true;
                            console.log('  exact GoalFollow target reached');
                        }
                    };
                    const onEntityGone = entity => {
                        if (entity === item) {
                            targetEntityGone = true;
                            console.log('  exact target item entityGone');
                        }
                    };
                    bot.on('goal_reached', onGoalReached);
                    bot.on('entityGone', onEntityGone);

                    const collectPromise = bot.collectBlock.collect(item).then(
                        () => { collectSettled = true; },
                        error => { collectSettled = true; collectError = error; },
                    );

                    const navigationDeadline = Date.now() + 12000;
                    while (Date.now() < navigationDeadline &&
                           !targetNavigationReached && !targetEntityGone && !collectSettled) {
                        await new Promise(resolve => setTimeout(resolve, 25));
                    }
                    await new Promise(resolve => setTimeout(resolve, 250));

                    if (targetEntityGone || collectSettled) {
                        record('D: cancel while waiting for pickup', 'FAIL',
                            targetEntityGone
                                ? 'the target item despawned despite the pickup delay'
                                : `collection settled before the pickup wait: ${collectError?.message || 'resolved'}`);
                    } else if (!targetNavigationReached) {
                        record('D: cancel while waiting for pickup', 'FAIL',
                            'pathfinder did not reach the exact item target within 12s');
                        await Promise.race([
                            bot.collectBlock.cancelTask().catch(() => {}),
                            new Promise(resolve => setTimeout(resolve, 2000)),
                        ]);
                    } else {
                        console.log('  confirmed: navigation completed, target remains, collection is waiting for pickup');
                        const t0 = Date.now();
                        let cancelSettled = false;
                        let cancelError = null;
                        const cancelPromise = bot.collectBlock.cancelTask().then(
                            () => { cancelSettled = true; },
                            error => { cancelSettled = true; cancelError = error; },
                        );

                        const cancelDeadline = Date.now() + 3000;
                        while (Date.now() < cancelDeadline && !(collectSettled && cancelSettled)) {
                            await new Promise(resolve => setTimeout(resolve, 25));
                        }

                        const elapsed = Date.now() - t0;
                        if (collectSettled && cancelSettled && !collectError && !cancelError) {
                            record('D: cancel while waiting for pickup', 'PASS',
                                `collect and cancelTask both settled in ${elapsed}ms after navigation finished`);
                        } else {
                            record('D: cancel while waiting for pickup', 'FAIL',
                                `collectSettled=${collectSettled} cancelSettled=${cancelSettled} collectError=${collectError?.name || 'none'} cancelError=${cancelError?.name || 'none'} after ${elapsed}ms`);
                        }
                        void cancelPromise;
                    }

                    // If cancellation failed, remove the exact test item so the plugin
                    // can finish and later scenarios do not overlap an abandoned task.
                    if (!collectSettled) {
                        try {
                            const itemX = Math.floor(item.position.x);
                            const itemY = Math.floor(item.position.y);
                            const itemZ = Math.floor(item.position.z);
                            const cleanupResult = await rcon(
                                HOST, RCON_PORT, RCON_PASSWORD,
                                `execute positioned ${itemX} ${itemY} ${itemZ} as @e[type=item,distance=..2,sort=nearest,limit=1] run kill @s`
                            );
                            console.log('  pickup-wait cleanup:', cleanupResult.trim());
                            const cleanupDeadline = Date.now() + 2000;
                            while (Date.now() < cleanupDeadline && !collectSettled) {
                                await new Promise(resolve => setTimeout(resolve, 25));
                            }
                        } catch (cleanupError) {
                            console.log('  pickup-wait cleanup failed:', cleanupError.message);
                        }
                    }

                    bot.removeListener('goal_reached', onGoalReached);
                    bot.removeListener('entityGone', onEntityGone);
                    void collectPromise;
                }
            }
        }
    } catch (err) {
        record('D: cancel while waiting for pickup', 'FAIL', `${err.name}: ${err.message}`);
    }

    // ---- Test B: interrupt while the pathfinder is still searching (no path yet) ----
    try {
        const target = await prepareTestBlock(bot, 12, 'stone');
        if (!target) {
            record('B: cancel during A* search', 'SKIP', 'controlled target block was not created');
        } else {
            const oldTickTimeout = bot.pathfinder.tickTimeout;
            bot.pathfinder.tickTimeout = 1; // reliably expose the partial-search state
            const t0 = Date.now();
            const trace = (label, extra = '') =>
                console.log(`  [t+${String(Date.now() - t0).padStart(5)}ms] ${label}${extra ? ' :: ' + extra : ''}`);

            let sawEmptyPartial = false;
            let collectSettled = false;
            let collectError = null;
            const onPathUpdate = results => {
                if (results?.status === 'partial' && !bot.pathfinder.isMoving() && bot.pathfinder.goal) {
                    sawEmptyPartial = true;
                    trace('A* yielded partial with no executable path',
                        `visited=${results.visitedNodes} generated=${results.generatedNodes} goalActive=true`);
                }
            };
            bot.on('path_update', onPathUpdate);

            trace('starting collectBlock.collect(block)',
                `target=${target.name}@${target.position}`);
            const collectPromise = bot.collectBlock.collect(target).then(
                () => { collectSettled = true; trace('collect resolved'); },
                error => { collectSettled = true; collectError = error; trace('collect rejected', `${error.name}: ${error.message}`); },
            );

            const searchDeadline = Date.now() + 4000;
            while (Date.now() < searchDeadline && !sawEmptyPartial && !collectSettled) {
                await new Promise(resolve => setTimeout(resolve, 20));
            }

            if (!sawEmptyPartial) {
                record('B: cancel during A* search', 'SKIP',
                    collectSettled
                        ? 'collection completed before an empty partial-search state was observed'
                        : 'pathfinder did not expose an empty partial-search state within 4s');
                if (!collectSettled) {
                    await Promise.race([
                        bot.collectBlock.cancelTask().catch(() => {}),
                        new Promise(resolve => setTimeout(resolve, 2000)),
                    ]);
                }
            } else {
                trace('cancelling while A* has no path');
                const cancelPromise = bot.collectBlock.cancelTask();
                let cancelSettled = false;
                cancelPromise.then(
                    () => { cancelSettled = true; trace('cancelTask resolved'); },
                    error => { cancelSettled = true; trace('cancelTask rejected', `${error.name}: ${error.message}`); },
                );

                const deadline = Date.now() + 3000;
                while (Date.now() < deadline && !(collectSettled && cancelSettled)) {
                    await new Promise(resolve => setTimeout(resolve, 20));
                }

                if (collectSettled && cancelSettled && !collectError) {
                    record('B: cancel during A* search', 'PASS',
                        `collect and cancelTask both settled after ${Date.now() - t0}ms`);
                } else {
                    record('B: cancel during A* search', 'FAIL',
                        `collectSettled=${collectSettled} cancelSettled=${cancelSettled} collectError=${collectError?.name || 'none'}`);
                }
            }
            bot.removeListener('path_update', onPathUpdate);
            bot.pathfinder.tickTimeout = oldTickTimeout;
            // Ensure no active collection remains before the next test.
            if (bot.collectBlock && bot.pathfinder.goal) {
                await Promise.race([
                    bot.collectBlock.cancelTask().catch(() => {}),
                    new Promise(resolve => setTimeout(resolve, 1500)),
                ]);
            }
            // Keep the reference alive until the collection promise has had a chance to settle.
            void collectPromise;
        }
    } catch (err) {
        record('B: cancel during A* search', 'FAIL', `${err.name}: ${err.message}`);
        bot.pathfinder.tickTimeout = 40;
    }

    // ---- Test C: interruption while digging ----
    try {
        const dirt = await prepareTestBlock(bot, 4, 'stone');
        if (!dirt) {
            record('C: cancel while digging', 'SKIP', 'controlled target block was not created');
        } else {
            await bot.tool.equipForBlock(dirt, { requireHarvest: true, getFromChest: false, maxTools: 1 });
            // Start digging, then abort it the way requestInterrupt() does
            const digPromise = bot.dig(dirt);
            let digSettled = false;
            digPromise.then(() => digSettled = true, (e) => { digSettled = true; console.log('  dig rejected:', e.name, e.message); });
            await new Promise(r => setTimeout(r, 100));
            bot.stopDigging();
            const deadline = Date.now() + 8000;
            while (Date.now() < deadline && !digSettled) await new Promise(r => setTimeout(r, 100));
            const elapsed = 8000 - (deadline - Date.now());
            if (digSettled) {
                record('C: cancel while digging', 'PASS', `dig settled within ${elapsed}ms`);
            } else {
                record('C: cancel while digging', 'FAIL', `dig never settled after ${elapsed}ms`);
            }
        }
    } catch (err) {
        record('C: cancel while digging', 'FAIL', `${err.name}: ${err.message}`);
    }

    console.log('');
    console.log('=== SUMMARY ===');
    for (const r of results) {
        console.log(`${r.status.padEnd(5)} ${r.name}${r.detail ? ' :: ' + r.detail : ''}`);
    }
    const failures = results.filter(r => r.status === 'FAIL');
    console.log(`\n${results.length} tests, ${results.filter(r => r.status === 'PASS').length} pass, ${failures.length} fail, ${results.filter(r => r.status === 'SKIP').length} skip`);

    bot.quit();
    process.exit(failures.length > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('FATAL:', err);
    process.exit(2);
});
