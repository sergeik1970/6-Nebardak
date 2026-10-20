import {
    BadRequestException,
    Body,
    Controller,
    Get,
    HttpCode,
    Post,
    Req,
    Res,
    ServiceUnavailableException,
    UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import {
    AuthService,
    PublicUser,
    toPublicUser,
} from "../../services/AuthService/auth.service";
import { SessionService } from "../../services/SessionService/session.service";
import { AccountRecoveryService } from "../../services/AccountRecoveryService/account-recovery.service";
import {
    EmailTokenDto,
    ForgotPasswordDto,
    ResetPasswordDto,
} from "../../dto/auth/email-flows.dto";
import { RegisterDto } from "../../dto/auth/register.dto";
import { LoginDto } from "../../dto/auth/login.dto";
import { User } from "../../entities/User/user.entity";
import { AuthGuard, AuthenticatedRequest } from "../../guards/auth.guard";
import { RegistrationEnabledGuard } from "../../guards/registration-enabled.guard";
import { AuthEnabledGuard } from "../../guards/auth-enabled.guard";
import {
    clearSessionCookie,
    readSessionToken,
    setSessionCookie,
} from "../../security/session-cookie";

@Controller("auth")
@UseGuards(AuthEnabledGuard)
export class AuthController {
    constructor(
        private readonly authService: AuthService,
        private readonly sessionService: SessionService,
        private readonly recovery: AccountRecoveryService,
    ) {}

    @Throttle({
        default: {
            limit: 3,
            ttl: 10 * 60_000,
            blockDuration: 10 * 60_000,
        },
    })
    @UseGuards(RegistrationEnabledGuard)
    @Post("register")
    async register(
        @Body() registerDto: RegisterDto,
        @Req() request: Request,
        @Res({ passthrough: true }) response: Response,
    ): Promise<{ user: PublicUser }> {
        const user = await this.authService.register(registerDto);
        const result = await this.startSession(user, request, response);
        // Mail delivery must not slow down or fail the sign-up itself.
        void this.recovery.sendVerification(user);
        return result;
    }

    @Throttle({
        default: {
            limit: 10,
            ttl: 5 * 60_000,
            blockDuration: 5 * 60_000,
        },
    })
    @HttpCode(200)
    @Post("login")
    async login(
        @Body() loginDto: LoginDto,
        @Req() request: Request,
        @Res({ passthrough: true }) response: Response,
    ): Promise<{ user: PublicUser }> {
        const user = await this.authService.login(loginDto);
        // A sign-in always replaces whatever session this browser had.
        await this.sessionService.revoke(readSessionToken(request));
        return this.startSession(user, request, response);
    }

    /** Idempotent: an expired or missing session still clears the cookie. */
    @HttpCode(204)
    @Post("logout")
    async logout(
        @Req() request: Request,
        @Res({ passthrough: true }) response: Response,
    ): Promise<void> {
        await this.sessionService.revoke(readSessionToken(request));
        clearSessionCookie(response);
    }

    @UseGuards(AuthGuard)
    @HttpCode(204)
    @Post("logout-all")
    async logoutAll(
        @Req() request: AuthenticatedRequest,
        @Res({ passthrough: true }) response: Response,
    ): Promise<void> {
        await this.sessionService.revokeAll(request.user.id);
        clearSessionCookie(response);
    }

    /** Opened from the letter; works on any device, signed in or not. */
    @Throttle({
        default: { limit: 10, ttl: 15 * 60_000, blockDuration: 15 * 60_000 },
    })
    @HttpCode(200)
    @Post("verify-email")
    async verifyEmail(
        @Body() dto: EmailTokenDto,
    ): Promise<{ user: PublicUser }> {
        const user = await this.recovery.verifyEmail(dto.token);
        if (!user) throw this.invalidLink();
        return { user: toPublicUser(user) };
    }

    @Throttle({
        default: { limit: 3, ttl: 15 * 60_000, blockDuration: 15 * 60_000 },
    })
    @UseGuards(AuthGuard)
    @HttpCode(204)
    @Post("resend-verification")
    async resendVerification(
        @Req() request: AuthenticatedRequest,
    ): Promise<void> {
        if (request.user.emailVerifiedAt) return;
        if (!(await this.recovery.sendVerification(request.user))) {
            throw new ServiceUnavailableException(
                "Не удалось отправить письмо. Попробуйте позже.",
            );
        }
    }

    /**
     * Always 202 and returns before any lookup, so neither the body nor the
     * timing tells whether the address has an account.
     */
    @Throttle({
        default: { limit: 5, ttl: 15 * 60_000, blockDuration: 15 * 60_000 },
    })
    @HttpCode(202)
    @Post("forgot-password")
    forgotPassword(@Body() dto: ForgotPasswordDto): { accepted: true } {
        void this.recovery.requestPasswordReset(dto.email);
        return { accepted: true };
    }

    @Throttle({
        default: { limit: 10, ttl: 15 * 60_000, blockDuration: 15 * 60_000 },
    })
    @HttpCode(200)
    @Post("reset-password")
    async resetPassword(
        @Body() dto: ResetPasswordDto,
        @Req() request: Request,
        @Res({ passthrough: true }) response: Response,
    ): Promise<{ user: PublicUser }> {
        const user = await this.recovery.resetPassword(dto.token, dto.password);
        if (!user) throw this.invalidLink();
        return this.startSession(user, request, response);
    }

    /**
     * The page-load probe. A guest is a normal state, not an error, so it
     * answers 200 with `user: null` instead of a 401 in every browser console.
     */
    @Get("session")
    async getSession(
        @Req() request: Request,
    ): Promise<{ user: PublicUser | null }> {
        const authenticated = await this.sessionService.authenticate(
            readSessionToken(request),
        );
        return {
            user: authenticated ? toPublicUser(authenticated.user) : null,
        };
    }

    @UseGuards(AuthGuard)
    @Get("me")
    getProfile(@Req() request: AuthenticatedRequest): { user: PublicUser } {
        return { user: toPublicUser(request.user) };
    }

    private invalidLink(): BadRequestException {
        return new BadRequestException(
            "Ссылка недействительна или устарела. Запросите новое письмо.",
        );
    }

    private async startSession(
        user: User,
        request: Request,
        response: Response,
    ): Promise<{ user: PublicUser }> {
        const { token } = await this.sessionService.create(
            user,
            request.headers["user-agent"],
        );
        setSessionCookie(response, token);
        return { user: toPublicUser(user) };
    }
}
