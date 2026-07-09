import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OrderRegistrantComponent } from './order-registrant';

describe('OrderRegistrant', () => {
  let component: OrderRegistrantComponent;
  let fixture: ComponentFixture<OrderRegistrantComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrderRegistrantComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(OrderRegistrantComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
