import XCTest
@testable import OPLFleetCockpit

final class OPLFleetCockpitTests: XCTestCase {
    func testCompactLandscapeDisplayReservesFloatingTabBarClearance() {
        XCTAssertEqual(
            DisplayLayoutProfile.tabBarClearance(compactLandscape: true),
            DisplayLayoutProfile.compactLandscapeTabBarClearance
        )
        XCTAssertGreaterThan(DisplayLayoutProfile.compactLandscapeTabBarClearance, 50)
        XCTAssertEqual(DisplayLayoutProfile.tabBarClearance(compactLandscape: false), 0)
    }

    func testTPSFormattingMatchesTheWebDisplay() {
        XCTAssertEqual(MetricFormat.tps(56_840), "56,840")
        XCTAssertEqual(MetricFormat.tps(2_329.4), "2,329")
        XCTAssertEqual(MetricFormat.tps(98.75), "98.8")
        XCTAssertEqual(MetricFormat.tps(0), "0")
    }

    func testPetPlaybackUsesOnlyPopulatedFrames() {
        let idle = PetAnimationPlayback.forState("idle")
        XCTAssertEqual(idle.row, 0)
        XCTAssertEqual(idle.frames.map(\.column), [0, 1, 2, 3, 4, 5])
        XCTAssertEqual(idle.durationMilliseconds, 6_600)

        let running = PetAnimationPlayback.forState("running")
        XCTAssertEqual(running.row, 7)
        XCTAssertEqual(running.frames.map(\.column), [0, 1, 2, 3, 4, 5])
        XCTAssertEqual(running.durationMilliseconds, 820)

        let failed = PetAnimationPlayback.forState("failed")
        XCTAssertEqual(failed.row, 5)
        XCTAssertEqual(failed.frames.map(\.column), Array(0..<8))
    }

    func testPetPlaybackUsesAbsoluteElapsedTime() {
        let running = PetAnimationPlayback.forState("running")
        XCTAssertEqual(running.frameIndex(atElapsedMilliseconds: -1), 0)
        XCTAssertEqual(running.frameIndex(atElapsedMilliseconds: 119), 0)
        XCTAssertEqual(running.frameIndex(atElapsedMilliseconds: 120), 1)
        XCTAssertEqual(running.frameIndex(atElapsedMilliseconds: 599), 4)
        XCTAssertEqual(running.frameIndex(atElapsedMilliseconds: 600), 5)
        XCTAssertEqual(running.frameIndex(atElapsedMilliseconds: 819), 5)
        XCTAssertEqual(running.frameIndex(atElapsedMilliseconds: 820), 0)
        XCTAssertEqual(running.frameIndex(atElapsedMilliseconds: (820 * 12) + 360), 3)
    }

    func testPetAtlasLayoutUsesNonSquareCodexCells() {
        let v2 = PetAtlasLayout(
            spriteVersionNumber: 2,
            imageSize: CGSize(width: 1_536, height: 2_288)
        )
        XCTAssertEqual(v2.rowCount, 11)
        XCTAssertEqual(
            v2.textureRect(row: 7, column: 5),
            CGRect(x: 0.625, y: 3.0 / 11.0, width: 0.125, height: 1.0 / 11.0)
        )

        let v1 = PetAtlasLayout(
            spriteVersionNumber: 1,
            imageSize: CGSize(width: 1_536, height: 1_872)
        )
        XCTAssertEqual(v1.rowCount, 9)
    }

    func testPetAtlasLayoutFallsBackToDeclaredVersion() {
        XCTAssertEqual(
            PetAtlasLayout(
                spriteVersionNumber: 2,
                imageSize: CGSize(width: 400, height: 400)
            ).rowCount,
            11
        )
        XCTAssertEqual(
            PetAtlasLayout(spriteVersionNumber: 1, imageSize: nil).rowCount,
            9
        )
    }

