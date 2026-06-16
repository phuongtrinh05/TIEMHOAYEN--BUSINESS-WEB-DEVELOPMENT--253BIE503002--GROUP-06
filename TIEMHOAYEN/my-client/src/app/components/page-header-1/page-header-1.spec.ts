import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PageHeader1 } from './page-header-1';

describe('PageHeader1', () => {
  let component: PageHeader1;
  let fixture: ComponentFixture<PageHeader1>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PageHeader1],
    }).compileComponents();

    fixture = TestBed.createComponent(PageHeader1);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
