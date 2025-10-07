import { ImporterEntry } from "./importer-entry.entity";
import { Entity, Unique } from "typeorm";

@Entity()
@Unique(["gameExternalGame", "library"])
export class ImporterNotifiedEntry extends ImporterEntry {}
