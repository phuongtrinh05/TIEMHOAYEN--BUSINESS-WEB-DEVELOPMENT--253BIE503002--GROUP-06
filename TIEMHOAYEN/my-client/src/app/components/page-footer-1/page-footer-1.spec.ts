import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { PageFooter1 } from './page-footer-1';

describe('PageFooter1', () => {
  let component: PageFooter1;
  let fixture: ComponentFixture<PageFooter1>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PageFooter1],
      providers: [provideRouter([{ path: '**', children: [] }]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(PageFooter1);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
