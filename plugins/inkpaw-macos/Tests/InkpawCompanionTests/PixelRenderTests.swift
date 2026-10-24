import XCTest
#if os(macOS)
import AppKit
import Metal
import RealityKit
import simd
@testable import InkpawCompanion

@MainActor
final class PixelRenderTests: XCTestCase {
    func testLogicalCellSizeDoesNotShrinkOnRetina() {
        let standard = InkpawPixelGrid(outputWidth: 140, outputHeight: 140, logicalWidth: 140, logicalHeight: 140)
        let retina = InkpawPixelGrid(outputWidth: 280, outputHeight: 280, logicalWidth: 140, logicalHeight: 140)
        XCTAssertEqual(standard.width, 70)
        XCTAssertEqual(retina.width, 70)
        XCTAssertEqual(standard.scale, 2)
        XCTAssertEqual(retina.scale, 4)
        let larger = InkpawPixelGrid(outputWidth: 720, outputHeight: 720, logicalWidth: 360, logicalHeight: 360)
        XCTAssertEqual(larger.width, 120)
        XCTAssertEqual(larger.scale, 6)
    }

    func testGridUsesIntegerReplicationAndOnlySmallCenteredGutters() {
        for width in [1, 3, 139, 140, 141, 280, 281, 720] {
            let grid = InkpawPixelGrid(outputWidth: width, outputHeight: width + 3, logicalWidth: Double(width) / 2, logicalHeight: Double(width + 3) / 2)
            XCTAssertGreaterThanOrEqual(grid.scale, 1)
            XCTAssertGreaterThanOrEqual(grid.width, 1)
            XCTAssertGreaterThanOrEqual(grid.height, 1)
            XCTAssertLessThanOrEqual(grid.width * grid.scale + grid.offsetX, width)
            XCTAssertLessThanOrEqual(grid.height * grid.scale + grid.offsetY, width + 3)
            XCTAssertLessThan(width - grid.width * grid.scale, grid.scale)
            XCTAssertLessThan(width + 3 - grid.height * grid.scale, grid.scale)
        }
    }

    func testLiveMetalPipelineProducesHardAlphaOutlineAndConstantPixelBlocks() throws {
        let frame = try render { x, y in
            (x >= 8 && x < 20 && y >= 8 && y < 20) ? SIMD4<Float>(0.1, 0.2, 0.75, 1) : .zero
        }
        XCTAssertEqual(frame.diagnostics["activePipeline"] as? Bool, true, frame.diagnostics.description)
        XCTAssertEqual(frame.diagnostics["failureReason"] as? String, "")
        XCTAssertEqual(frame.diagnostics["completedFrameCount"] as? Int, 1)
        XCTAssertEqual(frame.diagnostics["lowResolutionWidth"] as? Int, 7)
        XCTAssertEqual(frame.diagnostics["integerScale"] as? Int, 4)
        var alphas = Set<UInt8>()
        var nontransparentBlocks = 0
        var outlineBlocks = 0
        for y in stride(from: 0, to: 28, by: 4) {
            for x in stride(from: 0, to: 28, by: 4) {
                let first = pixel(frame.bytes, x, y)
                alphas.insert(first[3])
                if first[3] > 0 { nontransparentBlocks += 1 }
                if Array(first.prefix(3)) == [16, 23, 53] && first[3] == 255 { outlineBlocks += 1 }
                for dy in 0..<4 { for dx in 0..<4 {
                    XCTAssertEqual(pixel(frame.bytes, x + dx, y + dy), first, "Nearest-upscaled cell is not constant")
                } }
            }
        }
        XCTAssertTrue(alphas.contains(0))
        XCTAssertTrue(alphas.contains(255))
        XCTAssertTrue(alphas.isSubset(of: [0, 82, 255]), "Unexpected antialias/interpolation alpha: \(alphas)")
        XCTAssertGreaterThan(nontransparentBlocks, 10)
        XCTAssertGreaterThan(outlineBlocks, 4)
    }

