# Phone access to the local Todero instance (Tailscale)

Set up 2026-09-01. Private access only: the URLs below resolve solely on Michael's
Tailscale tailnet (`tailfb1687.ts.net`). Nothing is exposed to the public internet
and `nabit.work` is not involved (its DNS stays on Namecheap for Resend).

## URLs (phone must be signed in to Tailscale)

| App | URL on the phone | Local origin |
|---|---|---|
| Mission Control (`local/`) | `http://g14-mich` or `http://g14-mich.tailfb1687.ts.net` | `127.0.0.1:3100` |
| Vite HMR websocket for the above | port `13100`, proxied automatically | `127.0.0.1:13100` |
| Landing site (repo root, `next dev`) | `http://g14-mich:8080` | `127.0.0.1:3000` |

The landing proxy deliberately listens on 8080, not 3000: `tailscale serve` binds the
tailnet IP on the chosen port, and a wildcard `next dev` bind on the same port would
fail on Windows.

## How it works

1. `tailscale serve` (config persisted by tailscaled, survives reboots):
   `--http=80 3100`, `--http=13100 13100`, `--http=8080 3000`. Inspect with
   `tailscale serve status`; remove one with `tailscale serve --http=<port> off`.
2. Mission Control stays in `local_trusted` mode bound to loopback. tailscaled connects
   from loopback, so every tailnet peer is treated as the local board admin. The tailnet
   is the access control: only devices signed in as Michael can reach the hostname.
3. The instance's private hostname guard rejects unknown `Host` / `X-Forwarded-Host`
   values with 403. The tailnet names are allow-listed in
   `~/.todero/instances/default/allowedHostnames` (config.json): `g14-mich`,
   `g14-mich.tailfb1687.ts.net`, `100.96.224.63`. Adding a name requires a server restart.
   The `pnpm todero allowed-hostname` CLI fails with `EPERM fsync` on this machine; edit
   config.json directly.
4. Auto-start: `~/.todero/phone-access/start-todero-dev.ps1` runs `pnpm dev` (idempotent,
   the dev-runner adopts a running instance). Register it as a logon task with
   `~/.todero/phone-access/register-task.ps1`. Log: `~/.todero/phone-access/dev.log`.

## Constraints

- PC must be on, awake, and signed in to Tailscale. Sleep kills access.
- The Tailscale desktop app (`tailscale-ipn.exe`, tray icon) must be running. Without it the
  Windows backend drops to `NoState` ("Tailscale is starting") and the node goes offline even
  though the service is up. A Startup-folder shortcut launches it at logon; if the tray icon is
  missing, start it from the Start menu.
- Access by raw IP (`http://100.96.224.63`) returns 404 from tailscaled; serve routes by
  hostname, so use the MagicDNS name.
- Plain HTTP inside WireGuard. Switch to `--https=443` only after enabling HTTPS
  certificates in the Tailscale admin console (`MagicDNS` + `HTTPS Certificates`).
- Android does not apply MagicDNS search domains: `http://g14-mich` fails with NXDOMAIN on
  the phone. Use the full name `http://g14-mich.tailfb1687.ts.net`.
- Upstream PAP-18043 reproduced on 2026-09-01: with Vite's dev middleware the phone pulled
  ~90 MB of unbundled modules and Chrome gave ERR_TIMED_OUT. The launcher therefore sets
  `PAPERCLIP_UI_DEV_MIDDLEWARE=false` and the server serves `local/ui/dist`. After UI
  changes, rebuild with `pnpm --filter @todero/ui build` (about 5 s); the server picks the
  new bundle up without a restart. For desktop HMR work, flip the variable to `true` in
  `start-todero-dev.ps1`, restart, and flip it back before leaving the desk.
