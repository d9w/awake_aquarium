import assert from "node:assert/strict";
import test from "node:test";
import {
  describeAssertions,
  formatDuration,
  hasUtility,
  parseArgs,
  timeoutSeconds,
  UsageError,
} from "./args.js";

test("parseArgs separates aquarium options from native caffeinate options", () => {
  const options = parseArgs(
    ["--theme", "coral", "--fps=12", "--seed", "guppy", "--no-color", "-i", "-t", "90"],
    { now: 1, pid: 2 },
  );

  assert.equal(options.theme, "coral");
  assert.equal(options.fps, 12);
  assert.equal(options.seed, "guppy");
  assert.equal(options.color, false);
  assert.deepEqual(options.caffeinateArgs, ["-i", "-t", "90"]);
});

test("parseArgs preserves everything after the utility separator", () => {
  const options = parseArgs(["-i", "--", "node", "--theme", "not-an-aquarium-option"], { now: 1, pid: 2 });
  assert.deepEqual(options.caffeinateArgs, ["-i", "--", "node", "--theme", "not-an-aquarium-option"]);
});

test("parseArgs stops interpreting options after an unseparated utility", () => {
  const options = parseArgs(["-i", "node", "--theme", "belongs-to-node"], { now: 1, pid: 2 });
  assert.equal(options.theme, "ocean");
  assert.deepEqual(options.caffeinateArgs, ["-i", "node", "--theme", "belongs-to-node"]);
});

test("parseArgs does not mistake native option values for utilities", () => {
  const options = parseArgs(["-t", "60", "--theme", "midnight", "-i"], { now: 1, pid: 2 });
  assert.equal(options.theme, "midnight");
  assert.deepEqual(options.caffeinateArgs, ["-t", "60", "-i"]);
});

test("parseArgs respects NO_COLOR and validates values", () => {
  assert.equal(parseArgs([], { noColor: "1", now: 1, pid: 2 }).color, false);
  assert.throws(() => parseArgs(["--fps", "0"]), UsageError);
  assert.throws(() => parseArgs(["--theme", "swamp"]), UsageError);
});

test("utility detection skips timeout and pid values", () => {
  assert.equal(hasUtility(["-i", "-t", "60"]), false);
  assert.equal(hasUtility(["-iw", "1234"]), false);
  assert.equal(hasUtility(["-i", "make", "test"]), true);
  assert.equal(hasUtility(["-i", "--", "npm", "test"]), true);
});

test("native option summaries are compact and useful", () => {
  assert.equal(describeAssertions([]), "idle");
  assert.equal(describeAssertions(["-dims", "-t", "20", "-w", "42"]), "display+idle+disk+system+pid 42");
  assert.equal(timeoutSeconds(["-i", "-t", "75"]), 75);
  assert.equal(timeoutSeconds(["-i"]), undefined);
});

test("formatDuration chooses a compact clock", () => {
  assert.equal(formatDuration(5.9), "00:05");
  assert.equal(formatDuration(65), "01:05");
  assert.equal(formatDuration(3661), "1:01:01");
});
