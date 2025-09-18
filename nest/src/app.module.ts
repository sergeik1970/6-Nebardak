import { Module } from "@nestjs/common";
import { DealsModule } from "./modules/DealsModule/deal.module";
import { AuthModule } from "./modules/AuthModule/auth.module";
import { TypeOrmModule } from "@nestjs/typeorm";

@Module({
    imports: [
        TypeOrmModule.forRoot({
            type: "postgres",
            host: process.env.NODE_ENV == "dev" ? "127.0.0.1" : "db",
            port: 5432,
            username: "postgres",
            password: "postgres",
            database: "postgres",
            autoLoadEntities: true,
            synchronize: true,
        }),
        DealsModule,
        AuthModule,
    ],
    controllers: [],
    providers: [],
})
export class AppModule {}
