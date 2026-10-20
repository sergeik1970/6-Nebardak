import { Injectable } from "@nestjs/common";
import { getRuntimeConfig } from "../../config/runtime.config";
import { User } from "../../entities/User/user.entity";
import { AuthService } from "../AuthService/auth.service";
import { EmailTokenService } from "../EmailTokenService/email-token.service";
import { MailService } from "../MailService/mail.service";
import {
    passwordResetEmail,
    verificationEmail,
} from "../MailService/mail-templates";
import { OperationalLogger } from "../OperationalLogger/operational-logger.service";
import { SessionService } from "../SessionService/session.service";

@Injectable()
export class AccountRecoveryService {
    constructor(
        private readonly authService: AuthService,
        private readonly emailTokens: EmailTokenService,
        private readonly mailService: MailService,
        private readonly sessionService: SessionService,
        private readonly logger: OperationalLogger,
    ) {}

    /** Returns false when the letter could not be handed to the SMTP relay. */
    async sendVerification(user: User): Promise<boolean> {
        try {
            const token = await this.emailTokens.issue(user.id, "verify-email");
            await this.mailService.send(
                verificationEmail({
                    to: user.email,
                    name: user.name,
                    link: this.link("/auth/verify", token),
                }),
            );
            this.logger.event("account.verification_sent", { userId: user.id });
            return true;
        } catch (error) {
            this.logFailure("account.verification_failed", user.id, error);
            return false;
        }
    }

    async verifyEmail(token: unknown): Promise<User | null> {
        const userId = await this.emailTokens.consume(token, "verify-email");
        if (userId === null) return null;

        await this.authService.markEmailVerified(userId);
        this.logger.event("account.email_verified", { userId });
        return this.authService.getUserById(userId);
    }

    /**
     * Never reveals whether the address has an account: the caller answers
     * the same way before this work even starts.
     */
    async requestPasswordReset(email: string): Promise<void> {
        let user: User | null = null;
        try {
            user = await this.authService.findUserByEmail(email);
            if (!user) return;

            const token = await this.emailTokens.issue(
                user.id,
                "reset-password",
            );
            await this.mailService.send(
                passwordResetEmail({
                    to: user.email,
                    name: user.name,
                    link: this.link("/auth/reset", token),
                }),
            );
            this.logger.event("account.reset_sent", { userId: user.id });
        } catch (error) {
            this.logFailure("account.reset_failed", user?.id ?? null, error);
        }
    }

    /**
     * Sets the new password, proves mailbox ownership and ends every other
     * sign-in: whoever knew the old password is locked out.
     */
    async resetPassword(
        token: unknown,
        password: string,
    ): Promise<User | null> {
        const userId = await this.emailTokens.consume(token, "reset-password");
        if (userId === null) return null;

        await this.authService.setPassword(userId, password);
        await this.authService.markEmailVerified(userId);
        await this.sessionService.revokeAll(userId);
        this.logger.event("account.password_reset", { userId });
        return this.authService.getUserById(userId);
    }

    private link(path: string, token: string): string {
        const url = new URL(path, getRuntimeConfig().publicOrigin);
        url.searchParams.set("token", token);
        return url.toString();
    }

    private logFailure(event: string, userId: number | null, error: unknown) {
        this.logger.event(
            event,
            {
                userId,
                reason: error instanceof Error ? error.name : "unknown",
            },
            "error",
        );
    }
}
