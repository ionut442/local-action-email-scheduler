/**
 * Pings the LocalAction Email Scheduler cron endpoint every 15 minutes.
 * The endpoint itself enforces the daily limit + send spacing, so this
 * worker is a dumb trigger. CRON_SECRET is stored as a Worker secret
 * (never in this repo): `wrangler secret put CRON_SECRET`.
 */

async function triggerSend(env) {
  const url = `${env.APP_URL.replace(/\/+$/, "")}/api/cron/send?secret=${encodeURIComponent(env.CRON_SECRET)}`;
  const started = Date.now();
  try {
    const res = await fetch(url, { method: "GET" });
    const body = await res.text();
    const summary = `cron ping -> ${res.status} (${Date.now() - started}ms): ${body.slice(0, 300)}`;
    console.log(summary);
    return { ok: res.ok, status: res.status, body: body.slice(0, 500) };
  } catch (err) {
    const summary = `cron ping failed: ${err instanceof Error ? err.message : err}`;
    console.log(summary);
    return { ok: false, error: summary };
  }
}

export default {
  // Runs on the [triggers.crons] schedule from wrangler.toml.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(triggerSend(env));
  },
  // GET / -> liveness check. GET /?secret=CRON_SECRET -> manual trigger
  // (same secret as the cron endpoint; lets us verify end-to-end on demand).
  async fetch(request, env) {
    const url = new URL(request.url);
    if (
      env.CRON_SECRET &&
      url.searchParams.get("secret") === env.CRON_SECRET
    ) {
      const result = await triggerSend(env);
      return Response.json(result);
    }
    return new Response("local-action cron pinger alive", { status: 200 });
  },
};
