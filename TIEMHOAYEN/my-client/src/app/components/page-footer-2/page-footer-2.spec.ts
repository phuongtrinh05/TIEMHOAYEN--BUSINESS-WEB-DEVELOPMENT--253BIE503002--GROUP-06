import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PageFooter2 } from './page-footer-2';

describe('PageFooter2', () => {
  let component: PageFooter2;
  let fixture: ComponentFixture<PageFooter2>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PageFooter2],
    }).compileComponents();

    fixture = TestBed.createComponent(PageFooter2);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
