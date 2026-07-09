import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BlogDetail } from './blog-detail';

describe('BlogDetail', () => {
  let component: BlogDetail;
  let fixture: ComponentFixture<BlogDetail>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BlogDetail],
    }).compileComponents();

    fixture = TestBed.createComponent(BlogDetail);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
