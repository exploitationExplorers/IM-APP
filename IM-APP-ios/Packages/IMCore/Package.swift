// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "IMCore",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [.library(name: "IMCore", targets: ["IMCore"])],
    targets: [
        .target(name: "IMCore"),
        .testTarget(name: "IMCoreTests", dependencies: ["IMCore"], resources: [.copy("Fixtures")])
    ]
)
