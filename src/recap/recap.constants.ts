export const RECAP_QUEUE_NAME = "year-recap-queue";

export const RECAP_CREATE_JOB_NAME = "create-year-recap-job";

export const RECAP_PROCESS_JOB_NAME = "create-year-recap-process-job";

export const RECAP_GOAL_REMINDER_JOB_NAME = "send-year-goal-reminder-job";

export const RECAP_SELECTION_PAGE_SIZE = 1000;

// shortcut: fixed concurrency 4; upgrade when the daily run exceeds 2 h.
export const RECAP_PROCESSOR_CONCURRENCY = 4;
