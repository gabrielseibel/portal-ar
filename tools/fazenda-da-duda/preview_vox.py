import bpy, sys, json, numpy as np, mathutils
argv=sys.argv[sys.argv.index("--")+1:]
d=np.load(argv[0]); col=d['col']; meta=json.load(open(argv[1])); out=argv[2]; view=argv[3] if len(argv)>3 else 'persp'
PAL=[(0,0,0)]+[tuple(int(h[i:i+2],16)/255 for i in (1,3,5)) for h in meta['palette']]
NX,NY,NZ=col.shape
verts=[];faces=[];cols=[]
occ=col>0
pad=np.pad(occ,1)
def srgb2lin(c): return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
dirs=[((1,0,0),[(1,0,0),(1,1,0),(1,1,1),(1,0,1)],0.8),((-1,0,0),[(0,1,0),(0,0,0),(0,0,1),(0,1,1)],0.8),
      ((0,1,0),[(1,1,0),(0,1,0),(0,1,1),(1,1,1)],0.7),((0,-1,0),[(0,0,0),(1,0,0),(1,0,1),(0,0,1)],0.9),
      ((0,0,1),[(0,0,1),(1,0,1),(1,1,1),(0,1,1)],1.0),((0,0,-1),[(0,1,0),(1,1,0),(1,0,0),(0,0,0)],0.5)]
xs,ys,zs=np.nonzero(occ)
for x,y,z in zip(xs,ys,zs):
    c=PAL[col[x,y,z]]
    j=0.92+0.16*((((x*73856093)^(y*19349663)^(z*83492791))&255)/255)
    for (dx,dy,dz),q,sh in dirs:
        if pad[x+1+dx,y+1+dy,z+1+dz]: continue
        b=len(verts)
        verts+= [(x+a,y+bb,z+cc) for a,bb,cc in q]
        faces.append((b,b+1,b+2,b+3)); cols.append(tuple(srgb2lin(min(1,ch*j)) for ch in c))
bpy.ops.wm.read_factory_settings(use_empty=True)
me=bpy.data.meshes.new('farm'); me.from_pydata(verts,[],faces); me.update()
ca=me.color_attributes.new('Col','FLOAT_COLOR','CORNER')
for i,p in enumerate(me.polygons):
    for li in p.loop_indices: ca.data[li].color=(*cols[i],1)
ob=bpy.data.objects.new('farm',me); bpy.context.scene.collection.objects.link(ob)
print('faces',len(faces))
sc=bpy.context.scene
cam=bpy.data.objects.new("cam",bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera=cam
if view=='top':
    cam.data.type='ORTHO'; cam.data.ortho_scale=130; cam.location=(NX/2,NY/2,100)
else:
    cam.location=(NX/2,-75,105); cam.rotation_euler=(0.82,0,0); cam.data.lens=40
cam.data.clip_end=1000
sc.render.engine='BLENDER_WORKBENCH'; sc.display.shading.color_type='VERTEX'; sc.display.shading.light='STUDIO'
sc.display.shading.show_shadows=True; sc.display.shading.show_cavity=True
sc.render.resolution_x=1300; sc.render.resolution_y=1000; sc.render.filepath=out
bpy.ops.render.render(write_still=True)
