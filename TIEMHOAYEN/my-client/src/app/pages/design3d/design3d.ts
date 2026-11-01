import {apiBaseUrl} from '../../services/api-config';
import {Design3dService,DesignQuote} from '../../services/design3d.service';
import {CartService} from '../../services/cart.service';
import {Router} from '@angular/router';
import {inject,ChangeDetectorRef,DestroyRef,PLATFORM_ID,OnInit,signal,afterNextRender} from '@angular/core';
import {isPlatformBrowser} from '@angular/common';
import {map,timeout,finalize} from 'rxjs';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  OnDestroy,
  ElementRef,
  ViewChild
} from '@angular/core';

import * as THREE from 'three';

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface FlowerDef {
  materialId?: string; available?: number; price?: number; unit?: string; threshold?: number;
  name: string;
  image: string;
  colors: string[];
  modelPath: string; // '' nếu chưa có model 3D (dùng khi model dùng chung cho mọi màu)
  /**
   * Dùng khi mỗi màu có 1 file model riêng (vd hoa hồng đỏ/hồng là 2 file .glb khác nhau).
   * Nếu có field này, nó được ưu tiên hơn modelPath khi tính đường dẫn thực tế theo màu đang chọn.
   * Nếu màu đang chọn không có trong map, tự fallback về file đầu tiên có sẵn trong map.
   */
  modelPathsByColor?: Partial<Record<string, string>>;
  /**
   * Góc xoay thủ công (radian) để đưa model về đúng hướng thẳng đứng,
   * bông quay lên trên, thân quay xuống dưới. Chỉnh tay theo từng model
   * vì mỗi model do người khác dựng có hướng gốc khác nhau.
   * Mặc định [0, 0, 0] nếu model đã thẳng đứng sẵn (vd hoa hồng gốc).
   */
  rotationOffset?: [number, number, number];
}

interface ModelEntry {
  object: THREE.Object3D;
  // Hệ số scale tự tính để mọi loại hoa quy về cùng 1 chiều cao chuẩn
  scale: number;
  /**
   * Vị trí đáy thật (mép dưới bounding box) tính theo local space CHƯA scale.
   * Các file .glb khác người dựng có gốc tọa độ (pivot) khác nhau — có model
   * gốc nằm đúng đáy thân (baseOffset ≈ 0), có model gốc nằm giữa hoặc lệch.
   * Lưu lại để khi đặt vị trí có thể bù trừ, neo mọi loại hoa cùng ở đáy thân,
   * tránh loại này thấp hơn loại kia dù đã cùng chiều cao chuẩn.
   */
  baseOffset: number;
}

interface SelectedFlower extends FlowerDef {
  quantity: number;
  selectedColor: string;
}

@Component({
  selector: 'app-design3d',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './design3d.html',
  styleUrl: './design3d.css',
})
export class Design3d implements OnInit, OnDestroy {
  @ViewChild('threeCanvas', { static: true })
  threeCanvas!: ElementRef;

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;
  // Tạo mới mỗi lần ngAfterViewInit chạy (thay vì field dùng chung cố định),
  // để tránh trường hợp bị "cướp" sang scene khác nếu component init lại
  // (vd do HMR khi đang code) mà canvas cũ chưa được dọn sạch.
  private roseGroup!: THREE.Group;
  private animationFrameId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  // Vị trí camera + điểm nhìn mặc định, dùng để reset khi bấm "Quay lại"
  private readonly DEFAULT_CAMERA_POSITION = new THREE.Vector3(0, 0.6, 4);
  private readonly DEFAULT_TARGET = new THREE.Vector3(0, 0, 0);

  // Cache model đã load theo modelPath, kèm hệ số scale tự tính
  private modelCache = new Map<string, ModelEntry>();
  // Các modelPath đang trong quá trình load (tránh load trùng song song)
  private loadingPaths = new Set<string>();
  private failedPaths = new Set<string>();
  private modelRequests = new Map<string,AbortController>();
  readonly modelsLoading=signal(0);
  readonly modelError=signal('');
  private destroyed=false;

  private loader = new GLTFLoader();

  // Chiều cao chuẩn mà mọi loại hoa sẽ được scale về, để đồng đều kích cỡ
  private readonly TARGET_HEIGHT = 0.72;
  /**
   * Bề ngang (tán) tối đa cho phép sau khi scale, để những loại hoa tán xòe
   * rộng (vd hoa baby) không bị to đè lên hoa bên cạnh dù đã chuẩn hóa chiều cao.
   * Giá trị này nên nhỏ hơn khoảng cách giữa các slot khi xếp bó hoa.
   */
  private readonly TARGET_MAX_WIDTH = 0.12;

