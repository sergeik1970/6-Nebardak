// The next wall-clock multiple of the interval: 5 min → hh:00:00, hh:05:00, …
// Moscow is a whole-hour offset from UTC, so the grid matches local time too.
export function nextBoundary(now, intervalMs) {
    return now - (now % intervalMs) + intervalMs;
}

// Runs a task now, then on every boundary of the interval. The delay is recomputed
// from the clock each time, so runs never drift; a run still busy at the next
// boundary makes that tick skip instead of overlapping.
export function everyAligned(
    intervalMs,
    name,
    task,
    { now = Date.now, setTimer = setTimeout, log = console.error } = {},
) {
    let running = false;

    const run = async () => {
        if (running) {
            log(`${name}: previous run still busy, tick skipped`);
            return;
        }
        running = true;
        try {
            await task();
        } catch (error) {
            log(`${name} failed: ${error.stack ?? error}`);
        } finally {
            running = false;
        }
    };

    const schedule = (after) => {
        // Never the boundary just served: timers may fire a millisecond early.
        const at = nextBoundary(Math.max(now(), after), intervalMs);
        setTimer(() => {
            schedule(at);
            void run();
        }, at - now());
    };

    schedule(now());
    return run();
}
