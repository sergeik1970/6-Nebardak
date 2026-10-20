import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { CsrfGuard } from "./csrf.guard";

function makeContext(
    method: string,
    headers: Record<string, string>,
): ExecutionContext {
    return {
        getType: () => "http",
        switchToHttp: () => ({
            getRequest: () => ({ method, headers }),
        }),
    } as unknown as ExecutionContext;
}

describe("CsrfGuard", () => {
    const guard = new CsrfGuard();
    const originalEnvironment = {
        NODE_ENV: process.env.NODE_ENV,
        PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN,
    };

    beforeEach(() => {
        process.env.NODE_ENV = "test";
        process.env.PUBLIC_ORIGIN = "https://stylefinder.example";
    });

    afterAll(() => {
        for (const [key, value] of Object.entries(originalEnvironment)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    it.each(["GET", "HEAD", "OPTIONS"])(
        "lets safe %s requests through",
        (method) => {
            expect(guard.canActivate(makeContext(method, {}))).toBe(true);
        },
    );

    it("accepts a same-origin state change with the marker header", () => {
        expect(
            guard.canActivate(
                makeContext("POST", {
                    origin: "https://stylefinder.example",
                    "sec-fetch-site": "same-origin",
                    "x-requested-with": "stylefinder",
                }),
            ),
        ).toBe(true);
    });

    it("accepts a non-browser client that sends the header without Origin", () => {
        expect(
            guard.canActivate(
                makeContext("DELETE", { "x-requested-with": "stylefinder" }),
            ),
        ).toBe(true);
    });

    it.each([
        ["no marker header", { origin: "https://stylefinder.example" }],
        [
            "a wrong marker value",
            {
                origin: "https://stylefinder.example",
                "x-requested-with": "XMLHttpRequest",
            },
        ],
        [
            "a foreign Origin",
            {
                origin: "https://evil.example",
                "x-requested-with": "stylefinder",
            },
        ],
        [
            "a cross-site fetch",
            {
                "sec-fetch-site": "cross-site",
                "x-requested-with": "stylefinder",
            },
        ],
        [
            "a sibling-subdomain fetch",
            {
                "sec-fetch-site": "same-site",
                "x-requested-with": "stylefinder",
            },
        ],
    ])("rejects a state change with %s", (_label, headers) => {
        expect(() => guard.canActivate(makeContext("POST", headers))).toThrow(
            ForbiddenException,
        );
    });
});
