import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { Homepage } from './homepage';

describe('Homepage', () => {
  let component: Homepage;
  let fixture: ComponentFixture<Homepage>;

  beforeEach(async () => {
    // jsdom lacks media playback and IntersectionObserver; stub what ngAfterViewInit uses.
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
    await TestBed.configureTestingModule({
      imports: [Homepage],
      providers: [provideRouter([{ path: '**', children: [] }]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(Homepage);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
