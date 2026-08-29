import { formatDuration, THEME_NAMES, type ThemeName } from "./args.js";

type Ink =
  | "accent"
  | "border"
  | "bubble"
  | "crab"
  | "fishA"
  | "fishB"
  | "fishC"
  | "food"
  | "muted"
  | "plant"
  | "sand";

type Palette = Record<Ink, string>;

const RESET = "\u001b[0m";
const PALETTES: Record<ThemeName, Palette> = {
  ocean: {
    accent: "\u001b[1;97m",
    border: "\u001b[36m",
    bubble: "\u001b[96m",
    crab: "\u001b[91m",
    fishA: "\u001b[93m",
    fishB: "\u001b[95m",
    fishC: "\u001b[92m",
    food: "\u001b[33m",
    muted: "\u001b[2;37m",
    plant: "\u001b[32m",
    sand: "\u001b[33m",
  },
  midnight: {
    accent: "\u001b[1;96m",
    border: "\u001b[34m",
    bubble: "\u001b[94m",
    crab: "\u001b[95m",
    fishA: "\u001b[96m",
    fishB: "\u001b[97m",
    fishC: "\u001b[94m",
    food: "\u001b[93m",
    muted: "\u001b[2;37m",
    plant: "\u001b[36m",
    sand: "\u001b[2;33m",
  },
  coral: {
    accent: "\u001b[1;93m",
    border: "\u001b[95m",
    bubble: "\u001b[96m",
    crab: "\u001b[31m",
    fishA: "\u001b[91m",
    fishB: "\u001b[93m",
    fishC: "\u001b[95m",
    food: "\u001b[92m",
    muted: "\u001b[2;37m",
    plant: "\u001b[92m",
    sand: "\u001b[93m",
  },
};

interface Cell {
  character: string;
  ink?: Ink;
}

class Canvas {
  private readonly cells: Cell[][];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.cells = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => ({ character: " " })),
    );
  }

  set(x: number, y: number, character: string, ink?: Ink): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const row = this.cells[y];
    if (row === undefined) return;
    row[x] = ink === undefined ? { character } : { character, ink };
  }

  put(x: number, y: number, text: string, ink?: Ink): void {
    for (let offset = 0; offset < text.length; offset += 1) {
      const character = text[offset];
      if (character !== undefined) this.set(x + offset, y, character, ink);
    }
  }

  fill(x: number, y: number, width: number, height: number): void {
    for (let row = y; row < y + height; row += 1) {
      for (let column = x; column < x + width; column += 1) {
        this.set(column, row, " ");
      }
    }
  }

  lines(palette?: Palette): string[] {
    return this.cells.map((row) => {
      if (palette === undefined) return row.map((cell) => cell.character).join("");
      let activeInk: Ink | undefined;
      let line = "";
      for (const cell of row) {
        if (cell.ink !== activeInk) {
          line += cell.ink === undefined ? RESET : palette[cell.ink];
          activeInk = cell.ink;
        }
        line += cell.character;
      }
      return `${line}${RESET}`;
    });
  }
}

interface Fish {
  baseY: number;
  direction: -1 | 1;
  ink: "fishA" | "fishB" | "fishC";
  message?: string;
  messageUntil: number;
  name: string;
  phase: number;
  speed: number;
  spriteLeft: string;
  spriteRight: string;
  wiggle: number;
  x: number;
}

interface Bubble {
  phase: number;
  speed: number;
  x: number;
  y: number;
}

interface Food {
  speed: number;
  x: number;
  y: number;
}

export interface RenderOptions {
  color: boolean;
  elapsedMs: number;
  remainingMs?: number;
}

