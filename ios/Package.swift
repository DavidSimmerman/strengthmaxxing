// swift-tools-version: 5.9
//
//  Package.swift — the PURE core (rep counter, calibrator, rest alarm, offline outbox,
//  units, API models) + its tests. Foundation-only: builds on macOS and Linux.
//
//      cd ios && swift test
//
//  The apps (SwiftUI, CoreMotion, HealthKit, WatchConnectivity) are built from
//  project.yml via XcodeGen; they compile these same files directly into each target.
//
import PackageDescription

let package = Package(
    name: "StrengthMaxxingCore",
    platforms: [.iOS(.v17), .watchOS(.v10), .macOS(.v13)],
    products: [
        .library(name: "StrengthMaxxingCore", targets: ["StrengthMaxxingCore"]),
    ],
    targets: [
        .target(
            name: "StrengthMaxxingCore",
            path: "StrengthMaxxing",
            sources: ["Core", "Models"]
        ),
        .testTarget(
            name: "StrengthMaxxingTests",
            dependencies: ["StrengthMaxxingCore"],
            path: "Tests/StrengthMaxxingTests"
        ),
    ]
)
