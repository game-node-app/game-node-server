import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

test("the installed Steam client uses bounded requests and preserves transport failures", () => {
    const script = String.raw`
        const assert = require('node:assert/strict');
        const axios = require('axios').default;
        require('./src/sync/player-provider-budget.service').setPlayerProviderBudget({run: (_provider, work) => work()});
        const { SteamSyncService } = require('./src/sync/steam/steam-sync.service');
        const { setCacheManager } = require('./src/utils/cacheable');
        setCacheManager({get: async () => undefined, set: async () => undefined});
        const requests = [];
        let failure;
        axios.get = async (url, config) => {
            requests.push({url, config});
            if (failure) throw failure;
            return {data: {response: {games: [{appid: 10, playtime_forever: 20}]}}};
        };
        (async () => {
            const service = new SteamSyncService({get: () => 'fixture-key'});
            for (let i = 0; !service.client && i < 200; i++) await new Promise(r => setTimeout(r, 5));
            assert.ok(service.client, 'Steam SDK initialization failed');
            const games = await service.getAllGames('76561198136665859');
            assert.equal(games[0].game.id, 10);
            assert.equal(requests[0].config.timeout, 30000);
            assert.ok(requests[0].config.signal instanceof AbortSignal);
            assert.equal(requests[0].config.params.key, 'fixture-key');
            assert.equal(requests[0].config.params.steamid, '76561198136665859');
            failure = {response: {status: 429, headers: {'retry-after': '60'}}};
            await assert.rejects(service.getAllGames('76561198136665859'), e => e.outcome === 'throttled' && e.retryAfterMs === 60000 && e.cause === failure);
            process.stdout.write('ok');
        })().catch(error => { console.error(error); process.exitCode = 1; });
    `;
    expect(
        execFileSync(
            process.execPath,
            ["-r", "ts-node/register/transpile-only", "-e", script],
            {
                cwd: resolve(__dirname, "../../.."),
                encoding: "utf8",
                timeout: 15000,
            },
        ),
    ).toBe("ok");
});
