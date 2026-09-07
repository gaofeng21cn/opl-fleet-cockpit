# Decision: A Focused Telemetry Service

The Gateway combines authenticated per-machine aggregate ingestion, freshness
and retirement, router counter collection, persistence and fixed display
surfaces. A single service gives browser and native clients one normalized
status contract without making a display framework the telemetry owner.

General dashboards such as [Glance](https://github.com/glanceapp/glance),
[Homepage](https://github.com/gethomepage/homepage),
[Homarr](https://github.com/homarr-labs/homarr),
[MagicMirror](https://github.com/MagicMirrorOrg/MagicMirror) and
[Smashing](https://github.com/Smashing/smashing) were considered as host platforms.
The retained reason for independent implementation is the ingestion and
lifecycle boundary, not a claim that these upstream products permanently lack a feature.

[Unpoller](https://github.com/unpoller/unpoller), Prometheus and Grafana suit
long-term observability. The implemented `GET /metrics` export in
`server/server.mjs` already permits Prometheus consumption.
[Home Assistant](home-assistant.md) is an optional downstream integration.

Revisit this decision when a candidate can own the same authentication,
normalization, freshness, persistence and display contracts with lower
operational cost. Evaluate its then-current API and license rather than the
original comparison. No source code from these evaluated projects was copied
into this repository; [LICENSE](../LICENSE) and the
[previous project license](../LICENSES/PREVIOUS-PROJECT-LICENSE.txt) retain legal provenance.
