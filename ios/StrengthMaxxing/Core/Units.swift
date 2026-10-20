//
//  Units.swift
//  StrengthMaxxing (shared, PURE)
//
//  Weight units at the edge. Storage, the API and all math stay in kg; the UI shows lb
//  (default) or kg. Steppers step in DISPLAY units and snap to the step grid, so 225 lb
//  stays 225 (not 224.9) and +5 gives 230.
//

import Foundation

enum WeightUnit: String, Codable, CaseIterable, Sendable {
    case lb, kg
    var symbol: String { rawValue }
}

enum Units {
    static let kgPerLb = 0.45359237

    static func toDisplay(kg: Double, unit: WeightUnit) -> Double {
        unit == .lb ? kg / kgPerLb : kg
    }

    static func toKg(_ value: Double, unit: WeightUnit) -> Double {
        unit == .lb ? value * kgPerLb : value
    }

    /// Display value rounded for humans: lb to the nearest 0.5, kg to the nearest 0.05.
    static func displayRounded(kg: Double, unit: WeightUnit) -> Double {
        let v = toDisplay(kg: kg, unit: unit)
        let q = unit == .lb ? 0.5 : 0.05
        return (v / q).rounded() * q
    }

    /// "225", "227.5", "61.25" — no trailing zeros. Appends the unit symbol by default.
    static func format(kg: Double, unit: WeightUnit, withUnit: Bool = true) -> String {
        let number = formatNumber(displayRounded(kg: kg, unit: unit))
        return withUnit ? "\(number) \(unit.symbol)" : number
    }

    static func formatNumber(_ v: Double) -> String {
        if abs(v - v.rounded()) < 1e-6 { return String(Int(v.rounded())) }
        var s = String(format: "%.2f", v)
        while s.hasSuffix("0") { s.removeLast() }
        if s.hasSuffix(".") { s.removeLast() }
        return s
    }

    /// Stepper increment in display units for an exercise category
    /// (`barbell | dumbbell | machine | bodyweight | cable`).
    static func step(category: String?, unit: WeightUnit) -> Double {
        let cat = (category ?? "").lowercased()
        switch unit {
        case .lb:
            return (cat == "dumbbell" || cat == "bodyweight") ? 2.5 : 5
        case .kg:
            if cat == "dumbbell" { return 2 }
            if cat == "bodyweight" { return 1 }
            return 2.5
        }
    }

    /// One stepper press. Snaps to the step grid in display units: from 220.46 lb (100 kg)
    /// "+" goes to 225 and "−" to 220. Never below 0. Returns kg.
    static func stepped(kg: Double, direction: Int, category: String?, unit: WeightUnit) -> Double {
        let s = step(category: category, unit: unit)
        let k = toDisplay(kg: kg, unit: unit) / s
        let n: Double
        if direction >= 0 {
            n = (k + 1e-6).rounded(.down) + 1
        } else {
            n = (k - 1e-6).rounded(.up) - 1
        }
        return toKg(max(0, n * s), unit: unit)
    }

    /// Parses user-typed display text ("225", "102,5") to kg. Nil if not a number.
    static func parse(_ text: String, unit: WeightUnit) -> Double? {
        let cleaned = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        guard let v = Double(cleaned), v >= 0 else { return nil }
        return toKg(v, unit: unit)
    }
}
