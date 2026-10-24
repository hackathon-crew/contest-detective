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
    static let ruleStrong = Color(hex: 0xcccccc)
    static let noticeLine = Color(hex: 0xb8b8b8)
    static let accent = Color(hex: 0x3f5fd6)
    static let accentHover = Color(hex: 0x3550bd)
    static let accentSoft = Color(hex: 0xe9eefc)
    static let accentLine = Color(hex: 0xcdd7f7)
    static let danger = Color(hex: 0x98434b)
    static let dangerSoft = Color(hex: 0xf8edef)
    static let onAccent = Color(hex: 0xffffff)

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

/// Native point equivalents of frontend/src/shared/ui/site.css and index.css.
enum InkpawLayout {
    static let space: CGFloat = 4
    static let pagePadding: CGFloat = 24
    static let sectionGap: CGFloat = 24
    static let cardPadding: CGFloat = 24
    static let cardRadius: CGFloat = 16
    static let controlRadius: CGFloat = 12
    static let tagRadius: CGFloat = 8
    static let dialogRadius: CGFloat = 24
    static let sidebarWidth: CGFloat = 216
    static let contentMeasure: CGFloat = 960
}

enum InkpawType {
    static let pageTitle = Font.system(size: 28, weight: .semibold)
    static let section = Font.system(size: 20, weight: .semibold)
    static let cardTitle = Font.system(size: 16, weight: .semibold)
    static let body = Font.system(size: 14)
    static let control = Font.system(size: 14, weight: .medium)
    static let metadata = Font.system(size: 12)
    static let dialogTitle = Font.system(size: 22, weight: .semibold)
}

enum InkpawControlSize {
    case regular, compact, small
    var height: CGFloat {
        switch self { case .regular: return 40; case .compact: return 36; case .small: return 32 }
    }
    var horizontalPadding: CGFloat { self == .regular ? 16 : 12 }
    var font: Font { .system(size: self == .small ? 13 : 14, weight: .medium) }
}

enum InkpawButtonKind { case primary, secondary, ghost, danger }

/// Explicit flat chrome, rather than the OS's glossy bordered/button defaults.
/// The underlying Button keeps keyboard shortcuts, semantics, and activation behavior.
struct InkpawButtonStyle: ButtonStyle {
    var kind: InkpawButtonKind = .secondary
    var size: InkpawControlSize = .regular
    var iconOnly = false

    init(_ kind: InkpawButtonKind = .secondary, size: InkpawControlSize = .regular, iconOnly: Bool = false) {
        self.kind = kind; self.size = size; self.iconOnly = iconOnly
    }

    func makeBody(configuration: Configuration) -> some View {
        InkpawButtonChrome(configuration: configuration, kind: kind, size: size, iconOnly: iconOnly)
    }
}

private struct InkpawButtonChrome: View {
    let configuration: ButtonStyleConfiguration
    let kind: InkpawButtonKind
    let size: InkpawControlSize
    let iconOnly: Bool
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.isFocused) private var isFocused
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hovering = false

    private var emphasized: Bool { isEnabled && (hovering || configuration.isPressed) }
    private var fill: Color {
        guard isEnabled else { return kind == .primary ? InkpawColors.surfaceStrong : .clear }
        switch kind {
        case .primary: return emphasized ? InkpawColors.accentHover : InkpawColors.accent
        case .secondary: return InkpawColors.surface
        case .ghost: return emphasized ? InkpawColors.surfaceStrong : .clear
        case .danger: return emphasized ? InkpawColors.dangerSoft : .clear
        }
    }
    private var foreground: Color {
        guard isEnabled else { return InkpawColors.faint }
        switch kind {
        case .primary: return InkpawColors.onAccent
        case .secondary: return InkpawColors.accent
        case .ghost: return InkpawColors.body
        case .danger: return InkpawColors.danger
        }
    }
    private var border: Color {
        guard kind == .secondary else { return .clear }
        return !isEnabled ? InkpawColors.rule : emphasized ? InkpawColors.accent : InkpawColors.accentLine
    }

    var body: some View {
        configuration.label
            .font(size.font).lineLimit(1)
            .foregroundStyle(foreground)
            .padding(.horizontal, iconOnly ? 0 : size.horizontalPadding)
            .frame(width: iconOnly ? size.height : nil, height: size.height)
            .background(fill, in: RoundedRectangle(cornerRadius: InkpawLayout.controlRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: InkpawLayout.controlRadius, style: .continuous).stroke(border, lineWidth: 1))
            .overlay {
                if isFocused && isEnabled {
                    RoundedRectangle(cornerRadius: InkpawLayout.controlRadius + 2, style: .continuous)
                        .stroke(InkpawColors.accent, lineWidth: 2).padding(-3)
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: InkpawLayout.controlRadius, style: .continuous))
            .scaleEffect(configuration.isPressed && isEnabled && !reduceMotion ? 0.98 : 1)
            .onHover { hovering = $0 }
            .animation(reduceMotion ? nil : .easeOut(duration: 0.14), value: hovering)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.14), value: configuration.isPressed)
    }
}

