import Imap from "imap";

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

/** Env-driven config. Returns null when IMAP is not configured. */
export function getImapConfig(): ImapConfig | null {
  const host = (process.env.IMAP_HOST ?? "").trim();
  const user = (process.env.IMAP_USER ?? "").trim();
  const pass = process.env.IMAP_PASSWORD ?? "";
  if (!host || !user || !pass) return null;
  const secure = (process.env.IMAP_SECURE ?? "true").toLowerCase() !== "false";
  const portRaw = (process.env.IMAP_PORT ?? "").trim();
  const port = portRaw ? Number.parseInt(portRaw, 10) : secure ? 993 : 143;
  if (!Number.isFinite(port) || port <= 0) return null;
  return { host, port, secure, user, pass };
}

export function redactImapError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const secrets = [
    process.env.IMAP_PASSWORD,
    process.env.SMTP_PASSWORD,
    process.env.CRON_SECRET,
  ];
  let out = raw;
  for (const s of secrets) {
    if (s && out.includes(s)) out = out.split(s).join("[redacted]");
  }
  return out.slice(0, 500);
}

/** Connect and wait for ready (or fail). Caller must call `imap.end()`. */
export function connectImap(cfg: ImapConfig, timeoutMs = 25000): Promise<Imap> {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      host: cfg.host,
      port: cfg.port,
      tls: cfg.secure,
      user: cfg.user,
      password: cfg.pass,
      connTimeout: timeoutMs,
      authTimeout: timeoutMs,
      tlsOptions: { servername: cfg.host },
    });
    const timer = setTimeout(() => {
      try {
        imap.destroy();
      } catch {
        /* noop */
      }
      reject(new Error("IMAP connection timed out."));
    }, timeoutMs + 5000);
    imap.once("ready", () => {
      clearTimeout(timer);
      resolve(imap);
    });
    imap.once("error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
    try {
      imap.connect();
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}

export function openInbox(imap: Imap, readOnly = true): Promise<{ uidvalidity: number }> {
  return new Promise((resolve, reject) => {
    imap.openBox("INBOX", readOnly, (err, box) => {
      if (err) reject(err);
      else resolve({ uidvalidity: box.uidvalidity });
    });
  });
}

export function closeImap(imap: Imap) {
  try {
    imap.end();
  } catch {
    /* noop */
  }
}

/** Safe connection check: connects, opens INBOX read-only, reports, closes. */
export async function testImapConnection(): Promise<{
  ok: boolean;
  messages?: number;
  uidvalidity?: number;
  error?: string;
}> {
  const cfg = getImapConfig();
  if (!cfg) {
    return {
      ok: false,
      error:
        "IMAP is not configured. Set IMAP_HOST, IMAP_USER and IMAP_PASSWORD (plus IMAP_PORT / IMAP_SECURE) in environment variables.",
    };
  }
  let imap: Imap | null = null;
  try {
    imap = await connectImap(cfg);
    const box = await new Promise<{ messages: { total: number }; uidvalidity: number }>(
      (resolve, reject) => {
        imap!.openBox("INBOX", true, (err, box) => {
          if (err) reject(err);
          else resolve(box);
        });
      }
    );
    return { ok: true, messages: box.messages.total, uidvalidity: box.uidvalidity };
  } catch (err) {
    return { ok: false, error: redactImapError(err) };
  } finally {
    if (imap) closeImap(imap);
  }
}
