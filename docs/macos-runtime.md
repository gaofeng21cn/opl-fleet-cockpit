# macOS Gateway Runtime Reference

This page describes the LaunchAgent implementation in `ops/macos/`; it does
not claim a Mac is the current production owner. New Docker deployments use
[installation](installation.md); changing hosts uses [host migration](host-migration.md).

## Runtime and readback

`cn.gaofeng.ambient-ops.server` runs built assets from
`~/Library/Application Support/Ambient Ops/runtime/current`, outside Git.
`ops/macos/install-runtime.sh <release-id>` builds and stages a release,
switches the symlink, restarts the LaunchAgent and checks `/healthz`.
Run it only for the intended Mac owner: it changes the running service.

Prior releases are retained. Data stays in the application-support data
directory; credentials remain in Keychain. Plists contain service names, not secrets.

```bash
launchctl print gui/$(id -u)/cn.gaofeng.ambient-ops.server
readlink "$HOME/Library/Application Support/Ambient Ops/runtime/current"
curl -fsS http://127.0.0.1:8791/healthz
curl -fsS http://127.0.0.1:8791/api/status
```

8791 is the template port; use the effective port if changed. Verify configured
sources and unique machines separately from HTTP liveness.

## Recovery helpers

Keep `cn.gaofeng.opl-fleet-agent-headless` disabled while the desktop Agent
sends for the same machine. The `cn.gaofeng.ambient-ops.adb-kiosk` plist and
`adb-kiosk-watch.sh` are bounded USB recovery tools, unloaded in normal operation.
Android behavior and acceptance belong to the [kiosk guide](../android-kiosk/README.md).

Stop the Mac before another host starts discovery for the same instance:

```bash
launchctl bootout gui/$(id -u)/cn.gaofeng.ambient-ops.server
```

For authorized rollback, stop the replacement owner, restore the recorded plist
and runtime, then:

```bash
launchctl bootstrap gui/$(id -u) \
  "$HOME/Library/LaunchAgents/cn.gaofeng.ambient-ops.server.plist"
launchctl kickstart -k gui/$(id -u)/cn.gaofeng.ambient-ops.server
```

Repeat source and client acceptance. The old LaunchAgent is not a second
discovery authority or a permanent compatibility requirement.
