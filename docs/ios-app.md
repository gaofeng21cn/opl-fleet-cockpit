# OPL Fleet Cockpit for iOS

OPL Fleet Cockpit for iOS is a native companion for the self-hosted OPL Fleet
Telemetry Gateway.
It reads the versioned `/api/v1/status` endpoint and does not embed the browser
dashboard.

## Product surfaces

- Home summarizes the most important Codex, host, and network state.
- Machines orders unavailable and constrained hosts before normal activity.
- Display provides native Overview, Network, Load, and Pet presentations.
- The Load foreground animation is rendered with SpriteKit from the server-owned
  `loadVisualState`; its work packets are an aggregate metaphor, not individual
  conversations.
- Widgets, Live Activities, Dynamic Island, and StandBy use a lightweight
  representation of the same focused-host state.
- User-facing navigation, settings, connection, permission, empty-state, Widget,
  and Live Activity text supports English and Simplified Chinese. English is the
  development and fallback language; the app otherwise follows the system language.

## Demo Mode

Demo Mode is enabled on first launch and requires no server, account, or network
permission. It includes deterministic coverage for:

- quiet, active, heavy, and constrained load;
- live and stale machines;
- known and unavailable CPU telemetry;
- a configured pet and an unconfigured-pet state; and
- network throughput history.

This is also the complete App Review path. Reviewers can inspect all core user
interfaces before connecting a local server.

## Connecting a server

1. Open Settings.
2. Enter a server URL and choose Connect, or choose Find on Local Network.
3. The app explains why local-network access is needed before Bonjour discovery
   triggers the system permission dialog.

Turning Demo Mode off follows the same path: it clears demo metrics immediately,
reuses a saved server address when available, or offers local-network discovery
when no server has been configured.

Discovery uses `_ambient-ops._tcp` for Gateway mode and `_opl-fleet-agent._tcp`
for Direct mode. A remembered source wins, then a Gateway, then one unique
Direct source; multiple Direct sources require selection. Both expose
`/api/v1/status` schema 1. Gateway, Agent and router credentials remain outside the app.

## Live Activity boundary

The user explicitly starts and ends a Live Activity from Settings. While the app
can refresh, it updates the current activity locally. Background near-real-time
updates would require an APNs relay. No relay is implemented; the server
advertises `liveActivityPush: false`.

## Build

The Xcode project is generated with XcodeGen:

```bash
cd ios-app
xcodegen generate
open OPLFleetCockpit.xcodeproj
```

The app and widget use:

- App bundle ID: `cn.gaofeng.oplfleetcockpit`
- Widget bundle ID: `cn.gaofeng.oplfleetcockpit.widgets`
- App Group: `group.cn.gaofeng.oplfleetcockpit`
- URL scheme: `oplfleetcockpit`
- Team: `SVVC4TA784`
- Minimum iOS version: iOS 18

Debug uses automatic signing. Release archives use manual Apple Distribution
signing and the provisioning profiles defined in `project.yml`; both targets
must resolve their App ID and App Group for the selected team. Store copy and
review notes belong to [App Store submission](app-store-submission.md).
