import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-order-review',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule
  ],
  templateUrl: './order-review.html',
  styleUrl: './order-review.css'
})
export class OrderReview {

  selectedRating = 0;

  reviewText = '';

  hideReviewer = false;

  setRating(star: number){
    this.selectedRating = star;
  }

  submitReview(){
    alert('Đánh giá đã được gửi!');
  }

}