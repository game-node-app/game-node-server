import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

/**
 * Single-row table (id is always 1) holding the system-wide PSN NPSSO,
 * encrypted with ConnectionCredentialCryptoService.
 */
@Entity()
export class PsnSystemCredential {
    @PrimaryColumn()
    id: number;

    @Column({ type: "text", nullable: false })
    npssoEncrypted: string;

    @UpdateDateColumn({ type: "datetime", precision: 3 })
    updatedAt: Date;
}
