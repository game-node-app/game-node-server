import { betterAuth } from "better-auth";

it("loads Better Auth through Jest", async () => {
    const auth = betterAuth({ baseURL: "http://localhost:3000", secret: "test-secret-that-is-at-least-32-characters" });
    const response = await auth.handler(new Request("http://localhost:3000/api/auth/get-session"));
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
});
