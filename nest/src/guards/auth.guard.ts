import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from "@nestjs/common";
import { AuthService } from "../services/AuthService/auth.service";
import { Request } from "express";
import { User } from "../entities/User/user.entity";

export type AuthenticatedRequest = Request & { user: User };

@Injectable()
export class AuthGuard implements CanActivate {
    constructor(private readonly authService: AuthService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context
            .switchToHttp()
            .getRequest<AuthenticatedRequest>();
        const authorization = request.headers["authorization"];

        if (typeof authorization !== "string") {
            throw new UnauthorizedException("Токен не предоставлен");
        }

        const [scheme, token, trailingValue] = authorization
            .trim()
            .split(/\s+/);
        if (scheme?.toLowerCase() !== "bearer" || !token || trailingValue) {
            throw new UnauthorizedException("Недействительный токен");
        }

        const user = await this.authService.validateToken(token);

        if (!user) {
            throw new UnauthorizedException("Недействительный токен");
        }

        request.user = user;
        return true;
    }
}
