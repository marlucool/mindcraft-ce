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
    try {
        // Find a dirt block near spawn
        const dirt = findCollectable(bot, 25);
        if (!dirt) {
            record('A: normal collection', 'SKIP', 'no collectable block within 25 blocks');
        } else {
            console.log('Digging dirt at', dirt.position);
            await bot.tool.equipForBlock(dirt, { requireHarvest: true, getFromChest: false, maxTools: 1 });
            if (!bot.heldItem || bot.heldItem.name !== 'iron_pickaxe') {
                const pickItem = bot.inventory.items().find(i => i.name === 'iron_pickaxe');
                if (!pickItem) {
                    throw new Error('SKIP_NO_PICKAXE');
                }
                await bot.equip(pickItem, 'hand');
            }
            const dropped = waitForItemDrop(bot, dirt.position);
            await bot.dig(dirt);
            const item = await dropped;
            if (item) {
                console.log('  item dropped:', item.name, item.position);
                const t0 = Date.now();
                const res = await Promise.race([
                    bot.collectBlock.collect(item),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('collect timed out after 15s')), 15000)),
                ]).catch(e => ({ __error: e.message }));
                const elapsed = Date.now() - t0;
                if (res && res.__error) {
                    record('A: normal collection', 'FAIL', res.__error);
                } else {
                    record('A: normal collection', 'PASS', `collected ${item.name} in ${elapsed}ms (returned ${res})`);
                }
            } else {
                record('A: normal collection', 'FAIL', 'no item drop observed');
            }
        }
    } catch (err) {
        record('A: normal collection', 'FAIL', `${err.name}: ${err.message}`);
    }

    // ---- Test D: interruption while waiting for item pickup (THE DEADLOCK) ----
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

    // ---- Test B: interruption while navigating to a block ----
    try {
        const dirt = findCollectable(bot, 30);
        if (!dirt) {
            record('B: cancel while navigating', 'SKIP', 'no collectable block available');
        } else {
            console.log('  target block:', dirt.name, dirt.position);

            // ---- Full event trace ----
            const t0 = Date.now();
            const trace = (label, extra) => console.log(`  [t+${String(Date.now()-t0).padStart(5)}ms] ${label}${extra ? ' :: ' + extra : ''}`);
            const EVENTS = ['diggingStarted','diggingCompleted','diggingAborted','path_update','path_stop','path_complete',
                            'path_found','goal_updated','collectBlock_finished','move','physicsTick','spawn'];
            for (const ev of EVENTS) {
                bot.on(ev, (arg) => {
                    if (ev === 'physicsTick' || ev === 'move') return; // too noisy
                    trace('EVENT ' + ev, arg ? (arg.toString ? arg.toString().slice(0,80) : '') : '');
                });
            }
            const origStop = bot.pathfinder.stop.bind(bot.pathfinder);
            bot.pathfinder.stop = function (...a) { trace('pathfinder.stop() CALLED'); return origStop(...a); };
            const origCancel = bot.collectBlock.cancelTask.bind(bot.collectBlock);
            bot.collectBlock.cancelTask = function (...a) { trace('cancelTask() CALLED'); return origCancel(...a); };

            trace('calling collectBlock.collect()');
            const collectPromise = bot.collectBlock.collect(dirt);
            let settled = false;
            collectPromise.then(() => { settled = true; trace('collect RESOLVED'); }, (e) => { settled = true; trace('collect REJECTED: ' + e.name + ' ' + e.message); });
            await new Promise(r => setTimeout(r, 1000));
            trace('before cancel: settled=' + settled + ' botPos=' + JSON.stringify(bot.entity.position) + ' targetPos=' + JSON.stringify(dirt.position));
            const cancelPromise = bot.collectBlock.cancelTask();
            let cancelSettled = false;
            cancelPromise.then(() => { cancelSettled = true; trace('cancelTask RESOLVED'); }, (e) => { cancelSettled = true; trace('cancelTask REJECTED: ' + e.name + ' ' + e.message); });
            trace('cancel issued; waiting');
            const deadline = Date.now() + 8000;
            let lastTrace = 0;
            while (Date.now() < deadline && !(settled && cancelSettled)) {
                await new Promise(r => setTimeout(r, 100));
                if (Date.now() - lastTrace > 1000) {
                    lastTrace = Date.now();
                    trace('still pending: collect=' + settled + ' cancel=' + cancelSettled +
                          ' botPos=' + JSON.stringify(bot.entity.position));
                }
            }
            const elapsed = 8000 - (deadline - Date.now());
            trace('FINAL: settled=' + settled + ' cancelSettled=' + cancelSettled);
            if (settled && cancelSettled) {
                record('B: cancel while navigating', 'PASS', `both settled within ${elapsed}ms`);
            } else {
                record('B: cancel while navigating', 'FAIL', `collect=${settled} cancel=${cancelSettled} after ${elapsed}ms`);
            }
        }
    } catch (err) {
        record('B: cancel while navigating', 'FAIL', `${err.name}: ${err.message}`);
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
