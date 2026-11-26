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

/**
 * Resolve a task selected from a task JSON file without dereferencing a missing ID.
 * The object key is the authoritative task ID, so the returned task is a fresh copy.
 */
export function resolveTaskDefinition(taskMap, taskId) {
    if (!taskMap || typeof taskMap !== 'object' || Array.isArray(taskMap)) {
        throw new TypeError('Task file must contain a JSON object keyed by task ID.');
    }
    if (typeof taskId !== 'string' || taskId.trim().length === 0) {
        throw new TypeError('A non-empty task_id is required.');
    }

    const selectedTask = taskMap[taskId];
    if (!selectedTask || typeof selectedTask !== 'object' || Array.isArray(selectedTask)) {
        throw new Error(`Task "${taskId}" was not found in the task file.`);
    }

    const task = { ...selectedTask, task_id: taskId };
    if (!isValidTaskDefinition(task)) {
        throw new Error(`Task "${taskId}" is invalid: a non-empty task_id and type are required.`);
    }
    return task;
}
