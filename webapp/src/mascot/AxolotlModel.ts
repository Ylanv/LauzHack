import {
  AmbientLight, CanvasTexture, DirectionalLight, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, NearestFilter,
  PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace, WebGLRenderer, type Object3D, type Texture,
} from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import modelJson from "./assets/axolotl-axa.gltf?raw"
import { MASCOT } from "./params"
import { drawFace, faceKey, FACE_SIZE } from "./face"
import type { Pose } from "./animator"

/**
 * three.js side of the mascot: loads the processed Blockbench model (inlined, no extra request), wraps it in pivot
 * groups and applies a Pose. Layers, outermost first:
 *
 *   root   - framing (fixed)
 *   float  - bobbing, reaction bounces, breathing scale
 *   head   - gaze and emotion rotations, pivot at the cube's centre (the cube is the axolotl's head and body)
 *   model  - the glTF scene turned to face the camera; gill and tail pivots inside it
 *   face   - 16x16 canvas over the front face (eyes, mouth, cheeks)
 */
export interface AxolotlScene {
  render(p: Pose): void
  resize(cssW: number, cssH: number): void
  dispose(): void
}

export async function createAxolotlScene(canvas: HTMLCanvasElement): Promise<AxolotlScene> {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power", premultipliedAlpha: true })
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = SRGBColorSpace

  const gltf = await new GLTFLoader().parseAsync(modelJson, "")
  const model = gltf.scene
  const disposables: { dispose(): void }[] = []
  model.traverse((o: Object3D) => {
    const m = o as Mesh
    if (!m.isMesh) return
    const old = m.material as MeshBasicMaterial | MeshLambertMaterial
    const map = old.map as Texture
    map.magFilter = map.minFilter = NearestFilter
    map.generateMipmaps = false
    // matte, flat-lit voxel look; one shared material for the whole model
    const mat = (model.userData.mat ??= new MeshLambertMaterial({ map, alphaTest: 0.5, side: DoubleSide })) as MeshLambertMaterial
    if (old !== mat) old.dispose()
    m.material = mat
    disposables.push(m.geometry)
  })
  disposables.push(model.userData.mat, (model.userData.mat as MeshLambertMaterial).map!)

  // gills pivot on the edge where they meet the head, the tail on the back face (its node already sits there)
  const named = (n: string) => model.getObjectByName(n)!
  const gills = named("gills")
  const pivots = ["R", "L"].map((n) => {
    const g = named(n), side = Math.sign(g.position.x)
    const pivot = new Group()
    // pivot on the body edge at the gill's own height; the gill keeps its original place (only its parent changes)
    pivot.position.set(0.25 * side, g.position.y, g.position.z)
    g.position.set(g.position.x - 0.25 * side, 0, 0)
    pivot.add(g); gills.add(pivot)
    return { pivot, side }
  })
  const tail = named("tail")

  // face overlay, just in front of the -Z face of the body cube (cube: x,z in -0.25..0.25, y 0..0.5)
  const faceCanvas = document.createElement("canvas")
  faceCanvas.width = faceCanvas.height = FACE_SIZE
  const fctx = faceCanvas.getContext("2d")!
  const faceTex = new CanvasTexture(faceCanvas)
  faceTex.magFilter = faceTex.minFilter = NearestFilter
  faceTex.generateMipmaps = false
  faceTex.colorSpace = SRGBColorSpace
  const faceMat = new MeshLambertMaterial({ map: faceTex, alphaTest: 0.5, transparent: false })
  const faceGeo = new PlaneGeometry(0.5, 0.5)
  const face = new Mesh(faceGeo, faceMat)
  face.position.set(0, 0.25, -0.2502)
  face.rotation.y = Math.PI
  named("body").add(face)
  disposables.push(faceTex, faceMat, faceGeo)
  let lastFace = ""

  // contact shadow: grounds the mascot on any background (light UI or map), shrinks when it hops
  const sc = document.createElement("canvas")
  sc.width = sc.height = 64
  const sctx = sc.getContext("2d")!
  const grad = sctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, "rgba(0,0,40,0.38)"); grad.addColorStop(1, "rgba(0,0,40,0)")
  sctx.fillStyle = grad; sctx.fillRect(0, 0, 64, 64)
  const shadowTex = new CanvasTexture(sc)
  const shadowMat = new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
  const shadowGeo = new PlaneGeometry(1.1, 0.75)
  const shadow = new Mesh(shadowGeo, shadowMat)
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = -0.16
  disposables.push(shadowTex, shadowMat, shadowGeo)

  // hierarchy: model faces the camera (+Z) and is centred on the head pivot
  model.rotation.y = Math.PI
  model.position.set(0, -0.25, 0)
  const head = new Group(); head.add(model)
  const float = new Group(); float.add(head)
  float.position.y = 0.25
  const root = new Group(); root.add(float, shadow)
  root.position.y = -0.2

  const scene = new Scene()
  scene.add(root)
  scene.add(new AmbientLight(0xffffff, 2.1))
  const key = new DirectionalLight(0xffffff, 1.5)
  key.position.set(1.2, 2.4, 2)
  scene.add(key)

  const camera = new PerspectiveCamera(26, 1, 0.1, 20)
  camera.position.set(0, 0.75, 3.0)
  camera.lookAt(0, 0.02, 0)

  return {
    render(p) {
      float.position.y = 0.25 + p.y
      float.position.z = -p.z
      float.scale.set(p.scaleXZ, p.scaleY, p.scaleXZ)
      head.rotation.set(-p.pitch, p.yaw, -p.roll, "YXZ")
      for (const { pivot, side } of pivots) pivot.rotation.z = p.gill * side
      tail.rotation.y = p.tail
      const s = 1 - Math.min(0.45, p.lift * 2.2)
      shadow.scale.set(s, s, 1)
      shadowMat.opacity = s
      const fk = faceKey(p.face)
      if (fk !== lastFace) { lastFace = fk; drawFace(fctx, p.face); faceTex.needsUpdate = true }
      renderer.render(scene, camera)
    },
    resize(w, h) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MASCOT.maxDpr))
      renderer.setSize(w, h, false)
      camera.aspect = w / Math.max(h, 1)
      camera.updateProjectionMatrix()
    },
    dispose() {
      disposables.forEach((d) => d.dispose())
      renderer.dispose()
      ;(renderer as unknown as { forceContextLoss?: () => void }).forceContextLoss?.()
    },
  }
}
