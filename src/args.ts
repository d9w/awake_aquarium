export const THEME_NAMES = ["ocean", "midnight", "coral"] as const;

export type ThemeName = (typeof THEME_NAMES)[number];

export interface CliOptions {
  animation: boolean;
  caffeinateArgs: string[];
  color: boolean;
  fps: number;
  help: boolean;
  seed: string;
  theme: ThemeName;
  version: boolean;
}

export class UsageError extends Error {
  override readonly name = "UsageError";
}

interface ParseEnvironment {
  noColor?: string;
  now?: number;
  pid?: number;
}

const FPS_MIN = 1;
const FPS_MAX = 30;

function takeValue(argv: string[], index: number, option: string): [string, number] {
  const value = argv[index + 1];
  if (value === undefined) {
    throw new UsageError(`${option} needs a value`);
  }
  return [value, index + 1];
}

function parseFps(raw: string): number {
  const fps = Number(raw);
  if (!Number.isInteger(fps) || fps < FPS_MIN || fps > FPS_MAX) {
    throw new UsageError(`--fps must be a whole number from ${FPS_MIN} to ${FPS_MAX}`);
  }
  return fps;
}

function parseTheme(raw: string): ThemeName {
  if ((THEME_NAMES as readonly string[]).includes(raw)) {
    return raw as ThemeName;
  }
  throw new UsageError(`unknown theme '${raw}' (choose ${THEME_NAMES.join(", ")})`);
}

export function parseArgs(argv: string[], environment: ParseEnvironment = {}): CliOptions {
  const now = environment.now ?? Date.now();
  const pid = environment.pid ?? process.pid;
  const options: CliOptions = {
    animation: true,
    caffeinateArgs: [],
    color: environment.noColor === undefined,
    fps: 8,
    help: false,
    seed: `${now}-${pid}`,
    theme: "ocean",
    version: false,
  };

  let nativeValueExpected = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) continue;

    if (nativeValueExpected) {
      options.caffeinateArgs.push(argument);
      nativeValueExpected = false;
      continue;
    }

    // Everything after -- belongs verbatim to caffeinate/the utility.
    if (argument === "--") {
      options.caffeinateArgs.push(...argv.slice(index));
      break;
    }

    if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--version" || argument === "-V") {
      options.version = true;
    } else if (argument === "--no-animation") {
      options.animation = false;
    } else if (argument === "--no-color") {
      options.color = false;
    } else if (argument === "--color") {
      options.color = true;
    } else if (argument === "--fps") {
      const [value, nextIndex] = takeValue(argv, index, argument);
      options.fps = parseFps(value);
      index = nextIndex;
    } else if (argument.startsWith("--fps=")) {
      options.fps = parseFps(argument.slice("--fps=".length));
    } else if (argument === "--seed") {
      const [value, nextIndex] = takeValue(argv, index, argument);
      options.seed = value;
      index = nextIndex;
    } else if (argument.startsWith("--seed=")) {
      options.seed = argument.slice("--seed=".length);
    } else if (argument === "--theme") {
      const [value, nextIndex] = takeValue(argv, index, argument);
      options.theme = parseTheme(value);
      index = nextIndex;
    } else if (argument.startsWith("--theme=")) {
      options.theme = parseTheme(argument.slice("--theme=".length));
    } else {
      options.caffeinateArgs.push(argument);
      if (optionConsumesNext(argument)) {
        nativeValueExpected = true;
      } else if (!argument.startsWith("-")) {
        // This is the utility name. Its remaining arguments are not ours.
        options.caffeinateArgs.push(...argv.slice(index + 1));
        break;
      }
    }
  }

  return options;
}

function optionConsumesNext(argument: string): boolean {
  if (argument === "-t" || argument === "-w") return true;
  // Apple's getopt accepts combined assertion switches such as -it 60.
  return /^-[dimsu]*[tw]$/.test(argument);
}

export function hasUtility(args: string[]): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) continue;
    if (argument === "--") return index + 1 < args.length;
    if (optionConsumesNext(argument)) {
      index += 1;
      continue;
    }
    if (!argument.startsWith("-")) return true;
  }
  return false;
}

export function timeoutSeconds(args: string[]): number | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "-t" || (argument !== undefined && /^-[dimsu]*t$/.test(argument))) {
      const value = Number(args[index + 1]);
      return Number.isFinite(value) && value >= 0 ? value : undefined;
    }
  }
  return undefined;
}

export function describeAssertions(args: string[]): string {
  const descriptions: string[] = [];
  const switches = new Set<string>();
  let watchedPid: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) continue;
    if (argument === "--") break;
    if (/^-[dimsutw]+$/.test(argument)) {
      for (const character of argument.slice(1)) {
        if ("dimsu".includes(character)) switches.add(character);
      }
      if (optionConsumesNext(argument)) {
        if (argument.endsWith("w")) watchedPid = args[index + 1];
        index += 1;
      }
    }
  }

  if (switches.has("d")) descriptions.push("display");
  if (switches.has("i")) descriptions.push("idle");
  if (switches.has("m")) descriptions.push("disk");
  if (switches.has("s")) descriptions.push("system");
  if (switches.has("u")) descriptions.push("user");
  if (descriptions.length === 0) descriptions.push("idle");
  if (watchedPid !== undefined) descriptions.push(`pid ${watchedPid}`);
  return descriptions.join("+");
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const padded = (value: number): string => value.toString().padStart(2, "0");
  return hours > 0
    ? `${hours.toString()}:${padded(minutes)}:${padded(remainder)}`
    : `${padded(minutes)}:${padded(remainder)}`;
}
