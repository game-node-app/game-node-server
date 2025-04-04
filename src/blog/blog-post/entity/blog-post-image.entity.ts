import { PersistedImageDetails } from "../../../utils/db/persisted-image-details.entity";
import { Entity } from "typeorm";

@Entity()
export class BlogPostImage extends PersistedImageDetails {}
