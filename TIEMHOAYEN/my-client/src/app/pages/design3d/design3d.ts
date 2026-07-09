import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AfterViewInit,
  OnDestroy,
  ElementRef,
  ViewChild
} from '@angular/core';

import * as THREE from 'three';

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface FlowerDef {
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
export class Design3d implements AfterViewInit, OnDestroy {
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

  flowers: FlowerDef[] = [
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
    const existing = this.selectedFlowers.find(
      item => item.name === flower.name && item.selectedColor === color
    );

    if (existing) {
      existing.quantity++;
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
  }

  /**
   * Khi người dùng đổi màu ở dropdown: nếu đã có sẵn 1 entry khác cùng loại +
   * đúng màu mới đó rồi, gộp số lượng vào entry có sẵn và xóa entry đang đổi
   * (tránh bị tách thành 2 entry trùng tên trùng màu). Ngược lại thì đổi màu
   * bình thường, preload model nếu màu mới chưa từng load.
   */
  onColorChange(flower: SelectedFlower, newColor: string): void {
    const mergeTarget = this.selectedFlowers.find(
      item => item !== flower && item.name === flower.name && item.selectedColor === newColor
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
  }

  increaseQuantity(flower: SelectedFlower): void {
    flower.quantity++;
    this.renderBouquet();
  }

  decreaseQuantity(flower: SelectedFlower): void {
    if (flower.quantity > 1) {
      flower.quantity--;
      this.renderBouquet();
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
    flower.quantity = qty;
    this.renderBouquet();
  }

  removeFlower(flower: SelectedFlower): void {
    this.selectedFlowers = this.selectedFlowers.filter(
      item => item !== flower
    );
    this.renderBouquet();
  }

  getTotalFlowers(): number {
    return this.selectedFlowers.reduce(
      (total, flower) => total + flower.quantity,
      0
    );
  }

  getTotalTypes(): number {
    return this.selectedFlowers.length;
  }

  clearAllFlowers(): void {
    this.selectedFlowers = [];
    this.renderBouquet();
  }

  /**
   * Chụp ảnh khung canvas 3D hiện tại (đúng góc nhìn user đang xoay/zoom)
   * và tải file ảnh về máy. Thay cho nút "Lưu thiết kế" cũ vì thiết kế
   * không cần lưu ở server, chỉ cần xuất ảnh.
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

  ngAfterViewInit(): void {
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
      container.clientWidth / container.clientHeight,
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

    renderer.setSize(container.clientWidth, container.clientHeight);
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
    }
  }

  /**
   * Dọn dẹp khi component bị hủy: dừng animation loop, giải phóng renderer/controls,
   * gỡ canvas khỏi DOM. Quan trọng để tránh rò rỉ và tránh chồng canvas khi re-init.
   */
  ngOnDestroy(): void {
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
  private loadModel(
    modelPath: string,
    rotationOffset: [number, number, number]
  ): Promise<ModelEntry | null> {
    if (!modelPath) {
      return Promise.resolve(null);
    }

    const cached = this.modelCache.get(modelPath);
    if (cached) {
      return Promise.resolve(cached);
    }

    return new Promise(resolve => {
      this.loader.load(
        modelPath,
        (gltf: any) => {
          const model = gltf.scene;

          // Áp góc xoay thủ công trước khi đo, để Box3 phản ánh đúng
          // chiều cao thật theo phương thẳng đứng mong muốn.
          model.rotation.set(
            rotationOffset[0],
            rotationOffset[1],
            rotationOffset[2]
          );

          const box = new THREE.Box3().setFromObject(model);
          const size = box.getSize(new THREE.Vector3());
          const rawHeight = size.y || 1; // tránh chia cho 0
          const rawWidth = Math.max(size.x, size.z) || 1;

          // Scale theo chiều cao chuẩn trước, nhưng nếu bề ngang sau khi scale
          // vượt quá TARGET_MAX_WIDTH (loại tán xòe rộng như hoa baby) thì
          // scale nhỏ thêm theo bề ngang để tránh chồng lấn slot bên cạnh.
          let scale = this.TARGET_HEIGHT / rawHeight;
          if (rawWidth * scale > this.TARGET_MAX_WIDTH) {
            scale = this.TARGET_MAX_WIDTH / rawWidth;
          }
          const baseOffset = box.min.y;

          const entry: ModelEntry = { object: model, scale, baseOffset };
          this.modelCache.set(modelPath, entry);
          this.loadingPaths.delete(modelPath);
          resolve(entry);
        },
        undefined,
        (error: any) => {
          console.error('Lỗi load model:', modelPath, error);
          this.loadingPaths.delete(modelPath);
          resolve(null);
        }
      );
    });
  }

  /**
   * Preload model ngầm (không chặn UI), sau khi xong tự render lại bó hoa
   * nếu hoa đó vẫn còn trong danh sách đã chọn.
   */
  private preloadModel(
    modelPath: string,
    rotationOffset: [number, number, number]
  ): void {
    if (!modelPath || this.modelCache.has(modelPath) || this.loadingPaths.has(modelPath)) {
      return;
    }
    this.loadingPaths.add(modelPath);
    this.loadModel(modelPath, rotationOffset).then(() => {
      this.renderBouquet();
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
    this.roseGroup.clear();

    type Instance = { flower: SelectedFlower; entry: ModelEntry };

    // Gom instance theo từng loại hoa + màu (key riêng cho mỗi biến thể màu,
    // để 2 màu của cùng 1 loại — vd Hồng Đỏ và Hồng Hồng — không bị đè lên nhau)
    const groups = new Map<string, Instance[]>();
    for (const flower of this.selectedFlowers) {
      const path = this.getEffectiveModelPath(flower, flower.selectedColor);
      if (!path) continue;
      const entry = this.modelCache.get(path);
      if (!entry) continue;
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
