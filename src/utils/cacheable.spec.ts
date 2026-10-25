import { Cacheable, setCacheManager } from "./cacheable";

class CachedFixture {
    calls = 0;
    value: unknown = [];
    error?: Error;

    @Cacheable("unrelated-fixture", 1234)
    async read() {
        this.calls++;
        if (this.error) throw this.error;
        return this.value;
    }
}

test("the existing decorator caches complete empty arrays and ordinary results", async () => {
    const values = new Map<string, unknown>();
    const set = jest.fn(async (key, value) => {
        values.set(key, value);
    });
    setCacheManager({
        get: jest.fn(async (key) => values.get(key)),
        set,
    } as any);
    const fixture = new CachedFixture();
    await expect(fixture.read()).resolves.toEqual([]);
    await expect(fixture.read()).resolves.toEqual([]);
    expect(fixture.calls).toBe(1);
    expect(set).toHaveBeenCalledWith("unrelated-fixture#read__[]", [], 1234);
    values.clear();
    fixture.value = { ordinary: true };
    await expect(fixture.read()).resolves.toEqual({ ordinary: true });
    await expect(fixture.read()).resolves.toEqual({ ordinary: true });
    expect(fixture.calls).toBe(2);
});

test("rejected fetches do not overwrite an earlier complete value", async () => {
    const previous = ["complete"];
    const set = jest.fn().mockResolvedValue(undefined);
    setCacheManager({
        get: jest.fn().mockResolvedValue(undefined),
        set,
    } as any);
    const fixture = new CachedFixture();
    fixture.error = new Error("incomplete");
    await expect(fixture.read()).rejects.toBe(fixture.error);
    expect(set).not.toHaveBeenCalled();
    setCacheManager({ get: jest.fn().mockResolvedValue(previous), set } as any);
    await expect(fixture.read()).resolves.toBe(previous);
    expect(fixture.calls).toBe(1);
});
