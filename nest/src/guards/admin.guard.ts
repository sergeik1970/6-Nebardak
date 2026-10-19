import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from "@nestjs/common";
import { AuthenticatedRequest } from "./auth.guard";

/**
 * Runs after AuthGuard. Keeping authorization on the API means a direct page
 * request or a forged frontend role can never expose observations.
 */
@Injectable()
export class AdminGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const request = context
            .switchToHttp()
            .getRequest<AuthenticatedRequest>();

        if (request.user?.role !== "admin") {
            throw new ForbiddenException("Доступ только для администратора");
        }

        return true;
    }
}