  showInfo = false;

  openInfo(): void {
    this.showInfo = true;
  }

  /**
   * Đưa camera + góc nhìn về đúng vị trí mặc định ban đầu (dùng cho nút "Quay lại"),
   * để user lỡ xoay/zoom lung tung vẫn có cách quay về khung hình chuẩn.
   */
  resetView(): void {
    if (!this.camera || !this.controls) return;
    this.camera.position.copy(this.DEFAULT_CAMERA_POSITION);
    this.controls.target.copy(this.DEFAULT_TARGET);
    this.controls.update();

    if (this.roseGroup?.children.length) {
      this.fitCameraToBouquet();
    }
  }

  isSidebarCollapsed = false;

  toggleSidebar(): void {
    this.isSidebarCollapsed = !this.isSidebarCollapsed;
  }

  /**
   * Map tên màu tiếng Việt sang mã màu hiển thị cho chấm tròn chọn màu
   * trong lưới "Các loại hoa".
   */
  private readonly colorSwatchMap: Record<string, string> = {
    'Đỏ': '#8B0000',
    'Hồng': '#FF7FAF',
    'Trắng': '#FFFFFF',
    'Vàng': '#FFD54F',
    'Tím': '#9B59B6'
  };

  getColorSwatch(color: string): string {
    return this.colorSwatchMap[color] ?? '#CCCCCC';
  }

  /**
   * Trả về danh sách màu THẬT SỰ có dữ liệu model riêng để hiển thị cho người dùng chọn.
   * - Nếu flower có modelPathsByColor: chỉ giữ những màu có key tương ứng trong đó
   *   (màu không có model sẽ fallback âm thầm sang model khác, dễ gây hiểu lầm nên ẩn đi).
   * - Nếu flower dùng modelPath dùng chung (không phân biệt theo màu): giữ nguyên
   *   toàn bộ danh sách màu như cũ.
   */
  getAvailableColors(flower: FlowerDef): string[] {
    if (flower.modelPathsByColor) {
      return flower.colors.filter(c => !!flower.modelPathsByColor![c]);
    }
    return flower.colors;
  }

  private modelLibrary: FlowerDef[] = [
    {
      name: 'Hoa Hồng',
      image: 'assets/images/design3d_hoahong.png',
      colors: ['Đỏ', 'Hồng'],
      modelPath: '', // dùng modelPathsByColor bên dưới thay vì 1 path chung
      modelPathsByColor: {
        'Đỏ': 'assets/images/design3d/design3d_hoahong_do.glb',
        'Hồng': 'assets/images/design3d/design3d_hoahong_hong.glb'
      },
      rotationOffset: [0, 0, 0]
    },
    {
      name: 'Hoa Ly',
      image: 'assets/images/design3d_ly.png',
      colors: ['Hồng'],
      modelPath: 'assets/images/design3d/design_hoaly.glb'
    },
    {
      name: 'Hoa Hướng Dương',
      image: 'assets/images/design3d_huongduong.png',
      colors: ['Vàng'],
      modelPath: 'assets/images/design3d/design3d_huongduong.glb',
      // TODO: model đang nằm ngang/xiên (xem ảnh) — chỉnh số dưới đây cho thẳng đứng
      rotationOffset: [0, 0, 0]
    },
    {
      name: 'Hoa Baby',
      image: 'assets/images/design3d_baby.png',
      colors: ['Trắng'],
      modelPath: 'assets/images/design3d/design3d_hoababy.glb'
    },
    {
      name: 'Hoa Đồng Tiền',
      image: 'assets/images/design3d_dongtien.png',
      colors: ['Đỏ'],
      modelPath: 'assets/images/design3d/design3d_dongtien.glb'
    },
    {
      name: 'Hoa Cẩm Chướng',
      image: 'assets/images/design3d_camchuong.png',
      colors: ['Hồng'],
      modelPath: 'assets/images/design3d/design3d_camchuong.glb'
    },
    {
      name: 'Hoa Cúc',
      image: 'assets/images/design3d_cuc.png',
      colors: ['Trắng'],
      modelPath: 'assets/images/design3d/design3d_cuc.glb',
      // TODO: theo ảnh, hoa cúc + hoa hồng đang chung 1 cụm cây cao —
      // nếu cuc.glb thực ra là model "cây" (gồm cả thân dài), xoay/cắt tùy bạn kiểm tra lại
      rotationOffset: [0, 0, 0]
    },
    {
      name: 'Hoa Huệ',
      image: 'assets/images/design3d_hue.png',
      colors: ['Trắng'],
      modelPath: 'assets/images/design3d/design3d_hoahue.glb'
    },
    {
      name: 'Hoa Tulip',
      image: 'assets/images/design3d_tulip.png',
      colors: ['Hồng', 'Trắng'],
      modelPath: '', // dùng modelPathsByColor bên dưới thay vì 1 path chung
      modelPathsByColor: {
        'Hồng': 'assets/images/design3d/design3d_tulip_hong.glb',
        'Trắng': 'assets/images/design3d/design3d_tulip_trang.glb'
      },
      // TODO: model đang nằm xiên (xem ảnh) — chỉnh số dưới đây cho thẳng đứng
      rotationOffset: [0, 0, 0]
    },
    {
      name: 'Hoa Sen',
      image: 'assets/images/design3d_sen.png',
      colors: ['Hồng'],
      modelPath: 'assets/images/design3d/design3d_hoasen.glb'
    },
    {
      name: 'Hoa Cát Tường',
      image: 'assets/images/design3d_cattuong.png',
      colors: ['Tím'],
      modelPath: 'assets/images/design3d/design3d_cattuong.glb'
    },
    {
      name: 'Hoa Lan',
      image: 'assets/images/design3d_lan.png',
      colors: ['Tím'],
      modelPath: 'assets/images/design3d/design3d_hoalan.glb'
    }
  ];

