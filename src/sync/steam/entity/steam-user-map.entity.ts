import { Entity, PrimaryColumn } from "typeorm";

@Entity()
export class SteamUserMap {
    /**
     * User ID commonly used in our services (provided by SuperTokens)
     */
    @PrimaryColumn({
        type: "uuid",
        length: 36,
    })
    userId: string;
    @PrimaryColumn()
    steamUserId: string;
}
