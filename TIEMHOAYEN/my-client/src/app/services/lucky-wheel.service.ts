import {Injectable,inject} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {apiBaseUrl} from './api-config';
@Injectable({providedIn:'root'})
export class LuckyWheelService{
  private http=inject(HttpClient);
  wallet(query:any={}){return this.http.get<any>(`${apiBaseUrl()}/lucky/wallet`,{params:query});}
  program(){return this.http.get<any>(`${apiBaseUrl()}/lucky/program`);}
  spin(id:string){return this.http.post<any>(`${apiBaseUrl()}/lucky/spins/${encodeURIComponent(id)}`,{});}
  previewCode(rewardCode:string,subtotal:number,shippingFee:number){return this.http.post<any>(`${apiBaseUrl()}/lucky/preview`,{rewardCode,subtotal,shippingFee});}
  preview(rewardId:string,subtotal:number,shippingFee:number){return this.http.post<any>(`${apiBaseUrl()}/lucky/preview`,{rewardId,subtotal,shippingFee});}
}
