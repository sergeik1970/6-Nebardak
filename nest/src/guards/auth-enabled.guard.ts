import { CanActivate, Injectable, NotFoundException } from "@nestjs/common";
import { isAuthEnabled } from "../config/runtime.config";

/**
 * Authentication is an opt-in server feature. Returning 404 while it is off
 * avoids exposing dormant login, registration and profile endpoints.
 */
@Injectable()
export class AuthEnabledGuard implements CanActivate {
    canActivate(): boolean {
        if (!isAuthEnabled()) {
            throw new NotFoundException("Маршрут не найден");
        }

        return true;
    }
}
