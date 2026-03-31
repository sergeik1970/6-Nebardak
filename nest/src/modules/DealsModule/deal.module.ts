import { Module } from "@nestjs/common";
import { DealsService } from "src/services/DealsService/deal.service";
import { DealsController } from "src/controllers/DealsController/deals.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Deals } from "src/entities/Deals/deals.entity";
import { AuthModule } from "../AuthModule/auth.module";
import { AuthGuard } from "src/guards/auth.guard";

@Module({
    imports: [TypeOrmModule.forFeature([Deals]), AuthModule],
    controllers: [DealsController],
    providers: [DealsService, AuthGuard],
})
export class DealsModule {}
