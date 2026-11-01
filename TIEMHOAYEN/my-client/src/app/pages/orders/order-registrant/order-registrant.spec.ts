import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { OrderRegistrantComponent } from './order-registrant';

describe('OrderRegistrant', () => {
  let component: OrderRegistrantComponent;
  let fixture: ComponentFixture<OrderRegistrantComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrderRegistrantComponent],
      providers: [provideRouter([{ path: '**', children: [] }]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(OrderRegistrantComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
