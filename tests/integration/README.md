# Live integration tests

These tests connect a real bot to a Minecraft server and exercise behaviour that
cannot be covered by the unit tests in `tests/`.

They are **not** part of `npm test` and are not run automatically. They need a
running server and, for the collection tests, RCON access so the bot can be given
a pickaxe.

## Safety

- The harness only ever connects to the host/port given by `CE_TEST_HOST` /
  `CE_TEST_PORT`. The defaults point at the **isolated** test server (25566).
  It never connects to the production server (25565).
- The harness digs blocks and teleports dropped item entities. That changes the
  world it runs against, so it must only be pointed at a disposable test server.
- No credentials are stored in the repository. The RCON password is read from the
  environment.

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `CE_TEST_HOST` | `127.0.0.1` | Server host |
| `CE_TEST_PORT` | `25566` | Server port |
| `CE_TEST_RCON_PORT` | `25576` | RCON port |
| `CE_TEST_RCON_PASSWORD` | *(required)* | RCON password |
| `CE_TEST_BOT` | `CETestBot` | Bot username |
| `CE_TEST_VERSION` | `1.21.11` | Minecraft version |

## Running

```bash
CE_TEST_RCON_PASSWORD='<password>' node --max-old-space-size=1024 \
    tests/integration/collect_live_test.mjs
```

## What it covers

| Test | What it exercises |
|------|-------------------|
| A: normal collection | Collecting a real dropped item entity |
| B: cancel while navigating | `cancelTask()` during pathfinding to a block |
| C: cancel while digging | `bot.stopDigging()` during an active dig |
| D: cancel while waiting for pickup | `cancelTask()` while the plugin is blocked on its internal `waitForPickup` |

The watchdog timeout in `src/agent/coder.js` is **not** modified by these tests;
the harness bounds its own waits so a hang is reported rather than masked.
