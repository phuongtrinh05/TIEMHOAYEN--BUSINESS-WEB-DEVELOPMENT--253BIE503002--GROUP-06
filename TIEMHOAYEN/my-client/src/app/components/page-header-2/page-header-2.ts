import { Component, HostListener } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LanguageService } from '../../services/language.service';

@Component({
  selector: 'app-page-header-2',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './page-header-2.html',
  styleUrl: './page-header-2.css',
})
export class PageHeader2 {
  currentLanguage = 'vi';

  constructor(private languageService: LanguageService) {
    this.currentLanguage = this.languageService.getCurrentLanguage();
  }

  changeLanguage(language: string): void {
    this.currentLanguage = this.languageService.changeLanguage(language);
  }

  @HostListener('window:language-changed')
  onLanguageChanged(): void {
    this.currentLanguage = this.languageService.getCurrentLanguage();
  }
}
