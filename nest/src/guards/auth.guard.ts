import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";
import { User } from "../entities/User/user.entity";
import { UserSession } from "../entities/UserSession/user-session.entity";
import { readSessionToken } from "../security/session-cookie";
import { SessionService } from "../services/SessionService/session.service";

export type AuthenticatedRequest = Request & {
    user: User;
    session: UserSession;
};

/** Resolves the HttpOnly session cookie; there is no bearer-token path. */
@Injectable()
export class AuthGuard implements CanActivate {
    constructor(private readonly sessionService: SessionService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context
            .switchToHttp()
            .getRequest<AuthenticatedRequest>();

        const authenticated = await this.sessionService.authenticate(
            readSessionToken(request),
        );
        if (!authenticated) {
            throw new UnauthorizedException("Требуется вход");
        }

        request.user = authenticated.user;
        request.session = authenticated.session;
        return true;
    }
}
