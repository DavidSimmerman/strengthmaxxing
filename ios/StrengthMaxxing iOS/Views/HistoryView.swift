//
//  HistoryView.swift
//  StrengthMaxxing iOS
//
//  Session history (GET /api/sessions) with a detail view (GET /api/sessions/:id).
//

import SwiftUI

@MainActor
final class HistoryViewModel: ObservableObject {
    enum State {
        case idle, loading
        case loaded([Session])
        case failed(String)
    }
    @Published var state: State = .idle
    private let api = APIClient.shared

    func load() async {
        state = .loading
        do {
            state = .loaded(try await api.getSessions(limit: 50))
        } catch {
            state = .failed((error as? APIError)?.errorDescription ?? error.localizedDescription)
        }
    }
}

struct HistoryView: View {
    @StateObject private var vm = HistoryViewModel()

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("History")
                .task { if case .idle = vm.state { await vm.load() } }
        }
    }

    @ViewBuilder private var content: some View {
        switch vm.state {
        case .idle, .loading:
            ProgressView("Loading…")
        case .failed(let msg):
            ContentUnavailableView {
                Label("Couldn't load history", systemImage: "wifi.exclamationmark")
            } description: { Text(msg) } actions: {
                Button("Retry") { Task { await vm.load() } }
            }
        case .loaded(let sessions):
            if sessions.isEmpty {
                ContentUnavailableView("No Sessions Yet",
                    systemImage: "clock",
                    description: Text("Finished workouts will appear here."))
            } else {
                List(sessions) { s in
                    NavigationLink { SessionDetailView(sessionId: s.id) } label: {
                        SessionSummaryRow(session: s)
                    }
                }
                .refreshable { await vm.load() }
            }
        }
    }
}

private struct SessionSummaryRow: View {
    let session: Session
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(session.name ?? "Session #\(session.id)").font(.headline)
            HStack(spacing: 10) {
                if let d = displayDate(session.completedAt ?? session.startedAt) {
                    Label(d, systemImage: "calendar").font(.caption)
                }
                if let v = session.totalVolumeKg {
                    Label(String(format: "%.0f kg", v), systemImage: "scalemass").font(.caption)
                }
                if let k = session.estimatedKcal {
                    Label(String(format: "%.0f kcal", k), systemImage: "flame").font(.caption)
                }
            }
            .foregroundStyle(.secondary)
        }
    }

    private func displayDate(_ iso: String?) -> String? {
        guard let iso else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
        guard let date else { return nil }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}

// MARK: - Detail

@MainActor
final class SessionDetailViewModel: ObservableObject {
    enum State {
        case loading
        case loaded(Session)
        case failed(String)
    }
    @Published var state: State = .loading
    private let api = APIClient.shared

    func load(id: Int) async {
        state = .loading
        do { state = .loaded(try await api.getSession(id: id)) }
        catch { state = .failed((error as? APIError)?.errorDescription ?? error.localizedDescription) }
    }
}

struct SessionDetailView: View {
    let sessionId: Int
    @StateObject private var vm = SessionDetailViewModel()

    var body: some View {
        Group {
            switch vm.state {
            case .loading: ProgressView()
            case .failed(let msg): Text(msg).foregroundStyle(.red).padding()
            case .loaded(let session):
                List {
                    Section("Summary") {
                        if let v = session.totalVolumeKg {
                            LabeledContent("Total volume", value: String(format: "%.0f kg", v))
                        }
                        if let k = session.estimatedKcal {
                            LabeledContent("Estimated kcal", value: String(format: "%.0f", k))
                        }
                        if let bw = session.bodyweightKg {
                            LabeledContent("Bodyweight", value: String(format: "%.1f kg", bw))
                        }
                    }
                    if let sets = session.sets, !sets.isEmpty {
                        Section("Sets (\(sets.count))") {
                            ForEach(sets) { set in
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(set.exercise?.name ?? "Exercise \(set.exerciseId)")
                                        .font(.subheadline).bold()
                                    HStack(spacing: 8) {
                                        Text("\(set.reps) reps")
                                        Text(String(format: "%.1f kg", set.weightKg))
                                        if let rpe = set.rpe { Text("RPE \(String(format: "%.1f", rpe))") }
                                        if set.isWarmup == true { Text("warm-up").italic() }
                                    }
                                    .font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Session")
        .navigationBarTitleDisplayMode(.inline)
        .task { await vm.load(id: sessionId) }
    }
}