  private designApi=inject(Design3dService);
  private cartApi=inject(CartService);
  private router=inject(Router);
  private cdr=inject(ChangeDetectorRef);
  private readonly destroyRef=inject(DestroyRef);
  private readonly isBrowser=isPlatformBrowser(inject(PLATFORM_ID));
  private readonly materialsState=signal<FlowerDef[]>([]);
  private readonly materialsLoading=signal(false);
  get flowers():FlowerDef[]{return this.materialsState();}
  set flowers(value:FlowerDef[]){this.materialsState.set(value);}
  get loadingMaterials():boolean{return this.materialsLoading();}
  set loadingMaterials(value:boolean){this.materialsLoading.set(value);}
  materialLoadError='';
  rendererError='';
  rendererReady=false;
  ngOnInit():void { if(this.isBrowser)this.loadDesignMaterials(); }
  private readonly quoteState=signal<DesignQuote | null>(null);
  private readonly quotePending=signal(false);
  get quote():DesignQuote | null{return this.quoteState();}
  set quote(value:DesignQuote | null){this.quoteState.set(value);}
  get quoteLoading():boolean{return this.quotePending();}
  set quoteLoading(value:boolean){this.quotePending.set(value);}
  designError=''; designMessage=''; savingDesign=false;
  private quoteTimer?: ReturnType<typeof setTimeout>;
  private quoteVersion=0;
  loadDesignMaterials():void {
    if(!this.isBrowser || this.loadingMaterials)return;
    this.loadingMaterials=true;
    this.materialLoadError='';
    this.designApi.materials().pipe(
      timeout(15000),
      map(result=>{
        if(!Array.isArray(result?.materials) || !Array.isArray(result?.models))throw new Error('Invalid 3D material response');
        return result.materials.map(m=>{
          const index=result.models.indexOf(m.modelKey),base=index>=0?this.modelLibrary[index]:undefined;
          const colors=m.colors?.length?m.colors:(base?.colors || (m.color?[m.color]:[]));
          return {...base,name:m.name,image:m.image?(m.image.startsWith('/uploads/')?this.backendHost()+m.image:m.image):(base?.image || 'assets/images/flower_default.png'),
            materialId:m.id,unit:m.unit,available:m.available,price:m.price,threshold:m.threshold,colors,modelPath:base?.modelPath || ''};
        });
      }),
      finalize(()=>{this.loadingMaterials=false;this.cdr.markForCheck();}),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next:flowers=>{this.flowers=flowers;this.cdr.markForCheck();},
      error:e=>{this.materialLoadError=e.name==='TimeoutError'?'Tải nguyên vật liệu quá lâu. Bạn thử lại nhé.':e.error?.message || 'Không tải được nguyên vật liệu thiết kế. Bạn thử lại nhé.';this.cdr.markForCheck();}
    });
  }
  private backendHost():string {return this.designApiUrl().replace(/\/api$/,'');}
  private designApiUrl():string {return apiBaseUrl();}
  private materialLines(){
    const lines=new Map<string,{materialId:string;quantity:number;colors?:{color:string;quantity:number}[]}>();
    for(const f of this.selectedFlowers){
      const id=f.materialId!;
      const line=lines.get(id)||{materialId:id,quantity:0,colors:[]};
      line.quantity+=f.quantity;
      if(f.selectedColor)line.colors!.push({color:f.selectedColor,quantity:f.quantity});
      lines.set(id,line);
    }
    return [...lines.values()].map(l=>({...l,...(!l.colors?.length?{colors:undefined}:{})}));
  }
  refreshQuote():void {
    const version=++this.quoteVersion;
    if(this.quoteTimer)clearTimeout(this.quoteTimer);
    this.designMessage='';this.quote=null;
    if(!this.selectedFlowers.length){this.quoteLoading=false;return;}
    this.quoteLoading=true;
    this.quoteTimer=setTimeout(()=>this.designApi.estimate(this.materialLines()).pipe(timeout(15000),takeUntilDestroyed(this.destroyRef)).subscribe({next:q=>{if(version!==this.quoteVersion)return;this.quote=q;this.quoteLoading=false;this.cdr.markForCheck();},error:e=>{if(version!==this.quoteVersion)return;this.designError=e.error?.message || 'Chưa tính được giá.';this.quoteLoading=false;this.cdr.markForCheck();}}),250);
  }
  orderDesign():void {
    if(this.savingDesign || this.quoteLoading || !this.selectedFlowers.length || !this.renderer)return;
    this.savingDesign=true;this.designError='';
    this.renderer.render(this.scene,this.camera);
    const canvas=document.createElement('canvas');canvas.width=480;canvas.height=480;
    canvas.getContext('2d')?.drawImage(this.renderer.domElement,0,0,480,480);
    const image=canvas.toDataURL('image/jpeg',.7);
    this.designApi.save(this.materialLines(),image).subscribe({next:d=>{
      let customer:any=null;try{customer=JSON.parse(localStorage.getItem('khachHang') || 'null');}catch{}
      if(customer?.KHACH_HANG_ID){this.cartApi.addItem(customer.KHACH_HANG_ID,d.productId,1).subscribe({next:()=>{this.savingDesign=false;this.router.navigate(['/cart']);},error:e=>{this.savingDesign=false;this.designError=e.error?.message || 'Chưa thêm được vào giỏ.';this.cdr.markForCheck();}});}
      else {try{const raw=JSON.parse(localStorage.getItem('tiemHoaYenCart') || '[]');const cart=Array.isArray(raw)?raw:[];
        cart.push({id:d.productId,designId:d.designId,name:d.name,style:'Thiết kế 3D',quantity:1,price:d.price,image:d.image,selected:true,requiresReview:d.requiresReview,badges:d.badges});
        localStorage.setItem('tiemHoaYenCart',JSON.stringify(cart));window.dispatchEvent(new Event('cart-changed'));this.savingDesign=false;this.router.navigate(['/cart']);
      }catch{this.savingDesign=false;this.designError='Giỏ hàng lưu trên máy đã đầy. Hãy xóa bớt thiết kế hoặc đăng nhập rồi thử lại.';this.cdr.markForCheck();}}
    },error:e=>{this.savingDesign=false;this.designError=e.error?.message || 'Chưa lưu được thiết kế.';this.cdr.markForCheck();}});
  }

  selectedFlowers: SelectedFlower[] = [];

  /**
   * Tính đường dẫn model thực tế cần dùng, dựa theo màu đang chọn.
   * Ưu tiên modelPathsByColor[color]; nếu không có màu đó, fallback về
   * file đầu tiên có sẵn trong map; nếu flower không có modelPathsByColor
   * thì dùng modelPath dùng chung như cũ.
   */
  private getEffectiveModelPath(flower: FlowerDef, color: string): string {
    if (flower.modelPathsByColor) {
      const byColor = flower.modelPathsByColor[color];
      if (byColor) return byColor;
      const fallback = Object.values(flower.modelPathsByColor).find(Boolean);
      return fallback ?? '';
    }
    return flower.modelPath;
  }

  addFlower(flower: FlowerDef): void {
    this.addFlowerWithColor(flower, flower.colors[0]);
  }

  /**
   * Thêm hoa với 1 màu cụ thể được chỉ định (vd bấm chấm màu trong lưới thư viện).
   * So khớp entry hiện có theo tên + đúng màu đó; nếu chưa có thì tạo entry mới —
   * nhờ vậy có thể trộn nhiều màu của cùng 1 loại hoa (vd Hoa Hồng Đỏ + Hồng).
   */
  addFlowerWithColor(flower: FlowerDef, color: string): void {
    if(!flower.materialId || !(Number(flower.available)>0)){this.designError='NVL hiện hết khả dụng. Chọn NVL khác hoặc trao đổi với shop.';return;}
    this.designError='';
    const existing = this.selectedFlowers.find(
      item => item.materialId === flower.materialId && item.selectedColor === color
    );

    if (existing) {
      existing.quantity=Math.min(1000,existing.quantity+1);
    } else {
      this.selectedFlowers.push({
        ...flower,
        quantity: 1,
        selectedColor: color
      });

      // Nếu hoa này có model (chung hoặc theo màu) nhưng chưa từng load, preload luôn
      const path = this.getEffectiveModelPath(flower, color);
      if (path) {
        this.preloadModel(path, flower.rotationOffset ?? [0, 0, 0]);
      }
    }

    this.renderBouquet();
    this.refreshQuote();
  }

  /**
   * Khi người dùng đổi màu ở dropdown: nếu đã có sẵn 1 entry khác cùng loại +
   * đúng màu mới đó rồi, gộp số lượng vào entry có sẵn và xóa entry đang đổi
   * (tránh bị tách thành 2 entry trùng tên trùng màu). Ngược lại thì đổi màu
   * bình thường, preload model nếu màu mới chưa từng load.
   */
  onColorChange(flower: SelectedFlower, newColor: string): void {
    const mergeTarget = this.selectedFlowers.find(
      item => item !== flower && item.materialId === flower.materialId && item.selectedColor === newColor
    );

    if (mergeTarget) {
      mergeTarget.quantity += flower.quantity;
      this.selectedFlowers = this.selectedFlowers.filter(item => item !== flower);
    } else {
      flower.selectedColor = newColor;
      const path = this.getEffectiveModelPath(flower, newColor);
      if (path) {
        this.preloadModel(path, flower.rotationOffset ?? [0, 0, 0]);
      }
    }

    this.renderBouquet();
    this.refreshQuote();
  }

  increaseQuantity(flower: SelectedFlower): void {
    flower.quantity=Math.min(1000,flower.quantity+1);
    this.renderBouquet();
    this.refreshQuote();
  }

  decreaseQuantity(flower: SelectedFlower): void {
    if (flower.quantity > 1) {
      flower.quantity--;
      this.renderBouquet();
    this.refreshQuote();
    }
  }

  /**
   * Xử lý khi người dùng nhập tay số lượng vào ô input.
   * Ép về số nguyên >= 1 để tránh giá trị rỗng/âm/thập phân.
   */
  onQuantityChange(flower: SelectedFlower, value: number): void {
    let qty = Math.floor(Number(value));
    if (!qty || qty < 1) {
      qty = 1;
    }
    flower.quantity = Math.min(1000,qty);
    this.renderBouquet();
    this.refreshQuote();
  }

  removeFlower(flower: SelectedFlower): void {
    this.selectedFlowers = this.selectedFlowers.filter(
      item => item !== flower
    );
    this.renderBouquet();
    this.refreshQuote();
  }

  getTotalFlowers(): number {
    return this.selectedFlowers.reduce(
      (total, flower) => total + flower.quantity,
      0
    );
  }

  getTotalTypes(): number {
    return new Set(this.selectedFlowers.map(f=>f.materialId)).size;
  }

  clearAllFlowers(): void {
    this.selectedFlowers = [];
    this.renderBouquet();
    this.refreshQuote();
  }

  /**
   * Chụp ảnh khung canvas 3D hiện tại (đúng góc nhìn user đang xoay/zoom)
   * và tải file ảnh về máy. Nút đặt mẫu lưu bản thiết kế riêng trên server.
   */
  captureImage(): void {
    if (!this.renderer || !this.scene || !this.camera) return;

    // Render lại 1 frame ngay trước khi chụp để đảm bảo buffer mới nhất
    this.renderer.render(this.scene, this.camera);

    const dataUrl = this.renderer.domElement.toDataURL('image/png');

    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.href = dataUrl;
    link.download = `bo-hoa-3d_${timestamp}.png`;
    link.click();
  }

  constructor() {
    afterNextRender(()=>{
    if(this.destroyed)return;
    try { this.initializeScene();this.rendererReady=true; }
    catch(error){this.rendererError='Không khởi tạo được khung 3D. Hãy tải lại trang hoặc kiểm tra hỗ trợ đồ họa của trình duyệt.';console.error('3D renderer initialization failed',error);}
    this.cdr.markForCheck();
    });
  }

  private initializeScene(): void {
    const container = this.threeCanvas.nativeElement;

    // Dọn sạch canvas cũ nếu container đã từng có (vd do HMR/re-init trước đó
    // chưa gọi ngOnDestroy kịp) — tránh nhiều canvas chồng lên nhau.
    container.innerHTML = '';

    const scene = new THREE.Scene();
    this.scene = scene;
    this.roseGroup = new THREE.Group();
    scene.add(this.roseGroup);
    scene.background = new THREE.Color(0xffffff);

    const camera = new THREE.PerspectiveCamera(
      45,
      Math.max(1,container.clientWidth) / Math.max(1,container.clientHeight),
      0.1,
      1000
    );

    camera.position.copy(this.DEFAULT_CAMERA_POSITION);
    camera.lookAt(this.DEFAULT_TARGET);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true // cần để có thể chụp ảnh canvas (toDataURL)
    });

    renderer.setSize(Math.max(1,container.clientWidth), Math.max(1,container.clientHeight));
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);
    this.camera = camera;
    this.renderer = renderer;
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.copy(this.DEFAULT_TARGET);
    this.controls = controls;

    // Theo dõi kích thước thật của container: header/logo có thể load xong
    // và làm layout đổi chiều cao SAU khi ngAfterViewInit đã chạy, khiến
    // clientWidth/clientHeight đo lúc đầu bị sai → camera/canvas lệch khung.
    this.resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    this.resizeObserver.observe(container);

    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(2, 4, 5);
    scene.add(light);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
    scene.add(ambientLight);

    const animate = () => {
      this.animationFrameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };

    animate();

    // Nếu component có sẵn hoa đã chọn từ trước (state giữ lại), render lại ngay
    if (this.selectedFlowers.length > 0) {
      this.renderBouquet();
    this.refreshQuote();
    }
  }

  /**
   * Dọn dẹp khi component bị hủy: dừng animation loop, giải phóng renderer/controls,
   * gỡ canvas khỏi DOM. Quan trọng để tránh rò rỉ và tránh chồng canvas khi re-init.
   */
  ngOnDestroy(): void {
    this.destroyed=true;
    this.modelRequests.forEach(controller=>controller.abort());
    if(this.quoteTimer)clearTimeout(this.quoteTimer);
    ++this.quoteVersion;

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.resizeObserver?.disconnect();
    this.controls?.dispose();
    this.renderer?.dispose();
    const container = this.threeCanvas?.nativeElement;
    if (container) {
      container.innerHTML = '';
    }
  }

  /**
   * Load 1 model theo path, áp rotationOffset thủ công, rồi đo Box3 để
   * tự tính hệ số scale quy về TARGET_HEIGHT chung cho mọi loại hoa.
   * Lưu kết quả vào cache. Nếu đã có trong cache, không load lại.
   */
  private async loadModel(
    modelPath: string,
    rotationOffset: [number, number, number]
  ): Promise<ModelEntry | null> {
    const cached=this.modelCache.get(modelPath);
    if(cached)return cached;
    const controller=new AbortController();
    this.modelRequests.set(modelPath,controller);
    const timer=setTimeout(()=>controller.abort(),25000);
    try {
      const url=new URL(modelPath,document.baseURI);
      const response=await fetch(url,{signal:controller.signal});
      if(!response.ok)throw new Error(`Model HTTP ${response.status}`);
      const data=await response.arrayBuffer();
      const gltf=await this.loader.parseAsync(data,new URL('.',url).href);
      if(this.destroyed)return null;
      const model=gltf.scene;
      model.rotation.set(...rotationOffset);
      model.updateMatrixWorld(true);
      const box=new THREE.Box3().setFromObject(model);
      if(box.isEmpty())throw new Error('Empty model');
      const size=box.getSize(new THREE.Vector3());
      let scale=this.TARGET_HEIGHT/(size.y || 1);
      const rawWidth=Math.max(size.x,size.z) || 1;
      if(rawWidth*scale>this.TARGET_MAX_WIDTH)scale=this.TARGET_MAX_WIDTH/rawWidth;
      const entry={object:model,scale,baseOffset:box.min.y};
      this.modelCache.set(modelPath,entry);
      this.failedPaths.delete(modelPath);
      return entry;
    } catch(error) {
      if(!this.destroyed){
        this.failedPaths.add(modelPath);
        this.modelError.set('Chưa tải được mô hình hoa. Bấm thử lại để dựng bó hoa.');
        console.error('Không tải được mô hình 3D',modelPath,error);
      }
      return null;
    } finally {
      clearTimeout(timer);
      this.modelRequests.delete(modelPath);
      this.loadingPaths.delete(modelPath);
      this.modelsLoading.set(this.loadingPaths.size);
    }
  }

  retryModels():void {
    this.failedPaths.clear();this.modelError.set('');
    this.renderBouquet();
  }

  /**
   * Preload model ngầm (không chặn UI), sau khi xong tự render lại bó hoa
   * nếu hoa đó vẫn còn trong danh sách đã chọn.
   */
  private preloadModel(
    modelPath: string,
    rotationOffset: [number, number, number]
  ): void {
    if (this.destroyed || !modelPath || this.modelCache.has(modelPath) || this.loadingPaths.has(modelPath) || this.failedPaths.has(modelPath)) {
      return;
    }
    this.loadingPaths.add(modelPath);
    this.modelsLoading.set(this.loadingPaths.size);
    this.loadModel(modelPath, rotationOffset).then(entry => {
      if(!this.destroyed && entry)this.renderBouquet();
    });
  }

  /**
   * Render lại toàn bộ bó hoa dựa trên this.selectedFlowers.
   *
   * Cách xếp: theo kiểu "grouped/cluster" mà thợ cắm hoa hay dùng khi trộn
   * nhiều loại — mỗi loại hoa chiếm 1 múi góc (sector) riêng, tỉ lệ theo số
   * lượng, thay vì rải random khắp bó (dễ rối khi >2 loại). Loại có số lượng
   * nhiều nhất được ưu tiên đặt ở tâm (đóng vai trò hoa chính/focal).
   * Mỗi loại hoa dùng scale riêng (tự tính từ Box3) và rotationOffset riêng
   * (khai báo thủ công trong flowers[]) để đồng đều kích cỡ và đúng hướng,
   * cộng thêm chút random nhỏ (xoay trục đứng + lệch cao) để không bị đều
   * tăm tắp như bản sao robot.
   */
  renderBouquet(): void {
    if(!this.roseGroup || this.destroyed)return;
    this.roseGroup.clear();

    type Instance = { flower: SelectedFlower; entry: ModelEntry };

    // Gom instance theo từng loại hoa + màu (key riêng cho mỗi biến thể màu,
    // để 2 màu của cùng 1 loại — vd Hồng Đỏ và Hồng Hồng — không bị đè lên nhau)
    const groups = new Map<string, Instance[]>();
    for (const flower of this.selectedFlowers) {
      const path = this.getEffectiveModelPath(flower, flower.selectedColor);
      if (!path) continue;
      const entry = this.modelCache.get(path);
      if (!entry){this.preloadModel(path,flower.rotationOffset ?? [0,0,0]);continue;}
      const list: Instance[] = [];
      for (let i = 0; i < flower.quantity; i++) {
        list.push({ flower, entry });
      }
      const groupKey = `${flower.name}__${flower.selectedColor}`;
      groups.set(groupKey, list);
    }

    const totalCount = Array.from(groups.values()).reduce((sum, l) => sum + l.length, 0);
    if (totalCount === 0) {
      this.resetView();
      return;
    }

    // Loại nhiều bông nhất lên trước → được ưu tiên chiếm tâm + múi lớn hơn
    const isFillerGroup = (name: string) => name.includes('Hoa Baby');
    const orderedGroupNames = Array.from(groups.keys()).sort((a, b) => {
      const fillerDiff = Number(isFillerGroup(a)) - Number(isFillerGroup(b));
      if (fillerDiff !== 0) return fillerDiff;
      return groups.get(b)!.length - groups.get(a)!.length;
    });
    const sectorGroupNames = orderedGroupNames.filter(name => !isFillerGroup(name));
    const sectorTotalCount = sectorGroupNames.reduce(
      (sum, name) => sum + groups.get(name)!.length,
      0
    );

    // Giữ bố cục ring/sector cũ cho form hoa hồng, nhưng tách filler ra khỏi tâm.
    const sectors = new Map<string, { start: number; end: number }>();
    let cursor = 0;
    for (const name of sectorGroupNames) {
      const ratio = groups.get(name)!.length / sectorTotalCount;
      const width = ratio * Math.PI * 2;
      sectors.set(name, { start: cursor, end: cursor + width });
      cursor += width;
    }

    const slots: { angle: number; ringRadius: number; tilt: number; index: number }[] = [];
    slots.push({ angle: 0, ringRadius: 0, tilt: 0, index: 0 });

    const ringsConfig = [
      { count: 6, radius: 0.13, tilt: 0.2 },
      { count: 12, radius: 0.25, tilt: 0.4 },
      { count: 18, radius: 0.28, tilt: 0.52 },
      { count: 24, radius: 0.36, tilt: 0.65 },
      { count: 30, radius: 0.44, tilt: 0.78 },
    ];

    for (const ring of ringsConfig) {
      if (slots.length >= totalCount) break;
      for (let i = 0; i < ring.count; i++) {
        slots.push({
          angle: (i / ring.count) * Math.PI * 2,
          ringRadius: ring.radius,
          tilt: ring.tilt,
          index: slots.length,
        });
      }
    }

    // Hoa chính được ưu tiên ở tâm; filler như hoa baby chỉ lấp các slot vòng ngoài.
    const centerName = sectorGroupNames[0] ?? orderedGroupNames[0];
    const centerList = groups.get(centerName)!;
    const placements: { slot: typeof slots[number]; instance: Instance }[] = [];

    if (centerList.length > 0 && !isFillerGroup(centerName)) {
      placements.push({ slot: slots[0], instance: centerList.shift()! });
    }

    const remainingSlots = slots.slice(1);
    for (const slot of remainingSlots) {
      const name = sectorGroupNames.find(n => {
        const sec = sectors.get(n)!;
        return slot.angle >= sec.start && slot.angle < sec.end;
      });

      if (!name) {
        continue;
      }

      const list = groups.get(name)!;
      if (list.length > 0) {
        placements.push({ slot, instance: list.shift()! });
      }
    }

    const leftover: Instance[] = Array.from(groups.values()).flat();
    const firstLeftoverSlotIndex = placements.length === 0 ? 1 : placements.length;
    for (let i = firstLeftoverSlotIndex; i < slots.length && leftover.length > 0; i++) {
      placements.push({ slot: slots[i], instance: leftover.shift()! });
    }

    for (const { slot: s, instance } of placements) {
      const { flower, entry } = instance;
      const rotationOffset = flower.rotationOffset ?? [0, 0, 0];
      const isFiller = flower.name.includes('Hoa Baby');
      // Lệch chiều cao nhẹ ngẫu nhiên để tự nhiên hơn, không đều tăm tắp.
      const stemH = this.TARGET_HEIGHT * (0.94 + Math.random() * 0.12);
      // Xoay quanh trục đứng ngẫu nhiên để các bông cùng loại không giống hệt nhau.
      const randomYaw = Math.random() * Math.PI * 2;
      const ringRadius = isFiller ? s.ringRadius * 1.25 + 0.04 : s.ringRadius;
      const tilt = isFiller ? Math.min(s.tilt + 0.18, 0.82) : s.tilt;
      const modelScale = entry.scale * (isFiller ? 0.68 : 1);

      const outerGroup = new THREE.Group();
      const radialAxis = new THREE.Vector3(
        -Math.sin(s.angle), 0, Math.cos(s.angle)
      ).normalize();
      outerGroup.setRotationFromAxisAngle(radialAxis, tilt);
      outerGroup.position.set(
        Math.cos(s.angle) * ringRadius,
        -stemH,
        Math.sin(s.angle) * ringRadius,
      );

      const instanceModel = entry.object.clone(true);
      instanceModel.rotation.set(
        rotationOffset[0],
        rotationOffset[1] + randomYaw,
        rotationOffset[2]
      );
      instanceModel.scale.set(modelScale, modelScale, modelScale);
      // Neo đáy thật của model (baseOffset, đã tính theo local space chưa scale)
      // vào đúng độ cao stemH, để mọi loại hoa cùng chung 1 mốc đáy dù pivot
      // gốc từng file .glb khác nhau.
      instanceModel.position.set(0, stemH - entry.baseOffset * modelScale, 0);
      outerGroup.add(instanceModel);
      this.roseGroup.add(outerGroup);
    }

    this.fitCameraToBouquet();
    if(this.renderer && this.scene && this.camera)this.renderer.render(this.scene,this.camera);
  }

  /**
   * Tự điều chỉnh khoảng cách camera theo kích thước THẬT của bó hoa hiện tại
   * (đo bằng Box3), để bó hoa lớn (nhiều bông, nhiều vòng) không bị nhỏ tí và
   * xa như khi camera đứng cố định 1 khoảng cách bất kể số lượng hoa.
   * Giữ nguyên hướng nhìn hiện tại của user (không reset góc xoay), chỉ đẩy
   * camera ra xa/gần và cập nhật target về đúng tâm bó hoa.
   */
  private fitCameraToBouquet(): void {
    if (!this.camera || !this.controls) return;

    const box = new THREE.Box3().setFromObject(this.roseGroup);
    if (box.isEmpty()) return;

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim <= 0) return;

    const fovRad = (this.camera.fov * Math.PI) / 180;
    const paddingFactor = 1.4; // chừa khoảng trống quanh bó hoa, tránh sát viền
    const distance = (maxDim / 2 / Math.tan(fovRad / 2)) * paddingFactor;

    // Giữ hướng nhìn hiện tại (nếu user đã xoay), chỉ đổi khoảng cách + target
    let direction = this.camera.position.clone().sub(this.controls.target);
    if (direction.lengthSq() < 1e-6) {
      direction = this.DEFAULT_CAMERA_POSITION.clone().sub(this.DEFAULT_TARGET);
    }
    direction.normalize();

    this.controls.target.copy(center);
    this.camera.position.copy(center).add(direction.multiplyScalar(distance));
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }
}
