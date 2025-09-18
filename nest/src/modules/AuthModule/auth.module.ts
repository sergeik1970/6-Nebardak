import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { User } from "../../entities/User/user.entity";
import { AuthService } from "../../services/AuthService/auth.service";
import { AuthController } from "../../controllers/AuthController/auth.controller";

@Module({
    imports: [TypeOrmModule.forFeature([User])],
    controllers: [AuthController],
    providers: [AuthService],
    exports: [AuthService],
})
export class AuthModule {}
