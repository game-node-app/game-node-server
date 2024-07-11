import { Column } from "typeorm";

/**
 * Abstract entity that contains required metadata for user uploaded images. <br>
 * Must be extended by a class decorated with @Entity to have effect.
 */
export abstract class PersistedImageDetails {
    @Column({ nullable: false })
    mimetype: string;
    @Column({ nullable: false })
    extension: string;
    @Column({ nullable: false })
    size: number;
    @Column({ nullable: false })
    filename: string;
    @Column({ nullable: false })
    encoding: string;
}
