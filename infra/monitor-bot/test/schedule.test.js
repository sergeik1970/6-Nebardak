import assert from "node:assert/strict";
import test from "node:test";
import { everyAligned, nextBoundary } from "../src/schedule.js";

const MINUTE = 60_000;
const FIVE = 5 * MINUTE;
// 2026-10-22 14:32:17.400 UTC
const START = Date.UTC(2026, 9, 22, 14, 32, 17, 400);

test("boundaries sit on the wall-clock grid", () => {
    assert.equal(nextBoundary(START, FIVE), Date.UTC(2026, 9, 22, 14, 35));
    assert.equal(nextBoundary(Date.UTC(2026, 9, 22, 14, 35), FIVE), Date.UTC(2026, 9, 22, 14, 40));
    assert.equal(nextBoundary(START, MINUTE), Date.UTC(2026, 9, 22, 14, 33));
});

function fakeClock(start) {
    let time = start;
    const timers = [];
    return {
        now: () => time,
        setTimer: (fn, delay) => timers.push({ at: time + delay, fn }),
        // Fires the next timer, optionally `early` ms before its due time.
        async fire(early = 0) {
            timers.sort((a, b) => a.at - b.at);
            const timer = timers.shift();
            time = timer.at - early;
            timer.fn();
            await new Promise((resolve) => setImmediate(resolve));
        },
    };
}

test("runs at start, then exactly on each boundary without drift", async () => {
    const clock = fakeClock(START);
    const runs = [];
    await everyAligned(FIVE, "t", async () => runs.push(clock.now()), clock);
    for (let i = 0; i < 3; i += 1) await clock.fire();

    assert.deepEqual(
        runs.map((at) => new Date(at).toISOString().slice(11, 19)),
        ["14:32:17", "14:35:00", "14:40:00", "14:45:00"],
    );
});

test("a timer firing early does not run the same boundary twice", async () => {
    const clock = fakeClock(START);
    const runs = [];
    await everyAligned(FIVE, "t", async () => runs.push(clock.now()), clock);
    await clock.fire(1);
    await clock.fire();

    assert.equal(runs.length, 3);
    assert.equal(runs[2], Date.UTC(2026, 9, 22, 14, 40));
});

test("a slow run skips the next tick instead of overlapping", async () => {
    const clock = fakeClock(START);
    const logs = [];
    let release;
    let calls = 0;
    const task = () => {
        calls += 1;
        return calls === 2 ? new Promise((resolve) => (release = resolve)) : Promise.resolve();
    };
    await everyAligned(FIVE, "slow", task, { ...clock, log: (line) => logs.push(line) });
    await clock.fire(); // 14:35 starts and hangs
    await clock.fire(); // 14:40 skipped
    release();
    await new Promise((resolve) => setImmediate(resolve));
    await clock.fire(); // 14:45 runs

    assert.equal(calls, 3);
    assert.deepEqual(logs, ["slow: previous run still busy, tick skipped"]);
});
