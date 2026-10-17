import { describe, expect, it } from "vitest";
import { getRoomLabCase } from "./cases/curated";
import { renderRoomLabContactSheet } from "./contact-sheet";
import { evaluateRoomLabCase } from "./evaluate";
import { createRoomLabReport } from "./report";

describe("room-lab contact sheet", () => {
    it("renders a self-contained room plan, filters and review controls", () => {
        const roomCase = getRoomLabCase("BR-01");
        const result = evaluateRoomLabCase(roomCase);
        const report = createRoomLabReport([result], "2026-07-23T00:00:00.000Z");
        const html = renderRoomLabContactSheet([roomCase], [result], report);

        expect(html).toContain("<!doctype html>");
        expect(html).toContain('data-case-id="BR-01"');
        expect(html).toContain('class="room-plan"');
        expect(html).toContain('id="filter-finding"');
        expect(html).toContain('id="toggle-hard"');
        expect(html).toContain('id="download-reviews"');
        expect(html).toContain("planner-room-lab-review-draft-v1");
        expect(html).not.toContain("<script src=");
        expect(html).not.toContain("https://");
    });
});
