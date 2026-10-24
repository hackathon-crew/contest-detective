import XCTest
import InkpawCore

final class PetRailGeometryTests: XCTestCase {
    func testPetCenterAndFilledTrackEndpointShareAllKnownProgressCoordinates() {
        for progress in [0.0, 0.25, 0.5, 0.75, 1.0] {
            let geometry = PetRailGeometry(width: 380, progressFraction: progress)
            XCTAssertEqual(geometry.petCenterX, geometry.trackStartX + geometry.filledTrackWidth, accuracy: 0.000_001)
            XCTAssertEqual(geometry.petOriginX + geometry.canvasWidth / 2, geometry.petCenterX, accuracy: 0.000_001)
            XCTAssertEqual(geometry.petCenterX, 70 + 240 * progress, accuracy: 0.000_001)
            XCTAssertTrue(geometry.showsTrack)
        }
    }

    func testUnknownAndNonfiniteProgressRemainNeutralWithoutAVisibleRail() {
        for progress: Double? in [nil, .nan, .infinity, -.infinity] {
            let geometry = PetRailGeometry(progressFraction: progress)
            XCTAssertNil(geometry.normalizedProgress)
            XCTAssertFalse(geometry.showsTrack)
            XCTAssertEqual(geometry.filledTrackWidth, 0)
            XCTAssertEqual(geometry.petCenterX, geometry.width / 2)
        }
    }

    func testFiniteProgressClampsToRealRailEndpoints() {
        XCTAssertEqual(PetRailGeometry(progressFraction: -10).petCenterX, 70)
        XCTAssertEqual(PetRailGeometry(progressFraction: 10).petCenterX, 310)
        XCTAssertEqual(PetRailGeometry(progressFraction: -10).normalizedProgress, 0)
        XCTAssertEqual(PetRailGeometry(progressFraction: 10).normalizedProgress, 1)
    }

    func testGroundAndCanvasRemainInsideTheFixedWidgetFootprint() {
        let geometry = PetRailGeometry(progressFraction: 0.5)
        XCTAssertEqual(geometry.canvasWidth, 140)
        XCTAssertEqual(geometry.canvasHeight, 140)
        XCTAssertEqual(geometry.canvasOriginY, 0)
        XCTAssertGreaterThan(geometry.groundY, geometry.canvasOriginY)
        XCTAssertLessThan(geometry.groundY, geometry.canvasOriginY + geometry.canvasHeight)
        XCTAssertEqual(geometry.trackStartX, 70)
        XCTAssertEqual(geometry.trackEndX, 310)
        for width in [Double.nan, .infinity, 0, -1, 139] {
            XCTAssertEqual(PetRailGeometry(width: width, progressFraction: 1).width, 380)
        }
        let wider = PetRailGeometry(width: 500, progressFraction: 0.25)
        XCTAssertEqual(wider.petCenterX, wider.trackStartX + wider.filledTrackWidth)
    }
}
