import assert from "node:assert/strict";
import test from "node:test";
import { Aquarium } from "./aquarium.js";

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

function visibleLines(frame: string): string[] {
  return frame.replace(ANSI, "").split("\n");
}

test("render is deterministic for a seed", () => {
  const first = new Aquarium("same-seed", "ocean", "idle");
  const second = new Aquarium("same-seed", "ocean", "idle");
  first.update(0.125);
  second.update(0.125);
  assert.equal(
    first.render(72, 18, { color: false, elapsedMs: 10_000 }),
    second.render(72, 18, { color: false, elapsedMs: 10_000 }),
  );
});

test("render fits regular and tiny terminal dimensions exactly", () => {
  const aquarium = new Aquarium("fit", "midnight", "idle");
  for (const [width, height] of [
    [80, 20],
    [31, 9],
    [12, 3],
    [1, 1],
  ] as const) {
    const lines = visibleLines(aquarium.render(width, height, { color: true, elapsedMs: 0 }));
    assert.equal(lines.length, height);
    for (const line of lines) assert.equal(line.length, width);
  }
});

test("the aquarium contains status, fish, decor, and ANSI color", () => {
  const aquarium = new Aquarium("lively", "coral", "idle");
  const frame = aquarium.render(80, 20, { color: true, elapsedMs: 123_000, remainingMs: 77_000 });
  const plain = frame.replace(ANSI, "");
  assert.match(frame, /\u001b\[/);
  assert.match(plain, /AWAKE 02:03/);
  assert.match(plain, /01:17 left/);
  assert.match(plain, /[<>]/);
  assert.match(plain, /v\(o\.o\)v/);
});

test("interactive actions change aquarium state", () => {
  const aquarium = new Aquarium("actions", "ocean", "idle");
  const initial = aquarium.snapshot();
  aquarium.feed();
  aquarium.burst();
  aquarium.cycleTheme();
  aquarium.togglePause();
  const changed = aquarium.snapshot();
  assert.equal(changed.food, initial.food + 5);
  assert.equal(changed.bubbles, initial.bubbles + 16);
  assert.equal(changed.theme, "midnight");
  assert.equal(changed.paused, true);
});