    func testAppIncludesEnglishAndSimplifiedChineseLocalizations() throws {
        let bundle = Bundle(for: OPLFleetCockpitStore.self)

        XCTAssertEqual(bundle.developmentLocalization, "en")
        XCTAssertTrue(bundle.localizations.contains("zh-Hans"))
        XCTAssertEqual(bundle.infoDictionary?["CFBundleDisplayName"] as? String, "OPL Cockpit")
        XCTAssertEqual(bundle.bundleIdentifier, "cn.gaofeng.oplfleetcockpit")
        XCTAssertEqual(bundle.infoDictionary?["CFBundleShortVersionString"] as? String, "1.0.0")
        XCTAssertEqual(bundle.infoDictionary?["CFBundleVersion"] as? String, "4")
        XCTAssertEqual(SharedSnapshotStore.appGroup, "group.cn.gaofeng.oplfleetcockpit")

        let urlTypes = try XCTUnwrap(bundle.infoDictionary?["CFBundleURLTypes"] as? [[String: Any]])
        let urlSchemes = try XCTUnwrap(urlTypes.first?["CFBundleURLSchemes"] as? [String])
        XCTAssertEqual(urlSchemes, ["oplfleetcockpit"])

        let englishInfoPath = try XCTUnwrap(
            bundle.path(
                forResource: "InfoPlist",
                ofType: "strings",
                inDirectory: nil,
                forLocalization: "en"
            )
        )
        let chineseInfoPath = try XCTUnwrap(
            bundle.path(
                forResource: "InfoPlist",
                ofType: "strings",
                inDirectory: nil,
                forLocalization: "zh-Hans"
            )
        )
        let englishInfo = try XCTUnwrap(
            PropertyListSerialization.propertyList(
                from: Data(contentsOf: URL(fileURLWithPath: englishInfoPath)),
                format: nil
            ) as? [String: String]
        )
        let chineseInfo = try XCTUnwrap(
            PropertyListSerialization.propertyList(
                from: Data(contentsOf: URL(fileURLWithPath: chineseInfoPath)),
                format: nil
            ) as? [String: String]
        )

        XCTAssertEqual(englishInfo["CFBundleDisplayName"], "OPL Cockpit")
        XCTAssertEqual(chineseInfo["CFBundleDisplayName"], "OPL Cockpit")
        XCTAssertTrue(
            try XCTUnwrap(englishInfo["NSLocalNetworkUsageDescription"])
                .contains("OPL Fleet Agent")
        )
        XCTAssertTrue(
            try XCTUnwrap(chineseInfo["NSLocalNetworkUsageDescription"])
                .contains("OPL Fleet Agent")
        )

        let chineseStringsPath = try XCTUnwrap(
            bundle.path(
                forResource: "Localizable",
                ofType: "strings",
                inDirectory: nil,
                forLocalization: "zh-Hans"
            )
        )
        let chineseStrings = try XCTUnwrap(
            PropertyListSerialization.propertyList(
                from: Data(contentsOf: URL(fileURLWithPath: chineseStringsPath)),
                format: nil
            ) as? [String: String]
        )
        let requiredInteractions = [
            "Home",
            "Machines",
            "Machine",
            "Display",
            "Settings",
            "Demo Mode",
            "Connect",
            "Done",
            "Find on Local Network",
            "Nearby sources",
            "Start Load Live Activity",
            "Start Full-Screen StandBy",
            "Restart Full-Screen StandBy",
            "End Live Activity",
            "StandBy & Lock Screen",
            "Privacy",
            "Connection",
            "Current source",
            "Search Again",
            "Manual Connection",
            "Preview",
            "Fleet activity",
            "Display scope",
            "Fleet",
            "Fleet standing by",
            "Host",
            "Host pressure detected",
            "Nodes in motion",
            "Open Fleet load display",
            "Parallel fleet work",
        ]

        for key in requiredInteractions {
            XCTAssertNotEqual(chineseStrings[key], nil, "Missing zh-Hans translation for \(key)")
            XCTAssertNotEqual(chineseStrings[key], key, "Untranslated zh-Hans value for \(key)")
        }

        let widgetURL = try XCTUnwrap(
            bundle.builtInPlugInsURL?.appendingPathComponent("OPL Fleet Cockpit Widgets.appex")
        )
        let widgetBundle = try XCTUnwrap(Bundle(url: widgetURL))
        XCTAssertEqual(widgetBundle.bundleIdentifier, "cn.gaofeng.oplfleetcockpit.widgets")
        XCTAssertEqual(
            widgetBundle.infoDictionary?["CFBundleDisplayName"] as? String,
            "OPL Fleet Cockpit Widgets"
        )
        XCTAssertEqual(widgetBundle.infoDictionary?["CFBundleVersion"] as? String, "4")
        XCTAssertEqual(widgetBundle.developmentLocalization, "en")
        XCTAssertTrue(widgetBundle.localizations.contains("zh-Hans"))
        XCTAssertNotNil(
            widgetBundle.path(
                forResource: "Localizable",
                ofType: "strings",
                inDirectory: nil,
                forLocalization: "zh-Hans"
            )
        )
    }

