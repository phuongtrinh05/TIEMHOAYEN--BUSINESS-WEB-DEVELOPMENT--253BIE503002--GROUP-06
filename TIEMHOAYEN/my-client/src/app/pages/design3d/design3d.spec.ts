import {TestBed} from '@angular/core/testing';
import {provideRouter} from '@angular/router';
import {of} from 'rxjs';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import * as THREE from 'three';
import {Design3d} from './design3d';
import {Design3dService} from '../../services/design3d.service';
import {CartService} from '../../services/cart.service';

// WebGL is unavailable in jsdom. Keep real scene geometry and mock only the GPU.
vi.mock('three',async importOriginal=>{
  const actual=await importOriginal<typeof import('three')>();
  return {...actual,WebGLRenderer:class {
    domElement=document.createElement('canvas');
    render=vi.fn();setSize=vi.fn();setPixelRatio=vi.fn();dispose=vi.fn();
  }};
});
vi.mock('three/examples/jsm/loaders/GLTFLoader.js',()=>({GLTFLoader:class {
  async parseAsync(){
    const scene=new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.CylinderGeometry(.05,.02,1),new THREE.MeshBasicMaterial()));
    return {scene};
  }
}}));

describe('3D material selection and asynchronous scene updates',()=>{
  beforeEach(async()=>{
    vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));
    vi.stubGlobal('cancelAnimationFrame',vi.fn());
    vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)}));
    await TestBed.configureTestingModule({imports:[Design3d],providers:[provideRouter([]),
      {provide:CartService,useValue:{}},
      {provide:Design3dService,useValue:{
        materials:()=>of({models:['rose'],materials:[{id:'NVL001',name:'Hoa hồng',unit:'cành',price:15000,available:189,threshold:220,modelKey:'rose',colors:['Đỏ','Hồng']}]}),
        estimate:()=>of({price:45000,requiresReview:true,badges:[],materials:[]})
      }}
    ]}).compileComponents();
  });
  afterEach(()=>{TestBed.resetTestingModule();vi.unstubAllGlobals();});

  it('shows materials and renders three selected roses after the model resolves',async()=>{
    const fixture=TestBed.createComponent(Design3d);
    fixture.detectChanges();
    const page=fixture.componentInstance;
    expect(page.flowers.length).toBe(1);
    expect(page.rendererReady).toBe(true);
    page.addFlowerWithColor(page.flowers[0],'Đỏ');
    page.addFlowerWithColor(page.flowers[0],'Đỏ');
    page.addFlowerWithColor(page.flowers[0],'Đỏ');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(page.selectedFlowers[0].quantity).toBe(3);
    expect((page as any).roseGroup.children.length).toBe(3);
    expect(page.modelsLoading()).toBe(0);
    expect(page.modelError()).toBe('');
    await vi.waitFor(()=>expect(page.quoteLoading).toBe(false));
    expect(page.quoteLoading).toBe(false);
    expect(page.quote?.price).toBe(45000);
    expect((page as any).renderer.render).toHaveBeenCalled();
    const camera=(page as any).camera as THREE.PerspectiveCamera;
    camera.updateMatrixWorld(true);
    const center=new THREE.Box3().setFromObject((page as any).roseGroup).getCenter(new THREE.Vector3()).project(camera);
    expect(Math.abs(center.x)).toBeLessThan(1);
    expect(Math.abs(center.y)).toBeLessThan(1);
    expect(Math.abs(center.z)).toBeLessThan(1);
  });

  it('reports failed model fetch and retries without adding extra flowers',async()=>{
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network'));
    const fixture=TestBed.createComponent(Design3d);fixture.detectChanges();
    const page=fixture.componentInstance;
    page.addFlowerWithColor(page.flowers[0],'Đỏ');
    await fixture.whenStable();fixture.detectChanges();
    expect(page.modelError()).not.toBe('');
    expect(page.modelsLoading()).toBe(0);
    page.retryModels();
    await fixture.whenStable();fixture.detectChanges();
    expect(page.modelError()).toBe('');
    expect((page as any).roseGroup.children.length).toBe(1);
    expect(page.selectedFlowers[0].quantity).toBe(1);
  });
});
