/** One shared limiter per run. Call only around leaf I/O, never orchestration. */
export class AsyncLeafLimiter {
    private active = 0;
    private readonly waiting: (() => void)[] = [];
    constructor(readonly maximum: number) {
        if (!Number.isInteger(maximum) || maximum < 1 || maximum > 2)
            throw new Error("Relationship concurrency must be 1 or 2");
    }
    async run<T>(operation: () => Promise<T>): Promise<T> {
        await new Promise<void>((resolve) => {
            const admit = () => {
                this.active++;
                resolve();
            };
            if (this.active < this.maximum) admit();
            else this.waiting.push(admit);
        });
        try {
            return await operation();
        } finally {
            this.active--;
            this.waiting.shift()?.();
        }
    }
}

export async function settleOperations(
    operations: Promise<unknown>[],
): Promise<void> {
    const settled = await Promise.allSettled(operations);
    const failed = settled.find(
        (result): result is PromiseRejectedResult =>
            result.status === "rejected",
    );
    if (failed) throw failed.reason;
}
