import { Module } from "@nestjs/common";
import { DealsModule } from "./modules/DealsModule/deal.module";
import { AuthModule } from "./modules/AuthModule/auth.module";
import { TypeOrmModule } from "@nestjs/typeorm";

@Module({
    imports: [
        TypeOrmModule.forRoot({
            type: "postgres",
            host: process.env.NODE_ENV == "dev" ? "127.0.0.1" : "db",
            port: Number(process.env.DB_PORT) || 5432,
            username: process.env.DB_USERNAME,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            autoLoadEntities: true,
            synchronize: process.env.NODE_ENV === "dev",
        }),
        DealsModule,
        AuthModule,
    ],
    controllers: [],
    providers: [],
})
export class AppModule {}
