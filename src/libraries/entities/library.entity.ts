import {
    CreateDateColumn,
    Entity,
    OneToMany,
    PrimaryColumn,
    UpdateDateColumn,
} from "typeorm";
import { Collection } from "../../collections/entities/collection.entity";

@Entity()
export class Library {
    /**
     * @description The primary key of the library entity.
     * Also used to share the library with other users.
     *
     * Same as SuperTokens' userId.
     */
    @PrimaryColumn({
        nullable: false,
        length: 36,
        type: "varchar",
    })
    userId: string;
    @OneToMany(() => Collection, (collection) => collection.library)
    collections: Collection[];
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
