import Foundation
import XCTest
@testable import InkpawCore

final class OctopusPoseTests: XCTestCase {
    func testAllMoodsKeepEightSeparateRoundedArmsAndFiniteBoundedGeometry() {
        for mood in OctopusMood.allCases {
            for time in stride(from: 0.0, through: 24.0, by: 0.25) {
                let pose = OctopusPoseModel.pose(mood: mood, time: time, reduceMotion: false)
                XCTAssertEqual(pose.arms.count, 8)
                var roots = Set<String>()
                for arm in pose.arms {
                    XCTAssertEqual(arm.points.count, OctopusPoseModel.segmentCount + 1)
                    XCTAssertEqual(arm.radii.count, arm.points.count)
                    roots.insert(String(describing: arm.points[0]))
                    for (point, radius) in zip(arm.points, arm.radii) {
                        for value in [point.x, point.y, point.z, radius] { XCTAssertTrue(value.isFinite) }
                        XCTAssertGreaterThan(radius, 0)
                        XCTAssertLessThan(radius, 0.1)
                        XCTAssertLessThan(abs(point.x) + radius, 0.65)
                        XCTAssertLessThan(abs(point.y) + radius, 0.65)
                        XCTAssertLessThan(abs(point.z) + radius, 0.65)
                    }
                    XCTAssertGreaterThan(arm.radii.first!, arm.radii.last!)
                }
                XCTAssertEqual(roots.count, 8)
            }
        }
    }

    func testExplicitCameraFrustumContainsAnimatedArmsHeadAndProps() {
        let camera = OctopusPoseModel.cameraPosition
        let target = OctopusPoseModel.cameraTarget
        let dy = camera.y - target.y
        let dz = camera.z - target.z
        let distance = sqrt(dy * dy + dz * dz)
        let up = SIMD3<Float>(0, dz / distance, -dy / distance)
        let halfSpan = OctopusPoseModel.verticalSpan / 2
        for mood in OctopusMood.allCases {
            for time in stride(from: 0.0, through: 12.0, by: 0.25) {
                let pose = OctopusPoseModel.pose(mood: mood, time: time, reduceMotion: false)
                var bounds: [(SIMD3<Float>, Float)] = [([0, 0.24, 0], 0.32), ([0.02, 0.48, -0.01], 0.27)]
                for arm in pose.arms { bounds += Array(zip(arm.points, arm.radii)) }
                if pose.magnifier.isVisible {
                    bounds.append((pose.magnifier.position, 0.02))
                    bounds.append((pose.magnifier.transform([0, 0.153, 0]), 0.075))
                }
                if pose.book.isVisible {
                    for side: Float in [-1, 1] {
                        for height: Float in [0, 0.2] {
                            let corner = OctopusPoseModel.rotated([side * 0.15, height, 0.008], by: [0, side * 0.24, 0])
                            bounds.append((pose.book.transform(corner), 0.015))
                        }
                    }
                }
                for (center, radius) in bounds {
                    let world = OctopusPoseModel.rotated(center, by: pose.bodyRotation) + pose.bodyPosition - target
                    let vertical = world.y * up.y + world.z * up.z
                    XCTAssertLessThan(abs(world.x) + radius, halfSpan, "Horizontal camera clipping in \(mood) at \(time)")
                    XCTAssertLessThan(abs(vertical) + radius, halfSpan, "Vertical camera clipping in \(mood) at \(time)")
                }
            }
        }
    }

    func testReducedMotionIsStaticAndDoesNotBlink() {
        for mood in OctopusMood.allCases {
            let still = OctopusPoseModel.pose(mood: mood, time: 0, reduceMotion: true)
            for time in [1.0, 4.6, 7.5, 8.8, 100.0] {
                XCTAssertEqual(still, OctopusPoseModel.pose(mood: mood, time: time, reduceMotion: true))
            }
            XCTAssertEqual(still.eyeScaleY, 1)
            XCTAssertEqual(still.bodyPosition, .zero)
            XCTAssertEqual(still.headScale, SIMD3<Float>(repeating: 1))
        }
    }

    func testSearchArmTipMeetsMagnifierHandleThroughoutCycle() {
        for time in stride(from: 0.0, through: 12.0, by: 0.2) {
            let pose = OctopusPoseModel.pose(mood: .search, time: time, reduceMotion: false)
            XCTAssertTrue(pose.magnifier.isVisible)
            XCTAssertFalse(pose.book.isVisible)
            assertVector(pose.arms[0].points.last!, equals: pose.magnifier.position)
        }
    }

    func testReadArmsMeetBothBookCornersAfterLeafAndBookTransforms() {
        for time in stride(from: 0.0, through: 12.0, by: 0.2) {
            let pose = OctopusPoseModel.pose(mood: .read, time: time, reduceMotion: false)
            XCTAssertTrue(pose.book.isVisible)
            XCTAssertFalse(pose.magnifier.isVisible)
            for (index, side): (Int, Float) in [(0, 1), (7, -1)] {
                let leaf = OctopusPoseModel.rotated([side * 0.15 * 0.86, 0.025, 0.008], by: [0, side * 0.24, 0])
                assertVector(pose.arms[index].points.last!, equals: pose.book.transform(leaf))
            }
        }
    }

    func testIdleThinkHappyHaveNoPropsAndAnimationActuallyChangesGeometry() {
        for mood in [OctopusMood.idle, .think, .happy] {
            let first = OctopusPoseModel.pose(mood: mood, time: 0, reduceMotion: false)
            let later = OctopusPoseModel.pose(mood: mood, time: 1, reduceMotion: false)
            XCTAssertFalse(first.book.isVisible)
            XCTAssertFalse(first.magnifier.isVisible)
            XCTAssertNotEqual(first.arms, later.arms)
        }
    }

    func testInvalidTimeFallsBackToFiniteInitialPose() {
        let initial = OctopusPoseModel.pose(mood: .idle, time: 0, reduceMotion: false)
        for time in [Double.nan, .infinity, -.infinity, -1] {
            XCTAssertEqual(OctopusPoseModel.pose(mood: .idle, time: time, reduceMotion: false), initial)
        }
    }

    private func assertVector(_ actual: SIMD3<Float>, equals expected: SIMD3<Float>, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(actual.x, expected.x, accuracy: 0.000_001, file: file, line: line)
        XCTAssertEqual(actual.y, expected.y, accuracy: 0.000_001, file: file, line: line)
        XCTAssertEqual(actual.z, expected.z, accuracy: 0.000_001, file: file, line: line)
    }
}
