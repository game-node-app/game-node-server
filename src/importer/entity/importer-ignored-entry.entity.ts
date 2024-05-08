import { Entity, Unique } from "typeorm";
import { ImporterEntry } from "./importer-entry.entity";

/**
 * Table representing external games which have been 'ignored' by the user, and thus
 * won't trigger new notifications when checking for updates on their library.
 */
@Entity()
@Unique(["gameExternalGame", "library"])
export class ImporterIgnoredEntry extends ImporterEntry {}
