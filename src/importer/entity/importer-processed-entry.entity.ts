import { Entity, Unique } from "typeorm";
import { ImporterEntry } from "./importer-entry.entity";

/**
 * Table to keep track of external games which have already been imported.
 */
@Entity()
@Unique(["gameExternalGame", "library"])
export class ImporterProcessedEntry extends ImporterEntry {}
