import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Blog {
  BAI_VIET_ID: string;
  NHAN_VIEN_ID: string;
  TIEU_DE: string;
  NOI_DUNG: string;
  ANH_BIA: string;
  DANH_MUC_BLOG: string;
  NGAY_DANG: string;
  TRANG_THAI: string;
  LUOT_XEM: number;
}

@Injectable({
  providedIn: 'root'
})
export class BlogService {
  private apiUrl = 'https://tiem-hoa-yen-api.onrender.com/api/blogs';

  constructor(private http: HttpClient) {}

  getAll(): Observable<Blog[]> {
    return this.http.get<Blog[]>(this.apiUrl);
  }

  getById(id: string): Observable<Blog> {
    return this.http.get<Blog>(`${this.apiUrl}/${id}`);
  }
}