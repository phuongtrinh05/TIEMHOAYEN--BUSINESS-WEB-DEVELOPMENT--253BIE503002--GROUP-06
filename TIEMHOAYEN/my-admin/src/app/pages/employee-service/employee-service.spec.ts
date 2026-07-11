import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EmployeeService } from './employee-service';

describe('EmployeeService', () => {
  let component: EmployeeService;
  let fixture: ComponentFixture<EmployeeService>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EmployeeService],
    }).compileComponents();

    fixture = TestBed.createComponent(EmployeeService);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
