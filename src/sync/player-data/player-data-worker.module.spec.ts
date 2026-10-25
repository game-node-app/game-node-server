import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

test("the application module graph resolves without new forward-reference cycles", () => {
    const script = String.raw`
        require('reflect-metadata');
        const {AppModule} = require('./src/app.module');
        const seen = new Set();
        async function visit(input) {
            const ref = await input;
            if (!ref) throw new Error('Unresolved Nest module import');
            if (ref.forwardRef) return visit(ref.forwardRef());
            const target = ref.module ?? ref;
            if (seen.has(target)) return;
            seen.add(target);
            for (const child of [...(Reflect.getMetadata('imports', target) ?? []), ...(ref.imports ?? [])]) await visit(child);
        }
        visit(AppModule).then(() => process.stdout.write('ok')).catch(error => { console.error(error); process.exitCode = 1; });
    `;
    expect(
        execFileSync(
            process.execPath,
            [
                "-r",
                "ts-node/register/transpile-only",
                "-r",
                "tsconfig-paths/register",
                "-e",
                script,
            ],
            {
                cwd: resolve(__dirname, "../../.."),
                encoding: "utf8",
                timeout: 15000,
            },
        ),
    ).toBe("ok");
});
