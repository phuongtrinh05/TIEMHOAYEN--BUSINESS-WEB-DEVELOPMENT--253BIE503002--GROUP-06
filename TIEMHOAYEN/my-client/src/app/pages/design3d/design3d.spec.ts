import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Design3d } from './design3d';

describe('Design3d', () => {
  let component: Design3d;
  let fixture: ComponentFixture<Design3d>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Design3d],
    }).compileComponents();

    fixture = TestBed.createComponent(Design3d);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
