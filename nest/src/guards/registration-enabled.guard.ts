import { CanActivate, Injectable, NotFoundException } from "@nestjs/common";
import { isRegistrationEnabled } from "../config/runtime.config";

@Injectable()
export class RegistrationEnabledGuard implements CanActivate {
    canActivate(): boolean {
        if (!isRegistrationEnabled()) {
            throw new NotFoundException("Маршрут не найден");
        }

        return true;
    }
}
