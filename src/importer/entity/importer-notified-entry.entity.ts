import { ImporterEntry } from "./importer-entry.entity";
import { Column, Entity, Unique } from "typeorm";

@Entity()
@Unique(["gameExternalGame", "library"])
export class ImporterNotifiedEntry extends ImporterEntry {
    @Column({ default: false })
    autoImportRetryable: boolean;
}
