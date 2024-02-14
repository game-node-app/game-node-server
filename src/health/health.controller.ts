import { Controller, Get } from "@nestjs/common";
import { HealthService } from "./health.service";
import { ApiTags } from "@nestjs/swagger";

@Controller("health")
@ApiTags("health")
export class HealthController {
    constructor(private healthService: HealthService) {
    }

    @Get()
    async health() {
        return this.healthService.checkHealth();
    }
}
