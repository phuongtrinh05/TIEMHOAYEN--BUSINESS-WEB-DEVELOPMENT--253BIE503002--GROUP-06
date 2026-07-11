import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CreateArticle } from './create-article';

describe('CreateArticle', () => {
  let component: CreateArticle;
  let fixture: ComponentFixture<CreateArticle>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CreateArticle]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CreateArticle);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
