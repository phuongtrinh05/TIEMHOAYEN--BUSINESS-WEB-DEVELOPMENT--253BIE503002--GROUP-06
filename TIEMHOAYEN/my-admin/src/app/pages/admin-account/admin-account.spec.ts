import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AdminAccount } from './admin-account';

describe('AdminAccount', () => {
  let component: AdminAccount;
  let fixture: ComponentFixture<AdminAccount>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminAccount],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminAccount);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
