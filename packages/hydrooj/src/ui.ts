/* eslint-disable @typescript-eslint/no-shadow */
import { Logger } from './logger';
import * as bus from './service/bus';

async function terminate() {
    let hasError = false;
    try {
        await bus.parallel('app/exit');
    } catch (e) {
        hasError = true;
    }
    process.exit(hasError ? 1 : 0);
}
process.on('SIGINT', terminate);

const shell = new Logger('shell');
async function executeCommand(input: string) {
    input = input.trim();
    // Clear the stack
    setImmediate(async () => {
        if (input === 'exit' || input === 'quit' || input === 'shutdown') {
            return process.kill(process.pid, 'SIGINT');
        }
        if (process.stdin.isRaw) return false;
        try {
            // eslint-disable-next-line no-eval
            shell.info(await eval(input));
        } catch (e) {
            shell.warn(e);
        }
        return true;
    });
}

process.stdin.setEncoding('utf-8');
process.stdin.setRawMode?.(false);
process.stdin.on('data', (buf) => {
    const input = buf.toString();
    executeCommand(input);
});
