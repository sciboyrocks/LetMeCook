# Remote desktop performance

Sessions use noVNC in the browser, a binary WebSocket to the API, and a TCP
connection from the API to the VNC host. Both network legs and the host's screen
encoding affect latency; endpoint internet speed alone does not measure this path.

Each connection stores a starting performance mode (default **Fast**, including
connections saved before the setting existed). Changing the mode in the session
toolbar applies immediately and is saved as that connection's starting mode.

| Mode | JPEG quality | Compression | Maximum viewport in Fit Screen |
| --- | --- | --- | --- |
| Fast | 1 | 6 | 1280 × 800 |
| Balanced | 5 | 4 | 1920 × 1080 |
| Crisp | 8 | 2 | Available window |
| Custom | Saved setting | Saved setting | Available window |

JPEG quality only applies when the host encodes with Tight/JPEG; hosts that only
use lossless encodings such as ZRLE ignore it. Higher compression sends fewer
bytes for text and flat areas at the cost of host CPU.

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
fresh ticket after 0.5, 1, 2, 4 and 8 seconds, keeping the current mode, and
stops after five failed attempts or an authentication failure. noVNC reports a
server-side close as clean, so every disconnect the user did not request counts.

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
final error delivery, a simulated slow WebSocket draining a 4 MiB update
while pointer input continues in the opposite direction, and the idle heartbeat.

For live validation after rebuilding/restarting the API and web services:

1. Connect an existing saved connection and confirm Fast is selected. Switch to
   Balanced, reconnect, and confirm Balanced is kept.
2. Type, drag windows, and scroll while comparing Fast, Balanced, and Crisp.
3. Verify the remote resolution changes on a host that accepts resizing; verify
   a host without support still displays correctly.
4. Switch to Custom to verify saved settings, then toggle Fit Screen/1:1 and
   fullscreen to check pointer positioning.
5. Reconnect rapidly or disconnect while a ticket is loading; only the latest
   connection attempt should remain active.
6. Restart the host's screen sharing during a session; the viewer should show
   "Reconnecting" and resume without user action.

The socket tests simulate relay congestion. They do not measure end-to-end
latency, browser rendering performance, or a particular remote host's encoder.
