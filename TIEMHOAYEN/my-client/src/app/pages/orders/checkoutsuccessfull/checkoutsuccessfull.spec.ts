import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CheckoutsuccessfullComponent } from './checkoutsuccessfull';

describe('Checkoutsuccessfull', () => {
  let component: CheckoutsuccessfullComponent;
  let fixture: ComponentFixture<CheckoutsuccessfullComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CheckoutsuccessfullComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CheckoutsuccessfullComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
