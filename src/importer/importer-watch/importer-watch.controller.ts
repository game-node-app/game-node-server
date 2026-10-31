import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../../auth/auth.guard";
import { Session, SessionContainer } from "../../auth/session.decorator";
import { ImporterWatchService } from "./importer-watch.service";

@Controller("importer/watch")
@ApiTags("importer-watch")
@UseGuards(AuthGuard)
export class ImporterWatchController {
    constructor(private readonly importerWatchService: ImporterWatchService) {}

    @Get("notification/:id")
    async findNotification(
        @Session() session: SessionContainer,
        @Param("id") notificationId: number,
    ) {
        return this.importerWatchService.findNotification(
            session.getUserId(),
            notificationId,
        );
    }
}
