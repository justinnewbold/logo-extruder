import React, { useState, useRef, useCallback, useEffect, Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Stage } from '@react-three/drei'
import * as THREE from 'three'

// STL Exporter utility
function generateSTL(geometry) {
  const vertices = geometry.attributes.position.array
  const indices = geometry.index ? geometry.index.array : null
  
  let stl = 'solid logo\n'
  
  const addTriangle = (v1, v2, v3) => {
    // Calculate normal
    const edge1 = [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]]
    const edge2 = [v3[0] - v1[0], v3[1] - v1[1], v3[2] - v1[2]]
    const normal = [
      edge1[1] * edge2[2] - edge1[2] * edge2[1],
      edge1[2] * edge2[0] - edge1[0] * edge2[2],
      edge1[0] * edge2[1] - edge1[1] * edge2[0]
    ]
    const len = Math.sqrt(normal[0]**2 + normal[1]**2 + normal[2]**2)
    if (len > 0) {
      normal[0] /= len
      normal[1] /= len
      normal[2] /= len
    }
    
    stl += `  facet normal ${normal[0]} ${normal[1]} ${normal[2]}\n`
    stl += `    outer loop\n`
    stl += `      vertex ${v1[0]} ${v1[1]} ${v1[2]}\n`
    stl += `      vertex ${v2[0]} ${v2[1]} ${v2[2]}\n`
    stl += `      vertex ${v3[0]} ${v3[1]} ${v3[2]}\n`
    stl += `    endloop\n`
    stl += `  endfacet\n`
  }
  
  if (indices) {
    for (let i = 0; i < indices.length; i += 3) {
      const i1 = indices[i] * 3
      const i2 = indices[i + 1] * 3
      const i3 = indices[i + 2] * 3
      
      addTriangle(
        [vertices[i1], vertices[i1 + 1], vertices[i1 + 2]],
        [vertices[i2], vertices[i2 + 1], vertices[i2 + 2]],
        [vertices[i3], vertices[i3 + 1], vertices[i3 + 2]]
      )
    }
  } else {
    for (let i = 0; i < vertices.length; i += 9) {
      addTriangle(
        [vertices[i], vertices[i + 1], vertices[i + 2]],
        [vertices[i + 3], vertices[i + 4], vertices[i + 5]],
        [vertices[i + 6], vertices[i + 7], vertices[i + 8]]
      )
    }
  }
  
  stl += 'endsolid logo\n'
  return stl
}

// Image to 3D mesh converter
function processImageToMesh(imageData, width, height, settings) {
  const { threshold, extrudeHeight, baseHeight, scale, invert, smoothing } = settings
  
  // Convert to binary based on threshold
  const binary = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4
    const r = imageData[idx]
    const g = imageData[idx + 1]
    const b = imageData[idx + 2]
    const a = imageData[idx + 3]
    
    // Calculate luminance
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) * (a / 255)
    const isWhite = lum > threshold * 255
    binary[i] = invert ? (isWhite ? 1 : 0) : (isWhite ? 0 : 1)
  }
  
  // Apply simple smoothing if enabled
  if (smoothing > 0) {
    const smoothed = new Uint8Array(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0
        let count = 0
        const radius = Math.ceil(smoothing)
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              sum += binary[ny * width + nx]
              count++
            }
          }
        }
        smoothed[y * width + x] = sum / count > 0.5 ? 1 : 0
      }
    }
    for (let i = 0; i < binary.length; i++) {
      binary[i] = smoothed[i]
    }
  }
  
  // Generate 3D vertices
  const vertices = []
  const indices = []
  let vertexIndex = 0
  
  const scaleX = scale / Math.max(width, height)
  const scaleY = scale / Math.max(width, height)
  const offsetX = -width * scaleX / 2
  const offsetY = -height * scaleY / 2
  
  // Create heightmap mesh
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const idx = y * width + x
      
      // Get heights at corners
      const h00 = binary[idx] ? extrudeHeight : baseHeight
      const h10 = binary[idx + 1] ? extrudeHeight : baseHeight
      const h01 = binary[idx + width] ? extrudeHeight : baseHeight
      const h11 = binary[idx + width + 1] ? extrudeHeight : baseHeight
      
      // Calculate world positions
      const x0 = x * scaleX + offsetX
      const x1 = (x + 1) * scaleX + offsetX
      const y0 = y * scaleY + offsetY
      const y1 = (y + 1) * scaleY + offsetY
      
      // Top face - two triangles
      vertices.push(
        x0, h00, y0,
        x1, h10, y0,
        x0, h01, y1,
        x1, h10, y0,
        x1, h11, y1,
        x0, h01, y1
      )
      
      // Add side walls where height changes
      if (x === 0 || binary[idx] !== binary[idx - 1]) {
        // Left wall
        vertices.push(
          x0, 0, y0,
          x0, h00, y0,
          x0, 0, y1,
          x0, h00, y0,
          x0, h01, y1,
          x0, 0, y1
        )
      }
      
      if (y === 0 || binary[idx] !== binary[idx - width]) {
        // Front wall
        vertices.push(
          x0, 0, y0,
          x1, 0, y0,
          x0, h00, y0,
          x1, 0, y0,
          x1, h10, y0,
          x0, h00, y0
        )
      }
    }
  }
  
  // Add bottom face
  const bottomY = 0
  vertices.push(
    offsetX, bottomY, offsetY,
    offsetX + width * scaleX, bottomY, offsetY,
    offsetX, bottomY, offsetY + height * scaleY,
    offsetX + width * scaleX, bottomY, offsetY,
    offsetX + width * scaleX, bottomY, offsetY + height * scaleY,
    offsetX, bottomY, offsetY + height * scaleY
  )
  
  // Add outer walls
  const w = width * scaleX
  const h = height * scaleY
  const maxH = extrudeHeight
  
  // Right wall
  vertices.push(
    offsetX + w, 0, offsetY,
    offsetX + w, 0, offsetY + h,
    offsetX + w, maxH, offsetY,
    offsetX + w, 0, offsetY + h,
    offsetX + w, maxH, offsetY + h,
    offsetX + w, maxH, offsetY
  )
  
  // Back wall
  vertices.push(
    offsetX, 0, offsetY + h,
    offsetX + w, 0, offsetY + h,
    offsetX, maxH, offsetY + h,
    offsetX + w, 0, offsetY + h,
    offsetX + w, maxH, offsetY + h,
    offsetX, maxH, offsetY + h
  )
  
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.computeVertexNormals()
  
  return geometry
}

