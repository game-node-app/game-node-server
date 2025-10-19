import {
    Column,
    Entity,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
} from "typeorm";
import { EConnectionType } from "../connections.constants";
import { Profile } from "../../profile/entities/profile.entity";
import { Collection } from "../../collections/entities/collection.entity";

@Entity()
@Unique(["profile", "type"])
export class UserConnection {
    @PrimaryGeneratedColumn()
    id: number;
    @Column({
        nullable: false,
    })
    type: EConnectionType;
    @ManyToOne(() => Profile, {
        nullable: false,
        onDelete: "CASCADE",
    })
    profile: Profile;
    @Column({
        nullable: false,
    })
    profileUserId: string;

    @Column({
        nullable: false,
    })
    sourceUserId: string;
    @Column({
        nullable: false,
    })
    sourceUsername: string;
    @Column({
        nullable: false,
        default: true,
    })
    isImporterEnabled: boolean;
    @Column({
        nullable: false,
        default: true,
    })
    isPlaytimeImportEnabled: boolean;
    @Column({
        nullable: false,
        default: false,
    })
    isAutoImportEnabled: boolean;
    @ManyToOne(() => Collection, {
        nullable: true,
        onDelete: "SET NULL",
    })
    autoImportCollection: Collection | null;
    @Column({
        nullable: true,
        type: "varchar",
        length: 36,
    })
    autoImportCollectionId: string | null;
}
