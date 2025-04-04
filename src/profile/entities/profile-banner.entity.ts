import { Entity } from "typeorm";
import { PersistedImageDetails } from "../../utils/db/persisted-image-details.entity";

@Entity()
export class ProfileBanner extends PersistedImageDetails {}
