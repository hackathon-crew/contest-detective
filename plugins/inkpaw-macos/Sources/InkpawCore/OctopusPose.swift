import Foundation

/// Inkpaw's own mascot poses. No imported mesh, image, or third-party character asset.
public enum OctopusMood: String, CaseIterable, Codable, Sendable {
    case idle, search, read, think, happy
}

public struct OctopusPropPose: Equatable, Sendable {
    public let position: SIMD3<Float>
    public let rotation: SIMD3<Float>
    public let isVisible: Bool

    /// The renderer applies these same X, Y, Z rotations, in that order.
    public func transform(_ point: SIMD3<Float>) -> SIMD3<Float> {
        OctopusPoseModel.rotated(point, by: rotation) + position
    }
}

public struct OctopusArmPose: Equatable, Sendable {
    public let points: [SIMD3<Float>]
    public let radii: [Float]
}

public struct OctopusPose: Equatable, Sendable {
    public let arms: [OctopusArmPose]
    public let book: OctopusPropPose
    public let magnifier: OctopusPropPose
    public let bodyPosition: SIMD3<Float>
    public let bodyRotation: SIMD3<Float>
    public let headScale: SIMD3<Float>
    public let eyeScaleY: Float
    public let gaze: SIMD2<Float>
}

/// Deterministic native translation of this repository's Inkpaw centerline math.
/// A single pose drives every arm and its held prop, preventing detached grips.
public enum OctopusPoseModel {
    public static let armCount = 8
    public static let segmentCount = 22
    public static let cameraPosition = SIMD3<Float>(0, 0.78, 2.2)
    public static let cameraTarget = SIMD3<Float>(0, 0.16, 0)
    public static let verticalSpan: Float = 1.35
    public static let bookLeafWidth: Float = 0.15
    public static let bookLeafAngle: Float = 0.24
    public static let lensRadius: Float = 0.058
    public static let handleLength: Float = 0.095

    public static func pose(mood: OctopusMood, time: TimeInterval, reduceMotion: Bool) -> OctopusPose {
        let t: Float = reduceMotion || !time.isFinite ? 0 : Float(max(0, time).truncatingRemainder(dividingBy: 3_600))
        let coefficients = Coefficients(mood)
        let cycle = t.truncatingRemainder(dividingBy: 12)
        let peek: Float = mood == .read ? envelope(cycle, start: 8, rise: 0.6, hold: 1.4, fall: 0.7) : 0
        let peer: Float = mood == .search ? envelope(cycle, start: 7, rise: 0.7, hold: 1.4, fall: 0.7) : 0
        let book = OctopusPropPose(
            position: [0, -0.07 - 0.06 * peek + 0.005 * sin(t * 1.6), 0.42],
            rotation: [0.22 + 0.03 * sin(t * 0.9), 0, 0.03 * sin(t * 0.7)],
            isVisible: mood == .read
        )
        let lens = mix(
            SIMD3<Float>(0.11 + 0.2 * sin(t * 0.55), 0.12 + 0.1 * sin(t * 0.83 + 1), 0.46 + 0.04 * sin(t * 0.4)),
            SIMD3<Float>(0.092, 0.19, 0.37), peer
        )
        let magnifierAngle: Float = 0.5 + 0.15 * sin(t * 0.9) - 0.2 * peer
        let magnifierDirection = SIMD3<Float>(-sin(magnifierAngle), cos(magnifierAngle), 0)
        let magnifier = OctopusPropPose(
            position: lens - magnifierDirection * (handleLength + lensRadius),
            rotation: [0, 0, magnifierAngle],
            isVisible: mood == .search
        )
        let hatWeight: Float = mood == .idle ? envelope(cycle, start: 6, rise: 0.7, hold: 0.8, fall: 0.7) : 0

        let arms = (0..<armCount).map { index -> OctopusArmPose in
            var grip: Grip?
            if mood == .read && (index == 0 || index == 7) {
                let side: Float = index == 0 ? 1 : -1
                let leafPoint = rotated(
                    SIMD3<Float>(side * bookLeafWidth * 0.86, 0.025, 0.008),
                    by: [0, side * bookLeafAngle, 0]
                )
                grip = Grip(at: book.transform(leafPoint), direction: normalized([side * 0.4, 0.5, 0.75]), weight: 1)
            } else if mood == .search && index == 0 {
                grip = Grip(at: magnifier.position, direction: magnifierDirection, weight: 1)
            } else if index == 6 && hatWeight > 0 {
                grip = Grip(at: [-0.27, 0.43, 0.03], direction: normalized([0.25, 1, -0.05]), weight: hatWeight)
            }
            return arm(index: index, time: t, coefficients: coefficients, grip: grip)
        }

        var yaw: Float = 0.14 * sin(t * 0.23)
        var pitch: Float = 0.03 * sin(t * 0.31)
        var gaze = SIMD2<Float>(0.15 * sin(t * 0.4), 0)
        if mood == .read {
            let line = (t * 0.45).truncatingRemainder(dividingBy: 1)
            let sweep = line < 0.85 ? smooth(line / 0.85) : 1 - smooth((line - 0.85) / 0.15)
            yaw = (0.1 * sweep - 0.05) * (1 - peek)
            pitch = 0.14 * (1 - peek) - 0.04 * peek
            gaze = [(sweep - 0.5) * (1 - peek), -0.8 * (1 - peek) + 0.2 * peek]
        } else if mood == .search {
            yaw = 0.8 * (lens.x - 0.05) * (1 - peer)
            pitch = -0.5 * (lens.y - 0.15) * (1 - peer)
            gaze = [3 * (lens.x - 0.05) * (1 - peer), 3 * (lens.y - 0.15) * (1 - peer)]
        } else if mood == .think {
            gaze = [0.7, 0.8]
        }
        let breathe: Float = 1 + (reduceMotion ? 0 : 0.025 * sin(t * 1.6))
        let blinkPhase = t.truncatingRemainder(dividingBy: 4.7)
        return OctopusPose(
            arms: arms, book: book, magnifier: magnifier,
            bodyPosition: [0, reduceMotion ? 0 : coefficients.bob * sin(t * 1.25), 0],
            bodyRotation: [pitch, yaw, 0],
            headScale: [breathe, 1 / sqrt(breathe), breathe],
            eyeScaleY: !reduceMotion && blinkPhase > 4.54 ? 0.12 : 1,
            gaze: gaze
        )
    }