    func testStippledShadowUsesDistinctTransparentCellsBelowAndRight() throws {
        let frame = try render { x, y in
            (x >= 4 && x < 12 && y < 4) ? SIMD4<Float>(0.1, 0.2, 0.75, 1) : .zero
        }
        XCTAssertEqual(pixel(frame.bytes, 20, 20)[3], 82, "Original 0.32-alpha stippled shadow is missing")
        XCTAssertEqual(pixel(frame.bytes, 16, 20)[3], 0, "Alternating shadow cell must remain transparent")
        XCTAssertLessThan(pixel(frame.bytes, 20, 20)[0], 10, "Shadow must remain dark, not an opaque duplicate mascot")
    }

    func testSRGBAndXRTargetsReceiveLinearOutputExactlyOnce() {
        for format in [MTLPixelFormat.rgba8Unorm_srgb, .bgra8Unorm_srgb, .bgra10_xr_srgb, .bgr10_xr_srgb, .rgba16Float, .rgba32Float] {
            XCTAssertTrue(InkpawPixelRenderer.requiresLinearOutput(format))
        }
        XCTAssertFalse(InkpawPixelRenderer.requiresLinearOutput(.bgra8Unorm))
        XCTAssertFalse(InkpawPixelRenderer.requiresLinearOutput(.rgba8Unorm))
    }

    func testPaletteIsDiscreteAndBayerPatternIsLowResolution() throws {
        // This source brightness straddles the original blue mid/high transition.
        let source = SIMD4<Float>(linear(0.44), linear(0.565), linear(0.94), 1)
        let frame = try render { _, _ in source }
        let allowed: Set<String> = ["47,73,184", "88,120,230", "142,168,248"]
        var colors = Set<String>()
        for y in stride(from: 0, to: 28, by: 4) { for x in stride(from: 0, to: 28, by: 4) {
            let p = pixel(frame.bytes, x, y)
            colors.insert("\(p[0]),\(p[1]),\(p[2])")
        } }
        XCTAssertTrue(colors.isSubset(of: allowed), "Unexpected smooth colors: \(colors)")
        XCTAssertGreaterThan(colors.count, 1, "Ordered dithering should use both neighboring blue tones")
    }

    func testDepthContoursRespectReverseAndForwardOrthographicDepth() throws {
        for reverse in [false, true] {
            let frame = try render(reverse: reverse, depth: { x, _ in
                x < 12 ? (reverse ? 0.8 : 0.2) : 0.5
            }, color: { _, _ in SIMD4<Float>(0.1, 0.2, 0.75, 1) })
            XCTAssertEqual(Array(pixel(frame.bytes, 12, 12).prefix(3)), [16, 23, 53])
            XCTAssertNotEqual(Array(pixel(frame.bytes, 8, 12).prefix(3)), [16, 23, 53], "Only the rear surface receives the depth contour")
        }
    }

    func testInvalidShaderFailsExplicitlyAndClearsIncompatibleTarget() throws {
        let frame = try render(shaderSource: "deliberately_invalid_metal();", color: { _, _ in SIMD4<Float>(1, 0, 0, 1) })
        XCTAssertEqual(frame.diagnostics["activePipeline"] as? Bool, false)
        XCTAssertFalse((frame.diagnostics["failureReason"] as? String ?? "").isEmpty)
        XCTAssertTrue(frame.bytes.allSatisfy { $0 == 0 }, "Incompatible fallback target must be safely transparent")
    }

