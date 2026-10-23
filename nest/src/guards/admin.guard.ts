import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from "@nestjs/common";
import { AuthenticatedRequest } from "./auth.guard";

/**
 * Runs after AuthGuard. Keeping authorization on the API means a direct page
 * request or a forged frontend role can never expose admin data. The session
 * must also have passed the emailed code: one opened before the account was
 * elevated, or by a password-reset link, does not count.
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
        if (!request.session?.secondFactorAt) {
            throw new ForbiddenException(
                "Войдите заново: администратору нужен код из письма",
            );
        }

        return true;
    }
}
