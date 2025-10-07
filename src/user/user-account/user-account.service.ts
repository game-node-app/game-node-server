import { Injectable } from "@nestjs/common";
import { LibrariesService } from "../../libraries/libraries.service";
import { ProfileService } from "../../profile/profile.service";

@Injectable()
export class UserAccountService {
    constructor(
        private readonly librariesService: LibrariesService,
        private readonly profileService: ProfileService,
    ) {}

    async restartUserAccount(userId: string) {
        await this.librariesService.deleteByUserId(userId);
        await this.profileService.deleteByUserId(userId);
    }
}
