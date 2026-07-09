import { Component } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

@Component({
  selector: 'app-page-footer',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './page-footer.html',
  styleUrl: './page-footer.css',
})
export class PageFooter {

  constructor(private router: Router) {}

  navigate(path: string) {
    this.router.navigate([path]).then(() => {
      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    });
  }
}