    func testDemoCoversEveryLoadStateAndUnknownCPU() {
        let status = DemoFixtures.status(now: Date(timeIntervalSince1970: 1_800_000_000))
        let states = Set(status.machines.map(\.loadVisualState.state))

        XCTAssertEqual(states, Set(["quiet", "active", "heavy", "constrained"]))
        XCTAssertNil(status.machines.first(where: { $0.machineId == "notebook" })?.cpuPercent)
        XCTAssertEqual(status.network.history.count, 60)
    }

    @MainActor
    func testDemoFleetScopeAndPresentationMatchAggregateStatus() {
        let suiteName = "OPLFleetCockpitTests.fleet-scope.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        defaults.set(true, forKey: "opl-fleet-cockpit.demo-mode")
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let store = OPLFleetCockpitStore(defaults: defaults)
        let fleet = store.fleetLoadPresentation

        XCTAssertEqual(store.displayScope, .fleet)
        XCTAssertEqual(fleet.totalNodeCount, 4)
        XCTAssertEqual(fleet.liveNodeCount, 3)
        XCTAssertEqual(fleet.workingNodeCount, 3)
        XCTAssertEqual(fleet.oneMinuteTps, 100_840)
        XCTAssertEqual(fleet.activeSessions, 21)
        XCTAssertEqual(fleet.cpuPercent, 83)
        XCTAssertEqual(fleet.cpuReportedNodeCount, 3)
        XCTAssertEqual(fleet.visual.state, "heavy")
        XCTAssertFalse(fleet.visual.constrained)
        XCTAssertEqual(fleet.nodes.map(\.id), ["notebook", "studio", "workstation", "lab-mini"])
        XCTAssertLessThanOrEqual(fleet.nodes.count, 6)
    }

    @MainActor
    func testFleetHostScopePersistsAndMachineSelectionOpensHost() throws {
        let suiteName = "OPLFleetCockpitTests.scope-persistence.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        defaults.set(true, forKey: "opl-fleet-cockpit.demo-mode")
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let store = OPLFleetCockpitStore(defaults: defaults)
        XCTAssertEqual(store.displayScope, .fleet)

        store.selectMachine("workstation")
        XCTAssertEqual(store.displayScope, .host)
        XCTAssertEqual(store.selectedMachine?.machineId, "workstation")
        XCTAssertEqual(defaults.string(forKey: "opl-fleet-cockpit.display-scope"), "host")

        store.displayScope = .fleet
        XCTAssertEqual(store.displayScope, .fleet)
        XCTAssertEqual(defaults.string(forKey: "opl-fleet-cockpit.display-scope"), "fleet")

        let restored = OPLFleetCockpitStore(defaults: defaults)
        XCTAssertEqual(restored.displayScope, .fleet)
        XCTAssertEqual(restored.selectedMachine?.machineId, "workstation")
    }

