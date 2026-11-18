import { Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-customer-service-tabs',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './customer-service-tabs.html',
  styleUrl: './customer-service-tabs.css',
})
export class CustomerServiceTabs {
  @Input() active: 'support' | 'sales' | 'after-sales' | 'chatbot' = 'support';
  @Input() supportPending = 0;
  @Input() salesPending = 0;
  @Input() afterSalesCount = 0;
}
