import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { OrderHauntComponent } from './order-haunt';

describe('OrderComponent', () => {
  let component: OrderHauntComponent;
  let fixture: ComponentFixture<OrderHauntComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrderHauntComponent],
      providers: [provideRouter([{ path: '**', children: [] }]), provideHttpClient(), provideHttpClientTesting()],
    })
    .compileComponents();

    fixture = TestBed.createComponent(OrderHauntComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
