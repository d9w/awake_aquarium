import { performance } from "node:perf_hooks";
import type { Aquarium } from "./aquarium.js";

const ENTER_SCREEN = "\u001b[?1049h\u001b[2J\u001b[H\u001b[?25l\u001b[?7l";
const LEAVE_SCREEN = "\u001b[0m\u001b[?7h\u001b[?25h\u001b[?1049l";

export interface TerminalAquariumOptions {
  color: boolean;
  fps: number;
  timeoutSeconds?: number;
}

export class TerminalAquarium {
  private readonly startedAt = performance.now();
  private inputHandler?: (data: Buffer) => void;
  private lastFrameAt = this.startedAt;
  private onQuit?: () => void;
  private onSuspend?: () => void;
  private resizeHandler?: () => void;
  private running = false;
  private timer?: NodeJS.Timeout;
  private waitingForDrain = false;

  constructor(
    private readonly aquarium: Aquarium,
    private readonly options: TerminalAquariumOptions,
    private readonly input: NodeJS.ReadStream = process.stdin,
    private readonly output: NodeJS.WriteStream = process.stdout,
  ) {}

  get canAnimate(): boolean {
    return this.input.isTTY === true && this.output.isTTY === true;
  }

  start(onQuit: () => void, onSuspend?: () => void): boolean {
    if (this.running || !this.canAnimate) return false;
    this.running = true;
    this.onQuit = onQuit;
    this.onSuspend = onSuspend;
    this.lastFrameAt = performance.now();
    this.output.write(ENTER_SCREEN);
    this.installInput();
    this.resizeHandler = () => this.drawFrame();
    this.output.on("resize", this.resizeHandler);
    this.drawFrame();
    this.timer = setInterval(() => this.tick(), 1000 / this.options.fps);
    return true;
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    if (this.resizeHandler !== undefined) this.output.off("resize", this.resizeHandler);
    this.resizeHandler = undefined;
    if (this.inputHandler !== undefined) this.input.off("data", this.inputHandler);
    this.inputHandler = undefined;
    if (this.input.isTTY && this.input.isRaw) this.input.setRawMode(false);
    this.input.pause();
    this.output.write(LEAVE_SCREEN);
  }

  private installInput(): void {
    this.input.setRawMode(true);
    this.input.resume();
    this.inputHandler = (data: Buffer) => {
      for (const byte of data) {
        if (byte === 3 || byte === 113) {
          this.onQuit?.();
        } else if (byte === 102) {
          this.aquarium.feed();
        } else if (byte === 98 || byte === 32) {
          this.aquarium.burst();
        } else if (byte === 116) {
          this.aquarium.cycleTheme();
        } else if (byte === 112) {
          this.aquarium.togglePause();
        } else if (byte === 63 || byte === 104) {
          this.aquarium.toggleHelp();
        } else if (byte === 26) {
          this.onSuspend?.();
        }
      }
      this.drawFrame();
    };
    this.input.on("data", this.inputHandler);
  }

  private tick(): void {
    if (!this.running) return;
    const now = performance.now();
    this.aquarium.update((now - this.lastFrameAt) / 1000);
    this.lastFrameAt = now;
    this.drawFrame(now);
  }

  private drawFrame(now = performance.now()): void {
    if (!this.running || this.waitingForDrain) return;
    const elapsedMs = now - this.startedAt;
    const remainingMs =
      this.options.timeoutSeconds === undefined
        ? undefined
        : Math.max(0, this.options.timeoutSeconds * 1000 - elapsedMs);
    const frame = this.aquarium.render(this.output.columns || 80, this.output.rows || 24, {
      color: this.options.color,
      elapsedMs,
      ...(remainingMs === undefined ? {} : { remainingMs }),
    });
    const accepted = this.output.write(`\u001b[H${frame}`);
    if (!accepted) {
      this.waitingForDrain = true;
      this.output.once("drain", () => {
        this.waitingForDrain = false;
      });
    }
  }
}
