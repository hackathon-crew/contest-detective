import Foundation

/// One point-based coordinate system for the 140-point mascot canvas and time rail.
/// It is view geometry only: checklist completion never enters this calculation.
public struct PetRailGeometry: Equatable, Sendable {
    public let width: Double
    public let canvasWidth: Double = 140
    public let canvasHeight: Double = 140
    public let canvasOriginY: Double = 0
    /// Intended native ground baseline, to be checked against rendered shadow pixels.
    public let groundY: Double = 120
    public let normalizedProgress: Double?

    public init(width: Double = 380, progressFraction: Double?) {
        self.width = width.isFinite && width >= 140 ? width : 380
        self.normalizedProgress = progressFraction.flatMap { $0.isFinite ? min(1, max(0, $0)) : nil }
    }

    public var showsTrack: Bool { normalizedProgress != nil }
    public var trackStartX: Double { canvasWidth / 2 }
    public var trackEndX: Double { width - canvasWidth / 2 }
    public var trackWidth: Double { trackEndX - trackStartX }
    public var filledTrackWidth: Double { trackWidth * (normalizedProgress ?? 0) }
    /// Unknown progress is a centered neutral mascot, with no displayed rail or fill.
    public var petCenterX: Double { trackStartX + trackWidth * (normalizedProgress ?? 0.5) }
    public var petOriginX: Double { petCenterX - canvasWidth / 2 }
}
