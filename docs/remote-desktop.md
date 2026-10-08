# Remote desktop performance

Sessions use noVNC in the browser, a binary WebSocket to the API, and a TCP
connection from the API to the VNC host. Both network legs and the host's screen
encoding affect latency; endpoint internet speed alone does not measure this path.

Every session uses one low-latency stream profile; there are no quality modes.

| Setting | Value | Why |
| --- | --- | --- |
| JPEG quality | 1 | Small updates; text and flat areas stay lossless under Tight |
| Compression | 2 | Low host encode time per frame, the standard zlib balance |
| Maximum desktop in Fit Screen | 1280 × 800 | Fewer pixels to capture, encode and send |

JPEG quality only applies when the host encodes with Tight/JPEG; hosts that only
use lossless encodings such as ZRLE ignore it. The connection table still has
the old `quality`, `compression` and `performance_mode` columns; the API no
longer reads or writes them.

On large screens the session panel fills the area beside the sidebar, so the
desktop is sized from the window rather than the page column. The viewer bundle
is loaded when the page opens and fetched alongside the connection ticket, and
the relay opens the host connection before its database bookkeeping.

Fit Screen requests a remote resize to the viewer dimensions. The viewport limit
only reduces transferred pixels when the host accepts remote resizing. About two
seconds after connecting, the viewer checks whether the host kept a framebuffer
larger than the viewer; if so (including some macOS Screen Sharing
configurations), the limit is removed for that session so the picture fills the
window instead of being shrunk for no bandwidth gain. On those hosts, lower the
host display resolution to reduce the number of pixels being captured and sent.
View-only and 1:1 Scale sessions do not request a resize or apply the limit. See
the [noVNC API](https://novnc.com/noVNC/docs/API.html).

If a session drops without the user disconnecting, the viewer reconnects with a
fresh ticket after 0.5, 1, 2, 4 and 8 seconds, and
stops after five failed attempts or an authentication failure. noVNC reports a
server-side close as clean, so every disconnect the user did not request counts.
Reconnects keep the session's view-only and scale toggles and reuse a password
typed into the prompt; leaving the session forgets it. After a rejected password
the host's reason is shown and the next attempt opens a new connection.

WebSocket access requires a ticket from
`POST /api/remote-desktop/connections/:id/token`. Tickets expire after 60 seconds
and are single use; a session cookie alone is never accepted.

The relay batches bytes within one event-loop turn, up to a 64 KiB batch target.
It pauses upstream reads at 256 KiB of outstanding sends and resumes at 64 KiB,
using send completion callbacks rather than polling. A TCP chunk may cross the
threshold. These are application queue thresholds, not bounds on the host,
operating system, intervening proxies, or browser queues. WebSocket compression
stays disabled because VNC handles encoding/compression itself. TCP_NODELAY is
set on both API sockets. RFB bytes are never dropped or reordered. The relay pings
the browser every 15 seconds so idle sessions survive proxy idle timeouts, and
closes the host connection after three intervals without a pong or any input.

## Validation

Run `pnpm --filter @letmecook/api test:remote-desktop` for real-socket tests of
fragmented RFB handshakes, Mac authentication selection, RFB 3.3 compatibility,
single-use ticket authentication,
final error delivery, a simulated slow WebSocket draining a 4 MiB update
while pointer input continues in the opposite direction, and the idle heartbeat.

For live validation after rebuilding/restarting the API and web services:

1. Connect an existing saved connection; the toolbar has no quality modes.
2. Type, drag windows, and scroll to judge responsiveness.
3. Verify the remote resolution changes on a host that accepts resizing; verify
   a host without support still displays correctly.
4. Toggle Fit Screen/1:1 and fullscreen to check pointer positioning.
5. Reconnect rapidly or disconnect while a ticket is loading; only the latest
   connection attempt should remain active.
6. Restart the host's screen sharing during a session; the viewer should show
   "Reconnecting" and resume without user action.

The socket tests simulate relay congestion. They do not measure end-to-end
latency, browser rendering performance, or a particular remote host's encoder.
