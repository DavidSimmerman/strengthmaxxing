//
//  CalibrationStore.swift
//  StrengthMaxxing (shared)
//
//  Persists the per-exercise rep-counter params (CalibrationBook) and syncs them:
//  local file first (works offline), `PUT /api/calibration/:exerciseId` via the outbox,
//  and `GET /api/calibration` merged on launch (SyncService.refreshRemote).
//

import Foundation
import Combine

@MainActor
final class CalibrationStore: ObservableObject {
    static let shared = CalibrationStore()

    @Published private(set) var book: CalibrationBook
    private let file = FileStore.applicationSupport("calibration")

    private init() {
        book = file.load(CalibrationBook.self, "book.json") ?? CalibrationBook()
    }

    func params(for exerciseId: Int) -> RepCounterParams {
        book.params(for: exerciseId)
    }

    func samples(for exerciseId: Int) -> Int {
        book.entry(for: exerciseId)?.samples ?? 0
    }

    /// The user accepted the detected count.
    func confirm(exerciseId: Int) {
        let e = book.confirm(exerciseId: exerciseId, now: Date().timeIntervalSince1970)
        save()
        push(exerciseId, e)
    }

    /// The user corrected the count to `actual`: refit on the recorded set (off the main
    /// thread — a few hundred replays), then blend into the stored params.
    func correct(exerciseId: Int, recording: SetRecording, actual: Int) async {
        guard actual > 0, !recording.samples.isEmpty else { return }
        let current = book.params(for: exerciseId)
        let samples = recording.samples
        let fit = await Task.detached(priority: .utility) {
            Calibrator.refit(samples: samples, targetCount: actual, current: current)
        }.value
        guard let fit else { return }
        let e = book.applyCorrection(exerciseId: exerciseId, fitted: fit.params, now: Date().timeIntervalSince1970)
        save()
        push(exerciseId, e)
    }

    func merge(remote: [RemoteCalibration]) {
        book.merge(remote: remote, now: Date().timeIntervalSince1970)
        save()
    }

    private func save() { file.save(book, "book.json") }

    private func push(_ exerciseId: Int, _ e: CalibrationEntry) {
        SyncService.shared.enqueue(.putCalibration(
            exerciseId: exerciseId,
            body: CalibrationPutBody(params: e.params, samples: e.samples)
        ))
    }
}
