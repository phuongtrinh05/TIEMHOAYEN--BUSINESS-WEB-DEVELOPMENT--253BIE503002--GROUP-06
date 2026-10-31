import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';

import { Dashboard } from './dashboard';

describe('Dashboard', () => {
  let component: Dashboard;
  let fixture: ComponentFixture<Dashboard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Dashboard],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), provideCharts(withDefaultRegisterables())],
    }).compileComponents();

    fixture = TestBed.createComponent(Dashboard);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('phân biệt chiều tốt/xấu của KPI tỷ lệ', () => {
    const base = { code: '', label: '', unit: '%', snapshot: false, formula: '', dateField: '', notes: '', value: 5, previous: 8 };
    expect(component.changeClass({ ...base, key: 'cancelRate', change: -3 })).toBe('up');
    expect(component.changeClass({ ...base, key: 'newOrders', unit: 'đơn', change: -3 })).toBe('down');
  });
});
