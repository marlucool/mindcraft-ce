/**
 * A task must have stable identity and a type before it can control agent/server lifecycle.
 */
export function isValidTaskDefinition(task) {
    return Boolean(
        task
        && typeof task === 'object'
        && !Array.isArray(task)
        && typeof task.task_id === 'string'
        && task.task_id.trim().length > 0
        && typeof task.type === 'string'
        && task.type.trim().length > 0
    );
}
