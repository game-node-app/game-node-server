import {
    Column,
    CreateDateColumn,
    Entity,
    OneToMany,
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
     */
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Column({ nullable: false, unique: true })
    userId: string;
    @OneToMany(() => Collection, (collection) => collection.library)
    collections: Collection[];
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
