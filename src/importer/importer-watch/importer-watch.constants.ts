import { EImporterSource } from "../importer.constants";

export const IMPORTER_WATCH_QUEUE_NAME = "importer-watch-queue";

export const IMPORTER_WATCH_JOB_NAME = "importer-watch-job";

export type ImporterWatchJob = {
    userId: string;
    source: EImporterSource;
};
