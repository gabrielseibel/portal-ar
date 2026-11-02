"""Converts the farmhouse FBX (with its painted textures) into a light GLB.

blender -b --factory-startup --python export_farmhouse.py -- <Stardew_Valley_Farmhouse.fbx> <out.glb>

- drops the separate grass disc (the farm ground is the base now)
- bakes transforms, puts the base centre at the origin, normalises the footprint to 1 unit
- textures halved (2048 -> 1024, 1024 -> 512) and stored as WebP; materials forced opaque
"""
import bpy, sys, mathutils

src, out = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)

for o in list(bpy.context.scene.objects):
    if o.type == 'MESH' and o.name.startswith('Circle'):
        bpy.data.objects.remove(o, do_unlink=True)

meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in meshes:
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw
for o in [o for o in bpy.context.scene.objects if o.type != 'MESH']:
    bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.select_all(action='SELECT')
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
ob.name = 'Farmhouse'

co = [v.co for v in ob.data.vertices]
mn = mathutils.Vector([min(c[i] for c in co) for i in range(3)])
mx = mathutils.Vector([max(c[i] for c in co) for i in range(3)])
size = mx - mn
s = 1.0 / max(size.x, size.y)
off = mathutils.Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
for v in ob.data.vertices:
    v.co = (v.co - off) * s
print('size (x,y,z) after normalisation', [round(c * s, 3) for c in size])

for img in bpy.data.images:
    if img.size[0] > 0:
        img.scale(max(256, img.size[0] // 2), max(256, img.size[1] // 2))
for m in bpy.data.materials:
    if not m.use_nodes:
        continue
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf:
        for l in list(bsdf.inputs['Alpha'].links):
            nt.links.remove(l)
        bsdf.inputs['Alpha'].default_value = 1.0
        bsdf.inputs['Roughness'].default_value = 0.85
        bsdf.inputs['Metallic'].default_value = 0.0
    m.blend_method = 'OPAQUE' if hasattr(m, 'blend_method') else None

bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_image_format='WEBP', export_yup=True,
                          export_apply=True, export_texcoords=True, export_normals=True, export_materials='EXPORT',
                          export_animations=False, export_cameras=False, export_lights=False)
