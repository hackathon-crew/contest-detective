// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "InkpawCompanion",
    platforms: [.macOS(.v15)],
    products: [
        .library(name: "InkpawCore", targets: ["InkpawCore"]),
        .library(name: "InkpawInfrastructure", targets: ["InkpawInfrastructure"]),
        .executable(name: "InkpawCompanion", targets: ["InkpawCompanion"]),
    ],
    targets: [
        .target(name: "InkpawCore"),
        .target(name: "InkpawInfrastructure", dependencies: ["InkpawCore"]),
        .executableTarget(
            name: "InkpawCompanion",
            dependencies: ["InkpawCore", "InkpawInfrastructure"]
        ),
        .testTarget(
            name: "InkpawCoreTests",
            dependencies: ["InkpawCore", "InkpawInfrastructure"]
        ),
        .testTarget(
            name: "InkpawCompanionTests",
            dependencies: ["InkpawCompanion", "InkpawCore", "InkpawInfrastructure"]
        ),
    ],
    swiftLanguageModes: [.v5]
)
