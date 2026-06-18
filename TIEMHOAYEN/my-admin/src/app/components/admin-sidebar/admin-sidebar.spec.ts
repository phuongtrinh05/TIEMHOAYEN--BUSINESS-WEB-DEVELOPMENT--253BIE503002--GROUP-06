import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AdminSidebar } from './admin-sidebar';

describe('AdminSidebar', () => {
  let component: AdminSidebar;
  let fixture: ComponentFixture<AdminSidebar>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminSidebar]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AdminSidebar);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
