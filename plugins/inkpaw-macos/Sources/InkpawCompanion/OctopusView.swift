#if os(macOS)
import AppKit
import Combine
import InkpawCore
import RealityKit
import SwiftUI
import simd

/// A native, transparent RealityKit scene. The host positions this view on its time rail.
/// Scene entities stay alive across SwiftUI updates; checklist changes never rebuild a window.
@MainActor
struct OctopusView: View {
    var mood: OctopusMood = .idle
    var reduceMotion = false
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion

    var body: some View {
        NativeOctopusView(mood: mood, reduceMotion: reduceMotion || systemReduceMotion)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Inkpaw，戴贝雷帽的蓝色八爪鱼")
            .accessibilityValue(accessibilityMood)
    }

    private var accessibilityMood: String {
        switch mood {
        case .idle: return "陪伴中"
        case .search: return "拿着放大镜查找资料"
        case .read: return "捧着书阅读"
        case .think: return "思考中"
        case .happy: return "开心地挥动腕足"
        }
    }
}

@MainActor
private struct NativeOctopusView: NSViewRepresentable {
    let mood: OctopusMood
    let reduceMotion: Bool

    func makeCoordinator() -> OctopusSceneCoordinator { OctopusSceneCoordinator() }

    func makeNSView(context: Context) -> TransparentOctopusARView {
        // On macOS ARView is non-AR. cameraMode and automaticallyConfigureSession
        // are iOS-only APIs, so neither belongs in this native macOS implementation.
        let view = TransparentOctopusARView(frame: .zero)
        view.environment.background = .color(.clear)
        view.wantsLayer = true
        view.layer?.isOpaque = false
        view.layer?.backgroundColor = NSColor.clear.cgColor
        context.coordinator.attach(to: view)
        context.coordinator.configure(mood: mood, reduceMotion: reduceMotion)
        return view
    }

    func updateNSView(_ view: TransparentOctopusARView, context: Context) {
        context.coordinator.configure(mood: mood, reduceMotion: reduceMotion)
        context.coordinator.updateCamera(for: view.bounds.size)
    }

    static func dismantleNSView(_ view: TransparentOctopusARView, coordinator: OctopusSceneCoordinator) {
        coordinator.stop()
        view.onLayoutOrWindowChange = nil
    }
}

@MainActor
private final class TransparentOctopusARView: ARView {
    var onLayoutOrWindowChange: (() -> Void)?
    override var isOpaque: Bool { false }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        onLayoutOrWindowChange?()
    }

    override func layout() {
        super.layout()
        onLayoutOrWindowChange?()
    }

    // This is a decorative companion, not an invisible input surface over the rail.
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

@MainActor
private final class OctopusSceneCoordinator {
    private weak var view: TransparentOctopusARView?
    private let anchor = AnchorEntity(world: .zero)
    private let body = Entity()
    private let camera = Entity()
    private let mantle = Entity()
    private let book = Entity()
    private let magnifier = Entity()
    private var eyes: [Entity] = []
    private var pupils: [Entity] = []
    private var armSegments: [[ModelEntity]] = []
    private var subscription: (any Cancellable)?
    private var mood: OctopusMood = .idle
    private var reduceMotion = false
    private var elapsed: TimeInterval = 0
    private var accumulated: TimeInterval = 0
    private var isBuilt = false
    private let sphere = MeshResource.generateSphere(radius: 1)
    private let skin = SimpleMaterial(color: InkpawColors.skin, roughness: 0.72, isMetallic: false)
    private let black = SimpleMaterial(color: InkpawColors.beret, roughness: 0.88, isMetallic: false)
    private let white = UnlitMaterial(color: InkpawColors.glint)

    func attach(to view: TransparentOctopusARView) {
        self.view = view
        if !isBuilt {
            buildScene()
            isBuilt = true
        }
        view.scene.addAnchor(anchor)
        view.onLayoutOrWindowChange = { [weak self, weak view] in
            guard let self, let view else { return }
            self.updateCamera(for: view.bounds.size)
            self.updateSubscription()
        }
        updateCamera(for: view.bounds.size)
        apply(OctopusPoseModel.pose(mood: mood, time: 0, reduceMotion: reduceMotion))
    }

    func configure(mood: OctopusMood, reduceMotion: Bool) {
        let changed = self.mood != mood || self.reduceMotion != reduceMotion
        self.mood = mood
        self.reduceMotion = reduceMotion
        if changed { apply(OctopusPoseModel.pose(mood: mood, time: elapsed, reduceMotion: reduceMotion)) }
        updateSubscription()
    }

