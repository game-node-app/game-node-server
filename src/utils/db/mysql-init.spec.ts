import { execFileSync } from "child_process";
import * as path from "path";

const script = path.resolve(
    __dirname,
    "../../../docker/mysql/init-databases.sh",
);
const credentials = {
    MYSQL_USER: "gamenode",
    MYSQL_ROOT_PASSWORD: "root",
    CMS_DB_PASSWORD: "cms'with\\backslash$and`tick'; DROP DATABASE gamenode; --",
};

function render(overrides = {}) {
    return execFileSync(
        "bash",
        [
            "-c",
            'docker_process_sql() { cat; }; . "$1"',
            "mysql-init-test",
            script,
        ],
        {
            env: { PATH: process.env.PATH, ...credentials, ...overrides },
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
        },
    );
}

describe("managed MySQL provisioning", () => {
    it("quotes passwords without shell evaluation and restricts CMS grants to its exact database", () => {
        const sql = render();
        expect(sql).toContain("SET SESSION sql_mode = 'NO_BACKSLASH_ESCAPES'");
        expect(sql).toContain(
            "IDENTIFIED BY 'cms''with\\backslash$and`tick''; DROP DATABASE gamenode; --'",
        );
        expect(sql).toContain("GRANT ALL ON `blog\\_cms`.* TO 'blog_cms'@'%'");
    });

    it.each([
        { MYSQL_USER: "root" },
        { MYSQL_USER: "blog_cms" },
        { MYSQL_USER: "gamenode'; DROP DATABASE gamenode; --" },
        { CMS_DB_PASSWORD: "" },
        { MYSQL_ROOT_PASSWORD: "" },
    ])(
        "rejects missing credentials and unsafe users: %o",
        (overrides) => {
            expect(() => render(overrides)).toThrow();
        },
    );
});
