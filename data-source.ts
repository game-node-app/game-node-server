import "reflect-metadata";
import { DataSource } from "typeorm";
import * as process from "process";
import * as dotenv from "dotenv";
dotenv.config();

export const AppDataSource = new DataSource({
    type: "mysql",
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT as string) as any,
    timezone: "Z",
    username: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_DATABASE,
    synchronize: false,
    logging: false,
    entities: ["src/**/*.entity.{ts,js}"],
    // Timestamped files only: the integration spec beside them calls describe() at load time.
    migrations: ["src/migrations/[0-9]*.ts"],
});
