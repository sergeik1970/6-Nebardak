import { beforeEach } from "vitest";

// Synchronous solver tests run back to back through microtasks, so a worker can
// go minutes without reading vitest's RPC replies and fail with
// "Timeout calling onTaskUpdate". Yield to the event loop before each test.
beforeEach(() => new Promise<void>((resolve) => setImmediate(resolve)));
