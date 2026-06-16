import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PageHeader2 } from './page-header-2';

describe('PageHeader2', () => {
  let component: PageHeader2;
  let fixture: ComponentFixture<PageHeader2>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PageHeader2],
    }).compileComponents();

    fixture = TestBed.createComponent(PageHeader2);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
