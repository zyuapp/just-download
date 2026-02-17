import AppKit
import Foundation

struct IconSpec {
  let fileName: String
  let size: Int
}

enum IconGenerationError: Error {
  case cannotCreateContext
  case cannotEncodePng
}

let iconSpecs: [IconSpec] = [
  IconSpec(fileName: "icon_16x16.png", size: 16),
  IconSpec(fileName: "icon_16x16@2x.png", size: 32),
  IconSpec(fileName: "icon_32x32.png", size: 32),
  IconSpec(fileName: "icon_32x32@2x.png", size: 64),
  IconSpec(fileName: "icon_128x128.png", size: 128),
  IconSpec(fileName: "icon_128x128@2x.png", size: 256),
  IconSpec(fileName: "icon_256x256.png", size: 256),
  IconSpec(fileName: "icon_256x256@2x.png", size: 512),
  IconSpec(fileName: "icon_512x512.png", size: 512),
  IconSpec(fileName: "icon_512x512@2x.png", size: 1024)
]

func drawIcon(size: CGFloat, in context: CGContext) {
  let canvas = CGRect(x: 0, y: 0, width: size, height: size)
  let inset = size * 0.05
  let cardRect = canvas.insetBy(dx: inset, dy: inset)
  let cornerRadius = size * 0.24

  let backgroundPath = CGPath(
    roundedRect: cardRect,
    cornerWidth: cornerRadius,
    cornerHeight: cornerRadius,
    transform: nil
  )

  context.saveGState()
  context.addPath(backgroundPath)
  context.clip()

  if let gradient = CGGradient(
    colorsSpace: CGColorSpaceCreateDeviceRGB(),
    colors: [
      NSColor(calibratedRed: 0.22, green: 0.74, blue: 0.98, alpha: 1).cgColor,
      NSColor(calibratedRed: 0.11, green: 0.46, blue: 0.89, alpha: 1).cgColor,
      NSColor(calibratedRed: 0.04, green: 0.18, blue: 0.46, alpha: 1).cgColor
    ] as CFArray,
    locations: [0.0, 0.5, 1.0]
  ) {
    context.drawLinearGradient(
      gradient,
      start: CGPoint(x: cardRect.minX, y: cardRect.maxY),
      end: CGPoint(x: cardRect.maxX, y: cardRect.minY),
      options: []
    )
  }

  let glowCenter = CGPoint(
    x: cardRect.minX + cardRect.width * 0.34,
    y: cardRect.minY + cardRect.height * 0.74
  )
  if let glowGradient = CGGradient(
    colorsSpace: CGColorSpaceCreateDeviceRGB(),
    colors: [
      NSColor(calibratedRed: 0.73, green: 0.92, blue: 1.0, alpha: 0.52).cgColor,
      NSColor(calibratedRed: 0.39, green: 0.67, blue: 1.0, alpha: 0.0).cgColor
    ] as CFArray,
    locations: [0.0, 1.0]
  ) {
    context.drawRadialGradient(
      glowGradient,
      startCenter: glowCenter,
      startRadius: 0,
      endCenter: glowCenter,
      endRadius: cardRect.width * 0.58,
      options: .drawsAfterEndLocation
    )
  }

  let highlightPath = CGMutablePath()
  highlightPath.move(to: CGPoint(x: cardRect.minX, y: cardRect.maxY - cardRect.height * 0.06))
  highlightPath.addCurve(
    to: CGPoint(x: cardRect.maxX, y: cardRect.maxY - cardRect.height * 0.24),
    control1: CGPoint(x: cardRect.minX + cardRect.width * 0.14, y: cardRect.maxY + cardRect.height * 0.10),
    control2: CGPoint(x: cardRect.maxX - cardRect.width * 0.16, y: cardRect.maxY + cardRect.height * 0.01)
  )
  highlightPath.addLine(to: CGPoint(x: cardRect.maxX, y: cardRect.maxY))
  highlightPath.addLine(to: CGPoint(x: cardRect.minX, y: cardRect.maxY))
  highlightPath.closeSubpath()

  context.addPath(highlightPath)
  context.setFillColor(NSColor(calibratedWhite: 1.0, alpha: 0.15).cgColor)
  context.fillPath()

  let shadeCenter = CGPoint(
    x: cardRect.minX + cardRect.width * 0.8,
    y: cardRect.minY + cardRect.height * 0.14
  )
  if let shadeGradient = CGGradient(
    colorsSpace: CGColorSpaceCreateDeviceRGB(),
    colors: [
      NSColor(calibratedRed: 0.02, green: 0.13, blue: 0.40, alpha: 0.0).cgColor,
      NSColor(calibratedRed: 0.01, green: 0.10, blue: 0.31, alpha: 0.40).cgColor
    ] as CFArray,
    locations: [0.0, 1.0]
  ) {
    context.drawRadialGradient(
      shadeGradient,
      startCenter: shadeCenter,
      startRadius: 0,
      endCenter: shadeCenter,
      endRadius: cardRect.width * 0.82,
      options: .drawsAfterEndLocation
    )
  }

  context.restoreGState()

  context.addPath(backgroundPath)
  context.setStrokeColor(NSColor(calibratedRed: 0.01, green: 0.09, blue: 0.28, alpha: 0.55).cgColor)
  context.setLineWidth(max(1.0, size * 0.007))
  context.strokePath()

  let innerBorderRect = cardRect.insetBy(dx: cardRect.width * 0.02, dy: cardRect.height * 0.02)
  let innerBorderPath = CGPath(
    roundedRect: innerBorderRect,
    cornerWidth: cornerRadius * 0.90,
    cornerHeight: cornerRadius * 0.90,
    transform: nil
  )
  context.addPath(innerBorderPath)
  context.setStrokeColor(NSColor(calibratedWhite: 1.0, alpha: 0.15).cgColor)
  context.setLineWidth(max(0.8, size * 0.003))
  context.strokePath()

  let orbRect = CGRect(
    x: cardRect.midX - cardRect.width * 0.24,
    y: cardRect.midY - cardRect.height * 0.22,
    width: cardRect.width * 0.48,
    height: cardRect.height * 0.48
  )

  context.saveGState()
  context.setShadow(
    offset: CGSize(width: 0, height: -size * 0.008),
    blur: size * 0.03,
    color: NSColor(calibratedRed: 0.01, green: 0.08, blue: 0.26, alpha: 0.34).cgColor
  )
  context.addEllipse(in: orbRect)
  context.clip()

  if let orbGradient = CGGradient(
    colorsSpace: CGColorSpaceCreateDeviceRGB(),
    colors: [
      NSColor(calibratedRed: 0.67, green: 0.86, blue: 1.0, alpha: 0.44).cgColor,
      NSColor(calibratedRed: 0.38, green: 0.64, blue: 0.99, alpha: 0.18).cgColor,
      NSColor(calibratedRed: 0.19, green: 0.37, blue: 0.80, alpha: 0.0).cgColor
    ] as CFArray,
    locations: [0.0, 0.55, 1.0]
  ) {
    let orbCenter = CGPoint(x: orbRect.midX - orbRect.width * 0.1, y: orbRect.midY + orbRect.height * 0.1)
    context.drawRadialGradient(
      orbGradient,
      startCenter: orbCenter,
      startRadius: 0,
      endCenter: CGPoint(x: orbRect.midX, y: orbRect.midY),
      endRadius: orbRect.width * 0.6,
      options: .drawsAfterEndLocation
    )
  }

  context.restoreGState()

  context.addEllipse(in: orbRect)
  context.setStrokeColor(NSColor(calibratedWhite: 1.0, alpha: 0.2).cgColor)
  context.setLineWidth(max(0.8, size * 0.004))
  context.strokePath()

  let glyphRect = CGRect(
    x: cardRect.minX + cardRect.width * 0.31,
    y: cardRect.minY + cardRect.height * 0.28,
    width: cardRect.width * 0.38,
    height: cardRect.height * 0.42
  )

  let centerX = glyphRect.midX
  let shaftTop = glyphRect.maxY
  let shaftBottom = glyphRect.minY + glyphRect.height * 0.47
  let tipY = glyphRect.minY
  let shaftHalfWidth = glyphRect.width * 0.12
  let headHalfWidth = glyphRect.width * 0.36

  let arrowPath = CGMutablePath()
  arrowPath.move(to: CGPoint(x: centerX - shaftHalfWidth, y: shaftTop))
  arrowPath.addLine(to: CGPoint(x: centerX + shaftHalfWidth, y: shaftTop))
  arrowPath.addLine(to: CGPoint(x: centerX + shaftHalfWidth, y: shaftBottom))
  arrowPath.addLine(to: CGPoint(x: centerX + headHalfWidth, y: shaftBottom))
  arrowPath.addLine(to: CGPoint(x: centerX, y: tipY))
  arrowPath.addLine(to: CGPoint(x: centerX - headHalfWidth, y: shaftBottom))
  arrowPath.addLine(to: CGPoint(x: centerX - shaftHalfWidth, y: shaftBottom))
  arrowPath.closeSubpath()

  context.saveGState()
  context.setShadow(
    offset: CGSize(width: 0, height: -size * 0.012),
    blur: size * 0.04,
    color: NSColor(calibratedRed: 0.02, green: 0.14, blue: 0.42, alpha: 0.42).cgColor
  )
  context.addPath(arrowPath)
  context.clip()

  if let glyphGradient = CGGradient(
    colorsSpace: CGColorSpaceCreateDeviceRGB(),
    colors: [
      NSColor(calibratedRed: 0.98, green: 0.99, blue: 1.0, alpha: 0.98).cgColor,
      NSColor(calibratedRed: 0.77, green: 0.92, blue: 1.0, alpha: 0.92).cgColor
    ] as CFArray,
    locations: [0.0, 1.0]
  ) {
    context.drawLinearGradient(
      glyphGradient,
      start: CGPoint(x: centerX, y: shaftTop),
      end: CGPoint(x: centerX, y: tipY),
      options: []
    )
  }

  context.restoreGState()

  context.addPath(arrowPath)
  context.setStrokeColor(NSColor(calibratedWhite: 1.0, alpha: 0.72).cgColor)
  context.setLineWidth(max(0.9, size * 0.004))
  context.strokePath()

  let trayRect = CGRect(
    x: cardRect.midX - cardRect.width * 0.16,
    y: cardRect.minY + cardRect.height * 0.22,
    width: cardRect.width * 0.32,
    height: cardRect.height * 0.06
  )
  let trayPath = CGPath(
    roundedRect: trayRect,
    cornerWidth: trayRect.height / 2,
    cornerHeight: trayRect.height / 2,
    transform: nil
  )
  context.addPath(trayPath)
  context.setFillColor(NSColor(calibratedWhite: 1.0, alpha: 0.90).cgColor)
  context.fillPath()

  let trayInnerRect = trayRect.insetBy(dx: trayRect.width * 0.08, dy: trayRect.height * 0.28)
  let trayInnerPath = CGPath(
    roundedRect: trayInnerRect,
    cornerWidth: trayInnerRect.height / 2,
    cornerHeight: trayInnerRect.height / 2,
    transform: nil
  )
  context.addPath(trayInnerPath)
  context.setFillColor(NSColor(calibratedRed: 0.18, green: 0.41, blue: 0.85, alpha: 0.26).cgColor)
  context.fillPath()
}

