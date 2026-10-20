import { QueryRunner } from "typeorm";
import { AddUserConsent1786622900000 } from "../../migrations/1786622900000-AddUserConsent";

describe("AddUserConsent1786622900000", () => {
    it("records the consent edition and time as nullable for existing accounts", async () => {
        const query = jest.fn().mockResolvedValue(undefined);

        await new AddUserConsent1786622900000().up({
            query,
        } as unknown as QueryRunner);

        expect(query).toHaveBeenCalledWith(
            `ALTER TABLE "user" ADD "consentVersion" character varying(16), ADD "consentAt" TIMESTAMP WITH TIME ZONE`,
        );
    });

    it("drops both columns on rollback", async () => {
        const query = jest.fn().mockResolvedValue(undefined);

        await new AddUserConsent1786622900000().down({
            query,
        } as unknown as QueryRunner);

        expect(query).toHaveBeenCalledWith(
            `ALTER TABLE "user" DROP COLUMN "consentAt", DROP COLUMN "consentVersion"`,
        );
    });
});