// 3D Preview component
function Model3D({ geometry }) {
  if (!geometry) return null
  
  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial 
        color="#00f5ff"
        metalness={0.3}
        roughness={0.4}
        emissive="#001a1a"
      />
    </mesh>
  )
}

// Main App component
function App() {
  const [image, setImage] = useState(null)
  const [imageData, setImageData] = useState(null)
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 })
  const [geometry, setGeometry] = useState(null)
  const [processing, setProcessing] = useState(false)
  const [toast, setToast] = useState(null)
  
  // Settings
  const [threshold, setThreshold] = useState(0.5)
  const [extrudeHeight, setExtrudeHeight] = useState(5)
  const [baseHeight, setBaseHeight] = useState(2)
  const [scale, setScale] = useState(100)
  const [invert, setInvert] = useState(false)
  const [smoothing, setSmoothing] = useState(1)
  
  const fileInputRef = useRef(null)
  const canvasRef = useRef(null)
  
  const showToast = (message, type = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }
  
  const handleFileSelect = useCallback((file) => {
    if (!file || !file.type.startsWith('image/')) {
      showToast('Please select an image file', 'error')
      return
    }
    
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        // Limit size for performance
        const maxSize = 256
        let width = img.width
        let height = img.height
        
        if (width > maxSize || height > maxSize) {
          const ratio = Math.min(maxSize / width, maxSize / height)
          width = Math.floor(width * ratio)
          height = Math.floor(height * ratio)
        }
        
        // Draw to canvas to get pixel data
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = 'white'
        ctx.fillRect(0, 0, width, height)
        ctx.drawImage(img, 0, 0, width, height)
        
        const data = ctx.getImageData(0, 0, width, height)
        setImageData(data.data)
        setImageDimensions({ width, height })
        setImage(e.target.result)
        setGeometry(null)
      }
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  }, [])
  
  const handleDrop = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    
    const file = e.dataTransfer.files[0]
    handleFileSelect(file)
  }, [handleFileSelect])
  
  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])
  
  const generateModel = useCallback(() => {
    if (!imageData) return
    
    setProcessing(true)
    
    // Use setTimeout to allow UI to update
    setTimeout(() => {
      try {
        const geo = processImageToMesh(
          imageData,
          imageDimensions.width,
          imageDimensions.height,
          { threshold, extrudeHeight, baseHeight, scale, invert, smoothing }
        )
        setGeometry(geo)
        showToast('3D model generated successfully!')
      } catch (err) {
        console.error(err)
        showToast('Error generating model', 'error')
      }
      setProcessing(false)
    }, 100)
  }, [imageData, imageDimensions, threshold, extrudeHeight, baseHeight, scale, invert, smoothing])
  
  const downloadSTL = useCallback(() => {
    if (!geometry) return
    
    try {
      const stl = generateSTL(geometry)
      const blob = new Blob([stl], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      
      const a = document.createElement('a')
      a.href = url
      a.download = 'logo-extruded.stl'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      
      showToast('STL file downloaded!')
    } catch (err) {
      console.error(err)
      showToast('Error downloading STL', 'error')
    }
  }, [geometry])
  
  // Calculate stats
  const triangleCount = geometry ? Math.floor(geometry.attributes.position.count / 3) : 0
  const vertexCount = geometry ? geometry.attributes.position.count : 0
  
  return (
    <div className="app-container">
      <header className="header">
        <div className="logo-icon">3D</div>
        <div className="header-text">
          <h1>LOGO EXTRUDER</h1>
          <p>Convert images to 3D printable STL files</p>
        </div>
      </header>
      
      <main className="main-content">
        <aside className="controls-panel">
          <div>
            <div className="section-title">Image Upload</div>
            <div 
              className={`upload-zone ${image ? 'has-image' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
            >
              {image ? (
                <img src={image} alt="Uploaded logo" className="preview-image" />
              ) : (
                <>
                  <div className="upload-icon">📁</div>
                  <p className="upload-text">
                    Drop your image here or <span>browse</span>
                  </p>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => handleFileSelect(e.target.files[0])}
              />
            </div>
          </div>
          
          <div className="control-group">
            <div className="section-title">Extrusion Settings</div>
            
            <div className="control-row">
              <label className="control-label">
                <span>Threshold</span>
                <span className="control-value">{Math.round(threshold * 100)}%</span>
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={threshold}
                onChange={(e) => setThreshold(parseFloat(e.target.value))}
              />
            </div>
            
            <div className="control-row">
              <label className="control-label">
                <span>Extrude Height</span>
                <span className="control-value">{extrudeHeight}mm</span>
              </label>
              <input
                type="range"
                min="1"
                max="20"
                step="0.5"
                value={extrudeHeight}
                onChange={(e) => setExtrudeHeight(parseFloat(e.target.value))}
              />
            </div>
            
            <div className="control-row">
              <label className="control-label">
                <span>Base Height</span>
                <span className="control-value">{baseHeight}mm</span>
              </label>
              <input
                type="range"
                min="0"
                max="10"
                step="0.5"
                value={baseHeight}
                onChange={(e) => setBaseHeight(parseFloat(e.target.value))}
              />
            </div>
            
            <div className="control-row">
              <label className="control-label">
                <span>Scale</span>
                <span className="control-value">{scale}mm</span>
              </label>
              <input
                type="range"
                min="20"
                max="200"
                step="5"
                value={scale}
                onChange={(e) => setScale(parseFloat(e.target.value))}
              />
            </div>
            
            <div className="control-row">
              <label className="control-label">
                <span>Smoothing</span>
                <span className="control-value">{smoothing}px</span>
              </label>
              <input
                type="range"
                min="0"
                max="5"
                step="0.5"
                value={smoothing}
                onChange={(e) => setSmoothing(parseFloat(e.target.value))}
              />
            </div>
            
            <div className="control-row">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={invert}
                  onChange={(e) => setInvert(e.target.checked)}
                />
                <span>Invert Colors</span>
              </label>
            </div>
          </div>
          
          <div>
            <button
              className="generate-btn primary"
              onClick={generateModel}
              disabled={!imageData || processing}
            >
              {processing ? (
                <span className="processing">
                  <span className="spinner"></span>
                  Processing...
                </span>
              ) : (
                'Generate 3D Model'
              )}
            </button>
          </div>
          
          {geometry && (
            <div>
              <button
                className="generate-btn secondary"
                onClick={downloadSTL}
              >
                ⬇ Download STL File
              </button>
            </div>
          )}
        </aside>
        
        <section className="preview-panel">
          <div className="canvas-container">
            {geometry ? (
              <>
                <Canvas camera={{ position: [0, 100, 150], fov: 50 }}>
                  <Suspense fallback={null}>
                    <Stage environment="city" intensity={0.6}>
                      <Model3D geometry={geometry} />
                    </Stage>
                    <OrbitControls 
                      enablePan={true}
                      enableZoom={true}
                      enableRotate={true}
                      autoRotate={true}
                      autoRotateSpeed={1}
                    />
                  </Suspense>
                </Canvas>
                <div className="preview-overlay">
                  Drag to rotate • Scroll to zoom • <span>Auto-rotating</span>
                </div>
              </>
            ) : (
              <div className="empty-preview">
                <div className="empty-preview-icon">🎨</div>
                <p>Upload an image and generate a 3D model</p>
              </div>
            )}
          </div>
          
          {geometry && (
            <div className="stats-bar">
              <div className="stat-item">
                <span className="stat-label">Triangles</span>
                <span className="stat-value">{triangleCount.toLocaleString()}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Vertices</span>
                <span className="stat-value">{vertexCount.toLocaleString()}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Dimensions</span>
                <span className="stat-value">{scale}mm × {scale}mm × {extrudeHeight}mm</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Resolution</span>
                <span className="stat-value">{imageDimensions.width} × {imageDimensions.height}px</span>
              </div>
            </div>
          )}
        </section>
      </main>
      
      {toast && (
        <div className={`toast ${toast.type}`}>
          <span>{toast.type === 'success' ? '✓' : '✕'}</span>
          {toast.message}
        </div>
      )}
    </div>
  )
}

export default App
