import {
    Column,
    Entity,
    ManyToOne,
    OneToOne,
    PrimaryGeneratedColumn,
    Unique,
} from "typeorm";
import { EConnectionAuthStatus, EConnectionType } from "../connections.constants";
import { Profile } from "../../profile/entities/profile.entity";
import { Collection } from "../../collections/entities/collection.entity";
import { UserConnectionCredential } from "./user-connection-credential.entity";

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

    @Column({
        type: "varchar",
        length: 32,
        nullable: false,
        default: EConnectionAuthStatus.CONNECTED,
    })
    authStatus: EConnectionAuthStatus;

    @OneToOne(
        () => UserConnectionCredential,
        (credential) => credential.connection,
        {
            cascade: true,
            nullable: true,
        },
    )
    credential?: UserConnectionCredential;
}
