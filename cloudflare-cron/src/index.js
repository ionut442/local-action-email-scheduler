/**
 * Pings the LocalAction Email Scheduler endpoints every 15 minutes:
 * - /api/cron/send: due outbound emails (daily limit + spacing enforced there)
 * - /api/cron/replies: inbound reply sync (cursor-based, imports only new mail)
 * The app endpoints enforce all limits, so this worker stays a dumb trigger.
 * CRON_SECRET is stored as a Worker secret (never in this repo):
 * `wrangler secret put CRON_SECRET`.
 */

async function ping(env, path) {
  const url = `${env.APP_URL.replace(/\/+$/, "")}${path}?secret=${encodeURIComponent(env.CRON_SECRET)}`;
  const started = Date.now();
  try {
    const res = await fetch(url, { method: "GET" });
    const body = await res.text();
    const summary = `cron ${path} -> ${res.status} (${Date.now() - started}ms): ${body.slice(0, 300)}`;
    console.log(summary);
    return { ok: res.ok, status: res.status, body: body.slice(0, 500) };
  } catch (err) {
    const summary = `cron ${path} failed: ${err instanceof Error ? err.message : err}`;
    console.log(summary);
    return { ok: false, error: summary };
  }
}

async function triggerAll(env) {
  const send = await ping(env, "/api/cron/send");
  const replies = await ping(env, "/api/cron/replies");
  return { send, replies };
}

export default {
  // Runs on the [triggers.crons] schedule from wrangler.toml.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(triggerAll(env));
  },
  // GET / -> liveness check. GET /?secret=CRON_SECRET -> manual trigger
  // (same secret as the cron endpoints; lets us verify end-to-end on demand).
  async fetch(request, env) {
    const url = new URL(request.url);
    if (
      env.CRON_SECRET &&
      url.searchParams.get("secret") === env.CRON_SECRET
    ) {
      const result = await triggerAll(env);
      return Response.json(result);
    }
    return new Response("local-action cron pinger alive", { status: 200 });
  },
};
