#if os(macOS)
import AppKit
import SwiftUI

/// Semantic Inkpaw tokens, shared by the native controls and RealityKit materials.
/// System typography uses SF with the platform's PingFang fallback for Chinese.
enum InkpawColors {
    static let canvas = Color(hex: 0xf5f5f5)
    static let surface = Color(hex: 0xffffff)
    static let surfaceMuted = Color(hex: 0xf7f7f7)
    static let surfaceStrong = Color(hex: 0xededed)
    static let ink = Color(hex: 0x111111)
    static let body = Color(hex: 0x303030)
    static let muted = Color(hex: 0x6c6c6c)
    static let faint = Color(hex: 0x969696)
    static let rule = Color(hex: 0xe3e3e3)
    static let accent = Color(hex: 0x3f5fd6)
    static let accentHover = Color(hex: 0x3550bd)
    static let accentSoft = Color(hex: 0xe9eefc)
    static let accentLine = Color(hex: 0xcdd7f7)
    static let danger = Color(hex: 0x98434b)

    static let skin = NSColor(hex: 0x5878e6)
    static let skinShadow = NSColor(hex: 0x2f49b8)
    static let skinHighlight = NSColor(hex: 0x8ea8f8)
    static let eye = NSColor(hex: 0x121a33)
    static let glint = NSColor(hex: 0xf4f7ff)
    static let beret = NSColor(hex: 0x1b1e27)
    static let bookCover = NSColor(hex: 0xb8503f)
    static let bookPage = NSColor(hex: 0xfbf6ef)
    static let bookLine = NSColor(hex: 0xb9ae9f)
    static let lens = NSColor(hex: 0xdbe6ff)
}

private extension Color {
    init(hex: UInt32) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xff) / 255, green: Double((hex >> 8) & 0xff) / 255, blue: Double(hex & 0xff) / 255, opacity: 1)
    }
}

private extension NSColor {
    convenience init(hex: UInt32) {
        self.init(srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: 1)
    }
}
#endif
