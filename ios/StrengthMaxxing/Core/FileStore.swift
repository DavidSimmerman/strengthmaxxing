//
//  FileStore.swift
//  StrengthMaxxing (shared, PURE)
//
//  Tiny JSON-on-disk store (Application Support/<subdir>). Used for the offline outbox,
//  cached workouts/settings and per-exercise calibration. Writes are atomic.
//

import Foundation

final class FileStore: @unchecked Sendable {
    let directory: URL
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(directory: URL) {
        self.directory = directory
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    /// `<Application Support>/StrengthMaxxing/<subdirectory>`.
    static func applicationSupport(_ subdirectory: String) -> FileStore {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return FileStore(directory: base.appendingPathComponent("StrengthMaxxing", isDirectory: true)
            .appendingPathComponent(subdirectory, isDirectory: true))
    }

    func url(_ name: String) -> URL { directory.appendingPathComponent(name) }

    func data(_ name: String) -> Data? { try? Data(contentsOf: url(name)) }

    func write(_ data: Data, _ name: String) {
        do { try data.write(to: url(name), options: .atomic) }
        catch { print("FileStore write \(name) failed: \(error)") }
    }

    func remove(_ name: String) { try? FileManager.default.removeItem(at: url(name)) }

    func load<T: Decodable>(_ type: T.Type, _ name: String) -> T? {
        guard let d = data(name) else { return nil }
        return try? decoder.decode(T.self, from: d)
    }

    func save<T: Encodable>(_ value: T, _ name: String) {
        guard let d = try? encoder.encode(value) else { return }
        write(d, name)
    }
}
