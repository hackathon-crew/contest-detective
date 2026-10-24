#if os(macOS)
import AppKit
import Foundation
import Metal
import RealityKit
import simd

/// CI may inspect the actual visible renderer without replacing its render path.
@MainActor
protocol InkpawPixelRenderingDiagnostics: AnyObject {
    var pixelRenderDiagnostics: [String: Any] { get }
}

struct InkpawPixelGrid: Equatable {
    let width: Int
    let height: Int
    let scale: Int
    let offsetX: Int
    let offsetY: Int

    /// The web mascot uses a 120-cell canvas. The much smaller desktop companion
    /// caps that at 120 cells and keeps each cell at least two logical points wide.
    /// Integer device-pixel replication avoids filtered/uneven "almost pixel" edges.
    init(outputWidth: Int, outputHeight: Int, logicalWidth: Double, logicalHeight: Double) {
        let width = max(1, outputWidth)
        let height = max(1, outputHeight)
        let backing = max(Double(width) / max(1, logicalWidth), Double(height) / max(1, logicalHeight))
        scale = min(min(width, height), max(1, Int(ceil(backing * 2)), Int(ceil(Double(max(width, height)) / 120))))
        self.width = max(1, width / scale)
        self.height = max(1, height / scale)
        offsetX = (width - self.width * scale) / 2
        offsetY = (height - self.height * scale) / 2
    }
}

/// Owns only Metal resources and lock-protected data, never an AppKit/RealityKit
/// scene entity. RealityKit can call its render callbacks off the main actor.
/// All color processing is live GPU work; no snapshots, image files, or baked poses.
final class InkpawPixelRenderer: @unchecked Sendable {
    private let lock = NSLock()
    private let shaderSource: String
    private var failureObserver: (@MainActor @Sendable (String) -> Void)?
    private var logicalSize = CGSize(width: 140, height: 140)
    private var preparedDevice: UInt64?
    private var downsample: (any MTLComputePipelineState)?
    private var toon: (any MTLComputePipelineState)?
    private var upscale: (any MTLComputePipelineState)?
    private var lowColor: (any MTLTexture)?
    private var lowDepth: (any MTLTexture)?
    private var lowToon: (any MTLTexture)?
    private var encodedFrames = 0
    private var completedFrames = 0
    private var failure = ""
    private var values: [String: Any] = [:]

    init(shaderSource: String = InkpawPixelRenderer.metalSource) { self.shaderSource = shaderSource }

    func observeFailures(_ callback: (@MainActor @Sendable (String) -> Void)?) {
        lock.lock()
        failureObserver = callback
        let existing = failure
        lock.unlock()
        if !existing.isEmpty { Task { @MainActor in callback?(existing) } }
    }

    var diagnostics: [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        var result = values
        result["activePipeline"] = downsample != nil && toon != nil && upscale != nil && encodedFrames > 0 && failure.isEmpty
        result["encodedFrameCount"] = encodedFrames
        result["completedFrameCount"] = completedFrames
        result["failureReason"] = failure
        result["logicalWidth"] = Double(logicalSize.width)
        result["logicalHeight"] = Double(logicalSize.height)
        return result
    }

    func setLogicalSize(_ size: CGSize) {
        guard size.width.isFinite, size.height.isFinite, size.width > 0, size.height > 0 else { return }
        lock.lock()
        logicalSize = size
        lock.unlock()
    }

    func prepare(device: any MTLDevice) {
        lock.lock()
        defer { lock.unlock() }
        prepareLocked(device: device)
    }

