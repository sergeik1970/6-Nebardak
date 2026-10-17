import { configureTrustedProxy } from "./http-runtime";
import { ExpressAdapter } from "@nestjs/platform-express";

describe("configureTrustedProxy", () => {
    it("applies the validated numeric proxy-hop policy to Express", () => {
        const expressApplication = { set: jest.fn() };

        configureTrustedProxy(expressApplication, 1);

        expect(expressApplication.set).toHaveBeenCalledWith("trust proxy", 1);
    });

    it("trusts exactly one upstream hop with the production Express adapter", () => {
        const expressApplication = new ExpressAdapter().getInstance();

        configureTrustedProxy(expressApplication, 1);
        const trustProxy = expressApplication.get("trust proxy fn") as (
            address: string,
            hop: number,
        ) => boolean;

        expect(trustProxy("127.0.0.1", 0)).toBe(true);
        expect(trustProxy("203.0.113.10", 1)).toBe(false);
    });
});
