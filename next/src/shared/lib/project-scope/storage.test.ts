import { afterEach, describe, expect, it } from "vitest";
import {
    activateProjectScope,
    createNamespacedStorage,
    getActiveProjectId,
    getProjectStorage,
    parseProjectId,
    projectStorageNamespace,
    subscribeProjectStorage,
    withProjectParam,
    withProjectQuery,
} from "./storage";
import { MemoryStorage } from "./test-fixtures";

const ID = "3f0c2a52-9a43-4c2b-8f3e-2b1d7c9e4a10";

describe("project storage scope", () => {
    afterEach(() => activateProjectScope(null));

    it.each([
        [ID, ID],
        [ID.toUpperCase(), ID],
        [[ID], ID],
        ["3f0c2a52-9a43-1c2b-8f3e-2b1d7c9e4a10", null],
        ["../../token", null],
        ["", null],
        [undefined, null],
    ])("parses %p as %p", (input, expected) => {
        expect(parseProjectId(input)).toBe(expected);
    });

    it("keeps projects apart from each other and from the guest draft", () => {
        const base = new MemoryStorage();
        const first = createNamespacedStorage(base, projectStorageNamespace(ID));
        const second = createNamespacedStorage(
            base,
            projectStorageNamespace("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"),
        );

        base.setItem("stylefinder:project-draft:v4", "guest");
        first.setItem("stylefinder:project-draft:v4", "first");

        expect(first.getItem("stylefinder:project-draft:v4")).toBe("first");
        expect(second.getItem("stylefinder:project-draft:v4")).toBeNull();
        expect(base.getItem("stylefinder:project-draft:v4")).toBe("guest");
        first.removeItem("stylefinder:project-draft:v4");
        expect(base.values.has(`stylefinder:project:${ID}:stylefinder:project-draft:v4`)).toBe(
            false,
        );
    });

    it("switches the active store and back to the guest", () => {
        const custom = new MemoryStorage();
        activateProjectScope(ID, custom);
        expect(getActiveProjectId()).toBe(ID);
        getProjectStorage()?.setItem("key", "value");
        expect(custom.getItem("key")).toBe("value");

        activateProjectScope(null);
        expect(getActiveProjectId()).toBeNull();
    });

    it("tells subscribers about writes through the active store", () => {
        const custom = new MemoryStorage();
        activateProjectScope(ID, custom);
        let calls = 0;
        const unsubscribe = subscribeProjectStorage(() => {
            calls += 1;
        });
        getProjectStorage()?.setItem("key", "value");
        getProjectStorage()?.removeItem("key");
        unsubscribe();
        getProjectStorage()?.setItem("key", "value");
        expect(calls).toBe(2);
    });

    it("adds the project to links without losing their own query or hash", () => {
        expect(withProjectParam("/planner?drawRoom=1#plan", ID)).toBe(
            `/planner?drawRoom=1&project=${ID}#plan`,
        );
        expect(withProjectParam("/planner", null)).toBe("/planner");
        expect(withProjectQuery({ new: "1" }, ID)).toEqual({ new: "1", project: ID });
        expect(withProjectQuery({ new: "1" }, null)).toEqual({ new: "1" });
    });
});
