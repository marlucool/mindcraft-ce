#!/usr/bin/env node
'use strict';

// Consolidated safe replacement for the exported one-shot chat test clients.
// Defaults to isolated Paper port 25566. Production port 25565 is blocked
// unless ALLOW_PRODUCTION_PORT=1 is explicitly supplied.

const mineflayer = require('mineflayer');
const presets = {
  findvillage: ['find village'],
  moveaway: ['move away 50'],
  goals: ['find village', 'get iron', 'build simple base'],
  villagecmd: ['find village'],
  villagefocus: ['keep searching for villagers and do not get distracted by other things'],
  villagego: ['find a village and build a base there'],
  villageref: ['keep searching villagers'],
  villagergo: ['go find villagers and build a base near them'],
  villagerprio: ['search for villagers now, ignore everything else']
};

function readArg(name) {
  const prefix = '--' + name + '=';
  const inline = process.argv.find(arg => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf('--' + name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const presetName = readArg('preset') || 'findvillage';
const customMessage = readArg('message');
const messages = customMessage ? [customMessage] : presets[presetName];
if (!messages || messages.some(message => typeof message !== 'string' || !message.trim())) {
  console.error('Unknown preset. Available presets: ' + Object.keys(presets).join(', '));
  process.exit(2);
}

const host = process.env.MINECRAFT_HOST || '127.0.0.1';
const port = Number.parseInt(process.env.MINECRAFT_PORT || '25566', 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('MINECRAFT_PORT must be an integer from 1 to 65535.');
  process.exit(2);
}
if (port === 25565 && process.env.ALLOW_PRODUCTION_PORT !== '1') {
  console.error('Refusing production port 25565. Use isolated test port 25566.');
  process.exit(2);
}

const username = process.env.MINECRAFT_TEST_USERNAME || 'ChatTest';
const intervalMs = Number.parseInt(process.env.MESSAGE_INTERVAL_MS || '15000', 10);
const timeoutMs = Number.parseInt(process.env.TEST_TIMEOUT_MS || '120000', 10);
if (!Number.isInteger(intervalMs) || intervalMs < 1000 ||
    !Number.isInteger(timeoutMs) || timeoutMs < 5000) {
  console.error('MESSAGE_INTERVAL_MS must be >=1000 and TEST_TIMEOUT_MS must be >=5000.');
  process.exit(2);
}

console.log('Connecting test driver ' + username + ' to ' + host + ':' + port + '; preset=' + presetName);
const bot = mineflayer.createBot({ host, port, username, version: false });
let index = 0;
let finished = false;

function finish(code) {
  if (finished) return;
  finished = true;
  clearTimeout(watchdog);
  try { bot.end(); } catch {}
  setTimeout(() => process.exit(code || 0), 250);
}

const watchdog = setTimeout(() => {
  console.error('Test driver timed out.');
  finish(1);
}, timeoutMs);

bot.once('spawn', () => {
  console.log(username + ' spawned on ' + host + ':' + port);
  const sendNext = () => {
    if (finished) return;
    if (index >= messages.length) {
      console.log('All test messages sent.');
      finish(0);
      return;
    }
    const message = messages[index++];
    console.log('[TEST CHAT] ' + message);
    bot.chat(message);
    if (index < messages.length) setTimeout(sendNext, intervalMs);
    else setTimeout(() => finish(0), 8000);
  };
  setTimeout(sendNext, 3000);
});

bot.on('message', message => console.log('[SERVER] ' + message.toString()));
bot.once('end', () => {
  console.log('Test driver disconnected.');
  if (!finished) finish(0);
});
bot.once('error', error => {
  console.error('Test driver error:', error.message);
  finish(1);
});
process.once('SIGINT', () => finish(130));
process.once('SIGTERM', () => finish(143));
