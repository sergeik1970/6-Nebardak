import {
    Body,
    Controller,
    ForbiddenException,
    HttpCode,
    Patch,
    Post,
    Req,
    Res,
    UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import {
    ChangePasswordDto,
    DeleteAccountDto,
    UpdateProfileDto,
} from "../../dto/account/account.dto";
import { AuthEnabledGuard } from "../../guards/auth-enabled.guard";
import { AuthGuard, AuthenticatedRequest } from "../../guards/auth.guard";
import { clearSessionCookie } from "../../security/session-cookie";
import {
    AuthService,
    PublicUser,
    toPublicUser,
} from "../../services/AuthService/auth.service";
import { EmailTokenService } from "../../services/EmailTokenService/email-token.service";
import { OperationalLogger } from "../../services/OperationalLogger/operational-logger.service";
import { SessionService } from "../../services/SessionService/session.service";

const SENSITIVE_THROTTLE = {
    default: { limit: 5, ttl: 15 * 60_000, blockDuration: 15 * 60_000 },
};

@Controller("account")
@UseGuards(AuthEnabledGuard, AuthGuard)
export class AccountController {
    constructor(
        private readonly authService: AuthService,
        private readonly sessionService: SessionService,
        private readonly emailTokens: EmailTokenService,
        private readonly logger: OperationalLogger,
    ) {}

    @Patch("profile")
    async updateProfile(
        @Req() request: AuthenticatedRequest,
        @Body() dto: UpdateProfileDto,
    ): Promise<{ user: PublicUser }> {
        const user = await this.authService.updateName(
            request.user.id,
            dto.name,
        );
        return { user: toPublicUser(user ?? request.user) };
    }

    /** Keeps this device signed in and ends every other session. */
    @Throttle(SENSITIVE_THROTTLE)
    @HttpCode(204)
    @Post("password")
    async changePassword(
        @Req() request: AuthenticatedRequest,
        @Body() dto: ChangePasswordDto,
    ): Promise<void> {
        await this.requirePassword(request.user.id, dto.currentPassword);

        await this.authService.setPassword(request.user.id, dto.newPassword);
        await this.sessionService.revokeOthers(
            request.user.id,
            request.session.id,
        );
        await this.emailTokens.revoke(request.user.id, "reset-password");
        this.logger.event("account.password_changed", {
            userId: request.user.id,
        });
    }

    /**
     * Irreversible: the row cascades to sessions, links, observations and
     * projects. POST rather than DELETE so the password body is never dropped
     * by an intermediary.
     */
    @Throttle(SENSITIVE_THROTTLE)
    @HttpCode(204)
    @Post("delete")
    async deleteAccount(
        @Req() request: AuthenticatedRequest,
        @Body() dto: DeleteAccountDto,
        @Res({ passthrough: true }) response: Response,
    ): Promise<void> {
        await this.requirePassword(request.user.id, dto.password);

        await this.authService.deleteUser(request.user.id);
        clearSessionCookie(response);
        this.logger.event("account.deleted", { userId: request.user.id });
    }

    private async requirePassword(userId: number, password: string) {
        if (!(await this.authService.verifyPassword(userId, password))) {
            throw new ForbiddenException("Неверный текущий пароль");
        }
    }
}
