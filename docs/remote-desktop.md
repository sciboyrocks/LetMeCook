# Remote desktop performance

Sessions use noVNC in the browser, a binary WebSocket to the API, and a TCP
connection from the API to the VNC host. Both network legs and the host's screen
encoding affect latency; endpoint internet speed alone does not measure this path.

Every connection starts in **Fast**, including previously saved connections.

| Mode | JPEG quality | Compression | Maximum viewport in Fit Screen |
| --- | --- | --- | --- |
| Fast | 2 | 1 | 1280 × 800 |
| Balanced | 5 | 2 | 1920 × 1080 |
| Crisp | 8 | 2 | Available window |
| Custom | Saved setting | Saved setting | Available window |

Fit Screen requests a remote resize to the viewer dimensions. This only reduces
transferred pixels if the host supports and accepts remote resizing. View-only
sessions do not request a resize. 1:1 Scale disables the viewport limits and remote
resize requests; it does not restore an earlier host resolution. On hosts that
ignore resizing (including some macOS Screen Sharing configurations), lower the
host display resolution to reduce the number of pixels being captured and sent.
JPEG quality and compression settings also depend on the server's selected
encoding. See the [noVNC API](https://novnc.com/noVNC/docs/API.html).

The relay batches bytes within one event-loop turn, up to a 64 KiB batch target.
It pauses upstream reads at 256 KiB of outstanding sends and resumes at 64 KiB,
using send completion callbacks rather than polling. A TCP chunk may cross the
threshold. These are application queue thresholds, not bounds on the host,
operating system, intervening proxies, or browser queues. WebSocket compression
stays disabled because VNC handles encoding/compression itself. TCP_NODELAY is
set on both API sockets. RFB bytes are never dropped or reordered.

## Validation

Run `pnpm --filter @letmecook/api test:remote-desktop` for real-socket tests of
fragmented RFB handshakes, Mac authentication selection, RFB 3.3 compatibility,
final error delivery, and a simulated slow WebSocket draining a 4 MiB update
while pointer input continues in the opposite direction.

For live validation after rebuilding/restarting the API and web services:

1. Connect an existing saved connection and confirm Fast is selected.
2. Type, drag windows, and scroll while comparing Fast, Balanced, and Crisp.
3. Verify the remote resolution changes on a host that accepts resizing; verify
   a host without support still displays correctly.
4. Switch to Custom to verify saved settings, then toggle Fit Screen/1:1 and
   fullscreen to check pointer positioning.
5. Reconnect rapidly or disconnect while a ticket is loading; only the latest
   connection attempt should remain active.

The socket tests simulate relay congestion. They do not measure end-to-end
latency, browser rendering performance, or a particular remote host's encoder.
