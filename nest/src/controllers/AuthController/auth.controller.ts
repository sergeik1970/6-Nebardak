import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { AuthService } from "../../services/AuthService/auth.service";
import { RegisterDto } from "../../dto/auth/register.dto";
import { LoginDto } from "../../dto/auth/login.dto";
import { AuthGuard, AuthenticatedRequest } from "../../guards/auth.guard";
import { RegistrationEnabledGuard } from "../../guards/registration-enabled.guard";
import { AuthEnabledGuard } from "../../guards/auth-enabled.guard";

@Controller("auth")
@UseGuards(AuthEnabledGuard)
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    @Throttle({
        default: {
            limit: 3,
            ttl: 10 * 60_000,
            blockDuration: 10 * 60_000,
        },
    })
    @UseGuards(RegistrationEnabledGuard)
    @Post("register")
    async register(@Body() registerDto: RegisterDto) {
        return this.authService.register(registerDto);
    }

    @Throttle({
        default: {
            limit: 10,
            ttl: 5 * 60_000,
            blockDuration: 5 * 60_000,
        },
    })
    @Post("login")
    async login(@Body() loginDto: LoginDto) {
        return this.authService.login(loginDto);
    }

    @UseGuards(AuthGuard)
    @Get("me")
    getProfile(@Req() request: AuthenticatedRequest) {
        const { id, name, email, role } = request.user;
        return {
            user: {
                id,
                name,
                email,
                role,
            },
        };
    }
}
