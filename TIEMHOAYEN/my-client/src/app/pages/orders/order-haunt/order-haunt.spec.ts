import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OrderHauntComponent } from './order-haunt';

describe('OrderComponent', () => {
  let component: OrderHauntComponent;
  let fixture: ComponentFixture<OrderHauntComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrderHauntComponent]
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
