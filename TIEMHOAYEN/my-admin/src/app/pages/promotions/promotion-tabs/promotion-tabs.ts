import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-promotion-tabs',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './promotion-tabs.html',
  styleUrl: './promotion-tabs.css',
})
export class PromotionTabs {}
