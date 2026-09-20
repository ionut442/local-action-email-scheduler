# Cloudflare Worker: cron trigger for the LocalAction Email Scheduler.
# Free-tier friendly. Deploy with:
#   cd cloudflare-cron
#   wrangler login            # one-time browser approval
#   wrangler secret put CRON_SECRET   # paste the CRON_SECRET from Vercel env vars
#   wrangler deploy
# Verify: open https://<worker>.workers.dev/?secret=YOUR_CRON_SECRET
# Expected while sending is OFF: {"ok":true,"status":200,"body":"{\"ran\":false,\"reason\":\"sending_disabled\"...}"}
