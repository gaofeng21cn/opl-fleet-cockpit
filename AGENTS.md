# OPL Fleet Cockpit Contribution Contract

- Every new display page must be designed and verified first for the deployed HTC 5G Hub kiosk: 1280x720 physical pixels, landscape, 640x360 CSS viewport, and Android Kiosk with system animations disabled.
- A display page must remain a single non-scrolling screen on that target. Verify no clipped, overlapping, or hidden primary content with an ADB screenshot before delivery.
- Motion that communicates live state on the kiosk must not rely only on CSS animations. Use a deterministic time-driven path that still works when `prefers-reduced-motion` is reported because Android animation scales are disabled.

Documentation ownership and lifecycle are defined in [docs/README.md](docs/README.md).
Update the owning topic and its language pair with behavior changes; keep execution
history in Git, CI or the release system. Validate links and assets after retiring
or moving a document. Do not infer semantic correctness from prose snapshots.