    func testFleetHistoryAggregatesMatchingTimeBuckets() {
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        let history = LoadHistorySeries.fleetHistory([
            "studio": [
                LoadHistoryPoint(at: start, tps: 30),
                LoadHistoryPoint(at: start.addingTimeInterval(4), tps: 40),
            ],
            "workstation": [
                LoadHistoryPoint(at: start.addingTimeInterval(1), tps: 12),
                LoadHistoryPoint(at: start.addingTimeInterval(5), tps: 18),
            ],
        ])

        XCTAssertEqual(history.map(\.at), [start, start.addingTimeInterval(4)])
        XCTAssertEqual(history.map(\.tps), [42, 58])
    }

    func testFleetVisualNodesAreStableAndCappedAtSix() throws {
        let encoded = try JSONEncoder().encode(DemoFixtures.status())
        var object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: encoded) as? [String: Any]
        )
        var machines = try XCTUnwrap(object["machines"] as? [[String: Any]])
        let template = try XCTUnwrap(machines.first)
        for (id, name) in [("alpha", "Alpha"), ("beta", "Beta"), ("zulu", "Zulu")] {
            var machine = template
            machine["machineId"] = id
            machine["machineName"] = name
            machines.append(machine)
        }
        object["machines"] = machines

        let status = try JSONDecoder().decode(
            AmbientStatus.self,
            from: JSONSerialization.data(withJSONObject: object)
        )
        let nodes = FleetLoadPresentation(status: status).nodes

        XCTAssertEqual(nodes.count, 6)
        XCTAssertEqual(
            nodes.map(\.id),
            ["alpha", "beta", "notebook", "studio", "workstation", "zulu"]
        )
    }

    @MainActor
    func testFleetSceneUsesBalancedSlotsAndKeepsReducedMotionAlive() {
        XCTAssertEqual(FleetLoadSceneProfile.maximumNodeCount, 6)
        XCTAssertEqual(FleetLoadSceneProfile.fieldParticleCapacity, 72)
        XCTAssertEqual(FleetLoadSceneProfile.slotIndices(nodeCount: 1), [1])
        XCTAssertEqual(FleetLoadSceneProfile.slotIndices(nodeCount: 2), [1, 4])
        XCTAssertEqual(FleetLoadSceneProfile.slotIndices(nodeCount: 4), [0, 2, 3, 5])
        XCTAssertEqual(FleetLoadSceneProfile.slotIndices(nodeCount: 8), [0, 1, 2, 3, 4, 5])
        XCTAssertGreaterThan(FleetLoadSceneProfile.motionScale(reduceMotion: true), 0)
        XCTAssertLessThan(
            FleetLoadSceneProfile.motionScale(reduceMotion: true),
            FleetLoadSceneProfile.motionScale(reduceMotion: false)
        )
    }

    @MainActor
    func testFleetSceneKeepsTPSAndActiveMetricsOnSeparateBoundedLines() {
        let metrics = FleetLoadSceneProfile.nodeMetricLines(
            tps: 133_721,
            sessions: 14
        )

        XCTAssertEqual(metrics.tps, "133,721 TPS")
        XCTAssertEqual(metrics.active, "14 ACTIVE")
        XCTAssertFalse(metrics.tps.contains("ACTIVE"))
        XCTAssertFalse(metrics.active.contains("TPS"))
        XCTAssertEqual(FleetLoadSceneProfile.metricScale(textWidth: 100), 1)
        XCTAssertEqual(
            FleetLoadSceneProfile.metricScale(textWidth: 145),
            FleetLoadSceneProfile.nodeMetricMaximumWidth / 145,
            accuracy: 0.001
        )
        XCTAssertEqual(FleetLoadSceneProfile.metricScale(textWidth: 1_000), 0.65)
    }

    @MainActor
    func testFleetSceneParticleDensityRespondsToWork() {
        XCTAssertEqual(FleetLoadSceneProfile.routeParticleCount(intensity: 1, isWorking: false), 0)
        XCTAssertEqual(FleetLoadSceneProfile.localParticleCount(intensity: 1, isWorking: false), 0)
        XCTAssertEqual(FleetLoadSceneProfile.routeParticleCount(intensity: 0, isWorking: true), 8)
        XCTAssertEqual(
            FleetLoadSceneProfile.routeParticleCount(intensity: 1, isWorking: true),
            FleetLoadSceneProfile.routeParticleCapacity
        )
        XCTAssertEqual(FleetLoadSceneProfile.localParticleCount(intensity: 0, isWorking: true), 5)
        XCTAssertEqual(
            FleetLoadSceneProfile.localParticleCount(intensity: 1, isWorking: true),
            FleetLoadSceneProfile.localParticleCapacity
        )
    }

    func testFleetConstraintRequiresAggregateLoadInsteadOfOneHotNode() throws {
        let encoded = try JSONEncoder().encode(DemoFixtures.status())
        var object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: encoded) as? [String: Any]
        )
        var codex = try XCTUnwrap(object["codex"] as? [String: Any])
        codex["oneMinuteTps"] = 10
        codex["fiveMinuteTps"] = 10
        codex["activeSessions"] = 0
        codex["cpuPercent"] = 90
        codex["cpuReportedMachineCount"] = 1
        codex["machineCount"] = 1
        codex["liveMachineCount"] = 1
        codex["staleMachineCount"] = 0
        object["codex"] = codex
        object.removeValue(forKey: "fleet")

        var machine = try XCTUnwrap(
            (object["machines"] as? [[String: Any]])?.first
        )
        var oneMinute = try XCTUnwrap(machine["oneMinute"] as? [String: Any])
        oneMinute["tps"] = 10
        machine["oneMinute"] = oneMinute
        var fiveMinutes = try XCTUnwrap(machine["fiveMinutes"] as? [String: Any])
        fiveMinutes["tps"] = 10
        machine["fiveMinutes"] = fiveMinutes
        machine["activeSessions"] = 0
        machine["cpuPercent"] = 90
        machine["status"] = "live"
        object["machines"] = [machine]

        let status = try JSONDecoder().decode(
            AmbientStatus.self,
            from: JSONSerialization.data(withJSONObject: object)
        )
        let fleet = FleetLoadPresentation(status: status)

        XCTAssertFalse(fleet.visual.constrained)
        XCTAssertEqual(fleet.visual.state, "active")
        XCTAssertTrue(try XCTUnwrap(fleet.nodes.first).isPressured)
    }

    func testFleetNodePressureStartsAtWebHighPressureThreshold() {
        let node = FleetLoadNode(
            id: "node",
            name: "Node",
            platform: "macOS",
            status: "live",
            tps: 0,
            sessions: 0,
            cpuPercent: 82,
            intensity: 0.1,
            travelMs: 3_000
        )

        XCTAssertTrue(node.isPressured)
        XCTAssertFalse(node.isWorking)
    }

    func testFleetNormalizationUsesReportedLiveCapacity() throws {
        let encoded = try JSONEncoder().encode(DemoFixtures.status())
        var object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: encoded) as? [String: Any]
        )
        var codex = try XCTUnwrap(object["codex"] as? [String: Any])
        codex["oneMinuteTps"] = 120_000
        codex["fiveMinuteTps"] = 100_000
        codex["activeSessions"] = 12
        codex["cpuPercent"] = NSNull()
        codex["cpuReportedMachineCount"] = 0
        codex["machineCount"] = 4
        codex["liveMachineCount"] = 4
        codex["staleMachineCount"] = 0
        object["codex"] = codex
        object.removeValue(forKey: "fleet")
        object["machines"] = Array(
            try XCTUnwrap(object["machines"] as? [[String: Any]]).prefix(1)
        )

        let status = try JSONDecoder().decode(
            AmbientStatus.self,
            from: JSONSerialization.data(withJSONObject: object)
        )
        let fleet = FleetLoadPresentation(status: status)
        let expectedBaseScore = sqrt(30_000 / 60_000) * 0.72 + (3.0 / 12.0) * 0.28
        let expectedScore = expectedBaseScore * 0.78 + (1.0 / 4.0) * 0.22

        XCTAssertEqual(fleet.liveNodeCount, 4)
        XCTAssertEqual(fleet.oneMinuteTps, 120_000)
        XCTAssertEqual(fleet.visual.score, expectedScore, accuracy: 0.000_001)
    }

    @MainActor
    func testFleetPresentationPrefersGatewayAuthorityAndHistory() throws {
        let encoded = try JSONEncoder().encode(DemoFixtures.status())
        var object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: encoded) as? [String: Any]
        )
        let fleet: [String: Any] = [
            "status": "live",
            "oneMinuteTps": 100_840,
            "fiveMinuteTps": 86_320,
            "cachePercent": 83,
            "activeSessions": 21,
            "cpuPercent": 83,
            "cpuReportedMachineCount": 3,
            "memoryPercent": 51,
            "memoryReportedMachineCount": 3,
            "machineCount": 4,
            "liveMachineCount": 3,
            "staleMachineCount": 1,
            "workingMachineCount": 2,
            "loadVisualState": [
                "modelVersion": 1,
                "state": "active",
                "label": "ACTIVE",
                "score": 0.31,
                "constrained": false,
                "activity": 0.4,
                "parallel": 0.25,
                "tempo": 0.9,
                "travelMs": 2_400,
                "clusterCount": 2,
                "taskDensity": 0.46,
                "pressure": 0,
                "queueDepth": 0,
                "heat": 0.04,
            ],
            "tpsHistory": [
                ["at": "2026-08-03T00:00:00.000Z", "tps": 12_000],
                ["at": "2026-08-03T00:00:04.000Z", "tps": 15_000],
            ],
        ]
        object["fleet"] = fleet

        let status = try JSONDecoder().decode(
            AmbientStatus.self,
            from: JSONSerialization.data(withJSONObject: object)
        )
        let presentation = FleetLoadPresentation(status: status)
        let store = OPLFleetCockpitStore(automaticallyConnect: false)
        store.status = status

        XCTAssertEqual(presentation.workingNodeCount, 2)
        XCTAssertEqual(presentation.visual.state, "active")
        XCTAssertEqual(presentation.visual.score, 0.31)
        XCTAssertEqual(store.fleetLoadHistory.map(\.tps), [12_000, 15_000])
    }

    func testLiveActivityCarriesTheProviderVisualStateIntoStandBy() throws {
        let machine = try XCTUnwrap(DemoFixtures.status().machines.first)
        let content = LoadActivityAttributes.ContentState(machine: machine)

        XCTAssertEqual(content.visual, machine.loadVisualState)
        XCTAssertEqual(content.visual?.modelVersion, 1)
        XCTAssertEqual(content.visual?.clusterCount, machine.loadVisualState.clusterCount)
        XCTAssertEqual(content.visual?.travelMs, machine.loadVisualState.travelMs)
    }

    func testCompactLoadStateLabelsStayWithinSmallSurfaceBudget() {
        XCTAssertEqual(LoadStatePalette.compactLabel(for: "quiet"), "QUIET")
        XCTAssertEqual(LoadStatePalette.compactLabel(for: "active"), "ACTIVE")
        XCTAssertEqual(LoadStatePalette.compactLabel(for: "heavy"), "HEAVY")
        XCTAssertEqual(LoadStatePalette.compactLabel(for: "constrained"), "LIMITED")

        for state in ["quiet", "active", "heavy", "constrained"] {
            XCTAssertLessThanOrEqual(LoadStatePalette.compactLabel(for: state).count, 7)
        }
    }

    func testServerHistoryMergesWithLocalCoverageAndReportsItsRealWindow() {
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        let local = [
            LoadHistoryPoint(at: start.addingTimeInterval(-1_200), tps: 999),
            LoadHistoryPoint(at: start.addingTimeInterval(-900), tps: 999),
        ]
        let server = [
            MachineTPSHistoryPoint(at: AmbientISO8601.string(from: start.addingTimeInterval(-1_800)), tps: 12_000),
            MachineTPSHistoryPoint(at: AmbientISO8601.string(from: start.addingTimeInterval(-900)), tps: 24_000),
            MachineTPSHistoryPoint(at: AmbientISO8601.string(from: start), tps: 36_000),
        ]

        let merged = LoadHistorySeries.merged(
            existing: local,
            server: server,
            sampleAt: start,
            tps: 36_000
        )

        XCTAssertEqual(merged.map(\.tps), [12_000, 999, 24_000, 36_000])
        XCTAssertEqual(LoadHistorySeries.coveredMinutes(merged), 30)
    }

    func testLocalHistoryReportsPartialWindowWhileCollecting() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let points = [
            LoadHistoryPoint(at: now.addingTimeInterval(-390), tps: 10),
            LoadHistoryPoint(at: now, tps: 20),
        ]

        XCTAssertEqual(LoadHistorySeries.coveredMinutes(points), 7)
    }

    @MainActor
    func testLiveModeCanDisableDemoAndClearsDemoSnapshot() {
        let suiteName = "OPLFleetCockpitTests.demo.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        let demoKey = "opl-fleet-cockpit.demo-mode"
        defer {
            defaults.removePersistentDomain(forName: suiteName)
        }

        defaults.set(true, forKey: demoKey)
        let store = OPLFleetCockpitStore(defaults: defaults)
        XCTAssertTrue(store.isDemoMode)
        XCTAssertTrue(store.status.demo)

        store.useLiveMode()

        XCTAssertFalse(store.isDemoMode)
        XCTAssertEqual(store.connectionState, .disconnected)
        XCTAssertFalse(store.status.demo)
        XCTAssertTrue(store.status.machines.isEmpty)
        XCTAssertEqual(defaults.object(forKey: demoKey) as? Bool, false)
    }

    @MainActor
    func testFirstLaunchUsesAutomaticDiscoveryInsteadOfDemo() {
        let suiteName = "OPLFleetCockpitTests.first-launch.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        defer {
            defaults.removePersistentDomain(forName: suiteName)
        }

        let store = OPLFleetCockpitStore(defaults: defaults)

        XCTAssertFalse(store.isDemoMode)
        XCTAssertFalse(store.status.demo)
        XCTAssertTrue(store.isDiscovering)
        XCTAssertEqual(store.connectionState, .loading)
        XCTAssertEqual(defaults.object(forKey: "opl-fleet-cockpit.demo-mode") as? Bool, false)

        store.useLiveMode()
    }

    func testUnknownCPUDecodesAsNil() throws {
        let json = """
        {
          "schemaVersion": 1,
          "serverVersion": "1.0.0",
          "instanceId": "home",
          "generatedAt": "2026-07-31T00:00:00.000Z",
          "demo": false,
          "site": {"name": "Home", "timeZone": "Asia/Shanghai"},
          "overallStatus": "live",
          "capabilities": {
            "loadVisualState": true,
            "networkHistory": true,
            "pets": true,
            "liveActivityPush": false
          },
          "network": {"status": "live", "history": []},
          "codex": {
            "status": "live",
            "oneMinuteTps": 1000,
            "fiveMinuteTps": 900,
            "cachePercent": 80,
            "activeSessions": 2,
            "cpuPercent": null,
            "cpuReportedMachineCount": 0,
            "memoryPercent": null,
            "memoryReportedMachineCount": 0,
            "machineCount": 1,
            "liveMachineCount": 1,
            "staleMachineCount": 0
          },
          "machines": [{
            "machineId": "mac",
            "machineName": "Mac",
            "platform": "macOS",
            "generatedAt": "2026-07-31T00:00:00.000Z",
            "oneMinute": {"tps": 1000},
            "fiveMinutes": {"tps": 900},
            "activeSessions": 2,
            "cpuPercent": null,
            "memoryPercent": null,
            "pet": null,
            "status": "live",
            "ageSeconds": 0,
            "cachePercent": 80,
            "loadVisualState": {
              "state": "active",
              "label": "ACTIVE",
              "score": 0.3,
              "constrained": false,
              "activity": 0.35,
              "parallel": 0.25,
              "tempo": 1,
              "travelMs": 2000,
              "clusterCount": 2,
              "taskDensity": 0.45,
              "pressure": 0,
              "queueDepth": 0,
              "heat": 0.04
            }
          }]
        }
        """

        let status = try JSONDecoder().decode(AmbientStatus.self, from: Data(json.utf8))
        XCTAssertNil(status.codex.cpuPercent)
        XCTAssertNil(status.machines[0].cpuPercent)
        XCTAssertNil(status.machines[0].loadVisualState.modelVersion)
        XCTAssertEqual(MetricFormat.percent(status.machines[0].cpuPercent), "N/A")
    }

    func testServerURLNormalization() {
        XCTAssertEqual(
            OPLFleetCockpitClient.normalizedServerURL("gateway.local:8787")?.absoluteString,
            "http://gateway.local:8787"
        )
        XCTAssertNil(OPLFleetCockpitClient.normalizedServerURL("not a host"))
    }

    func testSourceSelectionPrefersSavedThenGatewayThenUniqueDirect() throws {
        let gateway = DiscoveredServer(
            id: "gateway:home",
            instanceID: "home",
            name: "Home",
            url: try XCTUnwrap(URL(string: "http://home.local:8787")),
            version: "1.0",
            kind: .gateway
        )
        let studio = DiscoveredServer(
            id: "fleetAgent:studio",
            instanceID: "studio",
            name: "Studio",
            url: try XCTUnwrap(URL(string: "http://studio.local:7419")),
            version: "1.0",
            kind: .fleetAgent
        )
        let notebook = DiscoveredServer(
            id: "fleetAgent:notebook",
            instanceID: "notebook",
            name: "Notebook",
            url: try XCTUnwrap(URL(string: "http://notebook.local:7419")),
            version: "1.0",
            kind: .fleetAgent
        )

        XCTAssertEqual(
            SourceSelectionPolicy.automaticSource(
                from: [gateway, studio],
                preferredID: studio.id
            ),
            studio
        )
        XCTAssertEqual(
            SourceSelectionPolicy.automaticSource(
                from: [studio, gateway],
                preferredID: nil
            ),
            gateway
        )
        XCTAssertEqual(
            SourceSelectionPolicy.automaticSource(
                from: [studio],
                preferredID: nil
            ),
            studio
        )
        XCTAssertNil(
            SourceSelectionPolicy.automaticSource(
                from: [studio, notebook],
                preferredID: nil
            )
        )
    }

    @MainActor
    func testDirectProviderShowsHostNetworkWithoutMakingTheStatusFail() throws {
        let encoded = try JSONEncoder().encode(DemoFixtures.status())
        var object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: encoded) as? [String: Any]
        )
        object["provider"] = [
            "kind": "opl-fleet-agent",
            "scope": "machine",
            "id": "studio",
            "name": "Studio",
        ]
        object["demo"] = false
        var capabilities = try XCTUnwrap(object["capabilities"] as? [String: Any])
        capabilities["network"] = true
        capabilities["networkHistory"] = false
        capabilities["persistentHistory"] = false
        capabilities["webDisplay"] = false
        object["capabilities"] = capabilities
        var network = try XCTUnwrap(object["network"] as? [String: Any])
        network["status"] = "unavailable"
        network["history"] = []
        object["network"] = network
        object["machines"] = Array(
            try XCTUnwrap(object["machines"] as? [[String: Any]]).prefix(1)
        )

        let direct = try JSONDecoder().decode(
            AmbientStatus.self,
            from: JSONSerialization.data(withJSONObject: object)
        )
        let store = OPLFleetCockpitStore(automaticallyConnect: false)
        store.useLiveMode()
        store.status = direct

        XCTAssertEqual(direct.effectiveProvider.scope, "machine")
        XCTAssertEqual(direct.overallStatus, "live")
        XCTAssertTrue(direct.capabilities.supportsNetwork)
        XCTAssertTrue(store.availableDisplayModes.contains(.network))
        XCTAssertEqual(store.providerLabel, "AGENT · Studio")
        XCTAssertEqual(store.displayScope, .host)

        store.displayScope = .fleet
        XCTAssertEqual(store.displayScope, .host)
    }
}
