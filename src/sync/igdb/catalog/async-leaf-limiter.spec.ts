import { AsyncLeafLimiter, settleOperations } from "./async-leaf-limiter";

describe("shared relationship limiter", () => {
    it("bounds two games globally and settles all started work before rejecting", async () => {
        const limiter = new AsyncLeafLimiter(2);
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let active = 0;
        let maximum = 0;
        let started = 0;
        const game = () =>
            settleOperations(
                Array.from({ length: 5 }, () =>
                    limiter.run(async () => {
                        maximum = Math.max(maximum, ++active);
                        started++;
                        try {
                            await gate;
                        } finally {
                            active--;
                        }
                    }),
                ),
            );
        const games = [game(), game()];
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(started).toBe(2);
        expect(maximum).toBe(2);
        release();
        await Promise.all(games);
        expect(started).toBe(10);
        expect(maximum).toBe(2);
        expect(active).toBe(0);
        let finish!: () => void;
        let rejected = false;
        const pending = new Promise<void>((resolve) => {
            finish = resolve;
        });
        const settling = settleOperations([
            Promise.reject(new Error("fault")),
            pending,
        ]).catch(() => {
            rejected = true;
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(rejected).toBe(false);
        finish();
        await settling;
        expect(rejected).toBe(true);
    });
});
