# App Store Submission Metadata

This page owns editable submission copy and review guidance for the native
client. It is not a live App Store Connect status report. Before submission,
read the current app record, build and release setting from App Store Connect.

## Submission Identity

- App name: `OPL Cockpit`
- App Store Connect ID: `6797375745`
- Bundle IDs, App Group, versions and signing profiles: `ios-app/project.yml`
- SKU: `opl-fleet-cockpit-ios-2026`
- Primary category: `Utilities`
- Secondary category: `Developer Tools`
- Age rating: `4+`
- Copyright: `2026 Feng Gao`

## Store text

Subtitle:

> Your self-hosted fleet display

Promotional text:

> See aggregate Codex activity, host pressure, network throughput, and your Codex
> Pet across iPhone, Widgets, Live Activities, Dynamic Island, and StandBy.

Description:

> OPL Fleet Cockpit is the native iPhone and iPad companion for your self-hosted
> OPL Fleet Telemetry Gateway.
>
> See the operational state that matters at a glance:
>
> • Focused-host Codex load expressed as a live pixel work field
> • Aggregate tokens per second and active sessions
> • Optional host CPU and memory pressure
> • Network download, upload, latency, clients, and recent trends
> • Machine freshness and Codex Pet state
> • Lock Screen Widgets, Live Activities, Dynamic Island, and StandBy
>
> The built-in Demo Mode is fully functional and needs no account or server.
> When you connect your own gateway, OPL Fleet Cockpit discovers it on your local
> network or uses the address you enter.
>
> Privacy is part of the architecture. Prompts, responses, session identifiers,
> tool content, repository paths, and credentials are not part of the status
> contract. The app does not use advertising or third-party analytics.
>
> OPL Fleet Cockpit is designed for trusted local networks. Access outside the local network
> requires HTTPS with access control configured by the server operator.

Keywords:

`Codex,developer,monitor,self-hosted,server,network,widget,live activity,operations`

## Public URLs

- Support URL: `https://github.com/gaofeng21cn/opl-fleet-cockpit/blob/main/docs/ios-support.md`
- Privacy policy URL: `https://github.com/gaofeng21cn/opl-fleet-cockpit/blob/main/docs/privacy-policy.md`
- Marketing URL: `https://github.com/gaofeng21cn/opl-fleet-cockpit`

Verify these public URLs resolve from the submitted app record. Local files
and a successful build do not prove public availability.

## App Review notes

> OPL Fleet Cockpit opens in a complete Demo Mode. No account, server,
> credentials, or local-network permission is needed for review.
>
> Review path:
>
> 1. Home shows live aggregate Codex and network status.
> 2. Machines contains quiet, active, heavy, constrained, and stale examples.
> 3. Display contains Overview, Network, Load, and Pet. Load uses a native SpriteKit
>    animation; it is not a web view.
> 4. Settings can start a local Live Activity for the focused demo host.
>
> Local-network discovery is optional and is invoked only when the reviewer chooses
> Find on Local Network. No OPL-operated cloud service is required.

## Privacy labels

The [privacy policy](privacy-policy.md) owns the data-processing promise.
The corresponding submission answer is `Data Not Collected`, provided the
submitted build still follows that policy.

The app has no developer-operated analytics, advertising, account, or relay in this
release. It reads operational data from a server selected and controlled by the user,
stores the latest aggregate snapshot locally, and shares it only with its bundled
Widget/Live Activity extension.

Reassess this answer before enabling any future APNs relay, analytics, crash upload,
or developer-operated service.

The app uses Bonjour discovery and URLSession to read aggregate status. It does
not provide a VPN, tunnel provider or NetworkExtension. Review builds open in
Demo Mode and need no server or account. Verify the selected build, screenshots,
privacy answers and release mode in App Store Connect for each submission;
keep upload receipts and review correspondence there rather than appending them here.
