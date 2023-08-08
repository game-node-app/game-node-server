import { forwardRef, Module } from "@nestjs/common";
import { LibrariesService } from "./libraries.service";
import { LibrariesController } from "./libraries.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Library } from "./entities/library.entity";
import { CollectionsModule } from "../collections/collections.module";

// TODO: Rename this module to the singular form
@Module({
    imports: [TypeOrmModule.forFeature([Library])],
    controllers: [LibrariesController],
    providers: [LibrariesService],
    exports: [LibrariesService],
})
export class LibrariesModule {}
