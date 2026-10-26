export const NOTIFICATIONS_QUEUE_NAME = "notifications-queue";

export const NOTIFICATIONS_PROCESS_OUTBOX_JOB_NAME =
    "notifications-process-outbox";

export const NOTIFICATIONS_RELAY_SCHEDULER_ID = "notifications-relay";
export const NOTIFICATIONS_RELAY_TICK_JOB_NAME = "notifications-relay-tick";
export const NOTIFICATIONS_RELAY_INTERVAL_MS = 1000;

export const OUTBOX_DEFAULT_CLAIM_LIMIT = 100;
export const OUTBOX_DEFAULT_LEASE_MS = 30000;
export const OUTBOX_MAX_ATTEMPTS = 5;
export const OUTBOX_BASE_BACKOFF_MS = 1000;
export const OUTBOX_MAX_BACKOFF_MS = 60000;

export const NOTIFICATIONS_JOB_RETENTION_COMPLETE = {
    age: 3600,
    count: 1000,
};

export const NOTIFICATIONS_JOB_RETENTION_FAIL = {
    age: 86400,
    count: 1000,
};
