// swift-tools-version: 5.9
//
//  Package.swift
//
//  OPTIONAL Swift Package for the shared, cross-platform layer (models, APIClient,
//  settings, and the pure RepCounter) plus its unit tests. This lets you build & run the
//  RepCounter tests from the command line (`swift test`) WITHOUT the full Xcode app.
//
//  The SwiftUI apps, HealthKit, CoreMotion driver, and the watchOS session are NOT part of
//  this package — they live in the Xcode app/watch targets (see ios/README.md). You can
//  either:
//    (a) build the whole thing as an Xcode project with three targets (recommended), or
//    (b) add this package as a local Swift Package dependency of that project for the
//        shared code, keeping platform code in the app targets.
//
//  This package intentionally includes ONLY files with no UIKit/HealthKit/CoreMotion/
//  WatchKit imports so it compiles on macOS for fast test runs.
//
import PackageDescription

let package = Package(
    name: "StrengthMaxxingCore",
    platforms: [.iOS(.v17), .watchOS(.v10), .macOS(.v13)],
    products: [
        .library(name: "StrengthMaxxing", targets: ["StrengthMaxxing"]),
    ],
    targets: [
        .target(
            name: "StrengthMaxxing",
            path: "StrengthMaxxing",
            // Only the shared, platform-agnostic sources. AppSettings uses Security
            // (Keychain) which is available on macOS too, so it's included.
            sources: [
                "Models/Models.swift",
                "Models/WorkoutPlan.swift",
                "Networking/APIClient.swift",
                "Settings/AppSettings.swift",
            ]
        ),
        .testTarget(
            name: "StrengthMaxxingTests",
            dependencies: ["StrengthMaxxing"],
            path: "Tests/StrengthMaxxingTests",
            // RepCounter.swift lives in the Watch App folder but is pure Swift; we compile
            // a copy into the test target via a symlink or by adding it here. To keep the
            // package self-contained for `swift test`, we reference it through the watch dir.
            sources: [
                "RepCounterTests.swift",
                "../../StrengthMaxxing Watch App/Motion/RepCounter.swift",
            ],
            swiftSettings: [
                // Enables the `@testable import StrengthMaxxing` inside RepCounter.swift so
                // it can see the shared `RepEvent` type when compiled here (not in the app).
                .define("SM_SPM_TESTS")
            ]
        ),
    ]
)
