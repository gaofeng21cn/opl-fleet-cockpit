# macOS and HTC kiosk runtime

This is the currently accepted production runtime. The Synology migration keeps
it installed but unloaded as the rollback owner.

The permanent runtime has one required user LaunchAgent:

- `cn.gaofeng.ambient-ops.server` runs the built Ambient Ops server from
  `~/Library/Application Support/Ambient Ops/runtime`, not from a Git checkout.

Install a tested release and atomically switch the runtime:

```bash
./ops/macos/install-runtime.sh <release-id>
```

The installer preserves the previous release for rollback, switches
`runtime/current`, restarts the server LaunchAgent, and requires a successful
`/healthz` readback. Credentials remain in Keychain and normalized data remains
in the existing data directory.

OPL Fleet Agent now discovers Ambient Ops and pushes aggregate metrics from the
menu-bar application. The recovery-only `cn.gaofeng.opl-fleet-agent-headless`
LaunchAgent must remain disabled during normal operation to avoid
counting the same Mac twice.

Agent entries remain visible during the configured stale grace period. After
`STALE_AFTER_SECONDS` without a new snapshot, Ambient Ops removes the inactive
machine from both the dashboard and persisted state.

The server receives Keychain service names in its environment. Secret values
are not stored in plist files, logs, or the repository.

The HTC application is built from [`../android-kiosk`](../android-kiosk/README.md).
It is the default Home application, owns an immersive WebView, keeps the display
awake, discovers `_ambient-ops._tcp.local`, and retries after service or network
changes. Normal operation does not require USB or ADB reverse.

The `cn.gaofeng.ambient-ops.adb-kiosk` LaunchAgent and `adb-kiosk-watch.sh` are
recovery tools only. They must remain unloaded during normal operation so an
ADB reverse tunnel cannot hide a broken LAN discovery path.

To intentionally return the device to the HTC launcher:

```bash
adb shell cmd package set-home-activity com.htc.launcher/.Launcher
adb shell am start -n com.htc.launcher/.Launcher
```

For a bounded USB recovery session only:

```bash
launchctl bootstrap gui/$(id -u) \
  ~/Library/LaunchAgents/cn.gaofeng.ambient-ops.adb-kiosk.plist
```

## Runtime readback

```bash
launchctl print gui/$(id -u)/cn.gaofeng.ambient-ops.server
readlink "$HOME/Library/Application Support/Ambient Ops/runtime/current"
curl -fsS http://127.0.0.1:8791/healthz
curl -fsS http://127.0.0.1:8791/api/status
```

A successful HTTP response is not enough: require live network and Codex
states, the expected machine count, and `network.source=unifi-snmp-v3`.

When USB is intentionally attached for verification, normal LAN operation
should also show:

```bash
adb reverse --list
adb shell cmd package resolve-activity --brief \
  -a android.intent.action.MAIN -c android.intent.category.HOME
```

The reverse list must be empty and the resolved Home activity must be
`cn.gaofeng.ambientops.kiosk/.MainActivity`.

## Synology handoff and rollback

Stop the Mac owner only after a discovery-disabled NAS candidate has passed its
build, health, and live SNMP checks:

```bash
launchctl bootout gui/$(id -u)/cn.gaofeng.ambient-ops.server
```

Retain the LaunchAgent plist, Keychain entries, data directory, and runtime
releases. To roll back, stop the NAS container first, then restore the Mac:

```bash
launchctl bootstrap gui/$(id -u) \
  "$HOME/Library/LaunchAgents/cn.gaofeng.ambient-ops.server.plist"
launchctl kickstart -k gui/$(id -u)/cn.gaofeng.ambient-ops.server
```

Never publish Mac and NAS instances concurrently. Preserving the same
`INSTANCE_ID` lets the HTC kiosk recognize the restored logical installation.
