## PC On Air

Controls [PC On Air](https://github.com/ReynoldsProductions/PConAir) — an Electron
live-event graphics and playout application — over the LAN.

The module connects over a WebSocket for instant, push-based state, and falls
back to HTTP polling if the socket is unavailable.

### Configuration

| Field | Default | Description |
|-------|---------|-------------|
| **Host** | `127.0.0.1` | IP address or hostname of the PC On Air machine |
| **Port** | `8080` | PC On Air server port (**Settings → Network**) |
| **Operator PIN** | _(empty)_ | Only needed for the HTTP fallback. Actions sent over the WebSocket do not use it. |
| **HTTP Polling Interval (ms)** | `1000` | Poll rate while the WebSocket is down |

### Before you connect

PC On Air gates cookie-less clients — including Companion — behind an **IP
allowlist**. Add the Companion machine's IP under **Admin → Security → Network**
on the PC On Air machine, or the connection will be refused at the WebSocket
upgrade.

Connections arriving through the Cloudflare tunnel are never granted the
cookie-less path. Companion must be on the same LAN.

### Status indicators

| Companion status | Meaning |
|---|---|
| **OK** | WebSocket connected — state is pushed in real time |
| **Unknown / degraded** | WebSocket is down; state is coming from HTTP polling and actions need the Operator PIN |
| **Connection failure** | PC On Air is unreachable, or this IP is not allowlisted |

### Variables in every input

Every text input in every action and feedback supports Companion variables.
Numeric fields are text inputs for exactly this reason — type a number *or* a
variable expression. Dropdowns accept custom values where it is useful, so a
variable can drive the mode, instance, or transition; an unrecognised value
falls back to the option's default.

### Packages

PC On Air "packages" (scoreboards, news tickers, and similar drop-in graphics)
declare their own Companion actions, feedbacks, and variables. The module polls
for them every 30 seconds and registers them automatically — dropping a new
package into PC On Air makes it controllable **without restarting Companion**.
Package variables are prefixed with the package id, e.g. `$(pconair:hoops_score_home)`.

### Google Slides Opener compatibility

Action and variable names from `companion-module-gslide-opener` are preserved
exactly, so existing button pages can be pointed at this module. A few GSC
actions have no PC On Air equivalent (Key/Fill, PerfectCue, presentation
presets). They are still present, and report an honest error when triggered
rather than silently doing nothing.

### Not exposed

Anything requiring an **admin** session is deliberately not available as an
action: tunnel start/stop, program background presets, show lock, app settings,
media upload/delete, URL preset management, and the director window. Their
*state* is still readable through variables and feedbacks.
