import { Column, Entity, PrimaryGeneratedColumn, Unique } from "typeorm";

@Entity()
@Unique(["providerId", "providerUserId"])
export class LinkedProvider {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ nullable: false })
    userId: string; // The primary GameNode / Supertokens User ID

    @Column({ nullable: false })
    providerId: string; // e.g. "google", "discord"

    @Column({ nullable: false })
    providerUserId: string; // The ID from the third party
}
