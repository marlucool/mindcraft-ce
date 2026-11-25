/**
 * Apply request options for local OpenAI-compatible Qwen servers.
 *
 * Some LM Studio Qwen templates support this option to disable reasoning output
 * for command-oriented turns. Preserve any caller-supplied template options.
 *
 * @param {string} model
 * @param {Record<string, any>} request
 * @returns {Record<string, any>}
 */
export function applyLocalModelOptions(model, request) {
    if (typeof model === 'string' && model.toLowerCase().includes('qwen')) {
        request.chat_template_kwargs = {
            ...(request.chat_template_kwargs || {}),
            enable_thinking: false,
        };
    }
    return request;
}

/**
 * OpenAI-compatible Qwen providers may return the user-visible response in
 * reasoning_content while leaving message.content empty.
 *
 * @param {any} completion
 * @returns {string}
 */
export function extractCompletionText(completion) {
    const message = completion?.choices?.[0]?.message;
    const content = message?.content;
    if (typeof content === 'string' && content.length > 0) return content;
    const reasoning = message?.reasoning_content;
    return typeof reasoning === 'string' ? reasoning : '';
}