    func process(_ context: ARView.PostProcessContext) {
        lock.lock()
        defer { lock.unlock() }
        prepareLocked(device: context.device)
        guard failure.isEmpty, let downsample, let toon, let upscale else {
            copyUnmodified(context)
            return
        }
        let output = compatibleTarget(context)
        guard let output else {
            fail("The postprocess target has no writable compatible Metal texture view.")
            copyUnmodified(context)
            return
        }
        let grid = InkpawPixelGrid(outputWidth: output.width, outputHeight: output.height,
                                  logicalWidth: logicalSize.width, logicalHeight: logicalSize.height)
        let projectionY = Double(context.projection.columns.1.y)
        values = [
            "lowResolutionWidth": grid.width, "lowResolutionHeight": grid.height,
            "outputWidth": output.width, "outputHeight": output.height,
            "integerScale": grid.scale, "gridPixelWidth": grid.scale, "gridPixelHeight": grid.scale,
            "gridOffsetX": grid.offsetX, "gridOffsetY": grid.offsetY,
            "backingScale": Double(output.width) / Double(logicalSize.width),
            "projectionScaleX": Double(context.projection.columns.0.x), "projectionScaleY": projectionY,
            "inferredVerticalSpan": abs(projectionY) > 0.000_001 ? 2 / abs(projectionY) : 0,
            "sourcePixelFormat": context.sourceColorTexture.pixelFormat.rawValue,
            "sourceDepthPixelFormat": context.sourceDepthTexture.pixelFormat.rawValue,
            "targetPixelFormat": context.targetColorTexture.pixelFormat.rawValue,
            "writableTargetPixelFormat": output.pixelFormat.rawValue,
            "reverseDepth": context.projection.columns.2.z > 0,
        ]
        guard allocateLowTextures(device: context.device, grid: grid),
              let lowColor, let lowDepth, let lowToon else {
            fail("Could not allocate the live low-resolution Metal render buffers.")
            copyUnmodified(context)
            return
        }
        guard let encoder = context.commandBuffer.makeComputeCommandEncoder() else {
            fail("Could not create the live pixel-render compute encoder.")
            copyUnmodified(context)
            return
        }
        encoder.label = "Inkpaw live low-resolution pixel rendering"
        encoder.setComputePipelineState(downsample)
        encoder.setTexture(context.sourceColorTexture, index: 0)
        encoder.setTexture(context.sourceDepthTexture, index: 1)
        encoder.setTexture(lowColor, index: 2)
        encoder.setTexture(lowDepth, index: 3)
        dispatch(encoder, pipeline: downsample, width: grid.width, height: grid.height)

        encoder.memoryBarrier(resources: [lowColor, lowDepth])
        encoder.setComputePipelineState(toon)
        encoder.setTexture(lowColor, index: 0)
        encoder.setTexture(lowDepth, index: 1)
        encoder.setTexture(lowToon, index: 2)
        var reversed: UInt32 = context.projection.columns.2.z > 0 ? 1 : 0
        encoder.setBytes(&reversed, length: MemoryLayout<UInt32>.stride, index: 0)
        dispatch(encoder, pipeline: toon, width: grid.width, height: grid.height)

        encoder.memoryBarrier(resources: [lowToon])
        encoder.setComputePipelineState(upscale)
        encoder.setTexture(lowToon, index: 0)
        encoder.setTexture(output, index: 1)
        // sRGB texture writes and floating-point render targets need linear values;
        // an Intel-compatible unorm view needs explicitly encoded sRGB values.
        let needsLinear = Self.requiresLinearOutput(output.pixelFormat)
        var placement = SIMD4<UInt32>(UInt32(grid.scale), UInt32(grid.offsetX), UInt32(grid.offsetY), needsLinear ? 1 : 0)
        encoder.setBytes(&placement, length: MemoryLayout<SIMD4<UInt32>>.stride, index: 0)
        dispatch(encoder, pipeline: upscale, width: output.width, height: output.height)
        encoder.endEncoding()
        encodedFrames += 1
        context.commandBuffer.addCompletedHandler { [weak self] buffer in
            guard let self else { return }
            self.lock.lock()
            defer { self.lock.unlock() }
            if buffer.status == .completed {
                self.completedFrames += 1
            } else {
                self.fail("Metal did not complete the pixel-render frame: \(buffer.error?.localizedDescription ?? "unknown GPU error")")
            }
        }
    }

