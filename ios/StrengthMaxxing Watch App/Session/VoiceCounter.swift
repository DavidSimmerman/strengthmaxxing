//
//  VoiceCounter.swift
//  StrengthMaxxing Watch App
//
//  Speaks the rep count ("2", "3", …) so you never lose track mid-set. Plays over music
//  (ducks it) on AirPods or the watch speaker; keeps working with the screen off because
//  the HKWorkoutSession keeps the app running.
//

import Foundation
import AVFoundation

@MainActor
final class VoiceCounter: NSObject, AVSpeechSynthesizerDelegate {
    private let synth = AVSpeechSynthesizer()
    private var lastSpoken = 0
    var enabled = true

    override init() {
        super.init()
        synth.delegate = self
    }

    /// New set: allow counting from the start again.
    func reset() { lastSpoken = 0 }

    /// Speak `count` once (duplicates and stale lower numbers are ignored).
    func say(_ count: Int) {
        guard enabled, count > lastSpoken else { return }
        lastSpoken = count
        activateSession()
        if synth.isSpeaking { synth.stopSpeaking(at: .immediate) }
        let u = AVSpeechUtterance(string: "\(count)")
        u.rate = min(AVSpeechUtteranceMaximumSpeechRate, AVSpeechUtteranceDefaultSpeechRate * 1.15)
        u.volume = 1.0
        synth.speak(u)
    }

    private func activateSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            // .playback so it is heard with the screen off; duck + mix so music keeps going.
            try session.setCategory(.playback, mode: .voicePrompt, options: [.duckOthers, .mixWithOthers])
            try session.setActive(true)
        } catch {
            print("VoiceCounter audio session: \(error)")
        }
    }

    private func deactivateIfIdle() {
        guard !synth.isSpeaking else { return }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.deactivateIfIdle() }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in self.deactivateIfIdle() }
    }
}
