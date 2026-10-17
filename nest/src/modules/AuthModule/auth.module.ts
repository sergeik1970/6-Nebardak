import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { User } from "../../entities/User/user.entity";
import { AuthService } from "../../services/AuthService/auth.service";
import { AuthController } from "../../controllers/AuthController/auth.controller";
import { AuthGuard } from "../../guards/auth.guard";
import { RegistrationEnabledGuard } from "../../guards/registration-enabled.guard";
import { AuthEnabledGuard } from "../../guards/auth-enabled.guard";

@Module({
    imports: [TypeOrmModule.forFeature([User])],
    controllers: [AuthController],
    providers: [
        AuthService,
        AuthGuard,
        AuthEnabledGuard,
        RegistrationEnabledGuard,
    ],
    exports: [AuthService, AuthGuard, AuthEnabledGuard],
})
export class AuthModule {}