    private func prepareLocked(device: any MTLDevice) {
        guard preparedDevice != device.registryID else { return }
        preparedDevice = device.registryID
        downsample = nil
        toon = nil
        upscale = nil
        lowColor = nil
        lowDepth = nil
        lowToon = nil
        do {
            // Embedded source is compiled once per device, not per frame. Keeping it
            // in the executable also makes the unsigned .app self-contained.
            let library = try device.makeLibrary(source: shaderSource, options: nil)
            guard let a = library.makeFunction(name: "inkpaw_downsample"),
                  let b = library.makeFunction(name: "inkpaw_toon_edges"),
                  let c = library.makeFunction(name: "inkpaw_nearest") else {
                fail("The embedded Inkpaw Metal library is missing a pixel-render kernel.")
                return
            }
            downsample = try device.makeComputePipelineState(function: a)
            toon = try device.makeComputePipelineState(function: b)
            upscale = try device.makeComputePipelineState(function: c)
            failure = ""
        } catch {
            fail("Could not prepare the native pixel-render Metal pipeline: \(error.localizedDescription)")
        }
    }

    private func compatibleTarget(_ context: ARView.PostProcessContext) -> (any MTLTexture)? {
        let target = context.targetColorTexture
        if context.device.supportsFamily(.apple2) { return target }
        // Apple's documented compatibility path for Intel/AMD macOS GPUs. A normal
        // writable unorm/float target already needs no sRGB view conversion.
        if target.pixelFormat == .bgra8Unorm_srgb { return target.makeTextureView(pixelFormat: .bgra8Unorm) }
        if target.pixelFormat == .rgba8Unorm_srgb { return target.makeTextureView(pixelFormat: .rgba8Unorm) }
        return target
    }

    static func requiresLinearOutput(_ format: MTLPixelFormat) -> Bool {
        format == .bgra8Unorm_srgb || format == .rgba8Unorm_srgb ||
        format == .bgra10_xr_srgb || format == .bgr10_xr_srgb ||
        format == .rgba16Float || format == .rgba32Float
    }

