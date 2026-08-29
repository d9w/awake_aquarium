#!/usr/bin/env node

import { existsSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import process from "node:process";
import { Aquarium } from "./aquarium.js";
import {
  describeAssertions,
  hasUtility,
  parseArgs,
  timeoutSeconds,
  UsageError,
} from "./args.js";
import { TerminalAquarium } from "./terminal.js";

const VERSION = "0.1.0";
const DEFAULT_CAFFEINATE = "/usr/bin/caffeinate";

const HELP = `awake-aquarium ${VERSION}

Keep macOS awake with a tiny aquarium in your terminal.

Usage:
  awake-aquarium [aquarium options] [caffeinate options]
  awake-aquarium [caffeinate options] -- command [arguments...]

Aquarium options:
  --theme <name>    ocean, midnight, or coral (default: ocean)
  --fps <1-30>      animation speed (default: 8)
  --seed <text>     reproduce the same school of fish
  --no-color        use plain ASCII without ANSI colors
  --no-animation    behave like ordinary caffeinate
  -h, --help        show this help
  -V, --version     show the version

Native caffeinate options (passed to /usr/bin/caffeinate):
  -d                prevent display sleep
  -i                prevent idle system sleep
  -m                prevent disk idle
  -s                prevent system sleep while on AC power
  -u                declare the user active
  -t <seconds>      stop after a timeout
  -w <pid>          stop when a process exits

While swimming:
  f feed    b/space bubbles    t theme    p pause    ? help    q quit

Examples:
  awake-aquarium
  awake-aquarium -i -t 3600
  awake-aquarium --theme midnight -w 12345
  awake-aquarium -i -- npm test

The aquarium is shown for assertion-only runs. When a utility command is
provided, animation is disabled automatically so the utility keeps normal I/O.
Run the aquarium in its own tmux pane to watch it beside an experiment.
`;

function signalExitCode(signal: NodeJS.Signals): number {
  return signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1;
}

async function waitForSpawn(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
}

async function run(): Promise<number> {
  let options;
  try {
    options = parseArgs(process.argv.slice(2), {
      ...(process.env.NO_COLOR === undefined ? {} : { noColor: process.env.NO_COLOR }),
    });
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`awake-aquarium: ${error.message}\nTry 'awake-aquarium --help'.\n`);
      return 2;
    }
    throw error;
  }

  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (options.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const caffeinatePath = process.env.AWAKE_AQUARIUM_CAFFEINATE ?? DEFAULT_CAFFEINATE;
  if (!existsSync(caffeinatePath)) {
    process.stderr.write(
      `awake-aquarium: '${caffeinatePath}' was not found. This command requires macOS caffeinate.\n`,
    );
    return 1;
  }

  const utilityMode = hasUtility(options.caffeinateArgs);
  const wantsAnimation = options.animation && !utilityMode;
  const canUseTerminal = process.stdin.isTTY === true && process.stdout.isTTY === true;
  const animated = wantsAnimation && canUseTerminal;
  const child = spawn(caffeinatePath, options.caffeinateArgs, {
    stdio: animated ? ["ignore", "ignore", "pipe"] : "inherit",
  });
  // Register immediately: a short utility or `-t 0` can finish before the UI
  // has completed its setup.
  const childResult = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });

  try {
    await waitForSpawn(child);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`awake-aquarium: could not start caffeinate: ${message}\n`);
    return 1;
  }

  let capturedError = "";
  if (animated && child.stderr !== null) {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      capturedError = `${capturedError}${chunk}`.slice(-8192);
    });
  }

  const aquarium = new Aquarium(options.seed, options.theme, describeAssertions(options.caffeinateArgs));
  const nativeTimeout = timeoutSeconds(options.caffeinateArgs);
  const terminal = new TerminalAquarium(aquarium, {
    color: options.color,
    fps: options.fps,
    ...(nativeTimeout === undefined ? {} : { timeoutSeconds: nativeTimeout }),
  });

  let requestedSignal: NodeJS.Signals | undefined;
  let forceKillTimer: NodeJS.Timeout | undefined;
  const stopChild = (signal: NodeJS.Signals): void => {
    if (requestedSignal !== undefined) return;
    requestedSignal = signal;
    terminal.stop();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
      forceKillTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 1500);
      forceKillTimer.unref();
    }
  };

  const sigintHandler = (): void => stopChild("SIGINT");
  const sigtermHandler = (): void => stopChild("SIGTERM");
  const sigcontHandler = (): void => {
    if (requestedSignal === undefined && animated) {
      terminal.start(sigintHandler, suspendHandler);
    }
  };
  const suspendHandler = (): void => {
    terminal.stop();
    process.kill(process.pid, "SIGTSTP");
  };

  process.on("SIGINT", sigintHandler);
  process.on("SIGTERM", sigtermHandler);
  process.on("SIGCONT", sigcontHandler);
  if (animated) terminal.start(sigintHandler, suspendHandler);

  const result = await childResult;

  terminal.stop();
  if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
  process.off("SIGINT", sigintHandler);
  process.off("SIGTERM", sigtermHandler);
  process.off("SIGCONT", sigcontHandler);

  if (capturedError.trim().length > 0) process.stderr.write(capturedError);
  if (requestedSignal !== undefined) return signalExitCode(requestedSignal);
  if (result.code !== null) return result.code;
  return result.signal === "SIGINT" ? 130 : result.signal === "SIGTERM" ? 143 : 1;
}

run()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`awake-aquarium: ${message}\n`);
    process.exitCode = 1;
  });
