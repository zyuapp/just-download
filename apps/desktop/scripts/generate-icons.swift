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
  let inset = size * 0.04
  let cardRect = canvas.insetBy(dx: inset, dy: inset)
  let cornerRadius = size * 0.235

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
      NSColor(calibratedRed: 0.16, green: 0.34, blue: 0.96, alpha: 1).cgColor,
      NSColor(calibratedRed: 0.12, green: 0.61, blue: 1.0, alpha: 1).cgColor,
      NSColor(calibratedRed: 0.14, green: 0.83, blue: 0.66, alpha: 1).cgColor
    ] as CFArray,
    locations: [0.0, 0.55, 1.0]
  ) {
    context.drawLinearGradient(
      gradient,
      start: CGPoint(x: cardRect.minX, y: cardRect.maxY),
      end: CGPoint(x: cardRect.maxX, y: cardRect.minY),
      options: []
    )
  }

  let highlightPath = CGMutablePath()
  highlightPath.move(to: CGPoint(x: cardRect.minX, y: cardRect.maxY - cardRect.height * 0.06))
  highlightPath.addCurve(
    to: CGPoint(x: cardRect.maxX, y: cardRect.maxY - cardRect.height * 0.30),
    control1: CGPoint(x: cardRect.minX + cardRect.width * 0.20, y: cardRect.maxY + cardRect.height * 0.10),
    control2: CGPoint(x: cardRect.maxX - cardRect.width * 0.16, y: cardRect.maxY + cardRect.height * 0.00)
  )
  highlightPath.addLine(to: CGPoint(x: cardRect.maxX, y: cardRect.maxY))
  highlightPath.addLine(to: CGPoint(x: cardRect.minX, y: cardRect.maxY))
  highlightPath.closeSubpath()

  context.addPath(highlightPath)
  context.setFillColor(NSColor(calibratedWhite: 1.0, alpha: 0.16).cgColor)
  context.fillPath()

  context.restoreGState()

  context.addPath(backgroundPath)
  context.setStrokeColor(NSColor(calibratedWhite: 1.0, alpha: 0.24).cgColor)
  context.setLineWidth(max(1.0, size * 0.008))
  context.strokePath()

  let glyphRect = CGRect(
    x: cardRect.minX + cardRect.width * 0.20,
    y: cardRect.minY + cardRect.height * 0.18,
    width: cardRect.width * 0.60,
    height: cardRect.height * 0.62
  )

  let centerX = glyphRect.midX
  let shaftTop = glyphRect.maxY
  let headY = glyphRect.minY + glyphRect.height * 0.42
  let tipY = glyphRect.minY + glyphRect.height * 0.06
  let shaftHalfWidth = glyphRect.width * 0.11
  let headHalfWidth = glyphRect.width * 0.31

  let arrowPath = CGMutablePath()
  arrowPath.move(to: CGPoint(x: centerX - shaftHalfWidth, y: shaftTop))
  arrowPath.addLine(to: CGPoint(x: centerX + shaftHalfWidth, y: shaftTop))
  arrowPath.addLine(to: CGPoint(x: centerX + shaftHalfWidth, y: headY))
  arrowPath.addLine(to: CGPoint(x: centerX + headHalfWidth, y: headY))
  arrowPath.addLine(to: CGPoint(x: centerX, y: tipY))
  arrowPath.addLine(to: CGPoint(x: centerX - headHalfWidth, y: headY))
  arrowPath.addLine(to: CGPoint(x: centerX - shaftHalfWidth, y: headY))
  arrowPath.closeSubpath()

  context.saveGState()
  context.setShadow(
    offset: CGSize(width: 0, height: -size * 0.018),
    blur: size * 0.05,
    color: NSColor(calibratedRed: 0.03, green: 0.13, blue: 0.30, alpha: 0.32).cgColor
  )
  context.addPath(arrowPath)
  context.clip()

  if let glyphGradient = CGGradient(
    colorsSpace: CGColorSpaceCreateDeviceRGB(),
    colors: [
      NSColor(calibratedWhite: 1.0, alpha: 1).cgColor,
      NSColor(calibratedRed: 0.87, green: 0.95, blue: 1.0, alpha: 1).cgColor
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
  context.setStrokeColor(NSColor(calibratedWhite: 1.0, alpha: 0.46).cgColor)
  context.setLineWidth(max(0.8, size * 0.006))
  context.strokePath()

  let trayRect = CGRect(
    x: cardRect.midX - cardRect.width * 0.23,
    y: cardRect.minY + cardRect.height * 0.15,
    width: cardRect.width * 0.46,
    height: cardRect.height * 0.085
  )
  let trayPath = CGPath(
    roundedRect: trayRect,
    cornerWidth: trayRect.height / 2,
    cornerHeight: trayRect.height / 2,
    transform: nil
  )
  context.addPath(trayPath)
  context.setFillColor(NSColor(calibratedWhite: 1.0, alpha: 0.92).cgColor)
  context.fillPath()

  let innerRect = trayRect.insetBy(dx: trayRect.width * 0.08, dy: trayRect.height * 0.26)
  let innerPath = CGPath(
    roundedRect: innerRect,
    cornerWidth: innerRect.height / 2,
    cornerHeight: innerRect.height / 2,
    transform: nil
  )
  context.addPath(innerPath)
  context.setFillColor(NSColor(calibratedRed: 0.19, green: 0.40, blue: 0.94, alpha: 0.28).cgColor)
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
