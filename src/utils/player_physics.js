/**
 * Keep Mineflayer's player collision width consistent with Minecraft's float32
 * representation of the 0.6-block player width.
 *
 * Mineflayer emits inject_allowed once its physics implementation is ready.
 * Register before the bot connects so the value is set before movement.
 *
 * @param {import('mineflayer').Bot} bot
 */
export function configurePlayerCollisionWidth(bot) {
    bot.once('inject_allowed', () => {
        bot.physics.playerHalfWidth = Math.fround(0.6) / 2;
    });
}
