//
//  MotionRepSession.swift
//  StrengthMaxxing Watch App
//
//  Drives the RepCounter from CMMotionManager device-motion during a live set.
//  Publishes the live rep count for the UI. Start on set begin, stop on set end.
//

import Foundation
import CoreMotion
import Combine

@MainActor
final class MotionRepSession: ObservableObject {
    /// Live rep count for the current set.
    @Published private(set) var repCount: Int = 0
    /// Live smoothed effort magnitude (0..~1+ g) for a UI meter.
    @Published private(set) var effort: Double = 0
    @Published private(set) var isRunning = false

    private let motion = CMMotionManager()
    /// The detector is mutated exclusively from the motion `queue` while a set is running,
    /// and read on the main actor only AFTER updates are stopped (stopSet → confirm). We
    /// mark it `nonisolated(unsafe)` because that access pattern is enforced by the flow,
    /// not the compiler.
    nonisolated(unsafe) private let counter: RepCounter
    /// deviceMotion callbacks arrive on this queue; we hop back to main for @Published.
    private let queue = OperationQueue()

    /// Fires once per detected rep (on the main actor).
    var onRep: ((DetectedRep) -> Void)?

    init(config: RepCounterConfig = .default) {
        self.counter = RepCounter(config: config)
        queue.name = "com.strengthmaxxing.motion"
        queue.maxConcurrentOperationCount = 1
    }

    var isDeviceMotionAvailable: Bool { motion.isDeviceMotionAvailable }

    /// Begin counting a fresh set.
    func startSet() {
        guard motion.isDeviceMotionAvailable else { return }
        counter.reset()
        counter.onRep = { [weak self] rep in
            // RepCounter runs synchronously inside the motion handler (background queue).
            // We must NOT touch `counter` from the main actor (it mutates on the motion
            // queue). Instead we carry everything we need in `rep`: count == repIndex + 1.
            Task { @MainActor in
                guard let self else { return }
                self.repCount = rep.repIndex + 1
                self.onRep?(rep)
            }
        }
        repCount = 0
        effort = 0

        motion.deviceMotionUpdateInterval = 1.0 / 50.0  // 50 Hz
        motion.startDeviceMotionUpdates(to: queue) { [weak self] dm, _ in
            guard let self, let dm else { return }
            let a = dm.userAcceleration
            let mag = (a.x * a.x + a.y * a.y + a.z * a.z).squareRoot()
            self.counter.addSample(magnitude: mag, at: dm.timestamp)
            Task { @MainActor in self.effort = mag }
        }
        isRunning = true
    }

    /// Stop counting; returns the rep events for the completed set.
    @discardableResult
    func stopSet() -> [RepEvent] {
        if motion.isDeviceMotionActive { motion.stopDeviceMotionUpdates() }
        isRunning = false
        return counter.repEvents()
    }

    /// User override of the auto-counted reps before posting.
    func setCount(_ n: Int) {
        counter.adjustCount(to: n)
        repCount = counter.count
    }

    var currentRepEvents: [RepEvent] { counter.repEvents() }
}
