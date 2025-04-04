import { Entity, PrimaryColumn } from "typeorm";

@Entity()
export class BlogPostTag {
    /**
     * The provided identifier for this tag.
     * It should be a lowercase version of the tag's name.
     */
    @PrimaryColumn()
    id: string;

    name: string;
}