func makeIconImage(size: Int) throws -> NSImage {
  let imageSize = NSSize(width: size, height: size)
  let image = NSImage(size: imageSize)

  image.lockFocus()
  defer { image.unlockFocus() }

  guard let context = NSGraphicsContext.current?.cgContext else {
    throw IconGenerationError.cannotCreateContext
  }

  context.setAllowsAntialiasing(true)
  context.setShouldAntialias(true)
  context.interpolationQuality = .high

  drawIcon(size: CGFloat(size), in: context)
  return image
}

func savePng(_ image: NSImage, to destination: URL) throws {
  guard
    let tiffData = image.tiffRepresentation,
    let bitmap = NSBitmapImageRep(data: tiffData),
    let pngData = bitmap.representation(using: .png, properties: [.compressionFactor: 1.0])
  else {
    throw IconGenerationError.cannotEncodePng
  }

  try pngData.write(to: destination)
}

let fileManager = FileManager.default
let workingDirectory = URL(fileURLWithPath: fileManager.currentDirectoryPath, isDirectory: true)
let buildDirectory = workingDirectory.appendingPathComponent("build", isDirectory: true)
let iconsetDirectory = buildDirectory.appendingPathComponent("icon.iconset", isDirectory: true)

if fileManager.fileExists(atPath: iconsetDirectory.path) {
  try fileManager.removeItem(at: iconsetDirectory)
}

try fileManager.createDirectory(at: iconsetDirectory, withIntermediateDirectories: true)

for spec in iconSpecs {
  let icon = try makeIconImage(size: spec.size)
  let target = iconsetDirectory.appendingPathComponent(spec.fileName)
  try savePng(icon, to: target)
  print("generated \(target.path)")
}

let marketingIcon = try makeIconImage(size: 1024)
let marketingTarget = buildDirectory.appendingPathComponent("icon.png")
try savePng(marketingIcon, to: marketingTarget)
print("generated \(marketingTarget.path)")
