import { Profile } from "../entities/profile.entity";

export class FindAllProfileResponseItemDto {
    profile: Profile;
    isSuspended: boolean;
    isBanned: boolean;
}
