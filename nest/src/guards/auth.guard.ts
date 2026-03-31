import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from "@nestjs/common";
import { AuthService } from "src/services/AuthService/auth.service";
import { Request } from "express";

@Injectable()
export class AuthGuard implements CanActivate {
    constructor(private readonly authService: AuthService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<Request>();
        const authorization = request.headers["authorization"];

        if (!authorization) {
            throw new UnauthorizedException("Токен не предоставлен");
        }

        const token = authorization.replace("Bearer ", "");
        const user = await this.authService.validateToken(token);

        if (!user) {
            throw new UnauthorizedException("Недействительный токен");
        }

        return true;
    }
}
