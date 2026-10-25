import {
    Column,
    Entity,
    JoinColumn,
    OneToOne,
    PrimaryColumn,
    UpdateDateColumn,
} from "typeorm";
import { UserConnection } from "./user-connection.entity";

@Entity()
export class UserConnectionCredential {
    @PrimaryColumn()
    connectionId: number;

    @OneToOne(() => UserConnection, {
        onDelete: "CASCADE",
    })
    @JoinColumn({
        name: "connectionId",
        foreignKeyConstraintName: "FK_user_connection_credential",
    })
    connection: UserConnection;

    @Column({
        type: "text",
        nullable: false,
    })
    accessTokenEncrypted: string;

    @Column({
        type: "text",
        nullable: true,
    })
    refreshTokenEncrypted: string | null;

    @Column({
        type: "datetime",
        precision: 3,
        nullable: true,
    })
    expiresAt: Date | null;

    @Column({
        type: "datetime",
        precision: 3,
        nullable: true,
    })
    refreshTokenExpiresAt: Date | null;

    @Column({
        type: "text",
        nullable: true,
    })
    providerMetadataEncrypted: string | null;

    @UpdateDateColumn({
        type: "datetime",
        precision: 3,
    })
    updatedAt: Date;
}
