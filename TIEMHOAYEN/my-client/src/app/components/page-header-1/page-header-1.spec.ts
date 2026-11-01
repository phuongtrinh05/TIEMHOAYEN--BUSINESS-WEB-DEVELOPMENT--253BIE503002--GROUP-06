import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { PageHeader1 } from './page-header-1';

describe('PageHeader1', () => {
  let component: PageHeader1;
  let fixture: ComponentFixture<PageHeader1>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PageHeader1],
      providers: [provideRouter([{ path: '**', children: [] }]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(PageHeader1);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