    func updateCamera(for size: CGSize) {
        let aspect = Float(max(1, size.width) / max(1, size.height))
        var projection = OrthographicCameraComponent()
        projection.near = 0.01
        projection.far = 10
        projection.scaleDirection = .vertical
        projection.scale = OctopusPoseModel.verticalSpan * max(1, 1 / aspect)
        camera.components.set(projection)
        camera.look(at: OctopusPoseModel.cameraTarget, from: OctopusPoseModel.cameraPosition, relativeTo: nil)
    }

    func stop() {
        subscription?.cancel()
        subscription = nil
        view?.scene.removeAnchor(anchor)
        view = nil
    }

    private func updateSubscription() {
        guard let view, view.window != nil, !reduceMotion else {
            subscription?.cancel()
            subscription = nil
            return
        }
        guard subscription == nil else { return }
        subscription = view.scene.subscribe(to: SceneEvents.Update.self) { [weak self] event in
            self?.advance(deltaTime: event.deltaTime)
        }
    }

    private func advance(deltaTime: TimeInterval) {
        guard let view, view.window != nil, !view.isHiddenOrHasHiddenAncestor, !reduceMotion else { return }
        // Bound resumed frame gaps and animate at 30 Hz rather than doing geometry work
        // on every display refresh. Shared meshes are allocated only once, not per frame.
        accumulated += min(max(0, deltaTime), 0.1)
        guard accumulated >= 1 / 30 else { return }
        elapsed += accumulated
        accumulated = 0
        apply(OctopusPoseModel.pose(mood: mood, time: elapsed, reduceMotion: false))
    }

    private func buildScene() {
        anchor.name = "Inkpaw.Scene"
        body.name = "Inkpaw.Octopus"
        camera.name = "Inkpaw.OrthographicCamera"
        anchor.addChild(body)
        anchor.addChild(camera)

        let key = DirectionalLight()
        key.light.color = .white
        key.light.intensity = 2_000
        key.look(at: [0, 0.15, 0], from: [-1.3, 2.3, 2], relativeTo: nil)
        anchor.addChild(key)
        let fill = DirectionalLight()
        fill.light.color = InkpawColors.skinHighlight
        fill.light.intensity = 600
        fill.look(at: [0, 0.15, 0], from: [1.5, 0.5, 1], relativeTo: nil)
        anchor.addChild(fill)

        // Squat mantle, original blue skin, no spots or suckers.
        mantle.position = [0, 0.24, 0]
        mantle.addChild(ellipsoid(scale: [0.31, 0.245, 0.30], material: skin))
        body.addChild(mantle)

        for side: Float in [-1, 1] {
            let eye = Entity()
            eye.position = [side * 0.092, 0.19, 0.265]
            eye.orientation = simd_quatf(angle: side * 0.18, axis: [0, 1, 0])
            let pupil = Entity()
            pupil.addChild(ellipsoid(scale: [0.0423, 0.05405, 0.0329], material: SimpleMaterial(color: InkpawColors.eye, roughness: 0.55, isMetallic: false)))
            let glint = ellipsoid(scale: [0.0169, 0.0169, 0.0169], material: white)
            glint.position = [-0.0141, 0.01974, 0.02914]
            pupil.addChild(glint)
            eye.addChild(pupil)
            body.addChild(eye)
            eyes.append(eye)
            pupils.append(pupil)
        }

        let beret = Entity()
        beret.name = "Inkpaw.TiltedBeret"
        beret.position = [0.02, 0.48, -0.01]
        beret.orientation = rotation([-0.12, 0, -0.28])
        beret.addChild(ellipsoid(scale: [0.25725, 0.08085, 0.245], material: black))
        let stem = ellipsoid(scale: [0.015, 0.035, 0.015], material: black)
        stem.position = [0.015, 0.09, 0]
        beret.addChild(stem)
        body.addChild(beret)

        for index in 0..<OctopusPoseModel.armCount {
            let arm = Entity()
            arm.name = "Inkpaw.Arm.\(index)"
            let segments = (0...OctopusPoseModel.segmentCount).map { segment -> ModelEntity in
                let model = ellipsoid(scale: [0.03, 0.03, 0.03], material: skin)
                model.name = "Inkpaw.Arm.\(index).Segment.\(segment)"
                arm.addChild(model)
                return model
            }
            armSegments.append(segments)
            body.addChild(arm)
        }
        buildBook()
        buildMagnifier()
        body.addChild(book)
        body.addChild(magnifier)
    }

