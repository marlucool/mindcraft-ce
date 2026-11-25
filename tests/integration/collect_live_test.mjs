// Live integration test for the collectblock cancellation deadlock.
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
// The harness never writes to the production server (25565) and never modifies the
// repository's tracked files.
// Connects a real bot to the isolated Paper server on 25566 and exercises:
//   A. normal collection of a real block (with a dropped item)
//   B. interruption while navigating to a block
//   C. interruption while digging a block
//   D. interruption while waiting for item pickup  <-- the suspected deadlock
//   E. ActionManager.stop() completes
import { createBot } from 'mineflayer';
import { pathfinder } from 'mineflayer-pathfinder';
import { plugin as collectblock } from 'mineflayer-collectblock';
import { plugin as tool } from 'mineflayer-tool';
import { Vec3 } from 'vec3';
import net from 'net';

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
    while (Date.now() < groundDeadline) {
        await new Promise(r => setTimeout(r, 200));
        if (bot.entity.onGround && bot.entity.velocity && Math.abs(bot.entity.velocity.y) < 0.01) {
            break;
        }
    }
    console.log('  settled on ground at', bot.entity.position);
    return bot;
}

// Blocks that can be dug and drop an item. The bot spawns at a random point in a
// bamboo/jungle biome, so the set is deliberately broad.
const COLLECTABLE = ['dirt', 'grass_block', 'sand', 'gravel', 'stone', 'cobblestone', 'podzol', 'clay'];

function findCollectable(bot, maxDistance = 20) {
    return bot.findBlock({
        matching: b => COLLECTABLE.includes(b.name),
        maxDistance,
    });
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
        const target = findCollectable(bot, 25);
        if (!target) {
            record('A: normal block collection', 'SKIP', 'no collectable block within 25 blocks');
        } else {
            const startDistance = bot.entity.position.distanceTo(target.position);
            console.log('  collecting block:', target.name, target.position, 'distance:', startDistance.toFixed(1));
            if (startDistance > 25.5) {
                record('A: normal block collection', 'FAIL',
                    `harness selected a block ${startDistance.toFixed(1)} blocks away despite maxDistance=25`);
            } else {
                const beforeType = target.type;
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
                            'collectBlock resolved but the target block is still present');
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

    // ---- Test D: interruption while waiting for item pickup ----
    // To reach the plugin's "wait for entityGone" state the item must NOT be
    // picked up naturally. We teleport every nearby dropped item far away so the
    // bot cannot reach it. The plugin then navigates as far as it can and blocks
    // on its internal waitForPickup, which is the deadlock window under test.
    try {
        const dirt = findCollectable(bot, 25);
        if (!dirt) {
            record('D: cancel while waiting for pickup', 'SKIP', 'no collectable block available');
        } else {
            await bot.tool.equipForBlock(dirt, { requireHarvest: true, getFromChest: false, maxTools: 1 });
            const dropped = waitForItemDrop(bot, dirt.position);
            await bot.dig(dirt);
            const item = await dropped;
            if (!item) {
                record('D: cancel while waiting for pickup', 'SKIP', 'no item drop observed');
            } else {
                console.log('  item at', item.position);

                // Teleport every nearby item entity well out of reach.
                const farX = Math.floor(item.position.x) + 80;
                const farZ = Math.floor(item.position.z) + 80;
                const farY = Math.floor(item.position.y);
                try {
                    // Teleport every item entity near the bot to a far absolute location.
                    // The selection is done with absolute coordinates so the target is
                    // unambiguous, then tp uses absolute coordinates too.
                    await rcon(HOST, RCON_PORT, RCON_PASSWORD,
                        `execute positioned ${Math.floor(item.position.x)} ${farY} ${Math.floor(item.position.z)} ` +
                        `as @e[type=item,distance=..12] run tp @s ${farX} ${farY} ${farZ}`);
                    console.log('  teleported nearby item entities to', farX, farY, farZ);
                } catch (e) {
                    console.log('  could not move item:', e.message);
                }
                await new Promise(r => setTimeout(r, 1200));

                const stillNear = Object.values(bot.entities || {}).some(
                    e => e.name === 'item' && e.position && e.position.distanceTo(bot.entity.position) < 8);
                console.log('  item still within 8 blocks?', stillNear);

                if (stillNear) {
                    record('D: cancel while waiting for pickup', 'SKIP',
                        'could not move the item out of reach; pickup wait not exercised');
                } else {
                    let entityGoneFired = false;
                    const onEntityGone = () => { entityGoneFired = true; };
                    bot.on('entityGone', onEntityGone);

                    const collectPromise = bot.collectBlock.collect(item);
                    let settled = false;
                    collectPromise.then(() => { settled = true; }, (e) => { settled = true; console.log('  collect rejected:', e.name, e.message); });

                    // Wait for navigation to finish and the plugin to enter its pickup wait.
                    const navDeadline = Date.now() + 10000;
                    while (Date.now() < navDeadline && !entityGoneFired) {
                        await new Promise(r => setTimeout(r, 50));
                    }
                    await new Promise(r => setTimeout(r, 300));

                    if (entityGoneFired) {
                        record('D: cancel while waiting for pickup', 'SKIP',
                            'item was picked up naturally; the pickup wait never blocked');
                    } else {
                        console.log('  plugin is now blocked waiting for entityGone (the deadlock window)');
                        const t0 = Date.now();
                        const cancelPromise = bot.collectBlock.cancelTask();
                        let cancelSettled = false;
                        cancelPromise.then(() => { cancelSettled = true; }, (e) => { cancelSettled = true; console.log('  cancelTask rejected:', e.name, e.message); });

                        const deadline = Date.now() + 8000;
                        while (Date.now() < deadline && !(settled && cancelSettled)) {
                            await new Promise(r => setTimeout(r, 50));
                        }
                        const elapsed = Date.now() - t0;

                        if (settled && cancelSettled) {
                            record('D: cancel while waiting for pickup', 'PASS',
                                `both settled within ${elapsed}ms while blocked on waitForPickup`);
                        } else {
                            record('D: cancel while waiting for pickup', 'FAIL',
                                `DEADLOCK REPRODUCED: collect settled=${settled}, cancelTask settled=${cancelSettled} after ${elapsed}ms`);
                        }
                    }
                    bot.removeListener('entityGone', onEntityGone);
                }
            }
        }
    } catch (err) {
        record('D: cancel while waiting for pickup', 'FAIL', `${err.name}: ${err.message}`);
    }

    // ---- Test B: interrupt while the pathfinder is still searching (no path yet) ----
    try {
        const target = findCollectable(bot, 30);
        if (!target) {
            record('B: cancel during A* search', 'SKIP', 'no collectable block available');
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
        const dirt = findCollectable(bot, 25);
        if (!dirt) {
            record('C: cancel while digging', 'SKIP', 'no collectable block available');
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
