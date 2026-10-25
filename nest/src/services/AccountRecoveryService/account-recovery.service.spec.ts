import { User } from "../../entities/User/user.entity";
import { AuthService } from "../AuthService/auth.service";
import { EmailTokenService } from "../EmailTokenService/email-token.service";
import { MailService } from "../MailService/mail.service";
import { OperationalLogger } from "../OperationalLogger/operational-logger.service";
import { SessionService } from "../SessionService/session.service";
import { TrustedDeviceService } from "../TrustedDeviceService/trusted-device.service";
import { AccountRecoveryService } from "./account-recovery.service";

const user = {
    id: 3,
    name: "Мария",
    email: "maria@example.com",
    emailVerifiedAt: null,
} as User;

function makeService() {
    const authService = {
        findUserByEmail: jest.fn().mockResolvedValue(user),
        getUserById: jest.fn().mockResolvedValue(user),
        setPassword: jest.fn(),
        markEmailVerified: jest.fn(),
    };
    const emailTokens = {
        issue: jest.fn().mockResolvedValue("issued-token"),
        consume: jest.fn().mockResolvedValue(3),
    };
    const mailService = { send: jest.fn().mockResolvedValue(undefined) };
    const sessionService = { revokeAll: jest.fn() };
    const trustedDevices = { revokeAll: jest.fn() };
    const logger = { event: jest.fn() };
    const service = new AccountRecoveryService(
        authService as unknown as AuthService,
        emailTokens as unknown as EmailTokenService,
        mailService as unknown as MailService,
        sessionService as unknown as SessionService,
        trustedDevices as unknown as TrustedDeviceService,
        logger as unknown as OperationalLogger,
    );
    return {
        service,
        authService,
        emailTokens,
        mailService,
        sessionService,
        trustedDevices,
        logger,
    };
}

describe("AccountRecoveryService", () => {
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

    it("mails a verification link on the public origin", async () => {
        const { service, mailService, emailTokens } = makeService();

        await expect(service.sendVerification(user)).resolves.toBe(true);

        expect(emailTokens.issue).toHaveBeenCalledWith(3, "verify-email");
        const message = mailService.send.mock.calls[0][0];
        expect(message.to).toBe("maria@example.com");
        expect(message.text).toContain(
            "https://stylefinder.example/auth/verify?token=issued-token",
        );
    });

    it("reports a relay failure without logging the address", async () => {
        const { service, mailService, logger } = makeService();
        mailService.send.mockRejectedValue(
            new Error("maria@example.com refused"),
        );

        await expect(service.sendVerification(user)).resolves.toBe(false);

        expect(logger.event).toHaveBeenCalledWith(
            "account.verification_failed",
            { userId: 3, reason: "Error" },
            "error",
        );
        expect(JSON.stringify(logger.event.mock.calls)).not.toContain(
            "maria@example.com",
        );
    });

    it("does nothing visible for an unknown address", async () => {
        const { service, authService, mailService, emailTokens } =
            makeService();
        authService.findUserByEmail.mockResolvedValue(null);

        await expect(
            service.requestPasswordReset("nobody@example.com"),
        ).resolves.toBeUndefined();
        expect(emailTokens.issue).not.toHaveBeenCalled();
        expect(mailService.send).not.toHaveBeenCalled();
    });

    it("swallows reset failures: the HTTP answer has already been sent", async () => {
        const { service, authService } = makeService();
        authService.findUserByEmail.mockRejectedValue(new Error("db down"));

        await expect(
            service.requestPasswordReset("maria@example.com"),
        ).resolves.toBeUndefined();
    });

    it("resets the password, confirms the mailbox and signs out everywhere", async () => {
        const { service, authService, sessionService, trustedDevices } =
            makeService();

        await expect(
            service.resetPassword("t".repeat(43), "new-password-1"),
        ).resolves.toBe(user);

        expect(authService.setPassword).toHaveBeenCalledWith(
            3,
            "new-password-1",
        );
        expect(authService.markEmailVerified).toHaveBeenCalledWith(3);
        expect(sessionService.revokeAll).toHaveBeenCalledWith(3);
        expect(trustedDevices.revokeAll).toHaveBeenCalledWith(3);
    });

    it("changes nothing for an invalid or used reset link", async () => {
        const { service, authService, emailTokens, sessionService } =
            makeService();
        emailTokens.consume.mockResolvedValue(null);

        await expect(
            service.resetPassword("t".repeat(43), "new-password-1"),
        ).resolves.toBeNull();
        expect(authService.setPassword).not.toHaveBeenCalled();
        expect(sessionService.revokeAll).not.toHaveBeenCalled();
    });
});
