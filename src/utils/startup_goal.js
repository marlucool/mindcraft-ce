/**
 * Apply an optional process-level startup-goal override to a loaded profile.
 *
 * Undefined preserves the profile value. A non-empty string replaces it.
 * An empty/whitespace-only string removes it, explicitly disabling the goal.
 */
export function applyStartupGoalOverride(profile, override) {
    if (override === undefined) return profile;
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
        throw new TypeError('A profile object is required to apply STARTUP_GOAL.');
    }
    if (typeof override !== 'string') {
        throw new TypeError('STARTUP_GOAL must be a string.');
    }

    const normalized = override.trim();
    if (normalized.length === 0) {
        delete profile.startup_goal;
    } else {
        profile.startup_goal = normalized;
    }
    return profile;
}
