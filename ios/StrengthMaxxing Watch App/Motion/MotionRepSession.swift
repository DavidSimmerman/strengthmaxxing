//
//  MotionRepSession.swift
//  StrengthMaxxing Watch App
//
//  CoreMotion → RepCounter, running for the WHOLE workout (lifting and rest) so the next
//  set's start can be detected automatically.
//
//  Threading (fixes the old stopSet data race + Task-per-sample):
//   - `MotionEngine` is deliberately NOT main-actor isolated. It owns the CMMotionManager,
//     the RepCounter and a serial OperationQueue; the device-motion handler and every
//     RepCounter access (process, params, finishSet) run on that queue only.
//   - Results hop to the main actor with DispatchQueue.main.async: rep events as they
//     happen, the UI meter throttled to 5 Hz. No Task is created per sample.
//   - Each finished set bumps a generation number so late events from the previous set
//     can't leak into the next one.
//

import Foundation
import CoreMotion
import Combine

final class MotionEngine: @unchecked Sendable {
    private let manager = CMMotionManager()
    private let queue: OperationQueue
    // Everything below is touched only on `queue`.
    private let counter = RepCounter()
    private var generation = 0
    private var lastUIPush: TimeInterval = 0

    /// Called on the motion queue. Set before `start()`.
    var onEvent: (@Sendable (RepCounterEvent, Int) -> Void)?
    /// ~5 Hz on the motion queue: (signal, count, isStarted, generation).
    var onTick: (@Sendable (Double, Int, Bool, Int) -> Void)?

    init() {
        queue = OperationQueue()
        queue.name = "tech.simmerman.strengthmaxxing.motion"
        queue.maxConcurrentOperationCount = 1
        queue.qualityOfService = .userInitiated
    }

    var isAvailable: Bool { manager.isDeviceMotionAvailable }

    func start() {
        guard manager.isDeviceMotionAvailable, !manager.isDeviceMotionActive else { return }
        manager.deviceMotionUpdateInterval = 1.0 / 50.0
        manager.startDeviceMotionUpdates(to: queue) { [weak self] motion, _ in
            guard let self, let motion else { return }
            self.handle(motion)
        }
    }

    func stop() {
        if manager.isDeviceMotionActive { manager.stopDeviceMotionUpdates() }
    }

    func setParams(_ params: RepCounterParams) {
        queue.addOperation { [weak self] in self?.counter.params = params }
    }

    /// Ends the current set on the motion queue; completion runs on the motion queue.
    func finishSet(_ completion: @escaping @Sendable (SetRecording, Int) -> Void) {
        queue.addOperation { [weak self] in
            guard let self else { return }
            let rec = self.counter.finishSet()
            self.generation += 1
            completion(rec, self.generation)
        }
    }

    // On `queue`.
    private func handle(_ m: CMDeviceMotion) {
        let a = m.userAcceleration, g = m.gravity, r = m.rotationRate
        let sample = MotionSample(t: m.timestamp, ax: a.x, ay: a.y, az: a.z,
                                  gx: g.x, gy: g.y, gz: g.z, rx: r.x, ry: r.y, rz: r.z)
        let events = counter.process(sample)
        for e in events { onEvent?(e, generation) }
        if m.timestamp - lastUIPush >= 0.2 {
            lastUIPush = m.timestamp
            onTick?(counter.signal, counter.count, counter.isStarted, generation)
        }
    }
}

@MainActor
final class MotionRepSession: ObservableObject {
    @Published private(set) var repCount = 0
    @Published private(set) var isSetStarted = false
    /// 0…1 effort meter (throttled to 5 Hz).
    @Published private(set) var effort: Double = 0
    @Published private(set) var isRunning = false

    /// Rep-counter events on the main actor (current set only).
    var onEvent: ((RepCounterEvent) -> Void)?

    private let engine = MotionEngine()
    private var generation = 0

    init() {
        // Rebind weak self to a constant before the hop: nested @Sendable closures can't
        // capture the outer closure's `weak var self`.
        engine.onEvent = { [weak self] event, gen in
            guard let session = self else { return }
            DispatchQueue.main.async {
                MainActor.assumeIsolated { session.receive(event, gen) }
            }
        }
        engine.onTick = { [weak self] signal, count, started, gen in
            guard let session = self else { return }
            DispatchQueue.main.async {
                MainActor.assumeIsolated { session.tick(signal, count, started, gen) }
            }
        }
    }

    var isAvailable: Bool { engine.isAvailable }

    func start() {
        engine.start()
        isRunning = true
    }

    func stop() {
        engine.stop()
        isRunning = false
    }

    /// Params for the exercise whose set we're expecting next (also applies mid-set).
    func setParams(_ params: RepCounterParams) { engine.setParams(params) }

    /// Ends the current set and returns its recording; the counter re-arms immediately.
    func finishSet() async -> SetRecording {
        let (rec, gen) = await withCheckedContinuation { (cont: CheckedContinuation<(SetRecording, Int), Never>) in
            engine.finishSet { rec, gen in cont.resume(returning: (rec, gen)) }
        }
        if gen > generation {
            generation = gen
            repCount = 0
            isSetStarted = false
        }
        return rec
    }

    private func receive(_ event: RepCounterEvent, _ gen: Int) {
        guard gen >= generation else { return }   // stale event from a finished set
        if gen > generation { generation = gen; repCount = 0; isSetStarted = false }
        switch event {
        case .setStarted(let n, _):
            isSetStarted = true
            repCount = n
        case .rep(let n, _):
            repCount = n
        case .setEnded:
            break
        }
        onEvent?(event)
    }

    private func tick(_ signal: Double, _ count: Int, _ started: Bool, _ gen: Int) {
        effort = min(abs(signal) / 2, 1)
        guard gen == generation else { return }
        // Events already set these; this just heals anything missed.
        if count > repCount { repCount = count }
        if started && !isSetStarted { isSetStarted = true }
    }
}

/// Converts CoreMotion timestamps (seconds since boot) to wall-clock dates.
func wallDate(uptime t: TimeInterval) -> Date {
    Date(timeIntervalSinceNow: t - ProcessInfo.processInfo.systemUptime)
}
