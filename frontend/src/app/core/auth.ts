import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
@Injectable({ providedIn: 'root' }) 

export class AuthService {
      constructor(private http: HttpClient) { }
private baseUrl = environment.apiUrl;
  login(body: { email: string; password: string }) {
    return this.http.post(`${this.baseUrl}/auth/login`, body);
  } 

  saveToken(token: string) {
    localStorage.setItem('token', token); // ✅ مهم
  }

  getToken() {
    return localStorage.getItem('token');
  }

  isLoggedIn() {
    return !!localStorage.getItem('token');
  }

  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
  }
}