import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, Inject, OnInit, PLATFORM_ID, ViewChild } from '@angular/core';
import { BaseChartDirective } from 'ng2-charts';
import {
  AdminApiService,
  AdminDashboardOrder,
  AdminDelivery,
  AdminMaterialWarning,
  AdminProductSummary,
} from '../../services/admin-api.service';

type DashboardMetricKey = 'customers' | 'products' | 'orders' | 'materials' | 'revenue';
type DashboardWeekKey = 'this' | 'last';

interface ReportItem {
  key: DashboardMetricKey;
  label: string;
  value: string;
}

interface MetricData {
  value: string;
  data: number[];
}

type MetricDatabase = Record<DashboardWeekKey, Record<DashboardMetricKey, MetricData>>;

interface NotificationItem {
  title: string;
  description: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, BaseChartDirective],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard implements OnInit {
  @ViewChild(BaseChartDirective) chart?: BaseChartDirective;

  selectedWeek: DashboardWeekKey = 'this';
  selectedMetric: DashboardMetricKey = 'customers';

  totalRevenueText = '0';
  totalOrdersText = '0';
  pendingOrdersText = '0';
  cancelledOrdersText = '0';

  reportItems: ReportItem[] = [
    { key: 'customers', label: 'Khách hàng mới', value: '0' },
    { key: 'products', label: 'Sản phẩm đã bán', value: '0' },
    { key: 'orders', label: 'Đơn đang thực hiện', value: '0' },
    { key: 'materials', label: 'NVL sắp hết', value: '0' },
    { key: 'revenue', label: 'Doanh thu', value: '0' },
  ];

  deliveries: AdminDelivery[] = [];
  orders: AdminDashboardOrder[] = [];
  notifications: NotificationItem[] = [];
  bestProducts: AdminProductSummary[] = [];
  warningMaterials: AdminMaterialWarning[] = [];

  private chartLabels = this.defaultChartLabels();
  private chartDatabase: MetricDatabase = this.emptyMetricDatabase(7);

  public lineChartData: any = {
    labels: this.chartLabels,
    datasets: [
      {
        data: [],
        borderColor: '#731919',
        borderWidth: 2,
        fill: true,
        tension: 0.45,
        backgroundColor: (context: any) => {
          const chart = context.chart;
          const { ctx, chartArea } = chart;

          if (!chartArea) {
            return 'rgba(239,67,67,0.2)';
          }

          const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          gradient.addColorStop(0, 'rgba(239,67,67,0.35)');
          gradient.addColorStop(1, 'rgba(239,67,67,0)');

          return gradient;
        },
        pointRadius: 0,
        pointHoverRadius: 7,
        pointHoverBackgroundColor: '#FFFFFF',
        pointHoverBorderColor: '#FFD9D9',
        pointHoverBorderWidth: 5,
      },
    ],
  };

  public lineChartOptions: any = this.createChartOptions();

  constructor(
    private readonly adminApi: AdminApiService,
    private readonly cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private readonly platformId: object
  ) {}

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.loadDashboard();
    }
  }

  changeWeek(week: DashboardWeekKey): void {
    this.selectedWeek = week;
    this.updateReport();
  }

  changeMetric(metric: DashboardMetricKey): void {
    this.selectedMetric = metric;
    this.updateReport();
  }

  updateReport(): void {
    this.reportItems = this.reportItems.map(item => ({
      ...item,
      value: this.chartDatabase[this.selectedWeek][item.key].value,
    }));
    this.updateChart();
  }

  private loadDashboard(): void {
    this.adminApi.getDashboard().subscribe({
      next: (data) => {
        const summary = data.summary;
        const pendingOrders = Math.max(
          0,
          summary.totalOrders - summary.completedOrders - summary.cancelledOrders
        );

        this.totalRevenueText = this.formatNumber(summary.revenue);
        this.totalOrdersText = this.formatNumber(summary.totalOrders);
        this.pendingOrdersText = this.formatNumber(pendingOrders);
        this.cancelledOrdersText = this.formatNumber(summary.cancelledOrders);

        const chartRows = data.chart?.length
          ? data.chart
          : this.defaultChartLabels().map(date => ({ date, orders: 0, revenue: 0 }));

        this.chartLabels = chartRows.map(item => item.date);
        const orderData = chartRows.map(item => Number(item.orders || 0));
        const revenueData = chartRows.map(item => Math.round(Number(item.revenue || 0) / 1000));

        this.chartDatabase = {
          this: {
            customers: {
              value: this.formatNumber(summary.newCustomers),
              data: this.seriesFromTotal(summary.newCustomers, chartRows.length),
            },
            products: {
              value: this.formatNumber(summary.productsSold),
              data: this.seriesFromTotal(summary.productsSold, chartRows.length),
            },
            orders: {
              value: this.formatNumber(pendingOrders),
              data: orderData,
            },
            materials: {
              value: this.formatNumber(summary.warningMaterials),
              data: this.seriesFromTotal(summary.warningMaterials, chartRows.length),
            },
            revenue: {
              value: this.formatNumber(summary.revenue),
              data: revenueData,
            },
          },
          last: this.emptyMetricSet(chartRows.length),
        };

        this.orders = data.orders || [];
        this.deliveries = data.deliveries || [];
        this.bestProducts = data.bestProducts || [];
        this.warningMaterials = data.warningMaterials || [];
        this.notifications = this.buildNotifications(pendingOrders);

        this.updateReport();
      },
      error: (error) => {
        console.error('Khong the tai dashboard admin:', error);
        this.cdr.detectChanges();
      },
    });
  }

  private updateChart(): void {
    const data = this.chartDatabase[this.selectedWeek][this.selectedMetric].data;

    this.lineChartData = {
      labels: this.chartLabels,
      datasets: [
        {
          ...this.lineChartData.datasets[0],
          data,
        },
      ],
    };
    this.lineChartOptions = this.createChartOptions(data);
    this.cdr.detectChanges();
    this.chart?.update();
  }

  private buildNotifications(pendingOrders: number): NotificationItem[] {
    const materialNotifications = this.warningMaterials.slice(0, 3).map(item => ({
      title: `${item.name} còn ${item.quantity}${item.unit ? ` ${item.unit}` : ''}`,
      description: 'Tồn kho dưới mức cần chú ý',
    }));

    const orderNotification = pendingOrders > 0
      ? [{
          title: `${this.formatNumber(pendingOrders)} đơn đang chờ xử lý`,
          description: 'Cần kiểm tra và cập nhật trạng thái',
        }]
      : [];

    return [...materialNotifications, ...orderNotification];
  }

  private createChartOptions(data: number[] = []): any {
    const maxValue = Math.max(...data, 1);
    const yMax = Math.max(10, Math.ceil(maxValue / 10) * 10);
    const isRevenue = this.selectedMetric === 'revenue';

    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index' as const,
        intersect: false,
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          enabled: true,
          displayColors: false,
          position: 'average' as const,
          yAlign: 'bottom' as const,
          xAlign: 'center' as const,
          backgroundColor: '#FFD9D9',
          titleColor: '#023337',
          bodyColor: '#023337',
          borderColor: '#731919',
          borderWidth: 1,
          padding: 14,
          cornerRadius: 10,
          caretSize: 8,
          caretPadding: 8,
          titleFont: {
            family: 'Nunito Sans',
            size: 14,
            weight: 'bold' as const,
          },
          bodyFont: {
            family: 'Nunito Sans',
            size: 14,
            weight: 'bold' as const,
          },
          callbacks: {
            title: (context: any) => context[0].label,
            label: (context: any) => isRevenue ? `${context.raw}k` : context.raw,
          },
        },
      },
      scales: {
        x: {
          grid: {
            display: false,
          },
          ticks: {
            color: '#8B909A',
            font: {
              family: 'Nunito Sans',
              size: 12,
            },
          },
        },
        y: {
          beginAtZero: true,
          max: yMax,
          ticks: {
            stepSize: Math.max(1, Math.ceil(yMax / 5)),
            color: '#8B909A',
            callback: (value: any) => isRevenue ? `${value}k` : value,
            font: {
              family: 'Nunito Sans',
              size: 12,
            },
          },
          grid: {
            color: '#E5E7EB',
          },
        },
      },
    };
  }

  private emptyMetricDatabase(length: number): MetricDatabase {
    return {
      this: this.emptyMetricSet(length),
      last: this.emptyMetricSet(length),
    };
  }

  private emptyMetricSet(length: number): Record<DashboardMetricKey, MetricData> {
    const data = Array.from({ length }, () => 0);

    return {
      customers: { value: '0', data: [...data] },
      products: { value: '0', data: [...data] },
      orders: { value: '0', data: [...data] },
      materials: { value: '0', data: [...data] },
      revenue: { value: '0', data: [...data] },
    };
  }

  private seriesFromTotal(total: number, length: number): number[] {
    if (!length) {
      return [];
    }

    const data = Array.from({ length }, () => 0);
    data[length - 1] = Number(total || 0);
    return data;
  }

  private defaultChartLabels(): string[] {
    return ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
  }

  private formatNumber(value: number): string {
    return Number(value || 0).toLocaleString('vi-VN');
  }
}
