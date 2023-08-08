import {
    Column,
    CreateDateColumn,
    Entity,
    OneToMany,
    PrimaryColumn,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { Collection } from "../../collections/entities/collection.entity";
import { IsNotEmpty } from "class-validator";

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
