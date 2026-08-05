// Lancement de processus externes (yt-dlp, ffmpeg) : jamais de shell, arguments en tableau.
import { spawn } from 'node:child_process';

export class ProcessError extends Error {
  constructor(message, { code, stderr }) {
    super(message);
    this.exitCode = code;
    this.stderr = stderr;
  }
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ onStdout?: (line: string) => void, onStderr?: (line: string) => void,
 *           timeoutMs?: number, signal?: AbortSignal, onSpawn?: (child) => void }} [options]
 */
export function run(command, args, options = {}) {
  const { onStdout, onStderr, timeoutMs, signal, onSpawn } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    onSpawn?.(child);

    let stderrTail = '';
    let settled = false;
    let timer = null;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn(value);
    };

    const onAbort = () => {
      child.kill('SIGKILL');
      finish(reject, Object.assign(new Error('aborted'), { aborted: true }));
    };

    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }

    if (timeoutMs) {
      timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(reject, Object.assign(new Error('timeout'), { timedOut: true }));
      }, timeoutMs);
    }

    lineReader(child.stdout, (line) => onStdout?.(line));
    lineReader(child.stderr, (line) => {
      stderrTail = `${stderrTail}${line}\n`.slice(-4000);
      onStderr?.(line);
    });

    child.on('error', (error) => {
      finish(reject, new ProcessError(`${command}: ${error.message}`, { code: null, stderr: error.message }));
    });

    child.on('close', (code) => {
      if (code === 0) finish(resolve, { stderr: stderrTail });
      else finish(reject, new ProcessError(`${command} exited with ${code}`, { code, stderr: stderrTail }));
    });
  });
}

function lineReader(stream, onLine) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    // yt-dlp utilise \r pour rafraîchir sa ligne de progression.
    const parts = buffer.split(/\r\n|\r|\n/);
    buffer = parts.pop() ?? '';
    for (const line of parts) if (line.trim()) onLine(line.trim());
  });
  stream.on('end', () => {
    if (buffer.trim()) onLine(buffer.trim());
  });
}

/** Vérifie la présence d'un binaire au démarrage. */
export async function checkBinary(command, args = ['--version']) {
  try {
    await run(command, args, { timeoutMs: 10_000 });
    return true;
  } catch {
    return false;
  }
}
