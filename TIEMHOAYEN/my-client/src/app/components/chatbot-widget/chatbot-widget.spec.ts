import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ChatbotWidget } from './chatbot-widget';

describe('ChatbotWidget', () => {
  let component: ChatbotWidget;
  let fixture: ComponentFixture<ChatbotWidget>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChatbotWidget],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatbotWidget);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