    private func buildBook() {
        book.name = "Inkpaw.Book"
        let cover = SimpleMaterial(color: InkpawColors.bookCover, roughness: 0.9, isMetallic: false)
        let paper = SimpleMaterial(color: InkpawColors.bookPage, roughness: 1, isMetallic: false)
        let line = SimpleMaterial(color: InkpawColors.bookLine, roughness: 1, isMetallic: false)
        for side: Float in [-1, 1] {
            let leaf = Entity()
            leaf.orientation = rotation([0, side * OctopusPoseModel.bookLeafAngle, 0])
            leaf.addChild(box(size: [0.15, 0.2, 0.012], at: [side * 0.075, 0.1, 0.008], material: cover))
            leaf.addChild(box(size: [0.141, 0.188, 0.004], at: [side * 0.0735, 0.1, -0.001], material: paper))
            for row in 0..<6 {
                leaf.addChild(box(size: [0.104, 0.003, 0.001], at: [side * 0.0735, 0.045 + Float(row) * 0.021, -0.004], material: line))
            }
            if side < 0 {
                leaf.addChild(box(size: [0.084, 0.028, 0.002], at: [-0.075, 0.136, 0.015], material: paper))
            }
            book.addChild(leaf)
        }
        book.addChild(box(size: [0.012, 0.205, 0.022], at: [0, 0.1, 0.004], material: cover))
    }

    private func buildMagnifier() {
        magnifier.name = "Inkpaw.Magnifier"
        let radius = OctopusPoseModel.lensRadius
        let handleLength = OctopusPoseModel.handleLength
        let handle = ellipsoid(scale: [0.016, handleLength / 2, 0.016], material: black)
        handle.position = [0, handleLength / 2, 0]
        magnifier.addChild(handle)
        // A ring assembled from native rounded segments. No PNG or web texture.
        for index in 0..<32 {
            let angle = Float(index) / 32 * .pi * 2
            let rim = ellipsoid(scale: [0.012, 0.014, 0.012], material: black)
            rim.position = [sin(angle) * radius, handleLength + radius + cos(angle) * radius, 0]
            rim.orientation = rotation([0, 0, -angle])
            magnifier.addChild(rim)
        }
        let glass = ellipsoid(scale: [radius * 0.94, radius * 0.94, 0.002], material: SimpleMaterial(color: InkpawColors.lens.withAlphaComponent(0.38), roughness: 0.12, isMetallic: false))
        glass.position = [0, handleLength + radius, 0]
        magnifier.addChild(glass)
        let shine = ellipsoid(scale: [0.004, 0.02, 0.002], material: white)
        shine.position = [-0.022, handleLength + radius + 0.016, 0.004]
        shine.orientation = rotation([0, 0, -0.6])
        magnifier.addChild(shine)
    }

    private func apply(_ pose: OctopusPose) {
        body.position = pose.bodyPosition
        body.orientation = rotation(pose.bodyRotation)
        mantle.scale = pose.headScale
        for index in eyes.indices {
            eyes[index].scale.y = pose.eyeScaleY
            pupils[index].position = [0.005 * pose.gaze.x, 0.004 * pose.gaze.y, 0]
        }
        for index in pose.arms.indices {
            let arm = pose.arms[index]
            for segment in 0..<OctopusPoseModel.segmentCount {
                let start = arm.points[segment]
                let end = arm.points[segment + 1]
                let delta = end - start
                let length = simd_length(delta)
                let radius = (arm.radii[segment] + arm.radii[segment + 1]) / 2
                let entity = armSegments[index][segment]
                entity.position = (start + end) / 2
                entity.scale = [radius, radius + length / 2, radius]
                entity.orientation = length > 0.000_001 ? simd_quatf(from: [0, 1, 0], to: delta / length) : simd_quatf()
            }
            let tip = armSegments[index][OctopusPoseModel.segmentCount]
            tip.position = arm.points[OctopusPoseModel.segmentCount]
            tip.scale = SIMD3<Float>(repeating: arm.radii[OctopusPoseModel.segmentCount])
        }
        book.isEnabled = pose.book.isVisible
        book.position = pose.book.position
        book.orientation = rotation(pose.book.rotation)
        magnifier.isEnabled = pose.magnifier.isVisible
        magnifier.position = pose.magnifier.position
        magnifier.orientation = rotation(pose.magnifier.rotation)
    }

    private func ellipsoid(scale: SIMD3<Float>, material: any RealityKit.Material) -> ModelEntity {
        let entity = ModelEntity(mesh: sphere, materials: [material])
        entity.scale = scale
        return entity
    }

    private func box(size: SIMD3<Float>, at position: SIMD3<Float>, material: any RealityKit.Material) -> ModelEntity {
        let entity = ModelEntity(mesh: .generateBox(size: size), materials: [material])
        entity.position = position
        return entity
    }

    private func rotation(_ angles: SIMD3<Float>) -> simd_quatf {
        simd_quatf(angle: angles.z, axis: [0, 0, 1]) * simd_quatf(angle: angles.y, axis: [0, 1, 0]) * simd_quatf(angle: angles.x, axis: [1, 0, 0])
    }
}
#endif
