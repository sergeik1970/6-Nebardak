import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { User } from "../../entities/User/user.entity";
import { UserSession } from "../../entities/UserSession/user-session.entity";
import { AuthService } from "../../services/AuthService/auth.service";
import { SessionService } from "../../services/SessionService/session.service";
import { AuthController } from "../../controllers/AuthController/auth.controller";
import { AuthGuard } from "../../guards/auth.guard";
import { RegistrationEnabledGuard } from "../../guards/registration-enabled.guard";
import { AuthEnabledGuard } from "../../guards/auth-enabled.guard";

@Module({
    imports: [TypeOrmModule.forFeature([User, UserSession])],
    controllers: [AuthController],
    providers: [
        AuthService,
        SessionService,
        AuthGuard,
        AuthEnabledGuard,
        RegistrationEnabledGuard,
    ],
    exports: [AuthService, SessionService, AuthGuard, AuthEnabledGuard],
})
export class AuthModule {}
