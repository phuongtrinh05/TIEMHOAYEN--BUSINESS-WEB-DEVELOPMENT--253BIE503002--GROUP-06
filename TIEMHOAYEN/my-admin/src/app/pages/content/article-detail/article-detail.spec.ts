import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { convertToParamMap, ActivatedRoute } from '@angular/router';
import { ArticleDetail } from './article-detail';

describe('ArticleDetail', () => {
  let component: ArticleDetail;
  let fixture: ComponentFixture<ArticleDetail>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ArticleDetail],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({ id: 'BV002' }),
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ArticleDetail);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load mock article by route id', () => {
    expect(component.article).not.toBeNull();
    expect(component.article?.id).toBe('BV002');
  });

  it('should enter edit mode', () => {
    component.startEdit();
    expect(component.isEditing).toBe(true);
    expect(component.draft.title).toBe(component.article?.title);
  });

  it('should cancel edit and clear draft', () => {
    component.startEdit();
    component.cancelEdit();
    expect(component.isEditing).toBe(false);
    expect(Object.keys(component.draft).length).toBe(0);
  });

  it('should save local edits', () => {
    component.startEdit();
    component.draft.title = 'Tiêu đề đã sửa';
    component.saveArticle();

    expect(component.article?.title).toBe('Tiêu đề đã sửa');
    expect(component.isEditing).toBe(false);
  });

  it('should map category to correct CSS class', () => {
    expect(component.categoryClass('Hoa hồng')).toBe('cat--rose');
    expect(component.categoryClass('Hoa cưới')).toBe('cat--wedding');
    expect(component.categoryClass('Tin tức')).toBe('cat--news');
  });

  it('should compute author initials', () => {
    expect(component.authorInitials).toBe('MC');
  });
});