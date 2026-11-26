import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { logoutAgent } from '../mindcraft/mindserver.js';

const init_agent_path = fileURLToPath(new URL('./init_agent.js', import.meta.url));

export const MAX_AGENT_RESTART_ATTEMPTS = 5;
const STABLE_AGENT_RUNTIME_MS = 60_000;
const MAX_AGENT_RESTART_DELAY_MS = 10_000;

export function shouldRestartAgent(code, signal) {
    return code !== 0 && code <= 1 && signal !== 'SIGINT';
}

export function getAgentRestartDelay(attempt) {
    if (!Number.isInteger(attempt) || attempt < 1) {
        throw new RangeError('Restart attempt must be a positive integer.');
    }
    return Math.min(1000 * (2 ** (attempt - 1)), MAX_AGENT_RESTART_DELAY_MS);
}

export class AgentProcess {
    constructor(name, port, process_token) {
        this.name = name;
        this.port = port;
        this.process_token = process_token;
        this.restartAttempts = 0;
        this.restartTimer = null;
    }

    start(load_memory=false, init_message=null, count_id=0) {
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }

        this.count_id = count_id;
        this.running = true;
        const startedAt = Date.now();

        let args = [init_agent_path, this.name];
        args.push('-n', this.name);
        args.push('-c', count_id);
        if (load_memory)
            args.push('-l', load_memory);
        if (init_message)
            args.push('-m', init_message);
        args.push('-p', this.port);

        const agentEnv = { ...process.env, MINDCRAFT_AGENT_TOKEN: this.process_token };
        delete agentEnv.MINDCRAFT_CONTROL_TOKEN;
        const agentProcess = spawn(process.execPath, args, {
            stdio: 'inherit',
            stderr: 'inherit',
            env: agentEnv,
        });

        agentProcess.on('exit', (code, signal) => {
            console.log(`Agent process exited with code ${code} and signal ${signal}`);
            this.running = false;
            if (this.process === agentProcess) this.process = null;
            logoutAgent(this.name);

            // Exit codes >1 retain their existing meaning: terminate the task/server.
            if (code > 1) {
                console.log('Ending task');
                process.exit(code);
                return;
            }

            if (!shouldRestartAgent(code, signal)) return;

            // A process that was stable for a minute starts a fresh retry budget.
            if (Date.now() - startedAt >= STABLE_AGENT_RUNTIME_MS) {
                this.restartAttempts = 0;
            }

            this.restartAttempts += 1;
            if (this.restartAttempts > MAX_AGENT_RESTART_ATTEMPTS) {
                console.error(
                    `Agent ${this.name} exceeded ${MAX_AGENT_RESTART_ATTEMPTS} consecutive restart attempts; `
                    + 'leaving it stopped for operator inspection.'
                );
                return;
            }

            const delay = getAgentRestartDelay(this.restartAttempts);
            console.warn(
                `Agent ${this.name} exited unexpectedly; restart ${this.restartAttempts}/`
                + `${MAX_AGENT_RESTART_ATTEMPTS} in ${delay}ms.`
            );
            this.restartTimer = setTimeout(() => {
                this.restartTimer = null;
                this.start(true, 'Agent process restarted.', count_id);
            }, delay);
        });

        agentProcess.on('error', (err) => {
            console.error('Agent process error:', err);
        });

        this.process = agentProcess;
    }

    stop() {
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
        if (!this.running || !this.process) return;
        this.process.kill('SIGINT');
    }

    forceRestart() {
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
        this.restartAttempts = 0;

        if (this.running && this.process && !this.process.killed) {
            console.log(`Agent process for ${this.name} is still running. Attempting to force restart.`);

            const restartTimeout = setTimeout(() => {
                console.warn(`Agent ${this.name} did not stop in time. It might be stuck.`);
            }, 5000); // 5 seconds to exit

            this.process.once('exit', () => {
                 clearTimeout(restartTimeout);
                 console.log(`Stopped hanging agent ${this.name}. Now restarting.`);
                 this.start(true, 'Agent process restarted.', this.count_id);
            });
            this.stop(); // sends SIGINT
        } else {
             this.start(true, 'Agent process restarted.', this.count_id);
        }
    }
}
