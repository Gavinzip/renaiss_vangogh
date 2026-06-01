import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { PRIZE_GALLERY_ITEMS } from './prizeGalleryData'

const CONFIG = {
  spacingX: 38,
  pWidth: 16,
  pHeight: 16,
  camZ: 29,
  wallAngleY: -0.25,
  snapDelay: 200,
  lerpSpeed: 0.06,
}

export function PrizeGallery({ onActiveChange }: { onActiveChange?: (index: number) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    let disposed = false
    let frameId = 0
    let snapTimer = 0
    let currentScroll = 0
    let targetScroll = 0
    let lastActive = -1
    let touchStart = 0
    const mouse = { x: 0, y: 0 }

    const width = Math.max(container.clientWidth, 320)
    const height = Math.max(container.clientHeight, 420)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xf7f7f5)
    scene.fog = new THREE.Fog(0xf7f7f5, 10, 110)
    let responsiveCamZ = CONFIG.camZ

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000)
    camera.position.set(0, 0, CONFIG.camZ)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)

    scene.add(new THREE.AmbientLight(0xffffff, 0.72))
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.46)
    dirLight.position.set(10, 20, 10)
    scene.add(dirLight)

    const galleryGroup = new THREE.Group()
    galleryGroup.rotation.y = CONFIG.wallAngleY
    scene.add(galleryGroup)

    const totalGalleryWidth = PRIZE_GALLERY_ITEMS.length * CONFIG.spacingX
    const planeGeo = new THREE.PlaneGeometry(CONFIG.pWidth, CONFIG.pHeight)
    const shadowGeo = new THREE.PlaneGeometry(CONFIG.pWidth, CONFIG.pHeight)
    const outlineGeo = new THREE.EdgesGeometry(planeGeo)
    const paintingGroups: THREE.Group[] = []
    const materials: THREE.Material[] = []
    const textures: THREE.Texture[] = []
    const geometries: THREE.BufferGeometry[] = [planeGeo, shadowGeo, outlineGeo]
    const loader = new THREE.TextureLoader()

    function updateSceneSize(nextWidth: number, nextHeight: number) {
      responsiveCamZ = nextWidth < 640 ? 42 : nextWidth < 980 ? 34 : CONFIG.camZ
      galleryGroup.position.x = nextWidth < 640 ? 0 : nextWidth < 980 ? 3.5 : 9
      camera.fov = nextWidth < 640 ? 54 : 45
      camera.aspect = nextWidth / nextHeight
      camera.updateProjectionMatrix()
      renderer.setSize(nextWidth, nextHeight)
    }

    function snapToNearest() {
      const index = Math.round(targetScroll / CONFIG.spacingX)
      targetScroll = index * CONFIG.spacingX
    }

    function updateUI(scrollX: number) {
      const rawIndex = Math.round(scrollX / CONFIG.spacingX)
      const safeIndex = ((rawIndex % PRIZE_GALLERY_ITEMS.length) + PRIZE_GALLERY_ITEMS.length) % PRIZE_GALLERY_ITEMS.length
      if (safeIndex !== lastActive) {
        lastActive = safeIndex
        onActiveChange?.(safeIndex)
      }
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      targetScroll += event.deltaY * 0.1
      window.clearTimeout(snapTimer)
      snapTimer = window.setTimeout(snapToNearest, CONFIG.snapDelay)
    }

    const onTouchStart = (event: TouchEvent) => {
      touchStart = event.touches[0]?.clientX ?? 0
      window.clearTimeout(snapTimer)
    }

    const onTouchMove = (event: TouchEvent) => {
      event.preventDefault()
      const x = event.touches[0]?.clientX ?? touchStart
      const diff = touchStart - x
      targetScroll += diff * 0.6
      touchStart = x
      window.clearTimeout(snapTimer)
    }

    const onTouchEnd = () => snapToNearest()

    const onMouseMove = (event: MouseEvent) => {
      const bounds = container.getBoundingClientRect()
      mouse.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
      mouse.y = -(((event.clientY - bounds.top) / bounds.height) * 2 - 1)
    }

    const resizeObserver = new ResizeObserver(() => {
      updateSceneSize(Math.max(container.clientWidth, 320), Math.max(container.clientHeight, 420))
    })

    updateSceneSize(width, height)
    container.addEventListener('wheel', onWheel, { passive: false })
    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchmove', onTouchMove, { passive: false })
    container.addEventListener('touchend', onTouchEnd)
    container.addEventListener('mousemove', onMouseMove)
    resizeObserver.observe(container)

    PRIZE_GALLERY_ITEMS.forEach((item, index) => {
      const group = new THREE.Group()
      group.position.set(index * CONFIG.spacingX, 0, 0)

      const texture = loader.load(item.imageSrc, () => {
        texture.colorSpace = THREE.SRGBColorSpace
        texture.anisotropy = 8
        texture.needsUpdate = true
      })
      texture.colorSpace = THREE.SRGBColorSpace
      textures.push(texture)

      const mat = new THREE.MeshBasicMaterial({ map: texture })
      materials.push(mat)
      const mesh = new THREE.Mesh(planeGeo, mat)

      const outline = new THREE.LineSegments(outlineGeo, new THREE.LineBasicMaterial({ color: 0x1f2b3b }))
      materials.push(outline.material)

      const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.14 })
      materials.push(shadowMat)
      const shadow = new THREE.Mesh(shadowGeo, shadowMat)
      shadow.position.set(0.9, -0.9, -0.55)

      const lineLen = CONFIG.spacingX
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-lineLen / 2, 12.8, -1),
        new THREE.Vector3(lineLen / 2, 12.8, -1),
        new THREE.Vector3(-lineLen / 2, -12.8, -1),
        new THREE.Vector3(lineLen / 2, -12.8, -1),
      ])
      geometries.push(lineGeo)
      const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0xd5dde8 }))
      materials.push(lines.material)

      group.add(shadow)
      group.add(mesh)
      group.add(outline)
      group.add(lines)
      galleryGroup.add(group)
      paintingGroups.push(group)
    })

    const animate = () => {
      if (disposed) return
      frameId = window.requestAnimationFrame(animate)
      currentScroll += (targetScroll - currentScroll) * CONFIG.lerpSpeed
      const xMove = currentScroll * Math.cos(CONFIG.wallAngleY)
      const zMove = currentScroll * Math.sin(CONFIG.wallAngleY)
      camera.position.x = xMove
      camera.position.z = responsiveCamZ - zMove

      paintingGroups.forEach((group, index) => {
        const originalX = index * CONFIG.spacingX
        const distFromCam = currentScroll - originalX
        const shift = Math.round(distFromCam / totalGalleryWidth) * totalGalleryWidth
        group.position.x = originalX + shift
        group.visible = Math.abs(group.position.x - currentScroll) < CONFIG.spacingX * 0.9
      })

      camera.rotation.x = mouse.y * 0.05
      camera.rotation.y = -mouse.x * 0.05
      updateUI(currentScroll)
      renderer.render(scene, camera)
    }

    animate()

    return () => {
      disposed = true
      window.cancelAnimationFrame(frameId)
      window.clearTimeout(snapTimer)
      resizeObserver.disconnect()
      container.removeEventListener('wheel', onWheel)
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('touchend', onTouchEnd)
      container.removeEventListener('mousemove', onMouseMove)
      textures.forEach((texture) => texture.dispose())
      materials.forEach((material) => material.dispose())
      geometries.forEach((geometry) => geometry.dispose())
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [onActiveChange])

  return <div className="prize-gallery-canvas" ref={containerRef} aria-label="Scrollable prize gallery" />
}