export interface AquariumSnapshot {
  bubbles: number;
  food: number;
  paused: boolean;
  theme: ThemeName;
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeRandom(seed: string): () => number {
  let state = hashSeed(seed) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function centeredX(width: number, text: string): number {
  return Math.floor((width - text.length) / 2);
}

function fit(text: string, maximum: number): string {
  if (maximum <= 0) return "";
  if (text.length <= maximum) return text;
  if (maximum <= 3) return text.slice(0, maximum);
  return `${text.slice(0, maximum - 3)}...`;
}

export class Aquarium {
  private readonly assertionLabel: string;
  private readonly bubbles: Bubble[] = [];
  private readonly fish: Fish[];
  private readonly food: Food[] = [];
  private readonly random: () => number;
  private event = "The night watch has begun.";
  private eventUntil = 3.5;
  private helpVisible = false;
  private nextThoughtAt = 5;
  private paused = false;
  private simulationTime = 0;
  private theme: ThemeName;

  constructor(seed: string, theme: ThemeName, assertionLabel: string) {
    this.random = makeRandom(seed);
    this.theme = theme;
    this.assertionLabel = assertionLabel;
    this.fish = [
      this.makeFish("Finley", 0.12, 0.23, 1, "><o>", "<o><", "fishA", 0.064),
      this.makeFish("Bubbles", 0.76, 0.47, -1, "><((o>", "<o))><", "fishB", 0.046),
      this.makeFish("Dot", 0.34, 0.68, 1, "><>", "<><", "fishC", 0.08),
      this.makeFish("Gus", 0.62, 0.15, -1, "><(((o>", "<o)))><", "fishA", 0.035),
    ];
    for (let index = 0; index < 5; index += 1) this.spawnBubble(this.random(), this.random());
  }

  private makeFish(
    name: string,
    x: number,
    baseY: number,
    direction: -1 | 1,
    spriteRight: string,
    spriteLeft: string,
    ink: Fish["ink"],
    speed: number,
  ): Fish {
    return {
      baseY,
      direction,
      ink,
      messageUntil: 0,
      name,
      phase: this.random() * Math.PI * 2,
      speed,
      spriteLeft,
      spriteRight,
      wiggle: 0.7 + this.random() * 0.8,
      x,
    };
  }

  private spawnBubble(x = this.random(), y = 1): void {
    this.bubbles.push({
      phase: this.random() * Math.PI * 2,
      speed: 0.055 + this.random() * 0.075,
      x: clamp(x, 0, 1),
      y: clamp(y, 0, 1),
    });
  }

  update(deltaSeconds: number): void {
    if (this.paused) return;
    const delta = clamp(deltaSeconds, 0, 0.25);
    this.simulationTime += delta;

    for (const fish of this.fish) {
      fish.x += fish.direction * fish.speed * delta;
      if (fish.x >= 1) {
        fish.x = 1;
        fish.direction = -1;
      } else if (fish.x <= 0) {
        fish.x = 0;
        fish.direction = 1;
      }
      if (this.random() < delta * 0.012) fish.direction = fish.direction === 1 ? -1 : 1;
    }

    for (const bubble of this.bubbles) bubble.y -= bubble.speed * delta;
    for (let index = this.bubbles.length - 1; index >= 0; index -= 1) {
      if ((this.bubbles[index]?.y ?? 0) < 0) this.bubbles.splice(index, 1);
    }
    if (this.bubbles.length < 14 && this.random() < delta * 1.5) this.spawnBubble();

    for (const morsel of this.food) morsel.y += morsel.speed * delta;
    for (let index = this.food.length - 1; index >= 0; index -= 1) {
      const morsel = this.food[index];
      if (morsel === undefined) continue;
      const eater = this.fish.find((fish) => {
        const fishY = fish.baseY + Math.sin(this.simulationTime * fish.wiggle + fish.phase) * 0.035;
        return Math.abs(fish.x - morsel.x) < 0.09 && Math.abs(fishY - morsel.y) < 0.075;
      });
      if (eater !== undefined) {
        this.food.splice(index, 1);
        eater.message = "nom!";
        eater.messageUntil = this.simulationTime + 1.8;
        this.setEvent(`${eater.name} found a snack!`, 3);
      } else if (morsel.y > 0.92) {
        this.food.splice(index, 1);
      }
    }

    if (this.simulationTime >= this.nextThoughtAt) {
      const fish = this.fish[Math.floor(this.random() * this.fish.length)];
      const thoughts = ["blub", "...", "hi!", "z z", "glub"];
      const thought = thoughts[Math.floor(this.random() * thoughts.length)];
      if (fish !== undefined && thought !== undefined) {
        fish.message = thought;
        fish.messageUntil = this.simulationTime + 1.7;
        this.setEvent(`${fish.name} says ${thought.replaceAll(" ", "")}.`, 2.5);
      }
      this.nextThoughtAt = this.simulationTime + 7 + this.random() * 9;
    }
  }

  feed(): void {
    for (let index = 0; index < 5; index += 1) {
      this.food.push({ speed: 0.075 + this.random() * 0.045, x: 0.1 + this.random() * 0.8, y: 0.04 });
    }
    this.setEvent("Snack time!", 3.5);
  }

  burst(): void {
    for (let index = 0; index < 16; index += 1) {
      this.spawnBubble(0.08 + this.random() * 0.84, 0.65 + this.random() * 0.35);
    }
    this.setEvent("Bloop bloop bloop!", 3.5);
  }

  cycleTheme(): void {
    const index = THEME_NAMES.indexOf(this.theme);
    this.theme = THEME_NAMES[(index + 1) % THEME_NAMES.length] ?? "ocean";
    this.setEvent(`${this.theme} colors`, 3);
  }

  togglePause(): void {
    this.paused = !this.paused;
    this.setEvent(this.paused ? "The water is still. The Mac is still awake." : "The current is moving again.", 4);
  }

  toggleHelp(): void {
    this.helpVisible = !this.helpVisible;
  }

  snapshot(): AquariumSnapshot {
    return { bubbles: this.bubbles.length, food: this.food.length, paused: this.paused, theme: this.theme };
  }

  private setEvent(message: string, duration: number): void {
    this.event = message;
    this.eventUntil = this.simulationTime + duration;
  }

  render(width: number, height: number, options: RenderOptions): string {
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    const canvas = new Canvas(safeWidth, safeHeight);

    if (safeWidth < 20 || safeHeight < 5) {
      this.drawTiny(canvas, options.elapsedMs);
      return canvas.lines(options.color ? PALETTES[this.theme] : undefined).join("\n");
    }

    this.drawBorder(canvas, options);
    this.drawFloor(canvas);
    this.drawPlants(canvas);
    this.drawTreasure(canvas);
    this.drawBubbles(canvas);
    this.drawFood(canvas);
    this.drawFish(canvas);
    this.drawCrab(canvas);
    if (this.helpVisible) this.drawHelp(canvas);

    return canvas.lines(options.color ? PALETTES[this.theme] : undefined).join("\n");
  }

  private drawTiny(canvas: Canvas, elapsedMs: number): void {
    const label = fit(`><o> AWAKE ${formatDuration(elapsedMs / 1000)}`, canvas.width);
    canvas.put(Math.max(0, centeredX(canvas.width, label)), Math.floor(canvas.height / 2), label, "fishA");
    if (canvas.height > 1 && canvas.width > 4) canvas.put(canvas.width - 3, 0, "o .", "bubble");
  }

  private drawBorder(canvas: Canvas, options: RenderOptions): void {
    for (let x = 0; x < canvas.width; x += 1) {
      canvas.set(x, 0, x === 0 || x === canvas.width - 1 ? "+" : "-", "border");
      canvas.set(x, canvas.height - 1, x === 0 || x === canvas.width - 1 ? "+" : "-", "border");
    }
    for (let y = 1; y < canvas.height - 1; y += 1) {
      canvas.set(0, y, "|", "border");
      canvas.set(canvas.width - 1, y, "|", "border");
    }

    let timing = formatDuration(options.elapsedMs / 1000);
    if (options.remainingMs !== undefined) {
      timing += ` | ${formatDuration(Math.ceil(options.remainingMs / 1000))} left`;
    }
    const title = fit(`[ AWAKE ${timing} | ${this.assertionLabel} ]`, canvas.width - 4);
    canvas.put(centeredX(canvas.width, title), 0, title, "accent");

    const controls = "f feed | b bubbles | t theme | p pause | ? help | q quit";
    const footer = this.simulationTime <= this.eventUntil ? this.event : controls;
    const fittedFooter = fit(`[ ${footer} ]`, canvas.width - 4);
    canvas.put(centeredX(canvas.width, fittedFooter), canvas.height - 1, fittedFooter, "muted");
  }

  private drawFloor(canvas: Canvas): void {
    if (canvas.height < 7) return;
    const floorY = canvas.height - 3;
    for (let x = 1; x < canvas.width - 1; x += 1) {
      const grain = (x * 17 + hashSeed(this.theme)) % 13;
      canvas.set(x, floorY, grain === 0 ? "o" : grain < 5 ? "." : grain === 7 ? "," : "_", "sand");
      canvas.set(x, floorY + 1, (x * 7) % 9 === 0 ? "." : "_", "sand");
    }
  }

  private drawPlants(canvas: Canvas): void {
    if (canvas.height < 8) return;
    const floorY = canvas.height - 3;
    const positions = [0.08, 0.2, 0.73, 0.89];
    positions.forEach((position, index) => {
      const x = 1 + Math.floor(position * (canvas.width - 3));
      const plantHeight = 2 + ((index * 2 + canvas.width) % Math.max(2, Math.min(5, floorY - 1)));
      for (let offset = 0; offset < plantHeight; offset += 1) {
        const sway = Math.sin(this.simulationTime * 1.3 + index + offset * 0.8) > 0.35 ? 1 : 0;
        const character = offset === plantHeight - 1 ? (sway === 1 ? "/" : "\\") : offset % 2 === 0 ? "Y" : "|";
        canvas.set(x + sway, floorY - 1 - offset, character, "plant");
      }
    });
  }

  private drawTreasure(canvas: Canvas): void {
    if (canvas.width < 44 || canvas.height < 10) return;
    const floorY = canvas.height - 3;
    const x = Math.floor(canvas.width * 0.52);
    canvas.put(x, floorY - 1, "/_\\", "sand");
    canvas.put(x, floorY, "|$|", "food");
  }

  private drawBubbles(canvas: Canvas): void {
    const waterHeight = Math.max(1, canvas.height - 5);
    for (const bubble of this.bubbles) {
      const wobble = Math.sin(this.simulationTime * 2 + bubble.phase) * 0.018;
      const x = 1 + Math.floor(clamp(bubble.x + wobble, 0, 1) * (canvas.width - 3));
      const y = 1 + Math.floor(clamp(bubble.y, 0, 1) * waterHeight);
      const character = bubble.speed > 0.1 ? "O" : bubble.speed > 0.075 ? "o" : ".";
      canvas.set(x, y, character, "bubble");
    }
  }

  private drawFood(canvas: Canvas): void {
    const waterHeight = Math.max(1, canvas.height - 5);
    for (const morsel of this.food) {
      const x = 1 + Math.floor(morsel.x * (canvas.width - 3));
      const y = 1 + Math.floor(morsel.y * waterHeight);
      canvas.set(x, y, "*", "food");
    }
  }

  private drawFish(canvas: Canvas): void {
    const waterHeight = Math.max(1, canvas.height - 5);
    const visibleFish = canvas.width < 35 || canvas.height < 8 ? this.fish.slice(0, 2) : this.fish;
    for (const fish of visibleFish) {
      const sprite = fish.direction === 1 ? fish.spriteRight : fish.spriteLeft;
      const usableWidth = Math.max(1, canvas.width - sprite.length - 2);
      const x = 1 + Math.floor(fish.x * usableWidth);
      const normalizedY = clamp(
        fish.baseY + Math.sin(this.simulationTime * fish.wiggle + fish.phase) * 0.035,
        0,
        1,
      );
      const y = 1 + Math.floor(normalizedY * waterHeight);
      canvas.put(x, y, sprite, fish.ink);
      if (fish.message !== undefined && fish.messageUntil > this.simulationTime && y > 1) {
        const message = `(${fish.message})`;
        canvas.put(clamp(x + Math.floor(sprite.length / 2) - 1, 1, canvas.width - message.length - 1), y - 1, message, "accent");
      }
    }
  }

  private drawCrab(canvas: Canvas): void {
    if (canvas.width < 30 || canvas.height < 8) return;
    const floorY = canvas.height - 3;
    const range = Math.max(1, canvas.width - 11);
    const x = 2 + Math.floor(((Math.sin(this.simulationTime * 0.22) + 1) / 2) * range);
    canvas.put(x, floorY - 1, "v(o.o)v", "crab");
  }

  private drawHelp(canvas: Canvas): void {
    const boxWidth = Math.min(36, canvas.width - 4);
    const boxHeight = Math.min(9, canvas.height - 4);
    if (boxWidth < 24 || boxHeight < 6) return;
    const left = Math.floor((canvas.width - boxWidth) / 2);
    const top = Math.floor((canvas.height - boxHeight) / 2);
    canvas.fill(left, top, boxWidth, boxHeight);
    for (let x = left; x < left + boxWidth; x += 1) {
      canvas.set(x, top, x === left || x === left + boxWidth - 1 ? "+" : "-", "border");
      canvas.set(x, top + boxHeight - 1, x === left || x === left + boxWidth - 1 ? "+" : "-", "border");
    }
    for (let y = top + 1; y < top + boxHeight - 1; y += 1) {
      canvas.set(left, y, "|", "border");
      canvas.set(left + boxWidth - 1, y, "|", "border");
    }
    const title = "[ AQUARIUM CONTROLS ]";
    canvas.put(left + Math.floor((boxWidth - title.length) / 2), top, title, "accent");
    const help = ["f  feed the fish", "b  bubble burst", "t  change colors", "p  pause the water", "q  stop caffeinate"];
    help.slice(0, boxHeight - 2).forEach((line, index) => canvas.put(left + 3, top + 1 + index, line, "accent"));
  }
}
