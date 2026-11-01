import {Injectable,inject} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {apiBaseUrl} from './api-config';
export interface DesignMaterial {id:string;name:string;unit:string;image:string;price:number;available:number;threshold:number;modelKey:string;color:string;colors?:string[];}
export interface DesignQuote {designId:string;productId:string;name:string;image:string;price:number;requiresReview:boolean;badges:string[];designFee:number;extraFee:number;materials:any[];}
@Injectable({providedIn:'root'})
export class Design3dService {
 private http=inject(HttpClient);
 materials(){return this.http.get<{materials:DesignMaterial[];models:string[]}>(`${apiBaseUrl()}/designs-3d/materials`);}
 estimate(materials:any[]){return this.http.post<DesignQuote>(`${apiBaseUrl()}/designs-3d/estimate`,{materials});}
 save(materials:any[],image:string){return this.http.post<DesignQuote>(`${apiBaseUrl()}/designs-3d`,{materials,image});}
 get(id:string){return this.http.get<DesignQuote>(`${apiBaseUrl()}/designs-3d/${encodeURIComponent(id)}`);}
}
