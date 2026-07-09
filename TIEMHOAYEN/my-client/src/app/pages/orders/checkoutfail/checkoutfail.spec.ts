import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CheckoutfailComponent } from './checkoutfail';

describe('CheckoutfailComponent', () => {
  let component: CheckoutfailComponent;
  let fixture: ComponentFixture<CheckoutfailComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CheckoutfailComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(CheckoutfailComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});