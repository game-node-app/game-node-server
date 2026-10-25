import { BadRequestException } from "@nestjs/common";

export class UnsupportedGameAchievementSourceError extends BadRequestException {
    constructor() {
        super("Category mapping not implemented.");
    }
}
