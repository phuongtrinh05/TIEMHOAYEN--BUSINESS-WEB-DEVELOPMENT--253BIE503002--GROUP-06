import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { PageHeader2 } from './page-header-2';

describe('PageHeader2', () => {
  let component: PageHeader2;
  let fixture: ComponentFixture<PageHeader2>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PageHeader2],
      providers: [provideRouter([{ path: '**', children: [] }]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(PageHeader2);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
