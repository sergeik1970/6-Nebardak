import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { User } from "../../entities/User/user.entity";
import { UserSession } from "../../entities/UserSession/user-session.entity";
import { EmailToken } from "../../entities/EmailToken/email-token.entity";
import { LoginChallenge } from "../../entities/LoginChallenge/login-challenge.entity";
import { TrustedDevice } from "../../entities/TrustedDevice/trusted-device.entity";
import { AdminLoginCodeService } from "../../services/AdminLoginCodeService/admin-login-code.service";
import { TrustedDeviceService } from "../../services/TrustedDeviceService/trusted-device.service";
import { EmailTokenService } from "../../services/EmailTokenService/email-token.service";
import { MailService } from "../../services/MailService/mail.service";
import { AccountRecoveryService } from "../../services/AccountRecoveryService/account-recovery.service";
import { AccountMaintenanceService } from "../../services/AccountMaintenanceService/account-maintenance.service";
import { OperationalLogger } from "../../services/OperationalLogger/operational-logger.service";
import { AuthService } from "../../services/AuthService/auth.service";
import { SessionService } from "../../services/SessionService/session.service";
import { AuthController } from "../../controllers/AuthController/auth.controller";
import { AccountController } from "../../controllers/AccountController/account.controller";
import { AuthGuard } from "../../guards/auth.guard";
import { RegistrationEnabledGuard } from "../../guards/registration-enabled.guard";
import { AuthEnabledGuard } from "../../guards/auth-enabled.guard";

@Module({
    imports: [
        TypeOrmModule.forFeature([
            User,
            UserSession,
            EmailToken,
            LoginChallenge,
            TrustedDevice,
        ]),
    ],
    controllers: [AuthController, AccountController],
    providers: [
        AuthService,
        SessionService,
        EmailTokenService,
        MailService,
        AccountRecoveryService,
        AdminLoginCodeService,
        TrustedDeviceService,
        AccountMaintenanceService,
        OperationalLogger,
        AuthGuard,
        AuthEnabledGuard,
        RegistrationEnabledGuard,
    ],
    exports: [AuthService, SessionService, AuthGuard, AuthEnabledGuard],
})
export class AuthModule {}
