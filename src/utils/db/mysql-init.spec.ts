import { execFileSync } from "child_process";
import * as path from "path";

const script = path.resolve(
    __dirname,
    "../../../docker/mysql/init-databases.sh",
);
const credentials = {
    MYSQL_USER: "gamenode",
    MYSQL_ROOT_PASSWORD: "root",
    SUPERTOKENS_DB_USER: "supertokens",
    SUPERTOKENS_DB_PASS: "auth'with\\backslash$and`tick",
    CMS_DB_PASSWORD: "cms'; DROP DATABASE gamenode; --",
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
        expect(sql).toContain("IDENTIFIED BY 'auth''with\\backslash$and`tick'");
        expect(sql).toContain(
            "IDENTIFIED BY 'cms''; DROP DATABASE gamenode; --'",
        );
        expect(sql).toContain("GRANT ALL ON `blog\\_cms`.* TO 'blog_cms'@'%'");
    });

    it.each([
        { SUPERTOKENS_DB_USER: "root" },
        { SUPERTOKENS_DB_USER: "blog_cms" },
        { SUPERTOKENS_DB_USER: "gamenode" },
        { SUPERTOKENS_DB_USER: "auth'; DROP DATABASE gamenode; --" },
        { MYSQL_USER: "root" },
        { MYSQL_USER: "blog_cms" },
        { CMS_DB_PASSWORD: "" },
        { SUPERTOKENS_DB_PASS: "" },
        { MYSQL_ROOT_PASSWORD: "" },
    ])(
        "rejects missing credentials and overlapping or unsafe users: %o",
        (overrides) => {
            expect(() => render(overrides)).toThrow();
        },
    );
});
