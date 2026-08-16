@preconcurrency import Foundation

enum DiscoveredServerKind: String, Hashable, Sendable {
    case gateway
    case fleetAgent

    var providerLabel: String {
        switch self {
        case .gateway: "FLEET"
        case .fleetAgent: "DIRECT"
        }
    }
}

struct DiscoveredServer: Identifiable, Hashable, Sendable {
    let id: String
    let instanceID: String
    let name: String
    let url: URL
    let version: String?
    let kind: DiscoveredServerKind
}

enum SourceSelectionPolicy {
    static func automaticSource(
        from servers: [DiscoveredServer],
        preferredID: String?
    ) -> DiscoveredServer? {
        if let preferredID,
           let preferred = servers.first(where: { $0.id == preferredID }) {
            return preferred
        }
        if let gateway = servers
            .filter({ $0.kind == .gateway })
            .sorted(by: { $0.name.localizedStandardCompare($1.name) == .orderedAscending })
            .first {
            return gateway
        }
        let direct = servers.filter { $0.kind == .fleetAgent }
        return direct.count == 1 ? direct.first : nil
    }
}

@MainActor
final class DiscoveryService: NSObject,
    @preconcurrency NetServiceBrowserDelegate,
    @preconcurrency NetServiceDelegate {
    var onChange: (([DiscoveredServer]) -> Void)?
    var onError: ((String) -> Void)?

    private let gatewayBrowser = NetServiceBrowser()
    private let directBrowser = NetServiceBrowser()
    private var resolving: [NetService] = []
    private var servers: [String: DiscoveredServer] = [:]
    private var serviceKinds: [ObjectIdentifier: DiscoveredServerKind] = [:]
    private var resolvedServerIDs: [ObjectIdentifier: String] = [:]
    private var running = false

    override init() {
        super.init()
        gatewayBrowser.delegate = self
        directBrowser.delegate = self
    }

    func start() {
        guard !running else { return }
        running = true
        servers.removeAll()
        onChange?([])
        // The deployed Gateway still advertises this compatibility service type.
        gatewayBrowser.searchForServices(ofType: "_ambient-ops._tcp.", inDomain: "local.")
        directBrowser.searchForServices(ofType: "_opl-fleet-agent._tcp.", inDomain: "local.")
    }

    func stop() {
        running = false
        gatewayBrowser.stop()
        directBrowser.stop()
        resolving.forEach { $0.stop() }
        resolving.removeAll()
        serviceKinds.removeAll()
        resolvedServerIDs.removeAll()
    }

    func netServiceBrowser(
        _ browser: NetServiceBrowser,
        didFind service: NetService,
        moreComing: Bool
    ) {
        let kind: DiscoveredServerKind = browser === directBrowser ? .fleetAgent : .gateway
        service.delegate = self
        resolving.append(service)
        serviceKinds[ObjectIdentifier(service)] = kind
        service.resolve(withTimeout: 5)
    }

    func netServiceBrowser(
        _ browser: NetServiceBrowser,
        didRemove service: NetService,
        moreComing: Bool
    ) {
        let objectID = ObjectIdentifier(service)
        resolving.removeAll { $0 == service }
        serviceKinds.removeValue(forKey: objectID)
        if let key = resolvedServerIDs.removeValue(forKey: objectID) {
            servers.removeValue(forKey: key)
            publish()
        }
    }

    func netServiceBrowser(
        _ browser: NetServiceBrowser,
        didNotSearch errorDict: [String: NSNumber]
    ) {
        onError?(String(localized: "Local discovery could not start."))
    }

    func netServiceDidResolveAddress(_ sender: NetService) {
        let objectID = ObjectIdentifier(sender)
        defer {
            resolving.removeAll { $0 == sender }
            serviceKinds.removeValue(forKey: objectID)
        }
        guard let host = sender.hostName?.trimmingCharacters(in: CharacterSet(charactersIn: ".")),
              sender.port > 0,
              let url = URL(string: "http://\(host):\(sender.port)") else {
            return
        }
        let kind = serviceKinds[objectID] ?? .gateway
        let txt = sender.txtRecordData().map(NetService.dictionary(fromTXTRecord:)) ?? [:]
        let instanceID = txt["id"].flatMap { String(data: $0, encoding: .utf8) } ?? url.absoluteString
        let displayName = txt["name"].flatMap { String(data: $0, encoding: .utf8) } ?? sender.name
        let version = txt["version"].flatMap { String(data: $0, encoding: .utf8) }
        let serverID = "\(kind.rawValue):\(instanceID)"
        resolvedServerIDs[objectID] = serverID
        servers[serverID] = DiscoveredServer(
            id: serverID,
            instanceID: instanceID,
            name: displayName,
            url: url,
            version: version,
            kind: kind
        )
        publish()
    }

    func netService(_ sender: NetService, didNotResolve errorDict: [String: NSNumber]) {
        resolving.removeAll { $0 == sender }
        serviceKinds.removeValue(forKey: ObjectIdentifier(sender))
    }

    private func publish() {
        onChange?(servers.values.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending })
    }
}
