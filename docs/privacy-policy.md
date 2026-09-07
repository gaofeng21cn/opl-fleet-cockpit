# OPL Fleet Cockpit Privacy Policy

Last updated: September 7, 2026

OPL Fleet Cockpit is a self-hosted operational display. The iOS and iPadOS app
does not require an OPL cloud account and does not send analytics,
advertising identifiers, conversation content, or usage data to the developer.

## Data the app reads

When the user connects a self-hosted OPL Fleet Telemetry Gateway or a Direct
OPL Fleet Agent source, the app reads aggregate
operational status over the local network. This may include:

- server and machine display names;
- aggregate tokens per second and active-session counts;
- optional CPU and memory percentages;
- network throughput, latency, client count, and short history; and
- optional Codex Pet state and artwork.

Prompts, responses, session identifiers, tool content, repository paths, files,
Codex credentials, and router credentials are not part of the status contract.

## Storage

The app stores the chosen server address, display preference, and latest aggregate
status on the device. The latest status is shared only with the app's Widget and
Live Activity extension through its private App Group container.

## Network access

Bonjour local-network access is used only after the user chooses discovery. Demo
Mode does not request local-network access. The current release does not use a
developer-operated push relay.

## Tracking and third parties

The app does not track users, show advertising, use third-party analytics, or sell
personal information. The developer does not receive data read from a user's
self-hosted server.

Apple may process App Store distribution and diagnostics according to Apple's own
terms and the user's device settings.

## Deletion

Deleting the app removes its local settings and cached aggregate status. Data on a
self-hosted OPL Fleet Telemetry Gateway remains under the server operator's control.

## Contact

Privacy and support requests can be filed through the public OPL Fleet Cockpit repository:
https://github.com/gaofeng21cn/opl-fleet-cockpit/issues
