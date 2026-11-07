import "dotenv/config";
import Stripe from "stripe";
import mysql from "mysql2/promise";

const email = process.argv[2] ?? "browser-player@example.invalid";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_DATABASE,
  timezone: "Z",
});

const [users] = await pool.query(
  "SELECT id, stripeCustomerId FROM user WHERE email = ?",
  [email],
);
const user = users[0];
if (!user) throw new Error(`No user ${email}`);

let customerId = user.stripeCustomerId;
if (!customerId) {
  const customers = await stripe.customers.list({ email, limit: 1 });
  customerId = customers.data[0]?.id;
}
if (!customerId) throw new Error("No Stripe customer for user");

let sub =
  (
    await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 1,
    })
  ).data[0] ?? null;
if (!sub) throw new Error("No Stripe subscription for customer");

const item = sub.items.data[0];
const periodStart = item?.current_period_start
  ? new Date(item.current_period_start * 1000)
  : null;
const periodEnd = item?.current_period_end
  ? new Date(item.current_period_end * 1000)
  : null;
const interval = item?.price?.recurring?.interval === "year" ? "year" : "month";
const plan = "supporter";

await pool.execute(
  `INSERT INTO subscription
     (id, plan, referenceId, stripeCustomerId, stripeSubscriptionId, status,
      periodStart, periodEnd, cancelAt, canceledAt, endedAt,
      cancelAtPeriodEnd, seats, billingInterval, createdAt, updatedAt)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))
   ON DUPLICATE KEY UPDATE
     status = VALUES(status),
     periodStart = VALUES(periodStart),
     periodEnd = VALUES(periodEnd),
     cancelAt = VALUES(cancelAt),
     canceledAt = VALUES(canceledAt),
     endedAt = VALUES(endedAt),
     cancelAtPeriodEnd = VALUES(cancelAtPeriodEnd),
     billingInterval = VALUES(billingInterval),
     updatedAt = NOW(3)`,
  [
    `sync-${sub.id}`.slice(0, 36),
    plan,
    user.id,
    customerId,
    sub.id,
    sub.status,
    periodStart,
    periodEnd,
    sub.cancel_at ? new Date(sub.cancel_at * 1000) : null,
    sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
    sub.ended_at ? new Date(sub.ended_at * 1000) : null,
    sub.cancel_at_period_end ? 1 : 0,
    null,
    interval,
  ],
);

await pool.execute("UPDATE user SET stripeCustomerId = ? WHERE id = ?", [
  customerId,
  user.id,
]);

console.log(
  JSON.stringify(
    {
      user: user.id,
      customerId,
      subscriptionId: sub.id,
      status: sub.status,
      interval,
      periodEnd: periodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    },
    null,
    2,
  ),
);
await pool.end();
