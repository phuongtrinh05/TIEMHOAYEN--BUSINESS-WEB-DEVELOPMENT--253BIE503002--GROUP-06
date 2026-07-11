import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminApiService, AdminStaffAccount } from '../../services/admin-api.service';

type EmployeeStatusClass = 'active' | 'locked' | 'inactive';

type EmployeeView = AdminStaffAccount & {
  statusClass: EmployeeStatusClass;
  searchIndex: string;
};

@Component({
  selector: 'app-admin-account',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-account.html',
  styleUrl: './admin-account.css'
})
export class AdminAccount implements OnInit {
  showFilter = false;
  showMenu = false;
  showSortMenu = false;
  isAddingEmployee = false;
  isLoading = false;
  loadError = '';
  selectedRole = '';
  selectedDate = '';
  selectedStatus = '';
  filterStatus = 'all';
  sortAscending = true;
  editingEmployeeCode: string | null = null;
  searchKeyword = '';
  currentPage = 1;
  itemsPerPage = 10;
  activeSort = 'default';

  employees: EmployeeView[] = [];
  filteredEmployees: EmployeeView[] = [];

  constructor(
    private readonly adminApi: AdminApiService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadEmployees();
  }

  loadEmployees(): void {
    this.isLoading = true;
    this.loadError = '';

    this.adminApi.getStaffAccounts().subscribe({
      next: (response) => {
        this.employees = (response.accounts || []).map((employee) => this.toEmployeeView(employee));
        this.applyCurrentView();
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.employees = [];
        this.filteredEmployees = [];
        this.isLoading = false;
        this.loadError = 'Không thể tải danh sách tài khoản quản trị.';
        this.cdr.detectChanges();
      }
    });
  }

  filterByStatus(status: string): void {
    this.filterStatus = status;
    this.selectedStatus = status === 'all' ? '' : status;
    this.currentPage = 1;
    this.applyCurrentView();
  }

  get roleOptions(): string[] {
    return this.getUniqueOptions(this.employees.map((employee) => employee.role));
  }

  get statusOptions(): string[] {
    return this.getUniqueOptions(this.employees.map((employee) => employee.status));
  }

  openFilterPopup(): void {
    this.showFilter = !this.showFilter;
    this.showSortMenu = false;
    this.showMenu = false;
  }

  openSortPopup(): void {
    this.showSortMenu = !this.showSortMenu;
    this.showFilter = false;
    this.showMenu = false;
  }

  openActionMenu(): void {
    this.showMenu = !this.showMenu;
    this.showFilter = false;
    this.showSortMenu = false;
  }

  closeToolbarPopup(type: 'filter' | 'sort' | 'action'): void {
    if (type === 'filter') this.showFilter = false;
    if (type === 'sort') this.showSortMenu = false;
    if (type === 'action') this.showMenu = false;
  }

  sortByName(): void {
    this.filteredEmployees.sort((a, b) =>
      this.sortAscending
        ? a.name.localeCompare(b.name, 'vi')
        : b.name.localeCompare(a.name, 'vi')
    );

    this.sortAscending = !this.sortAscending;
  }

  startEdit(employee: EmployeeView): void {
    this.editingEmployeeCode = employee.code;
  }

  exportExcel(): void {
    console.log('Export Employee List');
  }

  toggleAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.filteredEmployees.forEach((employee) => {
      employee.selected = checked;
    });
  }

  get selectedCount(): number {
    return this.filteredEmployees.filter((employee) => employee.selected).length;
  }

  lockSelected(): void {
    this.filteredEmployees
      .filter((employee) => employee.selected)
      .forEach((employee) => {
        employee.status = 'Bị khóa';
        employee.statusClass = 'locked';
        employee.searchIndex = this.buildSearchIndex(employee);
      });
    this.showMenu = false;
  }

  unlockSelected(): void {
    this.filteredEmployees
      .filter((employee) => employee.selected)
      .forEach((employee) => {
        employee.status = 'Hoạt động';
        employee.statusClass = 'active';
        employee.searchIndex = this.buildSearchIndex(employee);
      });
    this.showMenu = false;
  }

  deleteEmployee(employee: EmployeeView): void {
    this.employees = this.employees.filter((item) => item.code !== employee.code);
    this.applyCurrentView();
  }

  deleteSelected(): void {
    const selectedCodes = new Set(
      this.filteredEmployees
        .filter((employee) => employee.selected)
        .map((employee) => employee.code)
    );

    if (!selectedCodes.size) return;

    this.employees = this.employees.filter((employee) => !selectedCodes.has(employee.code));
    this.showMenu = false;
    this.applyCurrentView();
  }

  generateEmployeeCode(): string {
    const maxNumber = Math.max(
      0,
      ...this.employees.map((employee) => Number(employee.code.replace('NV', '')) || 0)
    );

    return `NV${String(maxNumber + 1).padStart(3, '0')}`;
  }

  addEmployee(): void {
    const newEmployee = this.toEmployeeView({
      code: this.generateEmployeeCode(),
      name: '',
      email: '',
      phone: '',
      role: 'Nhân viên bán hàng',
      createdAt: new Date().toLocaleDateString('vi-VN'),
      createdDate: new Date().toISOString().slice(0, 10),
      status: 'Hoạt động',
      selected: false
    });

    this.employees = [newEmployee, ...this.employees];
    this.editingEmployeeCode = newEmployee.code;
    this.isAddingEmployee = true;
    this.applyCurrentView();
  }

  saveEmployee(employee: EmployeeView, event?: Event): void {
    event?.preventDefault();

    if (!employee.name || !employee.email || !employee.phone) return;

    employee.statusClass = this.getStatusClass(employee.status);
    employee.searchIndex = this.buildSearchIndex(employee);
    this.editingEmployeeCode = null;
    this.applyCurrentView();
  }

  searchEmployee(): void {
    this.currentPage = 1;
    this.applyCurrentView();
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredEmployees.length / this.itemsPerPage));
  }

  get pagedEmployees(): EmployeeView[] {
    const start = (this.currentPage - 1) * this.itemsPerPage;
    return this.filteredEmployees.slice(start, start + this.itemsPerPage);
  }

  get pages(): number[] {
    return Array.from({ length: this.totalPages }, (_, i) => i + 1);
  }

  goToPage(page: number): void {
    this.currentPage = page;
  }

  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
    }
  }

  previousPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
    }
  }

  applyFilter(): void {
    this.currentPage = 1;
    this.applyCurrentView();
    this.showFilter = false;
  }

  resetFilter(): void {
    this.selectedRole = '';
    this.selectedDate = '';
    this.selectedStatus = '';
    this.currentPage = 1;
    this.applyCurrentView();
  }

  sortBy(type: string): void {
    this.activeSort = type;
    this.showSortMenu = false;

    switch (type) {
      case 'newest':
        this.filteredEmployees.sort((a, b) => this.getEmployeeTime(b) - this.getEmployeeTime(a));
        break;

      case 'oldest':
        this.filteredEmployees.sort((a, b) => this.getEmployeeTime(a) - this.getEmployeeTime(b));
        break;

      case 'roleAZ':
        this.filteredEmployees.sort((a, b) => a.role.localeCompare(b.role, 'vi'));
        break;

      case 'roleZA':
        this.filteredEmployees.sort((a, b) => b.role.localeCompare(a.role, 'vi'));
        break;

      case '7days':
        this.filteredEmployees = this.filterByRecentDays(7);
        break;

      case '30days':
        this.filteredEmployees = this.filterByRecentDays(30);
        break;

      case 'default':
      default:
        this.applyCurrentView();
        break;
    }

    this.currentPage = 1;
  }

  trackByEmployeeCode(_index: number, employee: EmployeeView): string {
    return employee.code;
  }

  convertDate(dateStr: string): Date {
    const [day, month, year] = dateStr.split('/');
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  private applyCurrentView(): void {
    const keyword = this.normalizeText(this.searchKeyword);

    this.filteredEmployees = this.employees.filter((employee) => {
      const matchKeyword = !keyword || employee.searchIndex.includes(keyword);
      const matchRole = !this.selectedRole || employee.role === this.selectedRole;
      const matchDate =
        !this.selectedDate ||
        employee.createdDate === this.selectedDate ||
        employee.createdAt === this.selectedDate;
      const matchStatus =
        !this.selectedStatus ||
        this.normalizeText(employee.status) === this.normalizeText(this.selectedStatus);

      return matchKeyword && matchRole && matchDate && matchStatus;
    });

    if (this.currentPage > this.totalPages) {
      this.currentPage = this.totalPages;
    }
  }

  private filterByRecentDays(days: number): EmployeeView[] {
    const now = Date.now();
    return this.filteredEmployees.filter((employee) => {
      const time = this.getEmployeeTime(employee);
      if (!time) return false;

      const diff = (now - time) / (1000 * 60 * 60 * 24);
      return diff <= days;
    });
  }

  private toEmployeeView(employee: AdminStaffAccount): EmployeeView {
    const view: EmployeeView = {
      ...employee,
      selected: false,
      statusClass: this.getStatusClass(employee.status),
      searchIndex: ''
    };

    view.searchIndex = this.buildSearchIndex(view);
    return view;
  }

  private buildSearchIndex(employee: AdminStaffAccount): string {
    return this.normalizeText([
      employee.code,
      employee.name,
      employee.email,
      employee.phone,
      employee.role,
      employee.status
    ].join(' '));
  }

  private getUniqueOptions(values: string[]): string[] {
    const seen = new Set<string>();

    return values
      .map((value) => String(value || '').trim())
      .filter((value) => {
        if (!value) return false;

        const key = this.normalizeText(value);
        if (seen.has(key)) return false;

        seen.add(key);
        return true;
      });
  }

  private getStatusClass(status: string): EmployeeStatusClass {
    const key = this.normalizeText(status);

    if (key.includes('hoat dong')) return 'active';
    if (key.includes('khoa')) return 'locked';
    return 'inactive';
  }

  private getEmployeeTime(employee: EmployeeView): number {
    if (employee.createdDate) {
      const isoDate = new Date(employee.createdDate);
      return Number.isNaN(isoDate.getTime()) ? 0 : isoDate.getTime();
    }

    const displayDate = this.convertDate(employee.createdAt);
    return Number.isNaN(displayDate.getTime()) ? 0 : displayDate.getTime();
  }

  private normalizeText(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .trim();
  }
}