    private func allocateLowTextures(device: any MTLDevice, grid: InkpawPixelGrid) -> Bool {
        if lowColor?.width == grid.width, lowColor?.height == grid.height, lowDepth != nil, lowToon != nil { return true }
        func make(_ format: MTLPixelFormat) -> (any MTLTexture)? {
            let descriptor = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: format, width: grid.width, height: grid.height, mipmapped: false)
            descriptor.usage = [.shaderRead, .shaderWrite]
            descriptor.storageMode = .private
            return device.makeTexture(descriptor: descriptor)
        }
        lowColor = make(.rgba16Float)
        lowDepth = make(.r32Float)
        lowToon = make(.rgba16Float)
        return lowColor != nil && lowDepth != nil && lowToon != nil
    }

    private func dispatch(_ encoder: any MTLComputeCommandEncoder, pipeline: any MTLComputePipelineState, width: Int, height: Int) {
        let w = min(16, pipeline.threadExecutionWidth)
        let h = min(16, max(1, pipeline.maxTotalThreadsPerThreadgroup / w))
        encoder.dispatchThreadgroups(MTLSize(width: (width + w - 1) / w, height: (height + h - 1) / h, depth: 1),
                                     threadsPerThreadgroup: MTLSize(width: w, height: h, depth: 1))
    }

    private func fail(_ message: String) {
        guard failure != message else { return }
        failure = message
        let observer = failureObserver
        Task { @MainActor in observer?(message) }
    }

    static func canBlitUnmodified(source: any MTLTexture, target: any MTLTexture) -> Bool {
        source.pixelFormat == target.pixelFormat && source.textureType == target.textureType &&
        source.sampleCount == target.sampleCount && source.sampleCount == 1 &&
        source.width == target.width && source.height == target.height && source.depth == target.depth &&
        source.arrayLength == target.arrayLength && source.mipmapLevelCount == target.mipmapLevelCount
    }

    private func copyUnmodified(_ context: ARView.PostProcessContext) {
        // Blitting incompatible formats is itself an invalid Metal operation. Keep
        // the real frame only when the textures match; otherwise clear transparently
        // with a render pass that requires no successfully compiled shader.
        if Self.canBlitUnmodified(source: context.sourceColorTexture, target: context.targetColorTexture),
           let encoder = context.commandBuffer.makeBlitCommandEncoder() {
            encoder.copy(from: context.sourceColorTexture, to: context.targetColorTexture)
            encoder.endEncoding()
            return
        }
        let pass = MTLRenderPassDescriptor()
        pass.colorAttachments[0].texture = context.targetColorTexture
        pass.colorAttachments[0].loadAction = .clear
        pass.colorAttachments[0].storeAction = .store
        pass.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
        context.commandBuffer.makeRenderCommandEncoder(descriptor: pass)?.endEncoding()
    }

    static let metalSource = #"""
    #include <metal_stdlib>
    using namespace metal;

    float3 inkpaw_to_srgb(float3 c) {
        c = max(c, 0.0f);
        return select(1.055f * pow(c, float3(1.0f / 2.4f)) - 0.055f, 12.92f * c, c <= 0.0031308f);
    }
    float3 inkpaw_to_linear(float3 c) {
        c = max(c, 0.0f);
        return select(pow((c + 0.055f) / 1.055f, float3(2.4f)), c / 12.92f, c <= 0.04045f);
    }
    float3 inkpaw_rgb(uint rgb) {
        return float3((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255) / 255.0f;
    }
    float inkpaw_bayer4(uint2 p) {
        // Ordered dither is evaluated in low-resolution cells, never output pixels.
        constexpr float bayer[16] = {0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5};
        return (bayer[(p.y & 3) * 4 + (p.x & 3)] + 0.5f) / 16.0f - 0.5f;
    }
    float4 inkpaw_cell(texture2d<float, access::read> texture, int2 p) {
        if (any(p < 0) || p.x >= int(texture.get_width()) || p.y >= int(texture.get_height())) return float4(0);
        return texture.read(uint2(p));
    }

    kernel void inkpaw_downsample(
        texture2d<float, access::read> sourceColor [[texture(0)]],
        texture2d<float, access::read> sourceDepth [[texture(1)]],
        texture2d<float, access::write> lowColor [[texture(2)]],
        texture2d<float, access::write> lowDepth [[texture(3)]],
        uint2 gid [[thread_position_in_grid]]) {
        uint2 size(lowColor.get_width(), lowColor.get_height());
        if (any(gid >= size)) return;
        float2 uv = (float2(gid) + 0.5f) / float2(size);
        uint2 colorPoint = min(uint2(uv * float2(sourceColor.get_width(), sourceColor.get_height())), uint2(sourceColor.get_width() - 1, sourceColor.get_height() - 1));
        uint2 depthPoint = min(uint2(uv * float2(sourceDepth.get_width(), sourceDepth.get_height())), uint2(sourceDepth.get_width() - 1, sourceDepth.get_height() - 1));
        float4 color = sourceColor.read(colorPoint);
        // RealityKit's render color is linear. Sampling an sRGB texture also
        // decodes to linear; convert explicitly to the original sRGB brand palette.
        if (color.a > 0.0001f) color.rgb /= color.a;
        color.rgb = clamp(inkpaw_to_srgb(color.rgb), 0.0f, 1.0f);
        lowColor.write(color, gid);
        lowDepth.write(float4(sourceDepth.read(depthPoint).r), gid);
    }

    float3 inkpaw_palette(float3 c, uint2 cell) {
        float luminance = dot(c, float3(0.2126f, 0.7152f, 0.0722f));
        float dither = inkpaw_bayer4(cell);
        float low = min(c.r, min(c.g, c.b));
        float high = max(c.r, max(c.g, c.b));
        bool blue = c.b > c.r * 1.18f && c.b > c.g * 1.03f && c.b - c.r > 0.08f;
        if (high > 0.91f && high - low < 0.1f) return inkpaw_rgb(0xf4f7ff);
        if (blue) {
            if (high < 0.40f && luminance < 0.25f) return inkpaw_rgb(luminance + dither * 0.025f < 0.12f ? 0x121a33 : 0x2a3766);
            // The own-source blue three-tone palette, with ordered transitions.
            float lit = luminance + dither * 0.075f;
            return inkpaw_rgb(lit < 0.37f ? 0x2f49b8 : (lit < 0.58f ? 0x5878e6 : 0x8ea8f8));
        }
        if (luminance < 0.29f || (high - low < 0.13f && luminance < 0.58f)) return inkpaw_rgb(luminance + dither * 0.03f < 0.16f ? 0x1b1e27 : 0x363b4a);
        if (c.r > c.g * 1.18f && c.r > c.b * 1.15f) {
            return inkpaw_rgb(luminance + dither * 0.06f < 0.37f ? 0x81382c : 0xb8503f);
        }
        if (c.r > c.b + 0.025f) return inkpaw_rgb(luminance + dither * 0.04f < 0.78f ? 0xddd3c6 : 0xfbf6ef);
        return inkpaw_rgb(luminance + dither * 0.05f < 0.73f ? 0xa9c0f5 : 0xdbe6ff);
    }

    kernel void inkpaw_toon_edges(
        texture2d<float, access::read> color [[texture(0)]],
        texture2d<float, access::read> depth [[texture(1)]],
        texture2d<float, access::write> output [[texture(2)]],
        constant uint &reverseDepth [[buffer(0)]], uint2 gid [[thread_position_in_grid]]) {
        if (gid.x >= output.get_width() || gid.y >= output.get_height()) return;
        int2 p(gid);
        constexpr int2 offsets[4] = {int2(1, 0), int2(-1, 0), int2(0, 1), int2(0, -1)};
        float4 center = color.read(gid);
        float3 ink = inkpaw_rgb(0x101735);
        if (center.a < 0.5f) {
            bool outline = false;
            for (uint i = 0; i < 4; ++i) outline = outline || inkpaw_cell(color, p + offsets[i]).a >= 0.5f;
            if (outline) { output.write(float4(ink, 1), gid); return; }
            // Metal texture Y points down: original GLSL (3, -5) becomes (3, 5).
            bool shadow = inkpaw_cell(color, p - int2(3, 5)).a >= 0.5f && ((gid.x + gid.y) & 1) == 0;
            output.write(shadow ? float4(0.02f, 0.03f, 0.06f, 0.32f) : float4(0), gid);
            return;
        }
        float3 result = inkpaw_palette(center.rgb, gid);
        float here = depth.read(gid).r;
        bool innerEdge = false;
        for (uint i = 0; i < 4; ++i) {
            int2 neighbor = p + offsets[i];
            if (inkpaw_cell(color, neighbor).a < 0.5f) continue;
            float there = depth.read(uint2(neighbor)).r;
            // RealityKit normally uses reverse-Z. Match the original rear-surface
            // overlap edge without accidentally outlining the front side as well.
            float rearGap = reverseDepth != 0 ? there - here : here - there;
            innerEdge = innerEdge || rearGap > 0.006f;
        }
        if (innerEdge) result = ink;
        output.write(float4(result, 1), gid);
    }

    kernel void inkpaw_nearest(
        texture2d<float, access::read> lowColor [[texture(0)]],
        texture2d<float, access::write> output [[texture(1)]],
        constant uint4 &placement [[buffer(0)]], uint2 gid [[thread_position_in_grid]]) {
        if (gid.x >= output.get_width() || gid.y >= output.get_height()) return;
        int2 local = int2(gid) - int2(placement.yz);
        uint2 area = uint2(lowColor.get_width(), lowColor.get_height()) * placement.x;
        if (any(local < 0) || any(uint2(local) >= area)) { output.write(float4(0), gid); return; }
        uint2 cell = uint2(local) / placement.x;
        float4 color = lowColor.read(cell);
        if (placement.w != 0) color.rgb = inkpaw_to_linear(color.rgb);
        // The transparent native view composites premultiplied output.
        color.rgb *= color.a;
        output.write(color, gid);
    }
    """#
}
#endif