    func testFallbackBlitRequiresMatchingFormatsAndDimensions() throws {
        guard let device = MTLCreateSystemDefaultDevice() else { throw XCTSkip("Metal is required.") }
        func texture(_ format: MTLPixelFormat, width: Int = 4) throws -> any MTLTexture {
            let descriptor = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: format, width: width, height: 4, mipmapped: false)
            return try XCTUnwrap(device.makeTexture(descriptor: descriptor))
        }
        let source = try texture(.rgba8Unorm)
        XCTAssertTrue(InkpawPixelRenderer.canBlitUnmodified(source: source, target: try texture(.rgba8Unorm)))
        XCTAssertFalse(InkpawPixelRenderer.canBlitUnmodified(source: source, target: try texture(.bgra8Unorm)))
        XCTAssertFalse(InkpawPixelRenderer.canBlitUnmodified(source: source, target: try texture(.rgba8Unorm, width: 8)))
    }

    func testConsecutiveGPUFramesUseCurrentSourceRatherThanCachedImage() throws {
        let first = try render { x, y in x >= 8 && x < 16 && y >= 8 && y < 20 ? SIMD4<Float>(0.1, 0.2, 0.75, 1) : .zero }
        let second = try render { x, y in x >= 12 && x < 20 && y >= 8 && y < 20 ? SIMD4<Float>(0.1, 0.2, 0.75, 1) : .zero }
        XCTAssertNotEqual(first.bytes, second.bytes)
    }

    private struct Frame {
        let bytes: [UInt8]
        let diagnostics: [String: Any]
    }

    private func render(
        reverse: Bool = true,
        shaderSource: String = InkpawPixelRenderer.metalSource,
        depth: (Int, Int) -> Float = { _, _ in 0.5 },
        color: (Int, Int) -> SIMD4<Float>
    ) throws -> Frame {
        guard let device = MTLCreateSystemDefaultDevice() else { throw XCTSkip("A real Metal device is required for native pixel-render tests.") }
        let queue = try XCTUnwrap(device.makeCommandQueue())
        let buffer = try XCTUnwrap(queue.makeCommandBuffer())
        func texture(_ format: MTLPixelFormat, renderTarget: Bool = false) throws -> any MTLTexture {
            let descriptor = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: format, width: 28, height: 28, mipmapped: false)
            descriptor.usage = [.shaderRead, .shaderWrite, .pixelFormatView]
            if renderTarget { descriptor.usage.insert(.renderTarget) }
            descriptor.storageMode = .shared
            return try XCTUnwrap(device.makeTexture(descriptor: descriptor))
        }
        let input = try texture(.rgba32Float)
        let depths = try texture(.r32Float)
        let output = try texture(.rgba8Unorm, renderTarget: true)
        var colors: [SIMD4<Float>] = []
        var depthValues: [Float] = []
        for y in 0..<28 { for x in 0..<28 { colors.append(color(x, y)); depthValues.append(depth(x, y)) } }
        colors.withUnsafeBytes { bytes in
            input.replace(region: MTLRegionMake2D(0, 0, 28, 28), mipmapLevel: 0, withBytes: bytes.baseAddress!, bytesPerRow: 28 * MemoryLayout<SIMD4<Float>>.stride)
        }
        depthValues.withUnsafeBytes { bytes in
            depths.replace(region: MTLRegionMake2D(0, 0, 28, 28), mipmapLevel: 0, withBytes: bytes.baseAddress!, bytesPerRow: 28 * MemoryLayout<Float>.stride)
        }
        var projection = matrix_identity_float4x4
        projection.columns.2.z = reverse ? 1 : -1
        let renderer = InkpawPixelRenderer(shaderSource: shaderSource)
        renderer.setLogicalSize(CGSize(width: 14, height: 14))
        renderer.process(ARView.PostProcessContext(device, buffer, input, depths, output, projection, 0))
        buffer.commit()
        buffer.waitUntilCompleted()
        XCTAssertEqual(buffer.status, .completed, buffer.error?.localizedDescription ?? "GPU command failed")
        var pixels = [UInt8](repeating: 0, count: 28 * 28 * 4)
        pixels.withUnsafeMutableBytes { bytes in
            output.getBytes(bytes.baseAddress!, bytesPerRow: 28 * 4, from: MTLRegionMake2D(0, 0, 28, 28), mipmapLevel: 0)
        }
        return Frame(bytes: pixels, diagnostics: renderer.diagnostics)
    }

    private func pixel(_ bytes: [UInt8], _ x: Int, _ y: Int) -> [UInt8] {
        Array(bytes[((y * 28 + x) * 4)..<((y * 28 + x) * 4 + 4)])
    }

    private func linear(_ c: Float) -> Float { c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
}
#endif
