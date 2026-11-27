import "dotenv/config";
import http from "node:http";
import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { serializeSignedCookie } from "/home/cassi/.local/share/pnpm/store/v10/links/@/better-auth/1.7.14/33ea5daed1be3fc72d5c2f892bfdcb3f7641201df83ee07dd60190035c055a81/node_modules/better-call/dist/index.mjs";
import mysql from "mysql2/promise";

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_DATABASE,
  timezone: "Z",
});
// Same secret, database and id format as the API, so it accepts the session this creates.
const auth = betterAuth({
  baseURL: process.env.DOMAIN_API,
  basePath: "/v1/auth",
  secret: process.env.BETTER_AUTH_SECRET,
  database: pool,
  advanced: { database: { generateId: "uuid" } },
  plugins: [admin()],
});
const REDIRECTS = {
  editor: "http://localhost:3001/dashboard/achievement/definitions",
  mod: "http://localhost:3001/dashboard/achievement/definitions",
  admin: "http://localhost:3001/dashboard/home",
  player: "http://localhost:3002/preferences",
  web: "http://localhost:3000/wrapped",
};

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      const who = url.pathname.slice(1);
      if (!(who in REDIRECTS)) return res.writeHead(404).end();
      const ctx = await auth.$context;
      const email = `browser-${who}@example.invalid`;
      const user =
        (await ctx.internalAdapter.findUserByEmail(email))?.user ??
        (await ctx.internalAdapter.createUser({
          email,
          name: `browser-${who}`,
          emailVerified: true,
          role: who === "player" || who === "web" ? "user" : `user,${who}`,
        }));
      await pool.execute(
        "INSERT IGNORE INTO profile (userId, username) VALUES (?, ?)",
        [user.id, `browser-${who}`],
      );
      // `/web?to=/profile` overrides the landing page (web app only).
      const to = url.searchParams.get("to");
      const location =
        who === "web" && to?.startsWith("/") && !to.startsWith("//")
          ? `http://localhost:3000${to}`
          : REDIRECTS[who];
      await pool.execute("INSERT IGNORE INTO library (userId) VALUES (?)", [
        user.id,
      ]);
      const session = await ctx.internalAdapter.createSession(user.id);
      const cookie = await serializeSignedCookie(
        "better-auth.session_token",
        session.token,
        ctx.secret,
        { path: "/", httpOnly: true, sameSite: "lax" },
      );
      res.writeHead(302, { "Set-Cookie": cookie, Location: location });
      res.end();
    } catch (e) {
      console.error(e);
      res.writeHead(500).end("Local login failed");
    }
  })
  .listen(5011, "127.0.0.1", () => console.log("Local test login ready"));
