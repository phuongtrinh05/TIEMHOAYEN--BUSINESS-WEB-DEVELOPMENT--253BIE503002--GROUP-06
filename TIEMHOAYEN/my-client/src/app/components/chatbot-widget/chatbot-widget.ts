import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-chatbot-widget',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chatbot-widget.html',
  styleUrl: './chatbot-widget.css'
})
export class ChatbotWidget {

  isOpen = false;

  openChat(): void {
    this.isOpen = true;
  }

  closeChat(): void {
    this.isOpen = false;
  }

}