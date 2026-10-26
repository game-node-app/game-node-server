import "reflect-metadata";
import { NotificationsRelayService } from "./notifications-relay.service";

it("claims N rows with one SELECT and N UPDATEs, returning persisted ownership", async () => {
    const dueRows = ["event-1", "event-2"].map(
        (id) =>
            ({
                id,
                state: "pending",
                attempts: 0,
                ownerToken: null,
                ownerExpiresAt: null,
            }) as any,
    );
    const query = jest
        .fn()
        .mockResolvedValueOnce(dueRows)
        .mockResolvedValue(undefined);
    const manager = {
        query,
        findOne: jest.fn(),
        update: jest.fn(),
    };
    const relay = new NotificationsRelayService(
        {
            transaction: (work: (manager: any) => Promise<unknown>) =>
                work(manager),
        } as any,
        {} as any,
        {} as any,
    );

    const claimed = await relay.claimDueRows(2, 10000);

    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls.map(([sql]) => sql.trim().split(/\s+/)[0])).toEqual([
        "SELECT",
        "UPDATE",
        "UPDATE",
    ]);
    expect(manager.findOne).not.toHaveBeenCalled();
    expect(claimed).toHaveLength(2);
    for (const row of claimed) {
        const [sql, parameters] = query.mock.calls.find(
            ([sql, values]) =>
                sql.startsWith("UPDATE notification_outbox") &&
                values[2] === row.id,
        )!;
        expect(sql).toContain("SET state = 'processing'");
        expect(sql).toContain("ownerToken = ?");
        expect(sql).toContain("ownerExpiresAt = ?");
        expect(sql).toContain("attempts = attempts + 1");
        expect(row).toMatchObject({
            state: "processing",
            attempts: 1,
            ownerToken: parameters[0],
            ownerExpiresAt: parameters[1],
        });
    }
});