    private struct Grip {
        let at: SIMD3<Float>
        let direction: SIMD3<Float>
        let weight: Float
    }

    private struct Coefficients {
        let amplitude: Float
        let speed: Float
        let curl: Float
        let sway: Float
        let dip: Float
        let bob: Float

        init(_ mood: OctopusMood) {
            switch mood {
            case .idle: (amplitude, speed, curl, sway, dip, bob) = (0.6, 1.5, 1.55, 0.24, -0.82, 0.024)
            case .search: (amplitude, speed, curl, sway, dip, bob) = (0.45, 1.3, 1.5, 0.2, -0.82, 0.018)
            case .read: (amplitude, speed, curl, sway, dip, bob) = (0.35, 1.1, 1.55, 0.16, -0.82, 0.012)
            case .think: (amplitude, speed, curl, sway, dip, bob) = (0.35, 3.6, 2.3, 0.12, -0.95, 0.014)
            case .happy: (amplitude, speed, curl, sway, dip, bob) = (1.1, 4.2, 1, 0.35, -0.5, 0.05)
            }
        }
    }

    private static func arm(index: Int, time: Float, coefficients c: Coefficients, grip: Grip?) -> OctopusArmPose {
        let angle = (Float(index) + 0.5) / Float(armCount) * .pi * 2
        let phase = Float(index) * 1.37 + Float(index % 2) * 0.9
        let length: Float = 0.34 + 0.02 * sin(Float(index) * 2.1)
        let step = length / Float(segmentCount)
        var theta = c.dip * 0.5
        var point = SIMD3<Float>(sin(angle) * 0.17, 0.06, cos(angle) * 0.17)
        var points: [SIMD3<Float>] = []
        var radii: [Float] = []
        let root = point
        let outward = SIMD3<Float>(sin(angle), 0, cos(angle))
        for segment in 0...segmentCount {
            let s = Float(segment) / Float(segmentCount)
            let a = angle + c.sway * s * sin(c.speed * 0.7 * time + phase * 1.7 + 3 * s)
            let direction = SIMD3<Float>(sin(a) * cos(theta), sin(theta), cos(a) * cos(theta))
            var sample = point
            if let grip {
                let u = 1 - s
                let c1 = root + outward * 0.12 + SIMD3<Float>(0, -0.02, 0)
                let c2 = grip.at - grip.direction * 0.12
                let curve = root * (u * u * u) + c1 * (3 * u * u * s) + c2 * (3 * u * s * s) + grip.at * (s * s * s)
                sample = mix(sample, curve, grip.weight)
            }
            points.append(sample)
            radii.append((0.06 * sqrt(max(0, 1 - s)) + 0.026) * (1 - 0.22 * (grip?.weight ?? 0)))
            theta += 0.45 * (c.curl * pow(s, 1.3) * 5.2 + c.amplitude * (0.35 + s) * sin(c.speed * time - 5.5 * s + phase)) * step
            point += direction * step
        }
        return OctopusArmPose(points: points, radii: radii)
    }

    static func rotated(_ point: SIMD3<Float>, by angles: SIMD3<Float>) -> SIMD3<Float> {
        let x = SIMD3<Float>(point.x, point.y * cos(angles.x) - point.z * sin(angles.x), point.y * sin(angles.x) + point.z * cos(angles.x))
        let y = SIMD3<Float>(x.x * cos(angles.y) + x.z * sin(angles.y), x.y, -x.x * sin(angles.y) + x.z * cos(angles.y))
        return [y.x * cos(angles.z) - y.y * sin(angles.z), y.x * sin(angles.z) + y.y * cos(angles.z), y.z]
    }

    private static func normalized(_ vector: SIMD3<Float>) -> SIMD3<Float> {
        vector / max(0.000_001, sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z))
    }

    private static func mix(_ a: SIMD3<Float>, _ b: SIMD3<Float>, _ weight: Float) -> SIMD3<Float> {
        a + (b - a) * weight
    }

    private static func smooth(_ value: Float) -> Float {
        let x = min(1, max(0, value))
        return x * x * x * (x * (6 * x - 15) + 10)
    }

    private static func envelope(_ time: Float, start: Float, rise: Float, hold: Float, fall: Float) -> Float {
        smooth((time - start) / rise) * (1 - smooth((time - start - rise - hold) / fall))
    }
}
