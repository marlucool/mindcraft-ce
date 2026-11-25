# CornBotVL integration notes

## Startup-goal override

A profile may define startup_goal. The process-level STARTUP_GOAL environment
variable can override it without editing the profile:

- Unset: use the profile's configured goal.
- Non-empty: use the supplied goal for this process.
- Empty or whitespace-only: disable the profile goal for this process.

Example for an isolated staging run:

```sh
MINECRAFT_PORT=25566 MINDSERVER_PORT=8081 \
PROFILES='["./profiles/aperture-super-vl.json"]' \
STARTUP_GOAL='!inventory. Then perform only the staging smoke-test actions.' \
node main.js
```

Production coordinates remain in the profile; staging can override them
without committing a second profile copy.

## Safe chat test driver

The nine exported .cjs files were one-shot test clients with substantially
duplicated code, hard-coded port 25565, and fixed usernames. They are consolidated
into scripts/minecraft-chat-test.cjs.

The driver defaults to 127.0.0.1:25566 and refuses port 25565 unless
ALLOW_PRODUCTION_PORT=1 is explicitly set. Use it against an isolated test
server by default.

Examples:

```sh
node scripts/minecraft-chat-test.cjs --preset findvillage
node scripts/minecraft-chat-test.cjs --preset moveaway
node scripts/minecraft-chat-test.cjs --preset goals
node scripts/minecraft-chat-test.cjs --preset villagefocus
node scripts/minecraft-chat-test.cjs --message="find a village and build a base there"
```

Available presets: findvillage, moveaway, goals, villagecmd, villagefocus,
villagego, villageref, villagergo, and villagerprio.

Optional environment variables: MINECRAFT_HOST, MINECRAFT_PORT,
MINECRAFT_TEST_USERNAME, MESSAGE_INTERVAL_MS, and TEST_TIMEOUT_MS.

## bootstrap.mjs disposition

The exported bootstrap file only supplies placeholder File and FormData
classes for Node 18. This branch requires Node >=22.13.0, where those globals
are native. The placeholder classes are not a correct polyfill and should not
be used. The bootstrap file is therefore intentionally not carried forward.