struct InkpawNavigationStyle: ButtonStyle {
    let isSelected: Bool
    func makeBody(configuration: Configuration) -> some View {
        InkpawNavigationChrome(configuration: configuration, isSelected: isSelected)
    }
}

private struct InkpawNavigationChrome: View {
    let configuration: ButtonStyleConfiguration
    let isSelected: Bool
    @Environment(\.isFocused) private var isFocused
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hovering = false
    var body: some View {
        configuration.label.padding(.horizontal, 12).frame(height: 40)
            .foregroundStyle(isSelected ? InkpawColors.accent : InkpawColors.body)
            .background(isSelected ? InkpawColors.accentSoft : hovering || configuration.isPressed ? InkpawColors.surfaceStrong : .clear,
                        in: RoundedRectangle(cornerRadius: InkpawLayout.controlRadius, style: .continuous))
            .overlay {
                if isFocused { RoundedRectangle(cornerRadius: InkpawLayout.controlRadius).stroke(InkpawColors.accent, lineWidth: 2).padding(-3) }
            }
            .contentShape(RoundedRectangle(cornerRadius: InkpawLayout.controlRadius))
            .onHover { hovering = $0 }
            .animation(reduceMotion ? nil : .easeOut(duration: 0.14), value: hovering)
    }
}

struct InkpawTextFieldStyle: TextFieldStyle {
    var minimumHeight: CGFloat = 40
    func _body(configuration: TextField<_Label>) -> some View {
        InkpawTextFieldBody(content: configuration.textFieldStyle(.plain), minimumHeight: minimumHeight)
    }
}

private struct InkpawTextFieldBody<Content: View>: View {
    let content: Content
    let minimumHeight: CGFloat
    @FocusState private var isFocused: Bool
    @Environment(\.isEnabled) private var isEnabled
    var body: some View {
        content.focused($isFocused).font(InkpawType.body)
            .padding(.horizontal, 12).padding(.vertical, 10)
            .frame(minHeight: minimumHeight, alignment: .topLeading)
            .background(isEnabled ? InkpawColors.surface : InkpawColors.surfaceMuted,
                        in: RoundedRectangle(cornerRadius: InkpawLayout.controlRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: InkpawLayout.controlRadius, style: .continuous)
                .stroke(isFocused ? InkpawColors.accent : InkpawColors.ruleStrong, lineWidth: isFocused ? 2 : 1))
    }
}

struct InkpawFieldLabel: View {
    let title: String
    init(_ title: String) { self.title = title }
    var body: some View { Text(title).font(.system(size: 13, weight: .medium)).foregroundStyle(InkpawColors.body) }
}

struct InkpawTag: View {
    let title: String
    var accented = false
    var body: some View {
        Text(title).font(.system(size: 12, weight: .medium))
            .foregroundStyle(accented ? InkpawColors.accent : InkpawColors.muted)
            .padding(.horizontal, 8).frame(minHeight: 24)
            .background(accented ? InkpawColors.accentSoft : InkpawColors.surfaceMuted,
                        in: RoundedRectangle(cornerRadius: InkpawLayout.tagRadius))
    }
}

struct InkpawProgressTrack: View {
    let value: Double
    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule().fill(InkpawColors.surfaceStrong)
                Capsule().fill(InkpawColors.accent).frame(width: geometry.size.width * min(1, max(0, value)))
            }
        }.frame(height: 6).accessibilityLabel("进度").accessibilityValue("\(Int(min(1, max(0, value)) * 100))%")
    }
}

/// CSS shadow blur32 is approximated by native Gaussian radius16, without changing layout.
struct InkpawPrincipalShadow: ViewModifier {
    func body(content: Content) -> some View {
        content.shadow(color: InkpawColors.ink.opacity(0.04), radius: 1, x: 0, y: 1)
            .shadow(color: InkpawColors.ink.opacity(0.06), radius: 16, x: 0, y: 12)
    }
}

struct InkpawDialogChrome: ViewModifier {
    func body(content: Content) -> some View {
        content.padding(24)
            .background(InkpawColors.surface, in: RoundedRectangle(cornerRadius: InkpawLayout.dialogRadius, style: .continuous))
            .foregroundStyle(InkpawColors.ink)
            .font(InkpawType.body).lineSpacing(4)
            .buttonStyle(InkpawButtonStyle())
            .textFieldStyle(InkpawTextFieldStyle())
            .preferredColorScheme(.light)
    }
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
